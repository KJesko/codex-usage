#!/usr/bin/env python3
"""
Claude Code Usage Dashboard
===========================
A zero-dependency (stdlib-only) local web dashboard for Claude Code / Codex
token usage. It shells out to `ccusage --json` for accurate per-model cost,
recovers the per-project dimension by joining session UUIDs to their folder
under ~/.claude/projects/, and renders charts (tokens over time, cache
hit-rate, cost by model, cost by project).

Requirements:
  - Python 3.8+
  - ccusage available on PATH (`npm i -g ccusage`) OR npx (falls back to
    `npx -y ccusage@latest`, which is slower on first run).

Run:
  python dashboard.py                # serves http://127.0.0.1:8787
  python dashboard.py --port 9000
  python dashboard.py --no-browser
"""

import argparse
import glob
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import threading
import time
import webbrowser
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse, parse_qs

VERSION = "0.1.0"

# 5h-block token limit for the quota bar: "auto" (largest prior block) or a number.
# Set from the --token-limit CLI flag in main().
TOKEN_LIMIT_ARG = "auto"

# Optional plan preset (--plan). Maps to approximate per-plan 5h caps of
# input+output (non-cache) tokens — the closest analog to Anthropic's opaque,
# message-based limits. These are rough community estimates (post-2026-05-06
# doubling), Pro-anchored with the official 5x / 20x tier multipliers; prefer an
# explicit --token-limit for accuracy.
PLAN_ARG = None
PLAN_LIMITS = {"pro": 44_000, "max5": 220_000, "max20": 880_000}

# Snapshot warehouse: a tiny local SQLite that accumulates daily aggregates so the
# time-series/cost/model charts survive Claude's ~30-day log cleanup.
HISTORY_DB = Path.home() / ".claude" / "usage-dashboard.db"
ENABLE_HISTORY = True

# --------------------------------------------------------------------------- #
# ccusage invocation
# --------------------------------------------------------------------------- #

def _ccusage_base() -> str:
    """Return the shell command prefix used to invoke ccusage."""
    if shutil.which("ccusage"):
        return "ccusage"
    if shutil.which("npx") or shutil.which("npx.cmd"):
        return "npx -y ccusage@latest"
    raise RuntimeError(
        "Neither `ccusage` nor `npx` was found on PATH. "
        "Install ccusage with `npm install -g ccusage`."
    )


def _run_ccusage(subcommand: str, since: Optional[str] = None,
                 until: Optional[str] = None) -> dict:
    """Run `ccusage <subcommand> --json` and return parsed JSON.

    `since`/`until` are YYYYMMDD strings (ccusage's expected format); when given
    they scope the query to that inclusive date range.
    """
    cmd = f"{_ccusage_base()} {subcommand} --json"
    if since:
        cmd += f" --since {since}"
    if until:
        cmd += f" --until {until}"
    proc = subprocess.run(
        cmd,
        shell=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    out = (proc.stdout or "").strip()
    if not out:
        raise RuntimeError(
            f"ccusage produced no output for `{subcommand}`.\n"
            f"stderr: {(proc.stderr or '').strip()[:500]}"
        )
    # ccusage occasionally prints a banner line before the JSON; slice to the
    # first opening brace to be safe.
    brace = out.find("{")
    if brace > 0:
        out = out[brace:]
    return json.loads(out)


def _clean_date(value):
    """Sanitize a date query param to a bare YYYYMMDD string, else None.

    Accepts 'YYYY-MM-DD' or 'YYYYMMDD'. Strips everything but digits, which also
    hardens against shell injection since the result is interpolated into the
    ccusage command line.
    """
    if not value:
        return None
    digits = "".join(ch for ch in value if ch.isdigit())
    return digits if len(digits) == 8 else None


# --------------------------------------------------------------------------- #
# Project map: session UUID -> project folder
# --------------------------------------------------------------------------- #

def _projects_root() -> Path:
    return Path.home() / ".claude" / "projects"


def _prettify_project(folder: str) -> str:
    """
    Folder names encode the absolute project path with separators replaced by
    '-' (e.g. 'd--Tax-tax-agent'). We can't perfectly reverse it (path segments
    may contain hyphens), so we show a compact, recognizable form.
    """
    name = folder
    # Drive-letter form:  X--rest  ->  X:/rest
    if len(name) > 3 and name[1:3] == "--":
        name = name[0].upper() + ":/" + name[3:].replace("-", "/")
    else:
        name = name.replace("-", "/")
    # Collapse the common '/' noise and keep the last 2-3 meaningful segments.
    parts = [p for p in name.replace("\\", "/").split("/") if p]
    if len(parts) > 3:
        return ".../" + "/".join(parts[-3:])
    return "/".join(parts) if parts else folder


def _build_session_project_map() -> dict:
    """Map each session UUID (jsonl filename stem) to its project folder."""
    root = _projects_root()
    mapping = {}
    if not root.exists():
        return mapping
    for path in glob.glob(str(root / "*" / "*.jsonl")):
        mapping[Path(path).stem] = path  # uuid -> full jsonl path
    return mapping


# --------------------------------------------------------------------------- #
# Session metadata (VS Code-tab-style title, real cwd, git branch)
# --------------------------------------------------------------------------- #

_SESSION_META_CACHE = {}  # path -> (mtime, meta)  — avoids re-reading unchanged files


def _extract_user_text(content):
    """Pull the first human-readable text out of a user message's content."""
    txt = None
    if isinstance(content, str):
        txt = content
    elif isinstance(content, list):
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text" and block.get("text"):
                txt = block["text"]
                break
    if not txt:
        return None
    txt = " ".join(txt.split())  # collapse whitespace/newlines
    # skip wrapper/system noise that isn't a real prompt
    if txt.startswith("<") or txt.startswith("Caveat:") or txt.startswith("[Request"):
        return None
    return txt[:90]


def _session_meta(path: str) -> dict:
    """Extract {name, cwd, branch} from a session jsonl (cached by mtime)."""
    try:
        mtime = os.stat(path).st_mtime
    except OSError:
        return {"name": None, "cwd": None, "branch": None}
    cached = _SESSION_META_CACHE.get(path)
    if cached and cached[0] == mtime:
        return cached[1]

    name = summary = cwd = branch = None
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            for idx, line in enumerate(fh):
                if idx > 400:  # safety bound; the title/cwd appear near the top
                    break
                line = line.strip()
                if not line:
                    continue
                try:
                    o = json.loads(line)
                except (ValueError, TypeError):
                    continue
                if cwd is None and o.get("cwd"):
                    cwd = o["cwd"]
                if branch is None and o.get("gitBranch"):
                    branch = o["gitBranch"]
                if summary is None and o.get("type") == "summary" and o.get("summary"):
                    summary = o["summary"]  # Claude Code's auto-title (best if present)
                if name is None and o.get("type") == "user":
                    name = _extract_user_text((o.get("message") or {}).get("content"))
                if (summary or name) and cwd is not None and branch is not None:
                    break
    except OSError:
        pass

    meta = {"name": summary or name, "cwd": cwd, "branch": branch}
    _SESSION_META_CACHE[path] = (mtime, meta)
    return meta


def _compact_path(path: str) -> str:
    """Last two segments of a real filesystem path, for compact project labels."""
    parts = [p for p in path.replace("\\", "/").split("/") if p and p != ":"]
    return "/".join(parts[-2:]) if len(parts) >= 2 else (parts[-1] if parts else path)


# --------------------------------------------------------------------------- #
# Aggregation
# --------------------------------------------------------------------------- #

def _empty_bucket() -> dict:
    return {
        "cost": 0.0,
        "totalTokens": 0,
        "inputTokens": 0,
        "outputTokens": 0,
        "cacheCreationTokens": 0,
        "cacheReadTokens": 0,
    }


def _accumulate(bucket: dict, row: dict) -> None:
    bucket["cost"] += row.get("cost", row.get("totalCost", 0)) or 0
    bucket["totalTokens"] += row.get("totalTokens", 0) or 0
    bucket["inputTokens"] += row.get("inputTokens", 0) or 0
    bucket["outputTokens"] += row.get("outputTokens", 0) or 0
    bucket["cacheCreationTokens"] += row.get("cacheCreationTokens", 0) or 0
    bucket["cacheReadTokens"] += row.get("cacheReadTokens", 0) or 0


# --------------------------------------------------------------------------- #
# Snapshot warehouse (SQLite) — best-effort; never breaks the dashboard
# --------------------------------------------------------------------------- #

def _history_connect():
    HISTORY_DB.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(HISTORY_DB), timeout=5)
    conn.execute(
        """CREATE TABLE IF NOT EXISTS daily(
            period TEXT PRIMARY KEY,
            input_tokens INTEGER, output_tokens INTEGER,
            cache_creation INTEGER, cache_read INTEGER,
            total_tokens INTEGER, cost REAL,
            models_json TEXT, updated_at TEXT)"""
    )
    return conn


def _history_upsert(daily: list) -> None:
    """Persist each day's aggregate (upsert on period)."""
    if not ENABLE_HISTORY or not daily:
        return
    try:
        conn = _history_connect()
        with conn:
            for d in daily:
                conn.execute(
                    """INSERT INTO daily(period,input_tokens,output_tokens,cache_creation,
                         cache_read,total_tokens,cost,models_json,updated_at)
                       VALUES(?,?,?,?,?,?,?,?,?)
                       ON CONFLICT(period) DO UPDATE SET
                         input_tokens=excluded.input_tokens, output_tokens=excluded.output_tokens,
                         cache_creation=excluded.cache_creation, cache_read=excluded.cache_read,
                         total_tokens=excluded.total_tokens, cost=excluded.cost,
                         models_json=excluded.models_json, updated_at=excluded.updated_at""",
                    (d.get("period"), d.get("inputTokens", 0) or 0, d.get("outputTokens", 0) or 0,
                     d.get("cacheCreationTokens", 0) or 0, d.get("cacheReadTokens", 0) or 0,
                     d.get("totalTokens", 0) or 0, d.get("totalCost", 0) or 0,
                     json.dumps(d.get("modelBreakdowns", [])),
                     datetime.now(timezone.utc).isoformat()),
                )
        conn.close()
    except sqlite3.Error:
        pass  # warehouse is best-effort


def _history_read(since: Optional[str], until: Optional[str]) -> dict:
    """Return {period: daily-shaped dict} from the warehouse for the range."""
    if not ENABLE_HISTORY:
        return {}
    try:
        conn = _history_connect()
        q = ("SELECT period,input_tokens,output_tokens,cache_creation,cache_read,"
             "total_tokens,cost,models_json FROM daily")
        clauses, params = [], []
        if since:
            clauses.append("REPLACE(period,'-','') >= ?"); params.append(since)
        if until:
            clauses.append("REPLACE(period,'-','') <= ?"); params.append(until)
        if clauses:
            q += " WHERE " + " AND ".join(clauses)
        rows = conn.execute(q, params).fetchall()
        conn.close()
    except sqlite3.Error:
        return {}
    out = {}
    for r in rows:
        try:
            mb = json.loads(r[7]) if r[7] else []
        except (ValueError, TypeError):
            mb = []
        out[r[0]] = {
            "period": r[0], "inputTokens": r[1], "outputTokens": r[2],
            "cacheCreationTokens": r[3], "cacheReadTokens": r[4],
            "totalTokens": r[5], "totalCost": r[6], "modelBreakdowns": mb,
        }
    return out


def build_payload(since: Optional[str] = None, until: Optional[str] = None) -> dict:
    daily_raw = _run_ccusage("daily", since, until)
    session_raw = _run_ccusage("session", since, until)
    proj_map = _build_session_project_map()

    daily = daily_raw.get("daily", [])
    totals = daily_raw.get("totals", {})

    # --- snapshot warehouse: persist the full snapshot, then merge in any
    # history that predates ccusage's ~30-day window (fresh days always win) ---
    if since is None and until is None:
        _history_upsert(daily)
    ccusage_periods = {d.get("period") for d in daily}
    hist = _history_read(since, until)
    history_days = 0
    if hist:
        merged = dict(hist)
        for d in daily:
            merged[d.get("period")] = d
        daily = [merged[p] for p in sorted(merged)]
        history_days = sum(1 for p in merged if p not in ccusage_periods)
        t = _empty_bucket()
        for d in daily:
            _accumulate(t, {**d, "cost": d.get("totalCost", 0)})
        totals = {
            "inputTokens": t["inputTokens"], "outputTokens": t["outputTokens"],
            "cacheCreationTokens": t["cacheCreationTokens"],
            "cacheReadTokens": t["cacheReadTokens"],
            "totalTokens": t["totalTokens"], "totalCost": t["cost"],
        }

    # Aggregate cost/tokens by model across all days.
    models = {}
    for day in daily:
        for mb in day.get("modelBreakdowns", []):
            name = mb.get("modelName", "unknown")
            models.setdefault(name, _empty_bucket())
            _accumulate(models[name], mb)
    models_list = [
        {"model": k, **v}
        for k, v in sorted(models.items(), key=lambda kv: kv[1]["cost"], reverse=True)
    ]

    # Aggregate by project via session -> jsonl join, using the real cwd from
    # the log when available (accurate path) and the first user prompt as a
    # VS Code-tab-style session title.
    projects = {}
    sessions_out = []
    for s in session_raw.get("session", []):
        sid = s.get("period", "")
        path = proj_map.get(sid)
        meta = _session_meta(path) if path else {}
        cwd = meta.get("cwd")
        folder = Path(path).parent.name if path else None
        if cwd:
            full = cwd
            label = _compact_path(cwd)
        elif folder:
            full = folder
            label = _prettify_project(folder)
        else:
            full = label = f"({s.get('agent', 'other')})"

        projects.setdefault(full, {**_empty_bucket(), "sessions": 0,
                                   "project": label, "fullPath": full})
        _accumulate(projects[full], {**s, "cost": s.get("totalCost", 0)})
        projects[full]["sessions"] += 1
        sessions_out.append({
            "id": sid,
            "name": meta.get("name") or ("session " + sid[:8]),
            "branch": meta.get("branch") or "",
            "project": label,
            "fullPath": full,
            "agent": s.get("agent", ""),
            "cost": s.get("totalCost", 0),
            "totalTokens": s.get("totalTokens", 0),
            "cacheReadTokens": s.get("cacheReadTokens", 0),
            "cacheCreationTokens": s.get("cacheCreationTokens", 0),
            "lastActivity": (s.get("metadata") or {}).get("lastActivity", ""),
            "models": s.get("modelsUsed", []),
        })
    projects_list = [
        v for _, v in sorted(projects.items(), key=lambda kv: kv[1]["cost"], reverse=True)
    ]
    sessions_out.sort(key=lambda x: x["cost"], reverse=True)

    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "since": since,
        "until": until,
        "historyDays": history_days,
        "totals": totals,
        "daily": daily,
        "models": models_list,
        "projects": projects_list,
        "sessions": sessions_out,
    }


def _resolve_token_limit(blocks: list) -> tuple:
    """Determine the 5-hour-block token limit for the quota bar.

    ccusage's `--token-limit` only affects its terminal display (not JSON), so we
    compute it here. `--token-limit N` pins an explicit number; otherwise 'auto'
    uses the largest completed prior block — the same heuristic ccusage/Maciek use
    when the real plan cap is unknown.
    """
    arg = (TOKEN_LIMIT_ARG or "auto").strip().lower()
    if arg.isdigit() and int(arg) > 0:
        return int(arg), "manual", "total"
    plan = (PLAN_ARG or "").strip().lower()
    if plan in PLAN_LIMITS:
        # plan caps are message-scale estimates → measure non-cache tokens
        return PLAN_LIMITS[plan], f"plan {plan} · ≈ est (in+out)", "noncache"
    prior = [b.get("totalTokens", 0) or 0 for b in blocks
             if not b.get("isActive") and not b.get("isGap")]
    prior = [t for t in prior if t > 0]
    if prior:
        return max(prior), "auto · largest prior 5h block", "total"
    return None, "n/a · no prior blocks yet", "total"


def build_active_block() -> dict:
    """Return the active 5-hour block with quota/limit projection (or {'block': None})."""
    raw = _run_ccusage("blocks")  # all blocks: needed to derive the auto limit
    blocks = raw.get("blocks", [])
    b = next((x for x in blocks if x.get("isActive")), None)
    if not b:
        return {"block": None}

    tc = b.get("tokenCounts", {}) or {}
    burn = b.get("burnRate") or {}
    proj = b.get("projection") or {}
    total = b.get("totalTokens", 0) or 0

    limit, source, metric = _resolve_token_limit(blocks)
    limit_info = None
    if limit and limit > 0:
        tpm = burn.get("tokensPerMinute") or 0
        remaining_min = proj.get("remainingMinutes")
        proj_total = proj.get("totalTokens") or 0
        noncache = (tc.get("inputTokens", 0) or 0) + (tc.get("outputTokens", 0) or 0)
        if metric == "noncache":
            ratio = (noncache / total) if total else 0
            used, projected, burn_pm = noncache, proj_total * ratio, tpm * ratio
        else:
            used, projected, burn_pm = total, proj_total, tpm
        minutes_to_limit = (limit - used) / burn_pm if (used < limit and burn_pm > 0) else None
        will_exceed = (projected > limit) or (
            minutes_to_limit is not None and remaining_min is not None
            and minutes_to_limit <= remaining_min)
        limit_info = {
            "limit": limit,
            "source": source,
            "metric": metric,
            "used": used,
            "usedPct": used / limit * 100,
            "projectedPct": (projected / limit * 100) if projected else None,
            "minutesToLimit": minutes_to_limit,
            "willExceedBeforeReset": bool(will_exceed),
            "alreadyOver": used >= limit,
        }

    return {"block": {
        "id": b.get("id"),
        "startTime": b.get("startTime"),
        "endTime": b.get("endTime"),
        "actualEndTime": b.get("actualEndTime"),
        "costUSD": b.get("costUSD", 0) or 0,
        "totalTokens": total,
        "entries": b.get("entries", 0) or 0,
        "models": b.get("models", []) or [],
        # normalize tokenCounts key names to match the rest of the app
        "tokenCounts": {
            "inputTokens": tc.get("inputTokens", 0) or 0,
            "outputTokens": tc.get("outputTokens", 0) or 0,
            "cacheCreationTokens": tc.get("cacheCreationInputTokens", 0) or 0,
            "cacheReadTokens": tc.get("cacheReadInputTokens", 0) or 0,
        },
        "burnRate": burn,
        "projection": proj,
        "limit": limit_info,
    }}


# --------------------------------------------------------------------------- #
# Cached data provider
# --------------------------------------------------------------------------- #

class KeyedCache:
    """TTL cache keyed by an arbitrary hashable (e.g. a (since, until) tuple)."""

    def __init__(self, ttl: int = 120):
        self.ttl = ttl
        self._lock = threading.Lock()
        self._store = {}  # key -> (data, ts)

    def get(self, key, builder, force: bool = False) -> dict:
        with self._lock:
            hit = self._store.get(key)
            if hit is not None and not force and (time.time() - hit[1]) < self.ttl:
                return hit[0]
            data = builder()
            self._store[key] = (data, time.time())
            return data


CACHE = KeyedCache(ttl=120)
BLOCK_CACHE = KeyedCache(ttl=15)


# --------------------------------------------------------------------------- #
# HTTP server
# --------------------------------------------------------------------------- #

class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):  # silence default logging
        pass

    def _send(self, code: int, body: bytes, content_type: str):
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query)
        force = qs.get("refresh", ["0"])[0] == "1"
        if path == "/":
            self._send(200, HTML_PAGE.encode("utf-8"), "text/html; charset=utf-8")
        elif path == "/api/data":
            since = _clean_date(qs.get("since", [None])[0])
            until = _clean_date(qs.get("until", [None])[0])
            try:
                data = CACHE.get(
                    (since, until),
                    lambda: build_payload(since, until),
                    force=force,
                )
                body = json.dumps(data).encode("utf-8")
                self._send(200, body, "application/json; charset=utf-8")
            except Exception as e:  # surface errors to the UI
                body = json.dumps({"error": str(e)}).encode("utf-8")
                self._send(500, body, "application/json; charset=utf-8")
        elif path == "/api/block":
            try:
                data = BLOCK_CACHE.get("active", build_active_block, force=force)
                body = json.dumps(data).encode("utf-8")
                self._send(200, body, "application/json; charset=utf-8")
            except Exception as e:
                body = json.dumps({"error": str(e), "block": None}).encode("utf-8")
                self._send(200, body, "application/json; charset=utf-8")
        else:
            self._send(404, b"not found", "text/plain")


HTML_PAGE = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Claude Code Usage Dashboard</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<style>
  :root{
    --bg:#0d1117; --panel:#161b22; --panel2:#1c2230; --border:#30363d;
    --text:#e6edf3; --muted:#8b949e; --accent:#58a6ff; --green:#3fb950;
    --amber:#d29922; --red:#f85149; --violet:#bc8cff;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);
       font-family:'Segoe UI',system-ui,-apple-system,sans-serif;font-size:14px}
  header{display:flex;align-items:center;justify-content:space-between;
         padding:16px 24px;border-bottom:1px solid var(--border);
         position:sticky;top:0;background:var(--bg);z-index:5}
  h1{font-size:18px;margin:0;font-weight:600}
  h1 .sub{color:var(--muted);font-weight:400;font-size:13px;margin-left:10px}
  button{background:var(--panel2);color:var(--text);border:1px solid var(--border);
         border-radius:6px;padding:7px 14px;cursor:pointer;font-size:13px}
  button:hover{border-color:var(--accent)}
  .controls{display:flex;align-items:center;gap:10px}
  #customRange{display:inline-flex;align-items:center;gap:6px}
  select,input[type=date]{background:var(--panel2);color:var(--text);
         border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-size:13px}
  select:hover,input[type=date]:hover{border-color:var(--accent)}
  input[type=date]{color-scheme:dark}
  .wrap{padding:20px 24px;max-width:1400px;margin:0 auto}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));
         gap:14px;margin-bottom:22px}
  .card{background:var(--panel);border:1px solid var(--border);border-radius:10px;
        padding:16px}
  .card .label{color:var(--muted);font-size:12px;text-transform:uppercase;
        letter-spacing:.04em}
  .card .val{font-size:24px;font-weight:700;margin-top:6px}
  .card .val.small{font-size:18px}
  .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:18px}
  .panel{background:var(--panel);border:1px solid var(--border);border-radius:10px;
         padding:16px}
  .panel h2{font-size:14px;margin:0 0 12px;font-weight:600;color:var(--text)}
  .panel.full{grid-column:1/-1}
  canvas{max-height:320px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--border)}
  th{color:var(--muted);font-weight:500;font-size:12px}
  td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
  .pill{font-size:11px;color:var(--muted)}
  td.sname{max-width:360px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .branch{margin-left:8px;font-size:11px;color:var(--violet);
          background:rgba(188,140,255,.12);padding:1px 6px;border-radius:4px}
  /* project → session tree */
  .tree{display:flex;flex-direction:column}
  .prow{display:flex;align-items:center;gap:12px;padding:9px 6px;
        border-bottom:1px solid var(--border);cursor:pointer;user-select:none}
  .prow:hover{background:var(--panel2)}
  .caret{width:12px;color:var(--muted);transition:transform .15s}
  .plabel{font-weight:600;min-width:150px}
  .pcount{color:var(--muted);font-size:12px;min-width:56px}
  .pbar{flex:1;height:8px;background:#0d1117;border:1px solid var(--border);
        border-radius:5px;overflow:hidden}
  .pfill{display:block;height:100%;background:linear-gradient(90deg,#58a6ff,#bc8cff)}
  .pcost{min-width:82px;text-align:right;font-variant-numeric:tabular-nums;font-weight:600}
  .ssub{padding:2px 0 10px 30px}
  .srow{display:flex;justify-content:space-between;gap:16px;padding:6px 8px;
        border-bottom:1px solid #21262d;font-size:13px}
  .srow:hover{background:var(--panel2)}
  .sname2{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:560px}
  .smeta{white-space:nowrap;font-size:12px;font-variant-numeric:tabular-nums}
  #err{background:#3d1418;border:1px solid var(--red);color:#ffb4ab;
       padding:12px 16px;border-radius:8px;margin-bottom:16px;display:none;
       white-space:pre-wrap;font-family:monospace;font-size:12px}
  .muted{color:var(--muted)}
  /* live 5h block */
  .live{background:linear-gradient(135deg,#161b22 0%,#12203a 100%);
        border:1px solid #234; margin-bottom:22px}
  .live .live-head{display:flex;align-items:center;gap:10px;margin-bottom:14px}
  .live h2{margin:0}
  .dot{width:9px;height:9px;border-radius:50%;background:var(--green);
       box-shadow:0 0 0 0 rgba(63,185,80,.7);animation:pulse 1.8s infinite}
  @keyframes pulse{0%{box-shadow:0 0 0 0 rgba(63,185,80,.6)}
    70%{box-shadow:0 0 0 8px rgba(63,185,80,0)}100%{box-shadow:0 0 0 0 rgba(63,185,80,0)}}
  .live .window{margin-left:auto;color:var(--muted);font-size:12px}
  .live-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:16px}
  .live-metric .k{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.04em}
  .live-metric .v{font-size:22px;font-weight:700;margin-top:4px}
  .live-metric .v .proj{font-size:14px;color:var(--muted);font-weight:500}
  .bar{grid-column:1/-1;margin-top:6px}
  .bar .track{height:10px;background:#0d1117;border:1px solid var(--border);
       border-radius:6px;overflow:hidden}
  .bar .fill{height:100%;background:linear-gradient(90deg,#3fb950,#d29922);width:0%;
       transition:width .5s ease}
  .bar .limitfill{background:#3fb950;transition:width .5s ease,background .3s}
  .bar .barlabel{display:flex;justify-content:space-between;color:var(--muted);
       font-size:12px;margin-top:6px}
  .live .models{color:var(--muted);font-size:12px;margin-top:2px}
  @media(max-width:900px){.grid{grid-template-columns:1fr}}
</style>
</head>
<body>
<header>
  <h1>Claude Code Usage <span class="sub" id="range"></span></h1>
  <div class="controls">
    <select id="preset" title="Date range">
      <option value="all">All time</option>
      <option value="7">Last 7 days</option>
      <option value="30">Last 30 days</option>
      <option value="90">Last 90 days</option>
      <option value="custom">Custom…</option>
    </select>
    <select id="agent" title="Filter by agent">
      <option value="all">All agents</option>
      <option value="claude">Claude</option>
      <option value="codex">Codex</option>
    </select>
    <span id="customRange" style="display:none">
      <input type="date" id="fromDate"/>
      <span class="muted">–</span>
      <input type="date" id="toDate"/>
      <button id="applyRange">Apply</button>
    </span>
    <span class="pill" id="updated"></span>
    <button id="refresh">↻ Refresh</button>
    <button id="copylink" title="Copy a shareable link to this exact view">🔗</button>
  </div>
</header>
<div class="wrap">
  <div id="err"></div>
  <div class="panel live" id="liveBlock" style="display:none">
    <div class="live-head">
      <span class="dot"></span>
      <h2>Live 5-hour block</h2>
      <span class="window" id="blkWindow"></span>
    </div>
    <div class="live-grid">
      <div class="live-metric">
        <div class="k">Cost so far</div>
        <div class="v" id="blkCost">–<span class="proj" id="blkCostProj"></span></div>
      </div>
      <div class="live-metric">
        <div class="k">Burn rate</div>
        <div class="v" id="blkBurn">–</div>
      </div>
      <div class="live-metric">
        <div class="k">Tokens</div>
        <div class="v" id="blkTokens">–<span class="proj" id="blkTokProj"></span></div>
      </div>
      <div class="live-metric">
        <div class="k">Cache hit-rate</div>
        <div class="v" id="blkHit">–</div>
      </div>
      <div class="bar">
        <div class="track"><div class="fill" id="blkFill"></div></div>
        <div class="barlabel"><span id="blkElapsed"></span><span id="blkRemain"></span></div>
        <div class="models" id="blkModels"></div>
      </div>
      <div class="bar" id="blkLimitWrap" style="display:none">
        <div class="barlabel"><span id="blkLimitLabel"></span><span id="blkLimitPredict"></span></div>
        <div class="track"><div class="fill limitfill" id="blkLimitFill"></div></div>
      </div>
    </div>
  </div>
  <div class="cards" id="cards"></div>
  <div class="grid">
    <div class="panel full"><h2>Tokens per day</h2><canvas id="tokensChart"></canvas></div>
    <div class="panel"><h2>Cost per day (USD)</h2><canvas id="costChart"></canvas></div>
    <div class="panel"><h2>Cache hit-rate per day (%)</h2><canvas id="cacheChart"></canvas></div>
    <div class="panel"><h2>Cost by model</h2><canvas id="modelChart"></canvas></div>
    <div class="panel"><h2>Cost by project (top 12)</h2><canvas id="projectChart"></canvas></div>
    <div class="panel full"><h2>Projects &amp; sessions
      <span class="muted" style="font-weight:400;font-size:12px">— click a project to expand its sessions</span></h2>
      <div id="tree" class="tree"></div>
    </div>
    <div class="panel full"><h2>Top sessions by cost</h2>
      <div style="max-height:420px;overflow:auto">
        <table id="sessionsTable">
          <thead><tr>
            <th>Session</th><th>Project</th><th>Agent</th><th class="num">Cost</th>
            <th class="num">Tokens</th><th class="num">Cache hit</th>
            <th>Last activity</th>
          </tr></thead>
          <tbody></tbody>
        </table>
      </div>
    </div>
  </div>
</div>
<script>
const fmt = n => (n||0).toLocaleString('en-US');
const usd = n => '$' + (n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const compact = n => { n=n||0;
  if(n>=1e9) return (n/1e9).toFixed(2)+'B';
  if(n>=1e6) return (n/1e6).toFixed(2)+'M';
  if(n>=1e3) return (n/1e3).toFixed(1)+'K';
  return ''+n; };
const esc = s => (s==null?'':''+s).replace(/[&<>"]/g,
  c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

// ---- agent filter (client-side recompute from modelBreakdowns) ----
let lastPayload = null;
function agentFilter(){ return document.getElementById('agent').value; }
function classify(model){
  const m=(model||'').toLowerCase();
  if(m.includes('claude')||m.includes('fable')) return 'claude';
  if(m.includes('gpt')||m.includes('codex')||/^o[0-9]/.test(m)) return 'codex';
  return 'other';
}
const _b = () => ({cost:0,totalTokens:0,inputTokens:0,outputTokens:0,
                   cacheCreationTokens:0,cacheReadTokens:0});
function _add(b,r){ b.cost+=r.cost||r.totalCost||0; b.totalTokens+=r.totalTokens||0;
  b.inputTokens+=r.inputTokens||0; b.outputTokens+=r.outputTokens||0;
  b.cacheCreationTokens+=r.cacheCreationTokens||0; b.cacheReadTokens+=r.cacheReadTokens||0; }
function computeView(p, agent){
  const daily = (p.daily||[]).map(day=>{
    if(agent==='all') return day;
    const mbs=(day.modelBreakdowns||[]).filter(mb=>classify(mb.modelName)===agent);
    const b=_b(); mbs.forEach(mb=>_add(b,mb));
    return {period:day.period, ...b, modelBreakdowns:mbs};
  });
  const totals=_b(); daily.forEach(d=>_add(totals,d));
  const mm={};
  daily.forEach(day=>(day.modelBreakdowns||[]).forEach(mb=>{
    (mm[mb.modelName]=mm[mb.modelName]||_b()); _add(mm[mb.modelName],mb); }));
  const models=Object.entries(mm).map(([model,v])=>({model,...v}))
    .sort((a,b)=>b.cost-a.cost);
  const sessions=(p.sessions||[]).filter(s=>agent==='all'||s.agent===agent);
  const pj={};
  sessions.forEach(s=>{ const k=s.fullPath||s.project;
    pj[k]=pj[k]||{..._b(),sessions:0,project:s.project,fullPath:s.fullPath||s.project,_list:[]};
    _add(pj[k],s); pj[k].sessions++; pj[k]._list.push(s); });
  const projects=Object.values(pj).sort((a,b)=>b.cost-a.cost);
  return {generatedAt:p.generatedAt, totals, daily, models, projects, sessions};
}
function renderAll(){ if(lastPayload) render(computeView(lastPayload, agentFilter())); }

function renderTree(view){
  const el=document.getElementById('tree');
  const projs=view.projects||[];
  const maxCost=Math.max(1,...projs.map(p=>p.cost));
  el.innerHTML = projs.map((p,i)=>{
    const w=(p.cost/maxCost*100).toFixed(1);
    const rows=(p._list||[]).slice().sort((a,b)=>b.cost-a.cost).map(s=>{
      const la=s.lastActivity?new Date(s.lastActivity).toLocaleString():'';
      const br=s.branch?`<span class="branch">⎇ ${esc(s.branch)}</span>`:'';
      return `<div class="srow">
        <span class="sname2" title="${esc(s.name)}">${esc(s.name)}${br}</span>
        <span class="smeta">${usd(s.cost)} · ${compact(s.totalTokens)} tok · `
        +`${hitRate(s).toFixed(0)}% hit · <span class="muted">${la}</span></span></div>`;
    }).join('');
    return `<div class="prow" data-i="${i}">
        <span class="caret">▸</span>
        <span class="plabel" title="${esc(p.fullPath)}">${esc(p.project)}</span>
        <span class="pcount">${p.sessions} sess</span>
        <span class="pbar"><span class="pfill" style="width:${w}%"></span></span>
        <span class="pcost">${usd(p.cost)}</span></div>
      <div class="ssub" data-sub="${i}" style="display:none">${rows}</div>`;
  }).join('');
  el.querySelectorAll('.prow').forEach(row=>{
    row.addEventListener('click', ()=>{
      const i=row.getAttribute('data-i');
      const sub=el.querySelector(`[data-sub="${i}"]`);
      const open=sub.style.display!=='none';
      sub.style.display=open?'none':'block';
      row.querySelector('.caret').textContent=open?'▸':'▾';
    });
  });
}
const COLORS = ['#58a6ff','#3fb950','#d29922','#bc8cff','#f85149','#39c5cf',
                '#db61a2','#a5d6ff','#7ee787','#f0883e','#ffa198','#d2a8ff'];
let charts = {};
function mk(id, cfg){ if(charts[id]) charts[id].destroy();
  charts[id] = new Chart(document.getElementById(id), cfg); }
Chart.defaults.color = '#8b949e';
Chart.defaults.borderColor = '#21262d';
Chart.defaults.font.family = "'Segoe UI',system-ui,sans-serif";

function hitRate(r){ // fraction of input-side tokens served from cache
  const denom = (r.cacheReadTokens||0)+(r.cacheCreationTokens||0)+(r.inputTokens||0);
  return denom ? (r.cacheReadTokens||0)/denom*100 : 0;
}

function render(d){
  document.getElementById('updated').textContent =
    'updated ' + new Date(d.generatedAt).toLocaleTimeString();
  const days = d.daily.map(x=>x.period);
  if(days.length){
    let r = days[0] + '  →  ' + days[days.length-1];
    if(d.historyDays>0) r += '  · +' + d.historyDays + 'd from history';
    document.getElementById('range').textContent = r;
  }

  const t = d.totals || {};
  const overallHit = hitRate(t).toFixed(1);
  const cards = [
    ['Total cost', usd(t.totalCost), 'val'],
    ['Total tokens', compact(t.totalTokens), 'val'],
    ['Cache hit-rate', overallHit + '%', 'val'],
    ['Cache read (hits)', compact(t.cacheReadTokens), 'val small'],
    ['Cache create (miss)', compact(t.cacheCreationTokens), 'val small'],
    ['Output tokens', compact(t.outputTokens), 'val small'],
    ['Projects', ''+d.projects.length, 'val small'],
    ['Sessions', ''+d.sessions.length, 'val small'],
  ];
  document.getElementById('cards').innerHTML = cards.map(c=>
    `<div class="card"><div class="label">${c[0]}</div>
     <div class="${c[2]}">${c[1]}</div></div>`).join('');

  // Tokens per day (stacked)
  mk('tokensChart', {type:'bar', data:{labels:days, datasets:[
    {label:'Cache read (hit)', data:d.daily.map(x=>x.cacheReadTokens), backgroundColor:'#3fb950'},
    {label:'Cache create (miss)', data:d.daily.map(x=>x.cacheCreationTokens), backgroundColor:'#d29922'},
    {label:'Input', data:d.daily.map(x=>x.inputTokens), backgroundColor:'#58a6ff'},
    {label:'Output', data:d.daily.map(x=>x.outputTokens), backgroundColor:'#bc8cff'},
  ]}, options:{responsive:true, scales:{
      x:{stacked:true}, y:{stacked:true, ticks:{callback:v=>compact(v)}}},
      plugins:{tooltip:{callbacks:{label:c=>c.dataset.label+': '+fmt(c.raw)}}}}});

  // Cost per day
  mk('costChart', {type:'line', data:{labels:days, datasets:[
    {label:'Cost', data:d.daily.map(x=>x.totalCost), borderColor:'#58a6ff',
     backgroundColor:'rgba(88,166,255,.15)', fill:true, tension:.25, pointRadius:2}]},
    options:{plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>usd(c.raw)}}},
      scales:{y:{ticks:{callback:v=>'$'+compact(v)}}}}});

  // Cache hit-rate per day
  mk('cacheChart', {type:'line', data:{labels:days, datasets:[
    {label:'Hit-rate', data:d.daily.map(x=>hitRate(x)), borderColor:'#3fb950',
     backgroundColor:'rgba(63,185,80,.15)', fill:true, tension:.25, pointRadius:2}]},
    options:{plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.raw.toFixed(1)+'%'}}},
      scales:{y:{min:0,max:100,ticks:{callback:v=>v+'%'}}}}});

  // Cost by model
  mk('modelChart', {type:'doughnut', data:{
    labels:d.models.map(m=>m.model),
    datasets:[{data:d.models.map(m=>m.cost), backgroundColor:COLORS}]},
    options:{plugins:{legend:{position:'right',labels:{boxWidth:12}},
      tooltip:{callbacks:{label:c=>c.label+': '+usd(c.raw)}}}}});

  // Cost by project
  const proj = d.projects.slice(0,12);
  mk('projectChart', {type:'bar', data:{
    labels:proj.map(p=>p.project),
    datasets:[{label:'Cost', data:proj.map(p=>p.cost), backgroundColor:'#58a6ff'}]},
    options:{indexAxis:'y', plugins:{legend:{display:false},
      tooltip:{callbacks:{label:c=>usd(c.raw)}}},
      scales:{x:{ticks:{callback:v=>'$'+compact(v)}}}}});

  // Sessions table
  const tb = document.querySelector('#sessionsTable tbody');
  tb.innerHTML = d.sessions.slice(0,40).map(s=>{
    const la = s.lastActivity ? new Date(s.lastActivity).toLocaleString() : '';
    const branch = s.branch ? `<span class="branch">⎇ ${esc(s.branch)}</span>` : '';
    return `<tr>
      <td class="sname" title="${esc(s.name)}">${esc(s.name)}${branch}</td>
      <td title="${esc(s.fullPath||'')}">${esc(s.project)}</td>
      <td><span class="pill">${esc(s.agent)}</span></td>
      <td class="num">${usd(s.cost)}</td>
      <td class="num">${compact(s.totalTokens)}</td>
      <td class="num">${hitRate(s).toFixed(0)}%</td>
      <td class="muted">${la}</td></tr>`;
  }).join('');

  renderTree(d);
}

// ---- live 5h block ----
let blockData = null;
function fmtMin(m){ m=Math.round(m); const h=Math.floor(m/60), mm=m%60;
  return h ? h+'h '+mm+'m' : mm+'m'; }
function tickBlock(){
  if(!blockData) return;
  const s=new Date(blockData.startTime).getTime();
  const e=new Date(blockData.endTime).getTime();
  const now=Date.now();
  const frac=Math.max(0,Math.min(1,(now-s)/(e-s)));
  document.getElementById('blkFill').style.width=(frac*100).toFixed(1)+'%';
  document.getElementById('blkElapsed').textContent=fmtMin((now-s)/60000)+' elapsed';
  document.getElementById('blkRemain').textContent=fmtMin(Math.max(0,(e-now)/60000))+' left';
}
function renderBlock(resp){
  const b = resp && resp.block;
  const el = document.getElementById('liveBlock');
  if(!b){ el.style.display='none'; blockData=null; return; }
  el.style.display='block';
  blockData=b;
  const proj=b.projection||{}, burn=b.burnRate||{};
  document.getElementById('blkCost').firstChild.textContent=usd(b.costUSD)+' ';
  document.getElementById('blkCostProj').textContent =
    proj.totalCost!=null ? '→ '+usd(proj.totalCost)+' proj' : '';
  document.getElementById('blkBurn').textContent =
    usd(burn.costPerHour)+'/hr · '+compact(burn.tokensPerMinute)+' tok/min';
  document.getElementById('blkTokens').firstChild.textContent=compact(b.totalTokens)+' ';
  document.getElementById('blkTokProj').textContent =
    proj.totalTokens!=null ? '→ '+compact(proj.totalTokens)+' proj' : '';
  document.getElementById('blkHit').textContent=hitRate(b.tokenCounts).toFixed(0)+'%';
  const ws=new Date(b.startTime), we=new Date(b.endTime);
  const hm=d=>d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
  document.getElementById('blkWindow').textContent =
    hm(ws)+' – '+hm(we)+'  ('+(b.entries||0)+' entries)';
  document.getElementById('blkModels').textContent='models: '+(b.models||[]).join(', ');

  // plan / limit quota bar
  const lim=b.limit, lw=document.getElementById('blkLimitWrap');
  if(lim && lim.limit){
    lw.style.display='block';
    const fill=document.getElementById('blkLimitFill');
    fill.style.width=Math.min(100,lim.usedPct).toFixed(1)+'%';
    fill.style.background=(lim.alreadyOver||lim.usedPct>=90)?'#f85149'
        :lim.usedPct>=70?'#d29922':'#3fb950';
    document.getElementById('blkLimitLabel').innerHTML=
      'Plan limit <span class="muted">('+esc(lim.source)+')</span> — '
      +compact(lim.used)+' / '+compact(lim.limit)+' ('+lim.usedPct.toFixed(0)+'%)';
    let txt, warn=true;
    if(lim.alreadyOver){ txt='⚠ over limit this block'; }
    else if(lim.willExceedBeforeReset && lim.minutesToLimit!=null){
      txt='⚠ limit in ~'+fmtMin(lim.minutesToLimit)+' at current burn'; }
    else if(lim.projectedPct!=null && lim.projectedPct>100){
      txt='⚠ projected '+lim.projectedPct.toFixed(0)+'% by reset'; }
    else { txt='✓ on pace to stay under limit'; warn=false; }
    const pe=document.getElementById('blkLimitPredict');
    pe.textContent=txt; pe.style.color=warn?'#f0883e':'#3fb950';
  } else { lw.style.display='none'; }

  tickBlock();
}
async function loadBlock(force){
  try{
    const r=await fetch('/api/block'+(force?'?refresh=1':''));
    renderBlock(await r.json());
  }catch(e){ /* keep last-known values on transient error */ }
}

// ---- date range ----
function ymd(d){ return d.getFullYear()+String(d.getMonth()+1).padStart(2,'0')+String(d.getDate()).padStart(2,'0'); }
function currentRange(){
  const preset=document.getElementById('preset').value;
  if(preset==='all') return {};
  if(preset==='custom'){
    const f=document.getElementById('fromDate').value, t=document.getElementById('toDate').value;
    return {since:f?f.replace(/-/g,''):null, until:t?t.replace(/-/g,''):null};
  }
  const days=parseInt(preset,10), now=new Date(), since=new Date(now);
  since.setDate(now.getDate()-(days-1));
  return {since:ymd(since), until:ymd(now)};
}
function dataUrl(force){
  const p=new URLSearchParams(), {since,until}=currentRange();
  if(since) p.set('since',since);
  if(until) p.set('until',until);
  if(force) p.set('refresh','1');
  const q=p.toString();
  return '/api/data'+(q?'?'+q:'');
}

async function load(force){
  const err = document.getElementById('err');
  err.style.display='none';
  document.getElementById('updated').textContent = 'loading…';
  try{
    const r = await fetch(dataUrl(force));
    const d = await r.json();
    if(d.error){ throw new Error(d.error); }
    lastPayload = d;
    renderAll();
  }catch(e){
    err.textContent = 'Failed to load usage data:\n' + e.message;
    err.style.display='block';
    document.getElementById('updated').textContent = '';
  }
}
// ---- shareable URL state (range + agent live in the query string) ----
function syncURL(){
  const q=new URLSearchParams();
  const preset=document.getElementById('preset').value;
  const agent=document.getElementById('agent').value;
  if(preset && preset!=='all') q.set('range',preset);
  if(preset==='custom'){
    const f=document.getElementById('fromDate').value, t=document.getElementById('toDate').value;
    if(f) q.set('from',f);
    if(t) q.set('to',t);
  }
  if(agent && agent!=='all') q.set('agent',agent);
  const qs=q.toString();
  history.replaceState(null,'',qs?('?'+qs):location.pathname);
}
function initFromURL(){
  const q=new URLSearchParams(location.search);
  if(q.get('range')) document.getElementById('preset').value=q.get('range');
  if(q.get('agent')) document.getElementById('agent').value=q.get('agent');
  const custom=document.getElementById('preset').value==='custom';
  document.getElementById('customRange').style.display=custom?'inline-flex':'none';
  if(custom){
    if(q.get('from')) document.getElementById('fromDate').value=q.get('from');
    if(q.get('to')) document.getElementById('toDate').value=q.get('to');
  }
}

document.getElementById('refresh').addEventListener('click', ()=>{ load(true); loadBlock(true); });
document.getElementById('preset').addEventListener('change', e=>{
  const custom = e.target.value==='custom';
  document.getElementById('customRange').style.display = custom?'inline-flex':'none';
  syncURL();
  if(!custom) load(false);
});
document.getElementById('applyRange').addEventListener('click', ()=>{ syncURL(); load(false); });
document.getElementById('agent').addEventListener('change', ()=>{ syncURL(); renderAll(); });  // client-side, no refetch
document.getElementById('copylink').addEventListener('click', async ()=>{
  const b=document.getElementById('copylink');
  try{ await navigator.clipboard.writeText(location.href); }catch(e){ /* address bar still has it */ }
  const t=b.textContent; b.textContent='✓'; setTimeout(()=>{ b.textContent=t; }, 1200);
});

initFromURL();      // restore controls from a shared link before first load
load(false);
loadBlock(false);
setInterval(()=>loadBlock(false), 20000);  // poll active block every 20s
setInterval(tickBlock, 1000);              // local clock for progress bar
</script>
</body>
</html>"""


def main():
    ap = argparse.ArgumentParser(description="Claude Code usage dashboard")
    ap.add_argument("--port", type=int, default=8787)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--ttl", type=int, default=120, help="data cache TTL seconds")
    ap.add_argument("--no-browser", action="store_true")
    ap.add_argument("--token-limit", default="auto",
                    help="5h-block token limit for the quota bar: a number "
                         "(e.g. 88000000) or 'auto' = largest prior block (default)")
    ap.add_argument("--plan", choices=["pro", "max5", "max20"], default=None,
                    help="Approximate per-plan 5h caps (input+output tokens) for the "
                         "quota bar. Rough estimates — prefer --token-limit for accuracy.")
    ap.add_argument("--no-history", action="store_true",
                    help="Disable the local snapshot warehouse (SQLite history).")
    ap.add_argument("--version", action="version",
                    version=f"claude-usage-dashboard {VERSION}")
    args = ap.parse_args()

    global TOKEN_LIMIT_ARG, PLAN_ARG, ENABLE_HISTORY
    TOKEN_LIMIT_ARG = args.token_limit
    PLAN_ARG = args.plan
    ENABLE_HISTORY = not args.no_history
    CACHE.ttl = args.ttl
    url = f"http://{args.host}:{args.port}"

    def _warm():
        # Prime the snapshot in the background so the page loads instantly
        # (the UI shows "loading…" until this first ccusage read completes).
        try:
            CACHE.get((None, None), lambda: build_payload(None, None), force=True)
            print("First snapshot ready.")
        except Exception as e:
            print(f"WARNING: initial ccusage call failed: {e}", file=sys.stderr)

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"Claude Code Usage Dashboard  →  {url}")
    print("Serving now; the first ccusage snapshot loads in the background…")
    threading.Thread(target=_warm, daemon=True).start()
    if not args.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.shutdown()


if __name__ == "__main__":
    main()

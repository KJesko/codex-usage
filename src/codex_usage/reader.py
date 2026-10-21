"""Read Codex JSONL and metadata, never credentials or message bodies.

Only usage events, titles, paths and latest limit snapshots enter our cache.
Changed logs are reparsed atomically; unchanged logs are reused by stat signature.
"""
import hashlib
import json
import os
import re
import sqlite3
import time
from collections import Counter
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

TOKEN_FIELDS = ("input_tokens", "cached_input_tokens", "cache_write_input_tokens",
                "output_tokens", "reasoning_output_tokens")
CACHE_VERSION = 3


def utc_time(value):
    if not isinstance(value, str):
        raise ValueError("Missing event timestamp")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def counts(raw):
    if not isinstance(raw, dict):
        raise ValueError("Invalid token usage")
    result = {}
    for key in TOKEN_FIELDS:
        value = raw.get(key, 0)
        if not isinstance(value, int) or isinstance(value, bool) or value < 0:
            raise ValueError("Invalid token count")
        result[key] = value
    return result


def normalize_path(value):
    value = str(value or "").replace("\\", "/").rstrip("/")
    if value.lower().startswith("//?/unc/"):
        value = "//" + value[8:]
    elif value.startswith("//?/"):
        value = value[4:]
    return value.lower() if re.match(r"^[a-zA-Z]:/", value) else value


def project_path(cwd):
    """Collapse local subdirectories / Git worktrees to their primary repo."""
    if not cwd:
        return "未归属项目"
    path = Path(cwd)
    if path.is_dir():
        for candidate in (path, *path.parents):
            marker = candidate / ".git"
            if marker.is_dir():
                return str(candidate)
            if marker.is_file():
                try:
                    line = marker.read_text(encoding="utf-8").strip()
                    gitdir = (candidate / line.split(":", 1)[1].strip()).resolve()
                    common = gitdir / "commondir"
                    if common.is_file():
                        common_path = (gitdir / common.read_text().strip()).resolve()
                        if common_path.name == ".git":
                            return str(common_path.parent)
                except (OSError, ValueError, IndexError):
                    pass
                return str(candidate)
    return str(cwd)


def read_log(path):
    meta = {"id": path.stem, "cwd": "", "created": "", "parent": None}
    events, limits = [], {}
    warnings = Counter()
    previous, last_signature = None, None
    model, cwd = "unknown", ""
    with path.open("rb") as stream:
        for line in stream:
            # The writer may still be appending the final record.
            if not line.endswith(b"\n"):
                warnings["partial_lines"] += 1
                continue
            try:
                row = json.loads(line)
                if not isinstance(row, dict) or not isinstance(row.get("payload"), dict):
                    continue
                payload = row["payload"]
                kind = row.get("type")
                if kind == "session_meta":
                    meta.update(id=payload.get("id") or meta["id"], cwd=payload.get("cwd") or "",
                                created=payload.get("timestamp") or row.get("timestamp") or "",
                                parent=payload.get("forked_from_id"))
                    cwd = meta["cwd"]
                    model = payload.get("model") or model
                    continue
                if kind == "turn_context":
                    model = payload.get("model") or model
                    cwd = payload.get("cwd") or cwd
                    continue
                if kind != "event_msg" or payload.get("type") != "token_count":
                    continue
                stamp = utc_time(row.get("timestamp")).isoformat()
                limit = payload.get("rate_limits")
                if isinstance(limit, dict):
                    limits[limit.get("limit_id") or "codex"] = {"at": stamp, **limit}
                info = payload.get("info")
                if not isinstance(info, dict):
                    continue
                total = counts(info["total_token_usage"]) if info.get("total_token_usage") else None
                last = counts(info["last_token_usage"]) if info.get("last_token_usage") else None
                if total is not None:
                    if previous == total:
                        continue
                    if previous is None:
                        delta = last or total
                        if last and total != last:
                            warnings["unobserved_prefixes"] += 1
                    elif all(total[k] >= previous[k] for k in TOKEN_FIELDS):
                        delta = {k: total[k] - previous[k] for k in TOKEN_FIELDS}
                    else:
                        delta = last or total
                        warnings["counter_resets"] += 1
                    previous = total
                elif last:
                    delta = last
                    warnings["last_only_events"] += 1
                else:
                    continue
                signature = json.dumps([stamp, total, last], sort_keys=True)
                if signature == last_signature:
                    continue
                last_signature = signature
                inp, out = delta["input_tokens"], delta["output_tokens"]
                if not inp and not out:
                    continue
                cached = min(inp, delta["cached_input_tokens"])
                write = min(inp - cached, delta["cache_write_input_tokens"])
                if cached != delta["cached_input_tokens"] or write != delta["cache_write_input_tokens"]:
                    warnings["inconsistent_counts"] += 1
                events.append({"key": hashlib.sha256(signature.encode()).hexdigest(), "at": stamp,
                               "model": model, "cwd": cwd, "input": inp, "cached": cached,
                               "write": write, "uncached": inp - cached - write, "output": out,
                               "reasoning": min(out, delta["reasoning_output_tokens"]), "total": inp + out,
                               "context_input": (last or delta)["input_tokens"]})
            except (ValueError, TypeError, KeyError, OverflowError):
                warnings["invalid_records"] += 1
    return {"meta": meta, "events": events, "limits": limits, "warnings": dict(warnings)}


def read_metadata(root):
    result, issues = {}, []
    index = root / "session_index.jsonl"
    if index.is_file():
        try:
            for line in index.open(encoding="utf-8"):
                try:
                    row = json.loads(line)
                    if isinstance(row, dict) and row.get("id"):
                        result[row["id"]] = {"title": row.get("thread_name") or row["id"]}
                except (ValueError, TypeError):
                    continue
        except OSError:
            issues.append("会话标题索引暂时无法读取")
    databases = sorted(root.glob("state_*.sqlite"), key=lambda p: p.stat().st_mtime, reverse=True)
    if databases:
        try:
            db = sqlite3.connect(databases[0].as_uri() + "?mode=ro", uri=True, timeout=2)
            try:
                columns = {r[1] for r in db.execute("PRAGMA table_info(threads)")}
                wanted = [c for c in ("id", "title", "rollout_path", "cwd", "creator_account_id", "tokens_used") if c in columns]
                db.row_factory = sqlite3.Row
                for row in db.execute("SELECT " + ",".join(wanted) + " FROM threads"):
                    value = dict(row)
                    # Do not expose account identifiers; only an opaque local grouping key.
                    account = value.pop("creator_account_id", None)
                    value["account"] = hashlib.sha256(account.encode()).hexdigest()[:12] if account else "unknown"
                    result[value["id"]] = {**result.get(value["id"], {}), **value}
            finally:
                db.close()
        except (sqlite3.Error, OSError, ValueError):
            issues.append("会话数据库暂时不可读；仍可统计日志中的用量")
    return result, issues


class UsageIndex:
    def __init__(self, roots, cache_path, remotes=None, remote_dir=None):
        self.roots = list(dict.fromkeys(Path(r).expanduser().resolve() for r in roots))
        self.remotes = remotes or []
        self.remote_dir = remote_dir
        self.cache_path = Path(cache_path)
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(self.cache_path)) as db, db:
            db.execute("CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, root TEXT, "
                       "size INTEGER, mtime INTEGER, version INTEGER, payload TEXT)")

    def snapshot(self):
        started = time.monotonic()
        metadata, issues, paths = {}, [], {}
        for root in self.roots:
            meta, errors = read_metadata(root)
            metadata.update(meta)
            issues.extend(errors)
            if not root.is_dir():
                issues.append(f"数据目录不存在：{root}")
            for folder in (root / "sessions", root / "archived_sessions"):
                for path in folder.rglob("*.jsonl"):
                    paths[normalize_path(str(path.resolve()))] = str(root)
            for entry in meta.values():
                rollout = entry.get("rollout_path")
                if rollout and Path(rollout).suffix == ".jsonl" and Path(rollout).is_file():
                    paths[normalize_path(str(Path(rollout).resolve()))] = str(root)
        records, changed, retained = [], 0, 0
        with closing(sqlite3.connect(self.cache_path)) as db, db:
            old = {r[0]: r for r in db.execute("SELECT path,root,size,mtime,version,payload FROM files")}
            for name, root in paths.items():
                try:
                    stat = Path(name).stat()
                    hit = old.get(name)
                    if hit and hit[2:5] == (stat.st_size, stat.st_mtime_ns, CACHE_VERSION):
                        data = json.loads(hit[5])
                    else:
                        data = read_log(Path(name))
                        db.execute("INSERT OR REPLACE INTO files VALUES (?,?,?,?,?,?)",
                                   (name, root, stat.st_size, stat.st_mtime_ns, CACHE_VERSION, json.dumps(data)))
                        changed += 1
                    records.append(data)
                except (OSError, ValueError):
                    issues.append(f"日志暂时不可读：{Path(name).name}")
                    if name in old:
                        records.append(json.loads(old[name][5]))
            active_roots = {str(r) for r in self.roots}
            for name, row in old.items():
                if name not in paths and row[1] in active_roots and row[4] == CACHE_VERSION:
                    records.append(json.loads(row[5]))
                    retained += 1
        remote_files = 0
        if self.remotes and self.remote_dir:
            from .remote import read_snapshot
            for remote in self.remotes:
                if not remote['enabled']:
                    continue
                saved = read_snapshot(self.remote_dir, remote)
                source = 'ssh:' + remote['id']
                metadata.update({sid: {**item, 'source': source, 'source_name': remote['name']}
                                 for sid, item in saved.get('metadata', {}).items()})
                issues.extend(f"{remote['name']}：{error}" for error in saved.get('issues', []))
                for row in saved.get('files', {}).values():
                    data = row['data']
                    data['events'] = [{**e, 'source': source, 'source_name': remote['name']}
                                      for e in data['events']]
                    records.append(data)
                    remote_files += not row.get('retained', False)
                    retained += bool(row.get('retained'))
        sessions, limits, warnings = {}, {}, Counter()
        for data in records:
            meta = data["meta"]
            sid = meta["id"]
            session = sessions.setdefault(sid, {**meta, **metadata.get(sid, {}), "events": {}})
            for e in data["events"]:
                session["events"][e["key"]] = e
            for key, limit in data["limits"].items():
                if key not in limits or limit["at"] > limits[key]["at"]:
                    limits[key] = limit
            warnings.update(data["warnings"])
        original_keys = {sid: set(s["events"]) for sid, s in sessions.items()}
        for session in sessions.values():
            parent = sessions.get(session.get("parent"))
            if parent:
                session["events"] = {k: e for k, e in session["events"].items() if k not in original_keys[parent["id"]]}
            elif session.get("parent") and session.get("created"):
                try:
                    created = utc_time(session["created"])
                    session["events"] = {k: e for k, e in session["events"].items() if utc_time(e["at"]) >= created}
                    warnings["orphan_forks"] += 1
                except ValueError:
                    warnings["orphan_forks"] += 1
        project_cache, flat = {}, []
        for sid, session in sessions.items():
            for e in session["events"].values():
                cwd = e["cwd"] or session.get("cwd", "")
                if cwd not in project_cache:
                    project_cache[cwd] = project_path(cwd)
                project = e.get('project_root') or project_cache[cwd]
                source = e.get('source', 'local')
                project_id = normalize_path(project)
                if source != 'local':
                    project_id = source + ':' + project_id
                flat.append({**e, "session": sid, "title": session.get("title") or sid[:16],
                             "project": project_id, "project_path": project,
                             "project_name": project.replace("\\", "/").rstrip("/").split("/")[-1],
                             "source": source, "source_name": e.get('source_name', '本机'),
                             "account": session.get("account") or "unknown"})
        flat.sort(key=lambda e: (e["at"], e["session"], e["key"]))
        missing = len(set(metadata) - set(sessions))
        missing_projects = {}
        for sid in set(metadata) - set(sessions):
            item = metadata[sid]
            project = item.get('project_root') or project_path(item.get('cwd'))
            source = item.get('source', 'local')
            key = (source + ':' if source != 'local' else '') + normalize_path(project)
            entry = missing_projects.setdefault(key, dict(id=key, name=project.replace('\\', '/').split('/')[-1],
                path=project, source=source, source_name=item.get('source_name', '本机'), sessions=0,
                metadata_tokens=0, token_records=0))
            entry['sessions'] += 1
            value = item.get('tokens_used')
            if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
                entry['metadata_tokens'] += value
                entry['token_records'] += 1
        return {"events": flat, "limits": list(limits.values()), "missing_projects": list(missing_projects.values()),
                "coverage": {"sources": [str(r) for r in self.roots], "files": len(paths) + remote_files,
                             "sessions": len(sessions), "metadata_sessions": len(metadata),
                             "missing_sessions": missing, "retained_files": retained,
                             "changed_files": changed, "warnings": dict(warnings), "issues": issues,
                             "scan_ms": round((time.monotonic() - started) * 1000)},
                "scanned_at": datetime.now(timezone.utc).isoformat()}

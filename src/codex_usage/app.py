"""Local HTTP service for the Codex Usage dashboard."""
import argparse
import csv
import io
import json
import math
import os
import secrets
import sqlite3
import sys
import threading
import time
import webbrowser
from datetime import date, datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from urllib.request import urlopen
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from . import __version__
from .analytics import report
from .reader import UsageIndex
from .remote import RemoteSync, validate_remotes
from .account import AccountQuota
from .quota_alerts import DEFAULT_ALERTS
from .reset_forecast import ResetForecast
from .price_sync import PriceSync
from . import web_i18n
from .setup_check import check_sources, setup_status
from .background_config import identity
from .source_picker import browse_directory
from .account_profile import AccountProfile
from .browser_login import BrowserLogin
from .pricing import estimate, price_for
from . import web_background
from subprocess import TimeoutExpired

STATIC = Path(__file__).with_name("static")


def local_mono_font(weight):
    """Only serve the two configured font files; never accept a filesystem path."""
    filename = {'regular': 'JetBrainsMono-Regular.ttf', 'semibold': 'JetBrainsMono-SemiBold.ttf'}[weight]
    directories = [Path(os.environ.get('LOCALAPPDATA') or Path.home() / 'AppData/Local') / 'Microsoft/Windows/Fonts',
                   Path(os.environ.get('WINDIR', 'C:/Windows')) / 'Fonts']
    return next((p / filename for p in directories if (p / filename).is_file()), None)


class KeyedCache:
    """Bounded thread-safe TTL cache."""
    def __init__(self, ttl=15):
        self.ttl = ttl
        self._lock = threading.Lock()
        self._store = {}

    def get(self, key, builder, force=False):
        with self._lock:
            hit = self._store.get(key)
            if hit and not force and time.monotonic() - hit[1] < self.ttl:
                return hit[0]
            data = builder()
            if len(self._store) >= 32:
                self._store.clear()
            self._store[key] = (data, time.monotonic())
            return data

    def clear(self):
        with self._lock:
            self._store.clear()


def validate_settings(value):
    if not isinstance(value, dict):
        raise ValueError("设置必须是对象")
    timezone_mode = value.get("timezone_mode", "manual")
    if timezone_mode not in ("system", "manual"):
        raise ValueError("时区模式无效")
    zone = value.get("timezone", "America/Los_Angeles")
    try:
        ZoneInfo(zone)
    except (ZoneInfoNotFoundError, ValueError, TypeError):
        raise ValueError("时区无效；Windows 首次运行请安装 tzdata") from None
    usage_since = value.get("usage_since", "")
    if not isinstance(usage_since, str):
        raise ValueError("统计起始日期必须为 YYYY-MM-DD，或留空统计全部历史")
    if usage_since:
        try:
            if date.fromisoformat(usage_since).isoformat() != usage_since:
                raise ValueError
        except ValueError:
            raise ValueError("统计起始日期必须为有效的 YYYY-MM-DD 日期") from None
    avatar_initials = value.get("avatar_initials", "CU")
    if (not isinstance(avatar_initials, str) or not 1 <= len(avatar_initials) <= 3
            or not all((c.isascii() and c.isalnum()) or '\u3400' <= c <= '\u9fff'
                       for c in avatar_initials)):
        raise ValueError("头像请填写 1 至 3 个英文字母、数字或汉字")
    roots = value.get("sources", [])
    if not isinstance(roots, list) or not roots or len(roots) > 20:
        raise ValueError("请设置 1 至 20 个 Codex 数据目录")
    if any(not isinstance(r, str) or not r.strip() or not Path(r).expanduser().is_absolute() for r in roots):
        raise ValueError("数据目录必须为绝对路径")
    prices = value.get("prices", {})
    if not isinstance(prices, dict) or len(prices) > 200:
        raise ValueError("价格设置格式无效")
    for model, price in prices.items():
        if not isinstance(model, str) or not model or not isinstance(price, dict):
            raise ValueError("模型价格格式无效")
        for key in ("input", "cached", "write", "output"):
            n = price.get(key)
            if isinstance(n, bool) or not isinstance(n, (int, float)) or not math.isfinite(n) or n < 0:
                raise ValueError(f"{model} 的 {key} 必须是非负有限数字")
        threshold = price.get("long_context")
        if threshold is not None and (not isinstance(threshold, int) or isinstance(threshold, bool) or threshold <= 0):
            raise ValueError("长上下文阈值必须为正整数或 null")
    alerts = value.get('quota_alerts', DEFAULT_ALERTS)
    if not isinstance(alerts, dict):
        raise ValueError('额度提醒设置无效')
    alerts = {**DEFAULT_ALERTS, **alerts}
    threshold = alerts['remaining_percent']
    if (not isinstance(alerts['enabled'], bool) or not isinstance(alerts['predictive'], bool)
            or isinstance(threshold, bool) or not isinstance(threshold, (int, float))
            or not math.isfinite(threshold) or not 1 <= threshold <= 99):
        raise ValueError('提醒阈值请填写 1 至 99 的百分比')
    alerts = {key: alerts[key] for key in DEFAULT_ALERTS}
    return {"timezone_mode": timezone_mode, "timezone": zone, "usage_since": usage_since, "avatar_initials": avatar_initials.upper(), 'quota_alerts': alerts,
            "sources": list(dict.fromkeys(roots)), "prices": prices,
            "remotes": validate_remotes(value.get('remotes', []))}


class Application:
    def __init__(self, data_dir, roots=None, timezone_name=None):
        self.data_dir = Path(data_dir).resolve()
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.config_path = self.data_dir / "settings.json"
        saved = json.loads(self.config_path.read_text(encoding="utf-8")) if self.config_path.exists() else {}
        saved.setdefault("sources", [os.environ.get("CODEX_HOME") or str(Path.home() / ".codex")])
        saved.setdefault("timezone_mode", "manual" if saved.get("timezone") or timezone_name or os.environ.get("CODEX_USAGE_TIMEZONE") else "system")
        saved.setdefault("timezone", os.environ.get("CODEX_USAGE_TIMEZONE") or "America/Los_Angeles")
        if roots:
            saved["sources"] = [str(Path(p).expanduser().resolve()) for p in roots]
        if timezone_name:
            saved["timezone_mode"] = "manual"
            saved["timezone"] = timezone_name
        self.config = validate_settings(saved)
        self.cache = KeyedCache()
        self.remote_sync = RemoteSync(self.data_dir / 'remote', self.cache.clear)
        self.account_quota = AccountQuota(history_path=self.data_dir / 'quota-history.sqlite',
                                          timezone_name=self.config['timezone'])
        self.account_logout_path = self.data_dir / 'account-signed-out'
        self.account_quota.set_signed_out(self.account_logout_path.exists())
        self.browser_login = BrowserLogin(self.login_completed)
        self.account_profile = AccountProfile(path=self.data_dir / 'account-profile.json')
        self.price_sync = PriceSync(self.data_dir / 'official-prices.json', needed=self.missing_prices,
                                    used=self.used_models)
        self.reset_forecast = ResetForecast(self.data_dir / 'reset-forecast.json')
        self.index = UsageIndex(self.config["sources"], self.data_dir / "usage.sqlite",
                                self.config['remotes'], self.remote_sync.directory)
        self.lock = threading.RLock()
        self.csrf = secrets.token_urlsafe(32)
        self.collector_stop = threading.Event()
        self.collector_thread = None
        self.collection = {'started_at': None, 'last_scan': None, 'problem': None}
        self.scan_interval = 30
        self.account_quota.configure(self.config['timezone'], self.config['quota_alerts'])

    def login_completed(self):
        with self.lock:
            if self.browser_login.stop.is_set():
                return
            self.account_logout_path.unlink(missing_ok=True)
            self.account_quota.set_signed_out(False)
            self.account_profile.invalidate()
            self.account_profile.from_local_login()
        connection = self.account_quota.connection
        def reconnect():
            if connection:
                with connection.lock:
                    connection._disconnect()
            self.account_quota.request(force=True)
        threading.Thread(target=reconnect, daemon=True).start()

    def logout_account(self):
        self.browser_login.cancel()
        with self.lock:
            self.account_logout_path.write_text('signed out\n', encoding='utf-8')
            self.account_quota.set_signed_out(True)
            self.account_profile.invalidate()

    def start_collecting(self, scan_interval=30):
        if self.collector_thread is not None:
            return
        self.scan_interval = scan_interval
        self.collection['started_at'] = datetime.now(timezone.utc).isoformat()
        self.account_quota.start()
        def collect():
            while not self.collector_stop.is_set():
                try:
                    with self.lock:
                        self.remote_sync.request(self.config['remotes'])
                        self.cache.get('snapshot', self.index.snapshot, force=True)
                        self.collection.update(last_scan=datetime.now(timezone.utc).isoformat(), problem=None)
                    self.price_sync.start()
                except Exception:
                    self.collection['problem'] = '日志采集失败，下次会自动重试；请检查数据目录与磁盘空间。'
                self.collector_stop.wait(scan_interval)
        self.collector_thread = threading.Thread(target=collect, daemon=True, name='usage-collector')
        self.collector_thread.start()

    def used_models(self):
        with self.lock:
            snapshot = self.cache.get("snapshot", self.index.snapshot)
            return {e["model"] for e in snapshot["events"]}

    def missing_prices(self):
        with self.lock:
            snapshot = self.cache.get("snapshot", self.index.snapshot)
            catalog = self.price_sync.catalog()
            return {e["model"] for e in snapshot["events"]
                    if estimate(e, self.config.get("prices"), catalog)["cost"] is None}

    def collection_status(self):
        return {**self.collection, 'running': bool(self.collector_thread and self.collector_thread.is_alive()
                                                  and not self.collector_stop.is_set()), 'scan_interval_seconds': self.scan_interval}

    def stop_collecting(self):
        self.collector_stop.set()
        if self.collector_thread:
            self.collector_thread.join(timeout=5)
        self.browser_login.close()
        self.account_profile.close()
        self.account_quota.close()
        self.price_sync.close()

    def account_status(self):
        quota = self.account_quota.status()
        with self.account_quota.lock:
            identity = self.account_quota.identity
        if quota.get('signed_out') or quota.get('problem',{} ) and quota['problem'].get('kind')=='signed_out':
            self.account_profile.bind(None)
        elif identity:
            self.account_profile.bind(identity)
        return {**quota, 'usage_collector': self.collection_status(),
                'browser_login':self.browser_login.status(), 'profile':self.account_profile.status(
                    start=bool(identity and not quota['busy'] and not quota['stale'])),
                'profile_status':self.account_profile.diagnostics()}

    def data(self, query):
        with self.lock:
            self.remote_sync.request(self.config['remotes'])
            snapshot = self.cache.get("snapshot", self.index.snapshot, force=query.get("refresh") == "1")
            if query.get("refresh") == "1":
                self.collection.update(last_scan=datetime.now(timezone.utc).isoformat(), problem=None)
            result = report(snapshot, query, {**self.config, "_catalog":self.price_sync.catalog()})
            result["pricing"]["sync"] = self.price_sync.status()
            catalog = self.price_sync.catalog()
            used = sorted({e["model"] for e in snapshot["events"]})
            result["pricing"]["models"] = {name:price_for(name, self.config.get("prices"), catalog) or {} for name in used}
            result["pricing"]["missing_models"] = sorted({e["model"] for e in snapshot["events"]
                if estimate(e, self.config.get("prices"), catalog)["cost"] is None})
            result['remotes'] = self.remote_sync.statuses(self.config['remotes'])
            result['collector'] = self.collection_status()
            return result

    def save(self, value):
        validated = validate_settings(value)
        with self.lock:
            previous = self.config
            temp = self.config_path.with_suffix(".tmp")
            temp.write_text(json.dumps(validated, ensure_ascii=False, indent=2), encoding="utf-8")
            temp.replace(self.config_path)
            self.config = validated
            self.account_quota.configure(self.config['timezone'], self.config['quota_alerts'])
            if any(previous[key] != validated[key] for key in ('sources', 'remotes')):
                self.index = UsageIndex(self.config["sources"], self.data_dir / "usage.sqlite",
                                        self.config['remotes'], self.remote_sync.directory)
            if any(previous[key] != validated[key] for key in ('sources', 'remotes', 'timezone', 'usage_since', 'prices')):
                self.cache.clear()

    def patch_settings(self, patch):
        # Merge under the same lock as the write: independent browser edits cannot
        # replace unrelated settings with an older full-form snapshot.
        if not isinstance(patch, dict) or not patch or set(patch) - self.config.keys():
            raise ValueError('设置项无效')
        with self.lock:
            self.save({**self.config, **patch})
            return dict(self.config)

    def update_status(self):
        # Cached status only. Opening this panel must not scan logs or contact SSH.
        return {'local': self.collection_status(),
                'remotes': self.remote_sync.statuses(self.config['remotes']),
                'prices': self.price_sync.status()}

    def sync_remotes(self):
        with self.lock:
            self.remote_sync.request(self.config['remotes'], force=True)
            return self.remote_sync.statuses(self.config['remotes'])


def export_csv(data, dimension, search='', sort='total'):
    names = {"timeline": "date", "projects": "name", "sessions": "title", "models": "name"}
    if dimension not in names:
        raise ValueError("导出维度无效")
    rows = data[dimension]
    if dimension == 'sessions':
        query = search.lower()
        rows = [s for s in rows if any(query in v.lower() for v in
                [s['title'], s['id'], *s['model_names'], *s['project_names']])]
        if sort not in ('total', 'known_cost', 'last_at'):
            raise ValueError('会话排序无效')
        rows = sorted(rows, key=lambda s: s.get(sort) or ('' if sort == 'last_at' else 0), reverse=True)
    columns = [names[dimension], "total", "input", "uncached", "cached", "write", "output", "reasoning",
               "cost", "known_cost", "unpriced_tokens", "sessions", "events"]
    if dimension == "sessions":
        columns += ["id", "first_at", "last_at"]
    if dimension == "projects":
        columns += ["path", "source_name"]
    if dimension == "sessions":
        columns += ["source_names"]
    stream = io.StringIO(newline="")
    writer = csv.writer(stream)
    writer.writerow(columns + ["timezone", "price_basis", "price_verified_at", "usage_start"])
    for row in rows:
        values = [row.get(c, "") for c in columns]
        # Keep spreadsheet applications from interpreting local titles as formulas.
        values = [("'" + v) if isinstance(v, str) and v.lstrip().startswith(("=", "+", "-", "@")) else v for v in values]
        writer.writerow(values + [data["timezone"], "current_standard_api_equivalent", data["pricing"]["verified_at"],
                                  (data.get("usage_start") or {}).get("at", "")])
    return ("\ufeff" + stream.getvalue()).encode("utf-8")


def make_server(app, port=8787):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def allowed(self):
            host = self.headers.get("Host", "")
            return host in {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}

        def send(self, status, body, mime="application/json; charset=utf-8", download=None):
            if isinstance(body, (dict, list)):
                body = web_i18n.response(body, web_i18n.language(self.headers.get("Cookie")))
                body = json.dumps(body, ensure_ascii=False, allow_nan=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'")
            if download:
                self.send_header("Content-Disposition", f'attachment; filename="{download}"')
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                pass

        def do_GET(self):
            if not self.allowed():
                self.send(403, {"error": "仅允许本机访问"})
                return
            parsed = urlparse(self.path)
            query = {k: v[-1] for k, v in parse_qs(parsed.query).items()}
            assets = {"/": ("index.html", "text/html; charset=utf-8"),
                      "/language.js": ("language.js", "text/javascript; charset=utf-8"),
                      "/app.js": ("app.js", "text/javascript; charset=utf-8"),
                      "/web-state.js": ("web-state.js", "text/javascript; charset=utf-8"),
                      "/web-feedback.js": ("web-feedback.js", "text/javascript; charset=utf-8"),
                      "/themed-select.js": ("themed-select.js", "text/javascript; charset=utf-8"),
                      "/model-charts.js": ("model-charts.js", "text/javascript; charset=utf-8"),
                      "/activity-heatmap.js": ("activity-heatmap.js", "text/javascript; charset=utf-8"),
                      "/project-treemap.js": ("project-treemap.js", "text/javascript; charset=utf-8"),
                      "/usage-insights.js": ("usage-insights.js", "text/javascript; charset=utf-8"),
                      "/quota-tools.js": ("quota-tools.js", "text/javascript; charset=utf-8"),
                      "/quota-page.js": ("quota-page.js", "text/javascript; charset=utf-8"),
                      "/quota-range.js": ("quota-range.js", "text/javascript; charset=utf-8"),
                      "/quota-dom.js": ("quota-dom.js", "text/javascript; charset=utf-8"),
                      "/compact-tables.js": ("compact-tables.js", "text/javascript; charset=utf-8"),
                      "/hint-help.js": ("hint-help.js", "text/javascript; charset=utf-8"),
                      "/style.css": ("style.css", "text/css; charset=utf-8"),
                      "/icon.svg": ("icon.svg", "image/svg+xml")}
            try:
                if parsed.path in ('/fonts/mono-regular.ttf', '/fonts/mono-semibold.ttf'):
                    font = local_mono_font('regular' if parsed.path == '/fonts/mono-regular.ttf' else 'semibold')
                    if font:
                        self.send(200, font.read_bytes(), 'font/ttf')
                    else:
                        self.send(404, {'error': '本机未安装该字体，将使用等宽后备字体'})
                elif parsed.path in assets:
                    name, mime = assets[parsed.path]
                    self.send(200, web_i18n.asset((STATIC / name).read_bytes(), name,
                                                 web_i18n.language(self.headers.get("Cookie"))), mime)
                elif parsed.path == "/api/health":
                    self.send(200, {"app": "codex-usage", "version": __version__, 'instance': identity(app.data_dir)})
                elif parsed.path == "/api/web-background":
                    self.send(200, {**web_background.status(data_dir=app.data_dir, port=self.server.server_port), "collector": app.account_status().get("collector", {})})
                elif parsed.path == "/api/settings":
                    self.send(200, {**app.config, "csrf": app.csrf,
                                   'setup': setup_status(app.config['sources'], app.data_dir, self.server.server_port,
                                                         not app.config_path.exists())})
                elif parsed.path == '/api/status':
                    self.send(200, app.update_status())
                elif parsed.path == '/api/account':
                    app.account_quota.request()
                    self.send(200, app.account_status())
                elif parsed.path == '/api/account/history':
                    self.send(200, app.account_quota.historical_cycle(query.get('cycle', '')))
                elif parsed.path == '/api/account/range':
                    self.send(200, app.account_quota.historical_range(query.get('since', ''), query.get('until', ''), query.get('grain', 'hour')))
                elif parsed.path in ('/api/reset-updates', '/api/reset-forecast'):
                    app.reset_forecast.request()
                    self.send(200, app.reset_forecast.status())
                elif parsed.path == "/api/remotes":
                    app.remote_sync.request(app.config['remotes'])
                    self.send(200, app.remote_sync.statuses(app.config['remotes']))
                elif parsed.path == "/api/data":
                    self.send(200, app.data(query))
                elif parsed.path == "/api/export":
                    dimension = query.get("dimension", "timeline")
                    body = export_csv(app.data(query), dimension, query.get('search', ''), query.get('sort', 'total'))
                    self.send(200, body, "text/csv; charset=utf-8", f"codex-usage-{dimension}.csv")
                else:
                    self.send(404, {"error": "页面不存在"})
            except (ValueError, TypeError) as exc:
                self.send(400, {"error": str(exc)})
            except (OSError, sqlite3.Error) as exc:
                self.send(500, {"error": f"无法读取本地数据：{exc}"})

        def do_POST(self):
            origin = self.headers.get("Origin")
            allowed_origins = {f"http://127.0.0.1:{self.server.server_port}", f"http://localhost:{self.server.server_port}"}
            if (not self.allowed() or (origin and origin not in allowed_origins)
                    or not secrets.compare_digest(self.headers.get("X-CSRF-Token", ""), app.csrf)):
                self.send(403, {"error": "请从本机页面保存设置"})
                return
            if self.path == '/api/account/logout':
                app.logout_account()
                self.send(200, app.account_status())
                return
            if self.path in ('/api/account/login', '/api/account/login/cancel'):
                if self.path.endswith('/cancel'):
                    app.browser_login.cancel()
                else:
                    app.account_profile.invalidate()
                    app.browser_login.start()
                self.send(202, app.browser_login.status())
                return
            if self.path == '/api/setup/browse':
                try:
                    size = int(self.headers.get('Content-Length', '0'))
                    if not 1 <= size <= 20000:
                        raise ValueError('请求大小无效')
                    value = json.loads(self.rfile.read(size))
                    if not isinstance(value, dict):
                        raise ValueError('请求大小无效')
                    self.send(200, browse_directory(value.get('path')))
                except (ValueError, TypeError) as exc:
                    self.send(400, {'error':str(exc)})
                return
            if self.path == '/api/setup/check':
                try:
                    size = int(self.headers.get('Content-Length', '0'))
                    if not 1 <= size <= 100000:
                        raise ValueError('请求大小无效')
                    value = json.loads(self.rfile.read(size))
                    self.send(200, {'sources':check_sources(value.get('sources') if isinstance(value, dict) else None)})
                except (json.JSONDecodeError, TypeError):
                    self.send(400, {'error':'请设置 1 至 20 个 Codex 数据目录'})
                except ValueError as exc:
                    self.send(400, {'error':str(exc)})
                return
            if self.path == '/api/pricing/fetch':
                try:
                    size = int(self.headers.get("Content-Length", "0"))
                    if not 1 <= size <= 1024:
                        raise ValueError("请求大小无效")
                    value = json.loads(self.rfile.read(size))
                    model = value.get("model") if isinstance(value, dict) else None
                    if not isinstance(model, str) or model not in app.missing_prices():
                        raise ValueError("请选择实际使用且缺价的模型")
                    app.price_sync.request([model])
                    self.send(202, app.price_sync.status())
                except (ValueError, TypeError):
                    self.send(400, {"error":"请选择实际使用且缺价的模型"})
                return
            if self.path == '/api/web-background':
                try:
                    size = int(self.headers.get("Content-Length", "0"))
                    if not 1 <= size <= 128:
                        raise ValueError("请求大小无效")
                    value = json.loads(self.rfile.read(size))
                    if not isinstance(value, dict) or set(value) != {"enabled"}:
                        raise ValueError("只允许修改自动启动与恢复开关")
                    if value['enabled']:
                        app.save(app.config)  # Persist command-line source/timezone overrides before supervision.
                    result = web_background.configure(value["enabled"], data_dir=app.data_dir, port=self.server.server_port)
                    self.send(200, {**result, "collector": app.account_status().get("collector", {})})
                except (ValueError, TypeError) as exc:
                    self.send(400, {"error": str(exc)})
                except (OSError, TimeoutExpired):
                    self.send(500, {"error": "后台设置未能完成，请刷新状态后重试。"})
                return
            if self.path == '/api/remotes/sync':
                self.send(202, {'ok': True, 'remotes': app.sync_remotes()})
                return
            if self.path == '/api/account/refresh':
                app.account_profile.retry()
                app.account_quota.request(force=True)
                self.send(202, app.account_status())
                return
            if self.path.startswith('/api/account/acknowledge?'):
                query = parse_qs(urlparse(self.path).query)
                try:
                    app.account_quota.acknowledge(query.get('id', [''])[0])
                    self.send(200, app.account_status())
                except (OSError, sqlite3.Error):
                    self.send(500, {'error': '提醒暂时无法保存，请稍后重试'})
                return
            if self.path not in ("/api/settings", "/api/settings/patch"):
                self.send(404, {"error": "页面不存在"})
                return
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if size < 1 or size > 65536:
                    raise ValueError("设置内容大小无效")
                value = json.loads(self.rfile.read(size))
                if self.path.endswith('/patch'):
                    config = app.patch_settings(value)
                    self.send(200, {**config, 'csrf': app.csrf})
                else:
                    app.save(value)
                    self.send(200, {"ok": True})
            except (ValueError, TypeError) as exc:
                self.send(400, {"error": str(exc)})
            except (OSError, sqlite3.Error) as exc:
                self.send(500, {"error": str(exc)})
    class Server(ThreadingHTTPServer):
        def __init__(self, *args, **kwargs):
            self.owns_account = False
            super().__init__(*args, **kwargs)
            self.owns_account = True

        def server_close(self):
            super().server_close()
            if self.owns_account:
                self.owns_account = False
                app.stop_collecting()

    server = Server(("127.0.0.1", port), Handler)
    server.daemon_threads = True
    return server


def main():
    parser = argparse.ArgumentParser(description="Codex Usage — local usage and API-equivalent cost dashboard")
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--codex-home", action="append", help="Repeat to merge local or copied Codex data directories")
    default_data_dir = str(Path.home() / ".codex-usage")
    parser.add_argument("--data-dir", default=default_data_dir)
    parser.add_argument("--timezone")
    parser.add_argument("--version", action="version", version=f"codex-usage {__version__}")
    args = parser.parse_args()
    try:
        app = Application(args.data_dir, args.codex_home, args.timezone)
        server = make_server(app, args.port)
    except OSError as exc:
        if not args.no_browser and not args.codex_home and not args.timezone and args.data_dir == default_data_dir:
            # A second double-click should reopen our existing local dashboard.
            url = f"http://127.0.0.1:{args.port}"
            try:
                with urlopen(url + "/api/health", timeout=2) as response:
                    existing = json.load(response)
                if existing.get("app") == "codex-usage":
                    webbrowser.open(url)
                    print(f"Codex Usage is already running -> {url}")
                    return
            except (OSError, ValueError):
                pass
        parser.exit(1, f"Cannot start codex-usage: {exc}\n")
    except ValueError as exc:
        parser.exit(1, f"Cannot start codex-usage: {exc}\n")
    url = f"http://127.0.0.1:{server.server_port}"
    app.start_collecting()
    print(f"Codex Usage {__version__} -> {url}", flush=True)
    print("Local/SSH usage and live Codex account quota. USD figures are Standard API-equivalent estimates.", flush=True)
    if not args.no_browser:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()

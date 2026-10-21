"""Read ChatGPT quota through Codex's authenticated, read-only app-server RPCs.

Credentials stay with Codex. Only an allowlist of display fields crosses our HTTP
API. Quota history is isolated from log totals and stores no credentials.
"""
from datetime import datetime, timezone
import math
import os
from pathlib import Path
import queue
import shutil
import subprocess
import threading
import time
import json
import hashlib
import sqlite3
import secrets

from .quota_history import QuotaHistory
from .quota_alerts import QuotaAlerts, DEFAULT_ALERTS


class AccountError(Exception):
    def __init__(self, kind, message, stage=None):
        super().__init__(message)
        self.kind = kind
        self.stage = stage


def find_codex():
    override = os.environ.get('CODEX_USAGE_CLI')
    if override:
        path = Path(override).expanduser()
        if path.is_file() and path.is_absolute():
            return str(path)
        raise AccountError('unavailable', 'CODEX_USAGE_CLI 指向的 Codex 程序不存在。')
    found = shutil.which('codex')
    if found and Path(found).suffix.lower() not in ('.cmd', '.bat', '.ps1'):
        return found
    # Codex Desktop publishes its current native CLI here on Windows.
    local = os.environ.get('LOCALAPPDATA')
    candidates = list((Path(local) / 'OpenAI/Codex/bin').glob('*/codex.exe')) if local else []
    if candidates:
        return str(max(candidates, key=lambda p: p.stat().st_mtime))
    raise AccountError('unavailable', '未找到 Codex CLI。安装 Codex，或设置 CODEX_USAGE_CLI 后重启看板。')


class AccountRPC:
    def __init__(self, executable=None, timeout=25):
        self.timeout = timeout
        self.sequence = 0
        self.messages = queue.Queue()
        self.process = subprocess.Popen(
            [executable or find_codex(), 'app-server', '--listen', 'stdio://'],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            text=True, encoding='utf-8', errors='replace',
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        self.reader = threading.Thread(target=self._read, daemon=True)
        self.reader.start()

    def _read(self):
        try:
            for line in self.process.stdout:
                try:
                    message = json.loads(line)
                except ValueError:
                    continue
                if isinstance(message, dict) and 'id' in message:
                    self.messages.put(message)
        finally:
            self.messages.put(None)

    def send(self, row):
        try:
            self.process.stdin.write(json.dumps(row) + '\n')
            self.process.stdin.flush()
        except (OSError, ValueError):
            raise AccountError('connection_lost', 'Codex 账号连接已中断，正在等待重连。') from None

    def call(self, method, params):
        self.sequence += 1
        request_id = self.sequence
        self.send({'id': request_id, 'method': method, 'params': params})
        deadline = time.monotonic() + self.timeout
        while True:
            try:
                row = self.messages.get(timeout=max(0, deadline - time.monotonic()))
            except queue.Empty:
                raise AccountError('timeout', 'Codex 账号请求超时，请检查网络或代理连接后重试。', method) from None
            if row is None:
                raise AccountError('connection_lost', 'Codex 账号连接已退出，正在等待重连。', method)
            if row.get('id') != request_id:
                continue
            if 'error' in row:
                error = row['error'] if isinstance(row['error'], dict) else {}
                message = str(error.get('message', '')).lower()
                # Never pass raw RPC errors to the browser: they may contain URLs
                # or credential details. No login/reset/purchase RPC is invoked.
                if 'workspace routing discovery timed out' in message:
                    raise AccountError('routing_timeout', 'Codex 工作区路由发现超时，看板会自动重试。', method)
                if any(s in message for s in ('401', 'unauthorized', 'not logged', 'authentication', 'sign in', 'refresh token')):
                    raise AccountError('signed_out', 'Codex 登录已失效，请在 Codex 中重新登录后刷新。', method)
                if error.get('code') == -32601:
                    raise AccountError('unsupported', '当前 Codex 版本不支持额度读取，请更新 Codex。', method)
                raise AccountError('offline', 'Codex 账号服务请求失败，请稍后刷新。', method)
            if not isinstance(row.get('result'), dict):
                raise AccountError('unavailable', 'Codex 返回的账号数据无法识别。')
            return row['result']

    def close(self):
        try:
            self.process.stdin.close()
        except (OSError, ValueError):
            pass
        try:
            self.process.wait(timeout=1)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait(timeout=3)
        self.reader.join(timeout=1)
        self.process.stdout.close()


def finite(value):
    return isinstance(value, (float, int)) and not isinstance(value, bool) and math.isfinite(value)


def reset_credits(limits):
    raw = limits.get('rateLimitResetCredits')
    if not isinstance(raw, dict):
        return {'available_count': None, 'details': None}
    count = raw.get('availableCount')
    count = int(count) if finite(count) and count >= 0 and count == int(count) else None
    # Never expose opaque redeemable IDs. The count is authoritative even when
    # the service caps the detail rows or only returns a count.
    rows = raw.get('credits')
    details = None if not isinstance(rows, list) else [
        {key: row.get(source) if finite(row.get(source)) and 0 < row[source] < 253402300800 else None
         for key, source in [('granted_at', 'grantedAt'), ('expires_at', 'expiresAt')]}
        for row in rows[:100] if isinstance(row, dict)]
    return {'available_count': count, 'details': details}


def normalize_quota(limits):
    buckets = limits.get('rateLimitsByLimitId')
    # The keyed representation is authoritative, including an empty map.
    if not isinstance(buckets, dict):
        legacy = limits.get('rateLimits')
        buckets = {legacy.get('limitId') or 'codex': legacy} if isinstance(legacy, dict) else {}
    windows = []
    for key, bucket in buckets.items():
        if not isinstance(bucket, dict):
            continue
        for slot in ('primary', 'secondary'):
            window = bucket.get(slot)
            if not isinstance(window, dict):
                continue
            used = window.get('usedPercent')
            used = max(0, min(100, used)) if finite(used) else None
            duration, reset = window.get('windowDurationMins'), window.get('resetsAt')
            duration = duration if finite(duration) and duration > 0 else None
            reset = reset if finite(reset) and 0 < reset < 253402300800 else None
            label = {300: '5 小时额度', 10080: '每周额度', 43200: '30 天额度'}.get(duration)
            if not label:
                label = f'{duration / 60:g} 小时额度' if duration and duration % 60 == 0 else f'{duration:g} 分钟额度' if duration else '额度窗口'
            windows.append({'id': f'{key}:{slot}', 'bucket': str(key),
                            'bucket_name': bucket.get('limitName') or ('Codex' if key == 'codex' else str(key)),
                            'label': label, 'used_percent': used,
                            'remaining_percent': 100 - used if used is not None else None,
                            'window_minutes': duration, 'resets_at': reset})
    identity = limits.get('accountId')
    # Bind history to the identity in this exact quota snapshot. Never carry a
    # previous identity forward, or merge older email-keyed history by guessing.
    # Namespacing keeps these hashes separate from the old email-based keys.
    account_key = (hashlib.sha256(('quota-account:' + identity).encode()).hexdigest()
                   if isinstance(identity, str) and identity.strip() else None)
    bucket = buckets.get('codex')
    plan = bucket.get('planType') if isinstance(bucket, dict) else None
    return {'_account_key': account_key, 'history_available': bool(account_key),
            'account': {'label': '当前 Codex 账号', 'plan': plan if isinstance(plan, str) else None},
            'windows': windows, 'reset_credits': reset_credits(limits),
            'fetched_at': datetime.now(timezone.utc).isoformat(),
            'source': 'codex-app-server', 'scope': 'account'}


def initialize(rpc):
    rpc.call('initialize', {'clientInfo': {'name': 'codex_usage', 'title': 'Codex Usage', 'version': '1.1.0'}})
    rpc.send({'method': 'initialized', 'params': {}})


def read_quota(rpc):
    # Optional profile metadata must never delay or gate quota refreshes. The
    # authenticated quota endpoint provides its own plan and account identity.
    return normalize_quota(rpc.call('account/rateLimits/read', {}))


class AccountConnection:
    """Reuse the authenticated process; identify each live quota independently."""
    def __init__(self, factory=None):
        self.factory = factory or AccountRPC
        self.rpc = None
        self.lock = threading.Lock()
        self.closed = False

    def __call__(self):
        with self.lock:
            if self.closed:
                raise AccountError('connection_lost', '账号连接已关闭。')
            for attempt in range(2):
                try:
                    if self.rpc is None:
                        self.rpc = self.factory()
                        try:
                            initialize(self.rpc)
                        except Exception:
                            self._disconnect()
                            raise
                    return read_quota(self.rpc)
                except AccountError as exc:
                    if exc.kind in ('connection_lost', 'timeout', 'signed_out', 'unsupported'):
                        self._disconnect()
                    # Reconnect a broken transport once, but do not loop on a
                    # service-side routing failure. The next scheduled refresh
                    # retries that request on the same, already started process.
                    if exc.kind == 'connection_lost' and attempt == 0:
                        continue
                    raise

    def _disconnect(self):
        if self.rpc is not None:
            rpc, self.rpc = self.rpc, None
            rpc.close()

    def close(self):
        with self.lock:
            self.closed = True
            self._disconnect()


def fetch_quota():
    connection = AccountConnection()
    try:
        return connection()
    finally:
        connection.close()


class AccountQuota:
    """One in-flight refresh; failures retain a clearly stale memory snapshot."""
    def __init__(self, fetcher=None, interval=60, history_path=None, timezone_name='UTC'):
        self.connection = AccountConnection() if fetcher is None else None
        self.fetcher, self.interval = fetcher or self.connection, interval
        self.lock = threading.Lock()
        self.data = None
        self.busy = False
        self.attempt = None
        self.error = None
        self.thread = None
        self.success_at = None
        self.closed = False
        self.history = QuotaHistory(history_path) if history_path else None
        self.timezone_name = timezone_name
        self.identity = None
        self.history_scope = None
        self.alert_store = QuotaAlerts(history_path) if history_path else None
        self.alert_config = dict(DEFAULT_ALERTS)
        self.active_alerts = []
        self.stop_event = threading.Event()
        self.collector_thread = None
        self.started_at = None
        self.attempt_at = None
        self.failures = 0

    def start(self):
        with self.lock:
            if self.closed or self.collector_thread is not None:
                return
            self.started_at = datetime.now(timezone.utc).isoformat()
            self.collector_thread = threading.Thread(target=self._collect, daemon=True, name='quota-collector')
            self.collector_thread.start()

    def _collect(self):
        while not self.stop_event.is_set():
            self.request()
            self.stop_event.wait(max(.05, min(self.interval, 1)))

    def configure(self, timezone_name, alerts):
        with self.lock:
            if self.alert_config != alerts:
                self.active_alerts = []
            self.timezone_name, self.alert_config = timezone_name, dict(alerts)

    def historical_cycle(self, cycle_id):
        with self.lock:
            identity, zone = self.identity, self.timezone_name
        if not identity or not self.history:
            raise ValueError('当前账号身份尚未确认，成功同步额度后再查看历史')
        result = self.history.cycle(identity, cycle_id, time.time(), zone)
        with self.lock:
            if identity != self.identity:
                raise ValueError('账号已切换，请重新选择周期')
        return result

    def acknowledge(self, alert_id):
        with self.lock:
            identity = self.identity
        if identity and self.alert_store:
            self.alert_store.acknowledge(identity, alert_id)

    def historical_range(self, since, until, grain='hour'):
        with self.lock:
            identity, zone = self.identity, self.timezone_name
        if not identity or not self.history:
            raise ValueError('当前账号身份尚未确认，成功同步额度后再查看历史')
        result = self.history.range(identity, since, until, time.time(), zone, grain)
        with self.lock:
            if identity != self.identity:
                raise ValueError('账号已切换，请重新选择范围')
        return result

    def request(self, force=False):
        with self.lock:
            elapsed = float('inf') if self.attempt is None else time.monotonic() - self.attempt
            # Even manual refresh has a short debounce to avoid request storms.
            if self.closed or self.busy or elapsed < (5 if force else self.interval):
                return
            self.busy, self.attempt = True, time.monotonic()
            self.attempt_at = datetime.now(timezone.utc).isoformat()
            self.thread = threading.Thread(target=self._refresh, daemon=True)
            self.thread.start()

    def _refresh(self):
        try:
            data = self.fetcher()
            identity = data.get('_account_key')
            with self.lock:
                zone, alert_config = self.timezone_name, dict(self.alert_config)
            active_alerts = []
            if self.history and not data.get('_account_key'):
                data['pace'] = {}
                data['history_problem'] = '额度接口未返回账号标识，暂不保存历史；实时额度正常更新。'
            elif self.history:
                try:
                    data['pace'] = self.history.record(data, zone)
                    data['cycles'] = self.history.cycles(identity, time.time())
                    data['reset_events'] = self.history.resets.events(identity, time.time())
                except Exception:
                    # A history write failure must not hide a successful live read.
                    data['pace'] = {}
                    data['history_problem'] = '额度历史暂时无法保存，实时额度仍可查看。'
            if self.alert_store and identity:
                try:
                    active_alerts = self.alert_store.evaluate(data, data.get('pace', {}), alert_config, time.time())
                except Exception:
                    data['alerts_problem'] = '额度提醒暂时无法保存，实时额度仍可查看。'
            data.pop('_account_key', None)
            with self.lock:
                self.data, self.error = data, None
                self.success_at = time.monotonic()
                if identity != self.identity:
                    self.history_scope = secrets.token_urlsafe(12) if identity else None
                self.identity, self.failures = identity, 0
                self.active_alerts = active_alerts if alert_config == self.alert_config else []
        except Exception as exc:
            error = exc if isinstance(exc, AccountError) else AccountError('unavailable', '账号连接暂时不可用，请检查 Codex 后重试。')
            with self.lock:
                self.error = {'kind': error.kind, 'message': str(error), 'stage': error.stage}
                self.failures += 1
                if error.kind in ('signed_out', 'unsupported'):
                    self.data = None
                    self.identity = None
                    self.history_scope = None
                    self.active_alerts = []
        finally:
            with self.lock:
                self.busy = False

    def status(self):
        with self.lock:
            stale = bool(self.error or (self.success_at is not None and time.monotonic() - self.success_at > self.interval * 2))
            data = dict(self.data or {'account': None, 'windows': [], 'fetched_at': None})
            if stale:
                data['pace'] = {key: {**value, 'status': 'stale', 'estimated_exhaustion': None}
                                for key, value in data.get('pace', {}).items()}
            alerts = []
            if self.alert_store and self.identity:
                try:
                    alerts = self.alert_store.list(self.identity, time.time(),
                                                   self.active_alerts if not stale and self.alert_config['enabled'] else ())
                except sqlite3.Error:
                    data['alerts_problem'] = '提醒记录暂不可用'
            return {**data, 'alerts': alerts, 'history_scope': self.history_scope,
                    'collector': {'running': bool(self.collector_thread and self.collector_thread.is_alive() and not self.closed),
                                  'started_at': self.started_at, 'last_attempt': self.attempt_at,
                                  'last_success': data.get('fetched_at'), 'failures': self.failures,
                                  'interval_seconds': self.interval, 'retention_days': 90},
                    'busy': self.busy, 'stale': stale, 'problem': self.error,
                    'refresh_seconds': self.interval, 'scope': 'account', 'source': 'codex-app-server'}

    def close(self):
        with self.lock:
            self.closed = True
        self.stop_event.set()
        if self.collector_thread:
            self.collector_thread.join(timeout=2)
        if self.connection:
            self.connection.close()

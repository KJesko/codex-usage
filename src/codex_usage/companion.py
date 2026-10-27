"""Small desktop controller for an existing or locally owned dashboard service.

The native bridge accepts fixed actions, never arbitrary URLs, commands or paths.
Authentication stays with the dashboard's official browser-login flow.
"""
from contextlib import AbstractContextManager
from datetime import datetime, timezone
import json
import logging
import os
from pathlib import Path
import threading
import time
from urllib.error import HTTPError
from urllib.parse import urlencode, urlparse
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener
import webbrowser

from . import __version__
from .background_config import identity, load_launch


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class LocalClient:
    def __init__(self, data_dir, port):
        if type(port) is not int or not 1 <= port <= 65535:
            raise ValueError('Invalid local service port')
        self.url = f'http://127.0.0.1:{port}'
        self.instance = identity(data_dir)
        self.opener = build_opener(ProxyHandler({}), NoRedirect())

    def _request(self, path, csrf=None, body=None):
        headers = {'Accept': 'application/json'}
        if csrf is not None:
            headers.update({'X-CSRF-Token': csrf, 'Origin': self.url, 'Content-Type': 'application/json'})
        request = Request(self.url + path, data=json.dumps(body or {}).encode() if csrf is not None else None,
                          headers=headers)
        with self.opener.open(request, timeout=4) as response:
            return json.load(response)

    def verify(self):
        health = self._request('/api/health')
        if health.get('app') != 'codex-usage' or health.get('instance') != self.instance:
            raise ValueError('端口由其他服务或数据目录占用，请使用正确的端口。')
        return health

    def get(self, path):
        self.verify()
        return self._request(path)

    def post(self, path, body=None):
        self.verify()
        # Read a current token each time: a supervised backend may have restarted.
        settings = self._request('/api/settings')
        return self._request(path, settings['csrf'], body)


class CompanionService(AbstractContextManager):
    """Attach before constructing Application so a second collector is never opened."""
    def __init__(self, data_dir, port=None, codex_home=None, timezone_name=None):
        self.data_dir = Path(data_dir)
        launch = load_launch(data_dir)
        self.port = launch['port'] if port is None else port
        self.environment = launch['environment']
        self.client = LocalClient(data_dir, self.port)
        self.codex_home, self.timezone = codex_home, timezone_name
        self.server = self.thread = None

    @property
    def owned(self):
        return self.server is not None

    def __enter__(self):
        try:
            self.client.verify()
            return self
        except (OSError, HTTPError):
            pass
        # Refuse a conflicting listener rather than silently collecting into the
        # same database on another port. Binding precedes starting any collector.
        from .app import Application, make_server
        for key, value in self.environment.items():
            os.environ.setdefault(key, value)
        app = Application(self.data_dir, self.codex_home, self.timezone)
        try:
            self.server = make_server(app, self.port)
        except OSError:
            app.stop_collecting()
            # A supervisor can win the bind race; attach only after identity check.
            self.client.verify()
            return self
        app.start_collecting()
        self.thread = threading.Thread(target=self.server.serve_forever,
                                       kwargs={'poll_interval': .1}, daemon=True)
        self.thread.start()
        return self

    def __exit__(self, *_):
        if self.server:
            self.server.shutdown()
            self.server.server_close()
            self.thread.join(timeout=5)


def tracking_state(account, now=None):
    """A valid session alone is not proof that quota is being tracked."""
    now = time.time() if now is None else now
    if account.get('signed_out') or (account.get('problem') or {}).get('kind') == 'signed_out':
        return 'signed_out'
    if account.get('problem'):
        return 'error'
    fetched = account.get('fetched_at')
    if not fetched:
        return 'connecting' if account.get('busy') else 'waiting'
    try:
        age = now - datetime.fromisoformat(fetched.replace('Z', '+00:00')).timestamp()
    except (ValueError, TypeError, AttributeError):
        return 'stale'
    interval = account.get('collector', {}).get('interval_seconds', 60)
    if account.get('stale') or age > max(120, interval * 2) or age < -60:
        return 'stale'
    if not account.get('collector', {}).get('running'):
        return 'paused'
    if account.get('history_problem'):
        return 'history_error'
    return 'tracking'


class CompanionController:
    def __init__(self, service, open_browser=webbrowser.open):
        self.service, self.client = service, service.client
        self.open_browser = open_browser
        self.lock = threading.RLock()
        self.poll_lock = threading.Lock()
        self.operation_lock = threading.Lock()
        self.stop = threading.Event()
        self.wake = threading.Event()
        self.window = self.tray = None
        self.quitting = False
        self.thread = None
        self.login_owned = False
        self.opened_login = None
        self.preference_path = service.data_dir / 'companion-preferences.json'
        try:
            saved = json.loads(self.preference_path.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            saved = {}
        self.preferences = {'notifications': saved.get('notifications', True) is True,
                            'theme': saved.get('theme') if saved.get('theme') in ('system', 'light', 'dark') else 'system'}
        self.seen = list(saved.get('seen', []))[-256:] if isinstance(saved.get('seen'), list) else []
        self.snapshot = {'state': 'connecting', 'account': {}, 'connected': False}
        self.failures = 0
        self.last_notice_state = None
        self.notification_error = ''

    def _save(self):
        self.preference_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.preference_path.with_suffix('.tmp')
        temporary.write_text(json.dumps({**self.preferences, 'seen': self.seen[-256:]}, ensure_ascii=False), encoding='utf-8')
        temporary.replace(self.preference_path)

    def _notify(self, message):
        if not self.tray or not self.preferences['notifications']:
            return False
        try:
            self.tray.notify(message[:240], 'Codex Usage')
            self.notification_error = ''
            return True
        except Exception:
            self.notification_error = '系统通知暂不可用，请在消息中心查看提醒。'
            logging.exception('Desktop notification failed')
            return False

    def _open_login(self, login):
        url = login.get('url', '')
        parsed = urlparse(url)
        if (parsed.scheme != 'https' or parsed.hostname != 'auth.openai.com'
                or parsed.username or parsed.password or parsed.port not in (None, 443)):
            raise ValueError('登录链接无效，请重新发起官方浏览器登录。')
        if not self.open_browser(url):
            raise OSError('无法打开默认浏览器，请检查系统浏览器设置后重试。')
        self.opened_login = url

    def poll(self):
        if not self.poll_lock.acquire(blocking=False):
            return
        if not self.operation_lock.acquire(blocking=False):
            self.poll_lock.release()
            return
        try:
            account = self.client.get('/api/account')
            state = tracking_state(account)
            with self.lock:
                self.failures = 0
                login = account.get('browser_login') or {}
                login_error = ''
                if self.login_owned and login.get('status') == 'waiting' and login.get('url') != self.opened_login:
                    try:
                        self._open_login(login)
                    except (OSError, ValueError) as exc:
                        login_error = str(exc)
                        self.login_owned = False  # no repeated browser launches after failure
                if login.get('status') in ('success', 'failed', 'expired', 'cancelled'):
                    self.login_owned = False
                # Authorization URLs never enter the GUI or persisted preferences.
                # The helper does not need large pace/cycle/reset-history payloads.
                account = {key: account[key] for key in ('account', 'profile', 'fetched_at', 'collector',
                           'windows', 'alerts', 'signed_out', 'busy', 'stale', 'problem', 'history_problem') if key in account}
                account['browser_login'] = {k: v for k, v in login.items() if k != 'url'}
                self.snapshot = {'state': state, 'account': account, 'connected': True,
                                 'login_error': login_error, 'checked_at': datetime.now(timezone.utc).isoformat()}
                unread = [a for a in account.get('alerts', []) if a.get('active') and not a.get('acknowledged') and a.get('id') not in self.seen]
                if unread and self._notify('；'.join(a['message'] for a in unread[:3])):
                    self.seen = (self.seen + [a['id'] for a in unread])[-256:]
                    try:
                        self._save()
                    except OSError:
                        self.notification_error = '通知记录暂时无法保存，重启助手后可能再次提醒。'
                if state == 'signed_out' and self.last_notice_state != state:
                    self._notify('账号需要登录。打开后台助手，通过官方浏览器页面重新连接。')
                self.last_notice_state = state
        except (OSError, ValueError, KeyError, TypeError):
            with self.lock:
                self.failures += 1
                self.snapshot = {**self.snapshot, 'state': 'offline', 'connected': False}
                if self.failures == 3:
                    self._notify('暂时无法连接后台服务，正在自动重试。请打开后台助手查看状态。')
        finally:
            self.operation_lock.release()
            self.poll_lock.release()

    def start(self):
        def monitor():
            while not self.stop.is_set():
                self.poll()
                login = self.snapshot.get('account', {}).get('browser_login', {}).get('status')
                self.wake.wait(1 if login in ('starting', 'waiting') else min(30, 5 * max(1, self.failures)))
                self.wake.clear()
        self.thread = threading.Thread(target=monitor, daemon=True, name='companion-monitor')
        self.thread.start()

    def status(self):
        with self.lock:
            return {**self.snapshot, 'preferences': dict(self.preferences), 'version': __version__,
                    'owned': self.service.owned, 'url': self.client.url,
                    'tray_available': self.tray is not None, 'notification_error': self.notification_error}

    def action(self, name, value=None):
        if not self.operation_lock.acquire(blocking=False):
            return {'ok': False, 'error': '正在处理，请稍候。'}
        try:
            if name == 'dashboard':
                view = value if value in ('overview', 'quota', 'settings') else 'overview'
                if not self.open_browser(self.client.url + '/?' + urlencode({'view': view})):
                    raise OSError('无法打开默认浏览器，请检查系统浏览器设置。')
            elif name == 'login':
                with self.lock:
                    current = self.client.get('/api/account').get('browser_login') or {}
                    if current.get('status') == 'waiting':
                        self._open_login(current)
                    elif current.get('status') != 'starting':
                        self.client.post('/api/account/login')
                        self.opened_login = None
                    self.login_owned = True
                    self.wake.set()
            elif name == 'cancel_login':
                with self.lock:
                    self.client.post('/api/account/login/cancel')
                    self.login_owned = False
                    self.opened_login = None
                self.wake.set()
            elif name == 'refresh':
                self.client.post('/api/account/refresh')
                self.wake.set()
            elif name == 'acknowledge':
                if not isinstance(value, str) or len(value) > 128:
                    raise ValueError('无效提醒')
                self.client.post('/api/account/acknowledge?' + urlencode({'id': value}))
                self.wake.set()
            elif name in ('theme', 'notifications'):
                if name == 'theme' and value not in ('system', 'light', 'dark') or name == 'notifications' and type(value) is not bool:
                    raise ValueError('无效偏好设置')
                with self.lock:
                    old = dict(self.preferences)
                    self.preferences[name] = value
                    try:
                        self._save()
                    except OSError:
                        self.preferences = old
                        raise
            elif name == 'test_notification':
                if not self._notify('消息提醒已准备好。低额度与消耗风险会在这里通知你。'):
                    raise ValueError('请先开启系统通知，并确认托盘可用。')
            elif name == 'hide':
                if not self.tray:
                    raise ValueError('托盘不可用，请最小化窗口以继续追踪。')
                self.window.hide()
            elif name == 'quit':
                self.quit()
            else:
                raise ValueError('不支持的操作')
            return {'ok': True}
        except (OSError, ValueError, KeyError):
            # Never expose an HTTP exception containing an authorization URL/token.
            return {'ok': False, 'error': '操作未完成，请检查后台连接或浏览器后重试。'}
        finally:
            self.operation_lock.release()

    def show(self):
        if self.window:
            self.window.show()
            self.window.restore()

    def closing(self):
        if not self.quitting and self.tray:
            self.window.hide()
            return False
        return True

    def quit(self):
        self.quitting = True
        self.stop.set()
        self.wake.set()
        if self.window:
            self.window.destroy()

    def close(self):
        self.stop.set()
        self.wake.set()
        if self.thread:
            self.thread.join(timeout=6)
        if self.tray:
            self.tray.stop()


class CompanionBridge:
    """Only these two methods are exposed to the bundled GUI."""
    def __init__(self, controller):
        self._controller = controller

    def status(self):
        return self._controller.status()

    def action(self, name, value=None):
        return self._controller.action(name, value)


def companion_html():
    root = Path(__file__).parent
    assets = root / 'desktop_assets'
    return ((assets / 'companion.html').read_text(encoding='utf-8')
            .replace('/* SHARED_STYLE */', (root / 'static/style.css').read_text(encoding='utf-8'))
            .replace('/* COMPANION_STYLE */', (assets / 'companion.css').read_text(encoding='utf-8'))
            .replace('/* COMPANION_SCRIPT */', (assets / 'companion.js').read_text(encoding='utf-8')))

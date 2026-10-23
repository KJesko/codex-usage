"""Optional display identity, fetched separately from quota collection."""
import threading
import time
import json
import re
import os
import base64
import hashlib
from pathlib import Path
from .account import AccountError, AccountRPC, initialize


PROFILE_REQUEST_TIMEOUT = 30


def display_profile(result):
    account = result.get('account')
    if not isinstance(account, dict) or account.get('type') != 'chatgpt':
        return None
    def text(key):
        value = account.get(key)
        return value.strip()[:200] if isinstance(value, str) else ''
    email = text('email')
    local, separator, domain = email.partition('@')
    masked_email = (local[:min(2, max(0, len(local)-1))] + '***@' + domain
                    if separator and local and domain and '@' not in domain else '')
    label = masked_email
    if not label:
        return None
    return {'label': label}


def local_login_profile(path=None):
    """Display-only claims from Codex's saved login, never authentication or quota authority."""
    path = path or Path(os.environ.get('CODEX_HOME') or Path.home()/'.codex')/'auth.json'
    try:
        if path.stat().st_size > 1024*1024:
            return None
        saved = json.loads(path.read_text(encoding='utf-8'))
        tokens = saved.get('tokens') or {}
        token = tokens.get('id_token')
        if not isinstance(token, str):
            return None
        payload = token.split('.')[1]
        claims = json.loads(base64.urlsafe_b64decode(payload+'='*(-len(payload)%4)))
        auth = claims.get('https://api.openai.com/auth') or {}
        identity = tokens.get('account_id') or auth.get('chatgpt_account_id')
        value = display_profile({'account': {'type':'chatgpt', 'email':claims.get('email')}})
        if not value or not isinstance(identity,str) or not identity:
            return None
        return hashlib.sha256(('quota-account:'+identity).encode()).hexdigest(), value
    except (OSError, ValueError, TypeError, IndexError, AttributeError):
        return None


class AccountProfile:
    def __init__(self, factory=None, path=None):
        self.factory = factory or (lambda: AccountRPC(timeout=PROFILE_REQUEST_TIMEOUT))
        self.lock = threading.Lock()
        self.value = None
        self.attempt = None
        self.thread = None
        self.generation = 0
        self.closed = False
        self.problem = None
        self.path = path
        self.identity = None

    def bind(self, identity):
        with self.lock:
            if identity == self.identity:
                return
            self.identity = identity
            self.value, self.attempt, self.problem = None, None, None
            self.generation += 1
            if not self.path or not identity:
                return
            try:
                saved = json.loads(self.path.read_text(encoding='utf-8'))
                label = saved.get('label')
                if saved.get('account_key') == identity and isinstance(label, str) and re.fullmatch(r'[^@\s]{0,2}\*\*\*@[^@\s]+', label):
                    self.value, self.attempt = {'label': label}, 0
            except (OSError, ValueError, AttributeError):
                pass

    def from_local_login(self):
        saved = local_login_profile()
        if not saved:
            return
        identity, value = saved
        self.bind(identity)
        with self.lock:
            self.generation += 1
            self.value, self.attempt, self.problem = value, 0, None
            if self.path:
                try:
                    temporary = self.path.with_suffix('.tmp')
                    temporary.write_text(json.dumps({'account_key':identity, **value}),encoding='utf-8')
                    temporary.replace(self.path)
                except OSError:
                    pass

    def invalidate(self):
        with self.lock:
            self.value, self.attempt = None, None
            self.problem = None
            self.generation += 1
            if self.path:
                try:
                    self.path.unlink(missing_ok=True)
                except OSError:
                    pass

    def retry(self):
        with self.lock:
            if self.value is None and not (self.thread and self.thread.is_alive()):
                self.attempt = None

    def status(self, start=True):
        with self.lock:
            if (start and not self.closed and not (self.thread and self.thread.is_alive())
                    and self.attempt is None):
                self.attempt = time.monotonic()
                self.thread = threading.Thread(target=self._read, args=(self.generation,), daemon=True)
                self.thread.start()
            return dict(self.value) if self.value else None

    def diagnostics(self):
        with self.lock:
            return {'busy': bool(self.thread and self.thread.is_alive()),
                    'problem': dict(self.problem) if self.problem else None,
                    'request_timeout_seconds': PROFILE_REQUEST_TIMEOUT,
                    'mode': 'once_per_login', 'cached': bool(self.value)}

    def _read(self, generation):
        rpc, value, problem = None, None, None
        try:
            rpc = self.factory()
            initialize(rpc)
            value = display_profile(rpc.call('account/read', {'refreshToken': False}))
        except Exception as exc:
            # Only sanitized application errors may cross the HTTP boundary.
            error = exc if isinstance(exc, AccountError) else AccountError(
                'unavailable', '账号资料暂时不可用；可手动重连，不影响额度采集。', 'account/read')
            problem = {'kind': error.kind, 'message': str(error), 'stage': error.stage}
            if error.kind in ('routing_timeout', 'timeout', 'offline', 'connection_lost'):
                problem['message'] = '账号邮箱读取失败；可手动重连，不影响额度和重置卡采集。'
        finally:
            if rpc:
                rpc.close()
            with self.lock:
                if not self.closed and generation == self.generation:
                    self.value = value
                    self.problem = problem
                    if value and self.path and self.identity:
                        try:
                            temporary = self.path.with_suffix('.tmp')
                            temporary.write_text(json.dumps({'account_key': self.identity, **value}), encoding='utf-8')
                            temporary.replace(self.path)
                        except OSError:
                            pass  # An optional display cache must not gate collection.

    def close(self):
        with self.lock:
            self.closed = True
            self.value = None

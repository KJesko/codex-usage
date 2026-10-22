"""Optional display identity, fetched separately from quota collection."""
import threading
import time
from .account import AccountRPC, initialize


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


class AccountProfile:
    def __init__(self, factory=None):
        self.factory = factory or (lambda: AccountRPC(timeout=5))
        self.lock = threading.Lock()
        self.value = None
        self.attempt = None
        self.thread = None
        self.generation = 0
        self.closed = False

    def invalidate(self):
        with self.lock:
            self.value, self.attempt = None, None
            self.generation += 1

    def status(self):
        with self.lock:
            if (not self.closed and not (self.thread and self.thread.is_alive())
                    and (self.attempt is None or time.monotonic()-self.attempt >= 300)):
                self.attempt = time.monotonic()
                self.thread = threading.Thread(target=self._read, args=(self.generation,), daemon=True)
                self.thread.start()
            return dict(self.value) if self.value else None

    def _read(self, generation):
        rpc, value = None, None
        try:
            rpc = self.factory()
            initialize(rpc)
            value = display_profile(rpc.call('account/read', {'refreshToken': False}))
        except Exception:
            pass  # Display metadata must never affect quota availability.
        finally:
            if rpc:
                rpc.close()
            with self.lock:
                if not self.closed and generation == self.generation:
                    self.value = value

    def close(self):
        with self.lock:
            self.closed = True
            self.value = None

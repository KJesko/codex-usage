"""Explicit, user-started official browser login; credentials remain with Codex."""
import queue
import threading
import time
from urllib.parse import urlsplit
from .account import AccountRPC, initialize


def checked_url(value):
    if not isinstance(value, str):
        raise ValueError('Invalid authorization URL')
    parsed = urlsplit(value)
    if (parsed.scheme != 'https' or parsed.hostname != 'auth.openai.com'
            or parsed.username or parsed.password or parsed.port not in (None,443)):
        raise ValueError('Invalid authorization URL')
    return value


class BrowserLogin:
    def __init__(self, completed, factory=AccountRPC):
        self.completed, self.factory = completed, factory
        self.lock = threading.Lock()
        self.stop = threading.Event()
        self.thread = None
        self.state = {'status':'idle'}

    def status(self):
        with self.lock:
            return dict(self.state)

    def start(self):
        with self.lock:
            if self.thread and self.thread.is_alive():
                return
            self.stop.clear()
            self.state = {'status':'starting'}
            self.thread = threading.Thread(target=self.run,daemon=True,name='browser-login')
            self.thread.start()

    def cancel(self):
        with self.lock:
            self.stop.set()
            self.state = {'status':'cancelled'}

    def run(self):
        rpc = None
        login_id = None
        try:
            rpc = self.factory()
            initialize(rpc)
            result = rpc.call('account/login/start', {'type':'chatgpt'})
            login_id = result.get('loginId')
            url = checked_url(result.get('authUrl'))
            if not isinstance(login_id,str) or not login_id:
                raise ValueError('Missing login id')
            with self.lock:
                if not self.stop.is_set():
                    self.state = {'status':'waiting','url':url}
            deadline = time.monotonic()+300
            while not self.stop.is_set() and time.monotonic()<deadline:
                try:
                    message = rpc.notifications.get(timeout=.5)
                except queue.Empty:
                    if rpc.process.poll() is not None:
                        raise ValueError('Login process exited')
                    continue
                params = message.get('params',{})
                if params.get('loginId') != login_id:
                    continue
                if params.get('success') is not True:
                    raise ValueError('Login failed')
                if self.stop.is_set():
                    return
                self.completed()
                with self.lock:
                    self.state = {'status':'success'}
                return
            if not self.stop.is_set():
                with self.lock:
                    self.state = {'status':'expired'}
        except Exception:
            with self.lock:
                if not self.stop.is_set():
                    self.state = {'status':'failed'}
        finally:
            if rpc:
                if login_id and self.status()['status'] != 'success':
                    try:
                        rpc.send({'id':99999,'method':'account/login/cancel','params':{'loginId':login_id}})
                    except Exception:
                        pass
                rpc.close()

    def close(self):
        self.cancel()

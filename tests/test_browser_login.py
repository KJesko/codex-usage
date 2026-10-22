import queue
import sys
import threading
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src'))
from codex_usage.browser_login import BrowserLogin, checked_url


class FakeRPC:
    def __init__(self, success=True, url='https://auth.openai.com/oauth/authorize?state=test'):
        self.notifications=queue.Queue()
        self.calls=[]
        self.closed=False
        self.process=self
        self.url=url
        if success is not None:
            self.notifications.put({'params':{'loginId':'unrelated','success':True}})
            self.notifications.put({'params':{'loginId':'test','success':success}})
    def call(self, method, params):
        self.calls.append(method)
        return {'loginId':'test','authUrl':self.url} if method=='account/login/start' else {}
    def send(self,row):self.calls.append(row['method'])
    def poll(self):return None
    def close(self):self.closed=True


class BrowserLoginTests(unittest.TestCase):
    def test_success_refreshes_and_discards_authorization_url(self):
        rpc=FakeRPC(); completed=[]
        login=BrowserLogin(lambda:completed.append(True),lambda:rpc)
        login.start();login.thread.join(2)
        self.assertEqual(login.status(),{'status':'success'})
        self.assertEqual(completed,[True]);self.assertTrue(rpc.closed)
        self.assertNotIn('account/logout',rpc.calls)

    def test_failure_and_untrusted_url_never_refresh(self):
        for rpc in (FakeRPC(False),FakeRPC(url='https://evil.test/authorize')):
            completed=[];login=BrowserLogin(lambda:completed.append(True),lambda:rpc)
            login.start();login.thread.join(2)
            self.assertEqual(login.status(),{'status':'failed'})
            self.assertEqual(completed,[]);self.assertTrue(rpc.closed)

    def test_cancel_clears_url_and_cancels_only_pending_login(self):
        rpc=FakeRPC(None); ready=threading.Event()
        def factory():ready.set();return rpc
        completed=[];login=BrowserLogin(lambda:completed.append(True),factory)
        login.start();ready.wait(2);login.cancel();login.thread.join(2)
        self.assertEqual(login.status(),{'status':'cancelled'})
        self.assertIn('account/login/cancel',rpc.calls)
        self.assertNotIn('account/logout',rpc.calls)
        self.assertEqual(completed,[])

    def test_authorization_url_restrictions(self):
        for url in ('http://auth.openai.com/a','https://auth.openai.com.evil.test/a',
                    'https://name@auth.openai.com/a','https://auth.openai.com:123/a',None):
            with self.assertRaises(ValueError):checked_url(url)

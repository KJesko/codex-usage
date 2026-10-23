import sys
import tempfile
import json
import threading
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from urllib.request import Request, urlopen
from urllib.error import HTTPError

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from codex_usage.account_profile import AccountProfile, display_profile, local_login_profile
from codex_usage.account import AccountError
from codex_usage.source_picker import browse_directory
from codex_usage.app import Application, make_server, validate_settings


class ProfilePickerTests(unittest.TestCase):
    def test_profile_allowlist_and_fallback(self):
        self.assertEqual(display_profile({'account':{'type':'chatgpt','email':'alice@example.com','token':'secret'}}),
                         {'label':'al***@example.com'})
        self.assertIsNone(display_profile({'account':{'type':'chatgpt','name':'Bo Li'}}))
        self.assertIsNone(display_profile({'account':{'type':'apiKey'}}))
        self.assertIsNone(display_profile({'account':None}))

    def test_local_login_identity_is_masked_and_requires_account_binding(self):
        import base64
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'auth.json'
            payload=base64.urlsafe_b64encode(json.dumps({'email':'alice@example.com',
                'https://api.openai.com/auth':{'chatgpt_account_id':'account-a'}}).encode()).decode().rstrip('=')
            path.write_text(json.dumps({'tokens':{'id_token':'header.'+payload+'.signature'}}))
            identity, value=local_login_profile(path)
            self.assertEqual(len(identity),64)
            self.assertEqual(value,{'label':'al***@example.com'})
            path.write_text('{}');self.assertIsNone(local_login_profile(path))
            path.write_text('broken');self.assertIsNone(local_login_profile(path))

    def test_local_login_profile_avoids_network_and_survives_binding(self):
        profile=AccountProfile(Mock())
        with patch('codex_usage.account_profile.local_login_profile',return_value=('account',{'label':'al***@example.com'})):
            profile.from_local_login()
        profile.bind('account')
        self.assertEqual(profile.status(),{'label':'al***@example.com'})
        profile.factory.assert_not_called()
        profile.bind('other');self.assertIsNone(profile.status(start=False))

    def test_custom_avatar_accepts_chinese_surname(self):
        with tempfile.TemporaryDirectory() as folder:
            for initials in ['张', '欧阳', 'ZH']:
                self.assertEqual(validate_settings({'sources':[folder], 'avatar_initials':initials})['avatar_initials'], initials)
            for initials in ['a@b', '<x>', '张三四五']:
                with self.assertRaises(ValueError):
                    validate_settings({'sources':[folder], 'avatar_initials':initials})

    def test_profile_masks_email_even_with_name_and_short_usernames(self):
        for email, expected in [('alice@example.com','al***@example.com'),
                                ('ab@example.com','a***@example.com'),
                                ('a@example.com','***@example.com')]:
            profile=display_profile({'account':{'type':'chatgpt','name':'Bo Li','email':email}})
            self.assertEqual(profile, {'label':expected})
            self.assertNotIn(email, str(profile))

    def test_profile_timeout_is_optional_and_old_login_result_is_discarded(self):
        rpc=Mock()
        rpc.call.side_effect=[{}, {'account':{'type':'chatgpt','email':'alice@example.com'}}]
        profile=AccountProfile(lambda:rpc)
        profile.invalidate()
        profile._read(0)
        self.assertIsNone(profile.value)
        rpc.close.assert_called_once()
        rpc.call.side_effect=TimeoutError()
        profile._read(1)
        self.assertIsNone(profile.value)
        profile.close()
        self.assertIsNone(profile.status())

    def test_profile_reads_once_and_manual_retry_is_explicit(self):
        rpc = Mock()
        rpc.call.side_effect = [{}, AccountError('routing_timeout', 'route', 'account/read')]
        profile = AccountProfile(lambda: rpc)
        profile.status(); profile.thread.join(2)
        self.assertIsNotNone(profile.diagnostics()['problem'])
        with patch('codex_usage.account_profile.time.monotonic', return_value=10**12):
            profile.status()
        self.assertEqual(rpc.call.call_count, 2)
        rpc.call.side_effect = [{}, {'account': {'type': 'chatgpt', 'email': 'alice@example.com'}}]
        profile.retry(); profile.status(); profile.thread.join(2)
        self.assertEqual(profile.value, {'label': 'al***@example.com'})
        profile.retry(); profile.status()
        self.assertEqual(rpc.call.call_count, 4)
        profile.close()

    def test_masked_profile_cache_survives_restart_and_is_account_scoped(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'profile.json'
            rpc=Mock(); rpc.call.side_effect=[{}, {'account':{'type':'chatgpt','email':'alice@example.com'}}]
            profile=AccountProfile(lambda:rpc,path=path)
            profile.bind('a'*64); profile.status(); profile.thread.join(2)
            self.assertNotIn('alice@example.com',path.read_text())
            fresh=AccountProfile(Mock(),path=path); fresh.bind('a'*64)
            self.assertEqual(fresh.status(), {'label':'al***@example.com'})
            fresh.factory.assert_not_called()
            fresh.bind('b'*64)
            self.assertIsNone(fresh.status(start=False))
            fresh.bind('a'*64); fresh.invalidate()
            self.assertIsNone(fresh.status(start=False)); self.assertFalse(path.exists())
            profile.close(); fresh.close()

    def test_profile_diagnostics_do_not_expose_raw_errors_or_old_login_failures(self):
        rpc = Mock()
        rpc.call.side_effect = RuntimeError('https://private.example/?token=secret')
        profile = AccountProfile(lambda: rpc)
        profile._read(0)
        self.assertEqual(profile.diagnostics()['problem']['kind'], 'unavailable')
        self.assertNotIn('secret', json.dumps(profile.diagnostics()))
        profile.invalidate()
        profile._read(0)
        self.assertIsNone(profile.diagnostics()['problem'])
        profile.close()

    def test_directory_picker_lists_directories_only_and_handles_invalid_paths(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            (root/'.codex').mkdir()
            (root/'with spaces').mkdir()
            (root/'private.txt').write_text('never returned')
            result=browse_directory(str(root))
            self.assertEqual([d['name'] for d in result['folders']], ['.codex','with spaces'])
            self.assertEqual(result['path'],str(root.resolve()))
            self.assertNotIn('never returned',str(result))
            for path in ('relative',str(root/'missing'),str(root/'private.txt')):
                with self.assertRaises(ValueError):browse_directory(path)

    def test_picker_requires_csrf_and_does_not_save_selection(self):
        with tempfile.TemporaryDirectory() as folder:
            app=Application(Path(folder)/'data', roots=[folder])
            server=make_server(app, 0)
            thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            url=f'http://127.0.0.1:{server.server_port}/api/setup/browse'
            payload=json.dumps({'path':folder}).encode()
            try:
                with self.assertRaises(HTTPError) as error:urlopen(Request(url,data=payload))
                self.assertEqual(error.exception.code,403)
                with urlopen(Request(url,data=payload,headers={'X-CSRF-Token':app.csrf,'Content-Type':'application/json'})) as response:
                    self.assertEqual(json.load(response)['path'],str(Path(folder).resolve()))
                self.assertFalse(app.config_path.exists())
                self.assertNotIn('avatar_auto', validate_settings({'sources':[folder],'avatar_auto':True}))
                base=f'http://127.0.0.1:{server.server_port}'
                with urlopen(base+'/api/settings') as response: initial=json.load(response)
                self.assertTrue(initial['setup']['first_run'])
                self.assertEqual(initial['setup']['port'],server.server_port)
                initial['timezone']='UTC'
                with urlopen(Request(base+'/api/settings',data=json.dumps(initial).encode(),
                                    headers={'X-CSRF-Token':app.csrf,'Content-Type':'application/json'})): pass
                with urlopen(base+'/api/settings') as response: saved=json.load(response)
                self.assertFalse(saved['setup']['first_run'])
                self.assertEqual(saved['timezone'],'UTC')
                self.assertNotIn('setup',json.loads(app.config_path.read_text()))
            finally:
                server.shutdown();server.server_close();app.stop_collecting();thread.join()

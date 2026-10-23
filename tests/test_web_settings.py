import json
import sys
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from codex_usage.app import Application, make_server


class WebSettingsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.app = Application(self.root / 'app', [self.root / 'logs'], 'UTC')

    def tearDown(self):
        self.app.stop_collecting()
        self.temp.cleanup()

    def test_concurrent_partial_saves_preserve_unrelated_fields(self):
        with ThreadPoolExecutor(max_workers=2) as pool:
            list(pool.map(self.app.patch_settings, [{'avatar_initials': 'AB'}, {'timezone': 'Asia/Shanghai'}]))
        config = json.loads(self.app.config_path.read_text(encoding='utf-8'))
        self.assertEqual(config['avatar_initials'], 'AB')
        self.assertEqual(config['timezone'], 'Asia/Shanghai')
        self.assertEqual(config['sources'], self.app.config['sources'])

    def test_invalid_patch_is_atomic_and_avatar_does_not_rebuild_log_index(self):
        self.app.save(self.app.config)
        before = self.app.config_path.read_bytes()
        original = self.app.index
        for value in ({'avatar_initials': '!'}, {'sources': []}, {'csrf': 'bad'}, {}, []):
            with self.assertRaises(ValueError):
                self.app.patch_settings(value)
            self.assertEqual(self.app.config_path.read_bytes(), before)
        self.app.patch_settings({'avatar_initials': 'OK'})
        self.assertIs(self.app.index, original)
        self.app.patch_settings({'sources': [str(self.root / 'other')]})
        self.assertIsNot(self.app.index, original)

    def test_status_is_cached_and_never_triggers_scans_or_network(self):
        self.app.collection['last_scan'] = '2026-10-24T00:00:00+00:00'
        with patch.object(self.app.index, 'snapshot', side_effect=AssertionError('unexpected scan')), patch.object(self.app.remote_sync, 'request', side_effect=AssertionError('unexpected SSH')), patch.object(self.app.price_sync, 'start', side_effect=AssertionError('unexpected pricing')):
            for _ in range(1000):
                status = self.app.update_status()
                self.assertEqual(status['local']['last_scan'], self.app.collection['last_scan'])
                self.assertEqual(set(status), {'local', 'remotes', 'prices'})

    def test_web_patch_endpoint_csrf_validation_and_status_assets(self):
        server = make_server(self.app, 0)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f'http://127.0.0.1:{server.server_port}'
        try:
            for payload, headers, expected in [({'avatar_initials': 'AB'}, {}, 403), ({'sources': []}, {'X-CSRF-Token': self.app.csrf}, 400)]:
                with self.assertRaises(HTTPError) as error:
                    urlopen(Request(base + '/api/settings/patch', data=json.dumps(payload).encode(), headers=headers))
                self.assertEqual(error.exception.code, expected)
            with urlopen(Request(base + '/api/settings/patch', data=b'{"avatar_initials":"AB"}', headers={'X-CSRF-Token': self.app.csrf})) as response:
                result = json.load(response)
                self.assertEqual(result['avatar_initials'], 'AB')
                self.assertEqual(result['timezone'], 'UTC')
            with urlopen(base + '/api/status') as response:
                self.assertEqual(set(json.load(response)), {'local', 'remotes', 'prices'})
            for asset in ['web-state.js', 'web-feedback.js', 'themed-select.js']:
                with urlopen(base + '/' + asset) as response:
                    self.assertEqual(response.headers.get_content_type(), 'text/javascript')
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from codex_usage.background_config import describe, load_launch, save_launch, server_command
from codex_usage import web_background as bg


class LaunchProfileTests(unittest.TestCase):
    def test_custom_profile_round_trip_and_independent_identity(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / 'data with spaces 数据'
            with patch.dict(os.environ, {'CODEX_HOME': str(Path(temp) / 'logs'),
                                         'CODEX_USAGE_CLI': str(Path(temp) / 'codex.exe'),
                                         'HTTPS_PROXY': 'https://secret@example.com'}):
                saved = save_launch(root, 18789)
            self.assertEqual(load_launch(root), saved)
            self.assertEqual(set(saved['environment']), {'CODEX_HOME', 'CODEX_USAGE_CLI'})
            self.assertNotIn('secret', json.dumps(saved))
            self.assertNotEqual(describe(root)['task_name'], describe(root.parent)['task_name'])
            self.assertEqual(describe(root)['task_name'], describe(root / '.')['task_name'])
            args = server_command('python', '/project', saved)
            self.assertEqual(args[-4:], ['--port', '18789', '--data-dir', str(root.resolve())])

    def test_legacy_defaults_and_malformed_profile(self):
        with tempfile.TemporaryDirectory() as temp:
            self.assertEqual(load_launch(temp)['port'], 8787)
            for value in (True, 0, 65536, '8787'):
                with self.assertRaises(ValueError): save_launch(temp, value)
            profile = save_launch(temp, 8799)
            profile['environment'] = {'SECRET': 'value'}
            (Path(temp) / 'web-service/launch.json').write_text(json.dumps(profile))
            with self.assertRaises(ValueError): load_launch(temp)

    def test_custom_service_control_and_status_use_same_directory(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            save_launch(root, 8799)
            (root / 'web-service/status.json').write_text(json.dumps({'phase': 'waiting_server', 'heartbeat': 1, 'running': True}))
            with patch.object(bg, 'supported', return_value=True), patch.object(bg, 'run_task', return_value='{"enabled":true}') as run:
                result = bg.configure(True, data_dir=root, port=8799)
                self.assertEqual(run.call_args_list[0].args, ('-DataDir', str(root), '-Port', '8799'))
                self.assertTrue(result['configuration_matches'])
                self.assertFalse(result['supervisor_running'])
                self.assertEqual(result['phase'], 'waiting_server')
                self.assertFalse(bg.status(force=True, data_dir=root, port=8800)['configuration_matches'])

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src'))
from codex_usage.setup_check import check_sources

class SetupCheckTests(unittest.TestCase):
    def test_roots_and_child_hint_without_changing_files(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            self.assertEqual(check_sources([folder])[0]['status'],'no_logs')
            (root/'sessions').mkdir()
            (root/'auth.json').write_text('DO NOT READ')
            self.assertEqual(check_sources([folder])[0]['status'],'ready')
            row=check_sources([str(root/'sessions')])[0]
            self.assertEqual((row['status'],row['suggested']),('child',folder))
            self.assertEqual(check_sources([str(root/'auth.json')])[0]['status'],'file')
            self.assertEqual(check_sources([str(root/'missing')])[0]['status'],'missing')
            self.assertEqual((root/'auth.json').read_text(),'DO NOT READ')

    def test_invalid_and_permission_denied(self):
        for roots in ([],None,['relative'],[None],['x']*21):
            with self.assertRaises(ValueError):check_sources(roots)
        with patch('codex_usage.setup_check.os.scandir',side_effect=PermissionError):
            self.assertEqual(check_sources([str(Path.cwd())])[0]['status'],'unreadable')

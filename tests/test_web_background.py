import sys
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/"src"))
from codex_usage import web_background as bg

class BackgroundTests(unittest.TestCase):
    def test_invalid_toggle_never_runs_command(self):
        for value in ["true", 1, None, {}]:
            with self.subTest(value=value), patch.object(bg, "run_task") as run:
                with self.assertRaises(ValueError): bg.configure(value)
                run.assert_not_called()

    def test_disable_preserves_current_server(self):
        with patch.object(bg, "supported", return_value=True), patch.object(bg, "run_task") as run, patch.object(bg, "status", return_value={}) as status:
            bg.configure(False)
            run.assert_called_once_with("-Disable", "-KeepServer")
            status.assert_called_once_with(force=True)

    def test_stale_heartbeat_not_reported_running(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(bg, "STATE", Path(temp)), patch.object(bg, "supported", return_value=True), patch.object(bg, "run_task", return_value='{"enabled":true}'):
            (Path(temp)/"status.json").write_text('{"running":true,"heartbeat":1,"last_restart":42}')
            result=bg.status(force=True)
            self.assertFalse(result["supervisor_running"])
            self.assertEqual(result["last_restart"],42)

    def test_scheduler_failure_is_unknown_not_disabled(self):
        with patch.object(bg, "supported", return_value=True), patch.object(bg, "run_task", side_effect=OSError()):
            result=bg.status(force=True)
            self.assertIsNone(result["enabled"])
            self.assertIn("error",result)

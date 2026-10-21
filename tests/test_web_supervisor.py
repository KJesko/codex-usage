"""Windows source-web background recovery safeguards."""
import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

@unittest.skipUnless(sys.platform == "win32", "Windows background service")
class WebSupervisorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location("web_supervisor", Path(__file__).resolve().parents[1]/"scripts"/"web_supervisor.py")
        cls.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.module)

    def test_crash_loop_backoff_is_bounded(self):
        self.assertEqual([self.module.retry_delay(n) for n in [1,2,3,4,5,100]], [5,10,20,40,60,60])

    def test_stop_only_terminates_owned_running_child_tree(self):
        child = Mock(pid=1234)
        child.poll.return_value = None
        with patch.object(self.module.subprocess, "run") as run:
            self.module.stop_child(child)
        self.assertEqual(run.call_args.args[0], ["taskkill","/PID","1234","/T","/F"])
        child.wait.assert_called_once_with(timeout=10)

    def test_exited_child_is_not_killed_by_reused_pid(self):
        child = Mock(pid=1234)
        child.poll.return_value = 1
        with patch.object(self.module.subprocess, "run") as run:
            self.module.stop_child(child)
        run.assert_not_called()

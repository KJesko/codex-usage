import json
from pathlib import Path
import socket
import sys
import tempfile
import unittest
from urllib.request import urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from codex_usage.app import Application
from codex_usage.desktop import DesktopServer, WindowsInstance, self_test


class DesktopTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "empty-codex").mkdir()
        self.app = Application(self.root / "settings", [self.root / "empty-codex"], "Asia/Shanghai")

    def test_occupied_port_fallback_and_shutdown(self):
        occupied = socket.socket()
        occupied.bind(("127.0.0.1", 0))
        occupied.listen()
        self.addCleanup(occupied.close)
        port = occupied.getsockname()[1]
        with DesktopServer(self.app, port) as desktop:
            self.assertNotEqual(desktop.server.server_port, port)
            with urlopen(desktop.url + "/api/health", timeout=2) as response:
                self.assertEqual(json.load(response)["app"], "codex-usage")
            assigned = desktop.server.server_port
        self.assertFalse(desktop.thread.is_alive())
        with socket.socket() as probe:
            self.assertNotEqual(probe.connect_ex(("127.0.0.1", assigned)), 0)

    def test_packaged_checks_and_settings_survive(self):
        self.app.save(self.app.config)
        output = self.root / "result.json"
        self_test(self.app, output)
        result = json.loads(output.read_text(encoding="utf-8"))
        self.assertTrue(result["ok"])
        self.assertTrue(result["exports"])
        self.assertEqual(result["total_tokens"], 0)
        restarted = Application(self.app.data_dir)
        self.assertEqual(restarted.config["timezone"], "Asia/Shanghai")
        self.assertEqual(restarted.config["sources"], self.app.config["sources"])

    @unittest.skipUnless(sys.platform == "win32", "Windows named mutex")
    def test_single_instance_lock_is_released(self):
        first = WindowsInstance(self.root)
        self.addCleanup(first.close)
        second = WindowsInstance(self.root)
        self.addCleanup(second.close)
        self.assertFalse(first.already_running)
        self.assertTrue(second.already_running)
        second.close()
        first.close()
        third = WindowsInstance(self.root)
        self.addCleanup(third.close)
        self.assertFalse(third.already_running)


if __name__ == "__main__":
    unittest.main()

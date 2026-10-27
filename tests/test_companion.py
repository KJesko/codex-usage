"""Desktop tests use fake auth/browser/notification boundaries; no user sign-in."""
from datetime import datetime, timezone
import json
from pathlib import Path
import socket
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from codex_usage.app import Application
from codex_usage.companion import CompanionBridge, CompanionController, CompanionService, LocalClient, companion_html, tracking_state
from codex_usage.desktop import DesktopServer


def account(**changes):
    return {'fetched_at': datetime.now(timezone.utc).isoformat(), 'collector': {'running': True, 'interval_seconds': 60},
            'problem': None, 'alerts': [], 'windows': [], **changes}


class CompanionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.client = Mock(url='http://127.0.0.1:8787')
        self.client.get.return_value = account()
        self.service = SimpleNamespace(data_dir=self.root, client=self.client, owned=False)
        self.browser = Mock(return_value=True)
        self.controller = CompanionController(self.service, self.browser)

    def test_tracking_requires_recent_read_running_collector_and_saved_history(self):
        self.assertEqual(tracking_state(account()), 'tracking')
        for changes, expected in [({'signed_out': True}, 'signed_out'),
                ({'problem': {'kind': 'signed_out'}}, 'signed_out'),
                ({'problem': {'kind': 'timeout'}}, 'error'),
                ({'fetched_at': None, 'busy': True}, 'connecting'),
                ({'fetched_at': None}, 'waiting'), ({'fetched_at': 'invalid'}, 'stale'),
                ({'fetched_at': '2020-01-01T00:00:00Z'}, 'stale'), ({'stale': True}, 'stale'),
                ({'collector': {'running': False}}, 'paused'),
                ({'history_problem': 'Cannot write history'}, 'history_error')]:
            with self.subTest(expected=expected):
                self.assertEqual(tracking_state(account(**changes)), expected)

    def test_login_opens_only_official_browser_once_and_never_exposes_url(self):
        self.assertTrue(self.controller.action('login')['ok'])
        self.client.post.assert_called_once_with('/api/account/login')
        url = 'https://auth.openai.com/authorize?code_challenge=synthetic-test'
        self.client.get.return_value = account(browser_login={'status': 'waiting', 'url': url})
        self.controller.poll(); self.controller.poll()
        self.browser.assert_called_once_with(url)
        self.assertNotIn(url, json.dumps(self.controller.status()))
        self.client.get.return_value = account(browser_login={'status': 'success'})
        self.controller.poll()
        self.assertFalse(self.controller.login_owned)
        self.assertEqual(self.controller.status()['state'], 'tracking')

    def test_untrusted_login_url_and_external_actions_are_rejected(self):
        for url in ('http://auth.openai.com/x', 'https://evil.test/', 'https://auth.openai.com@evil.test/',
                    'https://user@auth.openai.com/x', 'https://auth.openai.com:8443/x'):
            self.client.get.return_value = account(browser_login={'status': 'waiting', 'url': url})
            self.assertFalse(self.controller.action('login')['ok'])
        self.browser.assert_not_called()
        self.assertFalse(self.controller.action('run', 'calc.exe')['ok'])
        self.controller.action('dashboard', 'https://evil.test')
        self.browser.assert_called_once_with('http://127.0.0.1:8787/?view=overview')

    def test_does_not_open_other_clients_pending_authorization(self):
        self.client.get.return_value = account(browser_login={'status': 'waiting', 'url': 'https://auth.openai.com/x'})
        self.controller.poll()
        self.browser.assert_not_called()
        self.controller.action('cancel_login')
        self.client.post.assert_called_once_with('/api/account/login/cancel')

    def test_notifications_are_bounded_persistent_and_not_acknowledged_automatically(self):
        tray = self.controller.tray = Mock()
        alerts = [{'id': str(i), 'message': 'Low quota', 'active': True, 'acknowledged': False} for i in range(50)]
        self.client.get.return_value = account(alerts=alerts)
        self.controller.poll(); self.controller.poll()
        tray.notify.assert_called_once()
        self.client.post.assert_not_called()
        restarted = CompanionController(self.service, self.browser)
        restarted.tray = tray
        restarted.poll()
        tray.notify.assert_called_once()
        self.assertEqual(len(restarted.seen), 50)
        self.assertTrue(restarted.action('acknowledge', '0')['ok'])
        self.client.post.assert_called_once_with('/api/account/acknowledge?id=0')

    def test_muted_or_inactive_alerts_do_not_notify_and_preferences_survive(self):
        self.controller.tray = Mock()
        self.controller.action('notifications', False)
        self.client.get.return_value = account(alerts=[{'id': 'a', 'message': 'Low quota', 'active': True}])
        self.controller.poll()
        self.controller.tray.notify.assert_not_called()
        self.assertFalse(CompanionController(self.service).preferences['notifications'])
        self.controller.action('notifications', True)
        self.client.get.return_value['alerts'][0]['active'] = False
        self.controller.poll()
        self.controller.tray.notify.assert_not_called()

    def test_service_failure_keeps_old_snapshot_but_never_claims_live_tracking(self):
        self.controller.tray = Mock()
        self.controller.poll()
        self.client.get.side_effect = OSError('offline')
        for _ in range(10): self.controller.poll()
        self.assertEqual(self.controller.status()['state'], 'offline')
        self.assertFalse(self.controller.status()['connected'])
        self.assertTrue(self.controller.status()['account']['fetched_at'])
        self.controller.tray.notify.assert_called_once()
        self.client.get.side_effect = None
        self.controller.poll()
        self.assertEqual(self.controller.status()['state'], 'tracking')

    def test_notification_storage_failure_does_not_hide_successful_collection(self):
        self.controller.tray = Mock()
        self.client.get.return_value = account(alerts=[{'id':'a', 'message':'Low quota', 'active':True}],
                                               pace={'samples': [1] * 10000}, cycles=[1] * 10000)
        with patch.object(self.controller, '_save', side_effect=OSError('read-only')):
            self.controller.poll(); self.controller.poll()
        status = self.controller.status()
        self.assertEqual(status['state'], 'tracking')
        self.assertTrue(status['notification_error'])
        self.assertNotIn('pace', status['account'])
        self.assertNotIn('cycles', status['account'])
        self.controller.tray.notify.assert_called_once()

    def test_overlapping_poll_does_not_launch_old_authorization_after_new_action(self):
        self.controller.operation_lock.acquire()
        try:
            self.controller.poll()
            self.client.get.assert_not_called()
        finally:
            self.controller.operation_lock.release()
        self.controller.poll()
        self.client.get.assert_called_once_with('/api/account')

    def test_close_hides_only_with_working_tray_and_exit_is_explicit(self):
        self.controller.window = Mock()
        self.assertTrue(self.controller.closing())
        self.controller.tray = Mock()
        self.assertFalse(self.controller.closing())
        self.controller.window.hide.assert_called_once()
        self.controller.quit()
        self.assertTrue(self.controller.closing())
        self.assertTrue(self.controller.stop.is_set())
        self.controller.window.destroy.assert_called_once()

    def test_client_rechecks_identity_and_fetches_current_csrf_for_each_mutation(self):
        client = LocalClient(self.root, 8787)
        client._request = Mock(side_effect=[{'app':'codex-usage','instance':client.instance}, {'csrf':'new'}, {'status':'starting'}])
        client.post('/api/account/login')
        self.assertEqual(client._request.call_args.args, ('/api/account/login', 'new', None))
        client._request = Mock(return_value={'app':'other','instance':client.instance})
        with self.assertRaises(ValueError): client.post('/api/account/login')
        client._request.assert_called_once_with('/api/health')

    def test_gui_contains_bundled_assets_and_only_a_narrow_bridge(self):
        html = companion_html()
        self.assertIn('--bg: #f5f3ee', html)
        self.assertIn('消息中心', html)
        self.assertNotIn('/* COMPANION_SCRIPT */', html)
        bridge = CompanionBridge(self.controller)
        self.assertEqual([n for n in dir(bridge) if not n.startswith('_')], ['action', 'status'])

    def test_attach_reuses_service_and_does_not_stop_it_on_exit(self):
        empty = self.root / 'empty'; empty.mkdir()
        app = Application(self.root / 'data', [empty], 'UTC')
        with DesktopServer(app, 0) as server:
            port = server.server.server_port
            with CompanionService(app.data_dir, port) as service:
                self.assertFalse(service.owned)
                self.assertEqual(service.client.verify()['app'], 'codex-usage')
            self.assertTrue(server.thread.is_alive())
            with self.assertRaises(ValueError):
                with CompanionService(self.root / 'other', port): pass

    def test_new_service_starts_collector_and_releases_socket_on_exit(self):
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', 0)); port = probe.getsockname()[1]
        empty = self.root / 'empty'; empty.mkdir()
        with patch.object(Application, 'start_collecting') as start:
            with CompanionService(self.root / 'new', port, [empty], 'UTC') as service:
                self.assertTrue(service.owned)
                start.assert_called_once()
                self.assertEqual(service.client.verify()['app'], 'codex-usage')
            self.assertFalse(service.thread.is_alive())


if __name__ == '__main__':
    unittest.main()

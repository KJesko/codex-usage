import json
import queue
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from codex_usage.account import AccountConnection, AccountError, AccountQuota, AccountRPC, fetch_quota, normalize_quota
from codex_usage.app import Application, make_server


LIMITS = {'accountId': 'account-a', 'rateLimits': {'primary': {'usedPercent': 99}}, 'rateLimitsByLimitId': {
    'codex': {'planType': 'pro', 'primary': {'usedPercent': 9, 'windowDurationMins': 10080, 'resetsAt': 1792651402}, 'secondary': None},
    'extra': {'limitName': 'Additional model', 'primary': {'usedPercent': 22.5, 'windowDurationMins': 300}}
}}


class AccountTests(unittest.TestCase):
    def test_dashboard_logout_discards_inflight_result_and_blocks_refresh(self):
        entered, release = threading.Event(), threading.Event()
        def fetch():
            entered.set()
            release.wait(2)
            return normalize_quota(LIMITS)
        quota = AccountQuota(fetcher=fetch)
        try:
            quota.request()
            self.assertTrue(entered.wait(1))
            quota.set_signed_out(True)
            release.set()
            quota.thread.join(2)
            self.assertTrue(quota.status()['signed_out'])
            self.assertIsNone(quota.status()['account'])
            self.assertIsNone(quota.identity)
            quota.request(force=True)
            self.assertFalse(quota.status()['busy'])
            quota.set_signed_out(False)
            quota.request(force=True)
            quota.thread.join(2)
            self.assertIsNotNone(quota.status()['account'])
        finally:
            release.set()
            quota.close()

    def test_dashboard_logout_persists_and_login_restores_collection(self):
        with tempfile.TemporaryDirectory() as temp:
            app = Application(data_dir=Path(temp))
            app.account_quota.fetcher = Mock(return_value=normalize_quota(LIMITS))
            app.account_profile.from_local_login = Mock()
            app.logout_account()
            self.assertTrue(app.account_logout_path.exists())
            second = Application(data_dir=Path(temp))
            try:
                self.assertTrue(second.account_status()['signed_out'])
                second.account_quota.request(force=True)
                self.assertFalse(second.account_quota.busy)
                app.browser_login.stop.clear()
                app.login_completed()
                for _ in range(100):
                    if app.account_quota.thread and app.account_quota.thread.ident is not None:break
                    time.sleep(.01)
                app.account_quota.thread.join(2)
                self.assertFalse(app.account_logout_path.exists())
                self.assertFalse(app.account_quota.status()['signed_out'])
            finally:
                app.stop_collecting()
                second.stop_collecting()

    def test_routing_timeout_is_distinct_from_signout_and_hides_raw_errors(self):
        rpc = AccountRPC.__new__(AccountRPC)
        rpc.sequence, rpc.timeout = 0, 1
        rpc.send, rpc.messages = Mock(), queue.Queue()
        rpc.messages.put({'id': 1, 'error': {'code': -32603,
            'message': 'workspace routing discovery timed out https://private.example/?token=secret'}})
        with self.assertRaises(AccountError) as ex:
            rpc.call('account/rateLimits/read', {})
        self.assertEqual(ex.exception.kind, 'routing_timeout')
        self.assertEqual(ex.exception.stage, 'account/rateLimits/read')
        self.assertNotIn('secret', str(ex.exception))
        self.assertNotIn('private.example', str(ex.exception))
        self.assertNotIn('登录', str(ex.exception))

    def test_connection_refreshes_quota_without_requesting_optional_profile(self):
        rpc, factory = Mock(), Mock()
        factory.return_value = rpc
        other = {**LIMITS, 'accountId': 'account-b', 'rateLimitsByLimitId': {
            'codex': {**LIMITS['rateLimitsByLimitId']['codex'], 'planType': 'plus'}}}
        def respond(method, params):
            if method == 'account/read':
                self.fail('Optional profile metadata must never block quota refresh')
            return {} if method == 'initialize' else responses.pop(0)
        responses = [LIMITS, other]
        rpc.call.side_effect = respond
        connection = AccountConnection(factory)
        first, second = connection(), connection()
        self.assertEqual(first['account']['plan'], 'pro')
        self.assertEqual(second['account']['plan'], 'plus')
        self.assertNotEqual(first['_account_key'], second['_account_key'])
        factory.assert_called_once()
        self.assertEqual([c.args[0] for c in rpc.call.call_args_list],
            ['initialize', 'account/rateLimits/read', 'account/rateLimits/read'])
        rpc.close.assert_not_called()
        connection.close()
        connection.close()
        rpc.close.assert_called_once()

    def test_routing_failure_keeps_connection_and_retries_at_next_refresh(self):
        rpc, factory = Mock(), Mock()
        factory.return_value = rpc
        rpc.call.side_effect = [{}, AccountError('routing_timeout', '路由超时', 'account/rateLimits/read'), LIMITS]
        connection = AccountConnection(factory)
        with self.assertRaises(AccountError):
            connection()
        rpc.close.assert_not_called()
        self.assertEqual(connection()['windows'][0]['remaining_percent'], 91)
        factory.assert_called_once()
        connection.close()

    def test_slow_success_is_allowed_without_restarting_or_repeating_the_read(self):
        # Model a response arriving after a minute without sleeping in the test.
        # The former 25-second deadline would cancel this valid response.
        rpc = AccountRPC.__new__(AccountRPC)
        rpc.sequence, rpc.timeout = 0, 25
        rpc.send, rpc.messages, rpc.close = Mock(), Mock(), Mock()
        clock = [100.0]
        def receive(timeout):
            if rpc.sequence == 1:
                return {'id': 1, 'result': {}}
            if timeout < 60:
                raise queue.Empty
            clock[0] += 60
            return {'id': rpc.sequence, 'result': LIMITS}
        rpc.messages.get.side_effect = receive
        def create(**options):
            rpc.timeout = options['timeout']
            return rpc
        with patch('codex_usage.account.AccountRPC', side_effect=create) as factory, \
                patch('codex_usage.account.time.monotonic', side_effect=lambda: clock[0]):
            connection = AccountConnection()
            self.assertEqual(connection()['windows'][0]['remaining_percent'], 91)
            factory.assert_called_once()
            self.assertEqual([c.args[0]['method'] for c in rpc.send.call_args_list],
                             ['initialize', 'initialized', 'account/rateLimits/read'])
            rpc.close.assert_not_called()
            connection.close()

    def test_repeated_service_failures_reconnect_on_next_refresh_not_in_a_loop(self):
        for kind in ('routing_timeout', 'offline'):
            with self.subTest(kind=kind):
                old, new = Mock(), Mock()
                old.call.side_effect = [{}, *[AccountError(kind, 'temporary') for _ in range(3)]]
                new.call.side_effect = [{}, LIMITS]
                factory = Mock(side_effect=[old, new])
                connection = AccountConnection(factory)
                for _ in range(3):
                    with self.assertRaises(AccountError):
                        connection()
                    factory.assert_called_once()
                old.close.assert_called_once()
                self.assertEqual(connection()['windows'][0]['remaining_percent'], 91)
                self.assertEqual(factory.call_count, 2)
                connection.close()

    def test_success_breaks_consecutive_failure_count(self):
        rpc = Mock()
        rpc.call.side_effect = [{}, AccountError('routing_timeout', 'temporary'), LIMITS,
                               AccountError('offline', 'temporary'), AccountError('offline', 'temporary')]
        connection = AccountConnection(lambda: rpc)
        for fails in (True, False, True, True):
            if fails:
                with self.assertRaises(AccountError):
                    connection()
            else:
                connection()
        rpc.close.assert_not_called()
        connection.close()

    def test_deadline_disconnects_and_failed_reads_do_not_append_stale_history(self):
        old, new = Mock(), Mock()
        old.call.side_effect = [{}, LIMITS, AccountError('timeout', 'slow')]
        new.call.side_effect = [{}, LIMITS]
        factory = Mock(side_effect=[old, new])
        connection = AccountConnection(factory)
        with tempfile.TemporaryDirectory() as directory:
            tracker = AccountQuota(connection, history_path=Path(directory)/'history.sqlite')
            tracker._refresh()
            fetched_at = tracker.status()['fetched_at']
            with patch.object(tracker.history, 'record') as record:
                tracker._refresh()
                record.assert_not_called()
            old.close.assert_called_once()
            failed = tracker.status()
            self.assertTrue(failed['stale'])
            self.assertEqual(failed['fetched_at'], fetched_at)
            self.assertGreaterEqual(failed['collector']['last_duration_seconds'], 0)
            tracker._refresh()
            self.assertFalse(tracker.status()['stale'])
        connection.close()

    def test_missing_identity_or_plan_does_not_block_live_quota(self):
        for identity in (None, '', ' ', True, 123, {}):
            quota = normalize_quota({'accountId': identity, 'rateLimits': LIMITS['rateLimitsByLimitId']['codex']})
            self.assertEqual(quota['windows'][0]['remaining_percent'], 91)
            self.assertEqual(quota['account'], {'label': '当前 Codex 账号', 'plan': 'pro'})
            self.assertFalse(quota['history_available'])
            self.assertIsNone(quota['_account_key'])
        quota = normalize_quota({'rateLimits': {'primary': {'usedPercent': 9}}})
        self.assertIsNone(quota['account']['plan'])
        self.assertEqual(quota['windows'][0]['remaining_percent'], 91)

    def test_missing_identity_does_not_reuse_previous_account_history(self):
        with tempfile.TemporaryDirectory() as directory:
            tracker = AccountQuota(lambda: normalize_quota(LIMITS),
                                   history_path=Path(directory) / 'history.sqlite')
            tracker._refresh()
            self.assertTrue(tracker.status()['history_available'])
            rpc = Mock()
            rpc.call.side_effect = [{}, {**LIMITS, 'accountId': None}]
            connection = AccountConnection(lambda: rpc)
            tracker.fetcher = connection
            with patch.object(tracker.history, 'record') as record:
                tracker._refresh()
                record.assert_not_called()
            quota = tracker.status()
            self.assertFalse(quota['stale'])
            self.assertIsNone(quota['problem'])
            self.assertEqual(quota['account'], {'label': '当前 Codex 账号', 'plan': 'pro'})
            self.assertEqual(quota['windows'][0]['remaining_percent'], 91)
            self.assertEqual(quota['pace'], {})
            self.assertFalse(quota['history_available'])
            self.assertIn('未返回账号标识', quota['history_problem'])
            connection.close()

    def test_quota_failure_is_not_reported_as_connected(self):
        rpc = Mock()
        rpc.call.side_effect = [{}, AccountError('offline', '额度请求失败', 'account/rateLimits/read')]
        connection = AccountConnection(lambda: rpc)
        tracker = AccountQuota(connection)
        tracker._refresh()
        quota = tracker.status()
        self.assertTrue(quota['stale'])
        self.assertEqual(quota['problem']['stage'], 'account/rateLimits/read')
        self.assertIsNone(quota['fetched_at'])
        self.assertEqual(quota['windows'], [])
        connection.close()

    def test_broken_transport_reconnects_once_and_initializes_new_process(self):
        old, new, factory = Mock(), Mock(), Mock()
        factory.side_effect = [old, new]
        old.call.side_effect = [{}, AccountError('connection_lost', 'closed')]
        new.call.side_effect = [{}, LIMITS]
        connection = AccountConnection(factory)
        self.assertEqual(connection()['account']['plan'], 'pro')
        self.assertEqual(factory.call_count, 2)
        old.close.assert_called_once()
        connection.close()
        new.close.assert_called_once()

    def test_shutdown_stops_refreshing_and_releases_owned_connection(self):
        with patch('codex_usage.account.AccountConnection') as cls:
            tracker = AccountQuota()
            tracker.close()
            tracker.request(force=True)
            self.assertIsNone(tracker.thread)
            cls.return_value.close.assert_called_once()

    def test_failed_port_bind_does_not_close_account_before_fallback(self):
        with tempfile.TemporaryDirectory() as directory:
            app = Application(Path(directory) / 'app', [directory], 'UTC')
            app.account_quota = AccountQuota(lambda: normalize_quota(LIMITS))
            with patch('codex_usage.app.ThreadingHTTPServer.server_bind', side_effect=OSError('port in use')):
                with self.assertRaises(OSError):
                    make_server(app, 0)
            self.assertFalse(app.account_quota.closed)
            fallback = make_server(app, 0)
            fallback.server_close()
            self.assertTrue(app.account_quota.closed)

    def test_keyed_buckets_are_authoritative_and_no_invented_windows(self):
        q = normalize_quota(LIMITS)
        self.assertEqual(len(q['windows']), 2)
        self.assertEqual(q['windows'][0]['remaining_percent'], 91)
        self.assertEqual(q['windows'][0]['label'], '每周额度')
        self.assertEqual(q['windows'][1]['remaining_percent'], 77.5)
        self.assertIsNone(q['windows'][1]['resets_at'])
        self.assertEqual(normalize_quota({**LIMITS, 'rateLimitsByLimitId': {}})['windows'], [])

    def test_missing_values_do_not_become_zero_or_full_allowance(self):
        for value in (None, True, '10', float('nan'), float('inf')):
            q = normalize_quota({'rateLimits': {'primary': {'usedPercent': value, 'resetsAt': value}}})
            self.assertIsNone(q['windows'][0]['remaining_percent'])
            self.assertIsNone(q['windows'][0]['resets_at'])
        for used, remaining in ((-10, 100), (120, 0), (0, 100)):
            q = normalize_quota({'rateLimits': {'primary': {'usedPercent': used}}})
            self.assertEqual(q['windows'][0]['remaining_percent'], remaining)

    def test_display_allowlist_drops_credentials_and_identifiers(self):
        q = normalize_quota({**LIMITS, 'email': 'person@example.com', 'access_token': 'secret-token',
                            'accountId': 'private-account-id', 'rateLimitResetCredits': {'credits': ['private-reset-id']}})
        encoded = json.dumps(q)
        for value in ('person@example.com', 'secret-token', 'private-account-id', 'private-reset-id'):
            self.assertNotIn(value, encoded)
        self.assertEqual(q['account']['label'], '当前 Codex 账号')
        self.assertRegex(q['_account_key'], r'^[0-9a-f]{64}$')
        self.assertTrue(q['history_available'])

    def test_rpc_flow_is_read_only_and_always_closed(self):
        with patch('codex_usage.account.AccountRPC') as cls:
            rpc = cls.return_value
            rpc.call.side_effect = [{}, LIMITS]
            self.assertEqual(fetch_quota()['windows'][0]['remaining_percent'], 91)
            self.assertEqual([c.args[0] for c in rpc.call.call_args_list],
                             ['initialize', 'account/rateLimits/read'])
            rpc.close.assert_called_once()
        with patch('codex_usage.account.AccountRPC') as cls:
            cls.return_value.call.side_effect = [{}, AccountError('signed_out', '请登录', 'account/rateLimits/read')]
            with self.assertRaises(AccountError) as ex:
                fetch_quota()
            self.assertEqual(ex.exception.kind, 'signed_out')
            cls.return_value.close.assert_called_once()
        with patch('codex_usage.account.AccountRPC') as cls:
            cls.return_value.call.side_effect = [{}, AccountError('unsupported', '不支持额度读取', 'account/rateLimits/read')]
            with self.assertRaises(AccountError) as ex:
                fetch_quota()
            self.assertEqual(ex.exception.kind, 'unsupported')
            self.assertEqual(cls.return_value.call.call_count, 2)

    def test_single_refresh_and_failure_does_not_claim_live_data(self):
        gate = threading.Event()
        calls = []
        def fetch():
            calls.append(1)
            gate.wait(2)
            return normalize_quota(LIMITS)
        tracker = AccountQuota(fetch)
        try:
            tracker.request()
            for _ in range(5):
                tracker.request(force=True)
            self.assertTrue(tracker.status()['busy'])
        finally:
            gate.set()
            tracker.thread.join(3)
        self.assertEqual(len(calls), 1)
        tracker.request(force=True)
        self.assertEqual(len(calls), 1)  # debounce
        def fail():
            raise AccountError('offline', '连接失败')
        tracker.fetcher, tracker.attempt = fail, None
        tracker.request()
        tracker.thread.join(3)
        self.assertTrue(tracker.status()['stale'])
        self.assertEqual(tracker.status()['windows'][0]['remaining_percent'], 91)
        def signed_out():
            raise AccountError('signed_out', '请登录')
        tracker.fetcher, tracker.attempt = signed_out, None
        tracker.request()
        tracker.thread.join(3)
        self.assertIsNone(tracker.status()['account'])
        self.assertEqual(tracker.status()['windows'], [])

    def test_account_endpoint_and_refresh_security(self):
        with tempfile.TemporaryDirectory() as directory:
            app = Application(Path(directory) / 'app', [directory], 'UTC')
            app.account_quota = AccountQuota(lambda: normalize_quota(LIMITS))
            server = make_server(app, 0)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            base = f'http://127.0.0.1:{server.server_port}'
            try:
                for request in [Request(base+'/api/account', headers={'Host':'evil.example'}),
                                Request(base+'/api/account/refresh', data=b''),
                                Request(base+'/api/account/refresh', data=b'', headers={'X-CSRF-Token':app.csrf,'Origin':'https://evil.example'})]:
                    with self.assertRaises(HTTPError) as ex:
                        urlopen(request)
                    self.assertEqual(ex.exception.code, 403)
                self.assertIsNone(app.account_quota.attempt)
                with urlopen(Request(base+'/api/account/refresh', data=b'', headers={'X-CSRF-Token':app.csrf,'Origin':base})) as response:
                    self.assertEqual(response.status, 202)
                app.account_quota.thread.join(3)
                with urlopen(base+'/api/account?project=ignored&since=2000-01-01') as response:
                    result = json.load(response)
                self.assertEqual(result['windows'][0]['remaining_percent'], 91)
                self.assertEqual(result['scope'], 'account')
                self.assertFalse(result['stale'])
                self.assertTrue(result['history_available'])
                self.assertNotIn('_account_key', result)
                self.assertNotIn('account-a', json.dumps(result))
                self.assertEqual(list(Path(directory).glob('**/*token*')), [])
            finally:
                server.shutdown()
                server.server_close()
                thread.join(3)


if __name__ == '__main__':
    unittest.main()

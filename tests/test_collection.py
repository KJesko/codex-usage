"""Background collection and persisted quota records without browser polling."""
import csv
import io
import sys
import tempfile
import threading
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from codex_usage.account import AccountError, AccountQuota, normalize_quota
from codex_usage.app import Application, export_csv, validate_settings
from codex_usage.quota_alerts import DEFAULT_ALERTS, QuotaAlerts
from codex_usage.quota_history import QuotaHistory


def quota(at, *, account='a', reset=None, used=85):
    value = normalize_quota({'accountId': account, 'rateLimits': {'planType': 'pro', 'primary': {
        'usedPercent': used, 'windowDurationMins': 10080, 'resetsAt': reset or at+86400}}})
    value['fetched_at'] = datetime.fromtimestamp(at, timezone.utc).isoformat()
    return value


class CollectionTests(unittest.TestCase):
    def test_without_http_requests_collects_retries_persists_and_stops(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'quota.sqlite'
            enough, attempts = threading.Event(), []
            reset = time.time()+86400
            def fetch():
                attempts.append(time.time())
                if len(attempts) == 1:
                    raise AccountError('offline', '暂时离线')
                if len(attempts) >= 3:
                    enough.set()
                return quota(time.time(), reset=reset)
            tracker = AccountQuota(fetch, interval=.05, history_path=path)
            tracker.start()
            tracker.start()  # no duplicate collector
            try:
                self.assertTrue(enough.wait(3), 'collector must run without HTTP requests')
                tracker.thread.join(2)
                state = tracker.status()
                self.assertEqual(state['collector']['failures'], 0)
                self.assertFalse(state['stale'])
                self.assertGreaterEqual(state['pace']['codex:primary']['sample_count'], 2)
            finally:
                tracker.close()
                tracker.thread.join(2)
            count = len(attempts)
            self.assertFalse(tracker.status()['collector']['running'])
            self.assertTrue(tracker.stop_event.wait(.1))
            self.assertEqual(len(attempts), count)
            cycles = QuotaHistory(path).cycles(quota(time.time())['_account_key'], time.time())
            self.assertGreaterEqual(cycles[0]['sample_count'], 2)

    def test_usage_scan_keeps_running_when_page_is_closed_and_recovers(self):
        with tempfile.TemporaryDirectory() as directory:
            app = Application(Path(directory)/'data', [directory], 'UTC')
            app.account_quota.close()
            app.account_quota = AccountQuota(lambda: quota(time.time()), interval=.05)
            ready = threading.Event()
            calls = []
            def scan():
                calls.append(1)
                if len(calls) == 1:
                    raise OSError('temporary read failure')
                ready.set()
                return {}
            app.index.snapshot = scan
            app.remote_sync.request = Mock()
            try:
                app.start_collecting(scan_interval=.05)
                self.assertTrue(ready.wait(3))
                with app.lock:
                    state = app.collection_status()
                self.assertIsNone(state['problem'])
                self.assertIsNotNone(state['last_scan'])
                self.assertGreaterEqual(app.remote_sync.request.call_count, 2)
            finally:
                app.stop_collecting()
            self.assertFalse(app.collection_status()['running'])

    def test_history_cycles_are_account_scoped_with_explicit_missing_days(self):
        with tempfile.TemporaryDirectory() as directory:
            history = QuotaHistory(Path(directory)/'quota.sqlite')
            now = 1800000000
            reset = now-3600
            for ago, used in [(3*86400, 20), (86400, 60)]:
                history.record(quota(reset-ago, reset=reset, used=used), 'Asia/Shanghai')
            history.record(quota(now, reset=now+86400))
            history.record(quota(now, account='b', reset=now+86400))
            identity = quota(now)['_account_key']
            cycles = history.cycles(identity, now)
            self.assertEqual(len(cycles), 2)
            old = next(c for c in cycles if c['completed'])
            result = history.cycle(identity, old['id'], now, 'Asia/Shanghai')
            p = result['pace']['codex:primary']
            self.assertEqual([s['used_percent'] for s in p['daily_samples']], [20, 60])
            self.assertEqual(p['status'], 'historical')
            self.assertEqual(result['windows'][0]['used_percent'], 60)
            self.assertGreater(p['gap_seconds'], 86400)
            with self.assertRaises(ValueError):
                history.cycle(quota(now, account='b')['_account_key'], old['id'], now)
            self.assertEqual(history.cycles(identity, now+91*86400), [])

    def test_same_cycle_on_account_switch_changes_frontend_scope_and_signout_clears(self):
        tracker = AccountQuota(lambda: quota(time.time()))
        tracker._refresh()
        scope = tracker.status()['history_scope']
        tracker._refresh()
        self.assertEqual(tracker.status()['history_scope'], scope)
        tracker.fetcher = lambda: quota(time.time(), account='b')
        tracker._refresh()
        self.assertNotEqual(tracker.status()['history_scope'], scope)
        tracker.fetcher = Mock(side_effect=AccountError('signed_out', '请登录'))
        tracker._refresh()
        self.assertIsNone(tracker.status()['history_scope'])

    def test_alerts_deduplicate_across_restarts_acknowledge_and_separate_accounts_cycles(self):
        with tempfile.TemporaryDirectory() as directory:
            path, now = Path(directory)/'quota.sqlite', 1800000000
            q = quota(now)
            identity = q['_account_key']
            store = QuotaAlerts(path)
            active = store.evaluate(q, {}, DEFAULT_ALERTS, now)
            self.assertEqual(len(active), 1)
            store = QuotaAlerts(path)
            self.assertEqual(store.evaluate(q, {}, DEFAULT_ALERTS, now+1), active)
            self.assertEqual(len(store.list(identity, now+1, active)), 1)
            store.acknowledge('another-account', active[0])
            self.assertFalse(store.list(identity, now)[0]['acknowledged'])
            store.acknowledge(identity, active[0])
            self.assertTrue(store.list(identity, now)[0]['acknowledged'])
            # A new reset cycle creates a new reminder; another account has its own inbox.
            other_cycle = store.evaluate(quota(now, reset=now+2*86400), {}, DEFAULT_ALERTS, now+2)
            self.assertNotEqual(other_cycle, active)
            other = quota(now, account='b')
            store.evaluate(other, {}, DEFAULT_ALERTS, now)
            self.assertEqual(len(store.list(other['_account_key'], now)), 1)
            self.assertEqual(len(store.list(identity, now)), 2)
            self.assertEqual(store.evaluate(q, {}, {**DEFAULT_ALERTS, 'enabled': False}, now), [])
            self.assertFalse(any(a['active'] for a in store.list(identity, now+3*86400, active)))
            self.assertEqual(store.list(identity, now+91*86400), [])

    def test_risk_alert_requires_forecast_and_stale_snapshot_never_reissues(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'quota.sqlite'
            now = time.time()
            q = quota(now, used=30)
            store = QuotaAlerts(path)
            for status in ('insufficient', 'stale', 'sustainable'):
                self.assertEqual(store.evaluate(q, {'codex:primary': {'status':status}}, DEFAULT_ALERTS, now), [])
            self.assertEqual(len(store.evaluate(q, {'codex:primary': {'status':'risk'}}, DEFAULT_ALERTS, now)), 1)
            tracker = AccountQuota(lambda: quota(time.time()), history_path=path)
            tracker._refresh()
            self.assertTrue(any(a['active'] for a in tracker.status()['alerts']))
            tracker.fetcher = Mock(side_effect=AccountError('offline', '离线'))
            tracker._refresh()
            self.assertFalse(any(a['active'] for a in tracker.status()['alerts']))

    def test_invalid_alert_settings_are_rejected(self):
        base = {'sources': [str(Path(__file__).resolve().parent)], 'timezone': 'UTC'}
        for value in (0, 100, True, float('nan'), '20'):
            with self.assertRaises(ValueError):
                validate_settings({**base, 'quota_alerts': {'remaining_percent': value}})
        self.assertEqual(validate_settings(base)['quota_alerts'], DEFAULT_ALERTS)

    def test_export_matches_session_search_sort_and_includes_all_pages(self):
        sessions = [dict(id=str(i), title=f'Session {i}', model_names=['Terra' if i%2 else 'Other'],
                         project_names=['Example'], total=100-i, known_cost=i,
                         last_at=f'2026-10-{i+1:02d}T00:00:00Z') for i in range(30)]
        data = dict(sessions=sessions, timezone='UTC', pricing={'verified_at':'2026-10-16'})
        raw = export_csv(data, 'sessions', 'TERRA', 'known_cost').decode('utf-8-sig')
        rows = list(csv.DictReader(io.StringIO(raw)))
        self.assertEqual([r['id'] for r in rows], [str(i) for i in range(29,0,-2)])
        self.assertEqual(len(list(csv.DictReader(io.StringIO(export_csv(data, 'sessions', 'example').decode('utf-8-sig'))))), 30)
        self.assertEqual(len(list(csv.DictReader(io.StringIO(export_csv(data, 'sessions', 'missing').decode('utf-8-sig'))))), 0)
        with self.assertRaises(ValueError):
            export_csv(data, 'sessions', sort='bad')


if __name__ == '__main__':
    unittest.main()

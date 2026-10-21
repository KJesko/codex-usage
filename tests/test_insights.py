"""Synthetic boundary cases for comparisons, cache value and quota forecasting."""
import copy
import sys
import tempfile
import unittest
from datetime import date, datetime, timezone
from pathlib import Path
from unittest.mock import patch
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from codex_usage.account import AccountError, AccountQuota, normalize_quota
from codex_usage.analytics import report
from codex_usage.insights import comparison
from codex_usage.pricing import estimate
from codex_usage.quota_history import QuotaHistory, daily_history, pace


def event(at, total, project='local:a', model='test', cost=1):
    return dict(at=at, total=total, cost=cost, model=model, project=project,
                project_name=project.split(':')[-1], source_name=project.split(':')[0])


class ComparisonTests(unittest.TestCase):
    def compare(self, events, start='2026-10-15', end='2026-10-15', **kwargs):
        args = dict(zone=ZoneInfo('Asia/Shanghai'), now=datetime.fromisoformat('2026-10-15T12:00:00+08:00'),
                    cutoff=datetime.fromisoformat('2026-10-01T00:00:00+08:00'), period='today',
                    earliest=datetime.fromisoformat('2026-10-01T02:00:00+08:00'))
        args.update(kwargs)
        return comparison(events, date.fromisoformat(start), date.fromisoformat(end), **args)

    def test_today_compares_same_elapsed_time_and_excludes_later_events(self):
        rows = [event('2026-10-14T00:00:00+08:00', 100),
                event('2026-10-14T11:59:59+08:00', 200),
                event('2026-10-14T12:00:00+08:00', 5000),
                event('2026-10-15T11:59:59+08:00', 400),
                event('2026-10-15T14:00:00+08:00', 9000)]
        result = self.compare(rows)
        self.assertTrue(result['available'])
        self.assertEqual(result['previous']['total'], 300)
        self.assertEqual(result['current']['total'], 400)
        self.assertEqual(result['previous_range']['until'], '2026-10-14T12:00:00+08:00')

    def test_week_uses_previous_week_same_weekdays_and_time(self):
        result = self.compare([], start='2026-10-12', period='week')
        self.assertEqual(result['previous_range']['since'], '2026-10-05T00:00:00+08:00')
        self.assertEqual(result['previous_range']['until'], '2026-10-08T12:00:00+08:00')
        self.assertEqual(result['basis'], '上周同期')

    def test_cutoff_and_incomplete_history_do_not_invent_zero_baselines(self):
        for changes in [dict(cutoff=datetime.fromisoformat('2026-10-15T00:00:00+08:00')),
                        dict(earliest=datetime.fromisoformat('2026-10-15T00:00:00+08:00')),
                        dict(earliest=None)]:
            result = self.compare([event('2026-10-15T01:00:00+08:00', 42)], **changes)
            self.assertFalse(result['available'])
            self.assertIsNone(result['previous'])
            self.assertEqual(result['current']['total'], 42)
            self.assertEqual(result['projects'], [])
        self.assertFalse(self.compare([], start='2026-10-16', end='2026-10-17')['available'])

    def test_historical_windows_are_complete_and_use_local_midnight_across_dst(self):
        result = self.compare([event('2026-11-01T23:59:59-08:00', 7), event('2026-11-02T00:00:00-08:00', 99)],
                              start='2026-11-01', end='2026-11-01', zone=ZoneInfo('America/Los_Angeles'),
                              now=datetime.fromisoformat('2026-11-03T12:00:00-08:00'))
        self.assertEqual(result['current']['total'], 7)
        self.assertEqual(result['current_range']['since'], '2026-11-01T00:00:00-07:00')
        self.assertEqual(result['current_range']['until'], '2026-11-02T00:00:00-08:00')
        self.assertEqual(result['previous_range']['since'], '2026-10-31T00:00:00-07:00')
        self.assertFalse(result['partial_day'])

    def test_attribution_reconciles_removed_new_and_same_named_remote_projects(self):
        rows = [event('2026-10-14T01:00:00+08:00', 100, 'local:a', 'm1', cost=10),
                event('2026-10-15T01:00:00+08:00', 50, 'local:a', 'm2', cost=6),
                event('2026-10-15T02:00:00+08:00', 80, 'remote:a', 'unknown', cost=None)]
        result = self.compare(rows)
        self.assertEqual(len(result['projects']), 2)
        self.assertEqual(result['current']['unpriced_events'], 1)
        self.assertEqual(result['current']['known_cost'], 6)
        for dimension in ('projects', 'models'):
            self.assertEqual(sum(row['delta_total'] for row in result[dimension]), 30)
            self.assertEqual(sum(row['delta_cost'] for row in result[dimension]), -4)
        self.assertIn(-100, [row['delta_total'] for row in result['models']])

    def test_report_applies_dimensions_to_both_periods_and_cache_savings(self):
        rows = []
        for day in (14, 15):
            for source in ('local', 'remote'):
                row = event(f'2026-10-{day}T01:00:00+08:00', 110, f'{source}:a')
                row.update(input=100, uncached=20, cached=80, write=0, output=10, reasoning=0,
                           context_input=100, source=source, project_path='/a', session=source,
                           title='Synthetic session', account=source)
                rows.append(row)
        snapshot = dict(events=rows, coverage={}, limits=[], scanned_at='2026-10-15T03:00:00Z')
        config = dict(timezone='Asia/Shanghai', usage_since='2026-10-14',
                      prices={'test': dict(input=10, cached=1, write=10, output=10)})
        now = datetime.fromisoformat('2026-10-15T12:00:00+08:00')
        for filters in [dict(source='local'), dict(project='local:a'), dict(session='local'), dict(account='local')]:
            result = report(snapshot, dict(since='2026-10-15', until='2026-10-15', **filters), config, now)
            c = result['comparison']
            self.assertEqual(c['current']['total'], 110)
            self.assertEqual(c['previous']['total'], 110)
            self.assertAlmostEqual(result['summary']['cache_savings'], 80 * 9 / 1e6)
            self.assertAlmostEqual(result['summary']['known_cost'] + result['summary']['cache_savings'], 110 * 10 / 1e6)

    def test_cache_counterfactual_preserves_long_context_and_output_prices(self):
        row = dict(model='custom', context_input=300000, uncached=100000, cached=200000, write=0, output=1000)
        prices = {'custom': dict(input=10, cached=1, write=10, output=30, long_context=272000)}
        actual = estimate(row, prices)
        without_cache = estimate({**row, 'uncached': 300000, 'cached': 0}, prices)
        self.assertAlmostEqual(actual['cost'] + actual['cache_savings'], without_cache['cost'])
        self.assertIsNone(estimate({**row, 'model': 'unknown'})['cache_savings'])


class QuotaPaceTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime.fromisoformat('2026-10-15T12:00:00+00:00').timestamp()
        self.window = dict(id='codex:primary', used_percent=30, window_minutes=10080, resets_at=self.now + 86400)

    def samples(self, values, offsets=(-1800, -900, 0)):
        return [dict(at=self.now + offset, used_percent=value) for offset, value in zip(offsets, values)]

    def test_speed_requires_measured_growth_and_enough_continuous_history(self):
        result = pace(self.window, self.samples([28, 29, 30]), self.now)
        self.assertEqual(result['status'], 'risk')
        self.assertEqual(result['rate_per_hour'], 4)
        self.assertEqual(result['estimated_exhaustion'], self.now + 17.5 * 3600)
        stable = pace(self.window, self.samples([29, 29, 30]), self.now)
        self.assertEqual(stable['status'], 'sustainable')
        self.assertEqual(pace(self.window, self.samples([30, 30, 30]), self.now)['status'], 'flat')
        self.assertEqual(pace(self.window, self.samples([29.5, 29.5, 30]), self.now)['status'], 'flat')

    def test_gaps_resets_stale_and_short_history_never_predict(self):
        cases = [self.samples([28, 29, 30], (-3600, -600, 0)),
                 self.samples([80, 29, 30]),
                 self.samples([28, 29, 30], (-600, -300, 0)),
                 self.samples([28, 29, 30], (-2400, -1500, -600)), []]
        for samples in cases:
            result = pace(self.window, samples, self.now)
            self.assertEqual(result['status'], 'insufficient')
            self.assertIsNone(result['estimated_exhaustion'])
        self.assertEqual(pace({**self.window, 'resets_at': self.now}, [], self.now)['status'], 'expired')
        self.assertEqual(pace({**self.window, 'used_percent': None}, [], self.now)['status'], 'unknown')
        self.assertEqual(pace({**self.window, 'used_percent': 100}, [], self.now)['status'], 'exhausted')

    def quota(self, account_id='account-a', plan='pro', offset=0, reset_offset=0):
        q = normalize_quota({'accountId': account_id, 'rateLimits': {'planType': plan, 'primary': {
            'usedPercent': 30, 'windowDurationMins': 10080, 'resetsAt': self.window['resets_at'] + reset_offset}}})
        q['fetched_at'] = datetime.fromtimestamp(self.now + offset, timezone.utc).isoformat()
        return q

    def test_daily_history_uses_local_date_and_last_success_not_daily_maximum(self):
        def point(at, used):
            return dict(at=datetime.fromisoformat(at).timestamp(), used_percent=used)
        samples = [point('2026-10-15T15:59:40+00:00', 20),
                   point('2026-10-15T15:59:50+00:00', 19),
                   point('2026-10-15T16:00:10+00:00', 21),
                   point('2026-10-17T16:00:00+00:00', 30)]
        original = copy.deepcopy(samples)
        window = {**self.window, 'resets_at': samples[-1]['at'] + 86400}
        result = daily_history(window, samples, 'Asia/Shanghai')
        self.assertEqual(result['daily_timezone'], 'Asia/Shanghai')
        self.assertEqual([(p['date'], p['used_percent']) for p in result['daily_samples']],
                         [('2026-10-15', 19), ('2026-10-16', 21), ('2026-10-18', 30)])
        self.assertEqual(result['daily_samples'][0]['at'], samples[1]['at'])
        self.assertEqual(result['sample_count'], 4)
        self.assertEqual(samples, original)

    def test_daily_axis_uses_real_local_midnights_across_dst(self):
        window = {**self.window, 'resets_at': datetime.fromisoformat('2026-11-05T12:00:00+00:00').timestamp()}
        result = daily_history(window, [], 'America/Los_Angeles')
        ticks = {p['date']: p['at'] for p in result['daily_ticks']}
        self.assertEqual(ticks['2026-11-02'] - ticks['2026-11-01'], 25 * 3600)
        self.assertEqual(result['daily_samples'], [])

    def test_manual_success_within_a_minute_updates_daily_last_observation(self):
        with tempfile.TemporaryDirectory() as folder:
            history = QuotaHistory(Path(folder) / 'quota.sqlite')
            history.record(self.quota(), 'Asia/Shanghai')
            latest = self.quota(offset=30)
            latest['windows'][0]['used_percent'] = 31
            result = history.record(latest, 'Asia/Shanghai')['codex:primary']
            self.assertEqual(result['sample_count'], 2)
            self.assertEqual(len(result['daily_samples']), 1)
            self.assertEqual(result['daily_samples'][0]['used_percent'], 31)
            self.assertEqual(result['daily_samples'][0]['at'], self.now + 30)
            self.assertEqual(history.record(latest, 'Asia/Shanghai')['codex:primary']['sample_count'], 2)

    def test_history_persists_but_does_not_mix_accounts_plans_or_reset_cycles(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'quota.sqlite'
            first = QuotaHistory(path)
            q = self.quota()
            first.record(q)
            self.assertEqual(len(first.record(q)['codex:primary']['samples']), 1)
            second = QuotaHistory(path)
            self.assertEqual(len(second.record(self.quota(offset=60))['codex:primary']['samples']), 2)
            # The generic display label must never be used as the history key.
            self.assertEqual(q['account']['label'], self.quota('account-b')['account']['label'])
            for other in [self.quota('account-b', offset=120), self.quota(plan='plus', offset=120),
                          self.quota(offset=120, reset_offset=86400)]:
                self.assertEqual(len(second.record(other)['codex:primary']['samples']), 1)
            content = path.read_bytes()
            self.assertNotIn(b'account-a', content)
            self.assertNotIn(b'account-b', content)

    def test_history_failure_preserves_live_data_and_identity_is_not_public(self):
        with tempfile.TemporaryDirectory() as folder:
            tracker = AccountQuota(lambda: self.quota(), history_path=Path(folder) / 'quota.sqlite')
            with patch.object(tracker.history, 'record', side_effect=OSError('disk full')):
                tracker._refresh()
            result = tracker.status()
            self.assertFalse(result['stale'])
            self.assertEqual(result['windows'][0]['remaining_percent'], 70)
            self.assertIn('history_problem', result)
            self.assertNotIn('_account_key', result)

    def test_downsampling_preserves_real_gaps_without_breaking_continuous_history(self):
        with tempfile.TemporaryDirectory() as folder:
            history = QuotaHistory(Path(folder) / 'quota.sqlite')
            q = self.quota()
            q['windows'][0]['window_minutes'] = 43200
            keys = (q['_account_key'], 'pro', 'codex:primary', 43200, self.window['resets_at'])
            rows = [(*keys, self.now - (12060 - i - (60 if i >= 6000 else 0)) * 60, i / 600)
                    for i in range(12001)]
            db = history.connect()
            try:
                with db:
                    db.executemany('INSERT INTO observations VALUES (?,?,?,?,?,?,?)', rows)
            finally:
                db.close()
            result = history.record(q, 'Asia/Shanghai')['codex:primary']
            samples = result['samples']
            self.assertEqual(len(samples), 600)
            self.assertEqual(samples[0]['at'], rows[0][-2])
            self.assertEqual(samples[-1]['at'], self.now)
            self.assertEqual(sum(p['break_before'] for p in samples), 1)
            self.assertGreater(samples[1]['at'] - samples[0]['at'], 15 * 60)
            self.assertFalse(samples[1]['break_before'])
            # Daily endpoints must come from the full history, not 600 display
            # samples that could miss the final observation before midnight.
            expected = {}
            for row in rows:
                expected[datetime.fromtimestamp(row[-2], ZoneInfo('Asia/Shanghai')).date().isoformat()] = row[-2]
            self.assertEqual({p['date']: p['at'] for p in result['daily_samples']}, expected)
            self.assertEqual(result['sample_count'], 12001)

    def test_stale_live_response_does_not_reuse_a_forecast(self):
        q = self.quota()
        q['pace'] = {'codex:primary': pace(self.window, self.samples([28, 29, 30]), self.now)}
        tracker = AccountQuota(lambda: copy.deepcopy(q))
        tracker._refresh()
        self.assertEqual(tracker.status()['pace']['codex:primary']['status'], 'risk')
        def fail():
            raise AccountError('offline', 'Offline')
        tracker.fetcher = fail
        tracker._refresh()
        result = tracker.status()
        self.assertEqual(result['pace']['codex:primary']['status'], 'stale')
        self.assertIsNone(result['pace']['codex:primary']['estimated_exhaustion'])


if __name__ == '__main__':
    unittest.main()

"""Cross-cycle views preserve reset boundaries, missing observations and account isolation."""
from datetime import datetime
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'src'))
from codex_usage.quota_history import QuotaHistory
from codex_usage.quota_range import range_bounds, range_points
from codex_usage.account import AccountQuota
from zoneinfo import ZoneInfo


def at(value):
    return datetime.fromisoformat(value+'+08:00').timestamp()


class AutoProjectionTests(unittest.TestCase):
    def test_plateaus_changes_and_gaps_are_preserved(self):
        points = [dict(at=i*60, used_percent=value) for i,value in enumerate([0,0,0,1,1,2,2,2])]
        points.append(dict(at=3000, used_percent=3))
        selected = range_points(points, 0, 4000, 'auto', ZoneInfo('UTC'))
        self.assertEqual([p['at'] for p in selected], [0,120,180,240,300,420,3000])
        self.assertTrue(selected[-1]['break_before'])

class QuotaRangeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.history = QuotaHistory(Path(self.temp.name)/'quota.sqlite')
        self.now = at('2026-10-28T06:00:00')
        self.reset0 = at('2026-10-22T14:43:00')
        self.reset1 = at('2026-10-26T18:46:00')
        self.reset2 = at('2026-10-28T05:00:00')
        observations = [
            ('2026-10-16T16:00:00',26,self.reset0),('2026-10-18T04:40:00',46,self.reset0),
            ('2026-10-18T04:41:00',0,at('2026-10-25T04:41:00')),
            ('2026-10-18T04:42:00',0,at('2026-10-25T04:42:00')),
            ('2026-10-19T18:46:00',1,self.reset1),('2026-10-20T12:00:00',15,self.reset1),
            ('2026-10-21T05:00:00',0,self.reset2),('2026-10-21T05:01:00',1,self.reset2),
            ('2026-10-28T04:59:00',90,self.reset2),
            ('2026-10-28T05:01:00',1,self.reset2+7*86400),('2026-10-28T05:02:00',2,self.reset2+7*86400)]
        for stamp, used, reset in observations:
            self.history.record(dict(_account_key='one',account={'plan':'pro'},fetched_at=stamp+'+08:00',
                                     windows=[dict(id='codex:primary',label='每周额度',window_minutes=10080,resets_at=reset,used_percent=used)]))

    def tearDown(self):
        self.temp.cleanup()

    def read(self, since='2026-10-16', until='2026-10-28', grain='hour', identity='one'):
        return self.history.range(identity,since,until,self.now,'Asia/Shanghai',grain)

    def test_multiple_official_and_scheduled_resets_are_preserved_at_both_densities(self):
        for grain in ('hour','day'):
            q=self.read(grain=grain);g=q['groups'][0]
            self.assertEqual([e['kind'] for e in g['events']],['official','official','scheduled'])
            self.assertEqual(g['sample_count'],11)
            self.assertEqual(g['segment_count'],4)
            self.assertEqual([r['cycle_until']-r['cycle_since'] for r in g['references']],[7*86400]*4)
            self.assertEqual(g['references'][0]['until'],g['events'][0]['at'])
            self.assertEqual(g['references'][1]['since'],self.reset1-7*86400)
            self.assertEqual(g['references'][1]['until'],g['events'][1]['at'])
            self.assertEqual(g['idle'][0]['since'],g['events'][0]['at'])
            self.assertEqual(g['idle'][0]['until'],self.reset1-7*86400)
            for event in g['events']:
                before=next(p for p in g['samples'] if p['at']==event['since'])
                after=next(p for p in g['samples'] if p['at']==event['at'])
                self.assertEqual(before['used_percent'],event['before_used'])
                self.assertEqual(after['used_percent'],event['after_used'])
                self.assertTrue(after['break_before'])

    def test_clipped_range_does_not_rebase_reference_or_include_other_reset_events(self):
        q=self.read('2026-10-20','2026-10-20');g=q['groups'][0]
        self.assertEqual(g['sample_count'],1)
        self.assertEqual(g['events'],[])
        self.assertEqual(g['references'][0]['since'],q['range']['since'])
        self.assertGreater(g['references'][0]['before'],0)
        self.assertEqual(q['range']['until']-q['range']['since'],86400)
        self.assertEqual(g['idle'],[])

    def test_empty_ranges_accounts_invalid_dates_and_reversed_ranges(self):
        self.assertEqual(self.read('2026-10-14','2026-10-14')['groups'],[])
        self.assertEqual(self.read(identity='other')['groups'],[])
        for since,until,grain in [('bad','2026-10-28','hour'),('2026-10-28','2026-10-27','hour'),
                                 ('2026-01-01','2026-10-28','hour'),('2026-10-28','2026-10-29','hour'),
                                 ('2026-10-27','2026-10-28','minute')]:
            with self.assertRaises(ValueError):self.read(since,until,grain)

    def test_calendar_bounds_handle_dst_without_assuming_24_hours(self):
        now=at('2026-11-05T12:00:00')
        begin,end=range_bounds('2026-11-01','2026-11-01',now,'America/Los_Angeles')
        self.assertEqual(end-begin,25*3600)

    def test_bucket_downsampling_keeps_gap_edges_and_drops_without_false_lines(self):
        samples=[dict(at=stamp,used_percent=used) for stamp,used in [(0,20),(60,21),(600,22),(3000,25),(3060,1),(3120,2)]]
        points=range_points(samples,0,3600,'hour',ZoneInfo('UTC'))
        self.assertEqual([p['at'] for p in points],[0,600,3000,3060,3120])
        self.assertEqual([p['at'] for p in points if p['break_before']],[0,3000,3060])

    def test_daily_sampling_preserves_idle_to_usage_boundary(self):
        samples=[dict(at=i*60,used_percent=0 if i<=30 else (i-30)/10) for i in range(61)]
        points=range_points(samples,0,86400,'day',ZoneInfo('UTC'),anchors=(30*60+30,))
        self.assertEqual([p['at'] for p in points],[0,30*60,31*60,60*60])
        self.assertEqual([p['used_percent'] for p in points],[0,0,.1,3])

    def test_account_switch_during_read_rejects_old_history(self):
        tracker=AccountQuota(lambda: {},history_path=Path(self.temp.name)/'quota.sqlite')
        tracker.identity='one'
        def switched(*args):
            tracker.identity='two'
            return {'groups':['private']}
        with patch.object(tracker.history,'range',side_effect=switched):
            with self.assertRaisesRegex(ValueError,'账号已切换'):
                tracker.historical_range('2026-10-16','2026-10-28')


if __name__=='__main__':unittest.main()

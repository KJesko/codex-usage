"""Quota day boundaries follow elapsed 24 hours, never local midnight."""
import copy
import sys
import unittest
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from codex_usage.quota_history import cycle_history


class CycleTimeTests(unittest.TestCase):
    def setUp(self):
        self.begin = datetime.fromisoformat('2026-10-15T14:43:00+08:00').timestamp()
        self.window = dict(resets_at=self.begin+7*86400, window_minutes=10080)

    def point(self, hours, used):
        return dict(at=self.begin+hours*3600, used_percent=used)

    def test_midnight_does_not_split_but_exact_24_hour_boundary_does(self):
        samples = [self.point(-1, 1), self.point(9, 10), self.point(10, 12),
                   self.point(23.99, 20), self.point(24, 21), self.point(34, 30), self.point(168, 0)]
        original = copy.deepcopy(samples)
        points = cycle_history(self.window, samples, 'Asia/Shanghai')['cycle_samples']
        self.assertEqual([(p['interval'],p['used_percent']) for p in points], [(0,20),(1,30)])
        self.assertEqual(points[0]['at'], samples[3]['at'])
        self.assertEqual(points[1]['since'], self.begin+86400)
        self.assertEqual(points[1]['until']-points[1]['since'], 86400)
        self.assertEqual(samples, original)

    def test_missing_intervals_and_recovery_remain_visible(self):
        points = cycle_history(self.window, [self.point(1,80),self.point(24,90),self.point(25,5),
                                            self.point(73,20)], 'Asia/Shanghai')['cycle_samples']
        self.assertEqual([p['interval'] for p in points], [0,1,3])
        self.assertTrue(points[1]['break_before'])
        self.assertTrue(points[2]['break_before'])

    def test_early_reset_does_not_reanchor_formal_24_hour_buckets(self):
        window = {**self.window, 'segment_started_at':self.begin+5*3600,'display_end':self.begin+30*3600}
        points = cycle_history(window, [self.point(4,50),self.point(6,0),self.point(28,10),self.point(29,11),
                                       self.point(30,0)], 'Asia/Shanghai')['cycle_samples']
        self.assertEqual([p['interval'] for p in points], [0,1])
        self.assertEqual(points[0]['since'], self.begin)
        self.assertEqual(points[1]['until'], window['display_end'])
        self.assertEqual(points[1]['until']-points[1]['since'], 6*3600)

    def test_dst_timezone_does_not_change_elapsed_day_buckets(self):
        self.window['resets_at'] = datetime.fromisoformat('2026-11-05T14:43:00-08:00').timestamp()
        begin = self.window['resets_at']-7*86400
        samples = [dict(at=begin+hours*3600,used_percent=value) for hours,value in [(23,20),(24,25),(47,30)]]
        a = cycle_history(self.window, samples, 'America/Los_Angeles')['cycle_samples']
        b = cycle_history(self.window, samples, 'UTC')['cycle_samples']
        self.assertEqual([(p['at'],p['interval']) for p in a], [(p['at'],p['interval']) for p in b])
        self.assertTrue(all(p['until']-p['since']==86400 for p in a))


if __name__ == '__main__':
    unittest.main()

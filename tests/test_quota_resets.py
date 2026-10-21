"""Actual observation boundaries, reset attribution and public-feed freshness."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from contextlib import closing

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'src'))
from codex_usage.account import normalize_quota
from codex_usage.quota_history import QuotaHistory
from codex_usage.quota_alerts import QuotaAlerts, DEFAULT_ALERTS
from codex_usage.reset_forecast import normalize, ResetForecast


BASE = 1800000000
END = BASE+3*86400


def quota(at=BASE, used=80, count=3, reset=END, account='a', plan='pro'):
    value = normalize_quota({'accountId':account, 'rateLimits':{'planType':plan, 'primary':{
        'windowDurationMins':10080, 'resetsAt':reset, 'usedPercent':used}},
        'rateLimitResetCredits':{'availableCount':count, 'credits':[{
            'id':'secret-redeemable-id', 'expiresAt':END, 'description':'secret-description'}]}})
    value['fetched_at'] = datetime.fromtimestamp(at, timezone.utc).isoformat()
    return value


class ResetTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name)/'quota.sqlite'
        self.h = QuotaHistory(self.path)
        self.identity = quota()['_account_key']

    def tearDown(self):
        self.temp.cleanup()

    def record(self, at, used, **kwargs):
        return self.h.record(quota(at,used,**kwargs), 'Asia/Shanghai')['codex:primary']

    def test_cards_authoritative_zero_unknown_and_secrets_not_exposed(self):
        q = quota(count=3)
        self.assertEqual(q['reset_credits']['available_count'], 3)
        self.assertEqual(len(q['reset_credits']['details']), 1)
        self.assertNotIn('secret', json.dumps(q))
        self.assertEqual(quota(count=0)['reset_credits']['available_count'], 0)
        for value in (None, True, -1, 1.5, float('nan'), '3'):
            self.assertIsNone(quota(count=value)['reset_credits']['available_count'])

    def test_early_reset_same_deadline_closes_segment_and_preserves_before_and_after(self):
        self.record(BASE,80)
        self.record(BASE+60,2)
        self.assertEqual(self.h.resets.events(self.identity,BASE+60), [])
        p = self.record(BASE+120,3)
        e = self.h.resets.events(self.identity,BASE+120)[0]
        self.assertEqual((e['kind'],e['since'],e['at']), ('official',BASE,BASE+60))
        self.assertEqual(e['old_reset'],e['new_reset'])
        self.assertEqual(p['sample_count'],2)
        self.assertEqual(p['status'],'insufficient')
        self.assertLess(p['expected_percent'],4)
        cycles=self.h.cycles(self.identity,BASE+120)
        self.assertEqual(len(cycles),2)
        self.assertTrue(cycles[1]['completed'])
        self.assertEqual(cycles[1]['ended_reason'],'official')
        before=self.h.cycle(self.identity,cycles[1]['id'],BASE+120,'Asia/Shanghai')
        self.assertEqual(before['windows'][0]['used_percent'],80)
        self.assertEqual(before['cycle']['ends_at'],BASE+60)
        self.h=QuotaHistory(self.path)
        self.record(BASE+120,3)
        self.assertEqual(len(self.h.resets.events(self.identity,BASE+120)),1)

    def test_new_deadline_early_reset_uses_observed_start_and_archives_immediately(self):
        self.record(BASE,90)
        reset=BASE+60+7*86400
        self.record(BASE+60,0,reset=reset)
        p=self.record(BASE+120,1,reset=reset)
        self.assertEqual(p['start_event']['kind'],'official')
        cycles=self.h.cycles(self.identity,BASE+120)
        self.assertEqual(cycles[0]['starts_at'],BASE+60)
        self.assertTrue(cycles[1]['completed'])

    def test_multiple_resets_same_day_remain_distinct(self):
        for at,used in [(0,80),(60,0),(120,1),(180,60),(240,0),(300,1)]:
            self.record(BASE+at,used)
        self.assertEqual(len(self.h.resets.events(self.identity,BASE+300)),2)
        cycles=self.h.cycles(self.identity,BASE+300)
        self.assertEqual(len(cycles),3)
        self.assertEqual(sum(c['sample_count'] for c in cycles),6)
        self.assertEqual([c['completed'] for c in cycles],[False,True,True])

    def test_normal_boundary_is_recorded_but_schedule_adjustment_is_not(self):
        self.record(BASE,80,reset=BASE+30)
        self.record(BASE+60,1,reset=BASE+30+7*86400)
        self.assertEqual(self.h.resets.events(self.identity,BASE+60)[0]['kind'],'scheduled')
        self.record(BASE+120,2,reset=BASE+60+7*86400)
        self.assertEqual([e['kind'] for e in self.h.resets.events(self.identity,BASE+120)],['scheduled'])
        self.assertEqual(len(self.h.cycles(self.identity,BASE+120)),2)

    def test_full_allowance_sliding_every_minute_stays_one_segment_across_restart(self):
        first = self.record(BASE,0,reset=BASE+7*86400)
        for minute in range(1,80):
            at = BASE+minute*60
            p = self.record(at,0,reset=at+7*86400)
        self.assertEqual(self.h.resets.events(self.identity,at),[])
        self.assertEqual(p['segment_id'],first['segment_id'])
        self.assertEqual(p['sample_count'],80)
        self.h = QuotaHistory(self.path)
        cycles = self.h.cycles(self.identity,at)
        self.assertEqual(len(cycles),1)
        self.assertFalse(cycles[0]['completed'])
        self.assertEqual(cycles[0]['resets_at'],at+7*86400)
        self.assertEqual(cycles[0]['sample_count'],80)
        after_use = self.record(at+60,2,reset=at+60+7*86400)
        self.assertEqual(after_use['segment_id'],first['segment_id'])
        self.assertEqual(len(self.h.cycles(self.identity,at+60)),1)

    def test_real_reset_followed_by_idle_drift_keeps_one_event_and_both_histories(self):
        self.record(BASE,46)
        at = BASE+60
        self.record(at,0,reset=at+7*86400)
        for minute in range(2,12):
            now = BASE+minute*60
            p = self.record(now,0,reset=now+7*86400)
        events = self.h.resets.events(self.identity,now)
        self.assertEqual(len(events),1)
        self.assertEqual((events[0]['kind'],events[0]['at']),('official',at))
        self.assertEqual(p['start_event']['at'],at)
        self.assertEqual(p['sample_count'],11)
        cycles = self.h.cycles(self.identity,now)
        self.assertEqual(len(cycles),2)
        self.assertEqual(sum(c['sample_count'] for c in cycles),12)
        self.assertEqual(cycles[0]['starts_at'],at)
        old = self.h.cycle(self.identity,cycles[1]['id'],now)
        self.assertEqual(old['windows'][0]['used_percent'],46)
        self.assertEqual(old['cycle']['ends_at'],at)

    def test_legacy_adjustments_are_ignored_without_removing_raw_observations(self):
        self.record(BASE,10)
        for step in range(1,5):
            at = BASE+step*60
            self.record(at,10,reset=END+step*60)
            with closing(self.h.connect()) as db, db:
                self.h.resets.save(db,self.identity,dict(kind='adjustment',plan='pro',window='codex:primary',at=at))
        self.h = QuotaHistory(self.path)
        self.assertEqual(self.h.resets.events(self.identity,at),[])
        cycles = self.h.cycles(self.identity,at)
        self.assertEqual(len(cycles),1)
        self.assertEqual(cycles[0]['sample_count'],5)
        self.assertEqual(self.h.cycle(self.identity,cycles[0]['id'],at)['pace']['codex:primary']['sample_count'],5)
        with closing(self.h.connect()) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM observations').fetchone()[0],5)

    def test_idle_offline_gap_does_not_invent_a_scheduled_reset(self):
        self.record(BASE,0,reset=BASE+7*86400)
        self.record(BASE+8*86400,0,reset=BASE+15*86400)
        self.assertEqual(self.h.resets.events(self.identity,BASE+8*86400),[])
        self.assertEqual(len(self.h.cycles(self.identity,BASE+8*86400)),1)

    def test_idle_then_usage_has_168_hour_formal_window_and_separate_idle_history(self):
        self.record(BASE,46)
        reset_at = BASE+60
        for minute in range(38*60+1):
            at = reset_at+minute*60
            # Insert raw idle observations without rebuilding for each minute.
            if minute < 2:
                self.record(at,0,reset=at+7*86400)
            else:
                with closing(self.h.connect()) as db, db:
                    db.execute('INSERT INTO observations VALUES (?,?,?,?,?,?,?)',
                               (self.identity,'pro','codex:primary',10080,at+7*86400,at,0))
        begin = at+60
        q = quota(begin+3600,1,reset=begin+7*86400)
        p = self.h.record(q,'Asia/Shanghai')['codex:primary']
        w = q['windows'][0]
        self.assertEqual(w['segment_started_at'],reset_at)
        self.assertEqual(w['cycle_started_at'],begin)
        self.assertEqual(w['resets_at']-w['cycle_started_at'],168*3600)
        self.assertEqual(w['idle_period']['since'],reset_at)
        self.assertEqual(w['idle_period']['until'],begin)
        self.assertFalse(w['cycle_pending'])
        self.assertAlmostEqual(p['expected_percent'],100/168)
        self.assertEqual(len(p['cycle_samples']),1)
        self.assertEqual(p['cycle_samples'][0]['interval'],0)
        self.assertEqual(p['cycle_samples'][0]['since'],begin)
        self.assertEqual(len(p['daily_samples']),1)
        self.assertEqual(p['sample_count'],38*60+2)
        # Reading the same segment after restart uses the latest API window too.
        self.h = QuotaHistory(self.path)
        cycles = self.h.cycles(self.identity,begin+3600)
        replay = self.h.cycle(self.identity,cycles[0]['id'],begin+3600,'Asia/Shanghai')
        self.assertEqual(replay['windows'][0]['idle_period'],w['idle_period'])
        self.assertEqual(replay['pace']['codex:primary']['cycle_samples'],p['cycle_samples'])
        self.assertEqual(sum(c['sample_count'] for c in cycles),38*60+3)

    def test_sliding_unused_window_waits_but_fixed_zero_percent_window_can_start(self):
        self.record(BASE,46)
        self.record(BASE+60,0,reset=BASE+60+7*86400)
        q = quota(BASE+120,0,reset=BASE+120+7*86400)
        p = self.h.record(q)['codex:primary']
        self.assertEqual(p['status'],'waiting')
        self.assertIsNone(p['expected_percent'])
        self.assertTrue(q['windows'][0]['idle_period']['ongoing'])
        # Rounded 0% does not mean the clock is still sliding.
        q['fetched_at'] = datetime.fromtimestamp(BASE+180,timezone.utc).isoformat()
        p = self.h.record(q)['codex:primary']
        self.assertFalse(q['windows'][0]['cycle_pending'])
        self.assertFalse(q['windows'][0]['idle_period']['ongoing'])
        self.assertGreater(p['expected_percent'],0)

    def test_deadline_shift_after_real_usage_is_not_labeled_as_idle(self):
        self.record(BASE,10,reset=BASE+7*86400)
        q = quota(BASE+3600,11,reset=BASE+1800+7*86400)
        self.h.record(q)
        self.assertNotIn('idle_period',q['windows'][0])
        self.assertEqual(q['windows'][0]['cycle_started_at'],BASE+1800)

    def test_card_decrease_matches_adjacent_polls_and_does_not_duplicate_reset(self):
        self.record(BASE,80)
        self.record(BASE+60,1)
        self.record(BASE+120,2)
        self.record(BASE+180,3,count=2)
        events=self.h.resets.events(self.identity,BASE+180)
        self.assertEqual({e['kind'] for e in events},{'credit','credit_change'})
        e=next(e for e in events if e['kind']=='credit')
        self.assertEqual((e['before_count'],e['after_count']),(3,2))
        self.assertEqual(e['at'],BASE+60)
        self.record(BASE+240,4,count=2)
        self.assertEqual(len(self.h.resets.events(self.identity,BASE+240)),2)

    def test_count_only_drop_is_not_fabricated_quota_recovery_and_unknown_breaks_comparison(self):
        self.record(BASE,80)
        self.record(BASE+60,81,count=2)
        events=self.h.resets.events(self.identity,BASE+60)
        self.assertEqual([e['kind'] for e in events],['credit_change'])
        self.record(BASE+120,82,count=None)
        self.record(BASE+180,83,count=0)
        self.assertEqual(len(self.h.resets.events(self.identity,BASE+180)),1)

    def test_unconfirmed_correction_account_and_plan_changes_do_not_create_resets(self):
        self.record(BASE,80)
        self.record(BASE+60,40)
        self.record(BASE+120,81)
        self.record(BASE+180,0,account='b')
        self.record(BASE+240,0,plan='plus')
        self.record(BASE+300,81)
        self.assertEqual(self.h.resets.events(self.identity,BASE+300),[])
        self.assertEqual(self.h.resets.events('unrelated',BASE+300),[])

    def test_new_segment_rearms_alert_even_with_unchanged_deadline(self):
        store=QuotaAlerts(self.path)
        first=self.record(BASE,85)
        old=store.evaluate(quota(BASE,85),{'codex:primary':first},DEFAULT_ALERTS,BASE)
        store.acknowledge(self.identity,old[0])
        self.record(BASE+60,0)
        self.record(BASE+120,1)
        new=self.record(BASE+180,85)
        current=store.evaluate(quota(BASE+180,85),{'codex:primary':new},DEFAULT_ALERTS,BASE+180)
        self.assertNotEqual(old,current)
        self.assertFalse(store.list(self.identity,BASE+180,current)[0]['acknowledged'])

    def test_existing_alert_identity_is_preserved_until_a_real_reset(self):
        store=QuotaAlerts(self.path)
        old=store.evaluate(quota(BASE,85),{},DEFAULT_ALERTS,BASE)
        p=self.record(BASE,85)
        self.assertEqual(store.evaluate(quota(BASE,85),{'codex:primary':p},DEFAULT_ALERTS,BASE),old)


class PublicForecastTests(unittest.TestCase):
    def raw(self):
        iso=lambda n:datetime.fromtimestamp(n,timezone.utc).isoformat()
        return {'meta':{'generated_at':iso(BASE)},'data':{'active_watch':{
            'observed_at':iso(BASE-300),'expires_at':iso(BASE+900),'forecast_window':'within 24h',
            'reset_chance_percent':40,'text':'Public hint','source':{'url':'https://x.com/thsottiaux/status/123'}}}}

    def test_fresh_expired_missing_and_error_never_become_false_zero_or_live_probability(self):
        with tempfile.TemporaryDirectory() as d:
            f=ResetForecast(Path(d)/'forecast.json',lambda:self.raw())
            f._refresh()
            self.assertEqual(f.status(BASE)['probability'],40)
            self.assertIsNone(f.status(BASE+901)['probability'])
            f.error='Offline'
            self.assertIsNone(f.status(BASE)['probability'])
            f=ResetForecast(Path(d)/'forecast.json')
            self.assertEqual(f.status(BASE)['probability'],40)
            f.data=normalize({'meta':self.raw()['meta'],'data':{}})
            self.assertIsNone(f.status(BASE)['probability'])
            self.assertEqual(f.status(BASE)['state'],'quiet')

    def test_untrusted_urls_malformed_values_and_out_of_range_probabilities(self):
        for url in ('javascript:alert(1)','https://evil.example','https://x.com@evil.example'):
            raw=self.raw();raw['data']['active_watch']['source']['url']=url
            self.assertIsNone(normalize(raw)['signal']['source'])
        for value in (True,-1,101,'40',float('nan')):
            raw=self.raw();raw['data']['active_watch']['reset_chance_percent']=value
            self.assertIsNone(normalize(raw)['signal']['probability'])


if __name__=='__main__':
    unittest.main()

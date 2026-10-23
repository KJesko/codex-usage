import copy
import json
import os
import shutil
import sqlite3
import sys
import tempfile
import threading
import unittest
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from codex_usage.analytics import report
from codex_usage.app import Application, export_csv, make_server, validate_settings
from codex_usage.pricing import estimate
from codex_usage.reader import UsageIndex, read_log, normalize_path


def usage(inp, cache=0, out=0, reasoning=0, write=0):
    return dict(input_tokens=inp, cached_input_tokens=cache, output_tokens=out,
                reasoning_output_tokens=reasoning, cache_write_input_tokens=write, total_tokens=inp+out)


def token(at, total, last=None):
    return {"timestamp": at, "type": "event_msg", "payload": {
        "type": "token_count", "info": {"total_token_usage": total, "last_token_usage": last or total}}}


def context(model="gpt-6-astra", cwd=None):
    return {"type": "turn_context", "payload": {"model": model, "cwd": cwd}}


def header(sid="one", parent=None):
    return {"timestamp": "2026-10-12T06:00:00Z", "type": "session_meta", "payload": {
        "id": sid, "cwd": "/synthetic/project-a", "forked_from_id": parent}}


def write_log(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(r)+"\n" for r in rows), encoding="utf-8")


class UsageTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        self.root = self.base / "codex"
        self.path = self.root / "sessions" / "test.jsonl"
        self.rows = [header(), context(), token("2026-10-12T06:59:00Z", usage(100, 40, 10, 2)),
                     token("2026-10-12T07:01:00Z", usage(300, 140, 30, 7), usage(200, 100, 20, 5))]
        write_log(self.path, self.rows)
        self.index = UsageIndex([self.root], self.base / "cache.sqlite")
        self.config = {"timezone": "America/Los_Angeles", "prices": {}}
        self.now = datetime(2026, 10, 15, 12, tzinfo=timezone.utc)

    def tearDown(self):
        self.temp.cleanup()

    def report(self, query=None):
        return report(self.index.snapshot(), query or {}, self.config, now=self.now)

    def test_cumulative_delta_and_no_double_counting(self):
        write_log(self.path, self.rows + [self.rows[-1], self.rows[-1]])
        r = self.report()
        self.assertEqual(r["summary"]["total"], 330)
        self.assertEqual(r["summary"]["events"], 2)
        self.assertEqual(r["summary"]["reasoning"], 7)
        self.assertEqual(r["summary"]["input"], 300)
        self.assertEqual(r["summary"]["uncached"], 160)

    def test_midnight_and_monday_boundaries(self):
        daily = {x["date"]: x["total"] for x in self.report()["timeline"]}
        self.assertEqual(daily["2026-10-11"], 110)
        self.assertEqual(daily["2026-10-12"], 220)
        weekly = {x["date"]: x["total"] for x in self.report({"grain": "week"})["timeline"]}
        self.assertEqual(weekly, {"2026-10-05": 110, "2026-10-12": 220})
        self.assertEqual(self.report()["week"]["total"], 220)

    def test_timezone_dst_fall_back(self):
        rows = [header(), context(), token("2026-11-01T08:30:00Z", usage(10)),
                token("2026-11-01T09:30:00Z", usage(20), usage(10))]
        write_log(self.path, rows)
        r = self.report({"since": "2026-11-01", "until": "2026-11-01"})
        self.assertEqual(len(r["timeline"]), 1)
        self.assertEqual(r["summary"]["total"], 20)

    def test_recent_periods_use_beijing_boundaries_and_dimension_filters(self):
        write_log(self.path, [header(), context(),
            token('2026-09-30T15:59:59Z', usage(100)),
            token('2026-09-30T16:00:00Z', usage(300), usage(200)),
            context('gpt-6.1-sol', cwd='/synthetic/project-b'),
            token('2026-10-11T16:00:00Z', usage(600), usage(300)),
            token('2026-10-14T16:00:00Z', usage(1000), usage(400)),
            token('2026-10-15T16:00:00Z', usage(1500), usage(500))])
        self.config['timezone'] = 'Asia/Shanghai'
        # Quick periods are current calendar periods, independent of the chart range.
        r = self.report({'since': '2026-10-01', 'until': '2026-10-01'})
        self.assertEqual(r['summary']['total'], 200)
        self.assertEqual([r[k]['total'] for k in ('today', 'week', 'month')], [400, 700, 900])
        expected_cost = 0.002 + estimate({'model': 'gpt-6.1-sol', 'uncached': 700,
            'cached': 0, 'write': 0, 'output': 0, 'context_input': 400})['cost']
        self.assertAlmostEqual(r['month']['cost'], expected_cost)
        for query in ({'model': 'gpt-6.1-sol'}, {'project': '/synthetic/project-b'}):
            filtered = self.report(query)
            self.assertEqual(filtered['month']['total'], 700)
        for dimension in ('source', 'session', 'account'):
            self.assertEqual(self.report({dimension: 'missing'})['month']['total'], 0)
        self.config['usage_since'] = '2026-10-14'
        self.assertEqual(self.report()['month']['total'], 400)

    def test_machine_options_include_configured_sources_without_recent_events(self):
        self.config.update(sources=[str(self.root), str(self.base / 'second')],
            usage_since='2026-10-14', remotes=[
                {'id': '101', 'name': '101 服务器', 'enabled': True},
                {'id': '100', 'name': '100 服务器', 'enabled': False}])
        r = self.report()
        self.assertEqual(r['summary']['total'], 0)
        self.assertEqual(r['options']['sources'], [
            {'id': 'local', 'name': '本机'}, {'id': 'ssh:101', 'name': '101 服务器'}])

    def test_saved_beijing_start_counts_only_new_deltas_in_all_dimensions(self):
        write_log(self.path, [header(), context(),
            token("2026-10-13T15:59:59.999Z", usage(100, 40, 10)),
            token("2026-10-13T16:00:00Z", usage(300, 140, 30), usage(200, 100, 20)),
            context("gpt-6.1-sol"),
            token("2026-10-14T16:00:00Z", usage(600, 240, 60), usage(300, 100, 30))])
        write_log(self.root / 'sessions' / 'old.jsonl',
                  [header('old'), context('old-model'), token('2026-10-13T12:00:00Z', usage(999))])
        self.config.update(timezone='Asia/Shanghai', usage_since='2026-10-14')
        r = self.report({'since': '2026-10-01'})
        self.assertEqual(r['summary']['total'], 550)
        self.assertEqual(r['today']['total'], 330)
        self.assertEqual(r['week']['total'], 550)
        self.assertEqual(r['month']['total'], 550)
        self.assertEqual(r['range']['since'], '2026-10-14')
        self.assertEqual(r['usage_start']['at'], '2026-10-14T00:00:00+08:00')
        self.assertEqual([(x['date'], x['total']) for x in r['timeline']],
                         [('2026-10-14', 220), ('2026-10-15', 330)])
        for dimension in ('timeline', 'projects', 'sessions', 'models'):
            self.assertEqual(sum(x['total'] for x in r[dimension]), 550)
            self.assertAlmostEqual(sum(x['known_cost'] for x in r[dimension]), r['summary']['known_cost'])
            csv_text = export_csv(r, dimension).decode('utf-8-sig')
            self.assertNotIn('old-model', csv_text)
        self.assertEqual(len(r['sessions']), 1)
        self.assertNotIn('old-model', r['options']['models'])
        self.assertEqual(self.report({'session': 'one'})['summary']['total'], 550)
        self.assertEqual(self.report({'source': 'missing'})['summary']['total'], 0)
        self.assertEqual(self.report({'grain': 'week'})['timeline'][0]['total'], 550)
        # A display-zone override cannot move the saved Beijing cutoff.
        utc_report = self.report({'timezone': 'UTC'})
        self.assertEqual(utc_report['summary']['total'], 550)
        self.assertEqual(utc_report['range']['since'], '2026-10-13')
        before = self.report({'since': '2026-10-01', 'until': '2026-10-13'})
        self.assertEqual(before['summary']['total'], 0)
        self.assertEqual(before['timeline'], [])
        # Clearing the setting restores history without rewriting or deleting logs.
        self.config['usage_since'] = ''
        self.assertEqual(self.report()['summary']['total'], 1659)

    def test_saved_start_does_not_count_undated_lifetime_metadata(self):
        snapshot = self.index.snapshot()
        snapshot['missing_projects'] = [{'id': 'old', 'source': 'local', 'source_name': '本机',
                                         'metadata_tokens': 90000}]
        config = {**self.config, 'timezone': 'Asia/Shanghai', 'usage_since': '2026-10-14'}
        r = report(snapshot, {}, config, now=self.now)
        self.assertEqual(r['missing_projects'], [])
        self.assertEqual(r['summary']['total'], 0)
        self.assertEqual(len(r['timeline']), 2)
        self.assertEqual(snapshot['missing_projects'][0]['metadata_tokens'], 90000)

    def test_model_switch_preserves_previous_attribution(self):
        self.rows.insert(3, context("gpt-6.1-sol"))
        write_log(self.path, self.rows)
        r = self.report()
        models = {m["name"]: m["total"] for m in r["models"]}
        self.assertEqual(models, {"gpt-6-astra": 110, "gpt-6.1-sol": 220})
        self.assertEqual(self.report({"model": "gpt-6.1-sol"})["summary"]["total"], 220)

    def test_daily_models_reconcile_with_totals_and_fill_zero_days(self):
        write_log(self.path, [header(), context(),
            token('2026-10-13T15:59:59Z', usage(100)),
            token('2026-10-13T16:00:00Z', usage(300), usage(200)),
            context('gpt-6.1-sol', cwd='/synthetic/project-b'),
            token('2026-10-14T15:59:59Z', usage(600), usage(300)),
            token('2026-10-14T16:00:00Z', usage(1000), usage(400)),
            context('future-model', cwd='/synthetic/project-b'),
            token('2026-10-15T00:00:00Z', usage(1500), usage(500))])
        self.config.update(timezone='Asia/Shanghai', usage_since='2026-10-14')
        r = self.report({'since':'2026-10-01', 'until':'2026-10-16', 'grain':'month'})
        daily = r['model_timeline']
        # One session switching models must not count twice; zero days stay zero.
        self.assertEqual([d['sessions'] for d in daily], [1, 1, 0])
        self.assertEqual([d['date'] for d in daily], ['2026-10-14','2026-10-15','2026-10-16'])
        self.assertEqual([{m['name']:m['total'] for m in d['models']} for d in daily], [
            {'gpt-6-astra':200, 'gpt-6.1-sol':300},
            {'gpt-6.1-sol':400, 'future-model':500}, {}])
        cells = [m for d in daily for m in d['models']]
        self.assertEqual(sum(m['total'] for m in cells), r['summary']['total'])
        self.assertAlmostEqual(sum(m['known_cost'] for m in cells), r['summary']['known_cost'])
        for model in r['models']:
            self.assertEqual(sum(c['total'] for c in cells if c['name']==model['name']), model['total'])
        unknown = next(c for c in cells if c['name']=='future-model')
        self.assertIsNone(unknown['cost'])
        self.assertEqual(unknown['unpriced_tokens'],500)
        self.assertEqual(len(r['timeline']),1)  # Monthly overview still has daily model series.
        before = self.report({'since':'2026-10-01','until':'2026-10-13'})
        self.assertEqual(before['model_timeline'],[])

    def test_daily_models_follow_all_report_dimensions(self):
        self.rows.insert(3, context('gpt-6.1-sol', cwd='/synthetic/project-b'))
        write_log(self.path,self.rows)
        snapshot = self.index.snapshot()
        event = snapshot['events'][-1]
        event.update(source='ssh:101', source_name='101', account='second-account')
        for query in ({'project':'/synthetic/project-b'}, {'model':'gpt-6.1-sol'},
                      {'source':'ssh:101'}, {'account':'second-account'}, {'since':'2026-10-12'}):
            r=report(snapshot,query,self.config,now=self.now)
            self.assertEqual(sum(m['total'] for d in r['model_timeline'] for m in d['models']),220)
        r=report(snapshot,{'session':'missing'},self.config,now=self.now)
        self.assertTrue(all(d['models']==[] for d in r['model_timeline']))

    def test_filters_apply_to_every_dimension(self):
        self.rows.insert(3, context(cwd="/synthetic/project-b"))
        write_log(self.path, self.rows)
        r = self.report({"project": "/synthetic/project-b", "since": "2026-10-12"})
        for dimension in ["timeline", "models", "projects", "sessions"]:
            self.assertEqual(sum(row["total"] for row in r[dimension]), 220)
        self.assertEqual(self.report({"session": "missing"})["summary"]["total"], 0)

    def test_project_daily_detail_aggregates_sessions_and_keeps_zero_days(self):
        write_log(self.root / 'sessions' / 'second.jsonl', [header('two'),
                  context('gpt-6.1-sol'),
                  token('2026-10-11T15:00:00Z', usage(20, 0, 2)),
                  token('2026-10-12T18:00:00Z', usage(70, 20, 7), usage(50, 20, 5))])
        write_log(self.root / 'sessions' / 'other-project.jsonl', [header('other'),
                  context(cwd='/synthetic/project-b'),
                  token('2026-10-12T18:00:00Z', usage(999))])
        snapshot = self.index.snapshot()
        # A same-named project on another machine must remain separate.
        remote = {**snapshot['events'][-1], 'project': 'ssh:101:/synthetic/project-a',
                  'project_path': '/synthetic/project-a', 'source': 'ssh:101'}
        snapshot['events'].append(remote)
        config = {**self.config, 'timezone': 'Asia/Shanghai', 'usage_since': '2026-10-12'}
        query = {'project': '/synthetic/project-a', 'grain': 'day',
                 'since': '2026-10-11', 'until': '2026-10-14'}
        result = report(snapshot, query, config, now=self.now)
        self.assertEqual([(r['date'], r['total'], r['sessions']) for r in result['timeline']],
                         [('2026-10-12', 330, 1), ('2026-10-13', 55, 1), ('2026-10-14', 0, 0)])
        self.assertEqual(result['summary']['total'], 385)
        self.assertEqual(result['summary']['sessions'], 2)
        self.assertAlmostEqual(sum(r['known_cost'] for r in result['timeline']),
                               result['summary']['known_cost'])
        filtered = report(snapshot, {**query, 'model': 'gpt-6.1-sol'}, config, now=self.now)
        self.assertEqual(filtered['summary']['total'], 55)
        self.assertEqual(filtered['summary']['sessions'], 1)

    def test_archive_and_second_source_deduplication(self):
        archive = self.root / "archived_sessions" / "copy.jsonl"
        write_log(archive, self.rows)
        second = self.base / "second"
        write_log(second / "sessions" / "copy.jsonl", self.rows)
        self.index = UsageIndex([self.root, second], self.base / "cache.sqlite")
        self.assertEqual(self.report()["summary"]["total"], 330)
        self.assertEqual(self.report()["summary"]["sessions"], 1)

    def test_fork_inherited_history_not_billed_twice(self):
        fork = [header("child", "one"), *self.rows[1:],
                token("2026-10-13T12:00:00Z", usage(310,140,31,7), usage(10,0,1))]
        write_log(self.root / "sessions" / "fork.jsonl", fork)
        r=self.report()
        self.assertEqual(r["summary"]["total"], 341)
        self.assertEqual(next(s for s in r["sessions"] if s["id"]=="child")["total"],11)

    def test_counter_reset_uses_last_usage(self):
        self.rows.append(token("2026-10-13T10:00:00Z", usage(50,10,4), usage(50,10,4)))
        write_log(self.path,self.rows)
        r=self.report()
        self.assertEqual(r["summary"]["total"],384)
        self.assertEqual(r["coverage"]["warnings"]["counter_resets"],1)

    def test_first_event_with_unobserved_prefix_counts_only_last(self):
        write_log(self.path,[header(),context(),token("2026-10-13T10:00:00Z",usage(5000),usage(100))])
        r=self.report()
        self.assertEqual(r["summary"]["total"],100)
        self.assertEqual(r["coverage"]["warnings"]["unobserved_prefixes"],1)

    def test_partial_writes_and_bad_rows_recover(self):
        extra=token("2026-10-13T10:00:00Z",usage(310,140,31,7),usage(10,0,1))
        with self.path.open('ab') as f:
            f.write(b'not json\n')
            f.write(json.dumps(extra).encode())
        r=self.report()
        self.assertEqual(r["summary"]["total"],330)
        self.assertEqual(r["coverage"]["warnings"]["invalid_records"],1)
        with self.path.open('ab') as f: f.write(b'\n')
        self.assertEqual(self.report()["summary"]["total"],341)

    def test_cached_snapshots_reused_and_survive_log_deletion(self):
        self.report()
        self.assertEqual(self.report()["coverage"]["changed_files"],0)
        self.path.unlink()
        r=self.report()
        self.assertEqual(r["summary"]["total"],330)
        self.assertEqual(r["coverage"]["retained_files"],1)

    def test_model_unknown_is_not_zero_dollars(self):
        self.rows[1]=context('future-model')
        write_log(self.path,self.rows)
        r=self.report()
        self.assertIsNone(r["summary"]["cost"])
        self.assertEqual(r["summary"]["unpriced_tokens"],330)
        self.assertEqual(r["pricing"]["unknown_models"],['future-model'])
        self.config['prices']={'future-model':dict(input=2,cached=1,write=2.5,output=10)}
        self.assertAlmostEqual(self.report()["summary"]["cost"],.00076)

    def test_cache_write_reasoning_and_long_context_prices(self):
        e={"model":"gpt-6-astra","uncached":100000,"cached":100000,"write":100000,
           "output":10000,"reasoning":8000,"context_input":300000}
        p=estimate(e)
        self.assertAlmostEqual(p['cost'],5.45)  # 2 + .2 + 2.5 + .75
        e['context_input']=272000
        self.assertAlmostEqual(estimate(e)['cost'],2.85)

    def test_total_session_length_never_triggers_long_context(self):
        rows=[header(),context(),token("2026-10-12T06:59:00Z",usage(200000)),
              token("2026-10-12T07:01:00Z",usage(400000),usage(200000))]
        write_log(self.path,rows)
        self.assertAlmostEqual(self.report()['summary']['cost'],4)

    def test_terra_cost_includes_cache_writes_and_exact_long_context_boundary(self):
        event = dict(model='gpt-5.6-terra', uncached=100000, cached=100000,
                     write=72000, output=10000, reasoning=8000, context_input=272000)
        normal = estimate(event)
        self.assertFalse(normal['long_context'])
        self.assertAlmostEqual(normal['cost'], .52)  # .20 + .02 + .18 + .12
        self.assertAlmostEqual(normal['cache_savings'], .18)
        long = estimate({**event, 'uncached': 100001, 'context_input': 272001})
        self.assertTrue(long['long_context'])
        self.assertAlmostEqual(long['cost'], .980004)  # .400004 + .04 + .36 + .18
        self.assertAlmostEqual(long['cache_savings'], .36)

    def test_terra_historical_usage_is_priced_in_every_report_dimension(self):
        self.rows[1] = context('gpt-5.6-terra')
        write_log(self.path, self.rows)
        result = self.report()
        self.assertEqual(result['summary']['unpriced_tokens'], 0)
        self.assertNotIn('gpt-5.6-terra', result['pricing']['unknown_models'])
        # 160 uncached input, 140 cached input and 30 output; reasoning is
        # already included in output and must not be charged a second time.
        expected = .000708
        self.assertAlmostEqual(result['summary']['cost'], expected)
        for dimension in ('timeline', 'models', 'projects', 'sessions'):
            self.assertAlmostEqual(sum(row['cost'] for row in result[dimension]), expected)

    def test_known_snapshot_alias_only(self):
        e={"model":"gpt-6-astra-2026-09-01","uncached":100,"cached":0,"write":0,"output":0,"context_input":100}
        self.assertAlmostEqual(estimate(e)['cost'],.001)
        e['model']='gpt-6-astra-fiction'
        self.assertIsNone(estimate(e)['cost'])

    def test_windows_extended_path_is_same_identity(self):
        self.assertEqual(normalize_path(r'\\?\C:\Users\Test\file.jsonl'),normalize_path(r'c:\users\test\file.jsonl'))
        self.assertEqual(normalize_path(r'\\?\UNC\server\share\file.jsonl'),'//server/share/file.jsonl')

    def test_custom_alias_price_takes_precedence(self):
        e={"model":"gpt-5.6","uncached":1000000,"cached":0,"write":0,"output":0,"context_input":1000}
        self.assertEqual(estimate(e,{'gpt-5.6':dict(input=7,cached=1,write=7,output=10)})['cost'],7)

    def test_sqlite_metadata_title_coverage_and_no_credentials(self):
        with closing(sqlite3.connect(self.root/'state_5.sqlite')) as db, db:
            db.execute('CREATE TABLE threads(id TEXT,title TEXT,rollout_path TEXT,cwd TEXT,creator_account_id TEXT)')
            db.executemany('INSERT INTO threads VALUES(?,?,?,?,?)',[
                ('one','=SUM(A1:A2)',str(self.path),'/synthetic/project-a','sensitive-account'),
                ('remote','Remote session','/missing/log.jsonl','/remote','sensitive-account')])
        (self.root/'auth.json').write_text('MUST NOT BE READ')
        r=self.report()
        self.assertEqual(r['coverage']['missing_sessions'],1)
        self.assertEqual(r['sessions'][0]['title'],'=SUM(A1:A2)')
        self.assertNotIn('sensitive-account',json.dumps(r))
        self.assertIn("'=SUM(A1:A2)",export_csv(r,'sessions').decode('utf-8-sig'))

    def test_invalid_date_zone_range_and_grain(self):
        for q in ({'since':'2026-02-30'},{'timezone':'invalid/place'},
                  {'since':'2026-10-15','until':'2026-10-01'},{'grain':'bad'}):
            with self.assertRaises(ValueError): self.report(q)

    def test_empty_data_has_explicit_zero_days(self):
        r=self.report({'since':'2026-10-01','until':'2026-10-03'})
        self.assertEqual(len(r['timeline']),3)
        self.assertEqual(r['summary']['total'],0)

    def test_api_validation_export_and_local_access(self):
        app=Application(self.base/'app',[self.root],'America/Los_Angeles')
        server=make_server(app,0)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        url=f'http://127.0.0.1:{server.server_port}'
        try:
            with urlopen(url+'/api/health') as response:
                self.assertEqual(json.load(response)['app'],'codex-usage')
            with urlopen(url+'/api/data?since=2026-10-11&until=2026-10-12') as response:
                self.assertEqual(json.load(response)['summary']['total'],330)
            with urlopen(url+'/api/export?dimension=sessions') as response:
                self.assertIn('text/csv',response.headers['Content-Type'])
                self.assertTrue(response.read().startswith(b'\xef\xbb\xbf'))
            for path in ['/api/data?since=bad','/api/export?dimension=bad']:
                with self.assertRaises(HTTPError) as ex: urlopen(url+path)
                self.assertEqual(ex.exception.code,400)
            with self.assertRaises(HTTPError) as ex: urlopen(Request(url+'/api/data',headers={'Host':'evil.example'}))
            self.assertEqual(ex.exception.code,403)
            with self.assertRaises(HTTPError) as ex: urlopen(Request(url+'/api/settings',data=b'{}',headers={'Origin':'https://evil.example'}))
            self.assertEqual(ex.exception.code,403)
            with urlopen(url+'/api/settings') as response: settings=json.load(response)
            settings['timezone']='Asia/Shanghai'
            settings['usage_since']='2026-10-14'
            request=Request(url+'/api/settings',data=json.dumps(settings).encode(),headers={'X-CSRF-Token':settings['csrf'],'Content-Type':'application/json','Origin':url})
            with urlopen(request) as response: self.assertTrue(json.load(response)['ok'])
            self.assertEqual(json.loads(app.config_path.read_text())['timezone'],'Asia/Shanghai')
            self.assertEqual(Application(app.data_dir).config['usage_since'], '2026-10-14')
            with urlopen(url+'/api/data?since=2026-10-01') as response:
                self.assertEqual(json.load(response)['summary']['total'], 0)
            with urlopen(url+'/') as response:
                self.assertIn(b'app.js',response.read())
                self.assertIn("frame-ancestors 'none'",response.headers['Content-Security-Policy'])
            with urlopen(url+'/model-charts.js') as response:
                self.assertEqual(response.headers.get_content_type(), 'text/javascript')
                self.assertIn(b'const ModelCharts', response.read())
            with urlopen(url+'/activity-heatmap.js') as response:
                self.assertEqual(response.headers.get_content_type(), 'text/javascript')
                self.assertIn(b'const ActivityHeatmap', response.read())
            with urlopen(url+'/project-treemap.js') as response:
                self.assertEqual(response.headers.get_content_type(), 'text/javascript')
                self.assertIn(b'const ProjectTreemap', response.read())
            with urlopen(url+'/usage-insights.js') as response:
                self.assertEqual(response.headers.get_content_type(), 'text/javascript')
                self.assertIn(b'const UsageInsights', response.read())
        finally:
            server.shutdown();server.server_close();thread.join(timeout=2)

    def test_settings_reject_nonfinite_negative_and_bad_paths(self):
        valid={'timezone':'UTC','sources':[str(self.root)],'prices':{'custom':dict(input=1,cached=.1,write=1.25,output=5)}}
        self.assertEqual(validate_settings(valid)['timezone'],'UTC')
        self.assertEqual(validate_settings(valid)['timezone_mode'], 'manual')
        self.assertEqual(validate_settings({**valid, 'timezone_mode': 'system'})['timezone_mode'], 'system')
        with self.assertRaises(ValueError): validate_settings({**valid, 'timezone_mode': 'invalid'})
        self.assertEqual(validate_settings(valid)['usage_since'], '')
        for bad in [None, True, 123, '2026-02-30', '20261014', '2026-10-14T00:00:00Z']:
            with self.assertRaises(ValueError): validate_settings({**valid, 'usage_since': bad})
        for bad in [-1,float('nan'),float('inf'),True]:
            change=copy.deepcopy(valid);change['prices']['custom']['input']=bad
            with self.assertRaises(ValueError): validate_settings(change)
        with self.assertRaises(ValueError): validate_settings({**valid,'sources':['relative/path']})


if __name__=='__main__':
    unittest.main()

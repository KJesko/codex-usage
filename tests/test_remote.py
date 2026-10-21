import copy
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from codex_usage.remote import (validate_remotes, collector_script, merge_snapshot,
                               fetch_remote, RemoteSync, read_snapshot)
from codex_usage.reader import UsageIndex
from codex_usage.analytics import report
from test_usage import header, context, token, usage, write_log


class RemoteTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.root = self.base / 'codex'
        self.log = self.root / 'sessions/one.jsonl'
        self.rows = [header('one'), context(), token('2026-10-12T07:00:00Z', usage(100, 40, 10))]
        write_log(self.log, self.rows)
        (self.root / 'auth.json').write_text('AUTH_MUST_NOT_TRANSFER')
        self.remote = validate_remotes([{'host': 'example-host', 'name': '101', 'path': '/codex'}])[0]
        self.config = {'timezone': 'UTC', 'prices': {}}

    def collect(self, previous=None):
        script = collector_script(self.remote, previous or {})
        # Test the exact stdin program; only substitute its requested root for this OS.
        marker = '\nREQUEST = json.loads('
        start = script.index(marker)
        end = script.index('\n', start + 1)
        request = {'path': str(self.root), 'known': {k: v['signature'] for k,v in (previous or {}).get('files', {}).items()}}
        script = script[:start] + '\nREQUEST = ' + repr(request) + script[end:]
        result = subprocess.run([sys.executable, '-X', 'utf8', '-'], input=script.encode(),
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr.decode(errors='replace'))
        return json.loads(result.stdout)

    def store(self, snapshot):
        directory = self.base / 'remote'
        directory.mkdir(exist_ok=True)
        (directory / (self.remote['id'] + '.json')).write_text(json.dumps(snapshot), encoding='utf-8')
        return directory

    def test_collector_no_messages_or_auth_and_incremental(self):
        rows = self.rows + [{'type': 'response_item', 'payload': {'message': 'PRIVATE_CHAT_MUST_NOT_TRANSFER'}}]
        write_log(self.log, rows)
        first = merge_snapshot(self.collect(), {})
        encoded = json.dumps(first)
        self.assertNotIn('AUTH_MUST_NOT_TRANSFER', encoded)
        self.assertNotIn('PRIVATE_CHAT_MUST_NOT_TRANSFER', encoded)
        again = self.collect(first)
        self.assertTrue(all('data' not in f for f in again['files'].values()))
        merged = merge_snapshot(again, first)
        self.assertEqual(merged['files'], first['files'])
        write_log(self.log, rows + [token('2026-10-12T08:00:00Z', usage(200, 60, 20))])
        changed = merge_snapshot(self.collect(first), first)
        self.assertEqual(sum(e['total'] for f in changed['files'].values() for e in f['data']['events']), 220)

    def test_copies_deduplicated_machine_filter_and_offline_retention(self):
        saved = merge_snapshot(self.collect(), {})
        directory = self.store(saved)
        index = UsageIndex([self.root], self.base/'index.sqlite', [self.remote], directory)
        data = report(index.snapshot(), {}, self.config)
        self.assertEqual(data['summary']['total'], 110)  # local and remote copy, only once
        self.assertEqual(data['projects'][0]['source_name'], '101')
        self.assertTrue(data['projects'][0]['id'].startswith('ssh:'))
        self.assertEqual(report(index.snapshot(), {'source':'local'}, self.config)['summary']['total'], 0)
        source = 'ssh:' + self.remote['id']
        self.assertEqual(report(index.snapshot(), {'source':source}, self.config)['summary']['total'], 110)
        self.log.unlink()
        retained = merge_snapshot(self.collect(saved), saved)
        self.store(retained)
        data = report(index.snapshot(), {}, self.config)
        self.assertEqual(data['summary']['total'], 110)
        self.assertGreater(data['coverage']['retained_files'], 0)
        disabled = UsageIndex([], self.base/'disabled.sqlite', [{**self.remote,'enabled':False}], directory)
        self.assertEqual(disabled.snapshot()['events'], [])

    def test_missing_history_is_separate_from_dated_usage(self):
        db = sqlite3.connect(self.root/'state_5.sqlite')
        db.execute('CREATE TABLE threads(id TEXT, cwd TEXT, title TEXT, tokens_used INTEGER)')
        db.execute('INSERT INTO threads VALUES(?,?,?,?)', ('lost','/project/lost','Old',999999))
        db.commit(); db.close()
        directory = self.store(merge_snapshot(self.collect(), {}))
        index = UsageIndex([], self.base/'index.sqlite', [self.remote], directory)
        data = report(index.snapshot(), {'since':'2026-10-15'}, self.config)
        self.assertEqual(data['summary']['total'], 0)
        self.assertEqual(data['missing_projects'][0]['metadata_tokens'], 999999)
        self.assertEqual(data['missing_projects'][0]['source_name'], '101')
        self.assertEqual(data['missing_projects'][0]['sessions'], 1)

    def test_bad_config_and_argument_injection(self):
        for host in ('-oProxyCommand=bad','host;touch','host\nother','$(bad)','user host'):
            with self.assertRaises(ValueError): validate_remotes([{'host':host}])
        for row in ({'host':'ok','path':'relative'}, {'host':'ok','interval':True}, {'host':'ok','enabled':'yes'}):
            with self.assertRaises(ValueError): validate_remotes([row])
        with self.assertRaises(ValueError): validate_remotes([self.remote,self.remote])
        evil = {**self.remote, 'path': "/tmp/'; touch X; #"}
        called = []
        def runner(command, **kwargs):
            called.append(command)
            self.assertNotIn(evil['path'], command)
            self.assertIn('StrictHostKeyChecking=yes',command)
            self.assertIn('BatchMode=yes',command)
            return subprocess.CompletedProcess(command, 255, b'', b'Permission denied (publickey).')
        with patch('codex_usage.remote.shutil.which', return_value='ssh'):
            with self.assertRaisesRegex(ValueError, 'Permission denied'): fetch_remote(evil, {}, runner)
        self.assertEqual(called[0][-3:], ['example-host','python3','-'])

    def test_sync_error_preserves_cache_and_reports_failure(self):
        previous = merge_snapshot(self.collect(), {})
        directory = self.store(previous)
        changed=[]
        manager = RemoteSync(directory,lambda:changed.append(True))
        with patch('codex_usage.remote.fetch_remote',side_effect=ValueError('offline')):
            manager.request([self.remote],force=True)
            for thread in manager.threads:thread.join(5)
        self.assertEqual(read_snapshot(directory,self.remote), previous)
        status=manager.statuses([self.remote])[0]
        self.assertEqual(status['error'],'offline')
        self.assertFalse(status['busy'])
        self.assertTrue(status['synced_at'])
        self.assertTrue(changed)

    def test_incomplete_delta_is_rejected(self):
        with self.assertRaisesRegex(ValueError,'不完整'):
            merge_snapshot({'version':1,'metadata':{},'files':{'missing':{'signature':[1,2,3]}}},{})


if __name__ == '__main__':
    unittest.main()

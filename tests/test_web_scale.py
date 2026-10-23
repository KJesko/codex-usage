"""Synthetic local logs only; no real account, remote server or network is used."""
import json
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from codex_usage.reader import UsageIndex
from codex_usage.analytics import report


class WebScaleTests(unittest.TestCase):
    def test_one_hundred_thousand_events_incremental_scan_and_report(self):
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder)
            logs = base / 'logs' / 'sessions'
            logs.mkdir(parents=True)
            for session in range(1000):
                rows = [{'type': 'session_meta', 'payload': {'id': f'scale-{session}', 'cwd': f'/synthetic/project-{session % 100}'}},
                        {'type': 'turn_context', 'payload': {'model': 'gpt-5.6-terra'}}]
                for event in range(100):
                    total = {'input_tokens': (event + 1) * 10, 'output_tokens': 0, 'total_tokens': (event + 1) * 10}
                    rows.append({'timestamp': f'2026-10-14T12:{event // 60:02}:{event % 60:02}Z', 'type': 'event_msg',
                                 'payload': {'type': 'token_count', 'info': {'total_token_usage': total, 'last_token_usage': {'input_tokens': 10, 'total_tokens': 10}}}})
                (logs / f'{session}.jsonl').write_text(''.join(json.dumps(row) + '\n' for row in rows), encoding='utf-8')
            index = UsageIndex([base / 'logs'], base / 'usage.sqlite')
            start = time.perf_counter()
            snapshot = index.snapshot()
            scan = time.perf_counter() - start
            self.assertEqual(len(snapshot['events']), 100000)
            start = time.perf_counter()
            result = report(snapshot, {'since': '2026-10-01', 'until': '2026-10-31'}, {'timezone': 'UTC', 'prices': {}})
            render = time.perf_counter() - start
            self.assertEqual(result['summary']['total'], 1000000)
            self.assertEqual(len(result['sessions']), 1000)
            self.assertEqual(len(result['projects']), 100)
            start = time.perf_counter()
            cached = index.snapshot()
            rescan = time.perf_counter() - start
            self.assertEqual(len(cached['events']), 100000)
            self.assertEqual(cached['coverage']['changed_files'], 0)
            print(f'\nScale: 100,000 events / 1,000 files: scan={scan:.3f}s report={render:.3f}s unchanged_scan={rescan:.3f}s')

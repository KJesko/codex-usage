"""Public reset announcements; never sends local account information.

The legacy module/cache name is retained for existing installations.
"""
from datetime import datetime, timezone
import json
import math
import threading
import time
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

SOURCE = 'https://codex-resets.com'
ENDPOINT = SOURCE + '/api/v1/status'


def timestamp(value):
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00')) if isinstance(value, str) else None
        return parsed.astimezone(timezone.utc).timestamp() if parsed and parsed.tzinfo else None
    except (ValueError, OverflowError, OSError):
        return None


def public_link(value):
    if not isinstance(value, str):
        return None
    try:
        parsed = urlsplit(value)
        return value if parsed.scheme == 'https' and parsed.netloc in ('x.com', 'twitter.com', 'codex-resets.com', 'openai.com') else None
    except ValueError:
        return None


def normalize(raw):
    if not isinstance(raw, dict):
        raise ValueError('Invalid public feed')
    data = raw.get('data')
    if not isinstance(data, dict) or not isinstance(raw.get('meta'), dict):
        raise ValueError('Invalid public feed')
    generated = timestamp(raw['meta'].get('generated_at'))
    if generated is None:
        raise ValueError('Missing source timestamp')
    def item(row):
        if not isinstance(row, dict):
            return None
        source = row.get('source') or {}
        at = timestamp(row.get('announced_at'))
        if at is None:
            return None
        return {'at': at,
                'reset_type': row.get('reset_type') if row.get('reset_type') in ('regular', 'banked') else None,
                'text': str(row.get('text') or '')[:600],
                'source': public_link(source.get('url')) if isinstance(source, dict) else None}
    pending = data.get('scheduled_reset')
    scheduled = item(pending)
    if scheduled and pending.get('status') == 'scheduled':
        scheduled['scheduled_for'] = timestamp(pending.get('scheduled_for'))
    else:
        scheduled = None
    stats = data.get('stats') if isinstance(data.get('stats'), dict) else {}
    def numeric(name, integer=False):
        value = stats.get(name)
        if (isinstance(value, (int, float)) and not isinstance(value, bool)
                and math.isfinite(value) and value >= 0 and (not integer or value == int(value))):
            return int(value) if integer else value
        return None
    # Do not revive probabilities from older on-disk responses.
    return dict(source=SOURCE, generated_at=generated, latest=item(data.get('latest_reset')),
                scheduled=scheduled, stats={'total': numeric('total', True),
                'avg_interval_days': numeric('avg_interval_days'),
                'last_reset_at': timestamp(stats.get('last_reset_at'))})


class ResetForecast:
    def __init__(self, path, fetcher=None):
        self.path, self.fetcher = path, fetcher or self.fetch
        self.lock = threading.Lock()
        self.data, self.error, self.busy, self.attempt = None, None, False, None
        try:
            saved = json.loads(path.read_text(encoding='utf-8'))
            self.data = normalize(saved)
        except (OSError, ValueError, TypeError, AttributeError):
            pass

    @staticmethod
    def fetch():
        request = Request(ENDPOINT, headers={'User-Agent': 'CodexUsage/1.2 (local quota dashboard)', 'Accept':'application/json'})
        with urlopen(request, timeout=12) as response:
            body = response.read(256*1024+1)
        if len(body) > 256*1024:
            raise ValueError('Feed too large')
        return json.loads(body)

    def request(self):
        with self.lock:
            if self.busy or self.attempt is not None and time.monotonic()-self.attempt < 300:
                return
            self.busy, self.attempt = True, time.monotonic()
        threading.Thread(target=self._refresh, daemon=True, name='public-reset-updates').start()

    def _refresh(self):
        try:
            raw = self.fetcher()
            data = normalize(raw)
            # Cache the public response and normalize it again on reload.
            # This file contains no account or local usage information.
            temp = self.path.with_suffix('.tmp')
            temp.write_text(json.dumps(raw, ensure_ascii=False), encoding='utf-8')
            temp.replace(self.path)
            with self.lock:
                self.data, self.error = data, None
        except Exception:
            with self.lock:
                self.error = '公开重置动态暂时无法同步，稍后自动重试。'
        finally:
            with self.lock:
                self.busy = False

    def status(self, now=None):
        now = time.time() if now is None else now
        with self.lock:
            data = self.data or {}
            fresh = bool(not self.error and data.get('generated_at') and -60 <= now-data['generated_at'] <= 1800)
            scheduled = data.get('scheduled')
            state = 'unavailable' if not fresh else 'quiet'
            if fresh and scheduled and scheduled['at'] <= now+60:
                state = 'awaiting_confirmation' if scheduled.get('scheduled_for') is not None and scheduled['scheduled_for'] <= now else 'scheduled'
            return {**data, 'source':SOURCE, 'busy':self.busy, 'problem':self.error, 'fresh':fresh,
                    'state':state, 'probability':None, 'signal':None}

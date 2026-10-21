"""Read-only public community signals; never sends local account information."""
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
        return datetime.fromisoformat(value.replace('Z', '+00:00')).astimezone(timezone.utc).timestamp() if isinstance(value, str) else None
    except (ValueError, OverflowError):
        return None


def public_link(value):
    if not isinstance(value, str):
        return None
    parsed = urlsplit(value)
    return value if parsed.scheme == 'https' and parsed.netloc in ('x.com', 'twitter.com', 'codex-resets.com', 'openai.com') else None


def normalize(raw):
    data = raw.get('data')
    if not isinstance(data, dict) or not isinstance(raw.get('meta'), dict):
        raise ValueError('Invalid public feed')
    generated = timestamp(raw['meta'].get('generated_at'))
    if not generated:
        raise ValueError('Missing source timestamp')
    def item(row):
        if not isinstance(row, dict):
            return None
        source = row.get('source') or {}
        return {'at': timestamp(row.get('announced_at') or row.get('observed_at')),
                'expires_at': timestamp(row.get('expires_at')),
                'text': str(row.get('text') or '')[:600],
                'source': public_link(source.get('url')) if isinstance(source, dict) else None}
    watch = data.get('active_watch')
    signal = item(watch)
    if signal:
        chance = watch.get('reset_chance_percent')
        signal['probability'] = chance if isinstance(chance, (int,float)) and not isinstance(chance,bool) and math.isfinite(chance) and 0 <= chance <= 100 else None
        signal['horizon'] = str(watch.get('forecast_window') or '')[:80]
    return dict(source=SOURCE, generated_at=generated, signal=signal,
                latest=item(data.get('latest_reset')), scheduled=item(data.get('scheduled_reset')))


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
        request = Request(ENDPOINT, headers={'User-Agent': 'CodexUsage/1.1 (local quota dashboard)', 'Accept':'application/json'})
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
        threading.Thread(target=self._refresh, daemon=True, name='public-reset-forecast').start()

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
                self.error = '公开预测源暂时无法连接，稍后自动重试。'
        finally:
            with self.lock:
                self.busy = False

    def status(self, now=None):
        now = time.time() if now is None else now
        with self.lock:
            data = self.data or {}
            signal = data.get('signal')
            fresh = bool(not self.error and data.get('generated_at') and -60 <= now-data['generated_at'] <= 1800)
            valid = bool(fresh and signal and signal.get('source') and signal.get('at') is not None
                         and signal['at'] <= now+60 and signal.get('expires_at') and signal['expires_at'] > now)
            return {**data, 'source':SOURCE, 'busy':self.busy, 'problem':self.error, 'fresh':fresh,
                    'probability':signal['probability'] if valid else None,
                    'state':'forecast' if valid and signal['probability'] is not None else 'unavailable' if not fresh else 'quiet'}

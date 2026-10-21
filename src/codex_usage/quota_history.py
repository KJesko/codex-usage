"""Local, account-isolated official quota observations; no credentials or email."""
from datetime import datetime, time, timedelta, timezone
from contextlib import closing
import sqlite3
import hashlib
import json
from zoneinfo import ZoneInfo
from .quota_resets import QuotaResets, RESET_KINDS


def cycle_start(window):
    """The provider deadline and duration define the formal window, not a reset poll."""
    return window['resets_at'] - window['window_minutes'] * 60


def set_cycle_timing(window, samples, start_event=None):
    begin = cycle_start(window)
    window['cycle_started_at'] = begin
    # An early reset inside an unchanged window restarts the consumption
    # reference, but does not move the provider's formal window boundaries.
    window['reference_started_at'] = max(begin, start_event['at']) if start_event else begin
    window['segment_baseline'] = start_event['after_used'] if start_event and start_event['at'] >= begin else 0
    window.pop('idle_period', None)
    window['cycle_pending'] = False
    if not samples:
        return
    before = [p for p in samples if p['at'] < begin]
    all_unused = all(p['used_percent'] == 0 for p in samples)
    # A sliding deadline at the latest poll means the window has not begun.
    # A fixed window with a rounded 0% reading must still be shown as active.
    pending = all_unused and abs(begin-samples[-1]['at']) <= 1
    window['cycle_pending'] = pending
    if before and all(p['used_percent'] == 0 for p in before):
        since = start_event['at'] if start_event and start_event['after_used'] == 0 else before[0]['at']
        if since < begin:
            window['idle_period'] = dict(since=since, until=begin, ongoing=pending,
                                         after_reset=bool(start_event and start_event['after_used'] == 0),
                                         sample_count=len(before))


def daily_history(window, samples, timezone_name):
    """Last successful observation per local date, before display downsampling."""
    zone = ZoneInfo(timezone_name)
    days = {}
    for point in samples:
        if window.get('resets_at') and window.get('window_minutes') and not (
                cycle_start(window) <= point['at'] <= (window.get('display_end') or window['resets_at'])):
            continue
        day = datetime.fromtimestamp(point['at'], zone).date().isoformat()
        if day not in days or point['at'] >= days[day]['at']:
            days[day] = {**point, 'date': day}
    ticks = []
    end = window.get('resets_at')
    minutes = window.get('window_minutes')
    if end and minutes:
        begin = cycle_start(window)
        first, last = (datetime.fromtimestamp(at, zone).date() for at in (begin, end))
        day = first
        # Bound the axis for unusual long windows. Daily samples remain intact.
        step = max(1, ((last - first).days + 89) // 90)
        while day <= last:
            at = max(begin, datetime.combine(day, time.min, tzinfo=zone).timestamp())
            ticks.append({'date': day.isoformat(), 'at': at})
            day += timedelta(days=step)
    return {'daily_samples': [days[key] for key in sorted(days)],
            'daily_ticks': ticks, 'daily_timezone': timezone_name,
            'sample_count': len(samples)}


def cycle_history(window, samples, timezone_name):
    """Aggregate fixed 24-hour intervals from the actual quota window origin."""
    end = window.get('display_end') or window.get('resets_at')
    minutes = window.get('window_minutes')
    if not end or not minutes:
        return {'cycle_samples': []}
    begin = cycle_start(window)
    zone, intervals = ZoneInfo(timezone_name), {}
    for point in sorted(samples, key=lambda point: point['at']):
        if not begin <= point['at'] < end:
            continue
        index = int((point['at'] - begin) // 86400)
        intervals[index] = {**point, 'interval': index,
                            'date': datetime.fromtimestamp(point['at'], zone).date().isoformat(),
                            'since': begin + index * 86400,
                            'until': min(begin + (index+1) * 86400, end)}
    result = [intervals[index] for index in sorted(intervals)]
    # A recovery within an interval must never be connected as negative usage.
    previous_at = None
    previous_used = None
    cursor = 0
    ordered = sorted((p for p in samples if begin <= p['at'] < end), key=lambda point: point['at'])
    for selected in result:
        broken = False
        while cursor < len(ordered) and ordered[cursor]['at'] <= selected['at']:
            point = ordered[cursor]
            if previous_at is not None and (point['at'] - previous_at > 15*60 or point['used_percent'] < previous_used):
                broken = True
            previous_at, previous_used = point['at'], point['used_percent']
            cursor += 1
        selected['break_before'] = broken
    return {'cycle_samples': result}


def pace(window, samples, now):
    duration, reset, used = window.get('window_minutes'), window.get('resets_at'), window.get('used_percent')
    result = {'samples': samples, 'status': 'insufficient', 'expected_percent': None,
              'ahead_percent': None, 'rate_per_hour': None, 'estimated_exhaustion': None}
    if not duration or not reset or used is None:
        result['status'] = 'unknown'
        return result
    begin = window.get('reference_started_at', cycle_start(window))
    if now >= reset:
        result['status'] = 'expired'
        return result
    if now < begin:
        result['status'] = 'unknown'
        return result
    if window.get('cycle_pending'):
        result['status'] = 'waiting'
        return result
    baseline = window.get('segment_baseline', 0)
    expected = max(0, min(100, baseline + (now - begin) / max(1, reset-begin) * (100-baseline)))
    result.update(expected_percent=expected, ahead_percent=used - expected)
    if used >= 100:
        result['status'] = 'exhausted'
        return result
    # Use only a recent, continuous segment. A decrease is a reset/correction,
    # not negative consumption; an observation gap is not measured idle time.
    segment = []
    for point in samples:
        if point['at'] < max(begin, now - 6 * 3600) or point['at'] > now:
            continue
        if segment and (point['used_percent'] < segment[-1]['used_percent'] or point['at'] - segment[-1]['at'] > 15 * 60):
            segment = []
        segment.append(point)
    if len(segment) < 3 or segment[-1]['at'] - segment[0]['at'] < 30 * 60 or now - segment[-1]['at'] > 180:
        return result
    gain = segment[-1]['used_percent'] - segment[0]['used_percent']
    if gain < 1:
        result['status'] = 'flat'
        return result
    rate = gain / (segment[-1]['at'] - segment[0]['at']) * 3600
    exhaustion = now + (100 - used) / rate * 3600
    result.update(status='risk' if exhaustion < reset else 'sustainable', rate_per_hour=rate,
                  estimated_exhaustion=exhaustion, observed_minutes=(segment[-1]['at'] - segment[0]['at']) / 60)
    return result


class QuotaHistory:
    def __init__(self, path):
        self.path = path
        with closing(self.connect()) as db, db:
            db.execute('CREATE TABLE IF NOT EXISTS observations (account TEXT, plan TEXT, window TEXT, '
                       'minutes REAL, reset REAL, at REAL, used REAL, '
                       'PRIMARY KEY(account, plan, window, minutes, reset, at))')
        self.resets = QuotaResets(path)

    @staticmethod
    def cycle_id(plan, window, minutes, reset):
        return hashlib.sha256(json.dumps([plan, window, float(minutes), float(reset)]).encode()).hexdigest()[:24]

    def _segments(self, identity, now, events=None):
        """Rebuild usage segments from observations and actual reset boundaries.

        The raw deadline remains untouched. A sliding idle deadline or a clock
        correction updates the segment's end, rather than creating a new cycle.
        Rebuilding also coalesces history collected by older versions.
        """
        events = self.resets.events(identity, now) if events is None else events
        resets = {(e['plan'], e['window'], e['at']): e for e in events if e['kind'] in RESET_KINDS}
        with closing(self.connect()) as db:
            rows = db.execute('SELECT plan,window,minutes,reset,at,used FROM observations '
                              'WHERE account=? AND at>=? AND at<=? ORDER BY at,rowid',
                              (identity, now-90*86400, now)).fetchall()
        result, current, previous, ids = [], {}, {}, set()
        for plan, wid, minutes, reset, at, used in rows:
            segment, old = current.get(wid), previous.get(wid)
            event = resets.get((plan, wid, at))
            changed = old and (old['plan'], old['minutes']) != (plan, minutes)
            elapsed = (old and old['at'] < old['reset'] <= at and reset > old['reset']
                       and (old['used'] > 0 or used > 0))
            if segment is None or event or changed or elapsed:
                if segment:
                    reason = 'configuration' if changed else event['kind'] if event else 'scheduled'
                    segment.update(ends_at=min(segment['resets_at'], at), completed=True,
                                   ended_reason=reason)
                begin = event['at'] if event else max(reset-minutes*60, now-90*86400)
                if changed:
                    begin = max(begin, at)
                key = self.cycle_id(plan, wid, minutes, reset)
                if event or key in ids:
                    key = hashlib.sha256((key+str(at)).encode()).hexdigest()[:24]
                ids.add(key)
                segment = dict(id=key, plan=plan, window=wid, window_minutes=minutes, resets_at=reset,
                               starts_at=begin, ends_at=reset, first_at=at, last_at=at,
                               sample_count=0, completed=reset<=now, segment=1,
                               ended_reason=None, start_event=event, _samples=[])
                result.append(segment)
                current[wid] = segment
            segment.update(resets_at=reset, ends_at=reset, last_at=at, completed=reset<=now)
            segment['_samples'].append({'at': at, 'used_percent': used})
            segment['sample_count'] += 1
            previous[wid] = dict(plan=plan, minutes=minutes, reset=reset, at=at, used=used)
        return sorted(result, key=lambda c:c['first_at'], reverse=True)

    def cycles(self, identity, now):
        return [{k: v for k, v in segment.items() if k != '_samples'}
                for segment in self._segments(identity, now)]

    def range(self, identity, since, until, now, timezone_name='UTC', grain='hour'):
        from .quota_range import build_range
        return build_range(self._segments(identity, now), since, until, now, timezone_name, grain)

    def cycle(self, identity, cycle_id, now, timezone_name='UTC'):
        cycle = next((c for c in self._segments(identity, now) if c['id'] == cycle_id), None)
        if not cycle:
            raise ValueError('该周期不可用，请刷新列表后重新选择')
        samples = cycle.pop('_samples')
        if not samples:
            raise ValueError('该周期已无可用记录，请刷新列表')
        minutes = cycle['window_minutes']
        label = '每周额度' if minutes == 10080 else '每日额度' if minutes == 1440 else f'{minutes/60:g} 小时额度'
        window = dict(id=cycle['window'], label=label, bucket=cycle['window'].split(':')[0], bucket_name=cycle['window'].split(':')[0],
                      window_minutes=minutes, resets_at=cycle['resets_at'], used_percent=samples[-1]['used_percent'],
                      remaining_percent=100-samples[-1]['used_percent'])
        window['segment_started_at'] = cycle['starts_at']
        set_cycle_timing(window, samples, cycle.get('start_event'))
        window['display_end'] = cycle['ends_at']
        p = dict(status='historical', expected_percent=None, samples=[samples[0], samples[-1]],
                 **daily_history(window, samples, timezone_name), **cycle_history(window, samples, timezone_name),
                 **observation_gaps(window, samples, now))
        p['segment_id'] = cycle['id']
        p['start_event'] = cycle.get('start_event')
        p['segment_number'] = cycle['segment']
        return dict(historical=True, cycle=cycle, windows=[window], pace={window['id']: p},
                    fetched_at=datetime.fromtimestamp(samples[-1]['at'], timezone.utc).isoformat())

    def connect(self):
        return sqlite3.connect(self.path, timeout=5)

    def record(self, quota, timezone_name='UTC'):
        identity = quota.get('_account_key')
        if not identity:
            return {}
        stamp = datetime.fromisoformat(quota['fetched_at']).timestamp()
        plan = quota['account'].get('plan') or ''
        self.resets.record(quota, stamp)
        events = self.resets.events(identity, stamp)
        output = {}
        with closing(self.connect()) as db, db:
            db.execute('DELETE FROM observations WHERE at < ?', (stamp - 90 * 86400,))
            for window in quota['windows']:
                minutes, reset, used = window['window_minutes'], window['resets_at'], window['used_percent']
                if not minutes or not reset or used is None:
                    continue
                keys = (identity, plan, window['id'], minutes, reset)
                # Preserve every successful observation and its raw deadline.
                if reset - minutes * 60 <= stamp < reset:
                    db.execute('INSERT OR IGNORE INTO observations VALUES (?,?,?,?,?,?,?)', (*keys, stamp, used))
        segments = self._segments(identity, stamp, events)
        for window in quota['windows']:
            segment = next((s for s in segments if s['window']==window['id'] and s['plan']==plan
                            and s['window_minutes']==window['window_minutes'] and s['last_at']==stamp), None)
            if not segment:
                output[window['id']] = pace(window, [], stamp)
                continue
            start_event, samples = segment['start_event'], segment['_samples']
            window['segment_started_at'] = segment['starts_at']
            set_cycle_timing(window, samples, start_event)
            result = pace(window, samples, stamp)
            result.update(daily_history(window, samples, timezone_name))
            result.update(cycle_history(window, samples, timezone_name))
            result.update(observation_gaps(window, samples, stamp))
            result['segment_id'] = start_event['id'] if start_event else segment['id']
            result['start_event'] = start_event
            result['segment_number'] = segment['segment']
            # The UI needs a bounded history; calculations above use every sample.
            indices = ([round(i * (len(samples) - 1) / 599) for i in range(600)]
                       if len(samples) > 600 else range(len(samples)))
            visible, previous = [], 0
            for i in indices:
                broken = any(samples[j]['at'] - samples[j-1]['at'] > 15 * 60 or
                             samples[j]['used_percent'] < samples[j-1]['used_percent']
                             for j in range(previous + 1, i + 1))
                visible.append({**samples[i], 'break_before': broken})
                previous = i
            result['samples'] = visible
            output[window['id']] = result
        return output


def observation_gaps(window, samples, now):
    """Show unobserved intervals, never interpret them as zero consumption."""
    begin = max(cycle_start(window), window.get('reference_started_at', cycle_start(window)))
    end = min(now, window.get('display_end') or window['resets_at'])
    points = [begin] + [s['at'] for s in samples if begin <= s['at'] <= end] + [end]
    gaps = [{'since': a, 'until': b} for a, b in zip(points, points[1:]) if b-a > 15*60]
    return {'gaps': gaps[-20:], 'gap_count': len(gaps), 'gap_seconds': sum(g['until']-g['since'] for g in gaps)}

"""Read-only projections of quota observations across multiple reset segments."""
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo


def range_bounds(since, until, now, timezone_name):
    zone = ZoneInfo(timezone_name)
    try:
        first, last = date.fromisoformat(since), date.fromisoformat(until)
    except (ValueError, TypeError):
        raise ValueError('请选择有效的开始和结束日期') from None
    today = datetime.fromtimestamp(now, zone).date()
    if first > last:
        raise ValueError('开始日期不能晚于结束日期')
    if first < today-timedelta(days=89) or last > today:
        raise ValueError('请选择最近 90 天内的日期，结束日期不能晚于今天')
    return (datetime.combine(first, time.min, zone).timestamp(),
            datetime.combine(last+timedelta(days=1), time.min, zone).timestamp())


def range_points(samples, since, until, grain, zone, anchors=()):
    """Keep bucket endpoints and both sides of gaps/drops, never bridge a reset."""
    runs = []
    for point in samples:
        if not since <= point['at'] < until:
            continue
        previous = runs[-1][-1] if runs else None
        if (previous is None or point['at']-previous['at'] > 900
                or point['used_percent'] < previous['used_percent']):
            runs.append([])
        runs[-1].append(point)
    result = []
    for run in runs:
        buckets = {}
        for point in run:
            key = int(point['at']//3600) if grain == 'hour' else datetime.fromtimestamp(point['at'], zone).date()
            buckets[key] = point
        if grain == 'auto':
            # Keep both ends of plateaus and every change, without transferring
            # thousands of identical idle observations. Run boundaries stay intact.
            buckets = {p['at']: p for i, p in enumerate(run)
                       if i == 0 or i == len(run)-1
                       or p['used_percent'] != run[i-1]['used_percent']
                       or p['used_percent'] != run[i+1]['used_percent']}
        edges = []
        for anchor in anchors:
            before = next((p for p in reversed(run) if p['at'] <= anchor), None)
            after = next((p for p in run if p['at'] >= anchor), None)
            edges.extend(p for p in (before,after) if p)
        selected = {p['at']: p for p in [run[0], *buckets.values(), *edges, run[-1]]}
        result.extend({**p, 'break_before': i == 0} for i, p in enumerate(sorted(selected.values(), key=lambda p:p['at'])))
    return result


def build_range(segments, since, until, now, timezone_name, grain):
    from .quota_history import set_cycle_timing
    if grain not in ('hour', 'day', 'auto'):
        raise ValueError('记录密度仅支持自动、每小时或每天')
    begin, end = range_bounds(since, until, now, timezone_name)
    zone, groups = ZoneInfo(timezone_name), {}
    latest = None
    for segment in sorted(segments, key=lambda s:s['first_at']):
        samples = segment['_samples']
        event = segment.get('start_event')
        window = dict(window_minutes=segment['window_minutes'], resets_at=segment['resets_at'])
        set_cycle_timing(window, samples, event)
        points = range_points(samples, begin, end, grain, zone, anchors=(window['cycle_started_at'],))
        event_in_range = event and begin <= event['at'] < end
        if not points and not event_in_range:
            continue
        minutes, wid = segment['window_minutes'], segment['window']
        key = (segment['plan'], wid, minutes)
        label = '每周额度' if minutes == 10080 else '每日额度' if minutes == 1440 else f'{minutes/60:g} 小时额度'
        group = groups.setdefault(key, dict(id=segment['id'], window=wid, plan=segment['plan'], label=label,
                                          samples=[], references=[], idle=[], events=[], sample_count=0,
                                          segment_count=0, gap_count=0))
        group['samples'].extend(points)
        group['sample_count'] += sum(begin <= p['at'] < end for p in samples)
        group['segment_count'] += 1
        group['gap_count'] += sum(b['at']-a['at'] > 900 and b['at'] > begin and a['at'] < end
                                  for a,b in zip(samples,samples[1:]))
        if points:
            latest = max(latest or points[-1]['at'], points[-1]['at'])
        if event_in_range:
            group['events'].append(event)
        idle = window.get('idle_period')
        if idle and idle['until'] > begin and idle['since'] < end:
            group['idle'].append({**idle, 'since': max(begin,idle['since']), 'until': min(end,idle['until'])})
        origin, deadline = window['reference_started_at'], window['resets_at']
        left, right = max(begin,origin), min(end,segment['ends_at'])
        if not window['cycle_pending'] and left < right and origin < deadline:
            baseline = window['segment_baseline']
            value = lambda at: baseline+(at-origin)/(deadline-origin)*(100-baseline)
            group['references'].append(dict(since=left,until=right,before=value(left),after=value(right),
                                            cycle_since=window['cycle_started_at'],cycle_until=deadline))
    ticks = []
    day = datetime.fromtimestamp(begin,zone).date()
    while datetime.combine(day,time.min,zone).timestamp() <= end:
        ticks.append(dict(at=datetime.combine(day,time.min,zone).timestamp(),date=day.isoformat()))
        day += timedelta(days=1)
    return dict(custom_range=True, historical=True, timezone=timezone_name, grain=grain, ticks=ticks,
                range=dict(since=begin,until=end,since_date=since,until_date=until),
                groups=list(groups.values()), fetched_at=datetime.fromtimestamp(latest,zone).isoformat() if latest else None)

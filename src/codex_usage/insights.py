"""Comparable calendar windows and additive project/model attribution."""
from datetime import datetime, timedelta

from .reader import utc_time


def comparison(events, start, end, zone, now, cutoff, period, earliest):
    now = now.astimezone(zone)
    end = min(end, now.date())
    if start > end:
        return {'available': False, 'reason': '当前范围尚未开始，没有可比较的用量。'}
    days = (end - start).days + 1
    shift = 7 if period == 'week' else days
    begin = datetime.combine(start, datetime.min.time(), zone)
    stop = now if end == now.date() else datetime.combine(end + timedelta(days=1), datetime.min.time(), zone)
    previous_begin, previous_stop = begin - timedelta(days=shift), stop - timedelta(days=shift)
    available, reason = True, None
    if cutoff and previous_begin < cutoff:
        available, reason = False, '上期早于统计起点，暂不计算增长率和增长归因。'
    elif earliest is None or previous_begin.date() < earliest.astimezone(zone).date():
        available, reason = False, '现有日志未覆盖完整上期，暂不计算增长率和增长归因。'
    result = {'available': available, 'reason': reason,
              'current_range': {'since': begin.isoformat(), 'until': stop.isoformat()},
              'previous_range': {'since': previous_begin.isoformat(), 'until': previous_stop.isoformat()},
              'partial_day': end == now.date(), 'basis': '上周同期' if period == 'week' else '上一等长时段'}
    totals = [{'total': 0, 'known_cost': 0, 'unpriced_events': 0} for _ in range(2)]
    groups = {'projects': {}, 'models': {}}
    for e in events:
        stamp = utc_time(e['at'])
        slot = 1 if begin <= stamp < stop else 0 if previous_begin <= stamp < previous_stop else None
        if slot is None or (slot == 0 and not available):
            continue
        totals[slot]['total'] += e['total']
        totals[slot]['known_cost'] += e['cost'] or 0
        totals[slot]['unpriced_events'] += int(e['cost'] is None)
        for dimension, key, name in [('projects', e['project'], e['project_name']), ('models', e['model'], e['model'])]:
            row = groups[dimension].setdefault(key, {'id': key, 'name': name,
                'source_name': e['source_name'] if dimension == 'projects' else '',
                'previous_total': 0, 'current_total': 0, 'previous_cost': 0, 'current_cost': 0})
            prefix = 'current' if slot else 'previous'
            row[prefix + '_total'] += e['total']
            row[prefix + '_cost'] += e['cost'] or 0
    result.update(current=totals[1], previous=totals[0] if available else None)
    for dimension, values in groups.items():
        result[dimension] = [{**row, 'delta_total': row['current_total'] - row['previous_total'],
                              'delta_cost': row['current_cost'] - row['previous_cost']}
                             for row in values.values()] if available else []
    return result

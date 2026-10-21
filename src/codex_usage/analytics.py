"""Timezone-aware reporting with one shared filter for every dimension."""
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .pricing import CATALOG, estimate
from .reader import utc_time
from .insights import comparison

NUMBERS = ("input", "uncached", "cached", "write", "output", "reasoning", "total")
COSTS = ("known_cost", "input_cost", "cached_cost", "write_cost", "output_cost", "cache_savings")


def empty():
    return {**dict.fromkeys(NUMBERS + COSTS, 0), "events": 0, "unpriced_tokens": 0,
            "unpriced_events": 0, "_sessions": set(), "_projects": set()}


def accumulate(bucket, event):
    for key in NUMBERS:
        bucket[key] += event[key]
    bucket["events"] += 1
    bucket["_sessions"].add(event["session"])
    bucket["_projects"].add(event["project"])
    if event["cost"] is None:
        bucket["unpriced_tokens"] += event["total"]
        bucket["unpriced_events"] += 1
    else:
        bucket["known_cost"] += event["cost"]
        for key in COSTS[1:]:
            bucket[key] += event[key]


def finish(bucket):
    result = {k: v for k, v in bucket.items() if not k.startswith("_")}
    result["sessions"] = len(bucket["_sessions"])
    result["projects"] = len(bucket["_projects"])
    result["cost"] = None if result["unpriced_events"] else result["known_cost"]
    result["cache_rate"] = result["cached"] / result["input"] if result["input"] else 0
    result["priced_ratio"] = 1 - result["unpriced_tokens"] / result["total"] if result["total"] else 1
    return result


def bucket_date(day, grain):
    if grain == "week":
        return day - timedelta(days=day.weekday())
    if grain == "month":
        return day.replace(day=1)
    return day


def report(snapshot, query, config, now=None):
    zone_name = query.get("timezone") or config["timezone"]
    try:
        zone = ZoneInfo(zone_name)
    except (ZoneInfoNotFoundError, ValueError):
        raise ValueError("时区无效或缺少 tzdata，请安装 requirements.txt 中的依赖") from None
    today = (now or datetime.now(timezone.utc)).astimezone(zone).date()
    grain = query.get("grain", "day")
    if grain not in ("day", "week", "month"):
        raise ValueError("统计粒度必须为 day、week 或 month")
    start = date.fromisoformat(query["since"]) if query.get("since") else None
    end = date.fromisoformat(query["until"]) if query.get("until") else today
    if start and start > end:
        raise ValueError("开始日期不能晚于结束日期")
    # Apply the saved boundary to event deltas, after parsing the full logs.
    # The configured timezone anchors it even if a report requests another zone.
    cutoff = (datetime.combine(date.fromisoformat(config["usage_since"]), datetime.min.time(),
                               ZoneInfo(config["timezone"])) if config.get("usage_since") else None)
    cutoff_day = cutoff.astimezone(zone).date() if cutoff else None
    events = [e for e in snapshot["events"] if not cutoff or utc_time(e["at"]) >= cutoff]
    # Lifetime metadata totals cannot be split at the saved boundary.
    missing_projects = [] if cutoff else snapshot.get('missing_projects', [])
    sources = {e['source']: {'id': e['source'], 'name': e['source_name']}
               for e in [*events, *missing_projects]}
    # Count configured machines even when they have no events after the cutoff.
    # Multiple local log directories still belong to the same local machine.
    if config.get('sources'):
        sources['local'] = {'id': 'local', 'name': '本机'}
    for remote in config.get('remotes', []):
        source_id = 'ssh:' + remote['id']
        if remote['enabled']:
            sources[source_id] = {'id': source_id, 'name': remote['name']}
        else:
            sources.pop(source_id, None)
    options = {
        "projects": sorted({e["project"]: {"id": e["project"], "name": e["project_name"],
                                          "path": e["project_path"], "source": e['source']} for e in events}.values(), key=lambda p: p["name"]),
        "models": sorted({e["model"] for e in events}),
        "accounts": sorted({e["account"] for e in events}),
        "sources": sorted(sources.values(), key=lambda s: s['id']),
    }
    timeline, projects, sessions, models = (defaultdict(empty) for _ in range(4))
    daily_models = defaultdict(lambda: defaultdict(empty))
    total, today_bucket, week_bucket, month_bucket = empty(), empty(), empty(), empty()
    monday = today - timedelta(days=today.weekday())
    month_start = today.replace(day=1)
    selected, unknown, dimension_events = [], set(), []
    for event in events:
        if any(query.get(k) and query[k] != event[k] for k in ("project", "model", "session", "account", "source")):
            continue
        e = {**event, **estimate(event, config.get("prices"), config.get("_catalog"))}
        dimension_events.append(e)
        day = utc_time(e["at"]).astimezone(zone).date()
        if day == today:
            accumulate(today_bucket, e)
        if monday <= day <= today:
            accumulate(week_bucket, e)
        if month_start <= day <= today:
            accumulate(month_bucket, e)
        if (start and day < start) or day > end:
            continue
        selected.append(e)
        if e["cost"] is None:
            unknown.add(e["model"])
        accumulate(total, e)
        key = bucket_date(day, grain).isoformat()
        accumulate(timeline[key], e)
        accumulate(daily_models[day.isoformat()][e['model']], e)
        p = projects[e["project"]]
        p.update(id=e["project"], name=e["project_name"], path=e["project_path"],
                 source=e['source'], source_name=e['source_name'])
        accumulate(p, e)
        s = sessions[e["session"]]
        s.update(id=e["session"], title=e["title"])
        s.setdefault("first_at", e["at"])
        s["last_at"] = e["at"]
        s.setdefault("model_names", set()).add(e["model"])
        s.setdefault("project_names", set()).add(e["project_name"])
        s.setdefault('source_names', set()).add(e['source_name'])
        accumulate(s, e)
        m = models[e["model"]]
        m["name"] = e["model"]
        accumulate(m, e)
    actual_start = start or cutoff_day or (utc_time(selected[0]["at"]).astimezone(zone).date() if selected else end)
    if cutoff_day:
        actual_start = max(actual_start, cutoff_day)
    if (end - actual_start).days > 3660:
        raise ValueError("一次最多查看 10 年，请缩短日期范围")
    cursor = actual_start
    while cursor <= end:
        timeline[bucket_date(cursor, grain).isoformat()]
        daily_models[cursor.isoformat()]
        cursor += timedelta(days=1)
    for s in sessions.values():
        s["model_names"] = sorted(s["model_names"])
        s["project_names"] = sorted(s["project_names"])
        s['source_names'] = sorted(s['source_names'])
    sort = lambda values: sorted((finish(v) for v in values), key=lambda v: v["total"], reverse=True)
    return {
        "comparison": comparison(dimension_events, actual_start, end, zone,
            now or datetime.now(timezone.utc), cutoff, query.get('period'),
            min((utc_time(e['at']) for e in events), default=None)),
        "summary": finish(total), "today": finish(today_bucket), "week": finish(week_bucket),
        "month": finish(month_bucket),
        "timeline": [{"date": k, **finish(v)} for k, v in sorted(timeline.items())],
        # Always daily, regardless of the overview's day/week/month grouping.
        # Keep model cells sparse; absent cells mean zero usage for that day.
        "model_timeline": [{"date": day, "models": [
            {"name": name, **finish(bucket)} for name, bucket in sorted(values.items())]}
            for day, values in sorted(daily_models.items())],
        "projects": sort(projects.values()), "sessions": sort(sessions.values()), "models": sort(models.values()),
        "options": options, "coverage": snapshot["coverage"], "limits": snapshot["limits"],
        "missing_projects": sorted([p for p in missing_projects if
            (not query.get('source') or p['source'] == query['source']) and
            (not query.get('project') or p['id'] == query['project'])], key=lambda p: -p['metadata_tokens']),
        "scanned_at": snapshot["scanned_at"], "timezone": zone_name,
        "usage_start": {"date": config["usage_since"], "timezone": config["timezone"],
                        "at": cutoff.isoformat()} if cutoff else None,
        "range": {"since": actual_start.isoformat(), "until": end.isoformat(), "today": today.isoformat(), "grain": grain},
        "pricing": {"verified_at": config.get("_catalog", CATALOG)["verified_at"], "source": config.get("_catalog", CATALOG)["source"],
                    "basis": config.get("_catalog", CATALOG)["basis"], "unknown_models": sorted(unknown),
                    "models": {**config.get("_catalog", CATALOG)["models"], **config.get("prices", {})},
                    "overrides": sorted(config.get("prices", {}))},
    }

"""Persist observed quota transitions, separately from inferred reset causes."""
from contextlib import closing
import hashlib
import json
import sqlite3

RESET_KINDS = ('scheduled', 'official', 'credit')


class QuotaResets:
    def __init__(self, path):
        self.path = path
        with closing(self.connect()) as db, db:
            db.execute('CREATE TABLE IF NOT EXISTS reset_events '
                       '(id TEXT PRIMARY KEY, account TEXT, at REAL, payload TEXT)')
            db.execute('CREATE TABLE IF NOT EXISTS credit_observations '
                       '(account TEXT, at REAL, plan TEXT, count INTEGER, PRIMARY KEY(account,at))')
            db.execute('CREATE TABLE IF NOT EXISTS reset_candidates '
                       '(account TEXT, window TEXT, payload TEXT, PRIMARY KEY(account,window))')

    def connect(self):
        return sqlite3.connect(self.path, timeout=5)

    def events(self, identity, now):
        with closing(self.connect()) as db:
            rows = db.execute('SELECT payload FROM reset_events WHERE account=? AND at>=? AND at<=? '
                              'ORDER BY at DESC', (identity, now-90*86400, now)).fetchall()
        # Old versions stored every changed deadline as an event. Keep the
        # original observations, but never surface these as account resets.
        return [event for row in rows if (event := json.loads(row[0]))['kind'] != 'adjustment']

    @staticmethod
    def save(db, account, event):
        key = json.dumps([account, event['plan'], event['window'], event['at'], event['kind']])
        event['id'] = hashlib.sha256(key.encode()).hexdigest()[:24]
        db.execute('INSERT OR IGNORE INTO reset_events VALUES (?,?,?,?)',
                   (event['id'], account, event['at'], json.dumps(event)))

    def record(self, quota, stamp):
        account, plan = quota['_account_key'], quota['account'].get('plan') or ''
        count = quota.get('reset_credits', {}).get('available_count')
        with closing(self.connect()) as db, db:
            db.execute('DELETE FROM reset_events WHERE at<?', (stamp-90*86400,))
            db.execute('DELETE FROM credit_observations WHERE at<?', (stamp-90*86400,))
            for owner, wid, payload in db.execute('SELECT account,window,payload FROM reset_candidates').fetchall():
                if json.loads(payload)['at'] < stamp-900:
                    db.execute('DELETE FROM reset_candidates WHERE account=? AND window=?', (owner, wid))
            old = db.execute('SELECT at,plan,count FROM credit_observations WHERE account=? '
                             'ORDER BY at DESC LIMIT 1', (account,)).fetchone()
            credit_event = None
            if old and old[0] < stamp and old[1] == plan and count is not None and old[2] is not None and old[2] != count:
                credit_event = dict(kind='credit_change', plan=plan, window='', at=stamp, since=old[0],
                                    before_count=old[2], after_count=count)
                self.save(db, account, credit_event)
            db.execute('INSERT OR IGNORE INTO credit_observations VALUES (?,?,?,?)', (account, stamp, plan, count))
            recent = [json.loads(r[0]) for r in db.execute(
                'SELECT payload FROM reset_events WHERE account=? AND at>=? AND at<=? ORDER BY at DESC',
                (account, stamp-600, stamp)).fetchall()]
            decreases = [e for e in recent if e['plan'] == plan and e['kind'] == 'credit_change'
                         and e['after_count'] < e['before_count']]
            # Card-count and quota responses can arrive in adjacent polls. Only
            # associate an observed recovery within ten minutes, never an old card.
            if credit_event and count < old[2]:
                for event in recent:
                    if event['plan'] == plan and event['kind'] in ('official', 'scheduled'):
                        event.update(kind='credit', credit_at=stamp, before_count=old[2], after_count=count)
                        db.execute('UPDATE reset_events SET payload=? WHERE id=? AND account=?',
                                   (json.dumps(event), event['id'], account))
            for window in quota['windows']:
                wid, minutes, reset, used = (window[k] for k in ('id', 'window_minutes', 'resets_at', 'used_percent'))
                if not minutes or not reset or used is None or not reset-minutes*60 <= stamp < reset:
                    continue
                previous = db.execute('SELECT plan,minutes,reset,at,used FROM observations WHERE account=? AND window=? '
                                      'ORDER BY at DESC LIMIT 1', (account, wid)).fetchone()
                if not previous or previous[3] >= stamp:
                    continue
                if previous[:2] != (plan, minutes):
                    db.execute('DELETE FROM reset_candidates WHERE account=? AND window=?', (account, wid))
                    continue
                candidate = db.execute('SELECT payload FROM reset_candidates WHERE account=? AND window=?',
                                       (account, wid)).fetchone()
                pending = json.loads(candidate[0]) if candidate else None
                if pending and (pending['plan'] != plan or pending['minutes'] != minutes):
                    pending = None
                    db.execute('DELETE FROM reset_candidates WHERE account=? AND window=?', (account, wid))
                event = None
                if pending:
                    # A second successful sample confirms recovery. A rebound or
                    # long offline gap invalidates the candidate, not the samples.
                    if used <= pending['before_used']-1 and stamp-pending['at'] <= 900:
                        event = {k: v for k, v in pending.items() if k != 'minutes'}
                        event['confirmed_at'] = stamp
                    db.execute('DELETE FROM reset_candidates WHERE account=? AND window=?', (account, wid))
                if not event:
                    natural = (previous[3] < previous[2] <= stamp and reset > previous[2]
                               and (previous[4] > 0 or used > 0))
                    base = dict(plan=plan, window=wid, label=window['label'], at=stamp, since=previous[3],
                                before_used=previous[4], after_used=used, old_reset=previous[2], new_reset=reset)
                    if natural:
                        event = dict(base, kind='scheduled', confirmed_at=stamp)
                    elif used <= previous[4]-1:
                        pending = dict(base, kind='official', minutes=minutes)
                        db.execute('INSERT OR REPLACE INTO reset_candidates VALUES (?,?,?)',
                                   (account, wid, json.dumps(pending)))
                    # An unused allowance can keep moving its next deadline.
                    # Time changes alone are not evidence of another reset.
                if event:
                    matching = next((e for e in decreases if abs(e['at']-event['at']) <= 600), None)
                    if matching and event['kind'] in RESET_KINDS:
                        event.update(kind='credit', credit_at=matching['at'], before_count=matching['before_count'],
                                     after_count=matching['after_count'])
                    self.save(db, account, event)

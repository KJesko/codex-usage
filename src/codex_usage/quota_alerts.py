"""Account-scoped, once-per-cycle quota reminders stored on this machine."""
from contextlib import closing
import hashlib
import json
import sqlite3

DEFAULT_ALERTS = {'enabled': True, 'remaining_percent': 20, 'predictive': True}


class QuotaAlerts:
    def __init__(self, path):
        self.path = path
        with closing(self.connect()) as db, db:
            db.execute('CREATE TABLE IF NOT EXISTS quota_alerts (id TEXT PRIMARY KEY, account TEXT, '
                       'at REAL, reset REAL, kind TEXT, message TEXT, acknowledged INTEGER DEFAULT 0)')

    def connect(self):
        return sqlite3.connect(self.path, timeout=5)

    def evaluate(self, quota, paces, config, now):
        identity = quota.get('_account_key')
        if not identity:
            return []
        active = []
        with closing(self.connect()) as db, db:
            db.execute('DELETE FROM quota_alerts WHERE at < ?', (now-90*86400,))
            for window in quota.get('windows', []) if config['enabled'] else []:
                reset, remaining = window.get('resets_at'), window.get('remaining_percent')
                if not reset or reset <= now or remaining is None:
                    continue
                reasons = []
                if remaining <= config['remaining_percent']:
                    reasons.append(('low', config['remaining_percent'],
                                    f"{window['label']}剩余 {remaining:g}%，已达到 {config['remaining_percent']:g}% 提醒线。"))
                p = paces.get(window['id'], {})
                if config['predictive'] and p.get('status') == 'risk':
                    reasons.append(('risk', None, f"{window['label']}按近期消耗速度可能在重置前耗尽，请查看额度消耗节奏。"))
                for kind, threshold, message in reasons:
                    key = [identity, quota.get('account', {}).get('plan'), window['id'],
                           window.get('window_minutes'), reset, kind, threshold]
                    if p.get('start_event'):
                        key.append(p.get('segment_id'))
                    alert_id = hashlib.sha256(json.dumps(key).encode()).hexdigest()[:32]
                    active.append(alert_id)
                    db.execute('INSERT OR IGNORE INTO quota_alerts (id, account, at, reset, kind, message) '
                               'VALUES (?,?,?,?,?,?)', (alert_id, identity, now, reset, kind, message))
        return active

    def list(self, identity, now, active=()):
        if not identity:
            return []
        with closing(self.connect()) as db:
            rows = db.execute('SELECT id, at, reset, kind, message, acknowledged FROM quota_alerts '
                              'WHERE account=? AND at>=? ORDER BY at DESC LIMIT 50', (identity, now-90*86400)).fetchall()
        return [dict(id=r[0], at=r[1], resets_at=r[2], kind=r[3], message=r[4], acknowledged=bool(r[5]),
                     active=r[0] in active and r[2]>now) for r in rows]

    def acknowledge(self, identity, alert_id):
        with closing(self.connect()) as db, db:
            db.execute('UPDATE quota_alerts SET acknowledged=1 WHERE account=? AND id=?', (identity, alert_id))

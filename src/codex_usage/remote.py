"""Incremental SSH collection with local snapshots and nonblocking refresh."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import threading
import time
from datetime import datetime, timezone
from uuid import uuid4


def validate_remotes(values):
    if not isinstance(values, list) or len(values) > 10:
        raise ValueError('最多设置 10 个 SSH 数据源')
    result, seen = [], set()
    for row in values:
        if not isinstance(row, dict):
            raise ValueError('远程数据源格式无效')
        host = row.get('host', '')
        if not isinstance(host, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.@:-]{0,199}', host):
            raise ValueError('SSH 地址应为已有连接名称、IP 或 user@host，不能包含命令或空格')
        path = row.get('path', '')
        if not isinstance(path, str) or len(path) > 1000 or any(c in path for c in '\r\n\x00'):
            raise ValueError('远程 Codex 目录无效')
        if path and not (path.startswith('/') or path.startswith('~/')):
            raise ValueError('远程目录使用绝对路径或 ~/；留空则自动发现')
        name = row.get('name') or host
        interval = row.get('interval', 120)
        enabled = row.get('enabled', True)
        if not isinstance(name, str) or len(name) > 80:
            raise ValueError('远程名称最多 80 个字符')
        if isinstance(interval, bool) or not isinstance(interval, int) or not 30 <= interval <= 86400:
            raise ValueError('同步间隔需为 30 至 86400 秒')
        if not isinstance(enabled, bool):
            raise ValueError('远程启用状态无效')
        key = hashlib.sha256((host + '\n' + path).encode()).hexdigest()[:16]
        if key in seen:
            raise ValueError('同一个远程目录不能重复添加')
        seen.add(key)
        result.append(dict(id=key, host=host, path=path, name=name, interval=interval, enabled=enabled))
    return result


def read_snapshot(directory, remote):
    path = Path(directory) / (remote['id'] + '.json')
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
        return data if data.get('version') == 1 else {}
    except (OSError, ValueError):
        return {}


def collector_script(remote, previous):
    directory = Path(__file__).parent
    known = {name: row['signature'] for name, row in previous.get('files', {}).items()
             if row.get('data') and not row.get('retained')}
    request = json.dumps({'path': remote['path'], 'known': known})
    # Inputs are JSON data inside Python string literals, never shell syntax.
    return (directory.joinpath('reader.py').read_text(encoding='utf-8') +
            '\nREQUEST = json.loads(' + repr(request) + ')\n' +
            directory.joinpath('remote_collector.txt').read_text(encoding='utf-8'))


def merge_snapshot(reply, previous):
    if reply.get('error'):
        raise ValueError(reply['error'])
    if reply.get('version') != 1 or not isinstance(reply.get('files'), dict) or not isinstance(reply.get('metadata'), dict):
        raise ValueError('服务器返回了无法识别的用量数据')
    files = {}
    old = previous.get('files', {})
    for name, row in reply['files'].items():
        if 'data' in row:
            files[name] = {**row, 'retained': False}
        elif name in old and row['signature'] == old[name]['signature']:
            files[name] = {**old[name], 'retained': False}
        else:
            raise ValueError('远程增量快照不完整，请重新同步')
    for name, row in old.items():
        if name not in files:
            files[name] = {**row, 'retained': True}
    return {**reply, 'files': files,
            'metadata': {**previous.get('metadata', {}), **reply['metadata']},
            'synced_at': datetime.now(timezone.utc).isoformat()}


def fetch_remote(remote, previous, runner=subprocess.run):
    executable = shutil.which('ssh')
    if not executable:
        raise ValueError('未找到 OpenSSH 客户端，请在 Windows 可选功能中安装 OpenSSH 客户端')
    command = [executable, '-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8',
               '-o', 'ClearAllForwardings=yes', '-o', 'StrictHostKeyChecking=yes',
               '-o', 'ServerAliveInterval=10', '-o', 'ServerAliveCountMax=2',
               remote['host'], 'python3', '-']
    try:
        completed = runner(command, input=collector_script(remote, previous).encode('utf-8'),
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=90,
                           creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    except subprocess.TimeoutExpired:
        raise ValueError('连接或读取超时，继续显示上次同步的数据') from None
    try:
        reply = json.loads(completed.stdout.decode('utf-8'))
    except (ValueError, UnicodeDecodeError):
        error = completed.stderr.decode('utf-8', errors='replace').strip()[:600]
        raise ValueError(error or '服务器未返回用量；请确认已配置免密 SSH，且远程有 Python 3') from None
    if completed.returncode and not reply.get('error'):
        raise ValueError('远程采集未成功完成')
    return merge_snapshot(reply, previous)


class RemoteSync:
    def __init__(self, directory, on_change):
        self.directory = Path(directory)
        self.on_change = on_change
        self.lock = threading.Lock()
        self.states = {}
        self.threads = []

    def statuses(self, remotes):
        with self.lock:
            result = []
            for remote in remotes:
                saved = read_snapshot(self.directory, remote)
                state = self.states.get(remote['id'], {})
                result.append({**remote, 'synced_at': saved.get('synced_at'),
                               'root': saved.get('root'), 'files': len(saved.get('files', {})),
                               'busy': state.get('busy', False), 'error': state.get('error', '')})
            return result

    def request(self, remotes, force=False):
        with self.lock:
            self.threads = [t for t in self.threads if t.is_alive()]
            for remote in remotes:
                state = self.states.setdefault(remote['id'], {})
                if not remote['enabled'] or state.get('busy'):
                    continue
                if not force and time.monotonic() - state.get('attempt', -86400) < remote['interval']:
                    continue
                state.update(busy=True, attempt=time.monotonic(), error='')
                thread = threading.Thread(target=self._sync, args=(dict(remote),), daemon=True)
                self.threads.append(thread)
                thread.start()

    def _sync(self, remote):
        error = ''
        try:
            previous = read_snapshot(self.directory, remote)
            result = fetch_remote(remote, previous)
            self.directory.mkdir(parents=True, exist_ok=True)
            temporary = self.directory / (remote['id'] + '.' + uuid4().hex + '.tmp')
            temporary.write_text(json.dumps(result, ensure_ascii=False), encoding='utf-8')
            temporary.replace(self.directory / (remote['id'] + '.json'))
        except Exception as exc:
            error = str(exc)
        finally:
            with self.lock:
                self.states[remote['id']].update(busy=False, error=error)
            self.on_change()

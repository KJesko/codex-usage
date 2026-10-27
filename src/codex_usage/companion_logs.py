"""Bounded verification of actual Codex session logs for desktop onboarding."""
import json
import os
from pathlib import Path
import time


def inspect_logs(raw):
    result = {'path': raw if isinstance(raw, str) else '', 'valid': False,
              'message': '请选择 Codex 日志目录'}
    if not isinstance(raw, str) or not raw.strip() or len(raw) > 4096:
        return result
    path = Path(raw.strip()).expanduser()
    if not path.is_absolute():
        return {**result, 'message': '请输入完整的目录路径'}
    if path.name in ('sessions', 'archived_sessions'):
        path = path.parent
    result['path'] = str(path)
    if not path.is_dir():
        return {**result, 'message': '目录不存在或无法访问'}
    # No credentials, databases or arbitrary files are read. A folder name alone
    # is not evidence: require a recognized record in an actual session log.
    pending = [(path / name, 0) for name in ('sessions', 'archived_sessions')]
    examined = 0
    deadline = time.monotonic() + 2
    limited = False
    while pending:
        directory, depth = pending.pop()
        try:
            with os.scandir(directory) as entries:
                for entry in entries:
                    examined += 1
                    if examined > 4096 or time.monotonic() > deadline:
                        limited = True
                        pending.clear()
                        break
                    if entry.is_dir(follow_symlinks=False) and depth < 4:
                        pending.append((Path(entry.path), depth + 1))
                    elif entry.is_file(follow_symlinks=False) and entry.name.endswith('.jsonl'):
                        try:
                            with open(entry.path, 'rb') as stream:
                                for _ in range(16):
                                    line = stream.readline(65537)
                                    if not line or len(line) > 65536:
                                        break
                                    try:
                                        record = json.loads(line)
                                    except (ValueError, UnicodeError):
                                        continue
                                    if not isinstance(record, dict):
                                        continue
                                    payload = record.get('payload')
                                    if not isinstance(payload, dict):
                                        continue
                                    if (record.get('type') == 'session_meta'
                                            and isinstance(payload.get('id'), str) and payload['id']
                                            and record.get('timestamp')):
                                        return {**result, 'valid': True, 'message': '已识别 Codex 会话日志'}
                                    if (record.get('type') == 'event_msg' and payload.get('type') == 'token_count'
                                            and isinstance(payload.get('info'), dict) and record.get('timestamp')):
                                        return {**result, 'valid': True, 'message': '已识别 Codex 用量日志'}
                        except OSError:
                            continue
        except OSError:
            continue
    return {**result, 'message': '检查范围内未找到有效日志，请选择正确的 Codex 数据目录' if limited
            else '未找到有效 Codex 日志，请先使用 Codex 或选择其他目录'}

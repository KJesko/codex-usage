"""Validated, non-secret launch configuration shared by the web supervisor."""
import hashlib
import json
import os
from pathlib import Path


def identity(data_dir):
    return hashlib.sha256(os.path.normcase(str(Path(data_dir).resolve())).encode()).hexdigest()[:16]


def describe(data_dir):
    directory = Path(data_dir).expanduser().resolve()
    default = Path.home() / '.codex-usage'
    task = 'CodexUsage-Web-Background'
    if directory != default.resolve():
        task += '-' + identity(directory)
    return {'data_dir': str(directory), 'state_dir': str(directory / 'web-service'), 'task_name': task}


def save_launch(data_dir, port):
    if type(port) is not int or not 1 <= port <= 65535:
        raise ValueError('Invalid web port')
    info = describe(data_dir)
    state = Path(info['state_dir'])
    state.mkdir(parents=True, exist_ok=True)
    # Only local path overrides: never persist proxy URLs, credentials or the whole environment.
    environment = {}
    for key in ('CODEX_HOME', 'CODEX_USAGE_CLI'):
        value = os.environ.get(key)
        if value:
            environment[key] = str(Path(value).expanduser().resolve())
    value = {'port': port, 'data_dir': info['data_dir'], 'environment': environment}
    temporary = state / 'launch.tmp'
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
    temporary.replace(state / 'launch.json')
    return value


def load_launch(data_dir):
    info = describe(data_dir)
    path = Path(info['state_dir']) / 'launch.json'
    if not path.exists():  # Existing default installations from before launch profiles.
        return {'port': 8787, 'data_dir': info['data_dir'], 'environment': {}}
    value = json.loads(path.read_text(encoding='utf-8'))
    if (not isinstance(value, dict) or type(value.get('port')) is not int
            or not 1 <= value['port'] <= 65535 or value.get('data_dir') != info['data_dir']):
        raise ValueError('Invalid background launch profile')
    environment = value.get('environment', {})
    if (not isinstance(environment, dict)
            or any(k not in ('CODEX_HOME', 'CODEX_USAGE_CLI') or not isinstance(v, str)
                   or not Path(v).is_absolute() for k, v in environment.items())):
        raise ValueError('Invalid background environment')
    return {**value, 'environment': environment}


def server_command(python, root, launch):
    return [str(python), '-u', str(Path(root) / 'codex_usage.py'), '--no-browser',
            '--port', str(launch['port']), '--data-dir', launch['data_dir']]

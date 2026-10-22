"""Read-only, bounded checks of user-selected log roots. Never read credentials."""
import os
import platform
from pathlib import Path
from .account import find_codex, AccountError


def setup_status(roots, data_dir, port, first_run):
    try:
        executable = find_codex()
    except (AccountError, OSError):
        executable = None
    system = platform.system()
    if system == 'Linux' and ('microsoft' in platform.release().lower() or os.environ.get('WSL_DISTRO_NAME')):
        system = 'WSL'
    return {'first_run': first_run, 'system': system, 'data_dir': str(data_dir),
            'port': port, 'url': f'http://127.0.0.1:{port}', 'cli_available': bool(executable),
            'default_source': str(Path(os.environ.get('CODEX_HOME') or Path.home() / '.codex').expanduser().resolve()),
            'sources': check_sources(roots)}


def check_sources(roots):
    if not isinstance(roots, list) or not 1 <= len(roots) <= 20:
        raise ValueError('请设置 1 至 20 个 Codex 数据目录')
    result = []
    for raw in roots:
        if not isinstance(raw, str) or not raw.strip() or len(raw) > 4096:
            raise ValueError('数据目录必须为绝对路径')
        path = Path(raw.strip()).expanduser()
        if not path.is_absolute():
            raise ValueError('数据目录必须为绝对路径')
        status = 'ready'
        suggested = None
        try:
            # Inspect only immediate names; no recursive scan or file contents.
            with os.scandir(path) as entries:
                names = set()
                for i, entry in enumerate(entries):
                    names.add(entry.name)
                    if i >= 2047:
                        break
            if path.name in ('sessions', 'archived_sessions'):
                status, suggested = 'child', str(path.parent)
            elif not ({'sessions', 'archived_sessions', 'session_index.jsonl'} & names
                      or any(n.startswith('state_') and n.endswith('.sqlite') for n in names)):
                status = 'no_logs'
        except FileNotFoundError:
            status = 'missing'
        except NotADirectoryError:
            status = 'file'
        except OSError:
            status = 'unreadable'
        result.append({'path':str(path), 'status':status, 'suggested':suggested})
    return result

"""Bounded local directory listing for the explicit web folder picker."""
import os
from pathlib import Path


def browse_directory(raw=None):
    if raw is not None and (not isinstance(raw, str) or len(raw) > 4096):
        raise ValueError('数据目录必须为绝对路径')
    path = Path(raw).expanduser() if raw else Path.home()
    if not path.is_absolute():
        raise ValueError('数据目录必须为绝对路径')
    path = path.resolve()
    folders, truncated = [], False
    try:
        with os.scandir(path) as entries:
            for index, entry in enumerate(entries):
                if index >= 2048:
                    truncated = True
                    break
                try:
                    if entry.is_dir():
                        folders.append({'name':entry.name, 'path':str(path / entry.name)})
                except OSError:
                    continue
    except OSError:
        raise ValueError('无法打开此目录，请检查路径和访问权限') from None
    roots = [str(Path(f'{letter}:\\')) for letter in 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
             if Path(f'{letter}:\\').is_dir()] if os.name == 'nt' else ['/']
    return {'path':str(path), 'parent':str(path.parent) if path.parent != path else None,
            'home':str(Path.home()), 'roots':roots, 'truncated':truncated,
            'folders':sorted(folders, key=lambda row:row['name'].casefold())}

# Build on Windows with: python -m PyInstaller --noconfirm --clean CodexUsage.spec
from pathlib import Path
from PyInstaller.utils.hooks import collect_data_files

root = Path(SPECPATH)
data = collect_data_files('tzdata') + [
    (str(root / 'src/codex_usage/static'), 'codex_usage/static'),
    (str(root / 'src/codex_usage/locales'), 'codex_usage/locales'),
    (str(root / 'src/codex_usage/prices.json'), 'codex_usage'),
    (str(root / 'src/codex_usage/reader.py'), 'codex_usage'),
    (str(root / 'src/codex_usage/remote_collector.txt'), 'codex_usage'),
    (str(root / 'LICENSE'), 'licenses'),
    (str(root / 'NOTICE'), 'licenses'),
    (str(root / 'build/THIRD-PARTY-LICENSES.txt'), 'licenses'),
]
a = Analysis([str(root / 'packaging/windows_entry.py')], pathex=[str(root / 'src')],
             binaries=[], datas=data, hiddenimports=['webview.platforms.edgechromium'],
             hookspath=[], hooksconfig={}, runtime_hooks=[],
             excludes=['tkinter', 'PyQt5', 'PyQt6', 'PySide2', 'PySide6', 'gi', 'PIL'],
             noarchive=False, optimize=0)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, a.binaries, a.datas, [], name='CodexUsage',
          debug=False, bootloader_ignore_signals=False, strip=False, upx=False,
          console=False, disable_windowed_traceback=False,
          version=str(root / 'packaging/windows-version.txt'),
          icon=str(root / 'src/codex_usage/static/icon.ico'))

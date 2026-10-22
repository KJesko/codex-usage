"""Source-web-only Windows background task controls."""
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
from .background_config import describe, load_launch

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "enable-web-background.ps1"
STATE = Path.home() / ".codex-usage" / "web-service"
_lock = threading.Lock()
_cached = None
_checked = 0
_cache_key = None


def supported():
    return os.name == "nt" and not getattr(sys, "frozen", False) and SCRIPT.is_file()


def run_task(*args):
    result = subprocess.run(
        ["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
         "-File", str(SCRIPT), *args],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), timeout=30,
    )
    if result.returncode:
        raise OSError("Windows 后台任务操作失败，请检查当前用户的任务计划程序权限。")
    return result.stdout.strip().lstrip("\ufeff")


def status(force=False, *, data_dir=None, port=8787):
    global _cached, _checked, _cache_key
    info = describe(data_dir or STATE.parent)
    state = Path(info['state_dir']) if data_dir else STATE
    task_args = ['-DataDir', info['data_dir']] if data_dir else []
    if not supported():
        return {"supported": False}
    with _lock:
        if force or _cached is None or _cache_key != info['data_dir'] or time.monotonic()-_checked > 10:
            try:
                _cached = json.loads(run_task("-Status", *task_args))
            except (OSError, ValueError, subprocess.TimeoutExpired):
                _cached = {"enabled": None, "error": "暂时无法读取 Windows 计划任务，请稍后刷新。"}
            _checked = time.monotonic()
            _cache_key = info['data_dir']
        result = {"supported": True, **_cached}
    try:
        saved = json.loads((state / "status.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        saved = {}
    try:
        launch = load_launch(info['data_dir'])
        result['configuration_matches'] = launch['port'] == port
        result['configured_port'] = launch['port']
    except (OSError, ValueError):
        result['configuration_matches'] = False
    result.update(data_dir=info['data_dir'], port=port, task_name=info['task_name'],
                  phase=saved.get('phase'),
                  supervisor_running=bool(saved.get("running") and time.time()-saved.get("heartbeat", 0)<15),
                  last_started=saved.get("last_started"), last_restart=saved.get("last_restart"),
                  server_pid=os.getpid())
    return result


def configure(enabled, *, data_dir=None, port=8787):
    global _cached
    if type(enabled) is not bool:
        raise ValueError("enabled 必须为布尔值")
    if not supported():
        raise ValueError("仅 Windows 源码网页版支持后台任务管理")
    # Keep this web server alive when disabling recovery, so the user can re-enable
    # it from the same page. No task names, commands or paths come from the request.
    with _lock:
        args = ['-DataDir', str(Path(data_dir).resolve()), '-Port', str(port)] if data_dir else []
        run_task(*args, *([] if enabled else ["-Disable", "-KeepServer"]))
        _cached = None
    return status(force=True, **({'data_dir': data_dir, 'port': port} if data_dir else {}))

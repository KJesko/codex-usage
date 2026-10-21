"""Source-web-only Windows background task controls."""
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import time

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "enable-web-background.ps1"
STATE = Path.home() / ".codex-usage" / "web-service"
_lock = threading.Lock()
_cached = None
_checked = 0


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


def status(force=False):
    global _cached, _checked
    if not supported():
        return {"supported": False}
    with _lock:
        if force or _cached is None or time.monotonic()-_checked > 10:
            try:
                _cached = json.loads(run_task("-Status"))
            except (OSError, ValueError, subprocess.TimeoutExpired):
                _cached = {"enabled": None, "error": "暂时无法读取 Windows 计划任务，请稍后刷新。"}
            _checked = time.monotonic()
        result = {"supported": True, **_cached}
    try:
        saved = json.loads((STATE / "status.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        saved = {}
    result.update(supervisor_running=bool(saved.get("running") and time.time()-saved.get("heartbeat", 0)<15),
                  last_started=saved.get("last_started"), last_restart=saved.get("last_restart"),
                  server_pid=os.getpid())
    return result


def configure(enabled):
    global _cached
    if type(enabled) is not bool:
        raise ValueError("enabled 必须为布尔值")
    if not supported():
        raise ValueError("仅 Windows 源码网页版支持后台任务管理")
    # Keep this web server alive when disabling recovery, so the user can re-enable
    # it from the same page. No task names, commands or paths come from the request.
    with _lock:
        run_task(*([] if enabled else ["-Disable", "-KeepServer"]))
        _cached = None
    return status(force=True)

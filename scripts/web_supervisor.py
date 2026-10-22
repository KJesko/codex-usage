"""Keep the source web server running without opening a browser or console."""
import json
import os
import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path
import socket
import subprocess
import sys
import threading
import time
import msvcrt
import argparse
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
from codex_usage.background_config import describe, identity, load_launch, save_launch, server_command
STATE = Path.home() / ".codex-usage" / "web-service"


def port_busy(port):
    with socket.socket() as sock:
        sock.settimeout(1)
        return sock.connect_ex(("127.0.0.1", port)) == 0


def occupied_phase(launch):
    try:
        with urlopen(f"http://127.0.0.1:{launch['port']}/api/health", timeout=2) as response:
            health = json.load(response)
        if isinstance(health, dict) and health.get('app') == 'codex-usage' and health.get('instance') == identity(launch['data_dir']):
            return 'waiting_server'
    except (OSError, ValueError):
        pass
    return 'port_conflict'


def retry_delay(failures):
    return min(60, 5 * 2 ** min(max(0, failures - 1), 4))


def stop_child(child):
    # Only terminate the process tree spawned by this supervisor (venv launchers
    # may have a separate Python worker); never kill an unrelated port owner.
    if child.poll() is None:
        subprocess.run(["taskkill", "/PID", str(child.pid), "/T", "/F"],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                       creationflags=subprocess.CREATE_NO_WINDOW, timeout=15)
        child.wait(timeout=10)


def write_status(**updates):
    target = STATE / "status.json"
    try:
        previous = json.loads(target.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        previous = {}
    previous.update(updates)
    previous.update(heartbeat=time.time(), supervisor_pid=os.getpid())
    temporary = target.with_suffix(".tmp")
    temporary.write_text(json.dumps(previous), encoding="utf-8")
    os.replace(temporary, target)


def main(data_dir):
    STATE.mkdir(parents=True, exist_ok=True)
    lock = (STATE / "supervisor.lock").open("a+b")
    lock.seek(0)
    if not lock.read(1):
        lock.write(b"0")
        lock.flush()
    lock.seek(0)
    try:
        msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
    except OSError:
        lock.close()
        return
    handler = RotatingFileHandler(STATE / "supervisor.log", maxBytes=2_000_000, backupCount=3, encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    log = logging.getLogger("web-supervisor")
    log.setLevel(logging.INFO)
    log.addHandler(handler)
    log.info("Supervisor started, pid=%s", __import__("os").getpid())
    write_status(running=True)
    failures = 0
    waiting = False
    child = None
    try:
        while not (STATE / "disabled").exists():
            launch = load_launch(data_dir)
            write_status(running=True)
            if port_busy(launch['port']):
                write_status(phase=occupied_phase(launch), port=launch['port'])
                if not waiting:
                    log.info("Port %s already in use; waiting without starting a duplicate server.", launch['port'])
                waiting = True
                time.sleep(5)
                continue
            waiting = False
            started = time.monotonic()
            try:
                output_path = STATE / "server.log"
                if output_path.exists() and output_path.stat().st_size > 2_000_000:
                    os.replace(output_path, STATE / "server.previous.log")
                output = output_path.open("ab")
                child = subprocess.Popen(
                    server_command(sys.executable, ROOT, launch),
                    cwd=ROOT, stdout=output, stderr=subprocess.STDOUT,
                    text=True, encoding="utf-8", errors="replace",
                    env={**os.environ, **launch['environment']},
                    creationflags=subprocess.CREATE_NO_WINDOW,
                )
                log.info("Web server started, pid=%s", child.pid)
                output.close()
                try:
                    previous = json.loads((STATE / "status.json").read_text(encoding="utf-8"))
                except (OSError, ValueError):
                    previous = {}
                write_status(running=True, phase='managed', port=launch['port'], last_started=time.time(), server_pid=child.pid,
                             last_restart=time.time() if previous.get("last_started") else None)
                while child.poll() is None and not (STATE / "disabled").exists():
                    write_status(running=True)
                    time.sleep(1)
                if (STATE / "paused").exists():
                    break
                if child.poll() is None:
                    stop_child(child)
                code = child.wait()
                log.warning("Web server exited, code=%s", code)
                write_status(last_exit=time.time(), last_exit_code=code)
            except OSError:
                log.exception("Cannot start web server")
            if (STATE / "disabled").exists():
                break
            failures = 1 if time.monotonic() - started >= 60 else failures + 1
            delay = retry_delay(failures)
            log.info("Restarting web server in %s seconds", delay)
            for _ in range(delay):
                write_status(running=True)
                if (STATE / "disabled").exists():
                    break
                time.sleep(1)
    finally:
        if child is not None and child.poll() is None and not (STATE / "paused").exists():
            stop_child(child)
        write_status(running=False)
        log.info("Supervisor stopped")
        lock.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-dir', default=str(Path.home() / '.codex-usage'))
    parser.add_argument('--port', type=int, default=8787)
    parser.add_argument('--describe', action='store_true')
    parser.add_argument('--configure', action='store_true')
    args = parser.parse_args()
    info = describe(args.data_dir)
    STATE = Path(info['state_dir'])
    if args.describe:
        print(json.dumps(info))
    elif args.configure:
        save_launch(info['data_dir'], args.port)
    else:
        main(info['data_dir'])

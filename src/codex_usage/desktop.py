"""Native background companion, sharing the dashboard's local service and style."""
import argparse
import ctypes
import hashlib
import json
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import sys
import threading
from urllib.request import urlopen

from . import __version__
from .app import Application, STATIC, make_server

TITLE = "Codex Usage · 后台助手"
DEFAULT_PORT = 17887


class DesktopServer:
    """Own the HTTP thread so closing the desktop window releases its socket."""
    def __init__(self, app, port=DEFAULT_PORT):
        try:
            self.server = make_server(app, port)
        except OSError:
            if port == 0:
                raise
            self.server = make_server(app, 0)
        self.url = f"http://127.0.0.1:{self.server.server_port}"
        self.thread = threading.Thread(target=self.server.serve_forever,
                                       kwargs={"poll_interval": 0.1}, daemon=True)

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *_):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)


class WindowsInstance:
    """One window per data directory, without stale lock files after a crash."""
    def __init__(self, data_dir):
        self.handle = None
        self.already_running = False
        if sys.platform != "win32":
            return
        from ctypes import wintypes
        self.kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        self.kernel.CreateMutexW.argtypes = [ctypes.c_void_p, wintypes.BOOL, wintypes.LPCWSTR]
        self.kernel.CreateMutexW.restype = wintypes.HANDLE
        self.kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        digest = hashlib.sha256(os.path.normcase(str(data_dir)).encode()).hexdigest()[:24]
        self.handle = self.kernel.CreateMutexW(None, False, "Local\\CodexUsage-" + digest)
        if not self.handle:
            raise ctypes.WinError(ctypes.get_last_error())
        self.already_running = ctypes.get_last_error() == 183

    def activate_existing(self):
        from ctypes import wintypes
        user = ctypes.WinDLL("user32", use_last_error=True)
        user.FindWindowW.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR]
        user.FindWindowW.restype = wintypes.HWND
        user.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
        user.SetForegroundWindow.argtypes = [wintypes.HWND]
        window = user.FindWindowW(None, TITLE)
        if window:
            user.ShowWindow(window, 9)  # SW_RESTORE
            user.SetForegroundWindow(window)

    def close(self):
        if self.handle:
            self.kernel.CloseHandle(self.handle)
            self.handle = None


def self_test(app, output):
    """Verify the actual frozen package without requiring an interactive desktop."""
    from .remote import collector_script, validate_remotes
    probe = validate_remotes([{'host': 'package-check'}])[0]
    assert 'def collect_remote' in collector_script(probe, {})
    with DesktopServer(app, 0) as backend:
        def get(path):
            with urlopen(backend.url + path, timeout=60) as response:
                return response.read()
        health = json.loads(get("/api/health"))
        assert health["app"] == "codex-usage"
        for path in ("/", "/app.js", "/style.css", "/icon.svg"):
            assert get(path), f"Empty bundled resource: {path}"
        from .companion import companion_html
        assert 'companion-main' in companion_html()
        data = json.loads(get("/api/data?range=all"))
        total = data["summary"]["total"]
        for dimension in ("timeline", "projects", "sessions", "models"):
            assert sum(row["total"] for row in data[dimension]) == total, dimension
            assert get("/api/export?range=all&dimension=" + dimension).startswith(b"\xef\xbb\xbf")
        result = {"ok": True, "version": __version__, "frozen": bool(getattr(sys, "frozen", False)),
                  "timezone": data["timezone"], "sessions": data["coverage"]["sessions"],
                  "projects": len(data["projects"]), "total_tokens": total,
                  "assets": True, "exports": True, "dimension_totals_match": True}
    output = Path(output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")


def configure_logging(data_dir):
    handler = RotatingFileHandler(data_dir / "desktop.log", maxBytes=1_000_000,
                                  backupCount=2, encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    logging.getLogger().addHandler(handler)
    logging.getLogger().setLevel(logging.INFO)
    # Windowed PyInstaller executables have no stdout/stderr. Libraries may print.
    if sys.stdout is None:
        sys.stdout = open(os.devnull, "w", encoding="utf-8")
    if sys.stderr is None:
        sys.stderr = open(os.devnull, "w", encoding="utf-8")


def show_error(exc, data_dir):
    message = (f"Codex Usage 无法启动：\n{exc}\n\n"
               f"详细日志：{data_dir / 'desktop.log'}\n\n"
               "如果提示缺少 WebView2，请安装 Microsoft Edge WebView2 Runtime：\n"
               "https://developer.microsoft.com/microsoft-edge/webview2/")
    if sys.platform == "win32":
        ctypes.windll.user32.MessageBoxW(None, message, TITLE, 0x10)
    else:
        print(message, file=sys.stderr)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Codex Usage desktop")
    parser.add_argument("--data-dir", default=str(Path.home() / ".codex-usage"))
    parser.add_argument("--codex-home", action="append")
    parser.add_argument("--timezone")
    parser.add_argument("--port", type=int, help="Existing service port (defaults to saved background profile or 8787)")
    parser.add_argument("--gui-test", metavar="RESULT_JSON", help="Verify the native GUI and bridge, then exit")
    parser.add_argument("--self-test", metavar="RESULT_JSON", help="Check packaged assets and data, then exit")
    args = parser.parse_args(argv)
    data_dir = Path(args.data_dir).expanduser().resolve()
    instance = None
    try:
        data_dir.mkdir(parents=True, exist_ok=True)
        # Check the mutex before opening rotating logs or WebView2's shared profile.
        if not args.self_test:
            instance = WindowsInstance(data_dir)
            if instance.already_running:
                instance.activate_existing()
                return 0
        configure_logging(data_dir)
        if args.self_test:
            app = Application(data_dir, args.codex_home, args.timezone)
            self_test(app, args.self_test)
            return 0
        from .companion import CompanionBridge, CompanionController, CompanionService, companion_html
        import webview
        webview.settings["ALLOW_DOWNLOADS"] = False
        webview.settings["ALLOW_FILE_URLS"] = False
        webview.settings["OPEN_EXTERNAL_LINKS_IN_BROWSER"] = True
        if sys.platform == "win32":
            ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("CodexUsage.Desktop.1")
        with CompanionService(data_dir, args.port, args.codex_home, args.timezone) as service:
            logging.info("Starting companion %s (owned backend: %s)", __version__, service.owned)
            controller = CompanionController(service)
            if args.gui_test:
                controller.preferences['notifications'] = False
            window = webview.create_window(TITLE, html=companion_html(), js_api=CompanionBridge(controller),
                                           width=600, height=460, min_size=(480, 460), text_select=True,
                                           background_color="#f5f3ee")
            controller.window = window
            window.events.closing += controller.closing
            def ready():
                if sys.platform == 'win32':
                    try:
                        import pystray
                        from PIL import Image
                        tray = pystray.Icon('CodexUsage', Image.open(STATIC / 'icon.ico'), TITLE,
                            menu=pystray.Menu(
                                pystray.MenuItem('打开后台助手', lambda: controller.show(), default=True),
                                pystray.MenuItem('打开详细看板', lambda: controller.action('dashboard'), enabled=lambda item: controller.dashboard_ready()),
                                pystray.MenuItem('退出助手' + ('并停止采集' if service.owned else ''), lambda: controller.quit())))
                        def tray_ready(icon):
                            icon.visible = True
                            controller.tray = icon
                        tray.run_detached(setup=tray_ready)
                    except Exception:
                        logging.exception('Tray unavailable; keep the window accessible')
                controller.start()
                if args.gui_test:
                    import time
                    result = {'ok': False}
                    try:
                        for _ in range(60):
                            result = window.evaluate_js("({title:document.getElementById('trackingTitle').textContent,buttons:document.querySelectorAll('[data-action]').length,bridge:!!window.pywebview?.api,version:document.getElementById('version').textContent,overflow:document.documentElement.scrollWidth>innerWidth,vertical_overflow:document.documentElement.scrollHeight>innerHeight,gate:!document.getElementById('dashboardButton').disabled})")
                            if (result.get('bridge') and __version__ in result.get('version', '')
                                    and controller.status()['connected'] and (sys.platform != 'win32' or controller.tray)):
                                result['tray_available'] = controller.tray is not None
                                result['close_hides'] = controller.closing() is False if controller.tray else None
                                if controller.tray:
                                    controller.show()
                                result['ok'] = not result['overflow'] and not result['vertical_overflow'] and result['buttons'] >= 7 and result['gate'] == controller.dashboard_ready()
                                break
                            time.sleep(.5)
                    finally:
                        Path(args.gui_test).write_text(json.dumps(result, ensure_ascii=False), encoding='utf-8')
                        controller.quit()
            try:
                webview.start(ready, gui="edgechromium" if sys.platform == "win32" else None,
                              private_mode=False, storage_path=str(data_dir / "companion-webview"),
                              icon=str(STATIC / "icon.ico"),
                              localization={"global.cancel": "取消", "global.ok": "确定"})
            finally:
                controller.close()
        logging.info("Companion exited; externally managed services left running")
        if args.gui_test:
            return 0 if json.loads(Path(args.gui_test).read_text(encoding='utf-8')).get('ok') else 1
        return 0
    except Exception as exc:
        logging.exception("Desktop startup failed")
        if args.self_test or args.gui_test:
            Path(args.self_test or args.gui_test).write_text(json.dumps({"ok": False, "error": str(exc)},
                                                       ensure_ascii=False), encoding="utf-8")
        else:
            show_error(exc, data_dir)
        return 1
    finally:
        if instance:
            instance.close()


if __name__ == "__main__":
    raise SystemExit(main())

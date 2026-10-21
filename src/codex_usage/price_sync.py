"""Daily public pricing snapshots, independent of browser visits."""
import copy
import json
import math
import re
import threading
import time
from datetime import datetime, timezone
from urllib.request import Request, urlopen
from .pricing import CATALOG, price_for

SOURCE = "https://developers.openai.com/api/docs/pricing"
INTERVAL = 86400

def parse_prices(document):
    tables, models = [], {}
    section, tier, headers, rows = "", "Standard", None, []
    allowed = {"Flagship models", "Cyber models", "Life sciences models", "Specialized models"}
    def finish():
        nonlocal headers, rows
        if headers and rows:
            tables.append(dict(section=section, tier=tier, headers=headers, rows=rows))
            if section in allowed and tier == "Standard" and "Model" in headers:
                for cells in rows:
                    row = dict(zip(headers, cells))
                    name = re.sub(r" \(.*$", "", row["Model"])
                    if not re.fullmatch(r"[a-z0-9][a-z0-9.-]+", name):
                        continue
                    def amount(key):
                        value = row.get(key, "-")
                        if value == "Free":
                            return 0.0
                        if value == "-":
                            return None
                        if not re.fullmatch(r"\$[0-9]+(?:\.[0-9]+)?", value):
                            raise ValueError("Unexpected price format")
                        return float(value[1:])
                    long = "Short context input" in row
                    prefix = "Short context " if long else ""
                    rate = dict(input=amount(prefix+"input" if long else "Input"),
                                output=amount(prefix+"output" if long else "Output"),
                                cached=amount(prefix+"cached input" if long else "Cached input"),
                                write=amount(prefix+"30m write") if long else None,
                                long_context=None)
                    if rate["input"] is None or rate["output"] is None:
                        continue
                    if long and amount("Long context input") is not None:
                        rate["long_context"] = 272000
                        rate["long_rates"] = {k:amount("Long context "+label) for k,label in
                                              (("input","input"),("output","output"),("cached","cached input"),("write","30m write"))}
                    if name in models and models[name] != rate:
                        raise ValueError("Conflicting Standard prices")
                    models[name] = rate
        headers, rows = None, []
    for raw in document.splitlines():
        line = raw.strip()
        if line.startswith("|") and line.endswith("|"):
            cells = [v.strip() for v in line.strip("|").split("|")]
            if all(re.fullmatch(r":?-+:?", v) for v in cells):
                continue
            if headers is None:
                headers = cells
            elif len(cells) == len(headers):
                rows.append(cells)
            else:
                raise ValueError("Malformed price table")
        else:
            finish()
            if line in allowed | {"Multimodal models", "GPT-Live sessions", "Realtime and audio generation models", "Image generation models", "Video generation models", "Transcription models", "Tools", "Finetuning"}:
                section, tier = line, "Standard"
            heading = re.sub(r"^#+ ", "", line)
            if heading in ("Standard", "Batch", "Flex", "Fast", "Ultrafast"):
                tier = heading
            elif heading.endswith(" pricing data"):
                tier = heading.removesuffix(" pricing data")
    finish()
    if len(models) < 20 or len(tables) < 10 or "gpt-5.3-codex" not in models:
        raise ValueError("Incomplete official pricing document")
    return models, tables

class PriceSync:
    def __init__(self, path, fetcher=None, clock=time.time, needed=None, used=None):
        self.path, self.clock, self.fetcher = path, clock, fetcher or self.fetch
        self.needed = needed or (lambda: set(CATALOG["models"]))
        self.used = used or self.needed
        self.lock = threading.RLock()
        self.stop = threading.Event()
        self.thread = None
        self.saved = {}
        self.busy = False
        try:
            saved = json.loads(path.read_text(encoding="utf-8"))
            models = saved.get("models", {})
            saved.setdefault("last_check", saved.get("last_attempt"))
            if not isinstance(saved.get("last_check"), (int,float)) or not math.isfinite(saved["last_check"]):
                raise ValueError("Invalid saved timestamp")
            self.saved = {**saved, "models":models}
        except (OSError, ValueError, KeyError, TypeError):
            pass

    @staticmethod
    def fetch():
        req = Request(SOURCE+".md", headers={"User-Agent":"CodexUsage/1.1", "Accept":"text/markdown"})
        with urlopen(req, timeout=30) as response:
            if not response.url.startswith("https://developers.openai.com/"):
                raise ValueError("Unexpected pricing source")
            body = response.read(2_000_001)
        if len(body)>2_000_000:
            raise ValueError("Pricing document too large")
        return body.decode("utf-8")

    def catalog(self):
        with self.lock:
            data = copy.deepcopy(CATALOG)
            data["models"].update(self.saved.get("models", {}))
            if self.saved.get("last_success"):
                data["verified_at"] = datetime.fromtimestamp(self.saved["last_success"], timezone.utc).isoformat()
            return data

    def status(self):
        with self.lock:
            return {key:self.saved.get(key) for key in ("last_check","last_attempt","last_success","error","missing","unresolved")} | {
                "busy":self.busy, "interval_seconds":INTERVAL,
                "next_check":(self.saved.get("last_check") or self.clock())+INTERVAL}

    def persist(self):
        temporary = self.path.with_suffix(".tmp")
        temporary.write_text(json.dumps(self.saved, ensure_ascii=False), encoding="utf-8")
        temporary.replace(self.path)

    def sync_due(self, force=False, requested=None):
        with self.lock:
            now = self.clock()
            last = self.saved.get("last_check")
            if self.busy:
                return False
            daily = last is None or now-last >= INTERVAL
            self.busy = True
        try:
            missing = set(self.needed())
            targets = set(self.used()) if daily and not force else missing
            if requested is not None:
                targets &= set(requested)
            if not daily and not force:
                # New missing models need not wait for the next daily refresh.
                attempts = self.saved.get("model_attempts", {})
                targets = {name for name in missing if now-attempts.get(name, -INTERVAL) >= INTERVAL}
                if not targets:
                    return False
            # Bound all requests, including newly discovered models and manual clicks.
            attempt = self.saved.get("last_attempt")
            if targets and attempt is not None and now-attempt < 60:
                return False
            with self.lock:
                self.saved.update(missing=sorted(missing), error=None)
                if daily:
                    self.saved["last_check"] = now
            if not targets:
                with self.lock:
                    self.saved["unresolved"] = []
                    self.persist()
                return False
            with self.lock:
                self.saved["last_attempt"] = now
                self.saved["model_attempts"] = {**self.saved.get("model_attempts", {}),
                                                **{name:now for name in targets}}
            document = self.fetcher()
            models, _ = parse_prices(document)
            catalog = {**CATALOG, "models":models}
            found = {name:price_for(name, catalog=catalog) for name in targets}
            found = {name:rate for name,rate in found.items() if rate is not None}
            with self.lock:
                previous = copy.deepcopy(self.saved)
                self.saved.update(models={**self.saved.get("models",{}), **found},
                                  last_success=self.clock(),
                                  unresolved=sorted(targets-set(found)))
                # Avoid retaining or returning the full official table to the UI.
                self.saved.pop("document",None)
                self.saved.pop("tables",None)
                try:
                    self.persist()
                except OSError:
                    self.saved = previous
                    raise
            return True
        except Exception:
            with self.lock:
                if daily:
                    self.saved["last_check"] = now
                self.saved.update(error="获取价格失败，保留已有单价；可稍后手动重试，后台将在下次检查时重试。")
                try:
                    self.persist()
                except OSError:
                    pass
            return False
        finally:
            with self.lock:
                self.busy = False

    def request(self, models=None):
        with self.lock:
            if self.busy:
                return
        threading.Thread(target=self.sync_due, kwargs={"force":True,"requested":models},
                         daemon=True, name="missing-price-fetch").start()

    def start(self):
        if self.thread:
            return
        def run():
            while not self.stop.is_set():
                self.sync_due()
                self.stop.wait(30)
        self.thread = threading.Thread(target=run, daemon=True, name="official-price-sync")
        self.thread.start()

    def close(self):
        self.stop.set()
        if self.thread:
            self.thread.join(timeout=1)

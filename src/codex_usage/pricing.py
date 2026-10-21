"""Explicit pricing; an unknown model is never represented as free."""
import json
import re
from pathlib import Path

CATALOG = json.loads(Path(__file__).with_name("prices.json").read_text(encoding="utf-8"))


def price_for(model, overrides=None, catalog=None):
    catalog = catalog or CATALOG
    if overrides and model in overrides:
        return overrides[model]
    prices = {**catalog["models"], **(overrides or {})}
    name = catalog["aliases"].get(model, model)
    # An exact published rate supersedes a fallback alias; custom rates still win.
    if model in prices and not (overrides and name in overrides):
        name = model
    if name not in prices:
        name = re.sub(r"-\d{4}-\d{2}-\d{2}$", "", name)
    return prices.get(name)


def estimate(event, overrides=None, catalog=None):
    """Current Standard API equivalent, regardless of Codex subscription/tier.

    Cached reads and writes are subsets of input; reasoning is part of output.
    Long-context thresholds apply per observed request, never to session totals.
    """
    rate = price_for(event["model"], overrides, catalog)
    was_long = bool(rate and rate.get("long_context") and event["context_input"] > rate["long_context"])
    if rate and rate.get("long_rates") and event["context_input"] > (rate.get("long_context") or float("inf")):
        rate = {**rate, **rate["long_rates"], "long_context":None}
    if rate is None or any(event[count] and rate.get(key) is None for key,count in
                           (("input","uncached"),("cached","cached"),("write","write"),("output","output"))):
        return {"cost": None, "input_cost": None, "cached_cost": None,
                "write_cost": None, "output_cost": None, "cache_savings": None}
    long = bool(rate.get("long_context") and event["context_input"] > rate["long_context"])
    im, om = (2, 1.5) if long else (1, 1)
    parts = {
        "input_cost": event["uncached"] * (rate["input"] or 0) * im / 1e6,
        "cached_cost": event["cached"] * (rate["cached"] or 0) * im / 1e6,
        "write_cost": event["write"] * (rate["write"] or 0) * im / 1e6,
        "output_cost": event["output"] * (rate["output"] or 0) * om / 1e6,
    }
    return {**parts, "cost": sum(parts.values()), "long_context": was_long,
            "cache_savings": event["cached"] * ((rate["input"] or 0) - (rate["cached"] or 0)) * im / 1e6}

"""Explicit pricing; an unknown model is never represented as free."""
import json
import re
from pathlib import Path

CATALOG = json.loads(Path(__file__).with_name("prices.json").read_text(encoding="utf-8"))


def price_for(model, overrides=None):
    if overrides and model in overrides:
        return overrides[model]
    prices = {**CATALOG["models"], **(overrides or {})}
    name = CATALOG["aliases"].get(model, model)
    if name not in prices:
        name = re.sub(r"-\d{4}-\d{2}-\d{2}$", "", name)
    return prices.get(name)


def estimate(event, overrides=None):
    """Current Standard API equivalent, regardless of Codex subscription/tier.

    Cached reads and writes are subsets of input; reasoning is part of output.
    Long-context thresholds apply per observed request, never to session totals.
    """
    rate = price_for(event["model"], overrides)
    if rate is None:
        return {"cost": None, "input_cost": None, "cached_cost": None,
                "write_cost": None, "output_cost": None, "cache_savings": None}
    long = bool(rate.get("long_context") and event["context_input"] > rate["long_context"])
    im, om = (2, 1.5) if long else (1, 1)
    parts = {
        "input_cost": event["uncached"] * rate["input"] * im / 1e6,
        "cached_cost": event["cached"] * rate["cached"] * im / 1e6,
        "write_cost": event["write"] * rate["write"] * im / 1e6,
        "output_cost": event["output"] * rate["output"] * om / 1e6,
    }
    return {**parts, "cost": sum(parts.values()), "long_context": long,
            "cache_savings": event["cached"] * (rate["input"] - rate["cached"]) * im / 1e6}

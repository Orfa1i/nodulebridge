"""Turn `window_months` into calendar dates. Windows count from the index scan."""

from __future__ import annotations

import copy
from datetime import date
from typing import Any

from dateutil.relativedelta import relativedelta


def _dated(action: dict[str, Any], index: date) -> dict[str, Any]:
    out = copy.deepcopy(action)
    window = out.get("window_months")
    if window:
        out["window_start"] = (index + relativedelta(months=window[0])).isoformat()
        out["window_end"] = (index + relativedelta(months=window[1])).isoformat()
    out["then"] = [_dated(a, index) for a in out.get("then", [])]
    return out


def attach_dates(options: list[dict[str, Any]], index: date) -> list[dict[str, Any]]:
    """Return a copy of the options with window_start and window_end filled on every dated action."""
    return [{**opt, "actions": [_dated(a, index) for a in opt["actions"]]} for opt in options]

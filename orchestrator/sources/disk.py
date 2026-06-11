from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any


async def fetch(params: dict[str, Any] | None = None) -> dict[str, Any]:
    params = params or {}
    path = Path(str(params.get("path") or ".")).resolve()
    usage = shutil.disk_usage(path)
    used_pct = round((usage.used / usage.total) * 100, 1) if usage.total else 0

    return {
        "path": str(path),
        "totalBytes": usage.total,
        "usedBytes": usage.used,
        "freeBytes": usage.free,
        "usedPct": used_pct,
        "min": 0,
        "max": 100,
        "state": disk_state(used_pct),
        "summaryItems": [
            {"label": "Path", "value": str(path)},
            {"label": "Used", "value": format_bytes(usage.used)},
            {"label": "Free", "value": format_bytes(usage.free)},
            {"label": "Total", "value": format_bytes(usage.total)},
        ],
        "slices": [
            {"label": "Used", "value": used_pct, "state": disk_state(used_pct)},
            {"label": "Free", "value": round(100 - used_pct, 1), "state": "stable"},
        ],
        "_source": {"source": "disk", "path": str(path)},
    }


def disk_state(used_pct: float) -> str:
    if used_pct >= 90:
        return "critical"
    if used_pct >= 75:
        return "caution"
    return "stable"


def format_bytes(value: int) -> str:
    units = ["B", "KB", "MB", "GB", "TB"]
    amount = float(value)
    unit = units[0]
    for unit in units:
        if amount < 1024 or unit == units[-1]:
            break
        amount /= 1024
    return f"{amount:.1f}{unit}" if unit != "B" else f"{int(amount)}B"

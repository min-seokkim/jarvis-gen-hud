from __future__ import annotations

import time
from typing import Any


STEP_NAMES = ["Install deps", "Typecheck", "Unit tests", "Bundle"]


async def fetch(params: dict[str, Any] | None = None) -> dict[str, Any]:
    params = params or {}
    started_at = float(params.get("startedAt") or time.time())
    step_seconds = max(float(params.get("stepSeconds") or 2), 0.1)
    fail_at = params.get("failAt")
    elapsed = max(time.time() - started_at, 0)
    active_index = min(int(elapsed // step_seconds), len(STEP_NAMES))
    failed_index = parse_fail_at(fail_at)

    steps = []
    state = "stable"
    for index, name in enumerate(STEP_NAMES):
        status = "pending"
        if failed_index is not None and index == failed_index and active_index >= index:
            status = "failed"
            state = "critical"
        elif index < active_index:
            status = "done"
        elif index == active_index:
            status = "active"
        steps.append({"name": name, "status": status})

    if failed_index is not None and active_index >= failed_index:
        progress = round((failed_index / len(STEP_NAMES)) * 100)
    else:
        progress = min(round((elapsed / (step_seconds * len(STEP_NAMES))) * 100), 100)
    if progress < 100 and state != "critical":
        state = "info"

    return {
        "startedAt": started_at,
        "elapsedSec": round(elapsed, 1),
        "progress": progress,
        "state": state,
        "steps": steps,
        "summaryItems": [
            {"label": "Elapsed", "value": f"{round(elapsed, 1)}s"},
            {"label": "Mode", "value": "simulated build"},
        ],
        "_source": {"source": "build_sim", "stepSeconds": step_seconds},
    }


def parse_fail_at(value: Any) -> int | None:
    if value is None or value == "":
        return None
    if isinstance(value, int):
        return value if 0 <= value < len(STEP_NAMES) else None
    if isinstance(value, str):
        if value.isdigit():
            parsed = int(value)
            return parsed if 0 <= parsed < len(STEP_NAMES) else None
        if value in STEP_NAMES:
            return STEP_NAMES.index(value)
    return None

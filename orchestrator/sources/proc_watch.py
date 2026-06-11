from __future__ import annotations

import asyncio
import os
from typing import Any


async def fetch(params: dict[str, Any] | None = None) -> dict[str, Any]:
    params = params or {}
    pid = params.get("pid")
    if pid is None:
        return {
            "state": "caution",
            "running": False,
            "summaryItems": [{"label": "PID", "value": "missing"}],
            "_source": {"source": "proc_watch"},
        }

    process_id = int(pid)
    running = await asyncio.to_thread(is_running, process_id)
    state = "info" if running else "stable"
    return {
        "pid": process_id,
        "running": running,
        "state": state,
        "summaryItems": [
            {"label": "PID", "value": str(process_id)},
            {"label": "Running", "value": "yes" if running else "no"},
        ],
        "_source": {"source": "proc_watch", "pid": process_id},
    }


def is_running(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    except PermissionError:
        return True
    return True

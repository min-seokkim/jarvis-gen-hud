from __future__ import annotations

import os
import asyncio
import time
from pathlib import Path

from orchestrator.sources import get_source, list_sources
from orchestrator.sources.build_sim import fetch as fetch_build_sim
from orchestrator.sources.disk import fetch as fetch_disk
from orchestrator.sources.proc_watch import fetch as fetch_proc_watch


def test_disk_source_reports_capacity():
    data = asyncio.run(fetch_disk({"path": str(Path.cwd())}))

    assert data["totalBytes"] >= data["usedBytes"]
    assert 0 <= data["usedPct"] <= 100
    assert data["_source"]["source"] == "disk"


def test_build_sim_advances_steps():
    data = asyncio.run(
        fetch_build_sim({"startedAt": time.time() - 3, "stepSeconds": 1})
    )

    assert data["progress"] > 0
    assert data["steps"][0]["status"] == "done"
    assert any(step["status"] == "active" for step in data["steps"])


def test_build_sim_failure_state():
    data = asyncio.run(
        fetch_build_sim({"startedAt": time.time() - 4, "stepSeconds": 1, "failAt": 2})
    )

    assert data["state"] == "critical"
    assert data["steps"][2]["status"] == "failed"


def test_proc_watch_current_process_is_running():
    data = asyncio.run(fetch_proc_watch({"pid": os.getpid()}))

    assert data["running"] is True
    assert data["_source"]["source"] == "proc_watch"


def test_registry_lists_known_sources():
    assert {"disk", "project", "build_sim", "proc_watch"}.issubset(
        set(list_sources())
    )
    assert get_source("missing") is None

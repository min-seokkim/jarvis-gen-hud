from __future__ import annotations

import os
import asyncio
import json
import sys
import time
from pathlib import Path

from orchestrator.sources import (
    describe_sources,
    get_descriptor,
    get_source,
    list_sources,
)
from orchestrator.sources.build_sim import fetch as fetch_build_sim
from orchestrator.sources.command import build_command_fetcher, parse_output
from orchestrator.sources.disk import fetch as fetch_disk
from orchestrator.sources.proc_watch import fetch as fetch_proc_watch
from orchestrator.sources.registry import descriptor_from_manifest, load_dynamic


def _python(code: str) -> list[str]:
    """Portable argv that runs inline Python — no platform-specific binary."""
    return [sys.executable, "-c", code]


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


def test_describe_sources_pins_builtin_schema():
    described = {item["id"]: item for item in describe_sources()}

    assert "_source" in described["disk"]["outputSchema"]
    assert described["disk"]["outputSchema"][0] == "path"
    assert described["build_sim"]["kind"] == "builtin"
    # The serialized view must never leak the fetcher.
    assert all("fetcher" not in item for item in describe_sources())


# --- generic command kind -------------------------------------------------


def test_command_csv_parse_and_state():
    manifest = {
        "id": "fake_gpu",
        "kind": "command",
        "argv": _python("import sys; sys.stdout.write('81, 29\\n')"),
        "parse": {"type": "csv", "columns": ["tempC", "utilPct"], "numeric": True},
        "constants": {"min": 0, "max": 100},
        "state": {"field": "tempC", "caution": 75, "critical": 85},
    }
    fetch = build_command_fetcher(manifest)
    data = asyncio.run(fetch())

    assert data["tempC"] == 81
    assert data["utilPct"] == 29
    assert data["min"] == 0 and data["max"] == 100
    assert data["state"] == "caution"  # 81 >= caution 75, < critical 85
    assert data["_source"] == {"source": "fake_gpu", "kind": "command", "exitCode": 0}
    assert {"label": "tempC", "value": "81"} in data["summaryItems"]


def test_command_json_parse():
    manifest = {
        "id": "j",
        "kind": "command",
        "argv": _python("print('{\"a\": 1, \"b\": 2}')"),
        "parse": {"type": "json", "pick": ["a"]},
    }
    data = asyncio.run(build_command_fetcher(manifest)())
    assert data["a"] == 1 and "b" not in data


def test_command_nonzero_exit_is_caution():
    manifest = {
        "id": "boom",
        "kind": "command",
        "argv": _python("import sys; sys.stderr.write('nope'); sys.exit(3)"),
        "parse": {"type": "csv", "columns": ["x"]},
    }
    data = asyncio.run(build_command_fetcher(manifest)())
    assert data["state"] == "caution"
    assert data["_source"]["exitCode"] == 3
    assert "exit_3" in data["error"]


def test_command_timeout_is_caution():
    manifest = {
        "id": "slow",
        "kind": "command",
        "argv": _python("import time; time.sleep(5)"),
        "timeoutMs": 300,
    }
    data = asyncio.run(build_command_fetcher(manifest)())
    assert data["state"] == "caution"
    assert "timeout" in data["error"]


def test_command_spawn_failure_is_caution():
    manifest = {
        "id": "ghost",
        "kind": "command",
        "argv": ["this-binary-does-not-exist-xyz"],
    }
    data = asyncio.run(build_command_fetcher(manifest)())
    assert data["state"] == "caution"
    assert "spawn_failed" in data["error"]


def test_command_rejects_malformed_argv():
    assert build_command_fetcher({"id": "x", "kind": "command"}) is None
    assert build_command_fetcher({"id": "x", "kind": "command", "argv": []}) is None
    assert build_command_fetcher({"id": "x", "kind": "command", "argv": [1, 2]}) is None


def test_parse_regex_named_groups():
    fields = parse_output(
        "temp=53C util=29%",
        {"type": "regex", "pattern": r"temp=(?P<tempC>\d+)C util=(?P<utilPct>\d+)%", "numeric": True},
    )
    assert fields == {"tempC": 53, "utilPct": 29}


# --- dynamic manifest loader ----------------------------------------------


def test_load_dynamic_discovers_manifest(tmp_path: Path):
    manifest = {
        "id": "tmp_src",
        "kind": "command",
        "description": "temp source",
        "argv": _python("print('1')"),
        "parse": {"type": "csv", "columns": ["v"], "numeric": True},
        "outputSchema": ["v", "state", "_source"],
    }
    (tmp_path / "tmp_src.json").write_text(json.dumps(manifest), encoding="utf-8")
    (tmp_path / "broken.json").write_text("{not json", encoding="utf-8")

    loaded = load_dynamic(tmp_path)
    assert set(loaded) == {"tmp_src"}  # broken manifest skipped
    assert loaded["tmp_src"].kind == "command"

    descriptor = get_descriptor("tmp_src", tmp_path)
    assert descriptor is not None
    data = asyncio.run(descriptor.fetcher())
    assert data["v"] == 1


def test_load_dynamic_skips_unknown_kind(tmp_path: Path):
    (tmp_path / "s.json").write_text(
        json.dumps({"id": "s", "kind": "script", "script": "x.py"}), encoding="utf-8"
    )
    assert load_dynamic(tmp_path) == {}


def test_descriptor_from_manifest_validates():
    assert descriptor_from_manifest({"kind": "command", "argv": ["x"]}) is None  # no id
    assert descriptor_from_manifest("not a dict") is None


def test_empty_dynamic_dir_yields_builtins_only(tmp_path: Path):
    # Fresh-clone simulation: the repo ships NO active dynamic manifest (only
    # *.json.example), so an empty dynamic dir contributes nothing and the app
    # runs on builtins alone — proving GPU/host-independence.
    assert load_dynamic(tmp_path) == {}
    assert {"disk", "project", "build_sim", "proc_watch"}.issubset(set(list_sources()))


def test_gpu_example_is_valid_command_manifest(tmp_path: Path):
    # gpu is shipped only as a host-local EXAMPLE. The example must still be a
    # valid command manifest: copying it into a dynamic dir registers a `gpu`
    # command source, and discovery does NOT run nvidia-smi — so this passes on
    # machines without a GPU.
    example = (
        Path(__file__).resolve().parent.parent
        / "sources" / "dynamic" / "gpu.json.example"
    )
    (tmp_path / "gpu.json").write_text(
        example.read_text(encoding="utf-8"), encoding="utf-8"
    )

    loaded = load_dynamic(tmp_path)
    assert "gpu" in loaded
    assert loaded["gpu"].kind == "command"
    assert "tempC" in loaded["gpu"].output_schema
    assert get_descriptor("gpu", tmp_path) is not None

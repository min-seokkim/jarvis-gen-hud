from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any


async def fetch(params: dict[str, Any] | None = None) -> dict[str, Any]:
    params = params or {}
    root = Path(str(params.get("root") or ".")).resolve()
    branch, status = await asyncio.gather(
        run_git(root, "branch", "--show-current"),
        run_git(root, "status", "--short"),
    )
    files = parse_status(status)

    return {
        "root": str(root),
        "branch": branch.strip() or "detached",
        "changedFiles": len(files),
        "stagedFiles": sum(1 for item in files if item["indexStatus"] not in {" ", "?"}),
        "unstagedFiles": sum(1 for item in files if item["worktreeStatus"] not in {" ", "?"}),
        "untrackedFiles": sum(
            1 for item in files if item["indexStatus"] == "?" and item["worktreeStatus"] == "?"
        ),
        "files": [{"status": item["status"], "path": item["path"]} for item in files[:12]],
        "summaryItems": [
            {"label": "Branch", "value": branch.strip() or "detached"},
            {"label": "Changed", "value": str(len(files))},
        ],
        "_source": {"source": "project", "root": str(root)},
    }


async def run_git(root: Path, *args: str) -> str:
    process = await asyncio.create_subprocess_exec(
        "git",
        "-C",
        str(root),
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await process.communicate()
    if process.returncode != 0:
        raise RuntimeError(stderr.decode("utf-8", errors="replace").strip())
    return stdout.decode("utf-8", errors="replace")


def parse_status(source: str) -> list[dict[str, str]]:
    files: list[dict[str, str]] = []
    for line in source.splitlines():
        if not line:
            continue
        index_status = line[0] if len(line) > 0 else " "
        worktree_status = line[1] if len(line) > 1 else " "
        files.append(
            {
                "status": line[:2].strip() or "modified",
                "path": line[3:],
                "indexStatus": index_status,
                "worktreeStatus": worktree_status,
            }
        )
    return files

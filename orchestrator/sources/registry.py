from __future__ import annotations

from typing import Any, Awaitable, Callable, Protocol

from .build_sim import fetch as fetch_build_sim
from .disk import fetch as fetch_disk
from .proc_watch import fetch as fetch_proc_watch
from .project import fetch as fetch_project


class Source(Protocol):
    def __call__(self, params: dict[str, Any] | None = None) -> Awaitable[dict[str, Any]]:
        ...


_SOURCES: dict[str, Source] = {
    "disk": fetch_disk,
    "project": fetch_project,
    "build_sim": fetch_build_sim,
    "proc_watch": fetch_proc_watch,
}


def get_source(name: str) -> Source | None:
    return _SOURCES.get(name)


def list_sources() -> list[str]:
    return sorted(_SOURCES)

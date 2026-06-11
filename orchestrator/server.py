from __future__ import annotations

import asyncio
import json
import time
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from .sources import get_source, list_sources


MIN_INTERVAL_MS = 1000
app = FastAPI(title="J.A.R.V.I.S Live HUD Orchestrator")


@app.get("/health")
async def health() -> dict[str, Any]:
    return {"ok": True, "sources": list_sources()}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await websocket.accept()
    tasks: dict[str, asyncio.Task[None]] = {}

    async def stop(sub_id: str) -> None:
        task = tasks.pop(sub_id, None)
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    try:
        while True:
            message = await websocket.receive_text()
            try:
                payload = json.loads(message)
            except json.JSONDecodeError:
                await websocket.send_json({"type": "error", "message": "invalid_json"})
                continue

            msg_type = payload.get("type")
            sub_id = str(payload.get("subId") or "")
            if msg_type == "hud.subscribe":
                if not sub_id:
                    await websocket.send_json({"type": "error", "message": "missing_subId"})
                    continue
                await stop(sub_id)
                source_name = str(payload.get("source") or "")
                source = get_source(source_name)
                if source is None:
                    await websocket.send_json(
                        {"type": "hud.end", "subId": sub_id, "reason": "unknown_source"}
                    )
                    continue
                params = payload.get("params") if isinstance(payload.get("params"), dict) else {}
                if source_name == "build_sim" and "startedAt" not in params:
                    params = {**params, "startedAt": time.time()}
                interval_ms = max(int(payload.get("intervalMs") or MIN_INTERVAL_MS), MIN_INTERVAL_MS)
                tasks[sub_id] = asyncio.create_task(
                    subscription_loop(websocket, sub_id, source_name, params, interval_ms)
                )
            elif msg_type == "hud.unsubscribe":
                if sub_id:
                    await stop(sub_id)
            else:
                await websocket.send_json({"type": "error", "message": "unknown_type"})
    except WebSocketDisconnect:
        pass
    finally:
        for sub_id in list(tasks):
            await stop(sub_id)


async def subscription_loop(
    websocket: WebSocket,
    sub_id: str,
    source_name: str,
    params: dict[str, Any],
    interval_ms: int,
) -> None:
    source = get_source(source_name)
    if source is None:
        await websocket.send_json({"type": "hud.end", "subId": sub_id, "reason": "unknown_source"})
        return

    try:
        while True:
            data = await source(params)
            await websocket.send_json({"type": "hud.data", "subId": sub_id, "data": data})
            await asyncio.sleep(interval_ms / 1000)
    except asyncio.CancelledError:
        raise
    except Exception as exc:  # noqa: BLE001 - live channel should report and keep app safe.
        await websocket.send_json({"type": "hud.end", "subId": sub_id, "reason": str(exc)})

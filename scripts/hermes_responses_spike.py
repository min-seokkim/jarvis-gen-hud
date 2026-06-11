from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
WEB_ENV = ROOT / "web" / ".env.local"
ENDPOINT = os.environ.get(
    "HERMES_ENDPOINT", "http://127.0.0.1:8642/v1/responses"
)
MODEL = os.environ.get("HERMES_MODEL", "hermes")


def main() -> int:
    api_key = os.environ.get("API_SERVER_KEY") or read_env_key(WEB_ENV, "API_SERVER_KEY")
    if not api_key:
        print("M4b spike blocked: API_SERVER_KEY was not found in env or web/.env.local.")
        return 2

    conversation = f"jarvis-m4b-spike-{int(time.time())}"
    first = call_responses(
        api_key,
        conversation,
        (
            f"Inspect {ROOT / 'web' / 'package.json'} with a file/tool call. "
            "Tell me the dependency, devDependency, total dependency, and script counts. "
            "Remember these results for the next turn."
        ),
    )
    second = call_responses(
        api_key,
        conversation,
        (
            "방금 확인한 total dependency count와 script count가 뭐였지? "
            "도구를 다시 실행하지 말고 이전 턴 결과로만 답해."
        ),
    )

    result = {
        "conversation": conversation,
        "first": first,
        "second": second,
        "secondTurnReusedContext": len(second["toolEvents"]) == 0,
        "expectedFromPackageJson": package_counts(),
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["secondTurnReusedContext"] else 1


def call_responses(api_key: str, conversation: str, input_text: str) -> dict[str, Any]:
    body = json.dumps(
        {
            "model": MODEL,
            "input": input_text,
            "conversation": conversation,
            "store": True,
            "stream": True,
        }
    ).encode("utf-8")
    request = Request(
        ENDPOINT,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
    )

    started = time.time()
    text: list[str] = []
    tool_events: list[dict[str, Any]] = []
    try:
        with urlopen(request, timeout=180) as response:
            for event in iter_sse(response):
                if event["data"] == "[DONE]":
                    break
                payload = parse_json(event["data"])
                if not payload:
                    continue
                event_type = payload.get("type") or event.get("event")
                if event_type == "response.output_text.delta":
                    text.append(str(payload.get("delta") or payload.get("text") or ""))
                item = payload.get("item") if isinstance(payload.get("item"), dict) else payload
                item_type = item.get("type") if isinstance(item, dict) else None
                if item_type in {"function_call", "tool_call"}:
                    tool_events.append(
                        {
                            "phase": "call",
                            "name": item.get("name") or item.get("tool_name") or item.get("call_id"),
                        }
                    )
                elif item_type in {"function_call_output", "tool_call_output"}:
                    tool_events.append(
                        {
                            "phase": "output",
                            "name": item.get("name") or item.get("tool_name") or item.get("call_id"),
                        }
                    )
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"Hermes HTTP {exc.code}: {detail}") from exc
    except URLError as exc:
        raise RuntimeError(f"Hermes connection failed: {exc.reason}") from exc

    return {
        "durationSec": round(time.time() - started, 2),
        "toolEvents": tool_events,
        "text": "".join(text).strip(),
    }


def iter_sse(response: Any):
    buffer = ""
    while True:
        chunk = response.read(4096)
        if not chunk:
            break
        buffer += chunk.decode("utf-8", errors="replace")
        while "\n\n" in buffer:
            raw, buffer = buffer.split("\n\n", 1)
            event = parse_sse_event(raw)
            if event:
                yield event
    event = parse_sse_event(buffer.strip())
    if event:
        yield event


def parse_sse_event(raw: str) -> dict[str, str] | None:
    event_type = ""
    data: list[str] = []
    for line in raw.splitlines():
        if line.startswith("event:"):
            event_type = line.split(":", 1)[1].strip()
        elif line.startswith("data:"):
            data.append(line.split(":", 1)[1].lstrip())
    if not data:
        return None
    return {"event": event_type, "data": "\n".join(data)}


def parse_json(source: str) -> dict[str, Any] | None:
    try:
        value = json.loads(source)
    except json.JSONDecodeError:
        return None
    return value if isinstance(value, dict) else None


def read_env_key(path: Path, key: str) -> str | None:
    if not path.exists():
        return None
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith(f"{key}="):
            return line.split("=", 1)[1].strip().strip('"')
    return None


def package_counts() -> dict[str, int]:
    package_json = json.loads((ROOT / "web" / "package.json").read_text(encoding="utf-8"))
    dependencies = len(package_json.get("dependencies", {}))
    dev_dependencies = len(package_json.get("devDependencies", {}))
    return {
        "dependencies": dependencies,
        "devDependencies": dev_dependencies,
        "total": dependencies + dev_dependencies,
        "scripts": len(package_json.get("scripts", {})),
    }


if __name__ == "__main__":
    sys.exit(main())

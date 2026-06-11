from __future__ import annotations

import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
WEB_ENV = ROOT / "web" / ".env.local"
ENDPOINT = os.environ.get(
    "HERMES_ENDPOINT", "http://127.0.0.1:8642/v1/chat/completions"
)
MODEL = os.environ.get("HERMES_MODEL", "hermes")

ALLOWED_COMPONENTS = {
    "Panel",
    "StatusPanel",
    "ProgressBar",
    "Gauge",
    "Stat",
    "Steps",
    "Chart",
    "Waveform",
    "Alert",
    "Badge",
    "KeyValue",
}

SYSTEM_PROMPT = """
You are running a J.A.R.V.I.S HUD invention spike.

For each user task, use your available terminal/code_execution/file tools to
collect deterministic data. Do not invent numeric values.

Return JSON only in this exact envelope:
{"say": string, "data": object, "jsx": string|null}

Rules:
- data must be a compact JSON object derived from tool output.
- Include data._source when possible: {"tool": string, "command": string, "exitCode": number}.
- Keep data under 50 KB. Summarize large tool output into compact JSON.
- jsx must be constrained JSX using only these components:
  Panel, StatusPanel, ProgressBar, Gauge, Stat, Steps, Chart, Waveform, Alert, Badge, KeyValue.
- Component props:
  Panel title state;
  ProgressBar value label state showPct;
  Steps steps;
  StatusPanel label value state hint;
  Gauge value min max unit label state;
  Stat label value unit delta state;
  Chart kind data unit label state;
  Waveform samples label state;
  Alert severity title message;
  Badge text state;
  KeyValue items.
- Valid state/severity values are only: stable, info, caution, critical.
- For KeyValue, create data.summaryItems as an array and use <KeyValue items={data.summaryItems} />.
- For Steps, create data.steps as an array and use <Steps steps={data.steps} />.
- For Chart, create data.chartData as an array and use <Chart data={data.chartData} />.
- For Waveform, create data.samples as an array and use <Waveform samples={data.samples} />.
- Top-level JSX must be exactly one <Panel>...</Panel>.
- No imports, no raw HTML, no inline style, no className, no window/document/fetch/eval.
- JSX numeric values and arrays must reference data.*, never hardcode generated numbers or arrays.
- Do not use array literals in JSX props.
- If a HUD is not useful or data collection fails, set jsx to null and explain in say.
""".strip()

TASKS = [
    {
        "name": "git_recent_activity",
        "prompt": f"Show recent git activity for the repository at {ROOT}. Use terminal git log in that path and return a HUD.",
    },
    {
        "name": "disk_usage",
        "prompt": f"Show disk usage for the project drive containing {ROOT}. Use a terminal command and return a HUD.",
    },
    {
        "name": "npm_package_health",
        "prompt": f"Inspect the web package at {ROOT / 'web'} without installing dependencies. Use package files and terminal commands if useful, then return a HUD.",
    },
]


def main() -> int:
    api_key = os.environ.get("API_SERVER_KEY") or read_env_key(WEB_ENV, "API_SERVER_KEY")
    if not api_key:
        print("S1 blocked: API_SERVER_KEY was not found in env or web/.env.local.")
        return 2

    passed = 0
    results: list[dict[str, Any]] = []
    for task in TASKS:
        started = time.time()
        try:
            content = call_hermes(api_key, task["prompt"])
            envelope = extract_envelope(content)
            validate_envelope(envelope)
            if envelope["jsx"] is not None:
                assert_valid_hud_jsx(envelope["jsx"])
            duration = round(time.time() - started, 2)
            passed += 1
            results.append(
                {
                    "task": task["name"],
                    "ok": True,
                    "durationSec": duration,
                    "say": envelope["say"],
                    "source": envelope["data"].get("_source"),
                    "jsx": envelope["jsx"],
                    "dataPreview": preview(envelope["data"]),
                }
            )
        except Exception as exc:  # noqa: BLE001 - spike should report every failure.
            results.append(
                {
                    "task": task["name"],
                    "ok": False,
                    "error": str(exc),
                }
            )

    print(json.dumps({"passed": passed, "total": len(TASKS), "results": results}, indent=2))
    return 0 if passed >= 2 else 1


def read_env_key(path: Path, key: str) -> str | None:
    if not path.exists():
        return None
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith(f"{key}="):
            return line.split("=", 1)[1].strip().strip('"')
    return None


def call_hermes(api_key: str, prompt: str) -> str:
    body = json.dumps(
        {
            "model": MODEL,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            "stream": False,
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
    try:
        with urlopen(request, timeout=180) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"Hermes HTTP {exc.code}: {detail}") from exc
    except URLError as exc:
        raise RuntimeError(f"Hermes connection failed: {exc.reason}") from exc

    try:
        return payload["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError(f"Unexpected Hermes response shape: {payload}") from exc


def extract_envelope(raw: str) -> dict[str, Any]:
    raw = raw.strip()
    candidates = [raw]
    block = re.search(r"```(?:json)?\s*([\s\S]*?)```", raw, re.IGNORECASE)
    if block:
        candidates.append(block.group(1).strip())
    braces = re.search(r"\{[\s\S]*\}", raw)
    if braces:
        candidates.append(braces.group(0).strip())

    for candidate in candidates:
        try:
            value = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            return value
    raise ValueError("Hermes response did not contain a JSON envelope.")


def validate_envelope(envelope: dict[str, Any]) -> None:
    if not isinstance(envelope.get("say"), str):
        raise ValueError("Envelope say must be a string.")
    if not isinstance(envelope.get("data"), dict):
        raise ValueError("Envelope data must be an object.")
    if envelope.get("jsx") is not None and not isinstance(envelope.get("jsx"), str):
        raise ValueError("Envelope jsx must be a string or null.")


def assert_valid_hud_jsx(jsx: str) -> None:
    trimmed = jsx.strip()
    if not trimmed.startswith("<Panel"):
        raise ValueError("Top-level HUD JSX must start with <Panel>.")
    if not trimmed.endswith("</Panel>"):
        raise ValueError("Top-level HUD JSX must end with </Panel>.")
    if re.search(
        r"\b(import|export|window|document|fetch|localStorage|sessionStorage|globalThis|eval|Function)\b",
        trimmed,
    ):
        raise ValueError("HUD JSX contains a forbidden global or statement.")
    if re.search(r"\b(style|className|dangerouslySetInnerHTML)\s*=", trimmed):
        raise ValueError("HUD JSX cannot use style, className, or raw HTML injection props.")
    if re.search(r"#|rgb\(|rgba\(|hsl\(|hsla\(", trimmed, re.IGNORECASE):
        raise ValueError("HUD JSX cannot contain raw color values.")
    if re.search(r"</?[a-z][\w-]*\b", trimmed):
        raise ValueError("HUD JSX cannot use arbitrary HTML elements.")

    for tag in re.finditer(r"</?([A-Z][A-Za-z0-9]*)\b", trimmed):
        if tag.group(1) not in ALLOWED_COMPONENTS:
            raise ValueError(f"HUD JSX uses disallowed component: {tag.group(1)}.")

    if re.search(r"\b(?:value|steps|samples|data)\s*=\s*\{\s*\d", trimmed):
        raise ValueError("HUD JSX must reference deterministic data instead of hardcoded numbers.")
    if re.search(r"\b(?:items|steps|samples|data)\s*=\s*\{\s*(?!data\.)", trimmed):
        raise ValueError("Array props must reference data.* directly.")
    if re.search(r"\b(?:state|severity)\s*=\s*\"(?!stable\"|info\"|caution\"|critical\")", trimmed):
        raise ValueError("State props must use stable, info, caution, or critical.")


def preview(value: Any) -> Any:
    encoded = json.dumps(value, ensure_ascii=False)
    if len(encoded) <= 1000:
        return value
    return encoded[:1000] + "...<truncated>"


if __name__ == "__main__":
    sys.exit(main())

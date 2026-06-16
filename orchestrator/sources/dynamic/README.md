# Dynamic live-source manifests

Each `*.json` file here registers one live source the orchestrator polls
**deterministically** (no LLM in the loop). The directory is re-scanned on every
`/sources` request and every subscribe, so a freshly written manifest is picked
up without a restart (hot reload).

This is the directory Hermes writes a synthesized adapter into. **Only manifests
in this directory are executed** — raw commands from a HUD envelope or model
output are never run. See `docs/decisions/0005-dynamic-live-sources.md` for the
trust boundary.

## Host-local — the repo does not ship any active manifest

`*.json` files here are **host-local** and `.gitignore`d (never committed). The
repo is **GPU/host-independent**: it runs on the builtin sources
(`disk`/`project`/`build_sim`/`proc_watch`) alone, so a fresh clone works on a
machine with no GPU and no extra tooling.

`*.json.example` files are committed templates. Copy one to activate it on a host:

```bash
cp gpu.json.example gpu.json   # picked up on the next /sources (hot reload)
```

If a manifest's command is missing (e.g. `gpu.json` on a box without
`nvidia-smi`), **only that source** reports `state: "caution"` per tick — the
channel stays up and every other source keeps working. Discovery never runs the
command, so listing a source on a machine that lacks its binary cannot crash the
orchestrator.

## `command` manifest

```jsonc
{
  "id": "gpu",                       // unique source id (cannot shadow a builtin)
  "kind": "command",                 // only "command" is supported in Phase 1
  "description": "short guide shown to the model",
  "argv": ["nvidia-smi", "--query-gpu=...", "--format=csv,noheader,nounits"],
  "parse": {                         // stdout -> named fields
    "type": "csv",                   // "csv" | "json" | "regex"
    "columns": ["tempC", "utilPct"], // csv: ordered column names
    "numeric": true                  // coerce numeric-looking values
  },
  "constants": { "min": 0, "max": 100 }, // static fields merged into every tick
  "outputSchema": ["tempC","utilPct","min","max","state","summaryItems","_source"],
  "state": { "field": "tempC", "caution": 75, "critical": 85, "direction": "above" },
  "defaultIntervalMs": 2000,
  "timeoutMs": 2000,                 // per-tick wall clock (clamped 1..10000)
  "maxOutputBytes": 4096,            // stdout cap (clamped)
  "approved": true                   // optional approval gate (default true; false -> caution)
}
```

`parse.type` options:

- **csv** — first non-empty stdout line, split on commas (quoted commas handled),
  mapped to `columns` in order.
- **json** — `json.loads(stdout)`; an object is used as-is, or `pick` selects keys.
- **regex** — `pattern` with named groups (`(?P<name>...)`) becomes the fields.

Failure handling (every tick): a spawn failure, timeout, or non-zero exit emits a
`state: "caution"` payload with an `error` reason instead of raising — the live
channel stays up and the HUD shows caution.

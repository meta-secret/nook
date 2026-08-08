# Loom

Loom weaves mechanical `.cortex` agent rites into a Bun domain-YAML protocol.

Policy stays in `.cortex`. Loom runs deterministic steps and returns YAML plus
exit codes.

Humans do not use Loom interactively. AI agents and Task wrappers do.

## Prerequisites

Bun must be installed (`bun --version`). Stop and install Bun if it is missing.

## Protocol

Single entrypoint:

```bash
loom <request.yaml>
```

Each request is a **domain-tagged object**. Exactly one root key selects the
request kind. There is no generic `name` / `arguments` envelope.

```yaml
prePush:
  stageHostUpdates: true
  fetchOriginMain: true
```

```yaml
agentStatsAssemble:
  prNumber: 123
  scratchPath: /tmp/pr-123-scratch.json
  outputPath: /tmp/123.yaml
  includeTestInventory: true
```

Stdout is YAML only.

Success:

```yaml
ok: true
requestKind: prePush
result: { ... }
```

Decode failure (exit `2`):

```yaml
ok: false
isError: true
phase: decode
errors:
  - path: prePush.stageHostUpdates
    message: expected boolean
recover:
  toolsListRequest: agentic-ai/loom/params/tools-list/default.yaml
  hint: run loom with a toolsList request, then retry with a valid domain request object
```

Discover request kinds:

```bash
task loom:tools-list
```

## TypeScript state rules

Loom authored TypeScript follows the same explicit-state rules as nook-web:

- no authored `null` / `undefined` sentinels
- closed vocabularies use enums (`RequestKind`, `ResponsePhase`, …)
- absence uses `Maybe<T>`
- request shapes are tagged unions decoded with deny-unknown-fields

These are enforced by `task preflight:typescript-state` / Loom CI.

## Agent entrypoints

```bash
task loom:pre-push
task loom:tools-list
task loom:cortex-audit
task loom:run CONFIG=agentic-ai/loom/params/skill-scaffold/request.example.yaml
task loom:agent-stats CONFIG=path/to/agentStatsAssemble.yaml
task loom:pr-land CONFIG=path/to/prLandValidate.yaml
```

Committed examples live under `params/<domain>/`.

## Quality bar

```bash
task loom:verify
```

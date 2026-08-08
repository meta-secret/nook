# Loom

Loom weaves mechanical `.cortex` agent rites into a Bun YAML tool protocol.

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

Request envelope:

```yaml
name: pre-push
arguments:
  stage: true
  fetch: true
```

Stdout is YAML only.

Success:

```yaml
ok: true
name: pre-push
result: { ... }
```

Decode / argument failure (exit `2`):

```yaml
ok: false
isError: true
phase: decode # or unknown-tool | arguments
errors:
  - path: arguments.stage
    message: expected boolean
recover:
  toolsListRequest: agentic-ai/loom/params/tools-list/default.yaml
  hint: run loom with a tools-list request, then retry with a valid arguments object
```

Discover tools:

```bash
task loom:tools-list
# or
bun run --cwd agentic-ai/loom loom -- agentic-ai/loom/params/tools-list/default.yaml
```

## Agent entrypoints

Preferred Task surface (from the repository root):

```bash
task loom:pre-push
task loom:tools-list
task loom:cortex-audit
task loom:run CONFIG=agentic-ai/loom/params/skill-scaffold/request.example.yaml
task loom:agent-stats CONFIG=path/to/assemble-request.yaml
task loom:pr-land CONFIG=path/to/pr-land-request.yaml
```

Direct Bun surface:

```bash
bun run --cwd agentic-ai/loom loom -- agentic-ai/loom/params/pre-push/default.yaml
```

Committed examples live under `params/<tool>/`.

## Tools

| name             | Role                                              |
| ---------------- | ------------------------------------------------- |
| `tools-list`     | Discovery                                         |
| `tools-call`     | Nested call helper                                |
| `pre-push`       | Host `task format` + UI demo contract             |
| `cortex-audit`   | Broken `.cortex` links / skill index sync         |
| `skill-scaffold` | Create a dynamic-skill card                       |
| `agent-stats`    | Assemble / validate / publish AI-agent stats YAML |
| `pr-land`        | Status / validate / ready / merge-check           |

## Quality bar

```bash
task loom:verify
```

`task format` also runs `task loom:format` on the host after product/Hive format.

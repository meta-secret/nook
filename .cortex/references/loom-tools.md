# Reference: Loom YAML tool protocol

Loom is the Bun tool runner for mechanical cortex rites.

Agents call it. Humans do not use it interactively.

Full package docs: [`agentic-ai/loom/README.md`](../../agentic-ai/loom/README.md).

## Invoke

Exactly one form:

```bash
loom <request.yaml>
# or
task loom:run CONFIG=<request.yaml>
```

## Request envelope

```yaml
name: pre-push
arguments:
  stage: true
  fetch: true
```

`name` selects the tool.

`arguments` must match that tool’s schema.

Unknown fields fail.

Wrong types fail.

## Discover tools

Request file: [`params/tools-list/default.yaml`](../../agentic-ai/loom/params/tools-list/default.yaml)

```bash
task loom:tools-list
```

On any decode error, read `errors[].path` in the YAML response.

Then run `tools-list` and retry.

## Response

Stdout is YAML only.

Success:

```yaml
ok: true
name: pre-push
result: { ... }
```

Failure (exit `2` for decode / unknown tool / bad arguments; exit `1` for execute):

```yaml
ok: false
isError: true
phase: decode
errors:
  - path: arguments.stage
    message: expected boolean
recover:
  toolsListRequest: agentic-ai/loom/params/tools-list/default.yaml
  hint: run loom with a tools-list request, then retry with a valid arguments object
```

## Common requests

### pre-push

File: [`params/pre-push/default.yaml`](../../agentic-ai/loom/params/pre-push/default.yaml)

```bash
task loom:pre-push
```

### cortex-audit

File: [`params/cortex-audit/default.yaml`](../../agentic-ai/loom/params/cortex-audit/default.yaml)

```bash
task loom:cortex-audit
```

### skill-scaffold

Example: [`params/skill-scaffold/request.example.yaml`](../../agentic-ai/loom/params/skill-scaffold/request.example.yaml)

```yaml
name: skill-scaffold
arguments:
  slug: example-skill
  wrappers: false
```

```bash
task loom:skill-scaffold CONFIG=path/to/request.yaml
```

### agent-stats

Examples under [`params/agent-stats/`](../../agentic-ai/loom/params/agent-stats/).

```yaml
name: agent-stats
arguments:
  action: assemble
  pr: 123
  scratch: /tmp/pr-123-scratch.json
  out: /tmp/123.yaml
  inventory: true
```

```bash
task loom:agent-stats CONFIG=path/to/assemble-request.yaml
```

### pr-land

Example: [`params/pr-land/request.example.yaml`](../../agentic-ai/loom/params/pr-land/request.example.yaml)

```yaml
name: pr-land
arguments:
  action: validate
  pr: 123
  remote: null
  full_e2e: false
```

```bash
task loom:pr-land CONFIG=path/to/request.yaml
```

## Nested call helper

```yaml
name: tools-call
arguments:
  name: pre-push
  arguments:
    stage: true
    fetch: true
```

Prefer a top-level `name` for the target tool.

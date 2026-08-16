# Loom

Loom runs mechanical Cortex tools and reviewed static agent workflows.

Policy stays in `.cortex`.

Mechanical leaf tools use the existing Bun domain-YAML protocol.

Agent workflow topology is compiled TypeScript.

It is never supplied through YAML or generated from a prompt.

Humans do not use Loom interactively. AI agents and Task wrappers do.

## Static agent workflow module

Agent workflow code is isolated under:

```text
src/agent-workflow/
```

The module owns:

- the reviewed workflow catalog;
- graph validation;
- explicit parallel targets and joins;
- resource claims;
- task attempts and terminal results;
- append-only events;
- result projections;
- Codex SDK worker execution.

The `loom-agent-workflow` CLI is separate from the leaf-tool `loom` CLI.

It selects a compiled catalog entry.

It accepts only bounded runtime inputs.

It does not accept a graph file.

The first catalog entry is `cortex-full-garbage-collection`.

The repository Task wrapper is the canonical executable entrypoint:

```bash
task loom:agent-workflow:cortex-audit BASELINE=<40-character-commit-sha>
```

Add `PLAN=1` to validate and print the compiled topology without starting a
worker.

Its fixed flow is:

```text
resolve baseline
  -> audit workflows and references ----------\
  -> audit design docs and product specs ------+
  -> audit dynamic skills and entry points ----+-> evidence join
  -> audit runtime, Task, and CI ---------------+       |
  -> mechanical cortex audit ------------------/       v
                                              synthesize findings
```

The workflow is read-only.

It uses one exact source commit.

Before and after every Codex attempt, Loom verifies that `HEAD` still matches
that commit and that the worktree is clean, including untracked files.

It returns typed evidence and a typed synthesis.

It does not edit files or mutate GitHub or Workbench state.

### Local journal and Hive

A local workflow run writes an append-only `events.jsonl` journal.

That journal is authoritative for the local run.

Task result files and the final run result are projections.

Current replay validates identity, sequence, and terminal references.

Scheduler-state resume is not implemented.

Events are bounded and secret-sanitized.

They do not contain prompts, reasoning, credentials, secrets, or raw command
output.

Runtime errors are normalized before they are appended.

Events contain a bounded category and sanitized detail.

They do not contain raw SDK errors, stacks, or command failure objects.

Every event carries the workflow version and exact source commit.

Terminal projections are content-hashed and referenced by journal events.

The current implementation runs locally and does not enqueue Hive tasks.

Future Hive-backed execution has a different authority boundary.

Neo4j owns durable readiness, claims, leases, attempts, cancellation, and
results.

Loom must map the static graph onto Hive tasks without running a competing
authoritative local scheduler.

One Hive task remains one Pod and one Codex thread.

## Prerequisites

Bun must be installed (`bun --version`). Stop and install Bun if it is missing.

## Leaf-tool protocol

Single entrypoint:

```bash
loom <request.yaml>
```

Each request is a **domain-tagged object**. Exactly one root key selects the
request family. Nested operation keys group same-prefix requests (`agentStats`,
`prLand`). There is no generic `name` / `arguments` envelope.

```yaml
prePush:
  stageHostUpdates: true
  fetchOriginMain: true
```

```yaml
agentStats:
  assemble:
    prNumber: 123
    scratchPath: /tmp/pr-123-scratch.json
    outputPath: /tmp/123.yaml
    includeTestInventory: true
```

Stdout is YAML only.

Success:

```yaml
ok: true
family: prePush
result: { ... }
```

Nested family success:

```yaml
ok: true
family: agentStats
operation: assemble
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
# or (path is relative to the Loom package cwd)
bun run --cwd agentic-ai/loom loom -- params/tools-list/default.yaml
```

Each discovered request includes its typed `inputSchema`, canonical
`exampleRequest` path, and exact `exampleYaml`. Agents should consume that
output instead of copying request bodies into guidance.

## TypeScript domain structure

Loom authored TypeScript follows [typescript-domain-structure.md](../../.cortex/dynamic-skills/typescript-domain-structure.md):

- nested request families (`agentStats.assemble`, `prLand.validate`)
- field-name enums for deny-unknown-key checks
- codec-local `DecodeOutcome` / `FieldIssue` for decode accumulation
- runtime failures throw `LoomFailure` with `LoomFailureCode`
- no generic TypeScript `Result<T>` or `Maybe<T>` utilities
- prefer popular libraries over hand-rolled commodity helpers
  ([prefer-popular-libraries.md](../../.cortex/dynamic-skills/prefer-popular-libraries.md))
- at most one function/method parameter; multi-value inputs use a typed object
  ([typescript-single-parameter.md](../../.cortex/dynamic-skills/typescript-single-parameter.md))
- no authored `unknown`, `object`, or generic domain values; the only narrow
  exception is `UntrustedYamlNode` / `UntrustedYamlMap` inside YAML, JSON, or
  host-response adapters, where it must be decoded immediately into a domain
  value
  ([typescript-no-unknown.md](../../.cortex/dynamic-skills/typescript-no-unknown.md))
- discovery `inputSchema` constants are typed `ObjectJsonSchema`, built with
  `objectJsonSchema` / field enums (not raw `{ type: 'object', ... } as const`)
- call sites pass named typed args values, never inline `{ ... }` object
  literals ([typescript-named-args.md](../../.cortex/dynamic-skills/typescript-named-args.md))

Enforced by `task preflight:typescript-state`, Loom ESLint (`max-params`,
`no-restricted-types`), and `task loom:verify`.

Decode errors include `explanation.unifiedDiff` from the `diff` (jsdiff)
package so agents can compare the closest blueprint with the received YAML.

## Agent entrypoints

```bash
task loom:pre-push
task loom:tools-list
task loom:cortex-audit
task loom:dependency-popularity
task loom:run CONFIG=agentic-ai/loom/params/skill-scaffold/request.example.yaml
task loom:agent-stats CONFIG=path/to/assemble-request.yaml
task loom:pr-land CONFIG=path/to/validate-request.yaml
```

`task loom:run` resolves repo-root-relative `CONFIG` paths before entering the
Loom package cwd.

Direct Bun surface (paths are relative to `agentic-ai/loom`):

```bash
bun run --cwd agentic-ai/loom loom -- params/pre-push/default.yaml
```

Committed examples live under `params/<domain>/`.

## Tools

| name                    | Role                                              |
| ----------------------- | ------------------------------------------------- |
| `tools-list`            | Discovery                                         |
| `tools-call`            | Nested call helper                                |
| `pre-push`              | Host `task format` + UI demo contract             |
| `cortex-audit`          | Broken `.cortex` links / skill index sync         |
| `skill-scaffold`        | Create a dynamic-skill card                       |
| `agent-stats`           | Assemble / validate / publish AI-agent stats YAML |
| `pr-land`               | Status / validate / ready / merge-check           |
| `dependency-popularity` | Reject low-adoption npm packages and crates       |

## Quality bar

```bash
task loom:verify
```

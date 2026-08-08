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
- no authored `unknown`; untrusted YAML/JSON uses `ExternalValue` /
  `ExternalObject`
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

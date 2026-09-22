# Loom

Loom runs mechanical Cortex tools and deterministic validation for delegated
agent work, module delivery, module experts, and structural experts.

Policy stays in `.cortex`.

Mechanical leaf tools use the existing Bun domain-YAML protocol.

Humans do not use Loom interactively. AI agents and Task wrappers do.

## Module expert catalog

Named read-only semantic roles are defined in
`.cortex/teams/ai/architecture/module-experts.md`.

The typed catalog mirrors production module routes, boundary scope, canonical
context, authorities, skills, entry points, and focused validation selectors.
Universal worker behavior remains defined by `.cortex/AGENTS.md` and the
subagent-delegation workflow.

Validate the catalog from the repository root:

```bash
task loom:module-experts:validate
```

The audit verifies all production Rust and web modules are routed exactly once.
It also enforces the research exclusion and the single `internal_api_expert`
boundary for both WASM crates and generated bindings. Gizmo invokes registered
experts through the active harness. Loom does not provide an expert invocation,
journal, replay, or completion-handoff path.

## Module delivery worktrees

Module expert context and implementation worktrees are different surfaces.

- **Read-only expert:** The active harness supplies catalog-scoped context. It
  is not a writable implementation workspace.
- **Write-capable worker:** The implementation worker receives an isolated child
  worktree on its assigned worker branch from the canonical feature branch.
- **Branch handoff:** The worker returns its assigned branch and focused
  evidence. The upstream integration agent integrates that branch into the
  feature branch.
- **History access:** The worker may inspect committed parent history and
  integrated peer branches for context. Its write scope remains limited to its
  child worktree and declared files.

The active harness owns worker coordination. Loom documents and checks the
mechanical boundary; it does not provide worker lifecycle or recovery
machinery.

Acceptance commands are typed external-manager references. Each reference
declares its selector plus read, write, and output claims. Loom validates that
those claims stay within the task resources. It forwards the selector without
catalog or existence validation. The external manager executes it and returns
ordinary evidence. An unknown selector fails naturally in GitHub Actions. Loom
never executes acceptance commands itself.

Module delivery follows the root
[Agent Derailment Circuit Breaker](../../.cortex/CIRCUIT-BREAKER.md). Admission
state carries dependency readiness, resource claims, attempt status, current
Git head, and provider results directly. Git and independently supplied
evidence checks remain at their owning external boundaries.

## Structural refactoring experts

Structural refactoring roles use a sibling registry because their evidence
scopes overlap production modules. Validate the exact catalog and role
definitions from the repository root:

```bash
task loom:structural-experts:validate
```

Gizmo invokes structural experts through the active harness. Loom validates the
catalog and role boundaries only; it does not persist or replay their handoffs.

## Prerequisites

Bun must be installed (`bun --version`). Stop and install Bun if it is missing.

## Leaf-tool protocol

Leaf-tool entrypoints:

```bash
loom <request.yaml>
loom --default toolsList
```

Each request is a **domain-tagged object**. Exactly one root key selects the
request family. There is no generic `name` / `arguments` envelope.

The historical `prePush` request identifier is decoded only to provide a
controlled retirement response for older callers. It never runs host
formatting, audits, staging, or other commands. Feature compilation uses the
remote build-only `build:compile` task; full validation is owned by the feature
pull-request lifecycle.

Stdout is YAML only.

Success:

```yaml
ok: true
family: toolsList
result: { ... }
```

Decode failure (exit `2`):

```yaml
ok: false
isError: true
phase: decode
errors:
  - path: toolsList
    message: expected object
recover:
  toolsListRequest: task loom:tools-list
  hint: run task loom:tools-list, then retry with a valid domain request object
```

Discover request kinds:

```bash
task loom:tools-list
```

Each discovered request includes its typed `inputSchema`, canonical
`exampleRequest` invoke command, and exact `exampleYaml`.
Generated examples are the source of truth. Agents should consume that
output instead of copying request bodies into guidance.

## TypeScript domain structure

Loom authored TypeScript follows [typescript-domain-structure.md](../../.meta-cortex/teams/dev-team/agents/typescript-dev/skills/ts-dev-skill/practices/typescript-domain-structure.md):

- field-name enums for deny-unknown-key checks
- codec-local `DecodeOutcome` / `FieldIssue` for decode accumulation
- runtime failures return `neverthrow` `Result` values with concrete
  `LoomFailure` errors
- no generic TypeScript `Result<T>` or `Maybe<T>` utilities
- prefer popular libraries over hand-rolled commodity helpers
  ([prefer-popular-libraries.md](../../.cortex/shared/dynamic-skills/prefer-popular-libraries.md))
- at most one function/method parameter; multi-value inputs use a typed object
  ([typescript-single-parameter.md](../../.meta-cortex/teams/dev-team/agents/typescript-dev/skills/ts-dev-skill/practices/typescript-single-parameter.md))
- no authored `unknown`, `object`, or generic domain values; the only narrow
  exception is `UntrustedYamlNode` / `UntrustedYamlMap` inside YAML, JSON, or
  host-response adapters, where it must be decoded immediately into a domain
  value
  ([typescript-no-unknown.md](../../.meta-cortex/teams/dev-team/agents/typescript-dev/skills/ts-dev-skill/practices/typescript-no-unknown.md))
- discovery `inputSchema` constants are typed `ObjectJsonSchema`, built with
  `objectJsonSchema` / field enums (not raw `{ type: 'object', ... } as const`)
- reusable and public object contracts use semantic types or interfaces;
  clear one-use local literals and inline shapes are permitted

Enforced by `task preflight:typescript-state`, Loom ESLint (`max-params`,
`no-restricted-types`), and `task loom:verify`.

Decode errors include `explanation.unifiedDiff` from the `diff` (jsdiff)
package so agents can compare the closest blueprint with the received YAML.

## Agent entrypoints

```bash
task loom:tools-list
task loom:cortex-audit
task loom:cortex-session-clean
task loom:dependency-popularity
task loom:skill-scaffold CONFIG=path/to/request.yaml
```

`task loom:run` resolves repo-root-relative `CONFIG` paths before entering the
Loom package cwd.

Direct Bun surface for a defaultable family:

```bash
bun run --cwd agentic-ai/loom loom -- --default toolsList
```

Typed example documents in Loom generate discovery YAML and decode blueprints.
There is no checked-in sample-file catalog.

## Tools

| name                    | Role                                          |
| ----------------------- | --------------------------------------------- |
| `tools-list`            | Discovery                                     |
| `tools-call`            | Nested call helper                            |
| `cortex-audit`          | Cortex structure, links, and policy contracts |
| `cortex-session-clean`  | Temporary Cortex session readiness assertion  |
| `skill-scaffold`        | Create a dynamic-skill card                   |
| `dependency-popularity` | Reject low-adoption npm packages and crates   |

## Quality bar

```bash
task loom:verify
```

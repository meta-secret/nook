# Reference: Loom Tools

## Overview

- **Role:** Loom is the Bun tool runner for mechanical Cortex rites.
- **Caller:** Agents call it. Humans do not use it interactively.
- **Leaf protocol:** Domain YAML exposes mechanical leaf operations.
- **Module expert audit:** A separate typed catalog validates named read-only
  experts and complete production-module routing.

Full package docs: [`agentic-ai/loom/README.md`](../../../../agentic-ai/loom/README.md).

## Module delivery boundary

- **Read-only experts:** The expert runtime uses an immutable, catalog-scoped
  snapshot of the exact source commit. That snapshot is not an implementation
  workspace.
- **Write-capable workers:** Team Gizmo assigns implementation and the upstream
  integration agent supplies its branch and worktree.
- **Completion:** Workers finish their scoped changes on their branches and
  report focused evidence to Team Gizmo for integration.

The active harness owns communication. Loom provides mechanical evidence and
boundary checks; it does not own local Git integration or recovery machinery.

## Agent action references

### Document identifiers

`.cortex/identifiers.json` assigns stable compact identifiers to Cortex
categories and selected documents or headings. Category IDs use `CX-<NAME>`;
document and item IDs add a five-character random suffix. Published IDs are
never removed or reassigned when a title or locator changes. Each entry carries
an immutable document-authority locator. The Cortex audit compares those
assignments with the registry at the pull request's exact published base
commit. The audit fails closed when an established base cannot be resolved.

### Lifecycle activity

Every persisted agent-attempt event receives an action ID derived from its
one-based event sequence, such as `a0002`. Runtime activities are live,
transient observations with an independent ordered ID such as `live-a0002`.
They may attach bounded registered Cortex references whose relation is one of
`loaded`, `cited`, `applied`, or `validated`. Loom emits their compact summary
to stderr without writing them to `events.jsonl`; optional display failure
cannot block the lifecycle journal.

### Persisted evidence

Persisted records expose replayable lifecycle and terminal handoff evidence,
not private reasoning. Live activity counts are diagnostic signals and are not
an effort, quality, or billing measure.

### Replay boundary

Lifecycle replay is an event-sourcing concern. It is also a projection concern.
The document-authority locator is a Cortex-document reference.

### In-thread handoff

Team Gizmo and Team Agents follow the root
[Agent Derailment Circuit Breaker](../../../CIRCUIT-BREAKER.md). Loom retains
only its typed task, scope, status, result, and evidence fields.

## Invoke a leaf tool

Defaultable tools use a Task alias and an in-code example:

```bash
task loom:tools-list
task loom:cortex-audit
task loom:cortex-session-clean
task loom:dependency-popularity
```

Parameterized tools still take an agent-owned YAML file:

```bash
loom <request.yaml>
task loom:run CONFIG=<request.yaml>
```

## Executable skill applications

Semantic skill cards remain team-owned Markdown under `.cortex`. A deterministic
implementation is an ordinary Bun and TypeScript project in its owning
`<skill>/scripts/` directory; it is not a harness skill mirror. Loom consumes
the Cortex article application through a narrow in-process adapter. The
application validates its request, audits it, independently verifies its
result, and enforces contract bounds without command, network, write, agent, or
lifecycle authority. Run the shared workspace gate with `task skills:verify`.
Run `task loom:verify` for the recursive AST capability audit and exact
Loom-consumer boundary.

Use `task skills:tools-list` for the closed action catalog and schemas. Use
`task skills:run REQUEST_YAML='<strict-yaml>'` to pass one complete YAML
document as one CLI argument. The host does not read request files or stdin.
It returns validated data only; the active harness owns agent lifecycle.

## TypeScript domain structure

Loom follows [typescript-domain-structure.md](../../../../.meta-cortex/agents/teams/dev-team/typescript-dev/skills/ts-dev-skill/practices/typescript-domain-structure.md)
and the [TypeScript Effect Workflows](../../../../.meta-cortex/agents/teams/dev-team/typescript-dev/skills/ts-dev-skill/practices/typescript-effect.md)
policy for new and materially changed TypeScript workflows:

- field-name enums passed into deny-unknown checks (never string sets)
- codec-local `DecodeOutcome` / `FieldIssue` for decode accumulation only
- Current migration debt: existing Loom runtime failures use `neverthrow` Result
  values with concrete `LoomFailure` errors. Do not extend this implementation
  pattern; materially changed workflows migrate coherently to Effect.
- authored operations use instances; static methods are narrow builders
- raw `new Set(['field', ...])` allow-lists remain prohibited

Loom also follows
[typescript-explicit-state.md](../../../../.meta-cortex/agents/teams/dev-team/typescript-dev/skills/ts-dev-skill/practices/typescript-explicit-state.md),
[typescript-single-parameter.md](../../../../.meta-cortex/agents/teams/dev-team/typescript-dev/skills/ts-dev-skill/practices/typescript-single-parameter.md)
[typescript-no-unknown.md](../../../../.meta-cortex/agents/teams/dev-team/typescript-dev/skills/ts-dev-skill/practices/typescript-no-unknown.md),
and [typescript-named-args.md](../../../../.meta-cortex/agents/teams/dev-team/typescript-dev/skills/ts-dev-skill/practices/typescript-named-args.md):

- every authored function/method takes at most one parameter
- multi-value inputs use a typed object argument
- no authored `unknown`
- no generic value bags in new or changed domain or application APIs
- generic transport values stay inside dedicated codecs and narrow immediately
- existing generic-value APIs are staged migration debt and must not expand
- toolsList `inputSchema` values are typed `ObjectJsonSchema` (not raw object
  bags); field names come from field enums
- reusable and public object contracts use semantic types or interfaces;
  clear one-use local literals and inline shapes are permitted
- mechanically enforced by ESLint `max-params: 1` and
  `no-restricted-types` in `agentic-ai/loom`
- review enforces semantic reusable and public contracts plus generic-value
  containment while the existing debt is migrated

Enforced by `task preflight:typescript-state` across the repository, plus
`task loom:verify` (includes ESLint) for Loom-local rules.

## Domain request rule

YAML must be a full domain representation.

Do **not** use a generic envelope:

```yaml
# wrong
name: unsupported-command
arguments:
  action: run
```

Use one domain root family and descriptive fields. Exactly one root family key
is allowed.

Unknown fields fail closed.

## Discover request kinds

```bash
task loom:tools-list
```

On decode errors:

1. Read `errors[].path` and `errors[].issue`.
2. Read `explanation.unifiedDiff` — a `diff` (jsdiff) patch of the closest
   blueprint template versus the received YAML.
3. For syntax failures, also read `explanation.parseMessage`.
4. Fix the request to match `explanation.blueprintYaml`, then retry.
5. Run `toolsList` when the root family is unclear.

### dependencyPopularity

Reject low-adoption npm packages and crates.io crates:

```bash
task loom:dependency-popularity
```

Prefer libraries over boilerplate:
[prefer-popular-libraries.md](../../../shared/dynamic-skills/prefer-popular-libraries.md).

## Common requests

`task loom:tools-list` returns the canonical invoke command in
`exampleRequest`, exact `exampleYaml`, and typed `inputSchema` for every active
direct request below.
Consume that output instead of maintaining request bodies in Cortex.

### prePush (deprecated)

The historical request identifier is retained only for compatibility and fails
closed without executing commands. Follow [dev
delivery](../../../gizmo-prime/architecture/dev-delivery.md) for the remote
build-only compilation stage and the feature PR required-check stage.

### cortexAudit

```bash
task loom:cortex-audit
```

### cortexSessionClean

```bash
task loom:cortex-session-clean
```

This deterministic readiness check rejects any non-directory entry under
ignored `.cortex/.session/` memory.

### skillScaffold

```bash
task loom:skill-scaffold CONFIG=path/to/request.yaml
```

The request requires `skillOwner` with one of `gizmo`, `ai`, `shared`,
`dev-core`, `security`, `sre`, or `web-dev`. Loom creates the canonical card in
that owner's dynamic-skill directory. It registers the card in the AI skill
catalog. Security remains the owner for security policy and acceptance.

### toolsCall

Wraps another domain request.

Copy the generated `exampleYaml` from `task loom:tools-list` when you need a
nested call. Prefer a top-level domain key for normal calls.

## Response

Success includes `family`, optional `operation` for nested families, and
`result`.

Failures include `phase`, `errors[].path`, and `recover.toolsListRequest`.

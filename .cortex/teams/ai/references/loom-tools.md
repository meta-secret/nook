# Reference: Loom Tools

## Overview

- **Role:** Loom is the Bun tool runner for mechanical Cortex rites.
- **Caller:** Agents call it. Humans do not use it interactively.
- **Leaf protocol:** Domain YAML exposes mechanical leaf operations.
- **Module expert audit:** A separate typed catalog validates named read-only
  experts and complete production-module routing.

Full package docs: [`agentic-ai/loom/README.md`](../../../../agentic-ai/loom/README.md).

## Agent action references

`.cortex/identifiers.json` assigns stable compact identifiers to Cortex
categories and selected documents or headings. Category IDs use `CX-<NAME>`;
document and item IDs add a five-character random suffix. Published IDs are
never removed or reassigned when a title or locator changes. Each entry carries
an immutable authority key; the Cortex audit compares those assignments with
the registry at the pull request's exact published base commit. The audit fails
closed when an established base cannot be resolved.

Every persisted agent-attempt event receives an action ID derived from its
one-based event sequence, such as `a0002`. Runtime activities are live,
transient observations with an independent ordered ID such as `live-a0002`.
They may attach bounded registered Cortex references whose relation is one of
`loaded`, `cited`, `applied`, or `validated`. Loom emits their compact summary
to stderr without writing them to `events.jsonl`; optional display failure
cannot block the lifecycle journal.

Persisted records expose replayable lifecycle and terminal handoff evidence,
not private reasoning. Live activity counts are diagnostic signals and are not
an effort, quality, or billing measure.

## Invoke a leaf tool

Defaultable tools retain Task aliases and in-code examples for hosted or
human-operated use:

```bash
task loom:pre-push
task loom:cortex-session-clean
```

Gizmo uses `task loom:pre-push` as the only local validation alias. AI workers
do not invoke the other aliases. They author the intended request or mutation
in their assigned scope and return the coherent commit to Gizmo. Gizmo pushes
that head and dispatches `task remote TASK_NAME=loom:verify`.

## Executable skill applications

Semantic skill cards remain team-owned Markdown under `.cortex`. A deterministic
implementation is an ordinary Bun and TypeScript project in its owning
`<skill>/scripts/` directory; it is not a harness skill mirror. Loom consumes
the Cortex article application through a narrow in-process adapter. The
application validates its request, audits it, independently verifies its
result, and enforces contract bounds without command, network, write, agent, or
lifecycle authority. Return the coherent commit to Gizmo. Gizmo pushes the
exact head and runs `task remote TASK_NAME=loom:verify` for the recursive AST
capability audit and exact Loom-consumer boundary.

AI workers inspect the closed registry and in-code examples read-only. They do
not invoke local `skills:*` targets. A requested provider change includes its
strict request and focused behavior coverage in the coherent commit. Gizmo's
hosted `loom:verify` dispatch exercises catalog discovery, provider invocation,
and every executable-skill package. The active harness owns agent lifecycle.

## TypeScript domain structure

Loom follows [typescript-domain-structure.md](../../web-dev/dynamic-skills/typescript-domain-structure.md):

- nested same-prefix families (`agentStats`, `prLand`) plus operation enums
- field-name enums passed into deny-unknown checks (never string sets)
- codec-local `DecodeOutcome` / `FieldIssue` for decode accumulation only
- runtime failures throw `LoomFailure` with `LoomFailureCode`
- forbidden: generic TypeScript `Result<T>` / `Maybe<T>`, and
  `new Set(['field', ...])` allow-lists

Loom also follows
[typescript-explicit-state.md](../../web-dev/dynamic-skills/typescript-explicit-state.md),
[typescript-single-parameter.md](../../web-dev/dynamic-skills/typescript-single-parameter.md)
[typescript-no-unknown.md](../../web-dev/dynamic-skills/typescript-no-unknown.md),
and [typescript-named-args.md](../../web-dev/dynamic-skills/typescript-named-args.md):

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

Enforced by hosted `task preflight:typescript-state` across the repository,
plus `task remote TASK_NAME=loom:verify` (includes ESLint) for Loom-local
rules.

## Domain request rule

YAML must be a full domain representation.

Do **not** use a generic envelope:

```yaml
# wrong
name: agent-stats
arguments:
  action: assemble
  pr: 123
```

Use one domain root family and descriptive fields. Same-prefix operations nest:

```yaml
# right
agentStats:
  assemble:
    prNumber: 123
    scratchPath: '{agentTempDir}/pr-123-scratch.json'
    outputPath: '{agentTempDir}/123.yaml'
    includeTestInventory: true
```

Exactly one root family key is allowed.

Unknown fields fail closed.

## Discover request kinds

Inspect `agentic-ai/loom/src/tools/registry.ts` and the typed request codecs.
The in-code examples remain the source for complete request shapes. Gizmo's
hosted `loom:verify` dispatch checks that every example decodes and every
registered provider remains reachable.

On decode errors:

1. Read `errors[].path` and `errors[].issue`.
2. Read `explanation.unifiedDiff` — a `diff` (jsdiff) patch of the closest
   blueprint template versus the received YAML.
3. For syntax failures, also read `explanation.parseMessage`.
4. Fix the request to match `explanation.blueprintYaml`, then retry.
5. Inspect the typed registry when the root family is unclear.

### dependencyPopularity

The typed request describes adoption evidence for npm packages and crates.io
crates. No allowlisted hosted selector executes it. AI workers record cited
read-only evidence and report a required executable verdict as blocked; they do
not invoke the local alias or substitute an unevaluated verdict.

Prefer libraries over boilerplate:
[prefer-popular-libraries.md](../../../shared/dynamic-skills/prefer-popular-libraries.md).

## Common requests

The typed registry owns the canonical invoke command, exact `exampleYaml`, and
typed `inputSchema` for every direct request below.
`resolvedExampleYaml` equals the generated example for static requests and
fills dynamic tokens for the current worktree and commit. Consume that output
instead of maintaining request bodies in Cortex.

### prePush

```bash
task loom:pre-push
```

### cortexAudit

```bash
task remote TASK_NAME=loom:verify
```

### cortexSessionClean

```bash
task loom:cortex-session-clean
```

This deterministic readiness check rejects any non-directory entry under
ignored `.cortex/.session/` memory.

### skillScaffold

The request requires `skillOwner` with one of `gizmo`, `ai`, `shared`,
`dev-core`, `security`, `sre`, or `web-dev`. Loom creates the canonical card in
that owner's dynamic-skill directory. It registers the card in the AI skill
catalog. Security remains the owner for security policy and acceptance.

An AI worker materializes the card and registry mutation directly in its
assigned scope. It returns the coherent commit to Gizmo. Hosted `loom:verify`
checks the scaffold contract and exact catalog state.

### agentStats (assemble / validate / publish)

Validate and publish use `agentStats.validate` / `agentStats.publish` with
`statsFile`. Agent-statistics paths accept `{agentTempDir}` for stable isolation
by Git commit and worktree. See
[Agent PR Statistics](../../../gizmo/workflows/agent-statistics.md#mechanical-entrypoint--loom).
AI workers do not invoke its local alias; Gizmo follows that delivery-control
workflow. After the source PR is merged, Gizmo uses the dependency-free
`task loom:agent-stats-control` stdin JSON adapter for assemble, validate, and
publish. The adapter rejects local test-inventory collection; hosted exact-head
evidence supplies that inventory. It does not install Loom or expose generic
tool discovery or invocation.

### prLand (status / validate / ready / mergeCheck)

Gizmo uses this allowlisted local delivery-control entrypoint:

```bash
task loom:pr-land CONFIG=path/to/validate-request.yaml
```

`prLand.validate` dispatches hosted validation first. Its `nextStep` requires
repository-owned checks and concurrent exact-head review collection or
stabilization to settle before `prLand.ready`.

### toolsCall

Wraps another domain request.

Copy `exampleYaml` from the typed registry when you need a nested call. Prefer
a top-level domain key for normal calls.

## Response

Success includes `family`, optional `operation` for nested families, and
`result`.

Failures include `phase`, `errors[].path`, and `recover.toolsListRequest`.

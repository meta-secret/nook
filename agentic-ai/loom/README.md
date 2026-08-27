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

Its workflow lane reports duplicated prose, deterministic leaf candidates,
compiled workflow candidates, safe parallel lanes, and policy that must remain
semantic judgment.

It uses one exact source commit.

Before and after every Codex attempt, Loom verifies that `HEAD` still matches
that commit and that the worktree is clean, including untracked files.

It returns typed evidence and a typed synthesis.

It does not edit files or mutate GitHub or Workbench state.

### Local event store and semantic views

A local workflow run writes processing evidence beneath
`workflow/processing/<workflow>/<run-id>/`.

The run `events.jsonl` journal is authoritative for local scheduling.

Each reached agent attempt has an isolated append-only action stream beneath
`agents/<task>/attempt-<n>/events.jsonl`.

Completed agents author bounded Markdown semantic views in their typed output.
Loom persists and hashes those views without granting workers filesystem write
access.

Failed attempts receive explicitly Loom-authored failure views.

Parents consume child views and typed artifacts, reconcile them, and author the
next aggregate view. The declared root materializer produces the run `view.md`.

Agent result files, agent views, the final run result, and the root view are
projections.

Current replay validates identity, sequence, and terminal references.

Scheduler-state resume is not implemented.

Events are bounded and secret-sanitized.

They do not contain prompts, reasoning, credentials, secrets, or raw command
output.

Runtime errors are normalized before they are appended.

Events contain a bounded category and sanitized detail.

They do not contain raw SDK errors, stacks, or command failure objects.

Every event carries the workflow version and exact source commit.

Adapter-bearing attempt streams currently use workflow version `2.0.0`.
Version `1.0.0` is a legacy pre-provenance schema. Loom rejects it with local
cleanup or explicit migration guidance. Replay never infers a missing adapter.

Terminal projections are content-hashed and referenced by journal events.

Local software-development workflows remain local.
Hive is outside this workflow architecture.

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
boundary for both WASM crates and generated bindings.

Invoke one registered expert with an agent-owned JSON request:

First finalize a depth-one parent attempt whose structured output uses
`ModuleDevelopmentPlan` and includes an exact authorization such as:

```json
{
  "task": "inspect-core-contract",
  "expert": "core_expert",
  "attempt": 1,
  "depth": 2,
  "parent": {
    "kind": "agent-attempt",
    "task": "feature-synthesis",
    "agent": "delivery-owner",
    "attempt": 1
  }
}
```

The authorization is an entry in `moduleExpertAuthorizations`; it is not a
standalone request or Markdown instruction. Record the completed parent through
the ordinary Loom delegation journal before invoking the child.

```json
{
  "runId": "feature-vault-api-20260822",
  "expert": "core_expert",
  "sourceCommit": "<40-character-commit-sha>",
  "task": "inspect-core-contract",
  "attempt": 1,
  "depth": 2,
  "parent": {
    "kind": "agent-attempt",
    "task": "feature-synthesis",
    "agent": "delivery-owner",
    "attempt": 1
  },
  "instruction": "Describe the smallest external API required by nook-wasm."
}
```

Existing non-web requests may omit `selectedContextPaths`. Loom normalizes the
omitted field to `[]`.

`web_expert` accepts an empty selection for ordinary module analysis. Product
authorities require the design skill. Release authorities require the
extension-release skill and its canonical security authority. For example:

```json
{
  "selectedContextPaths": [
    ".cortex/teams/web-dev/product-specs/browser-extension.md",
    ".github/workflows/release.yml",
    ".cortex/teams/web-dev/dynamic-skills/ui-design-skills.md",
    ".cortex/teams/security/dynamic-skills/browser-extension-release-security.md",
    ".cortex/teams/security/dynamic-skills/browser-extension-release-security.md"
  ]
}
```

```bash
task loom:module-experts:invoke REQUEST=/absolute/path/to/request.json
```

Invocation requires a non-empty `CODEX_API_KEY`. The isolated runtime never
copies `auth.json` or accepts refreshable ChatGPT authentication state.
The credential is redeemed once through a trusted runtime helper and is absent
from the Codex process environment, provider configuration, arguments, and
disposable repository snapshot. The helper source is embedded in the running
Loom module instead of loaded from the analyzed commit or live worktree.

The command validates the complete typed catalog and selected semantic role
before starting one isolated Codex thread. The request accepts no runtime
permissions, tools, model, successors, or graph. It must declare the run,
attempt, depth, and parent agent-attempt lineage. Direct named experts run only
at depth two or three. Workflow-root, depth-one, self-parent, and invalid
parent-attempt lineage are rejected before runtime. Loom replay-verifies the
completed parent,
its source commit and projections, and the exact typed child authorization
before creating the child journal. A depth-three child must also have a
completed immediate parent named by the depth-one plan. Expert evidence and
`parentActions` cannot authorize descendants. The expert receives an immutable,
catalog-scoped snapshot of the exact commit through three bounded loopback
tools: file listing, file reading, and literal text search. Every snapshot
contains the canonical module-expert skill and workflow authorities.
The internal API snapshot also contains every registered portable Rust module
root for provider-consumer boundary inspection. Catalog exclusions are removed
from the snapshot. Generated scopes are included only when their entries are
tracked at that exact commit; otherwise the expert receives their tracked
producer contract instead of mutable workspace output. No
model-controlled process, write, general
network, web-search, native delegation, app, or plugin path is enabled. Before
the command
returns, Loom finalizes the immutable attempt stream, result, and materialized
view under
`workflow/processing/delegated-agent-work/<runId>/agents/<task>/attempt-<n>/`.
The JSON response contains the typed terminal and content-addressed processing
references. Before returning them, Loom rereads all three projections, verifies
their digests and exact identity, and replays the terminal stream. The replayed
invocation evidence binds the normalized `selectedContextPaths`. Runtime
errors and invalid resolved completions produce a sanitized failed terminal and
a Loom-authored failure view. The delivery owner remains responsible for
aggregation, continuation, and lifecycle state.

A successful expert must return the dedicated `ModuleExpertEvidence` result.
Its exact structured continuation covers external API, dependencies, consumers,
behavior, security, and compatibility invariants, owning tests, focused
validation, risks, unresolved decisions, and parent actions. Parent actions are
evidence only and never schedule work.

## Structural refactoring experts

Structural refactoring roles use a sibling registry because their evidence
scopes overlap production modules. Validate the exact catalog and role
definitions from the repository root:

```bash
task loom:structural-experts:validate
```

Invoke one role after recording a replay-verifiable depth-one
`StructuralExpertPlan` with the exact depth-two authorization:

```bash
task loom:structural-experts:invoke REQUEST=/absolute/path/to/request.json
```

Repository-reading requests select exact files or strict descendants of one
reviewed scope cap. They cannot select an aggregate cap such as `.cortex` or
`nook-app/nook-web`. Synthesis requests have no repository scope; their parent
authorization freezes the exact ordered all-terminal child projection barrier.
Loom accepts replay-valid completed and failed child evidence, preserves the
failure view, and rejects missing, extra, reordered, rebound, or unrelated
lanes. Every role uses the shared isolated read-only runtime, cannot delegate,
and returns typed evidence for the delivery owner rather than write authority.

The pinned Codex runtime retains inert non-process helpers in addition to the
three repository tools. The enforced security claim is that the model has no
process or write path. It is not a defense against a separate hostile process
already running under the same operating-system account.

## Prerequisites

Bun must be installed (`bun --version`). Stop and install Bun if it is missing.

## Leaf-tool protocol

Leaf-tool entrypoints:

```bash
loom <request.yaml>
loom --default prePush
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
    scratchPath: '{agentTempDir}/pr-123-scratch.json'
    outputPath: '{agentTempDir}/123.yaml'
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
  toolsListRequest: task loom:tools-list
  hint: run task loom:tools-list, then retry with a valid domain request object
```

Discover request kinds:

```bash
task loom:tools-list
```

Each discovered request includes its typed `inputSchema`, canonical
`exampleRequest` invoke command, exact `exampleYaml`, and explicit
`resolvedExampleYaml`.
Generated examples are the source of truth. Agents should consume that
output instead of copying request bodies into guidance.

Agent-statistics path fields also accept `{agentTempDir}`. Loom resolves it to:

```text
<os-temp>/nook-agent-stats/<40-character-task-anchor-commit>/<opaque-worktree-id>
```

The task-anchor commit is the exact commit checked out when the current task
branch was first entered, or the worktree's initial commit when Git created the
branch with the worktree. A later branch re-entry does not replace it. The
worktree identifier isolates parallel worktrees on the same anchor. The mapping
therefore stays stable so `assemble`, `validate`, and `publish` can share one
file. Loom provisions this directory when it resolves the token. Ordinary
relative and absolute paths remain supported.

`task loom:tools-list` keeps the tokenized blueprint in `exampleYaml` and
returns `resolvedExampleYaml` with the current worktree and commit path filled
in. Use the resolved path when creating the scratch JSON before `assemble`.

## TypeScript domain structure

Loom authored TypeScript follows [typescript-domain-structure.md](../../.cortex/teams/web-dev/dynamic-skills/typescript-domain-structure.md):

- nested request families (`agentStats.assemble`, `prLand.validate`)
- field-name enums for deny-unknown-key checks
- codec-local `DecodeOutcome` / `FieldIssue` for decode accumulation
- runtime failures throw `LoomFailure` with `LoomFailureCode`
- no generic TypeScript `Result<T>` or `Maybe<T>` utilities
- prefer popular libraries over hand-rolled commodity helpers
  ([prefer-popular-libraries.md](../../.cortex/shared/dynamic-skills/prefer-popular-libraries.md))
- at most one function/method parameter; multi-value inputs use a typed object
  ([typescript-single-parameter.md](../../.cortex/teams/web-dev/dynamic-skills/typescript-single-parameter.md))
- no authored `unknown`, `object`, or generic domain values; the only narrow
  exception is `UntrustedYamlNode` / `UntrustedYamlMap` inside YAML, JSON, or
  host-response adapters, where it must be decoded immediately into a domain
  value
  ([typescript-no-unknown.md](../../.cortex/teams/web-dev/dynamic-skills/typescript-no-unknown.md))
- discovery `inputSchema` constants are typed `ObjectJsonSchema`, built with
  `objectJsonSchema` / field enums (not raw `{ type: 'object', ... } as const`)
- call sites pass named typed args values, never inline `{ ... }` object
  literals ([typescript-named-args.md](../../.cortex/teams/web-dev/dynamic-skills/typescript-named-args.md))

Enforced by `task preflight:typescript-state`, Loom ESLint (`max-params`,
`no-restricted-types`), and `task loom:verify`.

Decode errors include `explanation.unifiedDiff` from the `diff` (jsdiff)
package so agents can compare the closest blueprint with the received YAML.

## Agent entrypoints

```bash
task loom:pre-push
task loom:tools-list
task loom:cortex-audit
task loom:cortex-session-clean
task loom:dependency-popularity
task loom:skill-scaffold CONFIG=path/to/request.yaml
task loom:agent-stats CONFIG=path/to/assemble-request.yaml
task loom:pr-land CONFIG=path/to/validate-request.yaml
```

`task loom:run` resolves repo-root-relative `CONFIG` paths before entering the
Loom package cwd.

Direct Bun surface for a defaultable family:

```bash
bun run --cwd agentic-ai/loom loom -- --default prePush
```

Typed example documents in Loom generate discovery YAML and decode blueprints.
There is no checked-in sample-file catalog.

## Tools

| name                    | Role                                              |
| ----------------------- | ------------------------------------------------- |
| `tools-list`            | Discovery                                         |
| `tools-call`            | Nested call helper                                |
| `pre-push`              | Host `task format` + UI demo contract             |
| `cortex-audit`          | Broken `.cortex` links / skill index sync         |
| `cortex-session-clean`  | Temporary Cortex session readiness assertion      |
| `skill-scaffold`        | Create a dynamic-skill card                       |
| `agent-stats`           | Assemble / validate / publish AI-agent stats YAML |
| `pr-land`               | Status / validate / ready / merge-check           |
| `dependency-popularity` | Reject low-adoption npm packages and crates       |

## Quality bar

```bash
task loom:verify
```

# Loom

Loom runs mechanical Cortex tools and deterministic validation for delegated
agent work, module delivery, module experts, and structural experts.

Policy stays in `.cortex`.

Mechanical leaf tools use the existing Bun domain-YAML protocol.

Humans do not use Loom interactively. AI agents and Task wrappers do.

## Team Plan commands

Team Plan is the durable command surface for executing one reviewed module
delivery plan across process restarts. The journal must live outside the source
repository. The repository must remain at the source commit declared by the
active plan when a command requires source state.

Agents should use the Task wrappers from the repository root:

```bash
task loom:team-plan:start PLAN=/absolute/path/to/plan.json JOURNAL=/absolute/path/to/events.jsonl
task loom:team-plan:select JOURNAL=/absolute/path/to/events.jsonl
task loom:team-plan:lease JOURNAL=/absolute/path/to/events.jsonl TASK_IDS=task-a,task-b
task loom:team-plan:record JOURNAL=/absolute/path/to/events.jsonl REQUEST=/absolute/path/to/result.json
task loom:team-plan:restart JOURNAL=/absolute/path/to/events.jsonl PLAN=/absolute/path/to/new-plan.json
task loom:team-plan:finalize JOURNAL=/absolute/path/to/events.jsonl
task loom:team-plan:discard JOURNAL=/absolute/path/to/events.jsonl RUN_ID=<runId-from-start>
```

The installed executable is `loom-team-plan`. It accepts the same `start`,
`select`, `lease`, `record`, `restart`, `finalize`, and `discard` arguments as
the Task wrappers.

The lifecycle is explicit:

1. `start` validates the reviewed generation, source commit, repository root,
   and journal capacity. It creates one new journal and returns a snapshot with
   the immutable `runId`.
2. `select` replays the journal and returns the next deterministic candidate
   batch without consuming attempts or concurrency. An empty candidate list is
   valid when work is blocked or already terminal.
3. `lease` persists only the comma-separated candidate task IDs explicitly
   authorized by Gizmo and returns their leases.
4. `record` consumes one selected lease. Its request must be a regular file.
   Loom opens the file without waiting on special files and bounds the read on
   that same open handle.
5. Repeat `select`, `lease`, and `record` until every task is accepted, exhausts its
   attempts, or becomes terminal through dependency failure.
6. `restart` appends a newer reviewed generation. The current generation must
   have no active leases. Logical task attempts remain monotonic across the
   restart.
7. `finalize` appends the exact joined head commit after terminal closure. A
   repeated finalize of the same finalized run returns its existing snapshot.
8. `discard` requires the immutable `runId` returned by `start`. It removes only
   that expected finalized journal and its run-owned durable artifacts. A
   missing, malformed, or stale run ID cannot delete the journal.

Keep the finalized journal when later inspection or recovery is still
required. Read `runId` from command JSON output; do not derive it from a path or
mutable workspace state.

Every successful command prints one JSON value to stdout. Parse that value
instead of scraping logs. Parse failures and rejected lifecycle transitions
exit nonzero without appending an event.

## Team Plan journal version 2

The durable journal is newline-delimited JSON. Every line is one complete event
with `version: 2`, an exact `kind`, and a contiguous one-based `sequence`.
Unknown fields, missing fields, empty lines, trailing partial lines, and events
after finalization are invalid.

Version 2 has five event shapes:

- `started` is sequence one. It freezes the run ID, reviewed plan text and
  hashes, module-plan digest, source commit, canonical repository and workspace
  roots, and the proven record capacity for the generation.
- `restarted` freezes the corresponding reviewed-plan fields for a newer
  generation. The original run identity and roots remain owned by `started`.
- `selected` records the exact task, attempt, generation, and plan digest for
  each returned lease.
- `recorded` closes one active lease with `accepted-write`,
  `accepted-evidence`, or `final-unusable`. Provider request envelopes are
  converted to the accepted durable record during command execution.
- `finalized` records the exact terminal head commit. It is the final event.

Replay is the compatibility boundary. Loom accepts only the exact version 2
schema and lifecycle; it does not infer missing data or silently upgrade an
older journal. A future incompatible schema requires an explicit versioned
migration or deliberate cleanup before the run can continue.

Recovery also fails closed:

- Each mutation of an existing run reloads and replays the complete journal
  under the run's Git reference lock.
- Replay revalidates reviewed plan content, sequence, generation, leases,
  terminal records, source state, workspace identity, and durable artifact
  references.
- A torn, oversized, malformed, reordered, or lifecycle-invalid journal is
  rejected. Loom does not truncate it to a plausible prefix.
- Durable artifact references allow accepted results to be reconstructed after
  a process restart.
- An interrupted discard leaves a `<journal>.discarding` tombstone. A later
  discard must present the same `runId`. It resumes only when the tombstone is
  the original journal inode; a replacement or forged tombstone is rejected.

## Delegated agent action references

Every persisted agent-attempt event has a compact action identifier derived
from its sequence, such as `a0002`. Runtime activities may also name registered
Cortex guidance with a `loaded`, `cited`, `applied`, or `validated` relation.

The registry lives at `.cortex/identifiers.json`. Loom validates references
before persistence and prints a compact action summary to stderr after the
journal write, while machine-readable responses remain on stdout. These records
trace observable actions and references. Action metadata persists only typed
activity kinds, Cortex references, and optional evidence digests; free-form
adapter observations remain transient. Existing result and view projections
remain governed by their structured evidence contracts.

Adapter-bearing attempt streams use workflow version `3.0.0`. Earlier versions
do not contain action identities and require local cleanup or explicit
migration rather than inferred replay data.

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
- reusable and public object contracts use semantic types or interfaces;
  clear one-use local literals and inline shapes are permitted

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

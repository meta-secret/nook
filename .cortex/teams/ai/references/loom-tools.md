# Reference: Loom tools and static agent workflows

## Overview

- **Role:** Loom is the Bun tool runner for mechanical Cortex rites.
- **Caller:** Agents call it. Humans do not use it interactively.
- **Leaf protocol:** Domain YAML exposes mechanical leaf operations.
- **Static workflows:** A separate module and CLI own reviewed graphs.
  - They may call leaf operations through typed adapters.
- **Module expert audit:** A separate typed catalog validates named read-only
  experts and complete production-module routing.

See
[agent-workflow-orchestration.md](../design-docs/agent-workflow-orchestration.md).

Full package docs: [`agentic-ai/loom/README.md`](../../../../agentic-ai/loom/README.md).

## Static agent workflow boundary

The existing static SDK workflow is a legacy standalone reviewed read-only
path outside Gizmo multi-team admission. Its scheduler selects its fixed graph's
tasks and invokes the SDK directly. It cannot claim, authorize, or execute the
ordinary multi-team delegation contract, and it is not an implementation
worker path.

Static workflows live under:

```text
agentic-ai/loom/src/agent-workflow/
```

Static workflow rules are:

- Compile topology as TypeScript.
- Select one reviewed catalog entry through the workflow CLI.
- Accept bounded runtime inputs such as an exact source commit.
- Accept no YAML graph.
- Generate no tasks or edges from prompts or Cortex prose.
- Use `cortex-full-garbage-collection` as the first catalog entry.

Use the repository Task wrapper:

```bash
task loom:agent-workflow:cortex-audit BASELINE=<40-character-commit-sha>
task loom:module-experts:validate
```

Add `PLAN=1` for topology validation without worker execution.

Without `PLAN=1`, `loom:agent-workflow:cortex-audit` executes only that narrow
legacy standalone read-only contract. Its success is not evidence that the
installed runtime enforces ordinary multi-team admission.

That workflow contains:

- an exact-baseline task;
- four fixed read-only agent audits and one mechanical audit in parallel;
  - a legacy all-terminal diagnostic-observation join;
- one `FindingSynthesizer` diagnostic aggregation task producing
  `CortexSynthesis`; its output cannot satisfy an ordinary provider edge or
  claim accepted-evidence synthesis compliance;
- the existing `cortexAudit` leaf.

Completed and failed lane observations remain available to that diagnostic
aggregator. Failed observations are not accepted provider evidence.
This lane is separate from the `loom-structural-experts`
`system_coherence_synthesizer` / `SystemCoherenceSynthesis` diagnostic lane.

The workflow audit lane also classifies:

- duplicated procedure prose;
- deterministic leaf candidates;
- compiled workflow candidates;
- safe parallel evidence lanes; and
- policy that must remain semantic judgment.

- **Attempt gate:** Fail closed unless `HEAD` matches the requested baseline and
  the worktree is clean before and after execution.
  - Include untracked files in cleanliness.
- **Local authority:** Write the run journal under
  `workflow/processing/<workflow>/<run-id>/events.jsonl`.
  - It alone owns local scheduling state.
  - Write one action stream per reached agent attempt under `agents/<task>/`.
  - Persist agent-authored Markdown as the attempt `view.md`.
  - Persist the declared materializer's Markdown as the run `view.md`.
  - Content-hash streams and projections before referencing them from the run
    journal.
  - Parents consume views and typed artifacts by default. Raw streams are
    diagnostic evidence.
- **Durability:** The workflow implementation is local-only.
  - Hive is outside local software-development orchestration.
- **Protocol scope:** The YAML rules below apply only to Loom leaf tools.

## Invoke a leaf tool

Defaultable tools use a Task alias and an in-code example:

```bash
task loom:pre-push
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
lifecycle authority. Run its project gate with `task skills:verify`.
Run `task loom:verify` for the recursive AST capability audit and exact
consumer boundary. `task skills:tools-list` is the sole supported strict-YAML
host entrypoint and lists only the provider-neutral discovery action; provider
action invocation remains separate.

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
- call sites must not pass raw object literals; name a typed args value first
- object parameters must use named semantic types or interfaces; inline object
  parameter annotations and generic contract names are prohibited
- mechanically enforced by ESLint `max-params: 1`, `no-restricted-types`, and
  `loom/no-raw-object-arguments` in `agentic-ai/loom`
- review enforces generic-value containment while the existing debt is migrated

Enforced by `task preflight:typescript-state` across the repository, plus
`task loom:verify` (includes ESLint) for Loom-local rules.

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
    scratchPath: "{agentTempDir}/pr-123-scratch.json"
    outputPath: "{agentTempDir}/123.yaml"
    includeTestInventory: true
```

Exactly one root family key is allowed.

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
`exampleRequest`, exact `exampleYaml`, and typed `inputSchema` for every
direct request below.
`resolvedExampleYaml` equals the generated example for static requests and
fills dynamic tokens for the current worktree and commit. Consume that output
instead of maintaining request bodies in Cortex.

### prePush

```bash
task loom:pre-push
```

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

### agentStats (assemble / validate / publish)

```bash
task loom:agent-stats CONFIG=path/to/assemble-request.yaml
```

Validate and publish use `agentStats.validate` / `agentStats.publish` with
`statsFile`. Agent-statistics paths accept `{agentTempDir}` for stable isolation
by Git commit and worktree. See
[Agent PR Statistics](../../../gizmo/workflows/agent-statistics.md#mechanical-entrypoint--loom).

### prLand (status / validate / ready / mergeCheck)

```bash
task loom:pr-land CONFIG=path/to/validate-request.yaml
```

### toolsCall

Wraps another domain request.

Copy the generated `exampleYaml` from `task loom:tools-list` when you need a
nested call. Prefer a top-level domain key for normal calls.

## Response

Success includes `family`, optional `operation` for nested families, and
`result`.

Failures include `phase`, `errors[].path`, and `recover.toolsListRequest`.

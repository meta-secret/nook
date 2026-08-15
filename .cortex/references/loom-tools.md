# Reference: Loom tools and static agent workflows

## Relationships

- [Agent Workflow Orchestration](../design-docs/agent-workflow-orchestration.md)
  - Provides the Agent Workflow Orchestration architecture context.
  - Read when changing the related design.
- [Prefer Popular Libraries](../dynamic-skills/prefer-popular-libraries.md)
  - Defines the Prefer Popular Libraries rule used by this document.
  - Apply when that rule governs the task.
- [TypeScript Domain Structure](../dynamic-skills/typescript-domain-structure.md)
  - Defines the TypeScript Domain Structure rule used by this document.
  - Apply when that rule governs the task.
- [TypeScript Concrete Values](../dynamic-skills/typescript-no-unknown.md)
  - Defines the TypeScript Concrete Values rule used by this document.
  - Apply when that rule governs the task.
- [TypeScript Single Parameter](../dynamic-skills/typescript-single-parameter.md)
  - Defines the TypeScript Single Parameter rule used by this document.
  - Apply when that rule governs the task.

## Document map

- [Overview](#overview)
  - Introduces the document context and its operating assumptions.
  - Read first before using the detailed guidance.
- [Static agent workflow boundary](#static-agent-workflow-boundary)
  - Defines what the guidance covers and where its ownership ends.
  - Read before expanding or assigning the work.
- [Invoke a leaf tool](#invoke-a-leaf-tool)
  - Lists the supported commands and invocation contract.
  - Read when operating the documented tooling.
- [TypeScript domain structure](#typescript-domain-structure)
  - Describes the components, boundaries, and structural model.
  - Read before changing the design or its interfaces.
- [Domain request rule](#domain-request-rule)
  - States the durable principles and invariants for this area.
  - Use while making design and review decisions.
- [Discover request kinds](#discover-request-kinds)
  - Shows how to enumerate Loom's typed request families.
  - Read when the correct domain request is unclear.
  - [dependencyPopularity](#dependencypopularity)
    - Defines the dependency-adoption check request.
    - Use before adding commodity third-party code.
- [Common requests](#common-requests)
  - Collects the standard typed requests used by agents.
  - Read when constructing a Loom input file.
  - [prePush](#prepush)
    - Defines the format and UI-demo pre-push request.
    - Run before every implementation PR push.
  - [cortexAudit](#cortexaudit)
    - Defines the mechanical Cortex consistency audit.
    - Run after changing `.cortex` documents.
  - [skillScaffold](#skillscaffold)
    - Defines synchronized dynamic-skill scaffolding.
    - Use when creating a new canonical skill card.
  - [agentStats (assemble / validate / publish)](#agentstats-assemble--validate--publish)
    - Defines PR-statistics assembly, validation, and publication requests.
    - Read when recording a merged agent-owned PR.
  - [prLand (status / validate / ready / mergeCheck)](#prland-status--validate--ready--mergecheck)
    - Defines typed PR status, validation, readiness, and merge checks.
    - Read when automating a pull-request delivery transition.
  - [toolsCall](#toolscall)
    - Defines the direct typed tool-dispatch request.
    - Read when invoking a single Loom operation programmatically.
- [Response](#response)
  - Defines Loom's success and failure result shape.
  - Read when consuming or diagnosing command output.

## Overview

Loom is the Bun tool runner for mechanical cortex rites.

Agents call it. Humans do not use it interactively.

Loom's domain-YAML protocol exposes mechanical leaf operations.

Static agent workflows use a separate module and CLI.

They may call these leaf operations through typed adapters.

See
[agent-workflow-orchestration.md](../design-docs/agent-workflow-orchestration.md).

Full package docs: [`agentic-ai/loom/README.md`](../../agentic-ai/loom/README.md).

## Static agent workflow boundary

Static workflows live under:

```text
agentic-ai/loom/src/agent-workflow/
```

Their topology is compiled TypeScript.

The workflow CLI selects a reviewed catalog entry.

It accepts bounded runtime inputs such as an exact source commit.

It does not accept a YAML graph.

It does not generate tasks or edges from prompts or Cortex prose.

The first catalog entry is `cortex-full-garbage-collection`.

Use the repository Task wrapper:

```bash
task loom:agent-workflow:cortex-audit BASELINE=<40-character-commit-sha>
```

Add `PLAN=1` for topology validation without worker execution.

That workflow contains:

- an exact-baseline task;
- four fixed read-only agent audits and one mechanical audit in parallel;
- an all-completed evidence join;
- one finding-synthesis task;
- the existing `cortexAudit` leaf.

Each Codex attempt fails closed unless `HEAD` matches the requested baseline
and the worktree is clean before and after execution.

The cleanliness check includes untracked files.

Local runs write `events.jsonl` as an append-only authority.

Task terminal files and the final run result are projections of that journal.

The current workflow implementation is local-only.

Future Hive-backed execution will use Neo4j as the durable authority.

The YAML rules below apply only to Loom leaf tools.

## Invoke a leaf tool

Exactly one form:

```bash
loom <request.yaml>
# or
task loom:run CONFIG=<request.yaml>
```

## TypeScript domain structure

Loom follows [typescript-domain-structure.md](../dynamic-skills/typescript-domain-structure.md):

- nested same-prefix families (`agentStats`, `prLand`) plus operation enums
- field-name enums passed into deny-unknown checks (never string sets)
- codec-local `DecodeOutcome` / `FieldIssue` for decode accumulation only
- runtime failures throw `LoomFailure` with `LoomFailureCode`
- forbidden: generic TypeScript `Result<T>` / `Maybe<T>`, and
  `new Set(['field', ...])` allow-lists

Loom also follows
[typescript-single-parameter.md](../dynamic-skills/typescript-single-parameter.md)
and [typescript-no-unknown.md](../dynamic-skills/typescript-no-unknown.md):

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
    scratchPath: /tmp/pr-123-events.json
    outputPath: /tmp/123.yaml
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

```yaml
dependencyPopularity:
  includeRepositoryManifests: true
  minNpmWeeklyDownloads: 10000
  minGitHubStars: 100
  minCratesIoDownloads: 50000
  minCratesIoRecentDownloads: 1000
```

```bash
task loom:dependency-popularity
```

Prefer libraries over boilerplate:
[prefer-popular-libraries.md](../dynamic-skills/prefer-popular-libraries.md).

## Common requests

### prePush

```yaml
prePush:
  stageHostUpdates: true
  fetchOriginMain: true
```

```bash
task loom:pre-push
```

### cortexAudit

```yaml
cortexAudit:
  includeDensityLint: false
```

```bash
task loom:cortex-audit
```

### skillScaffold

```yaml
skillScaffold:
  skillSlug: example-skill
  createExecutableWrappers: false
```

```bash
task loom:skill-scaffold CONFIG=path/to/request.yaml
```

### agentStats (assemble / validate / publish)

```yaml
agentStats:
  assemble:
    prNumber: 123
    scratchPath: /tmp/pr-123-events.json
    outputPath: /tmp/123.yaml
    includeTestInventory: true
```

```bash
task loom:agent-stats CONFIG=path/to/assemble-request.yaml
```

Validate and publish use `agentStats.validate` / `agentStats.publish` with
`statsFile`.

### prLand (status / validate / ready / mergeCheck)

```yaml
prLand:
  validate:
    prNumber: 948
    runFullE2e: false
```

```bash
task loom:pr-land CONFIG=path/to/validate-request.yaml
```

### toolsCall

Wraps another domain request:

```yaml
toolsCall:
  prePush:
    stageHostUpdates: true
    fetchOriginMain: true
```

Prefer a top-level domain key for normal calls.

## Response

Success includes `family`, optional `operation` for nested families, and
`result`.

Failures include `phase`, `errors[].path`, and `recover.toolsListRequest`.

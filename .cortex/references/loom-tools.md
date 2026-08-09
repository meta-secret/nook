# Reference: Loom domain YAML protocol

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

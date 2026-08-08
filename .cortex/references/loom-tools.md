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
- field-name enums for deny-unknown-key checks
- codec-local `DecodeOutcome` / `FieldIssue` for decode accumulation
- runtime failures throw `LoomFailure` with `LoomFailureCode`
- no generic TypeScript `Result<T>` or `Maybe<T>` utilities

Enforced by `task preflight:typescript-state` across the repository, including
`agentic-ai/loom`.

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

On decode errors, read `errors[].path`, then run `toolsList`.

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

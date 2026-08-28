---
name: executable-skill-host
description: Discover and invoke the AI team's closed executable skill catalog through strict, bounded YAML.
---

# Executable Skill Host

## Problem

Agents need machine-readable discovery before invoking deterministic skill
applications. Ad hoc flags and generic name/arguments envelopes hide domain
shape and weaken validation.

## Pattern and scope

The scripts project owns strict YAML transport and a closed, code-reviewed
catalog. This slice publicly exposes only its own tools-list action through the
exact `task skills:tools-list` entrypoint. Provider action integration and
provider invocation remain separate changes.

The host has no model, scheduling, network, repository-write, process-spawn,
dynamic import, manifest activation, or lifecycle authority. A Task install may
fetch frozen dependencies; the invoked host and providers may not.

## Example

```yaml
skillToolsList:
  list: {}
```

Use a returned `exampleYaml` unchanged as the starting request. Failures
contain typed phase, field path, issue, and message fields plus a tools-list
recovery request. Request scalars and unknown keys are never echoed.

## Application and validation

Keep generic transport here and action schema, example, decode, execution, and
verification in the owning skill. Provider integration must be static and
one-way from host to provider. Discover the catalog with
`task skills:tools-list`; validate both executable projects with
`task skills:verify` and the repository boundary with `task loom:verify`.

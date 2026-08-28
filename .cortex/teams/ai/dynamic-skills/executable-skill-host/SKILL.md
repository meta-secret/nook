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

The scripts project owns a closed, code-reviewed catalog and strict YAML
transport. `task skills:tools-list` returns action descriptions, closed input
schemas, and executable YAML examples. `task skills:run CONFIG=<request.yaml>`
accepts exactly one root family and nested operation, validates it, invokes the
statically imported provider, independently verifies its result, and emits one
bounded YAML document.

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
verification in the owning skill. Catalog imports are static and one-way from
host to provider. Validate with `task skills:verify`, `task loom:verify`, and
`task preflight:loom-contracts`.

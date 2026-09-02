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
catalog. An AI worker authors or inspects strict requests without invoking the
local `skills:*` Task targets. The CLI receives one complete multiline
document in one `--request-yaml=<strict-yaml>` argument. It does not read
request files or stdin.

The host has no model, scheduling, network, repository-write, process-spawn,
dynamic import, manifest activation, or lifecycle authority. Static actions
return validated data or plans. The active harness alone creates and
coordinates agents and subagents. A Task install may fetch the frozen workspace
dependencies. The invoked host and providers may not fetch dependencies.

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
one-way from host to provider. Return the coherent commit to Gizmo. Gizmo
pushes the exact head and dispatches
`task remote TASK_NAME=loom:verify`. That hosted path exercises catalog
discovery and validates every workspace package and repository boundary.

---
name: delegation-visualization
description: Render Gizmo's ephemeral native Team Agent plan without acquiring lifecycle authority.
---

# Delegation Visualization

## Purpose

Render the complete Team Agent plan known before native harness dispatch.

The output is a typed plan document. The trusted executable-skill host
serializes its response as compact user-visible YAML. It is not execution
state.

## Rules

- Gizmo supplies every currently known Team Agent task in dispatch order.
- Every task has one canonical team, one identifier, and one description.
- Dependencies name earlier tasks in the same request.
- Every Team Agent is rendered in `document.gizmo.tasks`.
- Repeated teams remain separate Team Agent entries.
- The renderer preserves the validated request order.
- Every task includes its stable `id`, owning `team`, human-readable
  `description`, and exact `depends_on` identifiers.
- The application constructs the typed result.
- An independent verifier requires its exact class instances.
- The verifier checks every field, task order, and dependency order against the
  admitted request before returning it.
- The executable-skill host performs the only YAML serialization and enforces
  its response byte limit.

The application has no filesystem, process, network, persistence, admission,
scheduling, retry, or agent-lifecycle authority. The active harness alone
creates and coordinates Team Agents.

## Invocation

Discover the strict request through the executable skill host:

```bash
task skills:tools-list
```

Invoke the returned `delegationVisualization.render` request:

```bash
task skills:run REQUEST_YAML='<strict-yaml>'
```

Publish only the returned `document` as the plan. Do not infer or edit the
rendered output.

## Later discovery

A later dependency requires a new complete request for the then-known work.
Never rewrite an earlier visualization as though the dependency was known.

## Validation

- Reject duplicate, missing, self, forward, or cyclic dependencies.
- Reject unknown teams and unsupported fields.
- Verify exact document fields, task order, and dependency order with focused
  package tests.
- Run `task skills:verify` and `task loom:cortex-audit` before delivery.

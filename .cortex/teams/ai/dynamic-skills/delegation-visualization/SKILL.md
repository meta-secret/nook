---
name: delegation-visualization
description: Render Gizmo's ephemeral native Team Agent plan without acquiring lifecycle authority.
---

# Delegation Visualization

## Purpose

Render the complete Team Agent plan known before native harness dispatch.

The output is a compact user-visible hierarchy. It is not execution state.

## Rules

- Gizmo supplies every currently known Team Agent task in dispatch order.
- Every task has one canonical team, one identifier, and one description.
- Dependencies name earlier tasks in the same request.
- Every Team Agent is rendered directly beneath `gizmo`.
- Repeated teams remain separate Team Agent entries.
- The renderer preserves the validated request order.
- The application round-trips the bounded result contract and independently
  verifies the exact tree against the admitted request before returning it.

The application has no filesystem, process, network, persistence, admission,
scheduling, retry, or agent-lifecycle authority. The active harness alone
creates and coordinates Team Agents.

## Invocation

Gizmo builds the bounded request as strict JSON:

```json
{
  "kind": "gizmo-delegation-visualization-v1",
  "tasks": [
    {
      "id": "update-cortex",
      "team": "ai",
      "description": "update Cortex",
      "dependencies": []
    }
  ]
}
```

Invoke the dependency-free presentation-control entrypoint:

```bash
task loom:delegation-visualization REQUEST_JSON='<strict-json>'
```

Publish only the returned `tree` as the plan hierarchy. Do not infer or edit
the rendered output. This entrypoint imports only the co-located codec,
application, and renderer. It does not install the executable-skill workspace.

## Later discovery

A later dependency requires a new complete request for the then-known work.
Never rewrite an earlier visualization as though the dependency was known.

## Validation

- Reject duplicate, missing, self, forward, or cyclic dependencies.
- Reject unknown teams and unsupported fields.
- Verify exact tree order and connectors with focused package tests.
- Return the coherent change to Gizmo. Gizmo's hosted `loom:verify` evidence
  executes the package and Cortex contract coverage before delivery.

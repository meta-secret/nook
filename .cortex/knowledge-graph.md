# Cortex Context Router

Use this file only to select one owning context. Do not preload every linked
graph.

## Entry contract

- [Agent routing contract](AGENTS.md) defines the mandatory loading boundary.

## Gizmo route

Choose Gizmo for mission planning, delegation, integration, review
coordination, Workbench, pull requests, readiness, and merge state.

- [Gizmo](gizmo/knowledge-graph.md) owns delivery control and the final
  integrated PR verdict.

## Team routes

Gizmo chooses the team agent that owns the requested functionality.

- [AI](teams/ai/knowledge-graph.md) owns Cortex, Loom, agent skills, agent
  workflows, expert routing, and AI automation.
- [Development core](teams/dev-core/knowledge-graph.md) owns portable Rust,
  vault behavior, security-control implementation, and typed WASM contracts.
- [Security](teams/security/knowledge-graph.md) owns security architecture,
  cryptographic policy, trust boundaries, security review, and
  security-specific skills.
- [SRE](teams/sre/knowledge-graph.md) owns CI/CD, clusters, deployments,
  runners, containers, and operations.
- [Web development](teams/web-dev/knowledge-graph.md) owns TypeScript and Svelte
  engineering expertise, browser presentation, frontend behavior, and
  extension interaction.

## Shared route

- [Shared knowledge](shared/knowledge-graph.md) contains only genuinely
  cross-team architecture, catalogs, references, and engineering rules.

Load shared knowledge only when the selected task depends on a named shared
authority.

## Routing rules

1. Gizmo keeps delivery-control work in its own context.
2. Gizmo recursively discovers bounded worker-executable team and provider task
   records. Parent-owned control operations remain outside that graph.
3. Gizmo assigns exactly one team identity to each worker-executable team or
   provider task.
4. Loom/Nook computes eligible candidates, conflicts, capacity, leases, and
   exact frontier data; Gizmo validates the batch, selects task records,
   admission-authorizes one exact attempt ID per selection, and freezes and owns
   those attempts' starting frontiers.
5. Gizmo supplies each authorized contract to the active harness. The harness
   alone creates and operates attempts and never selects or admits records or
   snapshots or changes frontiers.
6. An unknown provider is a late mutation: it returns to Gizmo and invalidates
   the complete old generation for immutable generation restart.
7. Every graph mutation reruns deterministic topology and cycle validation.
8. Cycles fail closed and return the blocked dependency to Gizmo.
9. Wave selection includes claims in every unreleased lease.
10. Worker termination does not release a lease.
11. Gizmo records each conclusive output disposition; Loom/Nook then releases
    its lease and recomputes readiness and candidate data.
12. Deterministic hazard ordering prevents stale evidence in accepted
    consumers. If stale evidence requires re-execution, use the complete
    immutable generation restart; do not implicitly or selectively invalidate
    or revalidate accepted consumers.
13. The assigned worker loads only its own context's `AGENTS.md` and knowledge
   graph.
14. Open only documents needed for the assigned functionality.
15. Load a shared document only for a named cross-team dependency.
16. Do not open another team's graph for background context.
17. Return foreign-team requirements to Gizmo.
18. Load a foreign-team skill read-only when the selected team's task-relevant
   authority names it as required engineering policy.
19. Require an expertise contract only when the foreign team will change files.
20. Route security architecture and acceptance questions to security without
   transferring implementation ownership from the functional team.

For a multi-team request, Gizmo loads only its own graph. Every reached
worker-executable team or provider task has a task record and exactly one team
identity. Every authorized `(task ID, attempt ID)` receives exactly one harness-
visible worker attempt with only that team's context; a logical task may have
sequential retries but never more than one concurrently active attempt. Parent-
owned Gizmo control operations remain outside the worker graph and receive
neither a team identity nor a worker attempt.

# Agent Feature Ownership

## Purpose

Keep agents inside their assigned Nook feature and focused issue scope. Upstream
[Team Gizmo](../../../.meta-cortex/agents/teams/gizmo/AGENTS.md) owns worker
coordination. The upstream
[integration agent](../../../.meta-cortex/agents/teams/delivery-team/integration-agent/AGENTS.md)
owns local feature and task branches, worktrees, integration, and cleanup.

## Required actions

- Treat every other active task as read-only without an explicit handoff.
- Give each worker a functional team identity, bounded file scope, dependencies,
  product constraints, and acceptance evidence.
- Keep knowledge routing separate from write authority.
- Route GitHub mutations only through Nook PR Lifecycle under Prime's explicit
  authorization.
- Let the active harness carry ordinary communication and handoffs.

**Prohibited:** modify another active task's branch, pull request, review thread,
labels, checks, Workbench issues, or files because its work is visible.

**Preferred:** inspect overlap read-only, report it to the owner, and wait for an
explicit handoff before mutation.

## Scope

This policy applies to agent-driven Nook and Workbench changes. Read-only
inspection, explicit handoffs, and repository automation acting within its
documented machine-owned scope remain allowed.

Local Git completion follows the upstream integration agent. GitHub publication,
checks, merge, and remote cleanup remain the separate responsibility of
[PR Lifecycle](../../teams/delivery-pipeline/pr-lifecycle/AGENTS.md).

## Prohibited actions

- Do not invent repository journals, receipts, leases, SHA queues, worker
  freezing, or a custom handoff protocol.
- Do not publish worker branches or let functional workers mutate GitHub state.
- Do not treat a worker's completion report as feature completion.

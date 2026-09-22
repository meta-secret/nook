# Agent Feature Ownership

## Purpose

Keep agents inside their assigned Nook feature and focused issue scope. Upstream
[Team Gizmo](../../../.meta-cortex/teams/gizmo-team/agents/gizmo/AGENTS.md) owns worker
coordination. The upstream
[integration agent](../../../.meta-cortex/teams/delivery-team/agents/integration-agent/AGENTS.md)
owns local feature and task branches, worktrees, integration, and cleanup.

## Required actions

- Treat every other active task as read-only without an explicit handoff.
- Give each worker a functional team identity, bounded file scope, dependencies,
  product constraints, and acceptance evidence.
- Keep knowledge routing separate from write authority.
- Route GitHub PR mutations through Nook PR Lifecycle and workflow execution
  through upstream CI/CD with Nook SRE context under Prime's explicit authorization.
- Recheck task ownership before each push, review resolution, close, reopen, or
  merge action.
- Do not reply to or resolve another task's review threads. Do not close,
  reopen, or merge its pull request.
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
check observation, merge, and remote cleanup remain the separate responsibility of
[PR Lifecycle](../../teams/delivery-pipeline/pr-lifecycle/AGENTS.md).

## Automated worker ownership

- An issue-backed run takes its continuing owner from the claimed Workbench
  issue.
- A prompt-backed run requires the `continuing_owner` workflow input.
- The continuing owner must be a Nook GitHub collaborator with write access.
- The workflow records that owner for its branch and Workbench scope and posts
  a direct mention before exit.
- The manager-owned PR path records aggregate delivery provenance.

## Prohibited actions

- Do not invent repository journals, receipts, leases, SHA queues, worker
  freezing, or a custom handoff protocol.
- Do not publish worker branches or let functional workers mutate GitHub state.
- Do not treat a worker's completion report as feature completion.

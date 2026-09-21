# Nook Agent Assignment Integration

## Required actions

- Use [upstream Team Gizmo](../../../.meta-cortex/agents/teams/gizmo/AGENTS.md)
  for assignment and coordination.
- Use the upstream [integration agent](../../../.meta-cortex/agents/teams/delivery-team/integration-agent/AGENTS.md)
  for local branches, worktrees, integration, validation, and cleanup.
- Preserve Nook's functional team identity, bounded file scope, dependency
  order, product constraints, and acceptance evidence in each assignment.
- Send authorized GitHub operations through Team Gizmo to PR Lifecycle.

**Prohibited:** launch a second coordinator because one task needs security review.

**Preferred:** the existing coordinator assigns the security role its review scope.

## Prohibited actions

Do not duplicate the upstream local feature procedure in Nook wrappers. Do not
use repository journals as a dispatch mechanism. The active host provides agent
communication. Explicit user limits on delegation remain binding.

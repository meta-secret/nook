# Nook Agent Assignment Integration

## Required actions

Use the upstream agent workflow supplied by Nook's integration contract.
Prime sends the mission to the single Team Gizmo. It selects upstream roles with
Nook context from the supplied catalogs. There is no per-team coordinator launch.

- Preserve Nook's functional owner, bounded files, issued worktree, dependency
  order, and acceptance evidence in each assignment.
- Keep child branches private.
- Integrate complete scoped commits serially into the canonical feature branch.
- PR Lifecycle receives GitHub operations through Team Gizmo under Prime's authority.

**Prohibited:** launch a second coordinator because one task needs security review.

**Preferred:** the existing coordinator assigns the security role its review scope.

## Prohibited actions

Do not use repository journals as a dispatch mechanism. The active host provides
agent launch and handoff. Explicit user limits on delegation remain binding.

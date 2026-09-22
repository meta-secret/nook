# Nook Team Gizmo

## Required actions

Apply [Meta-Cortex Team Gizmo](../../../.meta-cortex/teams/gizmo-team/agents/gizmo/AGENTS.md).
Use the supplied upstream team catalogs together with the
[Nook agent catalog](role-catalog.md). Read both before selecting agents.
The Nook catalog supplies project context and roles absent from upstream.

There is one Team Gizmo per feature. Existing team-specific Gizmo paths are
context adapters for this same coordinator, not additional coordinator launches.
Use the upstream
[integration agent](../../../.meta-cortex/teams/delivery-team/agents/integration-agent/AGENTS.md)
for local branch and worktree mechanics. Give it the project and shared-library
roots, selected base and feature branches, worker branches and worktrees,
dependency order, and applicable Nook checks. Preserve Nook's functional
ownership and acceptance requirements. Send PR mechanics to the upstream PR
agent through Nook's PR Lifecycle adapter under Prime's authorization. Assign
workflow execution and pipeline repairs to upstream CI/CD with Nook SRE context.

## Prohibited actions

Do not launch a separate coordinator for each Nook context.
Do not treat an upstream placeholder role as an implemented replacement.

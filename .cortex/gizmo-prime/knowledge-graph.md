# Gizmo Prime Knowledge Graph

Load only the category required for the current delivery stage.

## Delivery contract

- [Gizmo Prime agent contract](AGENTS.md)

## Team reporting

Every team has exactly one Team Gizmo. Gizmo Prime uses `gpt-5.6-sol` with
`low` reasoning. Every Team Gizmo uses the same model and reasoning. Each Team
Gizmo requests Fast mode with `service_tier: fast`, which resolves as `priority`.
Prime creates or reuses each compatible Team Gizmo, gives it one team worktree,
and receives its high-level evidence or blockers. Each leaf Team Agent uses
`gpt-5.6-luna` with `xhigh` reasoning. It requests Fast mode with
`service_tier: fast`, which resolves as `priority`. Each leaf receives a separate
issued child worktree. Gizmo Prime dispatches all dependency-ready Team Gizmos with disjoint
scopes in parallel, subject only to dependency edges and active harness
capacity. A Team Gizmo may run disjoint specialists in parallel, integrates
their committed results into the feature branch, and never creates or updates
pull requests.

- [AI Team Gizmo](../teams/ai/gizmo/knowledge-graph.md)
- [Development Core Team Gizmo](../teams/dev-core/gizmo/knowledge-graph.md)
- [Security Team Gizmo](../teams/security/gizmo/knowledge-graph.md)
- [SRE Team Gizmo](../teams/sre/gizmo/knowledge-graph.md)
- [Web Development Team Gizmo](../teams/web-dev/gizmo/knowledge-graph.md)
- [Delivery Pipeline Team Gizmo](../teams/delivery-pipeline/gizmo/knowledge-graph.md)
  owns CI, PR lifecycle, dev publication, local landing, evidence, and guarded
  promotion mechanics. It is not a second Prime and does not decide functional
  ownership, readiness, promotion, or final delivery.

## Architecture and ownership

Use this authority to classify team work and shared delivery state.

- [Engineering team ownership](architecture/team-ownership.md)
- [Dev delivery](architecture/dev-delivery.md)
- [Multiagent delivery visual model](architecture/multiagent-delivery-diagrams.md)

## Dynamic skills

Use these skills only for the delivery action in scope.

- [Branch naming contract](dynamic-skills/branch-naming.md)
- [Agent feature ownership](dynamic-skills/agent-feature-ownership.md)
- [Code review comments](dynamic-skills/code-review-comments.md)
- [Efficient PR delivery](dynamic-skills/efficient-pr-delivery.md)
- [Feature Workbench planning](dynamic-skills/feature-issue-planning.md)
- [Workbench scope management](dynamic-skills/issue-scope-management.md)
- [Team-oriented development](dynamic-skills/team-oriented-development.md)

## Workflows

Open one workflow at the stage that requires it.

- [Mission delivery](workflows/mission-delivery.md)
- [PR Lifecycle Team Agent](../teams/delivery-pipeline/pr-lifecycle/knowledge-graph.md)
- [Agent statistics](workflows/agent-statistics.md)
- [Pull request workflow](workflows/pull-requests.md)
- [Review request workflow](workflows/code-review.md)
- [Workbench issue management](workflows/issues.md)
- [Module-oriented development](workflows/module-oriented-development.md)
- [Team-oriented development](workflows/team-oriented-development.md)
- [Subagent delegation](workflows/subagent-delegation.md)

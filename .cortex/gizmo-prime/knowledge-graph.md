# Gizmo Prime Knowledge Graph

Load only the category required for the current delivery stage.

## Delivery contract

- [Gizmo Prime agent contract](AGENTS.md)

## Team reporting

- Every team has a Team Gizmo that receives Prime's high-level packet,
  dispatches internal Team Agents through the active harness, and reports
  exact-SHA evidence or blockers back to Gizmo Prime.
- [Delivery Pipeline Team Gizmo](../teams/delivery-pipeline/internal/gizmo/knowledge-graph.md)
  is the current operational Team Gizmo for CI, PR lifecycle, dev publication,
  workflow execution, local landing, evidence, and guarded promotion. It is not
  a second Prime and does not decide functional ownership, readiness, promotion,
  or final delivery.

## Architecture and ownership

Use this authority to classify team work and shared delivery state.

- [Engineering team ownership](architecture/team-ownership.md)
- [Dev delivery](architecture/dev-delivery.md)
- [Multiagent delivery visual model](architecture/multiagent-delivery-diagrams.md)

## Dynamic skills

Use these skills only for the delivery action in scope.

- [Agent feature ownership](dynamic-skills/agent-feature-ownership.md)
- [Code review comments](dynamic-skills/code-review-comments.md)
- [Efficient PR delivery](dynamic-skills/efficient-pr-delivery.md)
- [Feature Workbench planning](dynamic-skills/feature-issue-planning.md)
- [Workbench scope management](dynamic-skills/issue-scope-management.md)
- [Team-oriented development](dynamic-skills/team-oriented-development.md)

## Workflows

Open one workflow at the stage that requires it.

- [Mission delivery](workflows/mission-delivery.md)
- [Internal PR Steward Team Agent](../teams/delivery-pipeline/internal/pr-steward/knowledge-graph.md)
- [Agent statistics](workflows/agent-statistics.md)
- [Pull request workflow](workflows/pull-requests.md)
- [Review request workflow](workflows/code-review.md)
- [Workbench issue management](workflows/issues.md)
- [Module-oriented development](workflows/module-oriented-development.md)
- [Team-oriented development](workflows/team-oriented-development.md)
- [Subagent delegation](workflows/subagent-delegation.md)

---
name: coding-bro
description: >-
  Default Gizmo delivery workflow for Nook implementation missions. Plan the
  mission, delegate every implementation and fix to the responsible team,
  integrate verified handoffs, validate the exact head, and complete delivery.
---

# Mission Delivery

Follow the canonical
[mission delivery workflow](../../../.cortex/gizmo/workflows/mission-delivery.md).

## Gizmo contract

1. Fetch the required baseline and confirm feature ownership.
2. Publish the public-safe Workbench plan.
3. Split the mission into bounded team tasks.
4. Give each team its own context, exact baseline, write scope, and evidence.
5. Integrate only verified commit handoffs.
6. Run `task loom:pre-push` before each push.
7. Route every review or validation fix back to the responsible team.
8. Validate and audit readiness on the exact integrated head.
9. Issue the final integrated verdict.
10. Squash-merge and publish completion records when ready.

Gizmo never implements a feature or fix. Gizmo cannot override a required
blocking team or security verdict.

Use:

- [team-oriented development](../../../.cortex/gizmo/workflows/team-oriented-development.md);
- [subagent delegation](../../../.cortex/gizmo/workflows/subagent-delegation.md);
- [module-oriented development](../../../.cortex/gizmo/workflows/module-oriented-development.md);
- [pull request delivery](../../../.cortex/gizmo/workflows/pull-requests.md); and
- [AI self-improvement](../../../.cortex/teams/ai/dynamic-skills/self-improvement.md).

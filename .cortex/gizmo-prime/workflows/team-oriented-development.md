# Team-Oriented Development

One functional team owns each Nook scope. The single upstream Team Gizmo
coordinates workers and the upstream integration agent owns local Git mechanics.
Each assignment adds the Nook team identity, bounded file scope, dependency
order, product constraints, and acceptance evidence.

## Procedure

1. Apply the [upstream local feature workflow](../../../.meta-cortex/agents/teams/delivery-team/integration-agent/skills/local-feature/SKILL.md).
2. Route each functional scope through the single Team Gizmo with Nook context.
3. After local completion, follow Nook's
   [pull-request delivery contract](../architecture/dev-delivery.md) only when
   publication is authorized.

Local completion does not authorize publication. For authorized delivery, the
owning Feature Gizmo controls readiness and may merge its own pull request.
Missing review or approval is non-blocking.

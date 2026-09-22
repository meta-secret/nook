# Nook PR Lifecycle Adapter

## Role composition

### Upstream composition

Apply the [upstream PR agent](../../../../.meta-cortex/teams/delivery-team/agents/pr-agent/AGENTS.md)
and its Pull Request Delivery skill. Keep `pr-lifecycle` as Nook's typed Loom
identity. Generic publication, observation, merge, and cleanup procedures belong
to upstream.

Supply the [Delivery Pipeline policy](../AGENTS.md),
[authorization packet](workflows/authorization-handshake.md), and
[Nook lifecycle integration](workflows/pull-request-lifecycle.md) with the
project and library roots. The Feature Gizmo retains functional acceptance and
authorizes each operation. In single-agent mode, the current agent applies this
composition directly.

- **Prohibited:** interpret a publish-only packet as permission to merge or deploy.
- **Preferred:** publish the assigned feature PR into `main`, return its evidence,
  and stop at the authorized outcome.

PR Lifecycle also owns the `task pr:validate` label mutation that requests
label-triggered PR validation. CI/CD executes and observes the resulting
workflow; it does not edit pull-request labels.

## CI execution boundary

Report workflow dispatch, rerun, log investigation, and infrastructure repair
needs to Team Gizmo for the upstream CI/CD role with Nook SRE context. Reuse its
run evidence when observing PR readiness. Application fixes and local branch
integration remain with their assigned owners.

**Prohibited:** launch a duplicate validation run because the PR agent has
started observing checks, or repair product code from a PR mechanics assignment.

**Preferred:** consume the existing run's complete terminal inventory and return
repair needs to the feature owner. Apply CI/CD locally in single-agent mode.

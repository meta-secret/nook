# Nook Provisioning and CI/CD Adapter

## Role composition

### Upstream composition

For CI execution and assigned pipeline repairs, apply the
[upstream CI/CD agent](../../../../.meta-cortex/teams/sre-team/agents/cicd-agent/AGENTS.md)
and its CI/CD Operations skill with [Nook SRE context](../AGENTS.md).
Keep `provisioning` as the existing Nook Loom role identity. Team Gizmo supplies
the project root, library root, assigned workspace, source branch, authorized
operation, and existing run evidence. Single-agent sessions apply this locally.

Use [remote execution](../workflows/remote-execution.md) for Nook's hosted
validation boundary. PR publication and merge remain with the PR agent under
Nook's delivery policy. Return run URLs, tested revisions, complete job outcomes,
diagnostics, and unresolved blockers through Team Gizmo.

- **Prohibited:** substitute local tests for required hosted evidence or merge a
  PR because an assigned workflow completed.
- **Preferred:** execute the authorized existing workflow and return its actual
  terminal results for the feature owner's delivery decision.

## Provider provisioning

Nook retains provider-specific provisioning through its
[infrastructure runbook](../references/infrastructure-provider-operations.md).
Use upstream Docker or Kubernetes expertise when the assigned work reaches
those subjects. Provisioning does not authorize a new release pipeline or
changes outside the assigned infrastructure scope.

**Prohibited:** treat a runner-repair assignment as permission to replace the
cluster or redesign product deployment.

**Preferred:** repair the named runner infrastructure through the existing
runbook and report the observed result and remaining dependencies.

# Nook Scope Routing

Meta-Cortex supplies every executable agent role. Nook supplies project context
from the owning functional and module catalogs. The same upstream role may work
in several Nook scopes without creating another role identity.

## Required actions

- Select roles from the installed Meta-Cortex team catalogs.
- Supply the relevant Nook ownership specification and module context.
- Keep functional ownership separate from language expertise.
- Use one upstream Team Gizmo per feature in multi-agent mode.
- Apply the same role instructions locally in single-agent mode.

**Prohibited:** launch a Nook Auth2 developer or a second security coordinator.

**Required:** assign the upstream Rust developer the Auth2 specification;
assign the upstream security agent its bounded policy or review scope.

## Scope references

- **Portable Rust and Auth2**
  - Role: [Rust developer](../../../.meta-cortex/teams/dev-team/agents/rust-dev/AGENTS.md).
  - Context: [Development Core](../../teams/dev-core/index.md), then the owning module specification.
- **Browser, Svelte, and Loom implementation**
  - Role: [TypeScript developer](../../../.meta-cortex/teams/dev-team/agents/typescript-dev/AGENTS.md).
  - Context: [Web Development](../../teams/web-dev/index.md) or [AI](../../teams/ai/index.md), according to functional ownership.
- **Cortex authoring**
  - Role: [Tech Writer](../../../.meta-cortex/teams/ai-team/agents/tech-writer/AGENTS.md).
  - Context: [AI](../../teams/ai/index.md) and the subject owner's requirements.
- **Interface design**
  - Role: [Web designer](../../../.meta-cortex/teams/dev-team/agents/web-designer/AGENTS.md).
  - Context: [Web Development](../../teams/web-dev/index.md).
- **Cryptographic policy and security review**
  - Role: [Security agent](../../../.meta-cortex/teams/security-team/agents/security-agent/AGENTS.md).
  - Context: [Security](../../teams/security/index.md); implementation stays with its functional owner.
- **CI/CD, Docker, and Kubernetes**
  - Roles: installed [SRE catalog](../../../.meta-cortex/teams/sre-team/AGENTS.md).
  - Context: [SRE](../../teams/sre/index.md), including compile-cache and provider specifications when applicable.
- **Git integration and pull requests**
  - Roles: installed [Delivery catalog](../../../.meta-cortex/teams/delivery-team/AGENTS.md).
  - Context: [Delivery Pipeline](../../teams/delivery-pipeline/index.md) and Nook's feature-delivery requirements.

These references select project requirements. Generic role responsibilities,
skills, verification, configuration, and launch procedures remain upstream.

## Migration boundary

- Loom module-delivery plans use version `7` for upstream role names and project context paths.
- Readers reject versions `1` through `6`; regenerate plans from current assignments instead of converting stored records.
- Loom task context now accepts functional team keys only.
- Removed Nook agent and team-Gizmo selectors have no aliases or compatibility reader.
- Regenerate in-memory task contexts from their functional team and selected upstream role.
- Worker branch role segments now use upstream role names; new assignments reject retired Nook names.
- Skill scaffolding accepts shared or functional ownership; the retired Gizmo skill owner is unsupported.
- Existing feature ledger schemas and published Cortex identifiers remain unchanged.

**Prohibited:** accept a retired Nook agent selector as another name for a team.

**Required:** use the existing functional team key and load the selected
Meta-Cortex role through the host; report an unsupported selector directly.

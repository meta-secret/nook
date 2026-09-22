# Meta-Cortex Integration

## Required actions

### Roots and ownership

Use `.meta-cortex` as the local Meta-Cortex library root and the Nook checkout
as the project root.

Meta-Cortex owns generic roles, skills, and language practices. Nook owns product
architecture, product security boundaries, delivery stages, and Nook-specific
tooling. Nook wrappers adapt upstream roles without redefining generic policy.

### Thin wrapper and catalog mappings

Resolve these Nook and upstream locations when loading the integration:

- **Prime role:** `.cortex/gizmo-prime/AGENTS.md`.
- **Team Gizmo role:** `.cortex/gizmo-prime/team-gizmo/AGENTS.md`.
- **Upstream catalogs:** `.meta-cortex/teams/`.
- **Project catalog:** `.cortex/gizmo-prime/team-gizmo/role-catalog.md`.
- **Configuration:** `.meta-cortex/meta-cortex.toml`.
- **Project context:** the root contract and selected Nook team authorities.

These wrappers select the upstream role behavior and the Nook context. Keep
Nook-specific mappings in the project catalog and generic mappings in upstream
catalogs.

### Session development mode

Follow the upstream [development-mode workflow](../.meta-cortex/AGENTS.md#development-mode)
and its [native user-input skill](../.meta-cortex/teams/gizmo-team/agents/gizmo/skills/user-input/SKILL.md).
The upstream [form](../.meta-cortex/development.yaml) supplies the session choice.

- In `single_agent` mode, the current agent loads the relevant roles and performs
  the work. Nook's coordinator, worker, integration-agent, and PR Lifecycle routing
  requirements apply only in `multi_agent` mode.
- Preserve Nook's product boundaries, authorization, validation stages, and the
  user's stopping point in both modes.
- Carry the selected mode through the current conversation and assignments.
  Keep session answers out of repository files and upstream configuration.

For example, a single-agent migration updates local integration files in the
current task. It does not launch an integration agent or start GitHub delivery.

### Upstream layout

- Resolve catalogs under `.meta-cortex/teams/` and roles under each team's
  `agents/` directory. Prime and Team Gizmo belong to `gizmo-team`.
- Load shared [programming requirements](../.meta-cortex/teams/dev-team/docs/index.md)
  with the selected language skill. They replace the former common coding skill.
- Load shared [security requirements](../.meta-cortex/teams/security-team/docs/index.md)
  for product security work.
- Resolve upstream skill rule maps through `index.md`. Version 0.6.0 replaces
  the former skill-level `knowledge-graph.md` paths; Nook's own knowledge graphs
  retain their existing names.
- Use the upstream SRE Docker, Kubernetes, and CI/CD roles with Nook's cache,
  cluster, and hosted-execution contexts. Use the upstream PR agent for GitHub
  pull-request mechanics with Nook's delivery policy.

For example, TypeScript assignments use the TypeScript agent's skill alongside
the development team's programming documents.

### Delivery and SRE adapters

- [PR Lifecycle](teams/delivery-pipeline/pr-lifecycle/AGENTS.md) selects the
  upstream PR agent. Nook owns its authorization packet, target `main`, squash
  policy, complete check inventory, and live event subscriber.
- [Provisioning](teams/sre/provisioning/AGENTS.md) selects upstream CI/CD for
  workflow execution and infrastructure repairs. Provider provisioning retains
  Nook's existing runbooks; upstream does not supply a replacement provisioner.
- [Cloud native](teams/sre/cloud-native/AGENTS.md) selects upstream Kubernetes.
- [Docker cache](teams/sre/docker-cache-specialist/AGENTS.md) selects upstream
  Docker while retaining Nook's cache-health and latency requirements.
- Keep these Nook identities and context paths because Loom's typed role,
  branch, context, and audit contracts consume them. They do not define parallel
  generic agents. Supply upstream roles and skills through the assignment.
- Team Gizmo assigns PR mechanics and CI execution separately. Use one observer
  per run and share its evidence. In single-agent mode, apply both roles locally.

**Prohibited:** delete the `pr-lifecycle` context while Loom still requires it,
or let a PR assignment invent a release pipeline.

**Preferred:** compose the upstream PR role with Nook's delivery adapter and
assign a requested workflow rerun to upstream CI/CD with SRE context.

### Pinned installation

The ignored library is copied from `cortex/` in
[meta-cortex](https://github.com/ai-ai-ai-ai-ai-ai-ai/meta-cortex) at release
`v0.6.0` (commit `3a87a1e9a28ae43a18921dc7002d351ceb03ad76`).
Its Apache-2.0 license is copied to `.meta-cortex/LICENSE`.

The library is absent from Nook clones, task worktrees, and pull requests.
Install this exact release in the repository root for local development and in
CI stages that resolve Meta-Cortex links. Task worktrees resolve that shared
library root separately. Keep the installed directory untracked and copy the
upstream configuration unchanged.

For a fresh checkout, copy the pinned `cortex/` directory and `LICENSE` into
`.meta-cortex/`. This checkout uses a local source installation; do not run
`meta-cortex init` over it.

### Updating the pinned installation

1. Select and record the new upstream release tag in this document.
2. Compare the installed copy with its recorded source and preserve local
   differences separately.
3. Replace the ignored `.meta-cortex/` library and license from that tag.
4. Review upstream path changes and update the thin wrapper and catalog mappings.
5. Keep the upstream configuration unchanged during development and CI install.
6. Run the Nook-authorized checks for the updated integration.

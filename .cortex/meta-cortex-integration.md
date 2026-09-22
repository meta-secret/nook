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
- Use the upstream SRE Docker and Kubernetes roles with Nook's cache and
  cloud-native contexts. Keep provisioning and GitHub delivery in Nook's catalog.

For example, TypeScript assignments use the TypeScript agent's skill alongside
the development team's programming documents.

### Pinned installation

The ignored library is copied from `cortex/` in
[meta-cortex](https://github.com/ai-ai-ai-ai-ai-ai-ai/meta-cortex) at release
`v0.4.0` (commit `22584b837a16b531b8206f8e9d2809ec7b36d0a6`).
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

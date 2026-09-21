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
- **Upstream catalogs:** `.meta-cortex/agents/teams/`.
- **Project catalog:** `.cortex/gizmo-prime/team-gizmo/role-catalog.md`.
- **Configuration:** `.meta-cortex/meta-cortex.toml`.
- **Composition:** `.meta-cortex/skill-composition.md`.
- **Project context:** the root contract and selected Nook team authorities.

These wrappers select the upstream role behavior and the Nook context. Keep
Nook-specific mappings in the project catalog and generic mappings in upstream
catalogs.

### Pinned installation

The ignored library is copied from `cortex/` in
[meta-cortex](https://github.com/ai-ai-ai-ai-ai-ai-ai/meta-cortex) at commit
`d31a48a331cf01363816435d8bde9a2b9881e71b`. Its Apache-2.0 license is copied to
`.meta-cortex/LICENSE`.

The library is absent from Nook clones and pull requests. Install this exact
commit for local development and for CI stages that resolve Meta-Cortex links.
Keep the installed directory untracked and copy the upstream configuration
unchanged.

For a fresh checkout, copy the pinned `cortex/` directory and `LICENSE` into
`.meta-cortex/`. This checkout uses a local source installation; do not run
`meta-cortex init` over it.

### Updating the pinned installation

1. Select and record the new upstream commit in this document.
2. Replace the ignored `.meta-cortex/` library and license from that commit.
3. Review upstream path changes and update the thin wrapper and catalog mappings.
4. Keep the upstream configuration unchanged during development and CI install.
5. Run the Nook-authorized checks for the updated integration.

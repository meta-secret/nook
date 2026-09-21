# Meta-Cortex Integration

## Required actions

### Authority and roots

Use `.meta-cortex` as the library root and the Nook checkout as the project root.
Read the Nook circuit breaker before other Cortex documents.
Then apply upstream roles and skill composition with Nook's product context.
Nook owns product architecture, security boundaries, delivery stages, and tooling.
Meta-Cortex owns generic role behavior and language practices.
When old local prose repeats a migrated generic rule, the upstream rule wins.
The circuit breaker still governs trusted internal coordination.

**Prohibited:** copy an upstream Rust practice into a new Nook skill.

**Preferred:** select the upstream practice and supply the relevant Nook vault
specification separately.

### Routing during coexistence

The host loads the upstream entry point and launches Nook's Prime wrapper using
upstream configuration. Pass these resolved locations in its assignment:

- **Prime role:** `.cortex/gizmo-prime/AGENTS.md`.
- **Team Gizmo role:** `.cortex/gizmo-prime/team-gizmo/AGENTS.md`.
- **Upstream catalogs:** `.meta-cortex/agents/teams/`.
- **Project catalog:** `.cortex/gizmo-prime/team-gizmo/role-catalog.md`.
- **Configuration:** `.meta-cortex/meta-cortex.toml`.
- **Composition:** `.meta-cortex/skill-composition.md`.
- **Project context:** the root contract and selected Nook team authorities.

Prime launches one Team Gizmo. That coordinator applies the upstream catalogs
and Nook adapters. Old per-team Gizmo names identify contexts of this coordinator.
They do not create six parallel coordinators or an additional Feature Gizmo.
Old leaf paths remain bounded project specializations of upstream roles.

**Prohibited:** launch both the upstream Rust developer and a native Rust Core
Developer to implement the same scope.

**Preferred:** launch the Rust developer through its Nook wrapper, with the
portable-domain or Auth2 scope supplied as context.

### User-directed execution

Carry explicit user limits through every assignment. A request for direct work
without agents, checks, or publication overrides normal delegation and delivery
for that task. Apply technical policies directly and stop at the requested result.
This is explicit user direction, not a fallback when a required tool fails.

**Prohibited:** launch Gizmo because a migration document mentions delegation
when the user explicitly requested no agents.

**Preferred:** make the authorized migration directly and report that checks
and publication were not performed.

### Pipeline boundary

- Nook's feature-delivery contract remains the delivery authority.
- Upstream validation guidance selects the required evidence.
- Nook determines its execution stage.
- A skill's example command does not authorize local validation or deployment.
- The PR Lifecycle Agent remains a project-specific role under Team Gizmo.

Loom's team keys remain project-context identifiers during coexistence.
Its legacy agent-workflow runtime is not the Meta-Cortex launcher. New missions
launch through the active host using the upstream configuration. Do not use the
legacy runtime's fixed model profiles as an alternative launch configuration.
Loom continues to provide executable skills, context resolution, and audits.

**Prohibited:** run a local Rust suite solely because an upstream skill lists it.

**Preferred:** author the required regression and supply its command for the
Nook-authorized validation stage, unless the user specifies a different stage.

## Prohibited actions

- Do not fork upstream roles or introduce duplicate model settings in wrappers.
- Do not replace Nook security architecture with generic security examples.
- Do not replace an upstream placeholder with an assumed implementation.
- Do not interpret a generic rule as permission to move Rust domain logic into UI code.

## Dependency maintenance

The locally installed, Git-ignored library comes from `cortex/` in
[meta-cortex](https://github.com/ai-ai-ai-ai-ai-ai-ai/meta-cortex), commit
`d31a48a331cf01363816435d8bde9a2b9881e71b`.
Its Apache-2.0 license is included in `.meta-cortex/LICENSE`.
The Nook team-agent configuration override sets `model = "gpt-5.6-luna"` and
`reasoning_effort = "xhigh"`. Wrappers must not duplicate model or reasoning
settings.
The library is not included in Nook clones or pull requests. Install it before
using the agent entry point or running audits that resolve its local links.
CI environments running those audits need the same dependency installed.

For a fresh checkout, obtain the upstream commit above and copy its `cortex/`
directory to Nook's `.meta-cortex/`. Copy the upstream license into that directory
and apply the documented team-agent model and reasoning override. Keep that
installation untracked.

For an update:

1. Select and record an upstream commit.
2. Replace the local `cortex/` files and license from that commit.
3. Reapply the documented configuration override.
4. Update this provenance and the wrapper mappings for changed upstream paths.
5. Run authorized checks in the owning delivery stage.

Upstream initialization does not overwrite modified installations. This checkout
uses a local source installation, so use this replacement procedure rather than running
`meta-cortex init` over it.

**Prohibited:** silently replace the library from a moving branch during CI.

**Preferred:** review a pinned library update alongside affected Nook wrappers.

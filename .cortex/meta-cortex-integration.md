# Meta-Cortex Integration

## Required actions

### Required bootstrap

Meta-Cortex is a required development tool. Before normal repository work,
verify that `.meta-cortex/AGENTS.md` and `.meta-cortex/meta-cortex.toml` exist in
the Nook repository root.

If the `meta-cortex` command is unavailable, install it with the official
[shell installer](https://github.com/ai-ai-ai-ai-ai-ai-ai/meta-cortex#shell-installer):

```sh
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/ai-ai-ai-ai-ai-ai-ai/meta-cortex/releases/latest/download/meta-cortex-installer.sh | sh
```

Verify that `meta-cortex --version` succeeds before initialization. The
upstream [release README](https://github.com/ai-ai-ai-ai-ai-ai-ai/meta-cortex#update-a-project)
owns the command upgrade and framework replacement procedures.

If `.meta-cortex/` is missing:

1. Run `meta-cortex init` from the Nook repository root.
   - Plain `init` is non-interactive by default. To connect Codex and update
     managed instructions, run `meta-cortex init --harness codex --instructions write`.
2. Verify that `.meta-cortex/AGENTS.md` and `.meta-cortex/meta-cortex.toml` now
   exist.

For existing and newly initialized frameworks:

1. Run `meta-cortex info`. Confirm that the installed framework version matches
   the CLI version and that Codex reports `Connected`.
   - If the versions differ, follow the replacement procedure below before
     normal repository work.
2. If a required framework entry is missing, or initialization reports
   `missing required framework entry`, stop and report the affected path.
   - Back up and move the existing `.meta-cortex/` directory out of the
     installation path. Run `meta-cortex init --harness codex --instructions
     write` again, then review and reapply configuration changes.
   - Do not treat a partial installation as available or substitute copied
     framework files.
3. Read `.meta-cortex/CIRCUIT-BREAKER.md`, then `.meta-cortex/AGENTS.md`, and
   continue through the normal Nook entry sequence.

If the command cannot be installed or initialization fails, stop all repository
work and report the exact failure. Do not plan, edit, validate, or launch agents
using a partial framework.

- **Prohibited:** continue a product change after `meta-cortex init` fails, using
  only the Nook documents or a manually copied partial framework.

- **Preferred:** install the official command, initialize the repository, verify
  both required files, load the upstream entry point, and only then begin the
  requested work.

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

Loom's typed team catalog retains Nook role names, ownership, and context paths.
It does not select launch models or reasoning effort. Read those settings from
`.meta-cortex/meta-cortex.toml` when launching an agent.

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
current task. The current agent applies integration and PR roles locally when
delivery is authorized; it does not launch those roles as subagents.

### Upstream layout

- Resolve catalogs under `.meta-cortex/teams/` and roles under each team's
  `agents/` directory. Prime and Team Gizmo belong to `gizmo-team`.
- Load shared [programming requirements](../.meta-cortex/teams/dev-team/docs/index.md)
  with the selected language skill. They replace the former common coding skill.
- Load shared [security requirements](../.meta-cortex/teams/security-team/docs/index.md)
  for product security work.
- Resolve upstream skill rule maps through `index.md`; Nook's own knowledge
  graphs retain their existing names.
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

### Installed framework lifecycle

The Meta-Cortex command owns framework installation in `.meta-cortex/`. Keep
that directory untracked. Do not replace initialization with a manually copied
release directory.

For an existing installation, follow the upstream replacement procedure because
upgrading the command does not replace the framework. Back up and move
`.meta-cortex/` out of the installation path, run `meta-cortex init --harness
codex --instructions write`, then review and reapply configuration changes and
review upstream path changes against the thin wrapper and catalog mappings in
this document.

To move to a newer release, compare `meta-cortex --version` with the upstream
latest release. Rerun the shell installer above when the command is older.
Then replace the project framework through the preceding procedure and confirm
the CLI and framework versions with `meta-cortex info`.
Update the pinned installer release in `preflight/Dockerfile` in the same change
so hosted policy and Loom checks use the version selected for Nook.

- **Prohibited:** update the command and assume the already installed framework
  changed with it, or overwrite a locally changed framework without reviewing
  the upstream procedure.

- **Preferred:** treat command upgrades and installed-framework replacement as
  separate operations, reinitialize through the official command when required,
  and verify Nook's upstream links afterward.

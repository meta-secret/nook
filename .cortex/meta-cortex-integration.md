# Meta-Cortex Integration

## Required actions

### Required bootstrap

Meta-Cortex is a required development tool. Bootstrap it separately in every
Nook worktree before normal repository work. Git ignores the root `.meta-cortex/`
directory, so creating a worktree does not initialize its framework.

Verify that `.meta-cortex/AGENTS.md` and `.meta-cortex/meta-cortex.toml` exist
in the consuming worktree. Use that worktree's absolute filesystem path in each
YAML request.

Initialize a new worktree when `.meta-cortex/` is absent. Treat an existing
directory with either required file missing as a partial installation and use
the replacement procedure below before repository work.

If the `meta-cortex` command is unavailable, install it with the official
[v0.7.0 shell installer](https://github.com/ai-ai-ai-ai-ai-ai-ai/meta-cortex/releases/download/v0.7.0/meta-cortex-installer.sh):

```sh
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/ai-ai-ai-ai-ai-ai-ai/meta-cortex/releases/download/v0.7.0/meta-cortex-installer.sh | sh
```

Verify that `meta-cortex --version` reports `0.7.0`. If a different version is
installed, install the selected v0.7.0 release above. Use `meta-cortex list` to
inspect the supported request schema and canonical YAML examples. The upstream
[v0.7.0 release notes](https://github.com/ai-ai-ai-ai-ai-ai-ai/meta-cortex/releases/tag/v0.7.0)
and [project update procedure](https://github.com/ai-ai-ai-ai-ai-ai-ai/meta-cortex#update-a-project)
own the CLI upgrade and framework replacement procedures.

If `.meta-cortex/` is missing:

1. From the consuming worktree, run the supported `Framework / Initialize`
   request. Replace the absolute path below with that worktree's path.

   ```sh
   meta-cortex run --request - <<'REQUEST'
   version: 1
   project: /absolute/path/to/this/Nook/worktree
   operation:
     group: Framework
     command:
       name: Initialize
       arguments:
         harness: codex
         instructions: write
   REQUEST
   ```

2. Review the generated `.meta-cortex/meta-cortex.toml` and reapply the
   consuming project's required configuration values. Session answers do not
   belong in this file.
3. Verify that `.meta-cortex/AGENTS.md` and `.meta-cortex/meta-cortex.toml` now
   exist.

For existing and newly initialized frameworks:

1. Run the supported `Framework / Info` request with the same absolute worktree
   path.

   ```sh
   meta-cortex run --request - <<'REQUEST'
   version: 1
   project: /absolute/path/to/this/Nook/worktree
   operation:
     group: Framework
     command:
       name: Info
       arguments: {}
   REQUEST
   ```

2. Confirm that `cli_version` and `framework_version` both report `0.7.0` and
   match, and that the Codex integration reports `Connected` in the response.
   - If the versions differ, follow the replacement procedure below before
     normal repository work.
3. If a required framework entry is missing, or initialization reports
   `missing required framework entry`, stop and report the affected path.
   - Back up and move the existing `.meta-cortex/` directory out of the
     installation path. Run the `Framework / Initialize` request again, then
     review and reapply the consuming project's configuration values.
   - Do not treat a partial installation as available or substitute copied
     framework files.
4. After verification succeeds, read `.meta-cortex/CIRCUIT-BREAKER.md`, then
   `.meta-cortex/AGENTS.md`, and continue through the normal Nook entry sequence.

- **Prohibited:** call the retired direct CLI operations.
- **Preferred:** discover requests with `meta-cortex list`, then run the typed
  `Framework / Initialize` and `Framework / Info` YAML operations.
- **Prohibited:** give a request a worktree-relative `project` path.
- **Preferred:** use the current worktree's absolute path in every YAML request.

If the command cannot be installed, initialization fails, or `Framework / Info`
cannot verify the framework, stop all repository work and report the exact
failure or affected path. Do not plan, edit, validate, or launch agents using a
partial framework.

- **Prohibited:** continue repository work after installation or initialization
  fails, using only the Nook documents or a manually copied partial framework.

- **Preferred:** install the official v0.7.0 command, initialize this worktree,
  verify its required files and Info response, then load the upstream entry point.

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
The upstream [form](../.meta-cortex/development.yaml) defines both session
choices. Resolve `development.mode` and `development.delivery` through that
workflow before planning or launching agents. Validate explicit choices already
supplied in the current conversation; do not ask again for inherited choices.

- **`development.mode`**
  - `single_agent`: use the current agent and conversation.
  - `multi_agent`: use Nook's Gizmo workflow.
- **`development.delivery`**
  - `create_pr`: commit and push the validated feature, then create or update its PR.
  - `local_only`: keep the work local without pushing or creating a PR.

The upstream form marks `create_pr` as recommended. A recommendation or
preselected option is not a submitted answer. Honor the explicit session choice.

- In `single_agent` mode, the current agent loads the relevant roles and performs
  the work. Nook's coordinator, worker, integration-agent, and PR Lifecycle routing
  requirements apply only in `multi_agent` mode.
- In `multi_agent` mode, use Nook's Team Gizmo assignments and delivery routing.
- Preserve Nook's product boundaries, authorization, validation stages, and the
  user's stopping point in both modes.
- Carry both choices through the current conversation, continuations, and every
  assignment or handoff, through delivery reporting. A delegated agent inherits
  them and does not start a new configuration flow.
- If the user changes one choice, pass the change to active agents and retain the
  other choice. Do not leave delegated agents running when changing to
  `single_agent` mode.
- Keep session answers out of repository files and `.meta-cortex/` configuration.

- **Prohibited:** persist `development.mode` or `development.delivery` as
  repository defaults, or ask an assigned worker to choose values already
  supplied by the current conversation.
- **Preferred:** collect both values through the upstream form for a new
  conversation, carry them through each handoff and delivery report, and keep
  them out of repository files and upstream configuration.

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
that ignored directory untracked. Every new consuming worktree needs its own
official `Framework / Initialize` operation. Do not copy the directory from
another worktree or replace initialization with a manually copied release tree.

For an existing installation, follow the upstream replacement procedure because
upgrading the command does not replace the framework. Back up and move
`.meta-cortex/` out of the installation path, run the `Framework / Initialize`
request above, then review and reapply the consuming project's durable
configuration values from the backup's `meta-cortex.toml`. Verify that the
required files exist and rerun `Framework / Info`; confirm matching CLI and
framework versions and Codex `Connected` before resuming repository work.
Review upstream path changes against the thin wrapper and catalog mappings in
this document. Do not copy framework files from the backup.

To move to a newer release, compare `meta-cortex --version` with the selected
upstream release. Install that CLI release when the command is older. Then
replace the project framework through the preceding procedure and verify the
CLI and framework versions with `Framework / Info`.
Update the pinned installer release in `preflight/Dockerfile` in the same change
so hosted policy and Loom checks use the version selected for Nook.

- **Prohibited:** update the command and assume the already installed framework
  changed with it, or overwrite a locally changed framework without reviewing
  the upstream procedure.

- **Preferred:** treat command upgrades and installed-framework replacement as
  separate operations, reinitialize through the official typed YAML operation
  when required, and verify Nook's upstream links afterward.

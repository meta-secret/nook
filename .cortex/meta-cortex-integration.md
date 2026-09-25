# Meta-Cortex Integration

## Required actions

### Required bootstrap

Nook pins Meta-Cortex v0.9.1. Each consuming worktree has its own ignored
`.meta-cortex/` installation. Creating a Git worktree does not install that
framework. Never copy `.meta-cortex/` or a ledger database from another
checkout. Use the consuming worktree's absolute path in every YAML request.

Resolve the CLI before normal repository work. `command -v meta-cortex` must
select the intended executable, and `meta-cortex --version` must report
`0.9.1`. If the command is missing or resolves to another version, install the
Nook-pinned [v0.9.1 release](https://github.com/ai-ai-ai-ai-ai-ai-ai/meta-cortex/releases/tag/v0.9.1)
and correct command resolution. Run `meta-cortex list` to inspect supported
typed requests. The CLI upgrade and installed framework replacement are
separate operations; use the upstream [v0.9.1 release notes](https://github.com/ai-ai-ai-ai-ai-ai-ai/meta-cortex/releases/tag/v0.9.1)
and [project update procedure](https://github.com/ai-ai-ai-ai-ai-ai-ai/meta-cortex#update-a-project).

```sh
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/ai-ai-ai-ai-ai-ai-ai/meta-cortex/releases/download/v0.9.1/meta-cortex-installer.sh | sh
```

Before using the framework, confirm that `.meta-cortex/AGENTS.md` and
`.meta-cortex/meta-cortex.toml` exist in the consuming worktree.

Initialize a worktree only when `.meta-cortex/` is absent. Keep the
initializer's framework-tool defaults. Set `instructions: skip` because the
tracked root `AGENTS.md` owns Nook's harness instructions; initialization must
leave those instructions unchanged.

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
      instructions: skip
REQUEST
```

Do not initialize over an existing installation. If either required framework
file is missing, initialization fails, or the versions do not match, follow
the upstream replacement procedure. Review and reapply local configuration
changes as needed. Stop repository work until installation succeeds.

Verify the installation with `Framework / Info` using the same absolute
project path:

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

`Framework / Info` reports schema version 5. Continue only when
`schema_version` is `5`, `cli_version` and `framework_version` both report
`0.9.1`, and the Codex integration reports `Connected`. Then read the installed
[Meta-Cortex circuit breaker](../.meta-cortex/CIRCUIT-BREAKER.md), followed by
its [entry point](../.meta-cortex/AGENTS.md). If the CLI cannot be installed,
initialization fails, or Info cannot verify the framework, stop and report the
exact failure or affected path.

- **Prohibited:** Treat a fresh Git worktree as framework-ready or let
  initialization rewrite Nook's tracked root instructions.
- **Preferred:** Initialize the worktree separately with an absolute project
  path and `instructions: skip`, then verify the pinned CLI and framework.

### Configuration and ownership

Keep `.meta-cortex/meta-cortex.toml` in the ignored worktree installation.
Meta-Cortex owns generic role configuration and launch procedure through its
[agent configuration rules](../.meta-cortex/teams/gizmo-team/docs/agent-configuration.md).
Read the active worktree's configuration and pass each role's configured model
and reasoning effort. Do not copy role settings from a canonical checkout or
maintain Nook-specific overrides. Meta-Cortex v0.9.1 configures only model and
reasoning effort for each role. Its configuration has no execution `mode` or
`service_tier` field. Leave subagent speed selection to the host session.
Resolve the separate `development.mode` and `development.delivery` session
choices through the upstream
[development workflow](../.meta-cortex/AGENTS.md#development-mode). They select
the coordination and delivery paths; they are not framework configuration or
launch fields. Apply Nook's assignment and delivery constraints to either
coordination path.

Meta-Cortex owns generic roles, skills, programming requirements, and authoring
practices. Nook owns product architecture, product security, delivery
constraints, and Nook-specific tooling. The root [Nook routing contract](AGENTS.md)
and selected [team context](teams/ai/knowledge-graph.md) route those project
requirements.

Nook's Prime and Team Gizmo documents adapt the upstream roles. The Nook
[agent catalog](gizmo-prime/team-gizmo/role-catalog.md) maps project scopes to
upstream roles and preserves the Nook role identities used by Loom. Upstream
role and skill authority remains in the installed Meta-Cortex catalogs.

#### Cortex authoring

For Cortex work, use the upstream [Tech Writer role](../.meta-cortex/teams/ai-team/agents/tech-writer/AGENTS.md)
and [Context Engineering skill](../.meta-cortex/teams/ai-team/agents/tech-writer/skills/context-engineering/SKILL.md).
Nook's AI graph points to project-owned audit cards. Those cards own Nook
tooling and graph topology; they do not redefine generic authoring rules.

- **Prohibited:** Copy model or reasoning settings from another checkout, or
  restate generic authoring rules in a Nook audit card.
- **Preferred:** Use the active worktree configuration and link Nook-specific
  tooling to the owning upstream authoring rules.

### Release pin

Nook pins the CLI release at v0.9.1. `preflight/Dockerfile` pins the v0.9.1
installer URL. `.github/workflows/repository-policy.yml` and
`.task/ci-workflows.yml` pin the upstream library commit
`23f8683e0bedf4a258fa3237f2fa48f48bd388a7`. `preflight/tests/loom_contracts.rs`
asserts the expected `v0.9.1` installer release. Future upgrades update this
contract, each source pin, and their owning policy and test contracts together.

- **Prohibited:** Update only the installer URL or only the pinned library
  commit.
- **Preferred:** Update the version contract, every source pin, and the
  corresponding policy and test assertions in the same change.

### Historical v0.8 repository identity and ledger migration

In v0.8, Meta-Cortex stored feature ledgers outside Git at
`${META_CORTEX_HOME:-$HOME/.meta-cortex}/<repository-id>/features`. In v0.8,
framework initialization created or read the repository UUID at
`.meta-cortex/repository-id` in the actual Git main checkout. Linked worktrees
reuse that UUID through their shared Git common directory.

Preserve the exact UUID when replacing the main checkout's framework. Restore
it to the new main checkout's `.meta-cortex/repository-id` before initializing
features or linked worktrees, then verify that it selects the existing data
directory. Do not reuse an identity across unrelated clones.

The v0.8 upgrade does not relocate legacy ledgers from the Git common
directory's `meta-cortex/features` folder. Before migrating them, stop all
ledger writers and confirm that no files are open under the legacy directory.
Copy each database with its `-wal`, `-shm`, or `-tshm` sidecars into
`${META_CORTEX_HOME:-$HOME/.meta-cortex}/<repository-id>/features`. Keep the
legacy copies until v0.8 `Feature / List`, `Feature / Status`, and
`Task / History` confirm that feature IDs, task status, and history remain
readable from the new location. Do not split or copy a live database.

- **Prohibited:** Reuse a repository UUID in an unrelated clone or copy a live
  ledger without its sidecars.
- **Preferred:** Preserve the existing identity, stop writers, copy each
  database with its sidecars, and retain the source until v0.8 history checks
  confirm the migration.

## Prohibited actions

- Do not initialize over an existing `.meta-cortex/` installation.
- Do not copy `.meta-cortex/` or repository identity from another checkout.
- Do not treat a CLI upgrade as an installed-framework replacement.
- Do not continue repository work after initialization or framework verification
  fails.
- Do not split, copy, or migrate a live ledger database.

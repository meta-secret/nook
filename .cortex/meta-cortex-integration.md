# Meta-Cortex Integration

## Required actions

### Required bootstrap

Nook uses Meta-Cortex 0.8.0. Each consuming worktree has its own ignored
`.meta-cortex/` installation. A Git worktree does not create that installation.
Never copy the directory from another checkout.

Before normal repository work, confirm that the active worktree contains
`.meta-cortex/AGENTS.md` and `.meta-cortex/meta-cortex.toml`. Use the worktree's
absolute path in every request.

If the `meta-cortex` command is unavailable, install the Nook-pinned release:

```sh
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/ai-ai-ai-ai-ai-ai-ai/meta-cortex/releases/download/v0.8.0/meta-cortex-installer.sh | sh
```

If `.meta-cortex/` is absent, initialize it through the typed operation. Keep
the initializer's defaults for framework tools. `instructions: skip` preserves
Nook's tracked root instructions.

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

Do not initialize over an existing installation. If either required file is
missing, `Framework / Info` reports mismatched versions or either version is
not `0.8.0`, or initialization fails, follow the upstream
[framework update procedure](https://github.com/ai-ai-ai-ai-ai-ai-ai/meta-cortex#update-a-project)
and stop repository work until the installation is complete. Updating the CLI
alone does not replace the installed framework.

Verify the installation with `Framework / Info` using the same absolute project
path:

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

Continue only when `cli_version` and `framework_version` both report `0.8.0`
and the Codex integration reports `Connected`. Then read the installed
[Meta-Cortex circuit breaker](../.meta-cortex/CIRCUIT-BREAKER.md), followed by
its [entry point](../.meta-cortex/AGENTS.md).

Keep the initializer-created `.meta-cortex/meta-cortex.toml` ignored and intact.
Meta-Cortex owns generic configuration and launch procedure through its
[agent configuration rules](../.meta-cortex/teams/gizmo-team/docs/agent-configuration.md).
Nook does not copy settings from another checkout or maintain per-role overrides.

### Release pin

The Nook version pin is 0.8.0. `preflight/Dockerfile` pins the installer URL;
`.github/workflows/repository-policy.yml` and `.task/ci-workflows.yml` pin the
release commit `9169b9a72a2871ba99fbe2d9f05174310480fe11`; and
`preflight/tests/loom_contracts.rs` asserts the expected `v0.8.0` installer
release. Future upgrades update this integration contract, each source pin, and
their owning policy/test contracts together.

## Project composition

Meta-Cortex owns generic roles, skills, programming requirements, and authoring
practices. Nook owns product architecture, product security, delivery
constraints, and Nook-only tooling. The root [Nook routing contract](AGENTS.md)
and its selected [team context](teams/ai/knowledge-graph.md) route those
project requirements.

Nook's Prime and Team Gizmo documents adapt their upstream roles. The Nook
[agent catalog](gizmo-prime/team-gizmo/role-catalog.md) maps project scopes to
upstream roles and preserves the existing Nook role identities used by Loom.
Generic role and skill authority remains in the installed Meta-Cortex catalogs.

For Cortex work, use the upstream [Tech Writer role](../.meta-cortex/teams/ai-team/agents/tech-writer/AGENTS.md) and
[Context Engineering skill](../.meta-cortex/teams/ai-team/agents/tech-writer/skills/context-engineering/SKILL.md).
Nook's AI graph points to the additional project-owned audit cards. Those cards
own Nook tooling and graph topology; they do not redefine generic authoring
rules.

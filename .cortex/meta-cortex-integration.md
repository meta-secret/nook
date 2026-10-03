# Meta-Cortex Integration

## Required actions

### Required bootstrap

Nook pins Meta-Cortex v0.12.3. Each consuming worktree has its own ignored
`.meta-cortex/` installation. Creating a Git worktree does not install that
framework. Never copy `.meta-cortex/` or a ledger database from another
checkout. Use the consuming worktree's absolute path in every YAML request.

Resolve the CLI before normal repository work. `command -v meta-cortex` must
select the intended executable, and `meta-cortex --version` must report
`0.12.3`. If the command is missing or resolves to another version, install the
Nook-pinned [v0.12.3 release](https://github.com/ai-ai-ai-ai-ai-ai-ai/meta-cortex/releases/tag/v0.12.3)
and correct command resolution. Run `meta-cortex list` to inspect supported
typed requests. The CLI upgrade and installed framework replacement are
separate operations; use the upstream [v0.12.3 release notes](https://github.com/ai-ai-ai-ai-ai-ai-ai/meta-cortex/releases/tag/v0.12.3)
and [pinned project update procedure](https://github.com/ai-ai-ai-ai-ai-ai-ai/meta-cortex/blob/76d81fe590a915b1814ad3bd82e535d3245649b9/README.md#update-a-project).

```sh
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/ai-ai-ai-ai-ai-ai-ai/meta-cortex/releases/download/v0.12.3/meta-cortex-installer.sh | sh
```

On Windows x86-64, use the native PowerShell installer:

```powershell
irm https://github.com/ai-ai-ai-ai-ai-ai-ai/meta-cortex/releases/download/v0.12.3/meta-cortex-installer.ps1 | iex
Get-Command meta-cortex
meta-cortex --version
meta-cortex list
```

Windows initialization uses native tools and requires neither WSL nor Git Bash.
Use `Get-Command meta-cortex` instead of `command -v` in PowerShell.
Both shells must resolve the pinned CLI before proceeding.

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

PowerShell uses the same typed request with an absolute Git project path.
A single-quoted here-string preserves the YAML literally:

```powershell
@'
version: 1
project: 'C:\projects\nook'
operation:
  group: Framework
  command:
    name: Initialize
    arguments:
      harness: codex
      instructions: skip
'@ | meta-cortex run --request -
```

Do not initialize over an existing installation. If either required framework
file is missing, initialization fails, or the versions do not match, follow
the upstream replacement procedure. Back up or move the old installation
before Initialize.
Reapply the prior role models and reasoning efforts to the newly generated
configuration. Preserve the repository identity as described below. Do not
overwrite the new configuration with the old file.
Stop repository work until installation succeeds.

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

In PowerShell, pipe the Info request through the same single-quoted here-string:

```powershell
@'
version: 1
project: 'C:\projects\nook'
operation:
  group: Framework
  command:
    name: Info
    arguments: {}
'@ | meta-cortex run --request -
```

`Framework / Info` reports schema version 5. Continue only when
`schema_version` is `5`, `cli_version` and `framework_version` both report
`0.12.3`, and the Codex integration reports `Connected`. Then read the installed
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
and `reasoning_effort`. Preserve those configured values during upgrades. Do not
copy role settings from a canonical checkout or maintain Nook-specific
overrides. Meta-Cortex v0.12.3 configures model and reasoning effort for
each role. Its `[host]` section also declares `required_total_agents`.
Preserve the newly generated configuration shape. Set the host requirement to
Nook's configured total of `20` and follow upstream
[host capacity preflight](../.meta-cortex/teams/gizmo-team/docs/agent-configuration.md#check-host-capacity).
This configured requirement is checked against current host evidence; it is not
a fixed host concurrency limit.
Its configuration has no `mode` or `service_tier` fields.
Execution speed is selected by host-native settings. Leave subagent speed selection to
the host session. Keep Nook's session `development.mode` (`single_agent` or
`multi_agent`) separate from execution speed and reasoning effort. Resolve the
separate `development.mode` and `development.delivery` session choices through
the upstream [development-mode workflow](../.meta-cortex/AGENTS.md#development-mode).
They select the coordination and delivery paths; they are not framework
configuration or launch fields. Apply Nook's assignment and delivery
constraints to either coordination path.

When upgrading an older configuration, retain the new `[host]` section.
Reapply each role's prior `model` and `reasoning_effort` values.
Remove obsolete per-role `mode` and `service_tier` fields.
For framework scripts, use upstream [execution configuration](../.meta-cortex/README.md#execution-configuration).
In PowerShell, configure the managed native tools:

```powershell
$metaCortexHome = if ($env:META_CORTEX_HOME) { $env:META_CORTEX_HOME } else { Join-Path $HOME '.meta-cortex' }
$env:PATH = "$metaCortexHome\mise\bin;$metaCortexHome\bun\bin;$metaCortexHome\vale\bin;$env:PATH"
```

**Prohibited:** replace the new configuration with a v0.11 file, losing its host requirement.

**Required:** apply the retained role values to the new configuration and verify Info.

#### Ownership boundaries

Meta-Cortex owns generic roles, skills, programming requirements, and authoring
practices. Nook owns product architecture, product security, delivery
constraints, and Nook-specific tooling. The root [Nook routing contract](AGENTS.md)
and selected [team context](teams/ai/index.md) route those project
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

The [v0.12.3 release](https://github.com/ai-ai-ai-ai-ai-ai-ai/meta-cortex/releases/tag/v0.12.3)
identifies upstream commit
[`76d81fe590a915b1814ad3bd82e535d3245649b9`](https://github.com/ai-ai-ai-ai-ai-ai-ai/meta-cortex/commit/76d81fe590a915b1814ad3bd82e535d3245649b9).
Use that release's installer and framework source together.

The Nook CLI release pin is 0.12.3. `preflight/Dockerfile` pins the official
v0.12.3 installer URL. `.github/workflows/repository-policy.yml` and
`.task/ci-workflows.yml` pin the upstream library commit
`76d81fe590a915b1814ad3bd82e535d3245649b9`. `preflight/tests/loom_contracts.rs`
asserts the expected `v0.12.3` installer release. Future upgrades update this
contract, each source pin, and their owning policy and test contracts together.

- **Prohibited:** Update only the installer URL or only the pinned library
  commit.
- **Preferred:** Update the version contract, every source pin, and the
  corresponding policy and test assertions in the same change.

### Repository identity and ledger migration

Follow the upstream [ledger storage and ownership](../.meta-cortex/teams/gizmo-team/docs/agent-ledger.md#storage-and-ownership)
and [storage migration and supported readers](../.meta-cortex/teams/gizmo-team/docs/agent-ledger.md#storage-migration-and-supported-readers)
for the current database and record contracts. Nook does not maintain a second
copy of those formats.

- Stop all older ledger writers before upgrading.
- Preserve a consistent database backup with its engine-managed sidecars.
- Preserve `.meta-cortex/repository-id` from the actual Git main checkout.
- Restore that exact UUID to the replacement main-checkout installation before
  initializing features or linked worktrees.
- Verify that the UUID selects the existing shared repository data directory.
- Keep installation backups until the replacement and retained configuration
  are verified.
- Never reuse the UUID in an unrelated clone.
- Do not manually copy, reset, or delete legacy databases, records, or sidecars.
- Do not resume older writers against retained backups.

**Prohibited:** replace the main-checkout framework and initialize a new feature
before restoring its repository UUID.

**Required:** retain the UUID and existing shared ledger, initialize the new
framework, then verify the repository data directory before feature work.

## Prohibited actions

- Do not initialize over an existing `.meta-cortex/` installation.
- Do not copy `.meta-cortex/` or repository identity from another checkout.
- Do not treat a CLI upgrade as an installed-framework replacement.
- Do not continue repository work after initialization or framework verification
  fails.
- Do not upgrade while old ledger writers are active.
- Do not manually copy, reset, or delete legacy databases, records, or sidecars.

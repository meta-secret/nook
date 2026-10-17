# Meta-Cortex Integration

## Required actions

### Required bootstrap

Nook pins Meta-Cortex `0.20.0` in [`.meta-cortex-version`](../.meta-cortex-version).
Use the checked-in [POSIX wrapper](../meta-cortexw) or
[PowerShell wrapper](../meta-cortexw.ps1) from the consuming worktree.
Identify the consuming project root and installed library root separately.
Creating a Git worktree does not install the framework. An assignment may use
a verified library from another worktree only when its version matches the
consuming worktree's pin. Never copy the library or a ledger database into the
task worktree.
Use the consuming project's or assigned worktree's absolute path in every YAML
request. Run framework scripts from the supplied library root.

Verify the pinned executable before normal repository work. The commands below
run from the consuming worktree's root. Install the Linux prerequisites below
before either command on Linux. The version must match its committed pin.
`list` supplies the supported typed requests.

```sh
./meta-cortexw --version
./meta-cortexw list
```

On Windows x86-64, use the native PowerShell wrapper:

```powershell
.\meta-cortexw.ps1 --version
.\meta-cortexw.ps1 list
```

The upstream [wrapper contract](https://github.com/ai-ai-ai-ai-ai-ai-ai/meta-cortex/blob/2e88d51d535bb56e25fc6e545c3ed14306019833/README.md#run-the-pinned-command)
owns installation, cache paths, prerequisites, and failure behavior. The wrapper
bootstraps the exact pin into a separate cache directory per version.
A global command is optional and does not select Nook's executable.
On Linux, install the pinned release's [native runtime prerequisites](https://github.com/ai-ai-ai-ai-ai-ai-ai/meta-cortex/blob/2e88d51d535bb56e25fc6e545c3ed14306019833/CONTRIBUTING.md#native-dashboard-prerequisites)
before either command. GTK 3 and WebKitGTK 4.1 are required even for headless use.

- **Prohibited:** invoke `./meta-cortexw list` on Linux before installing its native
  runtime prerequisites because the command is headless.
- **Required:** install the pinned GTK 3 and WebKitGTK 4.1 runtime prerequisites
  before invoking `./meta-cortexw list` on Linux.

Windows initialization uses native tools and requires neither WSL nor Git Bash.
Both shells must verify the pinned CLI before proceeding. Stop on a wrapper
bootstrap failure. Report its diagnostic without substituting a global command.

Before using the framework, confirm that `AGENTS.md` and `meta-cortex.toml`
exist in the resolved library root. For initial project setup, that root is
the project's ignored `.meta-cortex/` directory.

Initialize a project installation only when `.meta-cortex/` is absent. A task
worktree with a supplied verified library does not need another installation.
Keep the initializer's framework-tool defaults. Set `instructions: skip` because the
tracked root `AGENTS.md` and `CLAUDE.md` own Nook's harness instructions;
initialization must leave those instructions unchanged.

```sh
./meta-cortexw run --request - <<'REQUEST'
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
'@ | .\meta-cortexw.ps1 run --request -
```

Do not initialize over an existing installation. If either required framework
file is missing, initialization fails, or the versions do not match, follow
the upstream [replacement procedure](https://github.com/ai-ai-ai-ai-ai-ai-ai/meta-cortex/blob/2e88d51d535bb56e25fc6e545c3ed14306019833/README.md#replace-an-installed-framework).
Back up or move the old installation before Initialize.
Set `host.max_total_agents` in the newly generated configuration to Nook's
chosen ceiling of `20`; the former `required_total_agents` key is rejected.
Remove the obsolete role model and reasoning-effort sections.
Preserve the repository identity as described below. Do not overwrite the new
configuration with the old file.
Stop repository work until installation succeeds.

Verify the installation with `Framework / Info` using the same absolute
project path:

```sh
./meta-cortexw run --request - <<'REQUEST'
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
'@ | .\meta-cortexw.ps1 run --request -
```

`Framework / Info` must verify all of these conditions before work continues:

- `schema_version` is `7`.
- `cli_version` and `framework_version` both match the consuming worktree's pin
  (`0.20.0` here).
- The Codex and Claude integrations each report `Connected` for the project
  owning the installation.
- `configuration.host.max_total_agents` is `20`.
- `model_selection` is `PerAssignment`.

The tracked `AGENTS.md` and `CLAUDE.md` each end their managed
`meta-cortex: instructions` block with its closing `---` rule. Info reports
`Conflict` for an unterminated block.

Verify Info against that project when a task uses its shared library.
Then read the installed [Meta-Cortex circuit breaker](../.meta-cortex/CIRCUIT-BREAKER.md), followed by
its [entry point](../.meta-cortex/AGENTS.md). If the CLI cannot be installed,
initialization fails, or Info cannot verify the framework, stop and report the
exact failure or affected path.

Run the upstream [library-root check](../.meta-cortex/AGENTS.md#project-context)
from the resolved library root before framework commands. Use its managed Bun
PATH in each new shell. Stop if that check fails.

- **Prohibited:** Treat a fresh Git worktree as framework-ready or let
  initialization rewrite Nook's tracked root instructions.
- **Required:** For initial setup, initialize the project with an absolute path
  and `instructions: skip`. Then verify the pinned CLI and framework. Confirm
  that the Codex and Claude integrations report `Connected`. For an assigned
  task worktree, carry the verified library root separately.

#### Different versions in simultaneous worktrees

Each worktree uses its checked-out wrapper and exact version pin. Follow the
upstream [pin upgrade procedure](https://github.com/ai-ai-ai-ai-ai-ai-ai/meta-cortex/blob/2e88d51d535bb56e25fc6e545c3ed14306019833/README.md#upgrade-the-project-pin)
when choosing a different published release. A pin change selects the CLI.
It leaves installed frameworks unchanged.

1. Verify the CLI through that worktree's wrapper.
2. Select a library that matches that pin. If other worktrees still need the
   shared library's version, keep that library unchanged.
3. Initialize an absent `.meta-cortex/` in the consuming worktree with its
   wrapper and `instructions: skip`. For an existing installation, use the
   supported replacement procedure above.
4. Set `host.max_total_agents` to `20`. Verify Info for the project
   owning the selected library.
5. Pass that verified library root separately to every assignment. Run library
   scripts from it. Invoke the consuming worktree's wrapper for CLI requests.

The wrapper preserves the caller's working directory. From an immediate `src/`
subdirectory, `../meta-cortexw run --request ../request.yaml` addresses the
root request file. PowerShell uses
`..\meta-cortexw.ps1 run --request ..\request.yaml`. Use actual paths from deeper
directories. Every YAML `project` remains the explicit absolute consuming path.

**Prohibited:** replace a shared `0.19.0` library while another assignment uses
it, or pass it to an assignment whose wrapper pin is `0.20.0`.

**Required:** keep the older library for its existing assignments. Initialize
and verify `0.20.0` in the consuming worktree, then pass that library to its
assignments. Check [shared ledger compatibility](#repository-identity-and-ledger-migration)
before either version writes. Separate CLI caches do not isolate ledger storage.

### Configuration and ownership

Keep `meta-cortex.toml` in the resolved ignored library installation.
Meta-Cortex owns per-assignment model selection through its
[agent configuration rules](../.meta-cortex/teams/gizmo-team/docs/agent-configuration.md).
Its configuration contains only `[host]` with `max_total_agents`.
Preserve the newly generated configuration shape. Set the ceiling to Nook's
chosen `20` and follow upstream
[host capacity preflight](../.meta-cortex/teams/gizmo-team/docs/agent-configuration.md#check-host-capacity).
The ceiling bounds concurrent agents, including the host and coordinators. It
neither allocates host slots nor requires the host to offer that many;
coordinators queue assignments when slots are occupied.
Model and reasoning effort belong to each assignment under upstream selection
policy.
Execution speed is selected by host-native settings. Keep Nook's session
`development.delivery` (`create_pr` or `local_only`) separate from execution
speed and reasoning effort. Resolve it through the upstream
[delivery workflow](../.meta-cortex/AGENTS.md#development-delivery). It selects
the delivery path; it is not framework configuration or a launch field.
Development always runs through Prime and Team Gizmo. Apply Nook's assignment
and delivery constraints to every assignment.

When upgrading an older configuration, retain the new `[host]` section.
Replace a former `required_total_agents` minimum with `max_total_agents`; the
current schema rejects the old key.
Remove `[gizmo-prime]`, `[team.gizmo]`, and `[team.agent]` sections.
The current schema rejects those static role settings. Do not restore obsolete
`model`, `reasoning_effort`, `mode`, or `service_tier` fields.
For framework scripts, use upstream [execution configuration](../.meta-cortex/README.md#execution-configuration).
In PowerShell, configure the managed native tools:

```powershell
$metaCortexHome = if ($env:META_CORTEX_HOME) { $env:META_CORTEX_HOME } else { Join-Path $HOME '.meta-cortex' }
$env:PATH = "$metaCortexHome\mise\bin;$metaCortexHome\bun\bin;$metaCortexHome\vale\bin;$env:PATH"
```

**Prohibited:** restore the v0.16.0 role sections or the `required_total_agents`
key into the new configuration.

**Required:** retain `[host]` with Nook's `max_total_agents` ceiling of `20`.
Verify schema `7` and `model_selection: PerAssignment` through Info.

#### Ownership boundaries

Meta-Cortex owns generic roles, skills, programming requirements, and authoring
practices. Nook owns product architecture, product security, delivery
constraints, and Nook-specific tooling. The root [Nook routing contract](AGENTS.md)
and selected [team context](teams/ai/index.md) route those project
requirements.

Apply upstream [consuming project context](../.meta-cortex/teams/gizmo-team/docs/project-context.md)
to the repository and each affected module's ancestor directories. Load the
applicable project instructions and selected architecture, specifications, and
requirements in full before assigned work. That upstream contract owns discovery,
optional absences, required-context blockers, and refreshed assignment paths.
Keep the consuming worktree separate
from the installed library root.

- **Prohibited:** change a nested Nook module after reading only the root context.
- **Required:** inspect its ancestor scopes and load the applicable project
  context before editing that module. For example, work in `nook-app/src/`
  includes the root and `nook-app/` context before selecting the affected source
  directory's instructions. Follow the upstream
  [verifier context boundary](../.meta-cortex/teams/gizmo-team/docs/project-context.md#carry-and-refresh-assignment-context)
  for operational project context and framework practice review.

Use Meta-Cortex Prime, Team Gizmo, and specialist roles directly. Nook's
[scope routing](docs/spec/upstream-role-routing.md) supplies functional and module
requirements without maintaining project agent identities. Loom resolves Nook
context by functional team; upstream catalogs own role and skill authority.

#### Cortex authoring

For Cortex work, use the upstream [Tech Writer role](../.meta-cortex/teams/ai-team/agents/tech-writer/AGENTS.md)
and [Context Engineering skill](../.meta-cortex/teams/ai-team/agents/tech-writer/skills/context-engineering/SKILL.md).
Nook's AI graph points to project-owned audit cards. Those cards own Nook
tooling and graph topology; they do not redefine generic authoring rules.

- **Prohibited:** Restore static role settings from another checkout, or
  restate generic authoring rules in a Nook audit card.
- **Required:** Use the supplied active library's selection policy and link Nook-specific
  tooling to the owning upstream authoring rules.

### Release pin

The [v0.20.0 release](https://github.com/ai-ai-ai-ai-ai-ai-ai/meta-cortex/releases/tag/v0.20.0)
identifies upstream commit
[`2e88d51d535bb56e25fc6e545c3ed14306019833`](https://github.com/ai-ai-ai-ai-ai-ai-ai/meta-cortex/commit/2e88d51d535bb56e25fc6e545c3ed14306019833).
The checked-in launchers are the official source files from that revision.
Keep their upstream behavior. Do not maintain a Nook launcher implementation.

The Nook CLI release pin is `0.20.0` in `.meta-cortex-version`.
`preflight/Dockerfile` uses the project wrapper with that pin.
`.github/workflows/repository-policy.yml` and `.task/ci-workflows.yml` pin the
upstream library commit `2e88d51d535bb56e25fc6e545c3ed14306019833`.
`preflight/tests/loom_contracts.rs` owns the corresponding policy assertions.
Future upgrades update this contract, the exact version pin, every library
source pin, and their owning assertions together. Update launcher source from
an inspected fixed upstream revision when the launchers themselves change.

- **Prohibited:** change only `.meta-cortex-version` while CI still fetches the
  previous library source, or replace its exact version with `latest`.
- **Required:** update the pin, matching library source pins, this contract,
  and policy assertions in the same change. Verify through the project wrapper.

### Repository identity and ledger migration

Follow the upstream [ledger storage and ownership](../.meta-cortex/teams/gizmo-team/docs/ledger-storage.md#storage-and-ownership)
and [storage migration and supported readers](../.meta-cortex/teams/gizmo-team/docs/ledger-storage.md#storage-migration-and-supported-readers)
for the current database and record contracts. Nook does not maintain a second
copy of those formats.

The framework Info schema `7` describes installation verification. It is
separate from ledger database schema `6`. Release `0.20.0` writes the same
event-envelope version `2` as `0.19.0`; an unchanged database version does not
establish mixed-version compatibility. The upstream ledger protocol owns
released request and task formats, migration behavior, and supported readers.
Keep the existing per-feature database in the resolved repository data directory.

Linked worktrees share repository identity and feature ledgers even when their
CLI pins and library roots differ. Version-separated executable caches do not
isolate database schemas or make mixed-version writers safe. Before simultaneous
writers use the same feature, verify compatibility through the upstream ledger
contract for both releases. Stop older writers before any schema migration.
Do not claim mixed-version compatibility from successful wrapper bootstrap alone.

- Stop all older writers to a feature before its first newer-format write.
- Move every active participant on that feature to the current executable.
- Preserve a consistent database backup with its engine-managed sidecars.
- Preserve `.meta-cortex/repository-id` from the actual Git main checkout.
- Restore that exact UUID to the replacement main-checkout installation before
  initializing features or linked worktrees.
- Verify that the UUID selects the existing shared repository data directory.
- Keep installation backups until the replacement and retained configuration
  are verified.
- Validate storage migration on an isolated cloned ledger with older writers
  stopped before rollout. Report an atomic migration failure without rewriting
  recorded history.
- Never reuse the UUID in an unrelated clone.
- Do not manually copy, reset, or delete legacy databases, records, or sidecars.
- Do not resume older writers against retained backups.

**Prohibited:** replace the main-checkout framework and initialize a new feature
before restoring its repository UUID.

**Required:** retain the UUID and existing shared ledger, initialize the new
framework, then verify the repository data directory before feature work.
For example, upgrade the CLI and replace the library before selecting the
existing feature. Preserve its database and engine-managed sidecars together.

## Prohibited actions

- Do not initialize over an existing `.meta-cortex/` installation.
- Do not copy `.meta-cortex/` or repository identity from another checkout.
- Do not treat a CLI upgrade as an installed-framework replacement.
- Do not continue repository work after initialization or framework verification
  fails.
- Do not upgrade shared ledger storage while old ledger writers are active.
- Do not manually copy, reset, or delete legacy databases, records, or sidecars.

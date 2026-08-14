# Design Docs Index

This directory contains design specifications, architecture rationales, and core engineering beliefs.

| Document | Description | Status |
|---|---|---|
| [core-beliefs.md](core-beliefs.md) | Agent-first core operating principles | Verified |
| [agent-workflow-orchestration.md](agent-workflow-orchestration.md) | Cortex, Loom, Hive, and delivery-owner boundaries for deterministic multi-agent workflows | Architecture decision |
| [hive-isolated-agent-platform.md](hive-isolated-agent-platform.md) | Stateful k0s/Kata Hive architecture, components, trust boundaries, task DAG, Main repair delivery, caching, and Taskfile operations | Implemented |
| [identity-vault-architecture.md](identity-vault-architecture.md) | Identity management, vault independence, encrypted DEK grants, onboarding, and the shared replication-provider boundary | Architecture decision |
| [unified-vault.md](unified-vault.md) | Local-first vault model; scalar `vault_version` sync retained as historical context | Partially historical — provider sync superseded by [vault-event-log.md](vault-event-log.md) |
| [vault-session-and-lock.md](vault-session-and-lock.md) | Lock session, vault vs sync providers, multi-vault model | Verified |
| [auth-providers.md](auth-providers.md) | Login gate, `nook_auth` sync-provider credentials, OAuth origins | Verified |
| [passkey-manager.md](passkey-manager.md) | Chromium website passkey provider, ceremony boundary, sync, and threat model | Implemented |
| [secret-store-identity.md](secret-store-identity.md) | `store_id` logical vault identity, replication, `pk_id` rationale | Verified |
| [vault-event-log.md](vault-event-log.md) | Immutable event log, causal DAG, projection (replaces scalar sync) | Implemented |
| [vault-architecture-modes.md](vault-architecture-modes.md) | Implemented device/vault modes plus the unimplemented target identity lifecycle; replication is post-genesis storage | Implemented + target |
| [sentinel-genesis.md](sentinel-genesis.md) | Provider-free Sentinel reverse onboarding, threshold policy, and atomic genesis | Implemented |
| [vault-schema-versioning.md](vault-schema-versioning.md) | #52 safe migration via event log; projection `schema_version` | Implemented |
| [typed-newtypes.md](typed-newtypes.md) | Domain newtypes over raw `String`/`u32`; version wrappers for multi-schema vault | In progress |

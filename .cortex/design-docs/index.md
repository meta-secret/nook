# Design Docs Index

This directory contains design specifications, architecture rationales, and core engineering beliefs.

| Document | Description | Status |
|---|---|---|
| [core-beliefs.md](core-beliefs.md) | Agent-first core operating principles | Verified |
| [unified-vault.md](unified-vault.md) | Local-first vault, `vault_version` sync, conflict resolution | Implemented |
| [vault-session-and-lock.md](vault-session-and-lock.md) | Lock session, vault vs sync providers, multi-vault model | Verified |
| [auth-providers.md](auth-providers.md) | Login gate, sync provider persistence | Verified (migrating copy) |
| [secret-store-identity.md](secret-store-identity.md) | `store_id` logical vault identity, replication, `pk_id` rationale | Verified |
| [vault-event-log.md](vault-event-log.md) | Immutable event log, causal DAG, projection (replaces scalar sync) | Implemented |
| [vault-architecture-modes.md](vault-architecture-modes.md) | Device, vault, replication, onboarding, and provider capability modes | Implemented |
| [vault-schema-versioning.md](vault-schema-versioning.md) | #52 safe migration via event log; projection `schema_version` | Implemented |
| [typed-newtypes.md](typed-newtypes.md) | Domain newtypes over raw `String`/`u32`; version wrappers for multi-schema vault | In progress |

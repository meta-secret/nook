# Design Docs Index

## Relationships

- [Agent Workflow Orchestration](agent-workflow-orchestration.md)
  - Owns the detailed Agent Workflow Orchestration design summarized by this catalog.
  - Read when the task concerns Agent Workflow Orchestration.
- [Auth Providers, Sync, and Login UX](auth-providers.md)
  - Owns the detailed Auth Providers, Sync, and Login UX design summarized by this catalog.
  - Read when the task concerns Auth Providers, Sync, and Login UX.
- [Core Beliefs: Agent-First Operating Principles](core-beliefs.md)
  - Owns the detailed Core Beliefs: Agent-First Operating Principles design summarized by this catalog.
  - Read when the task concerns Core Beliefs: Agent-First Operating Principles.
- [Hive Isolated Agent Platform](hive-isolated-agent-platform.md)
  - Owns the detailed Hive Isolated Agent Platform design summarized by this catalog.
  - Read when the task concerns Hive Isolated Agent Platform.
- [Identity, App Keys, Passkeys, and Vault DEKs](identity-vault-architecture.md)
  - Owns the detailed Identity, App Keys, Passkeys, and Vault DEKs design summarized by this catalog.
  - Read when the task concerns Identity, App Keys, Passkeys, and Vault DEKs.
- [Website Passkey Manager](passkey-manager.md)
  - Owns the detailed Website Passkey Manager design summarized by this catalog.
  - Read when the task concerns Website Passkey Manager.
- [Secret Store Identity](secret-store-identity.md)
  - Owns the detailed Secret Store Identity design summarized by this catalog.
  - Read when the task concerns Secret Store Identity.
- [Sentinel Genesis and Reverse Onboarding](sentinel-genesis.md)
  - Owns the detailed Sentinel Genesis and Reverse Onboarding design summarized by this catalog.
  - Read when the task concerns Sentinel Genesis and Reverse Onboarding.
- [Typed Newtypes (Domain IDs & Wire Strings)](typed-newtypes.md)
  - Owns the detailed Typed Newtypes (Domain IDs & Wire Strings) design summarized by this catalog.
  - Read when the task concerns Typed Newtypes (Domain IDs & Wire Strings).
- [Unified Vault Architecture](unified-vault.md)
  - Owns the detailed Unified Vault Architecture design summarized by this catalog.
  - Read when the task concerns Unified Vault Architecture.
- [Vault Architecture Modes](vault-architecture-modes.md)
  - Owns the detailed Vault Architecture Modes design summarized by this catalog.
  - Read when the task concerns Vault Architecture Modes.
- [Vault Event Log](vault-event-log.md)
  - Owns the detailed Vault Event Log design summarized by this catalog.
  - Read when the task concerns Vault Event Log.
- [Vault Schema Versioning](vault-schema-versioning.md)
  - Owns the detailed Vault Schema Versioning design summarized by this catalog.
  - Read when the task concerns Vault Schema Versioning.
- [Vault Session, Lock, and Multi-Vault Model](vault-session-and-lock.md)
  - Owns the detailed Vault Session, Lock, and Multi-Vault Model design summarized by this catalog.
  - Read when the task concerns Vault Session, Lock, and Multi-Vault Model.

## Document map

- [Overview](#overview)
  - This directory contains design specifications, architecture rationales, and core engineering beliefs.
  - Read first when locating the design authority for a task.

## Overview

This directory contains design specifications, architecture rationales, and core engineering beliefs.

| Document | Description | Status |
|---|---|---|
| [core-beliefs.md](core-beliefs.md) | Agent-first core operating principles | Verified |
| [agent-workflow-orchestration.md](agent-workflow-orchestration.md) | Cortex, Loom, Hive, and delivery-owner boundaries for deterministic multi-agent workflows | Architecture decision |
| [hive-isolated-agent-platform.md](hive-isolated-agent-platform.md) | Stateful k0s/Kata Hive architecture, components, trust boundaries, task DAG, Main repair delivery, caching, and Taskfile operations | Implemented |
| [identity-vault-architecture.md](identity-vault-architecture.md) | Identity and vault ownership boundaries | Local directory implemented |
| [unified-vault.md](unified-vault.md) | Local-first vault model; scalar `vault_version` sync retained as historical context | Partially historical — provider sync superseded by [vault-event-log.md](vault-event-log.md) |
| [vault-session-and-lock.md](vault-session-and-lock.md) | Lock session, vault vs sync providers, multi-vault model | Verified |
| [auth-providers.md](auth-providers.md) | Login gate, `nook_auth` sync-provider credentials, OAuth origins | Verified |
| [passkey-manager.md](passkey-manager.md) | Chromium website passkey provider, ceremony boundary, sync, and threat model | Implemented |
| [secret-store-identity.md](secret-store-identity.md) | `store_id` logical vault identity, replication, `pk_id` rationale | Verified |
| [vault-event-log.md](vault-event-log.md) | Immutable event log, causal DAG, projection (replaces scalar sync) | Implemented |
| [vault-architecture-modes.md](vault-architecture-modes.md) | Vault modes and identity-control architecture | Implemented + target |
| [sentinel-genesis.md](sentinel-genesis.md) | Provider-free Sentinel reverse onboarding, threshold policy, and atomic genesis | Implemented |
| [vault-schema-versioning.md](vault-schema-versioning.md) | #52 safe migration via event log; projection `schema_version` | Implemented |
| [typed-newtypes.md](typed-newtypes.md) | Domain newtypes over raw `String`/`u32`; version wrappers for multi-schema vault | In progress |

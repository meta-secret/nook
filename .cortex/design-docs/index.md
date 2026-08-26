# Design Docs Index

## Overview

This index catalogs the durable design authorities and their current status.

## Document catalog

- **[core-beliefs.md](core-beliefs.md)**
  - Description: Agent-first core operating principles
  - Status: Verified
- **[agent-workflow-orchestration.md](agent-workflow-orchestration.md)**
  - Description: Cortex, Loom, local Codex experts, flat lineage, and delivery-owner boundaries for deterministic multi-agent workflows
  - Status: Architecture decision
- **[hive-isolated-agent-platform.md](../sre/design-docs/hive-isolated-agent-platform.md)**
  - Description: Stateful k0s/Kata Hive architecture, components, trust boundaries, task DAG, Main repair delivery, caching, and Taskfile operations
  - Status: Implemented
- **[arc-kata-runner-platform.md](../sre/design-docs/arc-kata-runner-platform.md)**
  - Description: Disposable regular ARC runners, one persistent rootless BuildKit shard per node, cache distribution, and credential ownership
  - Status: Implemented
- **[identity-vault-architecture.md](../dev-core/design-docs/identity-vault-architecture.md)**
  - Description: Identity and vault ownership boundaries
  - Status: Local directory implemented
- **[unified-vault.md](../dev-core/design-docs/unified-vault.md)**
  - Description: Local-first vault model; scalar `vault_version` sync retained as historical context
  - Status: Partially historical — provider sync superseded by [vault-event-log.md](../dev-core/design-docs/vault-event-log.md)
- **[vault-session-and-lock.md](../dev-core/design-docs/vault-session-and-lock.md)**
  - Description: Lock session, vault vs sync providers, multi-vault model
  - Status: Active; compatibility storage examples are explicitly non-authoritative
- **[auth-providers.md](../dev-core/design-docs/auth-providers.md)**
  - Description: Login gate, `nook_auth` sync-provider credentials, OAuth origins
  - Status: Active
- **[passkey-manager.md](../web-dev/design-docs/passkey-manager.md)**
  - Description: Chromium website passkey provider, ceremony boundary, sync, and threat model
  - Status: Implemented
- **[secret-store-identity.md](../dev-core/design-docs/secret-store-identity.md)**
  - Description: `store_id` logical vault identity, replication, `pk_id` rationale
  - Status: Verified
- **[vault-event-log.md](../dev-core/design-docs/vault-event-log.md)**
  - Description: Immutable event log, causal DAG, projection (replaces scalar sync)
  - Status: Implemented
- **[vault-architecture-modes.md](../dev-core/design-docs/vault-architecture-modes.md)**
  - Description: Vault modes and identity-control architecture
  - Status: Implemented + target
- **[sentinel-genesis.md](../dev-core/design-docs/sentinel-genesis.md)**
  - Description: Provider-free Sentinel reverse onboarding, threshold policy, and atomic genesis
  - Status: Implemented
- **[vault-schema-versioning.md](../dev-core/design-docs/vault-schema-versioning.md)**
  - Description: #52 safe migration via event log; projection `schema_version`
  - Status: Implemented
- **[typed-newtypes.md](../dev-core/design-docs/typed-newtypes.md)**
  - Description: Domain newtypes over raw `String`/`u32`; version wrappers for multi-schema vault
  - Status: In progress

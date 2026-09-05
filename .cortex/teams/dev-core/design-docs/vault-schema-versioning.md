# Vault Schema Versioning

## Overview

**Status:** Implemented
**Related:** [vault-event-log.md](vault-event-log.md)

## Decision

The immutable event log is the vault source of truth. Projection YAML is a
derived, browser-local cache and is never imported as an event source.

This vault-specific contract follows the repository-wide
[domain API integrity rule](../../../shared/dynamic-skills/domain-api-integrity.md).

## Version axes

- **App semver**
  - **Current value:** Release tag
  - **Owned by:** CI and deployment workflows
- **Projection `schema_version`**
  - **Current value:** `1`
  - **Owned by:** `nook-core` `vault_format.rs`
- **Event `schema_version`**
  - **Current value:** `3`
  - **Owned by:** `nook-event-log` `event.rs`
- **Password envelope `version`**
  - **Current value:** Envelope crypto version
  - **Owned by:** `password_envelope.rs`

Current builds write event schema `3` and read schemas `2` and `3`. Schema `3`
adds checkpoint replacement fields, so schema-2 readers reject those events
before persistence. Other unsupported versions fail with an actionable error.
There is no copy-on-upgrade, projection import, or compatibility conversion.

## Storage contract

- Vault creation writes the genesis event directly.
- Providers store immutable signed events.
- IndexedDB stores events, outbox entries, projection metadata, and the local
  projection cache in their designated object stores.
- Projection cache bytes are never treated as authoritative sync input.
- `store_id` mismatches are hard errors.

## Release rule

Release tags are immutable. A rollback is a new deployment built from the
chosen commit; existing tags are never moved or overwritten. Any future schema
change requires an explicit current-format contract before release.

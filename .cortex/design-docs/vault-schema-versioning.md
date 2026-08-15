# Vault Schema Versioning

## Relationships

- [Vault Event Log](vault-event-log.md)
  - Defines durable vault events, ordering, and concurrency behavior.
  - Read when the design changes persistence or synchronization.

## Document map

- [Overview](#overview)
  - Status: Implemented Related:.
  - Read before changing or relying on Overview.
- [Decision](#decision)
  - The immutable event log is the vault source of truth.
  - Apply when making or reviewing decisions about Decision.
- [Version axes](#version-axes)
  - Summarizes the structured entries, ownership, and status for Version axes.
  - Read before changing or relying on Version axes.
- [Storage contract](#storage-contract)
  - Vault creation writes the genesis event directly. Providers store immutable signed events. IndexedDB stores events, outbox entries,.
  - Read before changing or relying on Storage contract.
- [Release rule](#release-rule)
  - Release tags are immutable.
  - Apply when making or reviewing decisions about Release rule.

## Overview

**Status:** Implemented
**Related:** [vault-event-log.md](vault-event-log.md)

## Decision

The immutable event log is the vault source of truth. Projection YAML is a
derived, browser-local cache and is never imported as an event source.

## Version axes

| Axis | Current value | Owned by |
|------|---------------|----------|
| App semver | Release tag | CI and deployment workflows |
| Projection `schema_version` | `1` | `nook-core` `vault_format.rs` |
| Event `schema_version` | `3` | `nook-event-log` `event.rs` |
| Password envelope `version` | Envelope crypto version | `password_envelope.rs` |

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

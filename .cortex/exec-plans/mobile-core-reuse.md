# Core Ownership Refactor

## Goal

Make `nook-core` the reusable application/domain implementation. Keep
`nook-wasm` as a browser adapter and keep TypeScript/Svelte focused on
presentation and browser lifecycle.

The dependency direction remains:

```text
nook-auth2 -> nook-core -> nook-wasm -> nook-web
```

## Placement test

For each behavior, place it in the lowest portable layer that can own it:

| Behavior | Owner |
|---|---|
| Cryptography, validation, domain state, provider rules, sync decisions, parsing, portable workflows | `nook-core` / `nook-auth2` |
| Browser storage/network adapters, WebAuthn request conversion, File System Access, JS SDK interop, wasm-bindgen wrappers | `nook-wasm` |
| Svelte state, DOM, timers, navigation, localization selection, user gestures, browser SDK ceremony orchestration | `nook-web` |

Moving code from TypeScript into WASM is only an intermediate step. Pure logic
introduced in `nook-wasm` must delegate to a portable core API in the same
slice whenever possible.

## Execution backlog

### P0 - typed portable boundaries

- [x] Keep secret parsing, formatting, validation, search, imports, and password
      generation in core; the current web layer already delegates these paths.
- [x] Replace string vault-access status sentinels with the core
      `VaultAccessStatus` enum across core, WASM, and TypeScript.
- [x] Move vault idle/sync runtime policy from `nook-wasm/src/types.rs` into a
      portable core policy object; keep environment-string parsing at the thin
      boundary.
- [x] Move provider compatibility and preferred-provider selection from
      `vault-architecture.ts` into core.
- [x] Move Google Drive and iCloud provider-config merge rules from their
      TypeScript SDK adapters into core.
- [x] Move the remaining `VaultState` login/join/recovery/pagination predicates,
      provider scoping and locked-device visibility, staged storage arguments,
      remote-reference normalization, and sync metadata updates into core.

### P1 - remove duplicated app/domain DTOs

- [x] Replace the TypeScript `VaultArchitecture`, `SentinelPolicy`, and provider
      capability mirrors with typed WASM wrappers over core types. Draft form
      fields may remain presentation state.
- [x] Replace `NookPendingSyncConflict`'s flattened `kind` plus optional-field
      bag with a core enum-of-structs and a thin WASM wrapper.
- [x] Replace `NookSecretFormFields`' all-secret-types field bag with core-owned
      per-secret form variants. Svelte should construct the selected variant.
- [x] Replace JSON-string getters in replacement/security/access diagnostics
      with typed core collections exposed by thin wrappers.
- [x] Replace remaining TypeScript domain message schemas where they describe
      vault/enrollment/secret data. Keep browser runtime-message envelopes in
      TypeScript when they are only extension transport glue.
- [x] Remove the TypeScript sync-conflict draft union and construct typed
      conflicts through the Rust/WASM boundary, including version parsing.

### P2 - move reusable workflows out of the WASM manager

- [x] Consolidate provider-agnostic connect, unlock, enrollment, mutation, and
      sync orchestration in the existing core application services; keep the
      manager as their browser lifecycle/I/O coordinator.
- [x] Keep event-log storage, projection cache, clock, randomness ceremony, and
      provider transport as browser adapters. Pass their typed data into core
      stores/services explicitly instead of introducing speculative host APIs.
- [x] Move event-log classification outcomes and recovery choices into typed
      core results so TypeScript never parses Rust error messages.
- [x] Split the WASM manager into topic adapters around core sessions,
      provider handles, and browser persistence. WASM must not be the only owner
      of reusable workflow state.
- [x] Keep portable WebAuthn/passkey request policy in `nook-auth2`; retain
      browser binary conversion and `navigator.credentials` ceremony handling
      in WASM/web.

### P3 - ownership guardrails

- [x] Add an architecture preflight rule that prevents portable domain modules
      from depending on browser crates and flags new TypeScript domain schemas.

Mobile applications, native bindings, and mobile platform adapters are
explicitly out of scope for this execution plan.

## Deliberate non-migrations

The following remain platform adapters rather than core logic:

- Svelte components, reactive UI state, focus/visibility listeners, timers, and
  routing;
- `navigator.credentials`, DOM credential extraction/fill, and extension
  message transport;
- IndexedDB, File System Access handles, `chrome.*`, Google Identity Services,
  CloudKit JS, and browser `fetch` ceremony code;
- translation-key selection and other presentation-only labels.

Portable schemas, validation, decisions, and credential/config transformations
used by those adapters still belong in Rust core.

## Validation per slice

1. Add behavior-focused core tests for every moved rule.
2. Run targeted `nook-core` tests and native/wasm checks.
3. Regenerate WASM bindings and run the relevant web unit/type checks.
4. Finish with the repository `task check` gate for a completed batch.

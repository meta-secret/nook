# Remaining TypeScript domain → Rust

## Goal

Finish moving portable domain rules out of TypeScript into Rust, exposed through
thin WASM adapters. CLI and mobile apps are **not** built here; they are the
reuse motivation only.

Continues [mobile-core-reuse.md](mobile-core-reuse.md).

## Done

- [x] Portable backup-code candidate extraction in
      `nook-companion-core` (re-exported from `nook-core`) with WASM exports.
- [x] Portable auth field-role classification in `nook-companion-core` with
      structured `LoginContextObservation` / `PageInputFieldObservation` inputs.
- [x] OAuth authorized-origin policy in `nook-companion-core`; web adapter uses
      generated WASM enums (no TypeScript enum mirrors).
- [x] Simple/Sentinel vault host policy in `nook-companion-core`.
- [x] Remove `SecretFormInput` TypeScript mirror; Svelte builds
      `NookSecretFormFields` directly.
- [x] Outcome verdict transport already uses generated
      `AuthenticationOutcomeVerdict`; observation bags stay message envelopes.
- [x] Tiny `nook-companion-wasm` package for content scripts / Manifest host
      policy (~300KB class, not full vault `nook-wasm`).
- [x] Content adapters call companion WASM for backup-code candidates, field-role
      heuristics, and vault host matching; DOM query/fill stays in TypeScript.
- [x] Shared vault sync state variants and their payloads live in `nook-core`
      with typed `nook-wasm` wrappers; Svelte retains only reactive storage and
      host orchestration.

## Remaining follow-ups

- [ ] Move portable extension observation classification out of TypeScript.
- [ ] Move portable extension protocol validation out of TypeScript.
- [ ] Keep Chrome, DOM, WebAuthn, timer, and event-listener calls in TypeScript.
- [ ] Expose content-script decisions through `nook-companion-wasm`.
- [ ] Use `nook-core` plus full `nook-wasm` when the decision depends on vault
      or session state.
- [ ] Add ownership preflight checks after each TypeScript pattern is removed.

## Validation

- Rust unit tests for every moved rule (`nook-companion-core`).
- WASM export smoke tests in `nook-companion-wasm` and full-bridge
  `nook-wasm` companion heuristics module.
- Preflight ownership gates stay green.
- No CLI/mobile packages in these PRs.

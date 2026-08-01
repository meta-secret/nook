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

None for the companion/content boundary. Future domain moves should land in
`nook-companion-core` when the rule must ship in content scripts, otherwise in
`nook-core` + full `nook-wasm`.

## Validation

- Rust unit tests for every moved rule (`nook-companion-core`).
- WASM export smoke tests in `nook-companion-wasm` and full-bridge
  `nook-wasm` companion heuristics module.
- Preflight ownership gates stay green.
- No CLI/mobile packages in these PRs.

# Remaining TypeScript domain → Rust

## Goal

Finish moving portable domain rules out of TypeScript into `nook-core`, exposed
through thin `nook-wasm` adapters. CLI and mobile apps are **not** built here;
they are the reuse motivation only.

Continues [mobile-core-reuse.md](mobile-core-reuse.md).

## Done in this wave

- [x] Portable backup-code candidate extraction in
      `nook-core/src/auth/backup_code_candidates.rs` with WASM exports.
- [x] Portable auth field-role classification in
      `nook-core/src/auth/page_field_classification.rs` with WASM exports.
- [x] OAuth authorized-origin policy in
      `nook-core/src/auth/oauth_origin_policy.rs`; web adapter calls WASM.
- [x] Simple/Sentinel vault host policy in
      `nook-core/src/auth/vault_host_policy.rs` (Rust source of truth + tests).
- [x] Remove `SecretFormInput` TypeScript mirror; Svelte builds
      `NookSecretFormFields` directly.
- [x] Outcome verdict transport already uses generated
      `AuthenticationOutcomeVerdict`; observation bags stay message envelopes.

## Remaining follow-ups

### P1 — content-script companion WASM

Extension content scripts (autofill, enrollment) still keep TypeScript copies of:

- backup-code candidate extraction
  (`nook-web-extension/src/lib/backup-code-candidates.ts`)
- password-form field-role heuristics
  (`nook-web-shared/src/extension/password-forms.ts`)
- Simple/Sentinel host matching used at Manifest build and content runtime
  (`nook-web-extension/src/lib/simple-vault-target.ts`)

Full `nook-wasm` is ~7MB uncompressed and must not be injected into every page.
Follow-up: extract a tiny `nook-companion` wasm (heuristics + host policy only)
for content, or route sync find/fill through a background classifier without
regressing fill latency. Until then, Rust modules remain the portable source of
truth for CLI/mobile; content TypeScript must stay behavior-aligned with the
Rust tests.

### P2 — delete content TypeScript mirrors after companion wasm

Once content can call the small wasm package:

- [ ] Delete TS backup-code heuristics; call wasm from content.
- [ ] Delete TS field-role pattern matching; keep only DOM query/fill/visibility.
- [ ] Point `simple-vault-target` / Manifest build at Rust via Node wasm init or a
      tiny native helper so Node no longer owns host policy.

## Validation

- Rust unit tests for every moved rule.
- WASM export smoke tests in `nook-wasm` companion heuristics module.
- Preflight ownership gates stay green.
- No CLI/mobile packages in these PRs.

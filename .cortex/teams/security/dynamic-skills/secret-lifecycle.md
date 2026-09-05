# Secret Lifecycle

## Priority

This is the P1 cross-language contract for secret plaintext, credentials,
private keys, recovery material, and decrypted payloads.

Every secret-bearing value has an explicit owner, purpose, lifetime, and
destruction event. Encryption at rest does not justify an unbounded plaintext
lifetime in memory.

## Required actions

- Keep cryptographic operations, validated secret types, and durable secret
  state in Rust or Rust-backed WASM.
- Use secret-specific Rust newtypes that redact debug output and zeroize owned
  buffers where the representation permits it.
- Decrypt only the smallest value required for the current operation.
- Keep TypeScript plaintext limited to the browser interaction that requires
  display, editing, copying, form filling, or immediate submission.
- Represent a TypeScript secret interaction with an explicit lifecycle state.
- Clear TypeScript and Svelte references on hide, cancel, submit, replacement,
  component teardown, vault lock, logout, timeout, and failure.
- Keep long-lived browser state as an opaque Rust/WASM capability or encrypted
  representation.
- Encrypt secret material before Nook-owned durable storage, replication, or
  transport.
- Preserve redaction through errors, diagnostics, tracing, telemetry, and test
  output.
- Test the operation-specific cleanup event and the enclosing lock or teardown
  event.

## Prohibited actions

- Do not persist secret plaintext in browser storage, caches, convenience
  state, URLs, application-owned clipboard history, logs, telemetry, or error
  messages.
- Do not keep a plaintext mirror beside an encrypted or Rust-owned value.
- Do not convert a validated Rust secret into a raw string before the narrowest
  required WASM or presentation boundary.
- Do not clone secret material to preserve an earlier state across a consuming
  transition.
- Do not expose secret getters from long-lived Rust/WASM managers.
- Do not retain whole decrypted records when one field or projection is
  sufficient.
- Do not claim JavaScript string clearing provides deterministic memory
  zeroization. Clear references and keep the lifetime narrow instead.
- Do not add plaintext fallback, compatibility storage, or recovery behavior.

## Language responsibilities

Rust owns secret validation, cryptographic use, redacted representation,
zeroization, and long-lived capability state. Follow
[Rust coding](../../dev-core/dynamic-skills/rust-coding.md) and
[cryptography](../references/cryptography.md).

TypeScript and Svelte own only the required browser interaction lifetime. They
must not become an alternate secret domain or persistence layer. Follow
[TypeScript domain structure](../../web-dev/dynamic-skills/typescript-domain-structure.md)
and the exact product lifecycle authority for the affected flow.

## Validation

- Inventory every creation, copy, conversion, log, persistence, and cleanup
  path for the changed secret value.
- Verify the smallest plaintext projection crosses each boundary.
- Verify Rust cleanup on reset, replacement, error, and drop where applicable.
- Verify TypeScript cleanup on every terminal interaction and enclosing session
  teardown.
- Search changed logs, errors, fixtures, snapshots, and telemetry for secret
  values.
- Treat an unowned lifetime, plaintext persistence, or sensitive log as a P1
  finding.

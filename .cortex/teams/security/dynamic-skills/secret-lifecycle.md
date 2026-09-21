# Nook Secret Lifecycle Boundaries

The supplied Meta-Cortex security and secret-lifecycle skills own generic
ownership, redaction, cleanup, and language-specific secret handling.
This supplement identifies Nook's product boundaries.

## Required actions

Keep durable secret state, validation, cryptographic use, and vault capabilities
in Rust/WASM. Encrypt protected material before Nook storage, replication, or
transport. Browser plaintext exists only for the immediate display, edit, copy,
fill, or submission interaction. Apply Nook vault lock and session teardown to
that interaction's cleanup.

**Prohibited:** keep a plaintext TypeScript mirror of a Rust-owned vault record.

**Preferred:** request the smallest typed projection for the immediate interaction
and clear browser references when it ends or the vault locks.

## Prohibited actions

Do not weaken Nook's cryptographic, device-identity, authentication, authorization,
or vault-storage architecture during generic-skill migration. Plaintext persistence
and sensitive logs remain P1 findings.

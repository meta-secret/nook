# Decentralized Auth Specification

This document defines the next authentication phase for Nook: replacing provider-specific credentials (GitHub PAT) with decentralized identity while preserving the zero-knowledge vault model.

---

## 1. Goals

- **Decentralized identity:** Users authenticate without handing long-lived secrets to Nook or a single OAuth provider.
- **Zero-knowledge preserved:** Vault encryption keys remain client-side; auth proves identity for sync, not access to plaintext secrets.
- **Portable sync:** GitHub (and future backends) become storage targets authorized by decentralized credentials rather than raw PATs pasted in the UI.
- **Rust-first:** Identity verification, challenge/response, and token derivation live in `nook-core` with WASM bindings — not in Svelte/TS.

---

## 2. Current State (baseline)

| Area | Today |
|---|---|
| Local mode | IndexedDB + browser-local encryption key |
| GitHub mode | Classic PAT with `repo` scope, stored in `localStorage` |
| Encryption | Age armored values in `nook-vault.yaml`; session key never uploaded |
| UI | Full-page storage settings; connect / reconnect flow |

---

## 3. Target Architecture (draft)

```
Browser (nook-web)
  └─ nook-wasm
       └─ nook-core
            ├─ vault crypto (existing)
            ├─ decentralized identity module (new)
            └─ storage adapters (local, github, …)
```

### Proposed flows

1. **Identity creation / recovery** — user generates or restores a decentralized identity (seed / key bundle) in the browser.
2. **Storage authorization** — derived credentials scoped to a backend (e.g. GitHub) without exposing the master identity material.
3. **Connect** — unified connect flow: pick storage target → prove identity → sync encrypted vault.

---

## 4. Implementation phases

### Phase 1 — Core identity primitives (`nook-core`)
- [ ] Identity key generation and secure serialization format
- [ ] Challenge/response or signed capability tokens for storage backends
- [ ] Unit + integration tests (no UI)

### Phase 2 — WASM surface (`nook-wasm`)
- [ ] Expose identity create/restore/connect APIs to the frontend
- [ ] Deprecate direct PAT entry behind feature flag

### Phase 3 — UI (`nook-web`)
- [ ] Replace PAT paste step with decentralized auth wizard
- [ ] Migration path for existing GitHub PAT users
- [ ] E2e coverage for new connect flow

---

## 5. Non-goals (initial PR scope)

- Multi-device key recovery via social recovery (future)
- Public federation / relay infrastructure
- Replacing YAML vault format or age encryption

---

## 6. Open questions

- Which decentralized identity standard or meta-secret protocol version is the source of truth?
- How are GitHub (and other) scopes derived from identity proofs?
- Migration: auto-revoke PAT guidance vs in-app rotation wizard?

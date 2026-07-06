# Rust Coding

## Purpose

Keep Rust domain models precise. Use this when a struct has optional fields,
string tags, sentinel values, or a shared DTO that seems to serve multiple
workflows.

## Problem Pattern

An `Option<T>` often means one Rust shape is being reused across different
worlds. The code says "maybe this field exists," but the real product model is
usually "this value is in one named state or another named state."

When you see `Option<T>`, ask:

1. Why is this optional?
2. Is the containing struct shared by multiple workflows or provider kinds?
3. Are we using absence to mean a named state like draft, missing config,
   unauthenticated, local-only, pending, or unsupported?
4. Would an enum with per-variant structs make illegal states unrepresentable?

## Preferred Pattern

- Model closed sets as Rust enums, not `String`.
- Model different workflow states as enum variants, not optional fields inside a
  reused struct.
- Put fields only on the variant/sub-struct that actually owns them.
- Use `Option<T>` only when absence is truly a field-level fact inside one
  workflow, not a disguised variant.
- Do not use `String` for typed domain values such as timestamps, YAML payloads,
  JSONL payloads, storage/provider types, vault/store ids, event ids, or secret
  keys. Prefer existing core newtypes (`IsoTimestamp`, `StoredVaultYaml`,
  `SessionJsonl`, `StoreId`, `EventId`, `SymmetricKey`, etc.) or add one.
- Keep raw YAML/JSON strings only at I/O boundaries. Parse them into typed Rust
  records immediately after deserialization, and serialize typed records back to
  wire strings only when crossing storage, provider, or JS boundaries.
- Secret material that does not cross JS directly should use validated secret
  newtypes and avoid raw `String` storage. If a session cache still has to hold a
  string for WASM compatibility, convert from the typed value at the narrowest
  boundary and zeroize it on reset/drop.
- Convert loose persisted/browser JSON into typed Rust states at the boundary.
- Keep domain validation next to the Rust type that makes the state explicit.
- Before adding a new struct or enum, search for an equivalent core type. Reuse
  the canonical type instead of duplicating DTOs across `nook-core` and
  `nook-wasm`; WASM wrappers should delegate to core types when possible.
- Authored TypeScript/Svelte uses `undefined`, never `null`, for absence. Rust
  and WASM helpers should make it easy for TS to pass plain objects or omitted
  values instead of forcing TS to construct nullable shim objects.

## Examples

Avoid a provider identity where GitHub may or may not have credentials:

```rust
pub struct GithubSyncTarget {
    pub repo: Option<String>,
    pub pat: Option<String>,
}
```

Prefer named states:

```rust
pub struct GithubSyncTarget {
    pub repo: String,
    pub pat: String,
}

pub enum SyncProviderTarget {
    Github(GithubSyncTarget),
    Empty,
}
```

Persisted compatibility shapes may still have optional fields because older
JSON or browser storage may be incomplete. Do not let that optionality leak into
the domain model; classify it while converting:

```rust
let target = match non_empty(provider.github_pat.as_deref()) {
    Some(pat) => SyncProviderTarget::Github(GithubSyncTarget {
        repo: non_empty(provider.github_repo.as_deref()).unwrap_or(default_repo),
        pat,
    }),
    None => SyncProviderTarget::Empty,
};
```

Avoid raw timestamps or payload strings:

```rust
struct LogEntry {
    ts: String,
    yaml: String,
}
```

Prefer typed fields internally:

```rust
struct LogEntry {
    ts: IsoTimestamp,
    event: VaultEvent,
}
```

If web/storage JSON still uses `yaml` or `ts`, implement serde
`serialize_with`/`deserialize_with` helpers that convert at the boundary.

## Scope

Applies to Rust domain and bridge code in `nook-core` and `nook-wasm`,
especially provider targets, enrollment payloads, vault state, sync state,
storage modes, credential states, and WASM DTOs.

Does not require replacing optional fields in raw persisted JSON structs when
the optionality exists only to deserialize old or incomplete storage. Those
structs must convert into a typed enum before domain decisions are made.

## Validation

- Add or update tests for each new enum state.
- Check that helper APIs accept typed variants/enums instead of strings or
  optional field bags.
- Run targeted core tests plus `cargo clippy -p nook-core --all-targets -- -D warnings`.
- When exposed to web, regenerate wasm bindings and run the web type check.

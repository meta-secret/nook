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
  YAML payloads, storage/provider types, vault/store ids, event ids, or secret
  keys. Prefer existing core newtypes (`IsoTimestamp`, `StoredVaultYaml`,
  `StoreId`, `EventId`, `SymmetricKey`, etc.) or add one.
- Keep raw YAML/JSON strings only at I/O boundaries. Parse them into typed Rust
  records immediately after deserialization, and serialize typed records back to
  wire strings only when crossing storage, provider, or JS boundaries.
- Do not expose WASM DTO fields named `yaml` for event/vault records when the
  real payload is a typed domain value. Use typed fields such as
  `event: VaultEvent` internally and across merge/sync APIs; add explicit
  parse/serialize helpers for the narrow browser file/provider boundary that
  must read or write YAML text.
- Secret material that does not cross JS directly should use validated secret
  newtypes and avoid raw `String` storage. If a session cache still has to hold a
  string for WASM compatibility, convert from the typed value at the narrowest
  boundary and zeroize it on reset/drop.
- Convert loose persisted/browser JSON into typed Rust states at the boundary.
- Keep domain validation next to the Rust type that makes the state explicit.
- Before adding a new struct or enum, search for an equivalent core type. Reuse
  the canonical type instead of duplicating DTOs across `nook-core` and
  `nook-wasm`; WASM wrappers should delegate to core types when possible.
- Keep stateful WASM manager objects composed from cohesive private state
  structs instead of flat field bags. Provider credentials/cache, vault session
  state, device identity, event-log state, status channels, and outbox state
  should not all live as sibling fields on one exported manager.
- Model stateful WASM concepts as real `#[wasm_bindgen]` structs with
  constructors and methods. JavaScript/Svelte should create the struct instance
  directly, keep that instance in app state/storage, and call methods on it.
  Do not create mutable global config (`OnceCell`, `thread_local`, static
  setters) for per-app runtime state, and do not add TypeScript wrapper
  functions whose only job is to simulate state around a WASM object. If Rust
  owns the state, expose the object; if TypeScript owns the browser lifecycle,
  store/pass the WASM object from Svelte state explicitly.
- Keep `nook-core` organized by domain module groups (`auth`, `crypto`,
  `secrets`, `sync`, `vault`). Do not add new domain files directly under
  `nook-app/nook-core/src`; place them in the owning group and re-export through
  `lib.rs` only when they are part of the stable public core API.
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

If a browser file/provider API still reads or writes YAML text, parse it into a
typed Rust DTO before handing it to sync/domain code, and serialize the typed
DTO back only at the file/provider write call.

Use a stateful WASM struct directly instead of a global setter or TS wrapper:

```rust
#[wasm_bindgen]
pub struct NookRuntimeConfig {
    run_mode: NookClientRunMode,
    e2e_expose_vault: bool,
}

#[wasm_bindgen]
impl NookRuntimeConfig {
    #[wasm_bindgen(constructor)]
    pub fn new(run_mode: NookClientRunMode, e2e_expose_vault: bool) -> Self {
        Self {
            run_mode,
            e2e_expose_vault,
        }
    }

    #[wasm_bindgen(js_name = resolveVaultIdleTimeoutMs)]
    pub fn resolve_vault_idle_timeout_ms(&self, raw_timeout_ms: Option<String>) -> u32 {
        // Use immutable instance state directly.
        300_000
    }
}
```

```ts
class VaultState {
  runtimeConfig = new NookRuntimeConfig(
    NookClientRunModeUtil.parse(import.meta.env.MODE),
    import.meta.env.VITE_E2E_EXPOSE_VAULT === 'true',
  )
}

vault.runtimeConfig.resolveVaultIdleTimeoutMs(
  import.meta.env.VITE_VAULT_IDLE_TIMEOUT_MS ?? undefined,
)
```

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
- Run targeted core/auth tests plus `cd nook-app && cargo clippy -p nook-core -p nook-auth --all-targets -- -D warnings`.
- When exposed to web, regenerate wasm bindings and run the web type check.

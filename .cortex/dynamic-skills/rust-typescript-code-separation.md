# Rust-TypeScript Code Separation

## Purpose

Keep Nook's app/domain data shapes in Rust, with TypeScript reserved for UI
presentation state and browser glue. Use this when a TypeScript type looks like
core product knowledge rather than a visual component concern.

## Problem Pattern

`nook-web` defines exported TypeScript unions, structs, or validators for app
concepts because the current flow is implemented from UI code. This duplicates
domain schema outside Rust and risks drift across web, wasm, and future hosts.

The review question is: "Is this type about the app itself, or is it only a
visual element in the UI?" If it describes vault behavior, storage/sync
providers, enrollment payloads, secret formats, validation, or wire contracts,
it is app/core information.

## Preferred Pattern

Put app/domain types in Rust first:

- Prefer `nook-core` for simple domain structs, enums, payload schemas,
  serialization, and validation.
- Follow [rust-coding.md](rust-coding.md) for Rust model shape: closed sets are
  enums, cross-workflow optional fields are usually missing enum variants, and
  loose persisted JSON must be classified before domain logic.
- It is acceptable for simple core DTOs/enums to carry wasm/serialization
  annotations needed for boundary exposure, as long as `nook-core` does not
  gain browser APIs, I/O, session state, or wasm-specific behavior. Do not copy
  a core enum into a string field in `nook-wasm` merely because the enum lives in
  `nook-core`; export the core enum with `#[wasm_bindgen]` and use it directly.
- Use `nook-wasm` for bridge concerns: wasm exports, session manager methods,
  IndexedDB/GitHub/browser I/O, and conversions between JS calls and core
  types.
- Keep `nook-web` focused on Svelte rendering, form state, component props,
  labels, and calling typed wasm APIs.

## Scope

Applies to:

- `nook-app/nook-web/src/lib/**/*.ts` and Svelte modules that define exported app/domain
  unions, payloads, or validators.
- `nook-wasm` boundary types that should delegate schema and validation to
  `nook-core`.
- `nook-core` modules that own portable domain models and tests.

Does not apply to:

- Component-local UI state, view modes, CSS/layout variants, form-only draft
  fields, labels, or browser-only URL/DOM helpers.
- Code that requires browser APIs, IndexedDB, GitHub REST I/O, Web Crypto APIs,
  or session manager state; those belong in `nook-wasm` or `nook-web`, with only
  their portable schema delegated to core.

## Examples

Before: TypeScript owns an app/domain schema because the current UI flow needs
it.

```ts
export type EnrollmentProvider =
  | { type: 'local' }
  | { type: 'github'; pat: string; repo: string }

export type EnrollmentIssueInput = {
  provider: EnrollmentProvider
  entryId: string
}
```

After: Rust owns the app/domain schema, wasm exposes a typed boundary, and the
web layer keeps only form/UI state.

```rust
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum EnrollmentProvider {
    Local,
    Github { pat: String, repo: String },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EnrollmentIssueInput {
    pub provider: EnrollmentProvider,
    pub entry_id: String,
}
```

```rust
#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StorageProviderType {
    Local,
    Github,
}

#[wasm_bindgen]
pub struct NookEnrollmentProvider {
    inner: EnrollmentProvider,
}

#[wasm_bindgen]
impl NookEnrollmentProvider {
    #[wasm_bindgen(js_name = local)]
    pub fn local() -> Self {
        Self {
            inner: EnrollmentProvider::Local,
        }
    }

    #[wasm_bindgen(js_name = github)]
    pub fn github(repo: String, pat: String) -> Self {
        Self {
            inner: EnrollmentProvider::Github { pat, repo },
        }
    }

    #[wasm_bindgen(getter, js_name = "type")]
    pub fn provider_type(&self) -> StorageProviderType {
        match self.inner {
            EnrollmentProvider::Local => StorageProviderType::Local,
            EnrollmentProvider::Github { .. } => StorageProviderType::Github,
        }
    }
}
```

```ts
const provider =
  selectedProvider === 'github'
    ? NookEnrollmentProvider.github(githubRepo, githubPat)
    : NookEnrollmentProvider.local()

await issueEnrollmentCode(provider, selectedEntryId)
```

If the provider type already exists in `nook-core` (for example
`StorageProviderType`), use that exported enum directly in the wasm-facing
struct. Avoid this anti-pattern:

```rust
#[wasm_bindgen]
pub struct NookEnrollmentProvider {
    provider_type: String,
    pat: String,
    repo: String,
}
```

Before: TypeScript computes provider identity or storage-mode rules.

```ts
export function syncProviderTargetKey(provider: StorageProvider): string | undefined {
  if (provider.type === 'github') {
    return `github:${provider.githubRepo?.toLowerCase()}:${provider.githubPat}`
  }
  // ...
}
```

After: Rust owns provider rules (`StorageProviderType`, `OauthFilePreset`,
`SyncProviderTarget`, labels, Drive refs, storage-mode mapping) and wasm exports
thin helpers. TypeScript may keep the browser IndexedDB snapshot shape, but
calls wasm for the app/domain decision.

Authored TypeScript/Svelte must use `undefined`, not `null`, for absence. When a
browser or generated wasm API returns `null`, normalize it at the boundary with
`?? undefined` before it reaches app state.

### Model sum types as an enum-of-structs, wrap it for wasm

When a wasm export needs many parameters — especially several optional ones —
that is a design smell. Do **not** flatten the variants into one stringly-typed
struct with a `type` tag and a union of every possible field:

```rust
// Anti-pattern: flattened, stringly-typed, every field optional-by-emptiness.
#[wasm_bindgen]
pub struct NookSyncProviderTarget {
    provider_type: String,
    github_repo: String,
    github_pat: String,
    oauth_config_present: bool,
    oauth_preset: String,
    // ... every field of every variant, always present ...
}
```

Instead, model the state as a real `nook-core` enum whose variants each carry a
dedicated struct, then expose a **thin `#[wasm_bindgen]` newtype wrapper** over
the core enum with `is_*` / `as_*` accessors. This mirrors the MetaSecret
`WasmVaultStatus(VaultStatus)` pattern
([vault.rs](https://raw.githubusercontent.com/meta-secret/meta-secret-core/refs/heads/main/meta-secret/core/src/node/common/model/vault/vault.rs)):

```rust
// nook-core: owned enum-of-structs, serializable, testable, no wasm behavior.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSyncProvider;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubSyncProvider {
    pub repo: String,
    pub pat: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SyncProviderTarget {
    Empty,
    Local(LocalSyncProvider),
    Github(GithubSyncProvider),
    // OauthFile(OauthFileSyncProvider), ...
}
```

```rust
// nook-wasm: thin newtype wrapper over the core enum.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[wasm_bindgen]
pub struct WasmSyncProviderTarget(SyncProviderTarget);

#[wasm_bindgen]
impl WasmSyncProviderTarget {
    pub fn is_local(&self) -> bool {
        matches!(&self.0, SyncProviderTarget::Local(_))
    }

    pub fn as_github(&self) -> Option<GithubSyncProvider> {
        match &self.0 {
            SyncProviderTarget::Github(github) => Some(github.clone()),
            _ => None,
        }
    }
}

impl From<SyncProviderTarget> for WasmSyncProviderTarget {
    fn from(target: SyncProviderTarget) -> Self {
        Self(target)
    }
}
```

Rules:

- The **variant carries its own struct** (`Github(GithubSyncProvider)`), so each
  state only holds the fields it actually has — no cross-variant field soup, no
  `oauth_config_present`-style booleans standing in for a variant.
- A configured variant must not contain optional fields for required
  configuration. Use a separate absence/draft variant, such as `Empty`, rather
  than `Github { pat: Option<String> }`.
- The **wasm type is a newtype wrapper** `Wasm...(CoreEnum)`, not a hand-copied
  mirror of every field. Expose `is_*` predicates and `as_*` accessors that
  return the per-variant struct.
- Keep serialization/validation in `nook-core`; the wrapper only bridges to JS.
- Use raw string/option arguments only for genuinely simple one-off boundary
  helpers where an enum or wrapper would not reduce ambiguity.

### `Option<T>` is almost always a missing enum

Treat every `Option<String>` (and `Option<T>` more broadly) as a **strong signal
that the type is really a two-state enum whose states are not yet named**. An
`Option` says "present or absent" but says nothing about *what each state means*;
an enum makes the states, their names, and their payloads explicit — which is
more descriptive in almost every case.

The canonical smell:

```rust
// Anti-pattern: what does `None` mean? empty? not-yet-loaded? cleared?
struct PlainText {
    text: Option<String>,
}
```

Prefer a named enum whose variants describe the actual states:

```rust
// Named states: `Empty` and `Text(String)` are self-documenting.
enum PlainText {
    Empty,
    Text(String),
}
```

Why the enum wins almost always:

- **Named states beat `Some`/`None`.** `Empty` vs `Text(...)` documents intent;
  `None` forces every reader to reconstruct what absence means here.
- **No ambiguous absence.** `Option<String>` collapses distinct real states
  (never set, explicitly cleared, empty string, not-yet-fetched) into one `None`.
  An enum can distinguish them (`NotLoaded`, `Cleared`, `Text(String)`, …).
- **Exhaustive matching.** Adding a state forces every `match` to be revisited;
  an `Option` silently keeps compiling and quietly loses meaning.
- **No invalid states.** Multiple sibling `Option` fields encode a combinatorial
  soup of impossible combinations; a single enum-of-structs makes only the legal
  combinations representable.

Apply this at the design layer that owns the data — usually `nook-core` — and let
`nook-wasm` bridge the enum to JS with `is_*` / `as_*` accessors as above.

When `Option<T>` is still acceptable (do not force an enum):

- Genuinely two-state, self-explanatory, single-field cases where a bespoke enum
  would only rename `Some`/`None` without adding meaning (e.g. a one-off
  `revision: Option<String>` on a boundary DTO where "no revision yet" is the
  only absence).
- Standard-library / trait signatures that must return `Option` (`get`, `find`,
  `FromStr`-adjacent helpers), and thin wasm boundary helpers returning
  `Option<String>` to JS.
- When two or more `Option` fields co-vary (present/absent together), that is the
  clearest case that they should collapse into one enum variant carrying a struct
  — see the `GithubSyncProvider` enum-of-structs pattern above.

## Application Checklist

- [ ] Search the requested scope for exported TypeScript types/enums and ask
      whether each is app/domain data or only UI presentation state.
- [ ] Move app/domain schemas and validation into `nook-core` where they are
      portable and testable.
- [ ] Route JS access through typed `nook-wasm` exports instead of plain TS
      schema mirrors.
- [ ] Treat long wasm functions with many optional parameters (or a flattened
      stringly-typed struct) as a design smell. Model the state as a `nook-core`
      enum-of-structs and expose a thin `#[wasm_bindgen]` newtype wrapper with
      `is_*` / `as_*` accessors instead.
- [ ] Treat every `Option<String>` / `Option<T>` in an owned domain type as a
      missing enum. Ask what each state means and replace it with a named enum
      (e.g. `Empty` / `Text(String)`) unless it is a genuine two-state boundary
      DTO or trait/stdlib signature where `Some`/`None` already says everything.
- [ ] Leave UI-only state in TypeScript/Svelte and avoid unrelated cleanup.
- [ ] Add or update Rust tests for moved schema, serialization, and validation.

## Validation

Run the smallest relevant Rust and web checks for the touched boundary first.
For implementation tasks, finish with `task check` before push.

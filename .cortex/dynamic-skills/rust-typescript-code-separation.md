# Rust-TypeScript Code Separation

## Purpose

Keep Nook's app/domain data shapes in Rust, with TypeScript reserved for UI
presentation state and browser glue. Use this when a TypeScript type looks like
core product knowledge rather than a visual component concern.

This rule applies equally to the browser extension.

## Problem Pattern

`nook-web` defines exported TypeScript unions, structs, or validators for app
concepts because the current flow is implemented from UI code. This duplicates
domain schema outside Rust. It risks drift across web, wasm, and future hosts.

The review question is: "Is this type about the app itself, or is it only a
visual element in the UI?"

If it describes vault behavior, storage/sync providers, enrollment payloads,
secret formats, validation, wire contracts, workflow command arguments, or
recovery summaries, it is app/core information.

## Preferred Pattern

Put app/domain types in Rust first:

- Prefer `nook-core` for simple domain structs, enums, payload schemas,
  serialization, and validation.
- Model semantic observation state with named enums and variant-owned structs.
  Do not encode workflow evidence as a positional constructor full of numbers
  and booleans. Raw browser facts may begin as booleans in a narrow DOM adapter,
  but the Rust/WASM boundary must immediately classify them into named states.
- Put decisions derived entirely from one observation on that Rust observation
  type. Prefer an exhaustive enum result over repeating sibling-field condition
  chains in classifiers or TypeScript.
- Never serialize a Rust/WASM domain enum as an integer discriminant. Numeric
  ordinals are unstable, obscure intent in browser traces, and can silently map
  to the wrong state after variant changes. Use semantic tagged enums or
  string-named variants generated from Rust. Keep numeric fields only for real
  quantities such as bounded counts, indices, and durations.
- Follow [rust-coding.md](rust-coding.md) for Rust model shape: closed sets are
  enums, cross-workflow optional fields are usually missing enum variants, and
  loose persisted JSON must be classified before domain logic.
- It is acceptable for simple core DTOs/enums to carry wasm/serialization
  annotations needed for boundary exposure, as long as `nook-core` does not
  gain browser APIs, I/O, session state, or wasm-specific behavior. Do not copy
  a core enum into a string field in `nook-wasm` merely because the enum lives in
  `nook-core`; expose the same core enum through `#[wasm_bindgen]` or a
  semantic `Tsify` boundary and use the generated type directly.
- Use `nook-wasm` for bridge concerns: wasm exports, session manager methods,
  durable browser storage/provider I/O, and conversions between JS calls and core
  types. Prefer established Rust browser abstraction crates (`gloo-storage`,
  `gloo-file`, `rexie`, `reqwest`) over direct `web-sys`/`js-sys` calls. If a
  direct Web API call is unavoidable, keep it in a narrow adapter module and do
  not let that style spread into domain/session policy.
- Use `nook-companion-core` for portable extension policy that must run in
  content scripts or other size-sensitive extension contexts.
- Expose that policy through `nook-companion-wasm`.
- TypeScript may observe browser state.
- TypeScript must pass those observations to Rust when the resulting decision
  is portable.
- TypeScript then performs the browser action selected by the typed Rust
  result.
- Do not keep a TypeScript `some`, `find`, condition chain, validator, or switch
  when it decides a domain or workflow outcome from browser observations.
- Keep `nook-web` focused on Svelte rendering, form state, component props,
  labels, DOM events, timers, Vite/browser environment flags, and calling typed
  wasm APIs. The closer behavior is to browser lifecycle glue (`document`
  listeners, `setTimeout`, viewport/URL state), the more strongly it belongs in
  TypeScript/Svelte rather than Rust/WASM.
- Never clone or unwrap reactive data with
  `JSON.parse(JSON.stringify(value))`.
- In `.svelte` and `.svelte.ts` modules, pass `$state.snapshot(value)` directly
  at the API boundary.
- Keep replace-only DTO state in `$state.raw` so ordinary `.ts` domain and
  adapter modules receive plain values.
- Do not rename a utility, domain, or action module to `.svelte.ts` merely to
  access `$state.snapshot`. Move the snapshot to the rune-owning caller instead.
- Do not introduce `plain*` or `toPlain` serialization helpers.
- Use the `.svelte.ts` suffix only when the module genuinely owns Svelte
  reactivity such as `$state`, `$derived`, or `$effect`. The suffix opts the
  module into Svelte compiler transformation. It is not a general marker for
  code called by Svelte components.
- Keep reactive state and workflow actions as separate APIs. Do not add a
  `VaultState` method whose complete implementation is
  `return someActions.operation(this, ...args)`.
- Components and peer action modules should import and call the action directly.
- Retain a state method only when it owns a real boundary such as
  `$state.snapshot`, enforces an invariant, adapts arguments/results, or
  composes multiple operations.
- Consume generated WASM types and functions directly. Preserve a friendly web
  module API with direct import/export aliases when useful, but do not add local
  `type Foo = NookFoo` declarations or exported functions whose only statement
  forwards the same parameters to a WASM import. Keep a wrapper only when it
  performs a real boundary task such as constructing/freeing WASM values,
  applying UI defaults, or translating browser state. Removing a Svelte proxy
  alone is not a wrapper responsibility; snapshot directly at the call site.
- Preserve semantic Rust identifier names in generated WASM declarations.
  Svelte state and function signatures must use `StoreId`, `PasswordEntryId`,
  and other available generated identifier types instead of widening them to
  `string`. Optional identifiers use `$state<StoreId>()`; absence and identifier
  identity are separate concerns.
- Treat TypeScript string-literal unions that describe authentication, vault
  unlock, recovery, Sentinel, provider, or session workflows as missing Rust
  enums. Export the canonical `nook-core` enum through WASM and compare its
  generated variants in Svelte. Before adding an enum, inspect every read: if
  the state is write-only or a WASM getter always returns one constant, delete
  the abandoned state/getter instead. Keep string unions only for visual state
  such as the open panel, tab, accordion, or form view.
- Do not copy a generated WASM DTO into an equivalent TypeScript "summary"
  merely to free the wrapper immediately. Let the owning Svelte state retain the
  generated objects, free the previous objects when replacing or resetting that
  state, and pass the generated types directly through component props. A plain
  view model is justified only when it is materially different and UI-only; do
  not add duplicate fields such as `payload` plus `sharePayload`.
- Workflow commands such as Sentinel genesis start arguments and safe recovery
  projections are Rust DTOs. Components may construct and render their generated
  TypeScript shapes, but `nook-web` must not redeclare them.

```ts
// Preferred: ownership stays visible and no runtime wrapper is emitted.
export type { NookStorageProvider as StorageProvider } from "$app-wasm";
export {
  provider_replication_capability,
  provider_supports_replication,
} from "$app-wasm";
```

## Scope

Applies to:

- `nook-app/nook-web/nook-web-shared/src/vault-app/lib/**/*.ts` and Svelte modules that define exported app/domain
  unions, payloads, or validators.
- `nook-app/nook-web/nook-web-extension/src/**/*.ts` when code classifies
  observations, validates product messages, or decides portable workflow
  outcomes.
- `nook-app/nook-web/nook-web-shared/src/extension/**/*.ts` under the same
  conditions.
- `nook-wasm` boundary types that should delegate schema and validation to
  `nook-core`.
- `nook-core` modules that own portable domain models and tests.
- `nook-companion-core` and `nook-companion-wasm` for size-sensitive extension
  policy.

Does not apply to:

- Component-local UI state, view modes, CSS/layout variants, form-only draft
  fields, labels, or browser-only URL/DOM helpers.
- Code that requires browser APIs, IndexedDB, GitHub REST I/O, Web Crypto APIs,
  or session manager state; those belong in `nook-wasm` or `nook-web`, with only
  their portable schema delegated to core. Keep browser lifecycle glue in
  `nook-web`; keep durable storage/provider adapters in `nook-wasm` when Rust has
  a stable abstraction crate for the API.

Calling a browser API does not make the decision based on its result
browser-owned. Keep the API call in TypeScript. Move portable classification of
the returned observation into Rust.

## Examples

Before: TypeScript owns an app/domain schema because the current UI flow needs
it.

```ts
export type EnrollmentProvider =
  { type: "local" } | { type: "github"; pat: string; repo: string };

export type EnrollmentIssueInput = {
  provider: EnrollmentProvider;
  entryId: string;
};
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
    #[wasm_bindgen]
    pub fn local() -> Self {
        Self {
            inner: EnrollmentProvider::Local,
        }
    }

    #[wasm_bindgen]
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
  selectedProvider === "github"
    ? NookEnrollmentProvider.github(githubRepo, githubPat)
    : NookEnrollmentProvider.local();

await issueEnrollmentCode(provider, selectedEntryId);
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

- **Before:** TypeScript computes provider identity or storage-mode rules.

```ts
export function syncProviderTargetKey(
  provider: StorageProvider,
): string | undefined {
  if (provider.type === "github") {
    return `github:${provider.githubRepo?.toLowerCase()}:${provider.githubPat}`;
  }
  // ...
}
```

- **After:** Rust owns provider rules (`StorageProviderType`,
  `OauthFilePreset`, `SyncProviderTarget`, labels, Drive refs, and storage-mode
  mapping) and WASM exports thin helpers.
  - TypeScript may keep the browser IndexedDB snapshot shape.
  - TypeScript calls WASM for the app or domain decision.
- **Before:** TypeScript inspects an IndexedDB database list and returns a
  workflow status.
- **After:** TypeScript calls `indexedDB.databases()` and collects concrete
  database-name observations.
  - Companion Rust decides whether the required database is present.
  - The typed WASM result names the workflow outcome.
- **Absence:** Authored TypeScript and Svelte use neither `undefined` nor `null`
  for absence.
  - When a browser or generated WASM API returns either sentinel, classify the
    outcome at the boundary.
  - Return a meaningfully named discriminated union.

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
`Option` says "present or absent" but says nothing about _what each state means_;
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

- Standard-library / trait signatures that must return `Option` (`get`, `find`,
  `FromStr`-adjacent helpers), internal parsers, and caches. A `Tsify` field or
  `wasm_bindgen` parameter/return must not contain `Option<T>` because generated
  TypeScript represents it as unnamed absence; convert it to a named Rust enum
  first.
- If absence is an error, use a typed `thiserror` variant and `Result<T, E>`;
  do not create an enum variant that merely renames failure.
- When two or more `Option` fields co-vary (present/absent together), that is the
  clearest case that they should collapse into one enum variant carrying a struct
  — see the `GithubSyncProvider` enum-of-structs pattern above.

## Application Checklist

- [ ] Search the requested scope for exported TypeScript types/enums and ask
      whether each is app/domain data or only UI presentation state.
- [ ] Search extension TypeScript for portable decisions expressed through
      `some`, `find`, `filter`, condition chains, validators, and switches.
- [ ] Separate browser observation from portable classification.
- [ ] Keep the browser observation in TypeScript and move the classification to
      companion Rust.
- [ ] Move app/domain schemas and validation into `nook-core` where they are
      portable and testable.
- [ ] Route JS access through typed `nook-wasm` exports instead of plain TS
      schema mirrors.
- [ ] Use an actual Rust/WASM ABI type for domain DTOs. Do not return or accept
      raw `JsValue` and paint a TypeScript type over it with
      `unchecked_return_type` / `unchecked_param_type`; derive the declaration
      and conversion from the Rust type (for example with `Tsify`).
- [ ] Re-export generated WASM bindings directly; remove local aliases and
      same-argument forwarding functions that add no lifecycle or translation
      behavior.
- [ ] Search Svelte state and function parameters for domain identifiers typed
      as `string`; replace them with the generated Rust/WASM identifier type.
- [ ] Search `$state<"...">` and exported TypeScript unions for domain
      workflows; delete write-only or constant state, otherwise move the closed
      set to a Rust/WASM enum.
- [ ] When Svelte retains generated WASM objects, identify one owner and free
      every replaced or reset object exactly once; do not create equivalent
      TypeScript summaries solely to simplify ownership.
- [ ] Treat long wasm functions with many optional parameters (or a flattened
      stringly-typed struct) as a design smell. Model the state as a `nook-core`
      enum-of-structs and expose a thin `#[wasm_bindgen]` newtype wrapper with
      `is_*` / `as_*` accessors instead.
- [ ] Reject positional WASM constructors that mix several counts and boolean
      flags. Accept one named Rust DTO whose enum variants document every
      semantic state.
- [ ] Search custom enum serializers for `serialize_u*` / `serialize_i*`.
      Replace domain ordinals with semantic tagged serialization and typed
      round-trip tests.
- [ ] Treat every `Option<String>` / `Option<T>` in an owned domain type as a
      missing enum. Ask what each state means and replace it with a named enum
      (e.g. `Empty` / `Text(String)`) unless it is a genuine two-state boundary
      DTO or trait/stdlib signature where `Some`/`None` already says everything.
- [ ] Leave UI-only state in TypeScript/Svelte and avoid unrelated cleanup.
- [ ] Add or update Rust tests for moved schema, serialization, and validation.
- [ ] Add Rust tests for every moved extension observation-to-decision rule.

## Validation

Run the smallest relevant Rust and web checks through `task remote`. For
implementation tasks, run `task format`, commit and push, then explicitly
trigger complete validation with `task pr:validate`. `task preflight`
rejects known TypeScript domain mirrors, local aliases of generated `Nook*`
types, same-argument forwarding functions around generated WASM imports,
unchecked WASM type hints, and raw provider/auth `JsValue` DTO signatures.
Extension ownership checks must reject known portable decision patterns after
their Rust replacement lands.

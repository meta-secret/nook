# Rust Coding

## Purpose

Keep Rust domain models precise. Use this when a struct has optional fields,
string tags, sentinel values, or a shared DTO that seems to serve multiple
workflows.

## Problem Pattern

An `Option<T>` can mean one Rust shape is being reused across different worlds.
The code says "maybe this field exists." The real product model may be "this
value is in one named state or another named state."

Required persisted values are another failure mode. `Option<T>` permits an
invalid record to enter the model. Rejection is postponed until unrelated domain
logic runs.

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
- Required persisted or signed values use required validated newtypes. Never use
  `Option<T>`, empty strings, or a `Missing` enum variant.
- Use `Option<T>` only when absence is the truthful structural contract, not a
  disguised product state. Legitimate examples include iterator/lookup results,
  an optional caller filter, an uninitialized cache, and external API fields.
- When a missing value violates an invariant, add a precise `thiserror` variant.
  Return `Result<T, DomainError>` and propagate it with `?`. Do not use either
  `Option<T>` or a decorative `Missing` enum variant for failure.
- When absence means unauthenticated, unauthorized, pending, unsupported,
  configured versus unconfigured, or another named state, use an enum. Put
  state-specific values on the owning variant.
- Do not create a one-variant wrapper enum just to avoid `Option<T>`. If callers
  genuinely ask a lookup question, `Option<T>` is the precise Rust result.
- Do not call `.unwrap()`, `.expect(...)`, or `.expect_err(...)` in authored
  Rust. Production code returns, propagates, or explicitly classifies failure.
  Every fallible test returns a concrete or `anyhow::Result` and propagates with
  `?`, including locally constructed fixtures.
- Keep `anyhow` test-only. Production libraries, binaries, examples, and build
  scripts use concrete `thiserror` enums with operation-specific variants and
  typed sources. Only `#[cfg(test)]` unit tests and integration tests under
  `tests/` may use `anyhow`. Crates declare it under `[dev-dependencies]`.
- Use named domain newtypes for reachable public function parameters, returns, and public struct or enum fields. Do not expose raw `String`, `u8`–`u128`, `i8`–`i128`, `usize`, `isize`, `f32`, or `f64`. Apply this recursively through `Option`, `Result`, collections, tuples, generics, aliases, and bounds. Exclude private implementation details and private inner storage of a newtype. Only legitimate serialization, database, or FFI boundaries may use a narrow item-scoped `expect` with a reason. Blanket `allow` is forbidden.
- Keep raw YAML/JSON strings only at I/O boundaries. Parse them into typed Rust
  records immediately after deserialization, and serialize typed records back to
  wire strings only when crossing storage, provider, or JS boundaries.
- Tests of a known JSON contract serialize and deserialize through the concrete
  Rust wire or domain type, then assert typed fields and enum variants. Do not
  index `serde_json::Value` or use `Value::is_null()` for field-value
  assertions: indexing conflates an omitted property with JSON `null`, discards
  enum exhaustiveness, and turns schema drift into a runtime assertion.
- Raw `serde_json::Value` is reserved for tests whose actual subject is unknown,
  malformed, or deliberately partial JSON. A narrow `Value::Object`/`.get()`
  assertion may verify that a serializer omitted or renamed a property, but
  domain values still require a typed round trip.
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
  `nook-app/nook-platform/nook-core/src`; place them in the owning group and re-export through
  `lib.rs` only when they are part of the stable public core API.
- Rust-owned `Tsify`/WASM domain contracts never author `undefined`, `null`, or
  `void` field states. Do not pair `Option<T>` with a
  `#[tsify(type = "... | undefined")]` override: that merely exports the same
  unnamed absence twice. When absence means not-applicable, unconfigured,
  pending, manual, or another domain state, use a named Rust enum and derive
  the generated boundary type from it.
- Truthful structural omission in external or persisted wire formats may still
  use `Option<T>` internally without a handwritten absence override. A
  `Tsify`-derived field or `wasm_bindgen` parameter/return must not expose
  `Option<T>` because generated TypeScript recreates unnamed absence. Normalize
  it into a named domain state before the exported boundary.
- `void` remains TypeScript's unit/effect return type, equivalent to Rust `()`;
  it is not a serialized field-state escape hatch.

## Enums instead of booleans

Do not use `bool` as an authored domain value by default. Use a named enum even
when the domain currently has exactly two cases.

This rule covers:

- domain and application state;
- struct and enum payload fields;
- public and cross-module function parameters;
- policy, mode, command, and configuration inputs;
- persisted schemas and owned wire contracts; and
- Rust/WASM boundary parameters and fields.

### Why booleans fail

A boolean carries no domain metadata in its value. `true` does not explain what
is true, which policy it selects, or what transition produced it.

That loss of meaning creates several defects.

- **Call sites become abstract.** `sync(true)` makes the reader recover meaning
  from a distant signature.
- **Mental complexity increases.** Every reader must remember what `true` and
  `false` mean for that specific value.
- **Argument order is unsafe.** Two boolean parameters have the same type, so
  swapping them still compiles.
- **Evolution is blocked.** A boolean has only two cases. A third state forces a
  breaking signature, schema, and caller rewrite.
- **Related flags create invalid states.** Multiple booleans form combinations
  the domain may never permit.
- **Review loses intent.** A changed literal shows no domain meaning in a diff.

### Why enums win

An enum carries the domain meaning in the type and in every variant.

- `ProviderSyncFreshness::Forced` explains itself at the call site.
- Distinct enum types prevent parameters from being swapped accidentally.
- A new case becomes another variant of the same coherent vocabulary.
- Exhaustive matching forces every decision point to handle that new case.
- An enum-of-structs keeps state-specific data on the variant that owns it.
- Mutually exclusive states become the only representable states.
- Persisted and generated contracts retain semantic names instead of anonymous
  bits.

Do not create decorative `True` and `False` variants. Name the actual domain
states, such as `Scheduled` and `Forced`, `Locked` and `Unlocked`, or `Absent`
and `Present`.

Before:

```rust
fn sync(force: bool, fail_fast: bool) {
    // Which literal controls which policy at a call site?
}

sync(true, false);
```

After:

```rust
enum ProviderSyncFreshness {
    Scheduled,
    Forced,
}

enum ProviderSyncFailureHandling {
    Capture,
    Propagate,
}

fn sync(
    freshness: ProviderSyncFreshness,
    failure_handling: ProviderSyncFailureHandling,
) {
}

sync(
    ProviderSyncFreshness::Forced,
    ProviderSyncFailureHandling::Capture,
);
```

### Narrow exceptions

An authored `bool` requires a concrete reason. Convenience, fewer lines, or
having only two cases today are not reasons.

The allowed cases are intentionally narrow.

- A standard-library or required trait signature mandates `bool`.
- A fixed external protocol owns a boolean field that Nook cannot change.
  Convert it into a named enum at the boundary before domain policy reads it.
- A private predicate answers a literal yes-or-no query such as `is_empty()` or
  `contains()`. Consume that result immediately. Do not store it as domain
  state or pass it onward as a policy or mode argument.

Additional boundary rules:

- Raw observations are not a general exception. An observation that enters
  domain policy uses a named enum such as `MarkerPresence::Absent` or
  `MarkerPresence::Present`.
- Every retained public parameter, stored field, or lint allowance involving
  `bool` documents which narrow exception applies. Test fixtures and internal
  DTOs do not receive a blanket exemption.
- Do not serialize a boolean that can be derived from an enum. Expose a narrow
  predicate method when a caller genuinely asks a yes-or-no question.

## Options or enums

Once an `Option<T>` represents a named domain state, prefer an enum almost
always. The enum makes the meaning part of the type.

Named enums improve optional domain models in several ways.

- **Names carry intent.** `NotLoaded` explains more than `None`.
- **Matches are exhaustive.** A new variant forces every decision point to
  account for the new state.
- **Illegal combinations disappear.** One enum replaces optional fields that
  could otherwise contradict each other.
- **Payload ownership is explicit.** Each variant carries only the values that
  exist in that state.

Do not use `Option<T>` merely because the state has two cases today. Ask what
`None` means in the domain. Use a named enum when it means empty, not loaded,
cleared, unauthenticated, unsupported, pending, or another real state.

Keep `Option<T>` when the caller is asking whether a value exists. Map lookups,
iterator searches, caches, optional caller filters, and truthful external wire
omissions remain idiomatic uses.

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

Do not preserve optional persisted fields as a compatibility fallback. Current
Nook schemas deserialize directly into required validated values or explicit
state enums and reject incomplete data:

```rust
#[derive(Deserialize)]
struct StoredGithubSyncTarget {
    repo: GithubRepository,
    pat: GithubPersonalAccessToken,
}

enum SyncProviderTarget {
    Github(StoredGithubSyncTarget),
    NotConfigured,
}
```

Required signed event data does not use compatibility optionality in the
current domain shape:

```rust
struct EncryptedSecretPayload {
    identity_fingerprint: SecretFingerprint,
    fingerprint: SecretFingerprint,
}

enum DeviceSigningPublicKey {
    Unavailable,
    Ed25519Hex(String),
}

struct VaultEventBody {
    actor_signing_public_key: DeviceSigningPublicKey,
}
```

The two fingerprints are deliberately distinct. The identity fingerprint
excludes the password/secret value so imports can recognize one logical item.
The version fingerprint includes the secret value so the same identity with a
different password remains a separate version instead of being overwritten.
Both are required and non-empty on encrypted event payloads. The signing-key
type names unavailability explicitly, but current signed events still require
the field and reject that variant. Missing fields are not backfilled through a
compatibility DTO.

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
pub enum E2eVaultExposure {
    Hidden,
    Exposed,
}

#[wasm_bindgen]
pub struct NookRuntimeConfig {
    run_mode: NookClientRunMode,
    e2e_vault_exposure: E2eVaultExposure,
}

#[wasm_bindgen]
impl NookRuntimeConfig {
    #[wasm_bindgen(constructor)]
    pub fn new(
        run_mode: NookClientRunMode,
        e2e_vault_exposure: E2eVaultExposure,
    ) -> Self {
        Self {
            run_mode,
            e2e_vault_exposure,
        }
    }

    #[wasm_bindgen]
    pub fn resolve_vault_idle_timeout_ms(&self, raw_timeout_ms: &str) -> u32 {
        // Use immutable instance state directly.
        300_000
    }

    #[wasm_bindgen]
    pub fn default_vault_idle_timeout_ms(&self) -> u32 {
        300_000
    }
}
```

```ts
class VaultState {
  runtimeConfig = new NookRuntimeConfig(
    NookClientRunModeUtil.parse(import.meta.env.MODE),
    import.meta.env.VITE_E2E_EXPOSE_VAULT === "true"
      ? E2eVaultExposure.Exposed
      : E2eVaultExposure.Hidden,
  );
}

const rawIdleTimeout = import.meta.env.VITE_VAULT_IDLE_TIMEOUT_MS;
const idleTimeout = rawIdleTimeout
  ? vault.runtimeConfig.resolve_vault_idle_timeout_ms(rawIdleTimeout)
  : vault.runtimeConfig.default_vault_idle_timeout_ms();
```

## Scope

Applies to authored Rust domain and bridge code across Nook, especially
`nook-auth2`, `nook-event-log`, `nook-core`, and `nook-wasm`,
especially provider targets, enrollment payloads, vault state, sync state,
storage modes, credential states, and WASM DTOs.

Raw external API or user-controlled partial-input DTOs may remain permissive.
Convert them immediately into domain enums, required validated newtypes, or
typed errors. Persisted Nook schemas do not receive a legacy fallback unless a
task explicitly requires a migration.

It also does not replace idiomatic `Option<T>` return values from maps,
iterators, parsers, searches, or caches when the caller is genuinely asking
whether a value exists.

## Validation

- Add or update tests for each new enum state.
- Make fallible Rust tests return `Result<(), E>` and use `?` for setup and
  verification. Panic shortcuts are prohibited; do not replace one with
  another or hide it behind a helper.
- Do not use `Box<dyn std::error::Error>` as a catch-all test error. Return the
  concrete crate error for one error family, or `anyhow::Result` when the test
  intentionally combines unrelated error types.
- Add deserialization tests proving required persisted values reject missing and
  empty input.
- Search Rust-owned `Tsify` DTOs for authored `type =` overrides. The
  repository preflight must report zero `undefined`, `null`, or `void`
  sentinels in those overrides.
- Search known-contract tests for `serde_json::Value`, `json["..."]`, and
  `.is_null()`. Replace field-value checks with typed round trips and enum/value
  assertions. Keep raw values only where malformed/unknown JSON or exact
  property presence is the behavior under test.
- Run Clippy for all targets with `clippy::expect_used` and
  `clippy::unwrap_used` denied and workspace `clippy.toml` keeping
  `allow-expect-in-tests` / `allow-unwrap-in-tests` false. Clippy owns panic
  shortcuts; do not add a duplicate syn scanner. Run the syntax-aware
  preflight that rejects production `anyhow` paths and non-dev Cargo
  dependencies.
- Check that helper APIs accept typed variants/enums instead of strings or
  optional field bags.
- Inventory reachable public numeric APIs recursively. Enforce them with `raw_numeric_public_api`. Separately inventory authored Rust `bool` fields, parameters, returns, and allowances.
- Replace every domain, state, policy, mode, command, configuration, persisted,
  and owned-boundary boolean with a meaningfully named enum.
- Keep a boolean only for a required trait, fixed external protocol, or private
  immediately consumed predicate. Document the exact exception.
- Review every `clippy::fn_params_excessive_bools` and
  `clippy::struct_excessive_bools` allowance in the changed scope. An allowance
  is not justification and should normally disappear with the refactor.
- Run targeted portable Rust tests plus `cd nook-app/nook-platform && cargo clippy -p
nook-app-common -p nook-core -p nook-auth2 -p nook-replication -p nook-event-log --all-targets -- -D warnings`.
- When exposed to web, regenerate wasm bindings and run the web type check.

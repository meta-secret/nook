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
- It is acceptable for simple core DTOs to carry wasm/serialization annotations
  needed for boundary exposure, as long as `nook-core` does not gain browser
  APIs, I/O, session state, or wasm-specific behavior.
- Use `nook-wasm` for bridge concerns: wasm exports, session manager methods,
  IndexedDB/GitHub/browser I/O, and conversions between JS calls and core
  types.
- Keep `nook-web` focused on Svelte rendering, form state, component props,
  labels, and calling typed wasm APIs.

## Scope

Applies to:

- `nook-web/src/lib/**/*.ts` and Svelte modules that define exported app/domain
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
pub struct NookEnrollmentProvider {
    inner: EnrollmentProvider,
}

#[wasm_bindgen]
impl NookEnrollmentProvider {
    #[wasm_bindgen(js_name = local)]
    pub fn local() -> Self {
        Self { inner: EnrollmentProvider::Local }
    }

    #[wasm_bindgen(js_name = github)]
    pub fn github(pat: String, repo: String) -> Self {
        Self { inner: EnrollmentProvider::Github { pat, repo } }
    }
}
```

```ts
const provider =
  selectedProvider === 'github'
    ? NookEnrollmentProvider.github(githubPat, githubRepo)
    : NookEnrollmentProvider.local()

await issueEnrollmentCode(provider, selectedEntryId)
```

## Application Checklist

- [ ] Search the requested scope for exported TypeScript types/enums and ask
      whether each is app/domain data or only UI presentation state.
- [ ] Move app/domain schemas and validation into `nook-core` where they are
      portable and testable.
- [ ] Route JS access through typed `nook-wasm` exports instead of plain TS
      schema mirrors.
- [ ] Leave UI-only state in TypeScript/Svelte and avoid unrelated cleanup.
- [ ] Add or update Rust tests for moved schema, serialization, and validation.

## Validation

Run the smallest relevant Rust and web checks for the touched boundary first.
For implementation tasks, finish with `task check` before push.

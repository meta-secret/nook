---
name: rust-coding
description: >-
  Apply Nook's Rust domain-modeling, error-handling, typed-boundary, and module
  cohesion rules. Use when editing portable Rust or Rust/WASM bridge code.
---

# Rust Coding

Use this skill when editing Rust domain or WASM-boundary code in Nook.

Read [the canonical development-core skill](../../../.cortex/teams/dev-core/dynamic-skills/rust-coding.md)
before making changes. Apply its
core rule aggressively: if a Rust struct contains `Option<T>`, ask what named
state the absence represents. Prefer enums with per-variant structs over shared
DTOs with optional fields, string tags, or sentinel values.

Do not apply this as a textual ban on `Option<T>`. Keep it for truthful
structural absence such as iterator and lookup results, optional external
inputs, caches, and raw compatibility DTOs. Required persisted values use
required validated newtypes. Named product/lifecycle/auth states use enums.

Do not use `.unwrap()` or `.expect(...)` in authored Rust. Production code
propagates or classifies failure; tests return `Result` and use `?`. Keep
`clippy::expect_used` and `clippy::unwrap_used` denied for every target, with
workspace `clippy.toml` keeping both denied in tests.

When the optionality comes from persisted JSON or browser storage, keep the raw
compatibility shape only at the boundary and convert it into a typed Rust enum
before domain logic.

Do not keep raw `String` fields for domain timestamps, YAML payloads,
provider/storage tags, ids, or secret keys when a core newtype or enum can
represent them. Parse persisted/browser strings into typed Rust values as early
as possible, serialize back only at I/O or JS boundaries, and reuse core types
instead of duplicating structs/enums in WASM wrappers.

Do not expose WASM DTO fields named `yaml` for event/vault records when the real
payload is a typed domain value. Keep sync/merge DTOs typed, for example
`event: VaultEvent`, and use explicit parse/serialize helpers only at browser
file/provider read-write boundaries.

Keep stateful WASM manager objects composed from cohesive private state structs
instead of flat field bags. Provider credentials/cache, vault session state,
device identity, event-log state, status channels, and outbox state should not
all live as sibling fields on one exported manager.

Keep `nook-core` organized under domain module groups (`auth`, `crypto`,
`secrets`, `sync`, `vault`). New domain files should go into the owning group;
root `lib.rs` is the public export surface and internal compatibility alias
surface, not a place to keep growing a flat source directory.

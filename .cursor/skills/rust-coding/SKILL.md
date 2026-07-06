# Rust Coding

Use this skill when editing Rust domain or WASM-boundary code in Nook.

Read `.cortex/dynamic-skills/rust-coding.md` before making changes. Apply its
core rule aggressively: if a Rust struct contains `Option<T>`, ask what named
state the absence represents. Prefer enums with per-variant structs over shared
DTOs with optional fields, string tags, or sentinel values.

When the optionality comes from persisted JSON or browser storage, keep the raw
compatibility shape only at the boundary and convert it into a typed Rust enum
before domain logic.

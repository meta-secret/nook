# Nook domain API lint

`raw_numeric_public_api` rejects raw numeric primitives in effectively public
Rust function parameters, return types, and struct or enum fields. It follows
numeric types through references, arrays, slices, tuples, function pointers,
type aliases, and generic arguments such as `Option<u64>`, `Result<T, u32>`,
`Vec<u8>`, and project-defined generic containers. It deliberately does not
inspect private implementation details or the private storage field of a
newtype.

Both `raw_numeric_public_api` and its suppression-policy companion
`invalid_raw_numeric_api_suppression` are `allow` by default so crates can
migrate one at a time. A migrated crate denies the API lint and separately
forbids lowering or bypassing the suppression policy, only while the Dylint
library is loaded:

```rust
#![cfg_attr(dylint_lib = "nook_domain_api", forbid(invalid_raw_numeric_api_suppression))]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(raw_numeric_public_api))]
```

## Boundary expectations

A raw numeric type may remain only at a serialization, database, or FFI
boundary. Suppression is item-scoped, uses `expect` rather than `allow`, and
includes a reason beginning with the applicable boundary category:

```rust
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(
        raw_numeric_public_api,
        reason = "serialization boundary: converts the validated version to its wire integer"
    )
)]
pub const fn wire_version(self) -> u32 {
    self.0
}
```

The companion lint enforces this contract: it rejects crate-, module-, type-,
variant-, and other blanket suppression; rejects `allow`; requires a nonempty
reason; and accepts only `serialization boundary:`, `database boundary:`, or
`FFI boundary:` followed by an explanation on a callable or field. Do not use a
boundary expectation for internal convenience, collection lengths, arithmetic,
timestamps, offsets, or domain counts. Introduce a named domain type instead.
`expect` is required so the compiler reports the annotation when the raw
boundary disappears. Enabling levels (`warn`, `deny`, and `forbid`) are policy
configuration rather than suppression and are intentionally accepted.

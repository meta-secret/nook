use super::wasm_bindgen;

/// Decode external provider snapshots through the Rust-owned serde contract.
///
/// `Tsify` performs the JavaScript-to-Rust conversion before this function
/// runs. Invalid nested variants fail at that boundary. Valid legacy rows are
/// normalized by serde defaults before returning to TypeScript.
#[wasm_bindgen(js_name = decodeStorageProviders)]
#[must_use]
pub fn decode_storage_providers(
    snapshot: nook_core::AuthProvidersSnapshotData,
) -> nook_core::AuthProvidersSnapshotData {
    snapshot
}

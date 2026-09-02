use super::wasm_bindgen;

/// Decode external provider snapshots through the Rust-owned serde contract.
///
#[wasm_bindgen]
pub fn decode_storage_providers(
    #[wasm_bindgen(unchecked_param_type = "AuthProvidersSnapshot")] snapshot: wasm_bindgen::JsValue,
) -> Result<nook_core::AuthProvidersSnapshotData, wasm_bindgen::JsError> {
    serde_wasm_bindgen::from_value(snapshot)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
}

#[cfg(all(test, target_arch = "wasm32"))]
mod wasm_tests {
    use super::*;
    use wasm_bindgen_test::wasm_bindgen_test;

    const LEGACY_PROVIDER_SNAPSHOT: &str = r#"{
        "providers": [{
            "id": "github",
            "type": "github",
            "label": "GitHub",
            "githubPat": { "state": "token", "value": "github_pat_fixture" },
            "githubRepo": { "state": "repository", "value": "owner/repo" },
            "oauthFile": { "state": "notApplicable" },
            "localFolder": { "state": "notApplicable" },
            "storeId": { "state": "unscoped" },
            "createdAt": "2026-08-08T00:00:00.000Z"
        }],
        "activeVaultStoreId": { "state": "unselected" }
    }"#;

    const MALFORMED_PROVIDER_SNAPSHOT: &str = r#"{
        "providers": [{
            "id": "github",
            "type": "github",
            "label": "GitHub",
            "githubPat": { "state": "token" },
            "githubRepo": { "state": "repository", "value": "owner/repo" },
            "oauthFile": { "state": "notApplicable" },
            "localFolder": { "state": "notApplicable" },
            "storeId": { "state": "unscoped" },
            "createdAt": "2026-08-08T00:00:00.000Z"
        }],
        "activeVaultStoreId": { "state": "unselected" }
    }"#;

    fn decode_snapshot_json(
        input: &str,
    ) -> Result<nook_core::AuthProvidersSnapshotData, wasm_bindgen::JsError> {
        let value = js_sys::JSON::parse(input)
            .map_err(|_| wasm_bindgen::JsError::new("provider fixture must parse"))?;
        decode_storage_providers(value)
    }

    #[wasm_bindgen_test]
    fn provider_decoder_normalizes_legacy_javascript_snapshot() -> Result<(), wasm_bindgen::JsError>
    {
        let decoded = decode_snapshot_json(LEGACY_PROVIDER_SNAPSHOT)?;

        assert_eq!(
            decoded.providers[0].sync_checkpoint,
            nook_core::ProviderSyncCheckpoint::NeverSynced
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    fn provider_decoder_rejects_malformed_nested_javascript_variant()
    -> Result<(), wasm_bindgen::JsError> {
        assert!(decode_snapshot_json(MALFORMED_PROVIDER_SNAPSHOT).is_err());
        Ok(())
    }

    #[wasm_bindgen_test]
    fn provider_decoder_rejects_foreign_provider_field() {
        let foreign =
            LEGACY_PROVIDER_SNAPSHOT.replace("\"createdAt\"", "\"foreign\": true, \"createdAt\"");
        assert!(decode_snapshot_json(&foreign).is_err());
    }
}

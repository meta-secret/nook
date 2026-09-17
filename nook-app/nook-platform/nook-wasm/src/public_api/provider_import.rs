use nook_core::{ProviderCredentialStorageAdmission, StorageProvider};
use serde::{Deserialize, Serialize};
use tsify::Tsify;
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

/// Unknown Chrome pairing value decoded through the canonical provider schema.
#[derive(Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "unknown", from_wasm_abi)]
pub struct ExtensionPairingStorageProviderAdmission(StorageProvider);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ExtensionPairingStorageProviderFailure {
    PlaintextCredential,
}

impl ExtensionPairingStorageProviderAdmission {
    fn decode(
        &mut self,
    ) -> Result<ExtensionPairingStorageProviderPayload, ExtensionPairingStorageProviderFailure>
    {
        if self.0.credential_storage_admission()
            != ProviderCredentialStorageAdmission::MarkerCompatible
        {
            self.0.zeroize_credentials();
            return Err(ExtensionPairingStorageProviderFailure::PlaintextCredential);
        }
        Ok(ExtensionPairingStorageProviderPayload(self.0.clone()))
    }
}

impl Drop for ExtensionPairingStorageProviderAdmission {
    fn drop(&mut self) {
        self.0.zeroize_credentials();
    }
}

/// Generated provider payload returned to Web after Rust admission.
#[derive(Serialize, Tsify)]
#[serde(transparent)]
#[tsify(into_wasm_abi)]
pub struct ExtensionPairingStorageProviderPayload(StorageProvider);

impl Drop for ExtensionPairingStorageProviderPayload {
    fn drop(&mut self) {
        self.0.zeroize_credentials();
    }
}

/// Decode one extension-pairing provider and reject plaintext credentials.
#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn decode_extension_pairing_storage_provider(
    mut admission: ExtensionPairingStorageProviderAdmission,
) -> Result<ExtensionPairingStorageProviderPayload, JsError> {
    admission.decode().map_err(|_| {
        JsError::new("Extension pairing provider credentials are not storage-safe.")
    })
}

/// Decode external provider snapshots through the Rust-owned serde contract.
///
/// `Tsify` performs the JavaScript-to-Rust conversion before this function
/// runs. Invalid nested variants fail at that boundary. Valid legacy rows are
/// normalized by serde defaults before returning to TypeScript.
#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn decode_storage_providers(
    snapshot: nook_core::AuthProvidersSnapshotData,
) -> nook_core::AuthProvidersSnapshotData {
    snapshot
}

#[cfg(all(test, target_arch = "wasm32"))]
mod wasm_tests {
    use super::*;
    use js_sys::JSON;
    use nook_core::ProviderSyncCheckpoint;
    use wasm_bindgen::JsError;
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
        let value = JSON::parse(input).map_err(|_| JsError::new("provider fixture must parse"))?;
        // Tsify's generated `from_wasm_abi` implementation delegates to this
        // exact serde-wasm conversion for `AuthProvidersSnapshotData`.
        serde_wasm_bindgen::from_value(value).map_err(|error| JsError::new(&error.to_string()))
    }

    #[wasm_bindgen_test]
    fn provider_decoder_normalizes_legacy_javascript_snapshot() -> Result<(), wasm_bindgen::JsError>
    {
        let snapshot = decode_snapshot_json(LEGACY_PROVIDER_SNAPSHOT)?;
        let decoded = decode_storage_providers(snapshot);

        assert_eq!(
            decoded.providers[0].sync_checkpoint,
            ProviderSyncCheckpoint::NeverSynced
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    fn provider_decoder_rejects_malformed_nested_javascript_variant()
    -> Result<(), wasm_bindgen::JsError> {
        assert!(decode_snapshot_json(MALFORMED_PROVIDER_SNAPSHOT).is_err());
        Ok(())
    }
}

#[cfg(test)]
mod extension_pairing_provider_tests {
    use super::*;
    use nook_core::{
        OAuthFileConfigData, StoredGithubPat, StoredOAuthAccessCredential,
        StoredOAuthFileConfiguration, StoredOAuthRefreshCredential,
    };

    const ARMORED_SECRET: &str = "-----BEGIN AGE ENCRYPTED FILE-----\\nfixture";

    struct ProviderFixture;

    impl ProviderFixture {
        fn json(github_pat: &str) -> String {
            format!(
                r#"{{"id":"github","type":"github","label":"GitHub","githubPat":{{"state":"token","value":"{github_pat}"}},"githubRepo":{{"state":"repository","value":"owner/repo"}},"oauthFile":{{"state":"notApplicable"}},"localFolder":{{"state":"notApplicable"}},"storeId":{{"state":"unscoped"}},"syncCheckpoint":{{"state":"neverSynced"}},"createdAt":"2026-08-08T00:00:00.000Z"}}"#
            )
        }
    }

    #[test]
    fn pairing_provider_admission_is_unknown_and_returns_generated_payload() -> anyhow::Result<()> {
        assert!(ExtensionPairingStorageProviderAdmission::DECL.ends_with(" = unknown;"));
        assert!(ExtensionPairingStorageProviderPayload::DECL.contains("StorageProvider"));
        let admission = serde_json::from_str::<ExtensionPairingStorageProviderAdmission>(
            &ProviderFixture::json(ARMORED_SECRET),
        )?;
        let payload = decode_extension_pairing_storage_provider(admission)
            .map_err(|_| anyhow::anyhow!("armored provider must be admitted"))?;
        assert!(matches!(&payload.0.github_pat, StoredGithubPat::Token(_)));
        Ok(())
    }

    #[test]
    fn pairing_provider_admission_rejects_missing_fields_and_wrong_types() {
        let extended = ProviderFixture::json(ARMORED_SECRET)
            .replace("\"createdAt\"", "\"futureField\":true,\"createdAt\"");
        assert!(
            serde_json::from_str::<ExtensionPairingStorageProviderAdmission>(&extended).is_ok()
        );
        let missing = ProviderFixture::json(ARMORED_SECRET).replace("\"label\":\"GitHub\",", "");
        assert!(
            serde_json::from_str::<ExtensionPairingStorageProviderAdmission>(&missing).is_err()
        );
        let wrong_type = ProviderFixture::json(ARMORED_SECRET)
            .replace("\"label\":\"GitHub\"", "\"label\":false");
        assert!(
            serde_json::from_str::<ExtensionPairingStorageProviderAdmission>(&wrong_type).is_err()
        );
    }

    #[test]
    fn pairing_provider_decoder_rejects_plaintext_and_cleanup_clears_sensitive_fields()
    -> anyhow::Result<()> {
        let mut admission = serde_json::from_str::<ExtensionPairingStorageProviderAdmission>(
            &ProviderFixture::json("plaintext-token"),
        )?;
        assert!(matches!(
            admission.decode(),
            Err(ExtensionPairingStorageProviderFailure::PlaintextCredential)
        ));
        assert_eq!(
            admission.0.github_pat,
            StoredGithubPat::Token(String::new())
        );

        let mut provider =
            serde_json::from_str::<StorageProvider>(&ProviderFixture::json(ARMORED_SECRET))?;
        provider.oauth_file = StoredOAuthFileConfiguration::Configured(OAuthFileConfigData {
            access_token: StoredOAuthAccessCredential::AccessToken(ARMORED_SECRET.to_owned()),
            refresh_token: StoredOAuthRefreshCredential::Token(ARMORED_SECRET.to_owned()),
            ..OAuthFileConfigData::default()
        });
        provider.zeroize_credentials();
        assert_eq!(provider.github_pat, StoredGithubPat::Token(String::new()));
        if let StoredOAuthFileConfiguration::Configured(oauth) = provider.oauth_file {
            assert_eq!(
                oauth.access_token,
                StoredOAuthAccessCredential::AccessToken(String::new())
            );
            assert_eq!(
                oauth.refresh_token,
                StoredOAuthRefreshCredential::Token(String::new())
            );
        } else {
            anyhow::bail!("configured OAuth credentials must remain structurally configured");
        }
        Ok(())
    }
}

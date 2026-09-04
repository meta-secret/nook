//! Exact-key classification of untrusted browser pairing storage.

use super::{ExtensionPairingRecord, StoredExtensionPairingGrant, grant_storage_key};
use serde::{Deserialize, Serialize};
use tsify::Tsify;

#[derive(Debug, Deserialize, Serialize, Tsify)]
#[serde(transparent)]
#[tsify(from_wasm_abi)]
pub struct PairingStorageJson(String);

impl From<String> for PairingStorageJson {
    fn from(value: String) -> Self {
        Self(value)
    }
}

/// The exact requested identifier, before stored authority is validated.
#[derive(Debug, Deserialize, Serialize, Tsify)]
#[serde(transparent)]
#[tsify(from_wasm_abi)]
pub struct RequestedPairingVaultId(String);

impl From<String> for RequestedPairingVaultId {
    fn from(value: String) -> Self {
        Self(value)
    }
}

#[derive(Debug, Deserialize, Serialize, Tsify)]
#[tsify(from_wasm_abi)]
pub struct ExtensionGrantAuthorityRequest {
    pub stored_json: PairingStorageJson,
    pub vault_store_id: RequestedPairingVaultId,
}

/// Validated stored metadata, not proof of current event-log access or unlock.
#[derive(Debug, PartialEq, Eq, Serialize, Tsify)]
#[tsify(into_wasm_abi)]
pub struct AuthorizedExtensionGrant {
    grant: StoredExtensionPairingGrant,
}

#[derive(Debug, PartialEq, Eq, Serialize, Tsify)]
#[serde(tag = "kind")]
#[tsify(into_wasm_abi)]
pub enum ExtensionGrantAuthority {
    NoMatchingAuthority,
    InvalidStoredAuthority,
    Authorized(Box<AuthorizedExtensionGrant>),
}

impl ExtensionGrantAuthorityRequest {
    #[must_use]
    pub fn classify(self) -> ExtensionGrantAuthority {
        let Ok(serde_json::Value::Object(mut entries)) = serde_json::from_str(&self.stored_json.0)
        else {
            return ExtensionGrantAuthority::InvalidStoredAuthority;
        };
        let key = grant_storage_key(&self.vault_store_id.0);
        let Some(value) = entries.remove(&key) else {
            return ExtensionGrantAuthority::NoMatchingAuthority;
        };
        let Ok(grant) = serde_json::from_value::<StoredExtensionPairingGrant>(value) else {
            return ExtensionGrantAuthority::InvalidStoredAuthority;
        };
        let record = ExtensionPairingRecord::Grant(grant);
        let Ok(()) = record.validate_for_key(&key) else {
            return ExtensionGrantAuthority::InvalidStoredAuthority;
        };
        let ExtensionPairingRecord::Grant(grant) = record else {
            return ExtensionGrantAuthority::InvalidStoredAuthority;
        };
        ExtensionGrantAuthority::Authorized(Box::new(AuthorizedExtensionGrant { grant }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture;

    impl Fixture {
        fn request(stored_json: String) -> ExtensionGrantAuthorityRequest {
            ExtensionGrantAuthorityRequest {
                stored_json: stored_json.into(),
                vault_store_id: "store-test".to_owned().into(),
            }
        }

        fn grant() -> StoredExtensionPairingGrant {
            StoredExtensionPairingGrant {
                vault_type: super::super::ExtensionPairingVaultType::Simple,
                device_id: "device-test".to_owned(),
                device_public_key: "age1test".to_owned(),
                device_signing_public_key: "signing-test".to_owned(),
                device_label: "Nook Extension".to_owned(),
                vault_store_id: "store-test".to_owned(),
                vault_name: "Personal".to_owned(),
                approved_at: "2026-07-25T00:00:00.000Z".to_owned(),
                scopes: vec![super::super::ExtensionConnectScope::PasswordFilling],
                sync_provider_count: 1,
                event_count: 2,
                event_log_heads: vec!["event-2".to_owned()],
                last_local_sync_at: "2026-07-25T00:00:01.000Z".to_owned(),
            }
        }
    }

    #[test]
    fn absent_target_does_not_consult_unrelated_rows() {
        for json in ["{}", r#"{"unrelated":null}"#] {
            assert_eq!(
                Fixture::request(json.to_owned()).classify(),
                ExtensionGrantAuthority::NoMatchingAuthority
            );
        }
    }

    #[test]
    fn rejects_malformed_root_or_target() {
        for json in [
            "invalid",
            "null",
            "[]",
            "42",
            r#"{"nook:extension-pairing-grant:store-test":null}"#,
            r#"{"nook:extension-pairing-grant:store-test":{}}"#,
        ] {
            assert_eq!(
                Fixture::request(json.to_owned()).classify(),
                ExtensionGrantAuthority::InvalidStoredAuthority
            );
        }
    }

    #[test]
    fn valid_exact_target_ignores_malformed_unrelated_row() -> anyhow::Result<()> {
        let grant = Fixture::grant();
        let mut entries = serde_json::Map::new();
        entries.insert(
            grant_storage_key("store-test"),
            serde_json::to_value(&grant)?,
        );
        entries.insert("unrelated".to_owned(), serde_json::Value::Null);
        assert_eq!(
            Fixture::request(serde_json::to_string(&entries)?).classify(),
            ExtensionGrantAuthority::Authorized(Box::new(AuthorizedExtensionGrant { grant }))
        );
        Ok(())
    }

    #[test]
    fn rejects_mismatched_key_and_incomplete_grant() -> anyhow::Result<()> {
        let mut mismatched = Fixture::grant();
        mismatched.vault_store_id = "another-store".to_owned();
        let mut incomplete = Fixture::grant();
        incomplete.scopes.clear();
        for grant in [mismatched, incomplete] {
            let entries =
                std::collections::HashMap::from([(grant_storage_key("store-test"), grant)]);
            assert_eq!(
                Fixture::request(serde_json::to_string(&entries)?).classify(),
                ExtensionGrantAuthority::InvalidStoredAuthority
            );
        }
        Ok(())
    }

    #[test]
    fn generated_contract_preserves_names_and_authorized_payload() -> anyhow::Result<()> {
        for variant in [
            "NoMatchingAuthority",
            "InvalidStoredAuthority",
            "Authorized",
        ] {
            assert!(ExtensionGrantAuthority::DECL.contains(variant));
        }
        assert!(ExtensionGrantAuthorityRequest::DECL.contains("stored_json"));
        assert!(ExtensionGrantAuthorityRequest::DECL.contains("vault_store_id"));
        assert!(AuthorizedExtensionGrant::DECL.contains("grant: StoredExtensionPairingGrant"));
        #[derive(Deserialize)]
        #[serde(tag = "kind")]
        enum Wire {
            Authorized { grant: StoredExtensionPairingGrant },
        }
        let grant = Fixture::grant();
        let outcome = ExtensionGrantAuthority::Authorized(Box::new(AuthorizedExtensionGrant {
            grant: grant.clone(),
        }));
        let Wire::Authorized { grant: decoded } =
            serde_json::from_str(&serde_json::to_string(&outcome)?)?;
        assert_eq!(decoded, grant);
        Ok(())
    }
}

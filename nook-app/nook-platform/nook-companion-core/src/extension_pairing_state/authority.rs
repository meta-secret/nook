//! Exact-key classification of untrusted browser pairing storage.

use super::{ExtensionPairingRecord, StoredExtensionPairingGrant, grant_storage_key};
use serde::{Deserialize, Serialize};
use tsify::Tsify;

mod response;
pub use response::*;

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize, Tsify)]
#[serde(transparent)]
#[tsify(from_wasm_abi)]
pub struct PairingStorageJson(String);

impl From<String> for PairingStorageJson {
    fn from(value: String) -> Self {
        Self(value)
    }
}

/// An exact pairing identifier, before stored authority is validated.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize, Tsify)]
#[serde(transparent)]
#[tsify(from_wasm_abi)]
pub struct PairingVaultId(String);

impl From<String> for PairingVaultId {
    fn from(value: String) -> Self {
        Self(value)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize, Tsify)]
#[serde(deny_unknown_fields)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct ActiveExtensionVault {
    pub vault_store_id: PairingVaultId,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize, Tsify)]
#[serde(tag = "kind", deny_unknown_fields)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum ExtensionActiveVaultScope {
    NoActiveVault,
    Active(ActiveExtensionVault),
}

#[derive(Debug, Deserialize, Serialize, Tsify)]
#[tsify(from_wasm_abi)]
pub struct ExtensionGrantAuthorityRequest {
    pub stored_json: PairingStorageJson,
    pub vault_store_id: PairingVaultId,
    pub active_vault: ExtensionActiveVaultScope,
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
    MissingActiveAuthority,
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
            return match self.active_vault {
                ExtensionActiveVaultScope::Active(active)
                    if active.vault_store_id == self.vault_store_id =>
                {
                    ExtensionGrantAuthority::MissingActiveAuthority
                }
                ExtensionActiveVaultScope::Active(_) | ExtensionActiveVaultScope::NoActiveVault => {
                    ExtensionGrantAuthority::NoMatchingAuthority
                }
            };
        };
        ExtensionGrantAuthority::from_target_value(value, &key)
    }
}

impl ExtensionGrantAuthority {
    fn from_target_value(value: serde_json::Value, key: &str) -> Self {
        let Ok(grant) = serde_json::from_value::<StoredExtensionPairingGrant>(value) else {
            return ExtensionGrantAuthority::InvalidStoredAuthority;
        };
        let record = ExtensionPairingRecord::Grant(grant);
        let Ok(()) = record.validate_for_key(key) else {
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
                active_vault: ExtensionActiveVaultScope::NoActiveVault,
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
    fn absent_grant_closes_only_the_exact_active_vault() {
        for (vault, expected) in [
            (
                "store-test",
                ExtensionGrantAuthority::MissingActiveAuthority,
            ),
            ("other-store", ExtensionGrantAuthority::NoMatchingAuthority),
        ] {
            let mut request = Fixture::request("{}".to_owned());
            request.active_vault = ExtensionActiveVaultScope::Active(ActiveExtensionVault {
                vault_store_id: vault.to_owned().into(),
            });
            assert_eq!(request.classify(), expected);
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
            "MissingActiveAuthority",
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
        let response = serde_json::to_string(&outcome)?;
        assert_eq!(
            GrantAuthorityResponseJson::from(response.clone())
                .decode("store-test".to_owned().into())?,
            outcome
        );
        assert!(
            GrantAuthorityResponseJson::from(response)
                .decode("another-store".to_owned().into())
                .is_err()
        );
        Ok(())
    }
}

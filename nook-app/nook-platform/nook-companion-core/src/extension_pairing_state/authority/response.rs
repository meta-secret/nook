//! Untrusted offscreen response decoding with requested-vault binding.
use super::{ExtensionGrantAuthority, PairingVaultId, StoredExtensionPairingGrant};
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(tag = "kind", deny_unknown_fields)]
#[allow(clippy::large_enum_variant)]
enum GrantAuthorityResponseWire {
    NoMatchingAuthority,
    MissingActiveAuthority,
    InvalidStoredAuthority,
    Authorized { grant: StoredExtensionPairingGrant },
}
use tsify::Tsify;

#[derive(Debug, Deserialize, Serialize, Tsify)]
#[serde(transparent)]
#[tsify(from_wasm_abi)]
pub struct GrantAuthorityResponseJson(String);

impl From<String> for GrantAuthorityResponseJson {
    fn from(value: String) -> Self {
        Self(value)
    }
}

#[derive(Debug, thiserror::Error)]
#[error("invalid extension grant authority response")]
pub struct GrantAuthorityResponseError;

impl GrantAuthorityResponseJson {
    pub fn decode(
        self,
        requested: PairingVaultId,
    ) -> Result<ExtensionGrantAuthority, GrantAuthorityResponseError> {
        let PairingVaultId(requested) = requested;
        let requested_key = StoredExtensionPairingGrant::storage_key_for(&requested);
        let wire: GrantAuthorityResponseWire =
            serde_json::from_str(&self.0).map_err(|_| GrantAuthorityResponseError)?;
        let result = match wire {
            GrantAuthorityResponseWire::NoMatchingAuthority => {
                ExtensionGrantAuthority::NoMatchingAuthority
            }
            GrantAuthorityResponseWire::MissingActiveAuthority => {
                ExtensionGrantAuthority::MissingActiveAuthority
            }
            GrantAuthorityResponseWire::InvalidStoredAuthority => {
                ExtensionGrantAuthority::InvalidStoredAuthority
            }
            GrantAuthorityResponseWire::Authorized { grant } => {
                let result = ExtensionGrantAuthority::from_target_grant(grant, &requested_key);
                let ExtensionGrantAuthority::Authorized(_) = &result else {
                    return Err(GrantAuthorityResponseError);
                };
                result
            }
        };
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_missing_malformed_and_unknown_response_shapes() {
        for json in [
            "null",
            "{}",
            r#"{"kind":"Unknown"}"#,
            r#"{"kind":"NoMatchingAuthority","grant":{}}"#,
            r#"{"kind":"Authorized","grant":{}}"#,
        ] {
            assert!(
                GrantAuthorityResponseJson::from(json.to_owned())
                    .decode(PairingVaultId::from("store-test".to_owned()))
                    .is_err()
            );
        }
    }

    #[test]
    fn closed_unit_outcomes_round_trip() -> Result<(), GrantAuthorityResponseError> {
        for (json, expected) in [
            (
                r#"{"kind":"NoMatchingAuthority"}"#,
                ExtensionGrantAuthority::NoMatchingAuthority,
            ),
            (
                r#"{"kind":"MissingActiveAuthority"}"#,
                ExtensionGrantAuthority::MissingActiveAuthority,
            ),
            (
                r#"{"kind":"InvalidStoredAuthority"}"#,
                ExtensionGrantAuthority::InvalidStoredAuthority,
            ),
        ] {
            assert_eq!(
                GrantAuthorityResponseJson::from(json.to_owned())
                    .decode(PairingVaultId::from("store-test".to_owned()))?,
                expected
            );
        }
        Ok(())
    }
}

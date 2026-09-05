//! Untrusted offscreen response decoding with requested-vault binding.
use super::{ExtensionGrantAuthority, PairingVaultId};
use crate::extension_pairing_state as pairing;
use serde::{Deserialize, Serialize};
use serde_json::Value;
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
        let requested_key = pairing::grant_storage_key(&requested);
        let Value::Object(mut fields) =
            serde_json::from_str(&self.0).map_err(|_| GrantAuthorityResponseError)?
        else {
            return Err(GrantAuthorityResponseError);
        };
        let Some(Value::String(kind)) = fields.remove("kind") else {
            return Err(GrantAuthorityResponseError);
        };
        let result = match kind.as_str() {
            "NoMatchingAuthority" => ExtensionGrantAuthority::NoMatchingAuthority,
            "MissingActiveAuthority" => ExtensionGrantAuthority::MissingActiveAuthority,
            "InvalidStoredAuthority" => ExtensionGrantAuthority::InvalidStoredAuthority,
            "Authorized" => {
                let value = fields.remove("grant").ok_or(GrantAuthorityResponseError)?;
                let result = ExtensionGrantAuthority::from_target_value(value, &requested_key);
                let ExtensionGrantAuthority::Authorized(_) = &result else {
                    return Err(GrantAuthorityResponseError);
                };
                result
            }
            _ => return Err(GrantAuthorityResponseError),
        };
        if !fields.is_empty() {
            return Err(GrantAuthorityResponseError);
        }
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

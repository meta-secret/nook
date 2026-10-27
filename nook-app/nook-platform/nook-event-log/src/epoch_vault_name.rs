//! The vault name an epoch checkpoint carries into the new epoch.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use nook_auth2::OpaqueCiphertext;
use serde::ser::Error as _;
use serde::{Deserialize, Serialize};

/// The vault name re-encrypted under the new epoch's `secrets_key`. A
/// checkpoint without one leaves the vault unnamed: a name under the
/// retired key is unreadable after the rotation.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(from = "OpaqueCiphertext")]
pub enum EpochVaultName {
    #[default]
    Unnamed,
    Named(OpaqueCiphertext),
}

impl From<OpaqueCiphertext> for EpochVaultName {
    fn from(name: OpaqueCiphertext) -> Self {
        Self::Named(name)
    }
}

impl EpochVaultName {
    pub(crate) fn is_unnamed(&self) -> bool {
        matches!(self, Self::Unnamed)
    }

    /// Emits a named checkpoint's ciphertext; unnamed checkpoints omit the field.
    pub(crate) fn serialize_epoch_vault_name<S>(
        name: &EpochVaultName,
        serializer: S,
    ) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        match name {
            EpochVaultName::Named(name) => name.serialize(serializer),
            EpochVaultName::Unnamed => Err(S::Error::custom(
                "an unnamed checkpoint must omit its vault name",
            )),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_named_checkpoint_round_trips_its_ciphertext() -> anyhow::Result<()> {
        #[derive(Serialize, Deserialize)]
        struct Checkpoint {
            #[serde(
                default,
                skip_serializing_if = "EpochVaultName::is_unnamed",
                serialize_with = "EpochVaultName::serialize_epoch_vault_name"
            )]
            vault_name: EpochVaultName,
        }
        let named = Checkpoint {
            vault_name: EpochVaultName::Named(OpaqueCiphertext::from_trusted("cipher".to_owned())),
        };
        assert_eq!(
            serde_json::to_value(&named)?,
            json!({ "vault_name": "cipher" })
        );
        let unnamed = Checkpoint {
            vault_name: EpochVaultName::Unnamed,
        };
        assert_eq!(serde_json::to_value(&unnamed)?, json!({}));
        let read: Checkpoint = serde_json::from_value(json!({}))?;
        assert_eq!(read.vault_name, EpochVaultName::Unnamed);
        let read: Checkpoint = serde_json::from_value(json!({ "vault_name": "cipher" }))?;
        assert_eq!(read.vault_name, named.vault_name);
        Ok(())
    }
}

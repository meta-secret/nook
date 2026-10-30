//! The keyrings the extension joined, kept beside its vault grants.
//!
//! The extension is an app of a keyring, not of one vault: once the web app
//! adds it, it is connected to that keyring, even before the keyring has a
//! vault. The record keeps the extension's app key for that keyring and the
//! access it was approved for, so the keyring's later vaults pair under it,
//! and names the keyring the side panel lists.

use std::cmp::Ordering;

use serde::{Deserialize, Serialize};
use tsify::Tsify;

use super::{
    ExtensionConnectScope, ExtensionPairingApprovalEpochMilliseconds, ExtensionPairingRecord,
    ExtensionPairingState, ExtensionPairingStateError,
};

pub const EXTENSION_KEYRING_KEY_PREFIX: &str = "nook:extension-keyring:";

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct StoredExtensionKeyring {
    pub identity_id: String,
    pub identity_label: String,
    /// The extension's app key in this keyring.
    pub device_id: String,
    pub device_public_key: String,
    pub device_signing_public_key: String,
    pub device_label: String,
    pub approved_at: ExtensionPairingApprovalEpochMilliseconds,
    pub scopes: Vec<ExtensionConnectScope>,
}

impl StoredExtensionKeyring {
    #[must_use]
    pub fn storage_key_for(identity_id: &str) -> String {
        format!("{EXTENSION_KEYRING_KEY_PREFIX}{identity_id}")
    }

    pub(super) fn validate_for_key(&self, key: &str) -> Result<(), ExtensionPairingStateError> {
        let Some(identity_id) = key.strip_prefix(EXTENSION_KEYRING_KEY_PREFIX) else {
            return Err(ExtensionPairingStateError::UnsupportedKey);
        };
        if identity_id != self.identity_id
            || [
                &self.identity_id,
                &self.device_id,
                &self.device_public_key,
                &self.device_signing_public_key,
                &self.device_label,
            ]
            .into_iter()
            .any(|value| value.trim().is_empty())
            || self.approved_at.validate().is_err()
            || self.scopes.is_empty()
        {
            return Err(ExtensionPairingStateError::InvalidKeyring);
        }
        Ok(())
    }
}

impl ExtensionPairingState {
    /// The keyring entries to store for a keyring the web app just added the
    /// extension to; approving the same keyring again replaces its record.
    pub fn for_keyring(
        keyring: StoredExtensionKeyring,
    ) -> Result<ExtensionPairingState, ExtensionPairingStateError> {
        let key = StoredExtensionKeyring::storage_key_for(&keyring.identity_id);
        keyring.validate_for_key(&key)?;
        Ok(ExtensionPairingState {
            entries: vec![super::ExtensionPairingEntry {
                key,
                record: ExtensionPairingRecord::Keyring(keyring),
            }],
        })
    }

    /// Every keyring the extension joined, the latest approval first.
    #[must_use]
    pub fn keyrings(&self) -> Vec<StoredExtensionKeyring> {
        let mut keyrings: Vec<_> = self
            .entries
            .iter()
            .filter_map(|entry| match &entry.record {
                ExtensionPairingRecord::Keyring(keyring) => Some(keyring.clone()),
                ExtensionPairingRecord::Grant(_) | ExtensionPairingRecord::Setup(_) => None,
            })
            .collect();
        keyrings.sort_by(|left, right| {
            right
                .approved_at
                .partial_cmp(&left.approved_at)
                .unwrap_or(Ordering::Equal)
        });
        keyrings
    }
}

#[cfg(test)]
mod tests {
    use super::super::tests::Fixture;
    use super::*;
    use crate::{ExtensionPairingEntry, StoredExtensionPairingGrant};

    fn keyring(identity_id: &str, approved_at: &str) -> anyhow::Result<StoredExtensionKeyring> {
        Ok(StoredExtensionKeyring {
            identity_id: identity_id.to_owned(),
            identity_label: "Personal".to_owned(),
            device_id: "device-test".to_owned(),
            device_public_key: "age1test".to_owned(),
            device_signing_public_key: "signing-test".to_owned(),
            device_label: "Nook Extension".to_owned(),
            approved_at: Fixture::approved_at(approved_at)?,
            scopes: vec![ExtensionConnectScope::VaultAccess],
        })
    }

    #[test]
    fn a_keyring_with_no_vault_is_stored_under_its_identity() -> anyhow::Result<()> {
        let joined = keyring("identity-personal", "1753401600000")?;
        let state = ExtensionPairingState::for_keyring(joined.clone())?;

        state.validate()?;
        assert_eq!(
            state.entries,
            vec![ExtensionPairingEntry {
                key: "nook:extension-keyring:identity-personal".to_owned(),
                record: ExtensionPairingRecord::Keyring(joined.clone()),
            }]
        );
        assert_eq!(state.keyrings(), vec![joined]);
        assert!(state.ordered_grants().is_empty());
        Ok(())
    }

    #[test]
    fn keyrings_list_the_latest_approval_first_beside_vault_grants() -> anyhow::Result<()> {
        let older = keyring("identity-older", "1753401600000")?;
        let newer = keyring("identity-newer", "1753401700000")?;
        let state = ExtensionPairingState {
            entries: vec![
                ExtensionPairingEntry {
                    key: StoredExtensionKeyring::storage_key_for(&older.identity_id),
                    record: ExtensionPairingRecord::Keyring(older.clone()),
                },
                ExtensionPairingEntry {
                    key: StoredExtensionPairingGrant::storage_key_for(&Fixture::store()),
                    record: ExtensionPairingRecord::Grant(Fixture::grant()),
                },
                ExtensionPairingEntry {
                    key: StoredExtensionKeyring::storage_key_for(&newer.identity_id),
                    record: ExtensionPairingRecord::Keyring(newer.clone()),
                },
            ],
        };

        state.validate()?;
        assert_eq!(state.keyrings(), vec![newer, older]);
        assert_eq!(state.ordered_grants(), vec![Fixture::grant()]);
        Ok(())
    }

    #[test]
    fn a_keyring_record_round_trips_as_a_keyring() -> anyhow::Result<()> {
        let joined = keyring("identity-personal", "1753401600000")?;
        let record: ExtensionPairingRecord = serde_json::from_str(&serde_json::to_string(
            &ExtensionPairingRecord::Keyring(joined.clone()),
        )?)?;
        assert_eq!(record, ExtensionPairingRecord::Keyring(joined));
        Ok(())
    }

    #[test]
    fn rejects_a_keyring_under_another_identity_or_without_its_app_key() -> anyhow::Result<()> {
        let joined = keyring("identity-personal", "1753401600000")?;
        let record = ExtensionPairingRecord::Keyring(joined.clone());
        assert_eq!(
            record.validate_for_key("nook:extension-keyring:identity-other"),
            Err(ExtensionPairingStateError::InvalidKeyring)
        );
        assert_eq!(
            record.validate_for_key("nook:extension-setup"),
            Err(ExtensionPairingStateError::UnsupportedKey)
        );
        let keyless = StoredExtensionKeyring {
            device_public_key: " ".to_owned(),
            ..joined.clone()
        };
        assert_eq!(
            ExtensionPairingState::for_keyring(keyless),
            Err(ExtensionPairingStateError::InvalidKeyring)
        );
        let unscoped = StoredExtensionKeyring {
            scopes: Vec::new(),
            ..joined
        };
        assert_eq!(
            ExtensionPairingState::for_keyring(unscoped),
            Err(ExtensionPairingStateError::InvalidKeyring)
        );
        Ok(())
    }
}

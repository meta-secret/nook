//! Choosing the default paired vault: the one new logins are saved to and
//! that leads every list.

use serde::{Deserialize, Serialize};
use tsify::Tsify;

use super::{
    EXTENSION_SETUP_KEY, ExtensionPairingEntry, ExtensionPairingRecord, ExtensionPairingState,
    ExtensionPairingStateError, ExtensionReadySetup, PairingGrantObservation,
};
use nook_auth2::StoreId;

/// Named values for choosing which paired vault the extension uses first.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionDefaultVaultSelectionInput {
    pub state: ExtensionPairingState,
    pub vault_store_id: StoreId,
}

impl ExtensionPairingState {
    /// Make a paired vault the default one: new logins are saved there and
    /// it leads every list. Returns the setup record to store; the vault's
    /// grant is kept as it is.
    pub fn select_default_vault(
        &self,
        vault_store_id: &StoreId,
    ) -> Result<ExtensionPairingState, ExtensionPairingStateError> {
        match self.grant(vault_store_id) {
            PairingGrantObservation::NotStored => Err(ExtensionPairingStateError::VaultNotPaired),
            PairingGrantObservation::Stored(grant) => Ok(ExtensionPairingState {
                entries: vec![ExtensionPairingEntry {
                    key: EXTENSION_SETUP_KEY.to_owned(),
                    record: ExtensionPairingRecord::Setup(ExtensionReadySetup::from_grant(grant)),
                }],
            }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::tests::Fixture;
    use super::*;
    use crate::{SelectedExtensionPairingGrant, StoredExtensionPairingGrant};

    fn two_vault_state() -> anyhow::Result<(ExtensionPairingState, StoredExtensionPairingGrant)> {
        let selected = Fixture::grant();
        let mut other = Fixture::grant();
        other.vault_store_id = Fixture::other_store();
        other.vault_name = "Work".to_owned();
        other.approved_at = Fixture::approved_at("1753488000000")?;
        let state = ExtensionPairingState {
            entries: vec![
                ExtensionPairingEntry {
                    key: EXTENSION_SETUP_KEY.to_owned(),
                    record: ExtensionPairingRecord::Setup(ExtensionReadySetup::from_grant(
                        &selected,
                    )),
                },
                ExtensionPairingEntry {
                    key: StoredExtensionPairingGrant::storage_key_for(&selected.vault_store_id),
                    record: ExtensionPairingRecord::Grant(selected),
                },
                ExtensionPairingEntry {
                    key: StoredExtensionPairingGrant::storage_key_for(&other.vault_store_id),
                    record: ExtensionPairingRecord::Grant(other.clone()),
                },
            ],
        };
        Ok((state, other))
    }

    #[test]
    fn choosing_a_default_vault_rewrites_only_the_setup() -> anyhow::Result<()> {
        let (state, other) = two_vault_state()?;

        let written = state.select_default_vault(&Fixture::other_store())?;

        assert_eq!(
            written.entries,
            vec![ExtensionPairingEntry {
                key: EXTENSION_SETUP_KEY.to_owned(),
                record: ExtensionPairingRecord::Setup(ExtensionReadySetup::from_grant(&other)),
            }]
        );
        Ok(())
    }

    #[test]
    fn the_chosen_default_vault_leads_the_list_and_is_selected() -> anyhow::Result<()> {
        let (state, other) = two_vault_state()?;
        let written = state.select_default_vault(&Fixture::other_store())?;
        let mut items = state.to_entries();
        items.extend(written.to_entries());
        let updated = ExtensionPairingState::from_entries(items);

        assert_eq!(
            updated.selected_grant(),
            SelectedExtensionPairingGrant::Selected {
                grant: Box::new(other.clone())
            }
        );
        assert_eq!(
            updated
                .ordered_grants()
                .first()
                .map(|grant| &grant.vault_store_id),
            Some(&other.vault_store_id)
        );
        assert_eq!(updated.ordered_grants().len(), 2);
        Ok(())
    }

    #[test]
    fn a_vault_that_is_not_paired_cannot_become_the_default() -> anyhow::Result<()> {
        let (state, _) = two_vault_state()?;

        assert_eq!(
            state.select_default_vault(&Fixture::newer_store()),
            Err(ExtensionPairingStateError::VaultNotPaired)
        );
        Ok(())
    }
}

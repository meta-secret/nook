#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

//! Typed extension pairing records shared by browser storage and policy.

mod authority;
mod legacy;

pub use authority::*;
use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use tsify::Tsify;

pub const EXTENSION_SETUP_KEY: &str = "nook:extension-setup";
pub const EXTENSION_GRANT_KEY_PREFIX: &str = "nook:extension-pairing-grant:";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum ExtensionConnectScope {
    VaultAccess,
    PasswordFilling,
    PasskeyManagement,
    SyncProviderCredentials,
}

impl ExtensionConnectScope {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::VaultAccess => "vault-access",
            Self::PasswordFilling => "password-filling",
            Self::PasskeyManagement => "passkey-management",
            Self::SyncProviderCredentials => "sync-provider-credentials",
        }
    }

    #[must_use]
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "vault-access" => Some(Self::VaultAccess),
            "password-filling" => Some(Self::PasswordFilling),
            "passkey-management" => Some(Self::PasskeyManagement),
            "sync-provider-credentials" => Some(Self::SyncProviderCredentials),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum ExtensionPairingVaultType {
    Simple,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum ExtensionReadySetupStatus {
    Ready,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct StoredExtensionPairingGrant {
    pub vault_type: ExtensionPairingVaultType,
    pub device_id: String,
    pub device_public_key: String,
    pub device_signing_public_key: String,
    pub device_label: String,
    pub vault_store_id: String,
    pub vault_name: String,
    pub approved_at: String,
    pub scopes: Vec<ExtensionConnectScope>,
    pub sync_provider_count: u32,
    pub event_count: u32,
    pub event_log_heads: Vec<String>,
    pub last_local_sync_at: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct ExtensionPairingGrantApproval {
    pub vault_type: ExtensionPairingVaultType,
    pub device_id: String,
    pub device_public_key: String,
    pub device_signing_public_key: String,
    pub device_label: String,
    pub vault_store_id: String,
    pub vault_name: String,
    pub approved_at: String,
    pub scopes: Vec<ExtensionConnectScope>,
    pub sync_provider_count: u32,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct ImportedExtensionEventLog {
    pub vault_store_id: String,
    pub event_count: u32,
    pub heads: Vec<String>,
    pub access_granted: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct CreateExtensionPairingStateInput {
    pub grant: ExtensionPairingGrantApproval,
    pub imported: ImportedExtensionEventLog,
    pub observed_at: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct RefreshExtensionPairingGrantInput {
    pub grant: StoredExtensionPairingGrant,
    pub imported: ImportedExtensionEventLog,
    pub observed_at: String,
    // Existing browser wire field; convert at admission until its boundary migration.
    pub select: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct ExtensionPairingGrantRemovalInput {
    pub state: ExtensionPairingState,
    pub removed_vault_store_id: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct ExtensionReadySetup {
    pub status: ExtensionReadySetupStatus,
    pub device_label: String,
    pub paired_vaults: Vec<String>,
    pub selected_vault_store_id: String,
    pub selected_vault_name: String,
    pub sync_provider_count: u32,
    pub event_count: u32,
    pub event_log_heads: Vec<String>,
    pub last_local_sync_at: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize, Tsify)]
#[serde(untagged)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum ExtensionPairingRecord {
    Grant(StoredExtensionPairingGrant),
    Setup(ExtensionReadySetup),
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct ExtensionPairingEntry {
    pub key: String,
    pub record: ExtensionPairingRecord,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct ExtensionPairingState {
    pub entries: Vec<ExtensionPairingEntry>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize, Tsify)]
#[serde(tag = "kind", rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum SelectedExtensionPairingGrant {
    NotSelected,
    Selected {
        grant: Box<StoredExtensionPairingGrant>,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize, Tsify)]
#[serde(tag = "kind", rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum ExtensionSetupAfterRemoval {
    NoPairedVault,
    Ready { setup: ExtensionReadySetup },
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ExtensionPairingStateError {
    #[error("extension pairing record used an unsupported storage key")]
    UnsupportedKey,
    #[error("extension pairing grant is incomplete or inconsistent")]
    InvalidGrant,
    #[error("extension pairing setup is incomplete or inconsistent")]
    InvalidSetup,
    #[error("imported event log does not match the approved vault")]
    ImportedVaultMismatch,
    #[error("imported event log does not grant this extension access")]
    ImportedAccessDenied,
    #[error("legacy extension pairing state is invalid")]
    InvalidLegacyState,
}

impl ExtensionPairingRecord {
    pub fn validate_for_key(&self, key: &str) -> Result<(), ExtensionPairingStateError> {
        match self {
            Self::Grant(grant) => {
                let Some(vault_store_id) = key.strip_prefix(EXTENSION_GRANT_KEY_PREFIX) else {
                    return Err(ExtensionPairingStateError::UnsupportedKey);
                };
                if vault_store_id != grant.vault_store_id
                    || grant.device_id.trim().is_empty()
                    || grant.device_public_key.trim().is_empty()
                    || grant.device_signing_public_key.trim().is_empty()
                    || grant.device_label.trim().is_empty()
                    || grant.vault_name.trim().is_empty()
                    || grant.approved_at.trim().is_empty()
                    || grant.scopes.is_empty()
                    || grant.event_count == 0
                    || grant.event_log_heads.is_empty()
                    || grant
                        .event_log_heads
                        .iter()
                        .any(|head| head.trim().is_empty())
                    || grant.last_local_sync_at.trim().is_empty()
                {
                    return Err(ExtensionPairingStateError::InvalidGrant);
                }
            }
            Self::Setup(setup) => {
                if key != EXTENSION_SETUP_KEY
                    || setup.device_label.trim().is_empty()
                    || setup.paired_vaults.is_empty()
                    || setup
                        .paired_vaults
                        .iter()
                        .any(|vault| vault.trim().is_empty())
                    || setup.selected_vault_store_id.trim().is_empty()
                    || setup.selected_vault_name.trim().is_empty()
                    || setup.event_count == 0
                    || setup.event_log_heads.is_empty()
                    || setup
                        .event_log_heads
                        .iter()
                        .any(|head| head.trim().is_empty())
                    || setup.last_local_sync_at.trim().is_empty()
                {
                    return Err(ExtensionPairingStateError::InvalidSetup);
                }
            }
        }
        Ok(())
    }
}

impl ExtensionPairingState {
    pub fn validate(&self) -> Result<(), ExtensionPairingStateError> {
        let mut keys = HashSet::with_capacity(self.entries.len());
        for entry in &self.entries {
            if !keys.insert(entry.key.as_str()) {
                return Err(ExtensionPairingStateError::UnsupportedKey);
            }
            entry.record.validate_for_key(&entry.key)?;
        }
        Ok(())
    }

    #[must_use]
    pub fn from_entries(entries: HashMap<String, ExtensionPairingRecord>) -> Self {
        Self {
            entries: entries
                .into_iter()
                .map(|(key, record)| ExtensionPairingEntry { key, record })
                .collect(),
        }
    }

    #[must_use]
    pub fn to_entries(&self) -> HashMap<String, ExtensionPairingRecord> {
        self.entries
            .iter()
            .map(|entry| (entry.key.clone(), entry.record.clone()))
            .collect()
    }

    #[must_use]
    pub fn ordered_grants(&self) -> Vec<StoredExtensionPairingGrant> {
        let selected = self
            .ready_setup()
            .map(|setup| setup.selected_vault_store_id.as_str());
        let mut grants: Vec<_> = self
            .entries
            .iter()
            .filter_map(|entry| match &entry.record {
                ExtensionPairingRecord::Grant(grant) => Some(grant.clone()),
                ExtensionPairingRecord::Setup(_) => None,
            })
            .collect();
        grants.sort_by(|left, right| {
            let left_selected = Some(left.vault_store_id.as_str()) == selected;
            let right_selected = Some(right.vault_store_id.as_str()) == selected;
            right_selected
                .cmp(&left_selected)
                .then_with(|| right.approved_at.cmp(&left.approved_at))
        });
        grants
    }

    #[must_use]
    pub fn selected_grant(&self) -> Option<StoredExtensionPairingGrant> {
        let selected = &self.ready_setup()?.selected_vault_store_id;
        self.grant(selected).cloned()
    }

    #[must_use]
    pub fn first_grant(&self) -> Option<StoredExtensionPairingGrant> {
        self.ordered_grants().into_iter().next()
    }

    #[must_use]
    pub fn setup_after_removal(&self, removed_vault_store_id: &str) -> Option<ExtensionReadySetup> {
        if let Some(setup) = self.ready_setup()
            && setup.selected_vault_store_id != removed_vault_store_id
        {
            return Some(setup.clone());
        }
        self.ordered_grants()
            .into_iter()
            .find(|grant| grant.vault_store_id != removed_vault_store_id)
            .map(|grant| ExtensionReadySetup::from_grant(&grant))
    }

    fn ready_setup(&self) -> Option<&ExtensionReadySetup> {
        self.entries.iter().find_map(|entry| match &entry.record {
            ExtensionPairingRecord::Setup(setup) if entry.key == EXTENSION_SETUP_KEY => Some(setup),
            ExtensionPairingRecord::Grant(_) | ExtensionPairingRecord::Setup(_) => None,
        })
    }

    fn grant(&self, vault_store_id: &str) -> Option<&StoredExtensionPairingGrant> {
        let key = StoredExtensionPairingGrant::storage_key_for(vault_store_id);
        self.entries.iter().find_map(|entry| match &entry.record {
            ExtensionPairingRecord::Grant(grant) if entry.key == key => Some(grant),
            ExtensionPairingRecord::Grant(_) | ExtensionPairingRecord::Setup(_) => None,
        })
    }
}

#[derive(Clone, Copy)]
enum PairingSelection {
    Select,
    KeepCurrent,
}

impl StoredExtensionPairingGrant {
    #[must_use]
    pub fn storage_key_for(vault_store_id: &str) -> String {
        format!("{EXTENSION_GRANT_KEY_PREFIX}{vault_store_id}")
    }

    fn from_import(
        grant: ExtensionPairingGrantApproval,
        imported: ImportedExtensionEventLog,
        observed_at: String,
    ) -> Result<StoredExtensionPairingGrant, ExtensionPairingStateError> {
        if imported.vault_store_id != grant.vault_store_id {
            return Err(ExtensionPairingStateError::ImportedVaultMismatch);
        }
        if !imported.access_granted {
            return Err(ExtensionPairingStateError::ImportedAccessDenied);
        }
        Ok(StoredExtensionPairingGrant {
            vault_type: grant.vault_type,
            device_id: grant.device_id,
            device_public_key: grant.device_public_key,
            device_signing_public_key: grant.device_signing_public_key,
            device_label: grant.device_label,
            vault_store_id: grant.vault_store_id,
            vault_name: grant.vault_name,
            approved_at: grant.approved_at,
            scopes: grant.scopes,
            sync_provider_count: grant.sync_provider_count,
            event_count: imported.event_count,
            event_log_heads: imported.heads,
            last_local_sync_at: observed_at,
        })
    }

    pub fn validate_json(value: &str) -> Result<(), ExtensionPairingStateError> {
        let grant = serde_json::from_str::<StoredExtensionPairingGrant>(value)
            .map_err(|_| ExtensionPairingStateError::InvalidGrant)?;
        let key = StoredExtensionPairingGrant::storage_key_for(&grant.vault_store_id);
        ExtensionPairingRecord::Grant(grant).validate_for_key(&key)
    }
}

impl ExtensionPairingState {
    pub fn create(
        input: CreateExtensionPairingStateInput,
    ) -> Result<ExtensionPairingState, ExtensionPairingStateError> {
        let grant = StoredExtensionPairingGrant::from_import(
            input.grant,
            input.imported,
            input.observed_at,
        )?;
        Ok(ExtensionPairingState::for_grant(
            &grant,
            PairingSelection::Select,
        ))
    }

    pub fn refresh_grant(
        input: RefreshExtensionPairingGrantInput,
    ) -> Result<ExtensionPairingState, ExtensionPairingStateError> {
        let approval = ExtensionPairingGrantApproval {
            vault_type: input.grant.vault_type,
            device_id: input.grant.device_id,
            device_public_key: input.grant.device_public_key,
            device_signing_public_key: input.grant.device_signing_public_key,
            device_label: input.grant.device_label,
            vault_store_id: input.grant.vault_store_id,
            vault_name: input.grant.vault_name,
            approved_at: input.grant.approved_at,
            scopes: input.grant.scopes,
            sync_provider_count: input.grant.sync_provider_count,
        };
        let grant =
            StoredExtensionPairingGrant::from_import(approval, input.imported, input.observed_at)?;
        let selection = if input.select {
            PairingSelection::Select
        } else {
            PairingSelection::KeepCurrent
        };
        Ok(ExtensionPairingState::for_grant(&grant, selection))
    }

    fn for_grant(
        grant: &StoredExtensionPairingGrant,
        selection: PairingSelection,
    ) -> ExtensionPairingState {
        let mut entries = vec![ExtensionPairingEntry {
            key: StoredExtensionPairingGrant::storage_key_for(&grant.vault_store_id),
            record: ExtensionPairingRecord::Grant(grant.clone()),
        }];
        if matches!(selection, PairingSelection::Select) {
            entries.push(ExtensionPairingEntry {
                key: EXTENSION_SETUP_KEY.to_owned(),
                record: ExtensionPairingRecord::Setup(ExtensionReadySetup::from_grant(grant)),
            });
        }
        ExtensionPairingState { entries }
    }
}

impl ExtensionReadySetup {
    fn from_grant(grant: &StoredExtensionPairingGrant) -> ExtensionReadySetup {
        ExtensionReadySetup {
            status: ExtensionReadySetupStatus::Ready,
            device_label: grant.device_label.clone(),
            paired_vaults: vec![grant.vault_name.clone()],
            selected_vault_store_id: grant.vault_store_id.clone(),
            selected_vault_name: grant.vault_name.clone(),
            sync_provider_count: grant.sync_provider_count,
            event_count: grant.event_count,
            event_log_heads: grant.event_log_heads.clone(),
            last_local_sync_at: grant.last_local_sync_at.clone(),
        }
    }

    pub fn validate_json(value: &str) -> Result<(), ExtensionPairingStateError> {
        let setup = serde_json::from_str::<ExtensionReadySetup>(value)
            .map_err(|_| ExtensionPairingStateError::InvalidSetup)?;
        ExtensionPairingRecord::Setup(setup).validate_for_key(EXTENSION_SETUP_KEY)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extension_scope_parser_matches_serialized_vocabulary() {
        let scopes = [
            ExtensionConnectScope::VaultAccess,
            ExtensionConnectScope::PasswordFilling,
            ExtensionConnectScope::PasskeyManagement,
            ExtensionConnectScope::SyncProviderCredentials,
        ];

        for scope in scopes {
            assert_eq!(ExtensionConnectScope::parse(scope.as_str()), Some(scope));
        }
        assert_eq!(ExtensionConnectScope::parse("external-value"), None);
    }

    #[test]
    fn validates_grant_against_its_domain_key() -> anyhow::Result<()> {
        let mut entries = HashMap::new();
        entries.insert(
            "nook:extension-pairing-grant:store-test".to_owned(),
            ExtensionPairingRecord::Grant(Fixture::grant()),
        );
        ExtensionPairingState::from_entries(entries).validate()?;
        Ok(())
    }

    #[test]
    fn rejects_grant_under_an_unrelated_key() {
        let record = ExtensionPairingRecord::Grant(Fixture::grant());
        assert_eq!(
            record.validate_for_key("other"),
            Err(ExtensionPairingStateError::UnsupportedKey)
        );
    }

    #[test]
    fn rust_creates_and_selects_pairing_state_from_browser_observations() -> anyhow::Result<()> {
        let input = CreateExtensionPairingStateInput {
            grant: ExtensionPairingGrantApproval {
                vault_type: ExtensionPairingVaultType::Simple,
                device_id: "device-test".to_owned(),
                device_public_key: "age1test".to_owned(),
                device_signing_public_key: "signing-test".to_owned(),
                device_label: "Nook Extension".to_owned(),
                vault_store_id: "store-test".to_owned(),
                vault_name: "Personal".to_owned(),
                approved_at: "2026-07-25T00:00:00.000Z".to_owned(),
                scopes: vec![ExtensionConnectScope::PasswordFilling],
                sync_provider_count: 1,
            },
            imported: ImportedExtensionEventLog {
                vault_store_id: "store-test".to_owned(),
                event_count: 2,
                heads: vec!["event-2".to_owned()],
                access_granted: true,
            },
            observed_at: "2026-07-25T00:00:01.000Z".to_owned(),
        };

        let state = ExtensionPairingState::create(input)?;
        state.validate()?;
        assert_eq!(state.selected_grant(), state.first_grant());
        assert_eq!(state.ordered_grants().len(), 1);
        Ok(())
    }

    #[test]
    fn rust_rejects_a_pairing_import_for_another_vault() {
        let input = CreateExtensionPairingStateInput {
            grant: ExtensionPairingGrantApproval {
                vault_type: ExtensionPairingVaultType::Simple,
                device_id: "device-test".to_owned(),
                device_public_key: "age1test".to_owned(),
                device_signing_public_key: "signing-test".to_owned(),
                device_label: "Nook Extension".to_owned(),
                vault_store_id: "store-test".to_owned(),
                vault_name: "Personal".to_owned(),
                approved_at: "2026-07-25T00:00:00.000Z".to_owned(),
                scopes: vec![ExtensionConnectScope::PasswordFilling],
                sync_provider_count: 1,
            },
            imported: ImportedExtensionEventLog {
                vault_store_id: "store-other".to_owned(),
                event_count: 2,
                heads: vec!["event-2".to_owned()],
                access_granted: true,
            },
            observed_at: "2026-07-25T00:00:01.000Z".to_owned(),
        };

        assert_eq!(
            ExtensionPairingState::create(input),
            Err(ExtensionPairingStateError::ImportedVaultMismatch)
        );
    }

    #[test]
    fn selected_pairing_grant_refresh_rebuilds_grant_and_setup_metadata() -> anyhow::Result<()> {
        let state =
            ExtensionPairingState::refresh_grant(Fixture::refresh_input(PairingSelection::Select))?;
        let refreshed = state
            .selected_grant()
            .ok_or_else(|| anyhow::anyhow!("selected refresh must include setup state"))?;

        assert_eq!(refreshed.event_count, 4);
        assert_eq!(refreshed.event_log_heads, vec!["event-4"]);
        assert_eq!(refreshed.last_local_sync_at, "2026-07-25T00:00:04.000Z");
        assert_eq!(state.first_grant(), Some(refreshed));
        state.validate()?;
        Ok(())
    }

    #[test]
    fn non_selected_pairing_grant_refresh_updates_only_the_grant() -> anyhow::Result<()> {
        let state = ExtensionPairingState::refresh_grant(Fixture::refresh_input(
            PairingSelection::KeepCurrent,
        ))?;
        let refreshed = state
            .first_grant()
            .ok_or_else(|| anyhow::anyhow!("refresh must include the updated grant"))?;

        assert_eq!(refreshed.event_count, 4);
        assert_eq!(refreshed.event_log_heads, vec!["event-4"]);
        assert_eq!(refreshed.last_local_sync_at, "2026-07-25T00:00:04.000Z");
        assert_eq!(state.selected_grant(), None);
        assert_eq!(state.entries.len(), 1);
        state.validate()?;
        Ok(())
    }

    #[test]
    fn removal_preserves_setup_when_a_non_selected_vault_is_removed() {
        let selected = Fixture::grant();
        let mut removed = Fixture::grant();
        removed.vault_store_id = "store-removed".to_owned();
        removed.vault_name = "Removed".to_owned();
        removed.approved_at = "2026-07-26T00:00:00.000Z".to_owned();
        let expected = ExtensionReadySetup::from_grant(&selected);
        let state = ExtensionPairingState {
            entries: vec![
                ExtensionPairingEntry {
                    key: EXTENSION_SETUP_KEY.to_owned(),
                    record: ExtensionPairingRecord::Setup(expected.clone()),
                },
                ExtensionPairingEntry {
                    key: StoredExtensionPairingGrant::storage_key_for(&selected.vault_store_id),
                    record: ExtensionPairingRecord::Grant(selected),
                },
                ExtensionPairingEntry {
                    key: StoredExtensionPairingGrant::storage_key_for(&removed.vault_store_id),
                    record: ExtensionPairingRecord::Grant(removed),
                },
            ],
        };

        assert_eq!(state.setup_after_removal("store-removed"), Some(expected));
    }

    #[test]
    fn removal_selects_the_newest_remaining_grant_when_selected_vault_is_removed() {
        let selected = Fixture::grant();
        let mut older = Fixture::grant();
        older.vault_store_id = "store-older".to_owned();
        older.vault_name = "Older".to_owned();
        older.approved_at = "2026-07-23T00:00:00.000Z".to_owned();
        let mut newer = Fixture::grant();
        newer.vault_store_id = "store-newer".to_owned();
        newer.vault_name = "Newer".to_owned();
        newer.approved_at = "2026-07-27T00:00:00.000Z".to_owned();
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
                    key: StoredExtensionPairingGrant::storage_key_for(&older.vault_store_id),
                    record: ExtensionPairingRecord::Grant(older),
                },
                ExtensionPairingEntry {
                    key: StoredExtensionPairingGrant::storage_key_for(&newer.vault_store_id),
                    record: ExtensionPairingRecord::Grant(newer.clone()),
                },
            ],
        };

        assert_eq!(
            state.setup_after_removal("store-test"),
            Some(ExtensionReadySetup::from_grant(&newer))
        );
    }

    #[test]
    fn removal_reports_no_setup_when_the_final_grant_is_removed() {
        let selected = Fixture::grant();
        let state = ExtensionPairingState::for_grant(&selected, PairingSelection::Select);

        assert_eq!(state.setup_after_removal("store-test"), None);
    }
    #[test]
    fn grant_json_validation_reports_invalid_input() -> anyhow::Result<()> {
        let mut grant = Fixture::grant();
        StoredExtensionPairingGrant::validate_json(&serde_json::to_string(&grant)?)?;
        for malformed in ["{", "{}"] {
            assert_eq!(
                StoredExtensionPairingGrant::validate_json(malformed),
                Err(ExtensionPairingStateError::InvalidGrant)
            );
        }
        grant.device_id = "  ".to_owned();
        assert_eq!(
            StoredExtensionPairingGrant::validate_json(&serde_json::to_string(&grant)?),
            Err(ExtensionPairingStateError::InvalidGrant)
        );
        Ok(())
    }

    #[test]
    fn setup_json_validation_reports_invalid_input() -> anyhow::Result<()> {
        let mut setup = ExtensionReadySetup::from_grant(&Fixture::grant());
        ExtensionReadySetup::validate_json(&serde_json::to_string(&setup)?)?;
        for malformed in ["{", "{}"] {
            assert_eq!(
                ExtensionReadySetup::validate_json(malformed),
                Err(ExtensionPairingStateError::InvalidSetup)
            );
        }
        setup.event_count = 0;
        assert_eq!(
            ExtensionReadySetup::validate_json(&serde_json::to_string(&setup)?),
            Err(ExtensionPairingStateError::InvalidSetup)
        );
        Ok(())
    }

    struct Fixture;

    impl Fixture {
        fn grant() -> StoredExtensionPairingGrant {
            StoredExtensionPairingGrant {
                vault_type: ExtensionPairingVaultType::Simple,
                device_id: "device-test".to_owned(),
                device_public_key: "age1test".to_owned(),
                device_signing_public_key: "signing-test".to_owned(),
                device_label: "Nook Extension".to_owned(),
                vault_store_id: "store-test".to_owned(),
                vault_name: "Personal".to_owned(),
                approved_at: "2026-07-25T00:00:00.000Z".to_owned(),
                scopes: vec![ExtensionConnectScope::PasswordFilling],
                sync_provider_count: 1,
                event_count: 2,
                event_log_heads: vec!["event-2".to_owned()],
                last_local_sync_at: "2026-07-25T00:00:01.000Z".to_owned(),
            }
        }

        fn refresh_input(selection: PairingSelection) -> RefreshExtensionPairingGrantInput {
            let mut existing = Self::grant();
            existing.event_count = 2;
            existing.event_log_heads = vec!["event-2".to_owned()];
            existing.last_local_sync_at = "2026-07-25T00:00:01.000Z".to_owned();
            RefreshExtensionPairingGrantInput {
                grant: existing,
                imported: ImportedExtensionEventLog {
                    vault_store_id: "store-test".to_owned(),
                    event_count: 4,
                    heads: vec!["event-4".to_owned()],
                    access_granted: true,
                },
                observed_at: "2026-07-25T00:00:04.000Z".to_owned(),
                select: matches!(selection, PairingSelection::Select),
            }
        }
    }
}

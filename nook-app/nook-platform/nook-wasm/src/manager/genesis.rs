//! Vault genesis and empty-session initialization.

use super::{NookVaultManager, VaultNameState};
use crate::IdentityDbGenerateVaultDekForIdentity;
use crate::NookDatabase;
use crate::storage::identity_record;
use crate::storage::identity_record::StoredIdentityRecord;
use crate::{NookError, NookSecretRecord};
use nook_core::{DirectoryOwnedVaultOpening, IdentityVaultKeyOpening};
use nook_core::{
    GenesisMembersRecordsRequest, IdentityRecord, IdentityVaultGenesisRecordsRequest, VaultMember,
};
use nook_core::{SymmetricKey, VaultMetaState, VaultType, VaultUnlock};
use wasm_bindgen::JsError;

impl NookVaultManager {
    /// Create vault keys through a first-class Identity (fail closed without members).
    ///
    /// Identity owns the DEK envelopes. Vault genesis still writes `auth:` rows so
    /// legacy unlock paths keep working during the extract.
    pub(in crate::manager) async fn initialize_genesis_vault_with_identity(
        &mut self,
        identity: &nook_core::DeviceIdentity,
    ) -> Result<identity_record::PendingSimpleGenesis, NookError> {
        let label = match &self.vault.vault_name {
            VaultNameState::Named(name) if !name.trim().is_empty() => name.clone(),
            _ => "Personal".to_owned(),
        };
        if let Some(handoff) = self.pending_vault_creation_handoff() {
            let app_key = self.device_identity()?;
            self.event_log
                .signing_seed
                .clone_from(&handoff.signing_seed);
            let (pending, identity_record, keys) = identity_record::StagedSimpleGenesisInput {
                app_key: &app_key,
                signing_public_key: &handoff.signing_public_key,
                authorizer: handoff.authorizer.as_ref(),
                authorizer_signing: handoff.authorizer_signing.as_ref(),
                label: &label,
            }
            .begin_or_resume()
            .await?;
            self.vault.store_id = pending.store_id.to_string();
            self.apply_identity_genesis_vault_keys(&identity_record, &keys)?;
            return Ok(pending);
        }
        let pending = identity_record::OrdinarySimpleGenesisRequest {
            app_key: identity,
            label: &label,
        }
        .begin_or_resume()
        .await?;
        self.vault.store_id = pending.store_id.to_string();
        if let Some(staged) = pending.staged_identity() {
            let keys = staged
                .directory
                .open_vault_dek_for_identity(DirectoryOwnedVaultOpening {
                    identity_id: &pending.identity_id,
                    vault: IdentityVaultKeyOpening {
                        app_key: identity,
                        store_id: pending.store_id.clone(),
                    },
                })
                .map_err(|error| NookError::Database(error.to_string()))?;

            let identity_record = staged
                .directory
                .identities()
                .iter()
                .find(|record| record.identity_id == pending.identity_id)
                .cloned()
                .ok_or_else(|| {
                    NookError::Database("Staged genesis identity disappeared.".to_owned())
                })?;
            self.apply_identity_genesis_vault_keys(&identity_record, &keys)?;
            return Ok(pending);
        }
        let keys =
            NookDatabase::generate_vault_dek_for_identity(IdentityDbGenerateVaultDekForIdentity {
                identity_id: &pending.identity_id,
                app_key: identity,
                store_id: pending.store_id.clone(),
            })
            .await?;
        let identity_record = match NookDatabase::load_identity(&pending.identity_id).await? {
            StoredIdentityRecord::Registered(value) => Ok(value),
            StoredIdentityRecord::NotRegistered => Err({
                NookError::Database("Pending genesis identity no longer exists.".to_owned())
            }),
        }?;
        self.apply_identity_genesis_vault_keys(&identity_record, &keys)?;
        Ok(pending)
    }

    fn apply_identity_genesis_vault_keys(
        &mut self,
        identity: &nook_core::IdentityRecord,
        keys: &nook_core::VaultKeys,
    ) -> Result<(), NookError> {
        self.prepare_genesis_vault_keys(keys)?;
        if self.vault.architecture.vault_type == VaultType::Simple {
            for record in IdentityRecord::identity_vault_genesis_records(
                IdentityVaultGenesisRecordsRequest {
                    identity: identity,
                    keys: keys,
                    enrolled_at: "genesis",
                },
            )? {
                self.vault.meta.apply_record(&record)?;
            }
        }
        Ok(())
    }

    /// Test/helper path that still creates vault keys without Identity persistence.
    #[cfg_attr(not(test), allow(dead_code))]
    pub(in crate::manager) fn initialize_genesis_vault(
        &mut self,
        identity: &nook_core::DeviceIdentity,
    ) -> Result<(), NookError> {
        let keys = nook_core::VaultKeys::generate()?;
        self.apply_genesis_vault_keys(identity, &keys)
    }

    pub(in crate::manager) fn apply_genesis_vault_keys(
        &mut self,
        identity: &nook_core::DeviceIdentity,
        keys: &nook_core::VaultKeys,
    ) -> Result<(), NookError> {
        self.prepare_genesis_vault_keys(keys)?;
        match self.vault.architecture.vault_type {
            VaultType::Simple => {
                let genesis = identity.auth_record(&keys.secrets_key, &keys.members_key)?;
                self.vault.meta.apply_record(&genesis)?;
            }
            VaultType::Sentinel => {
                // Sentinel genesis keeps vault keys in session memory only. Shares
                // are issued after the required participants are enrolled.
            }
        }
        for member in VaultMember::genesis_members_records(GenesisMembersRecordsRequest {
            identity: identity,
            members_key: &keys.members_key,
            enrolled_at: "genesis",
        })? {
            self.vault.meta.apply_record(&member)?;
        }
        Ok(())
    }

    fn prepare_genesis_vault_keys(&mut self, keys: &nook_core::VaultKeys) -> Result<(), NookError> {
        self.vault.password_entries.clear();
        self.vault.unlock = VaultUnlock::Keys;
        self.vault.meta = VaultMetaState::default();
        self.apply_vault_keys(keys.secrets_key.as_str(), keys.members_key.as_str())?;
        self.vault.last_synced_content.clear();
        Ok(())
    }

    // Initialize an empty database
    pub async fn initialize_empty(&mut self) -> Result<Vec<NookSecretRecord>, JsError> {
        let _ = self.status.tx.send("INITIALIZE_START".to_owned());
        self.vault.meta.secrets.clear();
        if self.needs_genesis_persist()? {
            let identity = self.device_identity()?;
            let secrets_key = SymmetricKey::parse(&self.vault.secrets_key)?;
            let members_key = SymmetricKey::parse(&self.vault.members_key)?;
            match self.vault.architecture.vault_type {
                VaultType::Simple => {
                    let genesis = identity.auth_record(&secrets_key, &members_key)?;
                    self.vault.meta.apply_record(&genesis)?;
                }
                VaultType::Sentinel => {
                    // Sentinel never writes per-device auth envelopes.
                }
            }
            for member in VaultMember::genesis_members_records(GenesisMembersRecordsRequest {
                identity: &identity,
                members_key: &members_key,
                enrolled_at: "genesis",
            })? {
                self.vault.meta.apply_record(&member)?;
            }
        }
        if self.vault.store_id.is_empty() {
            self.vault.store_id = nook_core::StoreId::generate()?.to_string();
        }
        if !self.event_log_has_events().await? {
            self.bootstrap_event_log_genesis().await?;
        }
        self.persist_projection_cache().await?;
        self.purge_legacy_plaintext_search_catalog().await?;
        let _ = self.status.tx.send("READY".to_owned());
        Ok(self.get_records()?)
    }
}

//! Nexus opened-share ceremony unlock for the browser.
//!
//! Each device opens its local encrypted share into an [`OpenedNexusShare`]
//! contribution. The reconstructing device combines ≥ threshold contributions
//! without ever receiving peer [`DeviceIdentity`] secrets.

use super::NookVaultManager;
use crate::NookError;
use crate::NookSecretRecord;
use crate::conversion::{LoadedVault, load_stored_vault};
use wasm_bindgen::JsError;
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
impl NookVaultManager {
    /// Status string for nexus unlock UI: `not_nexus`, `unlocked`,
    /// `awaiting_shares`, or `ceremony_required`.
    #[wasm_bindgen(js_name = nexusUnlockStatus)]
    pub fn nexus_unlock_status(&self) -> String {
        if !self.is_nexus_session() {
            return "not_nexus".to_owned();
        }
        if !self.vault.secrets_key.is_empty() && !self.vault.members_key.is_empty() {
            return "unlocked".to_owned();
        }
        let share_count = self.vault.meta.nexus_shares.len();
        let threshold = self
            .vault
            .architecture
            .nexus
            .map_or(2, |policy| policy.threshold);
        if share_count > 0 && share_count < usize::from(threshold) {
            return "awaiting_shares".to_owned();
        }
        "ceremony_required".to_owned()
    }

    /// Open this device's local nexus share into a JSON [`OpenedNexusShare`].
    #[wasm_bindgen(js_name = openLocalNexusShare)]
    pub async fn open_local_nexus_share(&mut self) -> Result<String, JsError> {
        // Joiners may only have event-log share rows until ceremony unlock.
        if self.vault.meta.nexus_shares.is_empty() {
            let _ = self.sync_events_from_current_provider().await;
            let _ = self.materialize_vault_meta_from_events().await;
        }
        self.ensure_nexus_architecture_from_shares();
        // Prefer in-memory share meta from the event graph. Only fall back to
        // projection YAML when shares are still missing.
        if self.vault.meta.nexus_shares.is_empty()
            && !self.vault.last_synced_content.trim().is_empty()
        {
            let _ = self.prepare_nexus_ceremony_session(&self.vault.last_synced_content.clone());
            self.ensure_nexus_architecture_from_shares();
        }
        if !self.is_nexus_session() {
            return Err(nook_core::MultiDeviceError::InvalidNexusThreshold.into());
        }
        let identity = self.device_identity()?;
        let records = self.stored_records_snapshot();
        let opened = nook_core::open_nexus_share_for_identity(&records, &identity)?;
        Ok(serde_json::to_string(&opened).map_err(|e| NookError::Serialization(e.to_string()))?)
    }

    /// Reconstruct vault keys from opened-share JSON and load the session from
    /// remote/local storage content.
    #[wasm_bindgen(js_name = connectWithNexusShares)]
    pub async fn connect_with_nexus_shares(
        &mut self,
        storage_mode: String,
        github_pat: String,
        github_repo: String,
        opened_shares_json: String,
    ) -> Result<Vec<NookSecretRecord>, JsError> {
        let _ = self.status.tx.send("CONNECT_START".to_owned());
        self.prepare_storage(&storage_mode, &github_pat, &github_repo)
            .await?;
        let _identity = self.ensure_device_identity()?;

        let mut vault_missing = false;
        let content = self.fetch_vault_content(&mut vault_missing).await?;
        let projection = if vault_missing || content.trim().is_empty() {
            if self.storage.mode == nook_core::StorageMode::Local {
                return Err(NookError::Database("No vault found to unlock.".to_owned()).into());
            }
            self.sync_events_from_current_provider().await?;
            self.serialize_current_projection_yaml()?
        } else {
            self.capture_vault_unlock(&content);
            content
        };

        if self.vault.architecture.vault_type != nook_core::VaultType::Nexus {
            return Err(nook_core::MultiDeviceError::InvalidNexusThreshold.into());
        }

        let opened: Vec<nook_core::OpenedNexusShare> = serde_json::from_str(&opened_shares_json)
            .map_err(|e| NookError::Serialization(e.to_string()))?;
        let loaded = nook_core::load_nexus_vault_from_opened(projection.as_str(), &opened)?;
        self.apply_loaded_nexus_vault(LoadedVault {
            database: loaded.database,
            meta: loaded.meta,
            secrets_key: loaded.secrets_key,
            members_key: loaded.members_key,
        })
        .await?;
        let _ = self.status.tx.send("READY".to_owned());
        Ok(self.get_records()?)
    }

    /// Reconstruct session keys from opened shares when projection/meta is
    /// already loaded (for example after a ceremony while connected to storage).
    #[wasm_bindgen(js_name = reconstructNexusSessionFromShares)]
    pub async fn reconstruct_nexus_session_from_shares(
        &mut self,
        opened_shares_json: String,
    ) -> Result<Vec<NookSecretRecord>, JsError> {
        if self.vault.architecture.vault_type != nook_core::VaultType::Nexus {
            return Err(nook_core::MultiDeviceError::InvalidNexusThreshold.into());
        }
        let opened: Vec<nook_core::OpenedNexusShare> = serde_json::from_str(&opened_shares_json)
            .map_err(|e| NookError::Serialization(e.to_string()))?;
        let records = self.stored_records_snapshot();
        let keys = nook_core::reconstruct_nexus_vault_keys_from_opened(&records, &opened)?;
        self.apply_vault_keys(keys.secrets_key.as_str(), keys.members_key.as_str())?;
        let crypto = nook_core::VaultCrypto::new(&keys.secrets_key)?;
        let user_records = nook_core::user_stored_records(&records);
        self.vault.database =
            nook_core::Database::from_stored_records_with_crypto(&user_records, &crypto)?;
        self.persist_projection_cache().await?;
        Ok(self.get_records()?)
    }
}

impl NookVaultManager {
    async fn apply_loaded_nexus_vault(&mut self, loaded: LoadedVault) -> Result<(), NookError> {
        let LoadedVault {
            database,
            meta,
            secrets_key,
            members_key,
        } = loaded;
        self.apply_vault_keys(secrets_key.as_str(), members_key.as_str())?;
        self.vault.database = database;
        self.vault.meta = meta;
        self.event_log.enabled = true;
        if self.storage.mode != nook_core::StorageMode::Local {
            self.sync_events_from_current_provider().await?;
            self.apply_event_projection_to_session().await?;
        }
        self.persist_projection_cache().await?;
        Ok(())
    }

    /// Load vault content for nexus only when session keys already exist;
    /// otherwise fail closed with ceremony-required.
    pub(in crate::manager) fn load_stored_vault_or_nexus_ceremony(
        &self,
        content: &str,
        identity: &nook_core::DeviceIdentity,
    ) -> Result<LoadedVault, NookError> {
        let architecture = nook_core::read_vault_architecture(content)
            .unwrap_or_else(|_| self.vault.architecture.clone());
        if architecture.vault_type == nook_core::VaultType::Nexus {
            if self.vault.secrets_key.is_empty() || self.vault.members_key.is_empty() {
                return Err(nook_core::MultiDeviceError::NexusCeremonyRequired.into());
            }
            // Session already holds reconstructed keys — hydrate records without
            // resolving auth envelopes.
            let format = nook_core::detect_stored_format(content)?;
            let stored_records = nook_core::deserialize_stored(content, format)?;
            let secrets_key = nook_core::SymmetricKey::parse(&self.vault.secrets_key)?;
            let members_key = nook_core::SymmetricKey::parse(&self.vault.members_key)?;
            let crypto = nook_core::VaultCrypto::new(&secrets_key)?;
            let meta = nook_core::VaultMetaState::from_stored_records(&stored_records);
            let user_records = nook_core::user_stored_records(&stored_records);
            let database =
                nook_core::Database::from_stored_records_with_crypto(&user_records, &crypto)?;
            return Ok(LoadedVault {
                database,
                meta,
                secrets_key,
                members_key,
            });
        }
        load_stored_vault(content, identity)
    }

    /// Hydrate architecture + encrypted share meta without vault keys so the
    /// browser can open a local contribution and run the ceremony UI.
    pub(in crate::manager) fn prepare_nexus_ceremony_session(
        &mut self,
        content: &str,
    ) -> Result<(), NookError> {
        self.capture_vault_unlock(content);
        let format = nook_core::detect_stored_format(content)?;
        let stored_records = nook_core::deserialize_stored(content, format)?;
        self.vault.meta = nook_core::VaultMetaState::from_stored_records(&stored_records);
        self.ensure_nexus_architecture_from_shares();
        if !self.is_nexus_session() {
            return Err(nook_core::MultiDeviceError::InvalidNexusThreshold.into());
        }
        self.vault.secrets_key.clear();
        self.vault.members_key.clear();
        self.vault.crypto = None;
        self.vault.database.clear();
        self.vault.last_synced_content = content.to_owned();
        Ok(())
    }

    fn is_nexus_session(&self) -> bool {
        self.vault.architecture.vault_type == nook_core::VaultType::Nexus
            || !self.vault.meta.nexus_shares.is_empty()
    }

    /// Joiners may sync share events before architecture JSON is adopted.
    fn ensure_nexus_architecture_from_shares(&mut self) {
        if self.vault.architecture.vault_type == nook_core::VaultType::Nexus {
            return;
        }
        if self.vault.meta.nexus_shares.is_empty() {
            return;
        }
        let share_count = u8::try_from(self.vault.meta.nexus_shares.len()).unwrap_or(u8::MAX);
        let required = share_count.max(2);
        self.vault.architecture.vault_type = nook_core::VaultType::Nexus;
        self.vault.architecture.nexus = Some(nook_core::NexusPolicy {
            threshold: 2,
            required_participants: required,
            ready_participants: share_count,
        });
    }
}

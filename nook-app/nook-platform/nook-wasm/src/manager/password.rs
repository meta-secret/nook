//! Backup password entries — parallel to device-key unlock.
//!
//! Passwords are optional recovery credentials stored alongside `auth:` rows.
//! Adding a password never removes device keys. Unlocking via password writes
//! (or refreshes) this device's auth row so device-key unlock works again.

use super::NookVaultManager;
use super::session::VaultKeyMaterial;
use crate::BrowserTimestamp;
use crate::VaultSnapshotLookup;
#[cfg(all(test, target_arch = "wasm32"))]
use crate::storage::indexed_db::ImportVaultLabel;
use nook_core::ActiveVaultScope;

#[cfg(all(test, target_arch = "wasm32"))]
use crate::ImportVaultBlobRequest;
use crate::NookDatabase;

use crate::{NookError, NookPasswordEntrySummary};
use nook_core::{
    IsoTimestamp, MultiDeviceError, PasswordEntryId, SymmetricKey, VaultOperation, VaultType,
    VaultUnlock,
};
use wasm_bindgen::JsError;
use wasm_bindgen::prelude::wasm_bindgen;

const E2E_PASSWORD_SCRYPT_LOG_N: u8 = 10;

#[wasm_bindgen]
impl NookVaultManager {
    #[wasm_bindgen]
    pub fn list_vault_password_entries(&self) -> Result<Vec<NookPasswordEntrySummary>, JsError> {
        Ok(NookPasswordEntrySummary::password_entries_to_vec(
            &self.vault.password_entries,
        ))
    }

    #[wasm_bindgen]
    pub async fn fetch_vault_password_entries(
        &mut self,
        storage_mode: String,
        github_pat: String,
        github_repo: String,
    ) -> Result<Vec<NookPasswordEntrySummary>, JsError> {
        // Reading password envelopes from another provider is still a
        // same-vault operation. Preserve the active vault metadata while the
        // storage target changes; clearing it here used to erase vault_name
        // immediately before enrollment payloads were issued.
        self.prepare_storage_preserving_vault_metadata(&storage_mode, &github_pat, &github_repo)
            .await?;
        let mut vault_missing = false;
        let mut content = self.fetch_vault_content(&mut vault_missing).await?;
        if (vault_missing || content.trim().is_empty())
            && let VaultSnapshotLookup::Stored(cached) =
                NookDatabase::load_vault_local_cache(&self.local_cache_ref()).await?
            && !cached.trim().is_empty()
        {
            content = cached;
        }
        self.hydrate_listed_password_entries(&content).await?;
        Ok(NookPasswordEntrySummary::password_entries_to_vec(
            &self.vault.password_entries,
        ))
    }

    async fn hydrate_listed_password_entries(&mut self, content: &str) -> Result<(), NookError> {
        let entries = nook_core::VaultFormatDocument::new(content).password_entries()?;
        if !entries.is_empty() {
            self.vault.password_entries = entries;
            return Ok(());
        }
        if !content.trim().is_empty() {
            self.capture_vault_unlock(content)?;
        }
        if self.vault.store_id.trim().is_empty()
            && let ActiveVaultScope::StoreId(store_id) = NookDatabase::get_active_vault_id().await?
            && !store_id.trim().is_empty()
        {
            self.vault.store_id = store_id;
        }
        if self.event_log_has_events().await? {
            self.hydrate_locked_projection_from_events().await?;
        }
        Ok(())
    }

    #[wasm_bindgen]
    pub fn verify_vault_password(&self, entry_id: &str, password: &str) -> bool {
        match self
            .vault
            .password_entries
            .iter()
            .find(|entry| entry.id == entry_id)
        {
            Some(entry) => entry.verify_password(password),
            None => false,
        }
    }

    #[wasm_bindgen]
    pub async fn add_vault_password(
        &mut self,
        label: String,
        password: String,
    ) -> Result<(), JsError> {
        self.add_vault_password_with_work_factor(
            label,
            password,
            nook_core::PASSWORD_SCRYPT_LOG_N.into(),
        )
        .await
    }

    #[wasm_bindgen]
    pub async fn add_vault_password_for_e2e(
        &mut self,
        label: String,
        password: String,
    ) -> Result<(), JsError> {
        self.add_vault_password_with_work_factor(label, password, E2E_PASSWORD_SCRYPT_LOG_N)
            .await
    }

    async fn add_vault_password_with_work_factor(
        &mut self,
        label: String,
        password: String,
        work_factor: u8,
    ) -> Result<(), JsError> {
        if self.vault.architecture.vault_type == VaultType::Sentinel {
            return Err(MultiDeviceError::SentinelPasswordUnlockForbidden.into());
        }
        self.ensure_vault_crypto_from_cache().await?;
        if matches!(self.vault.key_material(), VaultKeyMaterial::Unavailable) {
            return Err(NookError::Database(
                "Vault must be unlocked before adding a password.".to_owned(),
            )
            .into());
        }
        let keys = nook_core::VaultKeys {
            secrets_key: SymmetricKey::parse(&self.vault.secrets_key)?,
            members_key: SymmetricKey::parse(&self.vault.members_key)?,
        };
        let entry = nook_core::PasswordEntryIssuance::with_work_factor(
            &keys,
            nook_core::CompactToken::generate()?.as_str(),
            &label,
            &BrowserTimestamp::now().into_iso_string(),
            &password,
            work_factor.into(),
        )
        .issue()?;

        self.vault.password_entries.push(entry.clone());
        self.vault.unlock = VaultUnlock::Keys;
        self.persist_vault_change(vec![VaultOperation::PasswordAdded {
            entry_id: PasswordEntryId::parse(&entry.id)?,
            label: entry.label,
            created_at: IsoTimestamp::parse(&entry.created_at)?,
            envelope: entry.envelope,
        }])
        .await?;
        Ok(())
    }

    #[wasm_bindgen]
    pub async fn set_vault_password(&mut self, password: String) -> Result<(), JsError> {
        self.add_vault_password("Vault password".to_owned(), password)
            .await
    }

    #[wasm_bindgen]
    pub async fn update_vault_password_entry(
        &mut self,
        entry_id: String,
        password: String,
    ) -> Result<(), JsError> {
        self.update_vault_password_entry_with_work_factor(
            entry_id,
            password,
            nook_core::PASSWORD_SCRYPT_LOG_N.into(),
        )
        .await
    }

    #[wasm_bindgen]
    pub async fn update_vault_password_entry_for_e2e(
        &mut self,
        entry_id: String,
        password: String,
    ) -> Result<(), JsError> {
        self.update_vault_password_entry_with_work_factor(
            entry_id,
            password,
            E2E_PASSWORD_SCRYPT_LOG_N,
        )
        .await
    }

    async fn update_vault_password_entry_with_work_factor(
        &mut self,
        entry_id: String,
        password: String,
        work_factor: u8,
    ) -> Result<(), JsError> {
        if self.vault.architecture.vault_type == VaultType::Sentinel {
            return Err(MultiDeviceError::SentinelPasswordUnlockForbidden.into());
        }
        self.ensure_vault_crypto_from_cache().await?;
        if matches!(self.vault.key_material(), VaultKeyMaterial::Unavailable) {
            return Err(NookError::Database(
                "Vault must be unlocked before updating a password.".to_owned(),
            )
            .into());
        }
        let target_entry = self
            .vault
            .password_entries
            .iter()
            .find(|entry| entry.id == entry_id)
            .ok_or_else(|| NookError::Database("Password entry not found.".to_owned()))?
            .clone();
        if !target_entry.envelope.supports_key_rewrap() {
            let keys = nook_core::VaultKeys {
                secrets_key: SymmetricKey::parse(&self.vault.secrets_key)?,
                members_key: SymmetricKey::parse(&self.vault.members_key)?,
            };
            let envelope = nook_core::PasswordEnvelopeAttachment::with_work_factor(
                &keys,
                &password,
                work_factor.into(),
            )
            .attach()?;
            self.persist_vault_change(vec![VaultOperation::PasswordEnvelopeUpgraded {
                entry_id: PasswordEntryId::parse(&entry_id)?,
                envelope,
            }])
            .await?;
            return Ok(());
        }
        if self
            .vault
            .password_entries
            .iter()
            .any(|entry| entry.id != entry_id && !entry.envelope.supports_key_rewrap())
        {
            return Err(NookError::Database(
                "Upgrade every legacy password entry before rotating the security epoch."
                    .to_owned(),
            )
            .into());
        }
        let envelope = self
            .rotate_password_security_epoch(
                PasswordEntryId::parse(&entry_id)?,
                &password,
                work_factor,
            )
            .await?;
        let target = self
            .vault
            .password_entries
            .iter_mut()
            .find(|entry| entry.id == entry_id)
            .ok_or_else(|| NookError::Database("Password entry not found.".to_owned()))?;
        target.envelope = envelope;
        self.persist_vault_change(vec![]).await?;
        Ok(())
    }

    #[wasm_bindgen]
    pub async fn remove_vault_password_entry(&mut self, entry_id: String) -> Result<(), JsError> {
        if self.vault.architecture.vault_type == VaultType::Sentinel {
            return Err(MultiDeviceError::SentinelPasswordUnlockForbidden.into());
        }
        let remaining_entries = self
            .vault
            .password_entries
            .iter()
            .filter(|entry| entry.id != entry_id)
            .cloned()
            .collect();
        self.ensure_event_log_ready().await?;
        self.rotate_security_epoch_with_password_entries(
            VaultOperation::PasswordRemoved {
                entry_id: PasswordEntryId::parse(&entry_id)?,
            },
            remaining_entries,
        )
        .await?;
        Ok(())
    }

    #[wasm_bindgen]
    pub async fn remove_vault_password(&mut self) -> Result<(), JsError> {
        if self.vault.architecture.vault_type == VaultType::Sentinel {
            return Err(MultiDeviceError::SentinelPasswordUnlockForbidden.into());
        }
        let entry_ids: Vec<String> = self
            .vault
            .password_entries
            .iter()
            .map(|entry| entry.id.clone())
            .collect();
        self.ensure_event_log_ready().await?;
        if let Some(first_id) = entry_ids.first() {
            self.rotate_security_epoch_with_password_entries(
                VaultOperation::PasswordRemoved {
                    entry_id: PasswordEntryId::parse(first_id)?,
                },
                Vec::new(),
            )
            .await?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod metadata_tests {
    use super::*;
    use crate::manager::VaultNameState;
    use nook_core::{DeviceIdentity, VaultNameRef, VaultStoreIdentityRef, VaultVersionWrite};
    use std::slice;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    fn password_listing_and_verification_reject_unknown_or_wrong_credentials() -> anyhow::Result<()>
    {
        let keys = nook_core::VaultKeys::generate()?;
        let entry = nook_core::PasswordEntryIssuance::with_work_factor(
            &keys,
            "pwdentry001",
            "Recovery",
            "2026-09-06T00:00:00Z",
            "correct horse battery staple",
            E2E_PASSWORD_SCRYPT_LOG_N.into(),
        )
        .issue()?;
        let mut manager = NookVaultManager::new();
        manager.vault.password_entries = vec![entry.clone()];

        let summaries = manager
            .list_vault_password_entries()
            .map_err(|_| anyhow::anyhow!("password listing failed"))?;
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].id(), entry.id);
        assert_eq!(summaries[0].label(), "Recovery");
        assert_eq!(summaries[0].created_at(), "2026-09-06T00:00:00Z");
        assert!(manager.verify_vault_password(&entry.id, "correct horse battery staple"));
        assert!(!manager.verify_vault_password(&entry.id, "wrong password"));
        assert!(!manager.verify_vault_password("pwdentry002", "correct horse battery staple"));
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn sentinel_password_mutations_fail_closed_without_session_changes() -> anyhow::Result<()>
    {
        let mut manager = NookVaultManager::new();
        manager.vault.architecture.vault_type = VaultType::Sentinel;
        let before = manager.vault.password_entries.clone();

        assert!(
            manager
                .add_vault_password_for_e2e("Recovery".to_owned(), "password".to_owned())
                .await
                .is_err()
        );
        assert!(
            manager
                .update_vault_password_entry_for_e2e(
                    "pwdentry001".to_owned(),
                    "password".to_owned()
                )
                .await
                .is_err()
        );
        assert!(
            manager
                .remove_vault_password_entry("pwdentry001".to_owned())
                .await
                .is_err()
        );
        assert!(manager.remove_vault_password().await.is_err());
        assert_eq!(manager.vault.password_entries, before);
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn locked_password_mutations_fail_closed_without_session_changes() -> anyhow::Result<()> {
        let mut manager = NookVaultManager::new();

        assert!(
            manager
                .add_vault_password_for_e2e("Recovery".to_owned(), "password".to_owned())
                .await
                .is_err()
        );
        assert!(
            manager
                .update_vault_password_entry_for_e2e(
                    "pwdentry001".to_owned(),
                    "password".to_owned(),
                )
                .await
                .is_err()
        );
        assert!(
            manager
                .remove_vault_password_entry("pwdentry001".to_owned())
                .await
                .is_err()
        );
        assert!(manager.remove_vault_password().await.is_err());
        assert!(manager.vault.password_entries.is_empty());
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn local_password_add_and_remove_updates_the_event_log() -> anyhow::Result<()> {
        let keys = nook_core::VaultKeys::generate()?;
        let mut manager = NookVaultManager::new();
        manager.vault.store_id = nook_core::StoreId::generate()?.to_string();
        manager.apply_vault_keys(keys.secrets_key.as_str(), keys.members_key.as_str())?;
        let identity = DeviceIdentity::generate()?;
        manager.device.identity_private_key = identity.secret_string().into_inner();
        manager.bootstrap_event_log_genesis().await?;

        manager
            .add_vault_password_for_e2e("Recovery".to_owned(), "password".to_owned())
            .await
            .map_err(|error| anyhow::anyhow!("password add failed: {error:?}"))?;
        let entry = manager
            .vault
            .password_entries
            .first()
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("password entry was not added"))?;
        assert!(manager.verify_vault_password(&entry.id, "password"));

        manager
            .remove_vault_password_entry(entry.id)
            .await
            .map_err(|error| anyhow::anyhow!("password entry removal failed: {error:?}"))?;
        assert!(manager.vault.password_entries.is_empty());
        manager
            .remove_vault_password()
            .await
            .map_err(|error| anyhow::anyhow!("password removal failed: {error:?}"))?;
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn password_provider_switch_preserves_active_vault_metadata() -> anyhow::Result<()> {
        let keys = nook_core::VaultKeys::generate()?;
        let entry = nook_core::PasswordEntryIssuance::with_work_factor(
            &keys,
            nook_core::CompactToken::generate()?.as_str(),
            "Recovery",
            "2026-07-29T00:00:00Z",
            "correct horse battery staple",
            E2E_PASSWORD_SCRYPT_LOG_N.into(),
        )
        .issue()?;
        let mut manager = NookVaultManager::new();
        manager.vault.vault_name = VaultNameState::Named("Personal".to_owned());
        manager.vault.unlock = VaultUnlock::Passwords {
            entries: vec![entry.clone()],
        };
        manager.vault.password_entries = vec![entry.clone()];
        manager.vault.store_id = nook_core::StoreId::generate()?.to_string();
        manager.vault.last_synced_content =
            nook_core::VaultRecordSet::serialize_yaml_with_unlock_name_architecture(
                &manager.vault.meta.to_stored_records(),
                &manager.vault.unlock,
                &manager.vault.password_entries,
                VaultStoreIdentityRef::Assigned(&manager.vault.store_id),
                VaultNameRef::Named("Personal"),
                VaultVersionWrite::Initial,
                &manager.vault.architecture,
            )?
            .into_inner();

        manager
            .prepare_storage_preserving_vault_metadata(
                "icloud",
                "oauth_token_for_metadata_test",
                "private-target\twork-vault.yaml",
            )
            .await?;
        manager
            .prepare_storage_preserving_vault_metadata("local", "", "")
            .await?;

        assert!(matches!(
            &manager.vault.vault_name,
            VaultNameState::Named(name) if name == "Personal"
        ));
        assert_eq!(manager.vault.password_entries, vec![entry.clone()]);
        assert_eq!(
            manager.vault.unlock,
            VaultUnlock::Passwords {
                entries: vec![entry]
            }
        );

        Ok(())
    }

    #[wasm_bindgen_test]
    async fn invalid_password_envelope_does_not_mutate_session_or_fall_back_to_events()
    -> anyhow::Result<()> {
        let keys = nook_core::VaultKeys::generate()?;
        let entry = nook_core::PasswordEntryIssuance::with_work_factor(
            &keys,
            nook_core::CompactToken::generate()?.as_str(),
            "Recovery",
            "2026-09-05T00:00:00Z",
            "correct horse battery staple",
            E2E_PASSWORD_SCRYPT_LOG_N.into(),
        )
        .issue()?;
        let remote_store_id = nook_core::StoreId::generate()?;
        let content = nook_core::VaultRecordSet::serialize_yaml_with_unlock_and_name(
            &[],
            &VaultUnlock::Keys,
            slice::from_ref(&entry),
            VaultStoreIdentityRef::Assigned(remote_store_id.as_str()),
            VaultNameRef::Named("Rejected remote"),
            VaultVersionWrite::Initial,
        )?
        .into_inner()
        .replacen("version: 2", "version: 3", 1);
        let mut manager = NookVaultManager::new();
        manager.vault.store_id = "store_existing11".to_owned();
        manager.vault.vault_name = VaultNameState::Named("Existing".to_owned());
        manager.vault.password_entries = vec![entry.clone()];

        let password_load = manager.load_password_unlock_records(&content, false).await;
        anyhow::ensure!(password_load.is_err(), "password load accepted version 3");
        let hydration = manager.hydrate_listed_password_entries(&content).await;
        anyhow::ensure!(hydration.is_err(), "password hydration accepted version 3");
        let mut malformed = content.replacen("version: 3", "version: 2", 1);
        malformed += "sentinel_shares:\n- key: sentinel_share:0123456789abcdef\n  value: invalid\n";
        let result = manager
            .load_password_unlock_records(&malformed, false)
            .await;
        anyhow::ensure!(result.is_err(), "password load accepted invalid share");
        assert_eq!(manager.vault.store_id, "store_existing11");
        assert!(matches!(
            &manager.vault.vault_name,
            VaultNameState::Named(name) if name == "Existing"
        ));
        assert_eq!(manager.vault.password_entries, vec![entry]);
        Ok(())
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod wasm_tests {
    use super::*;
    use crate::manager::VaultNameState;

    use crate::storage::indexed_db;
    use nook_core::{
        Database, DeviceIdentity, SecretId, SecretValue, StorageMode, VaultCrypto, VaultName,
        VaultNameRef, VaultStoreIdentityRef, VaultVersionWrite,
    };
    use std::slice;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    async fn legacy_password_entries_upgrade_sequentially_without_epoch_rotation()
    -> anyhow::Result<()> {
        let keys = nook_core::VaultKeys::generate()?;
        let mut entries = Vec::new();
        for (label, password) in [
            ("Primary", "legacy primary password"),
            ("Recovery", "legacy recovery password"),
        ] {
            let mut entry = nook_core::PasswordEntryIssuance::with_work_factor(
                &keys,
                nook_core::CompactToken::generate()?.as_str(),
                label,
                "2026-08-15T00:00:00Z",
                password,
                E2E_PASSWORD_SCRYPT_LOG_N.into(),
            )
            .issue()?;
            entry.envelope.version = nook_core::PasswordEnvelopeVersion::LEGACY;
            entries.push(entry);
        }
        let mut manager = NookVaultManager::new();
        manager.vault.store_id = nook_core::StoreId::generate()?.to_string();
        manager.vault.password_entries.clone_from(&entries);
        manager.apply_vault_keys(keys.secrets_key.as_str(), keys.members_key.as_str())?;
        let identity = DeviceIdentity::generate()?;
        manager.device.identity_private_key = identity.secret_string().into_inner();
        manager.bootstrap_event_log_genesis().await?;

        manager
            .update_vault_password_entry_for_e2e(
                entries[0].id.clone(),
                "new primary password".to_owned(),
            )
            .await
            .map_err(|error| anyhow::anyhow!("first legacy upgrade failed: {error:?}"))?;
        assert!(
            manager.vault.password_entries[0]
                .envelope
                .supports_key_rewrap()
        );
        assert!(
            !manager.vault.password_entries[1]
                .envelope
                .supports_key_rewrap()
        );

        manager
            .update_vault_password_entry_for_e2e(
                entries[1].id.clone(),
                "new recovery password".to_owned(),
            )
            .await
            .map_err(|error| anyhow::anyhow!("second legacy upgrade failed: {error:?}"))?;
        assert!(
            manager
                .vault
                .password_entries
                .iter()
                .all(|entry| entry.envelope.supports_key_rewrap())
        );
        let graph = NookDatabase::load_local_event_store(&manager.vault.store_id)
            .await?
            .load_graph(&manager.vault.store_id)?;
        let upgrades = graph
            .events()
            .flat_map(|(_, event)| event.body.operations.iter())
            .filter(|operation| {
                matches!(operation, VaultOperation::PasswordEnvelopeUpgraded { .. })
            })
            .count();
        assert_eq!(upgrades, 2);
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn failed_sync_flush_restores_local_projection_and_storage() -> anyhow::Result<()> {
        let keys = nook_core::VaultKeys::generate()?;
        let mut manager = NookVaultManager::new();
        manager.vault.vault_name = VaultNameState::Named("Personal".to_owned());
        manager.vault.store_id = nook_core::StoreId::generate()?.to_string();
        manager.vault.last_synced_content =
            nook_core::VaultRecordSet::serialize_yaml_with_unlock_name_architecture(
                &manager.vault.meta.to_stored_records(),
                &manager.vault.unlock,
                &manager.vault.password_entries,
                VaultStoreIdentityRef::Assigned(&manager.vault.store_id),
                VaultNameRef::Named("Personal"),
                VaultVersionWrite::Initial,
                &manager.vault.architecture,
            )?
            .into_inner();
        manager.vault.secrets_key = keys.secrets_key.as_str().to_owned();
        manager.vault.members_key = keys.members_key.as_str().to_owned();
        let identity = DeviceIdentity::generate()?;
        manager.device.identity_private_key = identity.secret_string().into_inner();
        manager.bootstrap_event_log_genesis().await?;
        manager.sync_outbox.provider_id = "configured-provider".to_owned();
        manager.sync_outbox.storage_mode = StorageMode::Github;
        manager.sync_outbox.access_token = "invalid-token".to_owned();
        manager.sync_outbox.repo_arg = "invalid-repository".to_owned();

        assert!(manager.set_vault_name("Rejected rename").await.is_err());
        assert!(
            manager.event_log_has_events().await?,
            "the browser-backed local write must succeed before the remote flush fails"
        );
        assert!(matches!(
            &manager.vault.vault_name,
            VaultNameState::Named(name) if name == "Personal"
        ));
        assert_eq!(
            nook_core::VaultFormatDocument::new(&manager.vault.last_synced_content).name()?,
            VaultName::Named("Personal".to_owned())
        );
        let persisted_projection = match NookDatabase::load_from_indexed_db().await? {
            VaultSnapshotLookup::Stored(content) => content,
            VaultSnapshotLookup::NotStored => {
                return Err(anyhow::anyhow!("persisted rolled-back projection is missing").into());
            }
        };
        assert_eq!(
            nook_core::VaultFormatDocument::new(&persisted_projection).name()?,
            VaultName::Named("Personal".to_owned())
        );
        assert_eq!(manager.storage.mode, StorageMode::Local);
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn password_unlock_requires_event_log() -> anyhow::Result<()> {
        let keys = nook_core::VaultKeys::generate()?;
        let mut database = Database::new();
        let secret_id = SecretId::from_vault_record(
            format!("secret_{}", nook_core::CompactToken::generate()?).as_str(),
        );
        database.insert(
            secret_id,
            SecretValue::SecureNote(nook_core::SecureNoteSecret {
                title: "projection note".to_owned(),
                note: "event log required".to_owned(),
            }),
        );
        let crypto = VaultCrypto::new(&keys.secrets_key)?;
        let records = database.to_stored_records_with_crypto(&crypto)?;
        let password_entry = nook_core::PasswordEntryIssuance::with_work_factor(
            &keys,
            nook_core::CompactToken::generate()?.as_str(),
            "Recovery",
            "2026-07-13T00:00:00Z",
            "correct horse battery staple",
            E2E_PASSWORD_SCRYPT_LOG_N.into(),
        )
        .issue()?;
        let store_id = nook_core::StoreId::generate()?.to_string();
        let yaml = nook_core::VaultRecordSet::serialize_yaml_with_unlock_and_name(
            &records,
            &VaultUnlock::Keys,
            slice::from_ref(&password_entry),
            VaultStoreIdentityRef::Assigned(&store_id),
            VaultNameRef::Named("Projection rejection test"),
            VaultVersionWrite::Initial,
        )?;
        NookDatabase::import_vault_blob(ImportVaultBlobRequest {
            content: yaml.as_str(),
            label: ImportVaultLabel::Override("Projection rejection test"),
        })
        .await?;
        NookDatabase::switch_active_vault(&store_id).await?;

        let mut manager = NookVaultManager::new();
        let result = manager
            .connect_with_password(
                "local".to_owned(),
                String::new(),
                String::new(),
                password_entry.id.clone(),
                "correct horse battery staple".to_owned(),
                50,
            )
            .await;
        assert!(result.is_err(), "missing event log must be rejected");
        assert!(manager.device.identity_private_key.is_empty());
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn password_unlock_succeeds_after_app_key_is_deleted() -> anyhow::Result<()> {
        let keys = nook_core::VaultKeys::generate()?;
        let identity = DeviceIdentity::generate()?;
        let password_entry = nook_core::PasswordEntryIssuance::with_work_factor(
            &keys,
            nook_core::CompactToken::generate()?.as_str(),
            "Recovery",
            "2026-08-16T00:00:00Z",
            "correct horse battery staple",
            E2E_PASSWORD_SCRYPT_LOG_N.into(),
        )
        .issue()?;
        let mut owner = NookVaultManager::new();
        owner.vault.store_id = nook_core::StoreId::generate()?.to_string();
        owner.device.identity_private_key = identity.secret_string().into_inner();
        owner.apply_genesis_vault_keys(&identity, &keys)?;
        owner.vault.password_entries = vec![password_entry.clone()];
        owner.bootstrap_event_log_genesis().await?;
        let yaml = owner.serialize_current_projection_yaml()?;
        let store_id = owner.vault.store_id.clone();
        NookDatabase::import_vault_blob(ImportVaultBlobRequest {
            content: yaml.as_str(),
            label: ImportVaultLabel::Override("Password recovery"),
        })
        .await?;
        NookDatabase::switch_active_vault(&store_id).await?;

        // This manager represents the recovered browser: no app identity is
        // available, so password recovery must not enrol or require one.
        let mut recovered = NookVaultManager::new();
        let page = recovered
            .connect_with_password(
                "local".to_owned(),
                String::new(),
                String::new(),
                password_entry.id,
                "correct horse battery staple".to_owned(),
                50,
            )
            .await
            .map_err(|error| anyhow::anyhow!("password recovery failed: {error:?}"))?;

        assert!(recovered.device.identity_private_key.is_empty());
        assert_eq!(recovered.vault.store_id, store_id);
        assert_eq!(page.total(), 0);
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn password_entries_list_after_app_key_is_deleted() -> anyhow::Result<()> {
        let keys = nook_core::VaultKeys::generate()?;
        let identity = DeviceIdentity::generate()?;
        let password_entry = nook_core::PasswordEntryIssuance::with_work_factor(
            &keys,
            nook_core::CompactToken::generate()?.as_str(),
            "Recovery",
            "2026-08-16T00:00:00Z",
            "correct horse battery staple",
            E2E_PASSWORD_SCRYPT_LOG_N.into(),
        )
        .issue()?;
        let mut owner = NookVaultManager::new();
        owner.vault.store_id = nook_core::StoreId::generate()?.to_string();
        owner.device.identity_private_key = identity.secret_string().into_inner();
        owner.apply_genesis_vault_keys(&identity, &keys)?;
        owner.vault.password_entries = vec![password_entry.clone()];
        owner.bootstrap_event_log_genesis().await?;
        let yaml = owner.serialize_current_projection_yaml()?;
        let store_id = owner.vault.store_id.clone();
        NookDatabase::import_vault_blob(ImportVaultBlobRequest {
            content: yaml.as_str(),
            label: ImportVaultLabel::Override("Password recovery"),
        })
        .await?;
        NookDatabase::switch_active_vault(&store_id).await?;

        let mut recovered = NookVaultManager::new();
        let listed = recovered
            .fetch_vault_password_entries("local".to_owned(), String::new(), String::new())
            .await
            .map_err(|error| anyhow::anyhow!("password listing failed: {error:?}"))?;

        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id(), password_entry.id);
        assert_eq!(listed[0].label(), "Recovery");
        assert!(recovered.device.identity_private_key.is_empty());
        Ok(())
    }
}

//! Backup password entries — parallel to device-key unlock.
//!
//! Passwords are optional recovery credentials stored alongside `auth:` rows.
//! Adding a password never removes device keys. Unlocking via password writes
//! (or refreshes) this device's auth row so device-key unlock works again.

use super::NookVaultManager;
use crate::NookError;
use crate::NookPasswordEntrySummary;
use crate::NookSecretPage;
use crate::conversion::wasm_iso_timestamp;
use crate::storage::event_db::load_local_event_store;
use crate::storage::identity_record;
use crate::storage::indexed_db::{get_active_vault_id, load_vault_local_cache, save_to_indexed_db};
use crate::types::password_entries_to_vec;
use nook_core::{
    DeviceSigningPublicKey, IsoTimestamp, MemberLabel, MultiDeviceError, PasswordEntryId,
    SecretTypeFilter, StorageMode, StoreId, SymmetricKey, VaultMetaState, VaultOperation,
    VaultType, VaultUnlock,
};
use wasm_bindgen::JsError;
use wasm_bindgen::prelude::wasm_bindgen;

const E2E_PASSWORD_SCRYPT_LOG_N: u8 = 10;

#[wasm_bindgen]
impl NookVaultManager {
    #[wasm_bindgen]
    pub fn list_vault_password_entries(&self) -> Result<Vec<NookPasswordEntrySummary>, JsError> {
        Ok(password_entries_to_vec(&self.vault.password_entries))
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
            && let Some(cached) = load_vault_local_cache(&self.local_cache_ref()).await?
            && !cached.trim().is_empty()
        {
            content = cached;
        }
        self.hydrate_listed_password_entries(&content).await?;
        Ok(password_entries_to_vec(&self.vault.password_entries))
    }

    async fn hydrate_listed_password_entries(&mut self, content: &str) -> Result<(), NookError> {
        if let Ok(entries) = nook_core::read_vault_password_entries(content)
            && !entries.is_empty()
        {
            self.vault.password_entries = entries;
            return Ok(());
        }
        if !content.trim().is_empty() {
            self.capture_vault_unlock(content).ok();
        }
        if self.vault.store_id.trim().is_empty()
            && let Some(store_id) = get_active_vault_id().await?
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
            Some(entry) => nook_core::verify_password_entry(entry, password),
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
        if self.vault.secrets_key.is_empty() || self.vault.members_key.is_empty() {
            return Err(NookError::Database(
                "Vault must be unlocked before adding a password.".to_owned(),
            )
            .into());
        }
        let keys = nook_core::VaultKeys {
            secrets_key: SymmetricKey::parse(&self.vault.secrets_key)?,
            members_key: SymmetricKey::parse(&self.vault.members_key)?,
        };
        let entry = nook_core::create_password_entry_with_work_factor(
            &keys,
            nook_core::generate_id()?.as_str(),
            &label,
            &wasm_iso_timestamp(),
            &password,
            work_factor.into(),
        )?;

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
        if self.vault.secrets_key.is_empty() || self.vault.members_key.is_empty() {
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
        if !nook_core::password_envelope_supports_key_rewrap(&target_entry.envelope) {
            let keys = nook_core::VaultKeys {
                secrets_key: SymmetricKey::parse(&self.vault.secrets_key)?,
                members_key: SymmetricKey::parse(&self.vault.members_key)?,
            };
            let envelope = nook_core::attach_password_envelope_with_work_factor(
                &keys,
                &password,
                work_factor.into(),
            )?;
            self.persist_vault_change(vec![VaultOperation::PasswordEnvelopeUpgraded {
                entry_id: PasswordEntryId::parse(&entry_id)?,
                envelope,
            }])
            .await?;
            return Ok(());
        }
        if self.vault.password_entries.iter().any(|entry| {
            entry.id != entry_id
                && !nook_core::password_envelope_supports_key_rewrap(&entry.envelope)
        }) {
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

    #[wasm_bindgen]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects `connect_with_password` paging values through JavaScript Number scalars"
        )
    )]
    pub async fn connect_with_password(
        &mut self,
        storage_mode: String,
        github_pat: String,
        github_repo: String,
        entry_id: String,
        password: String,
        page_limit: u32,
    ) -> Result<NookSecretPage, JsError> {
        let _ = self.status.tx.send("CONNECT_START".to_owned());
        self.prepare_storage(&storage_mode, &github_pat, &github_repo)
            .await?;
        // A backup password is an alternate vault-key credential. After an
        // explicit Lock the wrapped device identity stays protected, but the
        // password must still be able to open the local vault without first
        // authorizing that identity. When the identity is already available
        // (for example during QR enrolment), refresh membership as before.
        let identity = if self.device.identity_private_key.is_empty() {
            None
        } else {
            Some(self.ensure_device_identity()?)
        };

        let mut vault_missing = false;
        let content = self.fetch_vault_content(&mut vault_missing).await?;
        let (event_log_remote, records) = self
            .load_password_unlock_records(&content, vault_missing)
            .await?;

        if self.vault.architecture.vault_type == VaultType::Sentinel {
            return Err(MultiDeviceError::SentinelPasswordUnlockForbidden.into());
        }

        if records.is_empty() {
            return Err(
                NookError::Database("No vault records found at this provider.".to_owned()).into(),
            );
        }

        let entry = self
            .vault
            .password_entries
            .iter()
            .find(|entry| {
                if entry_id.trim().is_empty() {
                    true
                } else {
                    entry.id == entry_id
                }
            })
            .or_else(|| self.vault.password_entries.first())
            .ok_or_else(|| {
                NookError::Decryption("No backup password found on this vault.".to_owned())
            })?
            .clone();
        let keys = nook_core::resolve_keys_from_entry(&entry, &password)?;

        self.apply_vault_keys(keys.secrets_key.as_str(), keys.members_key.as_str())?;
        self.vault.unlock = VaultUnlock::Keys;
        self.vault.meta = VaultMetaState::from_stored_records(&records);
        self.ensure_event_log_ready().await?;
        if let Some(identity) = identity.as_ref() {
            let store_id = StoreId::parse(&self.vault.store_id)
                .map_err(|error| NookError::Database(error.to_string()))?;
            if let Err(error) =
                identity_record::validate_vault_identity_enrollment(identity, &store_id).await
            {
                self.reset_vault_session();
                return Err(error.into());
            }
            self.persist_password_unlock_membership(&records, identity, &keys)
                .await?;
            if let Err(error) = self.ensure_identity_after_connect(identity).await {
                self.reset_vault_session();
                return Err(error.into());
            }
        }

        if event_log_remote {
            let yaml = self.serialize_current_projection_yaml()?;
            save_to_indexed_db(&yaml).await?;
        }
        self.purge_legacy_plaintext_search_catalog().await?;
        let _ = self.status.tx.send("READY".to_owned());
        NookSecretPage::from_core(self.query_secret_page(
            "",
            SecretTypeFilter::All,
            0,
            page_limit,
        )?)
        .map_err(Into::into)
    }

    async fn load_password_unlock_records(
        &mut self,
        content: &str,
        vault_missing: bool,
    ) -> Result<(bool, Vec<nook_core::StoredSecretRecord>), NookError> {
        let event_log_remote =
            self.storage.mode != StorageMode::Local && (vault_missing || content.trim().is_empty());
        if event_log_remote {
            self.sync_events_from_current_provider().await?;
            if self.vault.store_id.is_empty() || !self.event_log_has_events().await? {
                return Err(NookError::Database(
                    "No event log found at this provider. Ask the inviter to confirm the repo/path."
                        .to_owned(),
                ));
            }
            let store = load_local_event_store(&self.vault.store_id).await?;
            let graph = store.load_graph(&self.vault.store_id)?;
            let projection = nook_core::project_vault(&graph, &self.vault.store_id)?;
            self.vault.password_entries = projection.password_entries.clone();
            let user_records: Vec<nook_core::StoredSecretRecord> =
                projection.live_secrets(&graph).into_values().collect();
            let mut meta = VaultMetaState::from_stored_records(&user_records);
            nook_core::materialize_vault_meta_from_graph(&graph, &mut meta)?;
            self.vault.meta = meta;
            return Ok((true, self.vault.meta.to_stored_records()));
        }

        if vault_missing || content.trim().is_empty() {
            return Err(NookError::Database(
                "No vault found at this provider. Ask the inviter to confirm the repo/path."
                    .to_owned(),
            ));
        }
        self.capture_vault_unlock(content)?;
        let format = nook_core::detect_stored_format(content)?;
        let mut records = nook_core::deserialize_stored(content, format)?;
        records.retain(|record| !nook_core::is_join_stored_record(record));
        Ok((false, records))
    }

    async fn persist_password_unlock_membership(
        &mut self,
        records: &[nook_core::StoredSecretRecord],
        identity: &nook_core::DeviceIdentity,
        keys: &nook_core::VaultKeys,
    ) -> Result<(), NookError> {
        if self.vault.architecture.vault_type == VaultType::Sentinel {
            return Err(MultiDeviceError::SentinelPasswordUnlockForbidden.into());
        }
        if !self.event_log_has_events().await? {
            return Err(NookError::Database(
                "Vault event log is required.".to_owned(),
            ));
        }
        self.persist_event_log_password_membership(records, identity, keys)
            .await
    }

    /// Password QR/self-enrol is one-step: the joiner already holds vault keys
    /// from the envelope, so write membership directly. Do not leave a pending
    /// `JoinRequested` that would require owner approval.
    async fn persist_event_log_password_membership(
        &mut self,
        records: &[nook_core::StoredSecretRecord],
        identity: &nook_core::DeviceIdentity,
        keys: &nook_core::VaultKeys,
    ) -> Result<(), NookError> {
        let signing = self.ensure_signing_identity().await?;
        let signing_pk =
            DeviceSigningPublicKey::from_trusted(hex::encode(signing.verifying_key().as_bytes()));
        let existing_roster =
            nook_core::resolve_member_roster(records, &keys.members_key).unwrap_or_default();
        let updated_roster = nook_core::roster_add_member(
            existing_roster,
            nook_core::member_from_identity(identity, &wasm_iso_timestamp()),
        );
        let member_records = nook_core::build_members_records(&updated_roster, &keys.members_key)?;
        for record in &member_records {
            self.vault.meta.apply_record(record);
        }

        let operations = match self.vault.architecture.vault_type {
            VaultType::Simple => {
                let auth_record =
                    nook_core::genesis_auth_record(identity, &keys.secrets_key, &keys.members_key)?;
                let envelopes = nook_core::parse_auth_envelopes(auth_record.value.as_str())?;
                self.vault.meta.apply_record(&auth_record);
                vec![VaultOperation::JoinApproved {
                    device_id: identity.device_id().clone(),
                    encryption_public_key: identity.public_key().clone(),
                    signing_public_key: signing_pk,
                    label: MemberLabel::from_trusted(String::new()),
                    secrets_key_ciphertext: envelopes.secrets_key,
                    members_key_ciphertext: envelopes.members_key,
                }]
            }
            VaultType::Sentinel => {
                unreachable!("sentinel password membership forbidden")
            }
        };
        self.append_vault_operations(operations).await?;
        self.flush_event_outbox().await?;
        self.persist_projection_cache().await
    }
}

#[cfg(test)]
mod metadata_tests {
    use super::*;
    use crate::manager::VaultNameState;
    use nook_core::{VaultNameRef, VaultStoreIdentityRef, VaultVersionWrite};
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    async fn password_provider_switch_preserves_active_vault_metadata() -> anyhow::Result<()> {
        let keys = nook_core::generate_vault_keys()?;
        let entry = nook_core::create_password_entry_with_work_factor(
            &keys,
            nook_core::generate_id()?.as_str(),
            "Recovery",
            "2026-07-29T00:00:00Z",
            "correct horse battery staple",
            E2E_PASSWORD_SCRYPT_LOG_N.into(),
        )?;
        let mut manager = NookVaultManager::new();
        manager.vault.vault_name = VaultNameState::Named("Personal".to_owned());
        manager.vault.unlock = VaultUnlock::Passwords {
            entries: vec![entry.clone()],
        };
        manager.vault.password_entries = vec![entry.clone()];
        manager.vault.store_id = nook_core::generate_store_id()?.to_string();
        manager.vault.last_synced_content =
            nook_core::serialize_stored_yaml_with_unlock_name_architecture(
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
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod wasm_tests {
    use super::*;
    use crate::storage::indexed_db;
    use crate::storage::indexed_db::{import_vault_blob, switch_active_vault};
    use nook_core::{
        Database, DeviceIdentity, SecretId, SecretValue, VaultCrypto, VaultName, VaultNameRef,
        VaultStoreIdentityRef, VaultVersionWrite,
    };
    use std::slice;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    async fn legacy_password_entries_upgrade_sequentially_without_epoch_rotation()
    -> anyhow::Result<()> {
        let keys = nook_core::generate_vault_keys()?;
        let mut entries = Vec::new();
        for (label, password) in [
            ("Primary", "legacy primary password"),
            ("Recovery", "legacy recovery password"),
        ] {
            let mut entry = nook_core::create_password_entry_with_work_factor(
                &keys,
                nook_core::generate_id()?.as_str(),
                label,
                "2026-08-15T00:00:00Z",
                password,
                E2E_PASSWORD_SCRYPT_LOG_N.into(),
            )?;
            entry.envelope.version = 1;
            entries.push(entry);
        }
        let mut manager = NookVaultManager::new();
        manager.vault.store_id = nook_core::generate_store_id()?.to_string();
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
        assert!(nook_core::password_envelope_supports_key_rewrap(
            &manager.vault.password_entries[0].envelope
        ));
        assert!(!nook_core::password_envelope_supports_key_rewrap(
            &manager.vault.password_entries[1].envelope
        ));

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
                .all(|entry| { nook_core::password_envelope_supports_key_rewrap(&entry.envelope) })
        );
        let graph = load_local_event_store(&manager.vault.store_id)
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
        let keys = nook_core::generate_vault_keys()?;
        let mut manager = NookVaultManager::new();
        manager.vault.vault_name = VaultNameState::Named("Personal".to_owned());
        manager.vault.store_id = nook_core::generate_store_id()?.to_string();
        manager.vault.last_synced_content =
            nook_core::serialize_stored_yaml_with_unlock_name_architecture(
                &manager.vault.meta.to_stored_records(),
                &manager.vault.unlock,
                &manager.vault.password_entries,
                VaultStoreIdentityRef::Assigned(&manager.vault.store_id),
                VaultNameRef::Named("Personal"),
                VaultVersionWrite::Initial,
                &manager.vault.architecture,
            )?
            .into_inner();
        manager.vault.secrets_key = keys.secrets_key.to_string();
        manager.vault.members_key = keys.members_key.to_string();
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
            nook_core::read_vault_name(&manager.vault.last_synced_content)?,
            VaultName::Named("Personal".to_owned())
        );
        let persisted_projection = indexed_db::load_from_indexed_db()
            .await?
            .ok_or_else(|| anyhow::anyhow!("persisted rolled-back projection is missing"))?;
        assert_eq!(
            nook_core::read_vault_name(&persisted_projection)?,
            VaultName::Named("Personal".to_owned())
        );
        assert_eq!(manager.storage.mode, StorageMode::Local);
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn password_unlock_requires_event_log() -> anyhow::Result<()> {
        let keys = nook_core::generate_vault_keys()?;
        let mut database = Database::new();
        let secret_id =
            SecretId::from_vault_record(format!("secret_{}", nook_core::generate_id()?).as_str());
        database.insert(
            secret_id,
            SecretValue::SecureNote(nook_core::SecureNoteSecret {
                title: "projection note".to_owned(),
                note: "event log required".to_owned(),
            }),
        );
        let crypto = VaultCrypto::new(&keys.secrets_key)?;
        let records = database.to_stored_records_with_crypto(&crypto)?;
        let password_entry = nook_core::create_password_entry_with_work_factor(
            &keys,
            nook_core::generate_id()?.as_str(),
            "Recovery",
            "2026-07-13T00:00:00Z",
            "correct horse battery staple",
            E2E_PASSWORD_SCRYPT_LOG_N.into(),
        )?;
        let store_id = nook_core::generate_store_id()?.to_string();
        let yaml = nook_core::serialize_stored_yaml_with_unlock_and_name(
            &records,
            &VaultUnlock::Keys,
            slice::from_ref(&password_entry),
            VaultStoreIdentityRef::Assigned(&store_id),
            VaultNameRef::Named("Projection rejection test"),
            VaultVersionWrite::Initial,
        )?;
        import_vault_blob(yaml.as_str(), Some("Projection rejection test")).await?;
        switch_active_vault(&store_id).await?;

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
        let keys = nook_core::generate_vault_keys()?;
        let identity = DeviceIdentity::generate()?;
        let password_entry = nook_core::create_password_entry_with_work_factor(
            &keys,
            nook_core::generate_id()?.as_str(),
            "Recovery",
            "2026-08-16T00:00:00Z",
            "correct horse battery staple",
            E2E_PASSWORD_SCRYPT_LOG_N.into(),
        )?;
        let mut owner = NookVaultManager::new();
        owner.vault.store_id = nook_core::generate_store_id()?.to_string();
        owner.device.identity_private_key = identity.secret_string().into_inner();
        owner.apply_genesis_vault_keys(&identity, &keys)?;
        owner.vault.password_entries = vec![password_entry.clone()];
        owner.bootstrap_event_log_genesis().await?;
        let yaml = owner.serialize_current_projection_yaml()?;
        let store_id = owner.vault.store_id.clone();
        import_vault_blob(yaml.as_str(), Some("Password recovery")).await?;
        switch_active_vault(&store_id).await?;

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
        let keys = nook_core::generate_vault_keys()?;
        let identity = DeviceIdentity::generate()?;
        let password_entry = nook_core::create_password_entry_with_work_factor(
            &keys,
            nook_core::generate_id()?.as_str(),
            "Recovery",
            "2026-08-16T00:00:00Z",
            "correct horse battery staple",
            E2E_PASSWORD_SCRYPT_LOG_N.into(),
        )?;
        let mut owner = NookVaultManager::new();
        owner.vault.store_id = nook_core::generate_store_id()?.to_string();
        owner.device.identity_private_key = identity.secret_string().into_inner();
        owner.apply_genesis_vault_keys(&identity, &keys)?;
        owner.vault.password_entries = vec![password_entry.clone()];
        owner.bootstrap_event_log_genesis().await?;
        let yaml = owner.serialize_current_projection_yaml()?;
        let store_id = owner.vault.store_id.clone();
        import_vault_blob(yaml.as_str(), Some("Password recovery")).await?;
        switch_active_vault(&store_id).await?;

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

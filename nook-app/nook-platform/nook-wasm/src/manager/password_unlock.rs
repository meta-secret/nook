use super::NookVaultManager;
use crate::NookError;
use crate::NookSecretPage;
use crate::conversion::wasm_iso_timestamp;
use crate::storage::event_db::load_local_event_store;
use crate::storage::identity_record;
use crate::storage::indexed_db::save_to_indexed_db;
use nook_core::{
    DeviceSigningPublicKey, MemberLabel, MultiDeviceError, SecretTypeFilter, StorageMode, StoreId,
    VaultMetaState, VaultOperation, VaultType, VaultUnlock,
};
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

#[wasm_bindgen]
impl NookVaultManager {
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
        let keys = nook_core::PasswordEntryResolution::new(&entry, &password).resolve()?;
        let meta = VaultMetaState::from_stored_records(&records)?;

        self.apply_vault_keys(keys.secrets_key.as_str(), keys.members_key.as_str())?;
        self.vault.unlock = VaultUnlock::Keys;
        self.vault.meta = meta;
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
}

impl NookVaultManager {
    pub(super) async fn load_password_unlock_records(
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
            let projection = nook_core::VaultProjection::from_graph(&graph, &self.vault.store_id)?;
            let user_records: Vec<nook_core::StoredSecretRecord> =
                projection.live_secrets(&graph).into_values().collect();
            let mut meta = VaultMetaState::from_stored_records(&user_records)?;
            nook_core::materialize_vault_meta_from_graph(&graph, &mut meta)?;
            self.vault.password_entries = projection.password_entries.clone();
            self.vault.meta = meta;
            return Ok((true, self.vault.meta.to_stored_records()));
        }

        if vault_missing || content.trim().is_empty() {
            return Err(NookError::Database(
                "No vault found at this provider. Ask the inviter to confirm the repo/path."
                    .to_owned(),
            ));
        }
        let format = nook_core::detect_stored_format(content)?;
        let records = nook_core::deserialize_stored(content, format)?;
        let mut retained = Vec::with_capacity(records.len());
        for record in records {
            if !nook_core::is_join_stored_record(&record)? {
                retained.push(record);
            }
        }
        self.capture_vault_unlock(content)?;
        Ok((false, retained))
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
        let existing_roster = nook_core::resolve_member_roster(records, &keys.members_key)?;
        let updated_roster = nook_core::roster_add_member(
            existing_roster,
            nook_core::member_from_identity(identity, &wasm_iso_timestamp()),
        );
        let member_records = nook_core::build_members_records(&updated_roster, &keys.members_key)?;
        for record in &member_records {
            self.vault.meta.apply_record(record)?;
        }

        let operations = match self.vault.architecture.vault_type {
            VaultType::Simple => {
                let auth_record =
                    nook_core::genesis_auth_record(identity, &keys.secrets_key, &keys.members_key)?;
                let envelopes = nook_core::parse_auth_envelopes(auth_record.value.as_str())?;
                self.vault.meta.apply_record(&auth_record)?;
                vec![VaultOperation::JoinApproved {
                    device_id: identity.device_id().clone(),
                    encryption_public_key: identity.public_key().clone(),
                    signing_public_key: signing_pk,
                    label: MemberLabel::from_trusted(String::new()),
                    secrets_key_ciphertext: envelopes.secrets_key,
                    members_key_ciphertext: envelopes.members_key,
                }]
            }
            VaultType::Sentinel => unreachable!("sentinel password membership forbidden"),
        };
        self.append_vault_operations(operations).await?;
        self.flush_event_outbox().await?;
        self.persist_projection_cache().await
    }
}

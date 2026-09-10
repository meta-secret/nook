use super::NookVaultManager;
use crate::BrowserTimestamp;
use crate::IdentityDbValidateVaultIdentityEnrollment;

use crate::storage::identity_record;
use crate::{ImportVaultBlobRequest, NookDatabase};
use nook_core::{CreateSentinelShareRecordsRequest, SentinelShareEnvelope};

use crate::{NookError, NookSecretPage};
use nook_core::{
    BuildMembersRecordsRequest, MemberFromIdentityRequest, ResolveMemberRosterRequest,
    RosterAddMemberRequest, VaultMember,
};
use nook_core::{
    DeviceSigningPublicKey, MemberLabel, MultiDeviceError, SecretTypeFilter, StorageMode, StoreId,
    VaultMetaGraphProjection, VaultMetaState, VaultOperation, VaultType, VaultUnlock,
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
            if let Err(error) = NookDatabase::validate_vault_identity_enrollment(
                IdentityDbValidateVaultIdentityEnrollment {
                    app_key: identity,
                    store_id: &store_id,
                },
            )
            .await
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
            NookDatabase::save_to_indexed_db(&yaml).await?;
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

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use super::*;

    use nook_core::{
        Database, DeviceIdentity, DeviceMode, SecretId, SecretValue, SentinelPolicy,
        VaultArchitecture, VaultCrypto, VaultNameRef, VaultRecordSet, VaultStoreIdentityRef,
        VaultType, VaultVersionWrite,
    };
    use std::slice;
    use wasm_bindgen_test::*;

    const E2E_PASSWORD_SCRYPT_LOG_N: u8 = 10;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    async fn password_unlock_rejects_sentinel_vaults_before_decryption() -> anyhow::Result<()> {
        let keys = nook_core::VaultKeys::generate()?;
        let participants = [DeviceIdentity::generate()?, DeviceIdentity::generate()?];
        let mut records = SentinelShareEnvelope::create_sentinel_share_records(
            CreateSentinelShareRecordsRequest {
                keys: &keys,
                participants: &participants,
                threshold: 2.into(),
            },
        )?;
        let mut database = Database::new();
        let secret_id = SecretId::from_vault_record(
            format!("secret_{}", nook_core::CompactToken::generate()?).as_str(),
        );
        database.insert(
            secret_id,
            SecretValue::SecureNote(nook_core::SecureNoteSecret {
                title: "sentinel password".to_owned(),
                note: "must be rejected".to_owned(),
            }),
        );
        let crypto = VaultCrypto::new(&keys.secrets_key)?;
        records.extend(database.to_stored_records_with_crypto(&crypto)?);
        let password_entry = nook_core::PasswordEntryIssuance::with_work_factor(
            &keys,
            nook_core::CompactToken::generate()?.as_str(),
            "Recovery",
            "2026-09-07T00:00:00Z",
            "correct horse battery staple",
            E2E_PASSWORD_SCRYPT_LOG_N.into(),
        )
        .issue()?;
        let store_id = nook_core::StoreId::generate()?.to_string();
        let architecture = VaultArchitecture::sentinel_personal(
            DeviceMode::Standard,
            SentinelPolicy {
                threshold: 2.into(),
                required_participants: 2.into(),
                ready_participants: 2.into(),
            },
        );
        let yaml = VaultRecordSet::serialize_yaml_with_unlock_name_architecture(
            &records,
            &VaultUnlock::Keys,
            slice::from_ref(&password_entry),
            VaultStoreIdentityRef::Assigned(&store_id),
            VaultNameRef::Unnamed,
            VaultVersionWrite::Initial,
            &architecture,
        )?;
        NookDatabase::import_vault_blob(ImportVaultBlobRequest {
            content: yaml.as_str(),
            label: Some("Sentinel password"),
        })
        .await?;
        NookDatabase::switch_active_vault(&store_id).await?;

        let mut manager = NookVaultManager::new();
        let result = manager
            .connect_with_password(
                "local".to_owned(),
                String::new(),
                String::new(),
                password_entry.id,
                "correct horse battery staple".to_owned(),
                50,
            )
            .await;
        assert!(
            result.is_err(),
            "sentinel password unlock must be forbidden"
        );
        assert_eq!(manager.vault.architecture.vault_type, VaultType::Sentinel);
        assert!(manager.vault.secrets_key.is_empty());
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn password_unlock_requires_a_backup_entry() -> anyhow::Result<()> {
        let keys = nook_core::VaultKeys::generate()?;
        let mut database = Database::new();
        let secret_id = SecretId::from_vault_record(
            format!("secret_{}", nook_core::CompactToken::generate()?).as_str(),
        );
        database.insert(
            secret_id,
            SecretValue::SecureNote(nook_core::SecureNoteSecret {
                title: "password entry missing".to_owned(),
                note: "no envelope".to_owned(),
            }),
        );
        let crypto = VaultCrypto::new(&keys.secrets_key)?;
        let records = database.to_stored_records_with_crypto(&crypto)?;
        let store_id = nook_core::StoreId::generate()?.to_string();
        let yaml = VaultRecordSet::serialize_yaml_with_unlock_and_name(
            &records,
            &VaultUnlock::Keys,
            &[],
            VaultStoreIdentityRef::Assigned(&store_id),
            VaultNameRef::Named("No backup"),
            VaultVersionWrite::Initial,
        )?;
        NookDatabase::import_vault_blob(ImportVaultBlobRequest {
            content: yaml.as_str(),
            label: Some("No backup"),
        })
        .await?;
        NookDatabase::switch_active_vault(&store_id).await?;

        let mut manager = NookVaultManager::new();
        let result = manager
            .connect_with_password(
                "local".to_owned(),
                String::new(),
                String::new(),
                String::new(),
                "correct horse battery staple".to_owned(),
                50,
            )
            .await;
        assert!(result.is_err(), "unlock without a backup entry must fail");
        assert!(manager.vault.secrets_key.is_empty());
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn password_unlock_uses_the_first_entry_for_an_unknown_id() -> anyhow::Result<()> {
        let keys = nook_core::VaultKeys::generate()?;
        let identity = DeviceIdentity::generate()?;
        let password_entry = nook_core::PasswordEntryIssuance::with_work_factor(
            &keys,
            nook_core::CompactToken::generate()?.as_str(),
            "Recovery",
            "2026-09-07T00:00:00Z",
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
            label: Some("Password fallback"),
        })
        .await?;
        NookDatabase::switch_active_vault(&store_id).await?;

        let mut recovered = NookVaultManager::new();
        let page = recovered
            .connect_with_password(
                "local".to_owned(),
                String::new(),
                String::new(),
                "unknown-entry-id".to_owned(),
                "correct horse battery staple".to_owned(),
                50,
            )
            .await
            .map_err(|error| anyhow::anyhow!("password fallback failed: {error:?}"))?;
        assert_eq!(recovered.vault.store_id, store_id);
        assert_eq!(page.total(), 0);
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn password_record_loading_filters_join_requests() -> anyhow::Result<()> {
        let keys = nook_core::VaultKeys::generate()?;
        let mut database = Database::new();
        let secret_id = SecretId::from_vault_record(
            format!("secret_{}", nook_core::CompactToken::generate()?).as_str(),
        );
        database.insert(
            secret_id,
            SecretValue::SecureNote(nook_core::SecureNoteSecret {
                title: "retained secret".to_owned(),
                note: "join rows are not password records".to_owned(),
            }),
        );
        let crypto = VaultCrypto::new(&keys.secrets_key)?;
        let mut records = database.to_stored_records_with_crypto(&crypto)?;
        let joiner = DeviceIdentity::generate()?;
        records.push(nook_core::JoinRequestIssuance::new(&joiner, "2026-09-07T00:00:00Z").issue()?);
        let store_id = nook_core::StoreId::generate()?.to_string();
        let yaml = VaultRecordSet::serialize_yaml_with_unlock_and_name(
            &records,
            &VaultUnlock::Keys,
            &[],
            VaultStoreIdentityRef::Assigned(&store_id),
            VaultNameRef::Unnamed,
            VaultVersionWrite::Initial,
        )?;

        let mut manager = NookVaultManager::new();
        let (event_log_remote, retained) = manager
            .load_password_unlock_records(yaml.as_str(), false)
            .await?;
        assert!(!event_log_remote);
        assert_eq!(retained.len(), 1);
        assert!(!matches!(
            (&retained[0]).classify()?,
            nook_core::VaultMetaRecord::Join(..)
        ));
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn password_membership_persistence_adds_an_authorized_member() -> anyhow::Result<()> {
        let keys = nook_core::VaultKeys::generate()?;
        let owner_identity = DeviceIdentity::generate()?;
        let joiner_identity = DeviceIdentity::generate()?;
        let mut manager = NookVaultManager::new();
        manager.vault.store_id = nook_core::StoreId::generate()?.to_string();
        manager.device.identity_private_key = owner_identity.secret_string().into_inner();
        manager.apply_genesis_vault_keys(&owner_identity, &keys)?;
        manager.bootstrap_event_log_genesis().await?;
        let records = manager.vault.meta.to_stored_records();

        manager
            .persist_password_unlock_membership(&records, &joiner_identity, &keys)
            .await
            .map_err(|error| anyhow::anyhow!("membership persistence failed: {error:?}"))?;
        let graph = NookDatabase::load_local_event_store(&manager.vault.store_id)
            .await?
            .load_graph(&manager.vault.store_id)?;
        let approvals = graph
            .events()
            .flat_map(|(_, event)| event.body.operations.iter())
            .filter(|operation| {
                matches!(
                    operation,
                    nook_core::VaultOperation::JoinApproved { device_id, .. }
                        if device_id == joiner_identity.device_id()
                )
            })
            .count();
        assert_eq!(approvals, 1);
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn password_membership_persistence_requires_an_event_log() -> anyhow::Result<()> {
        let mut manager = NookVaultManager::new();
        let identity = DeviceIdentity::generate()?;
        let keys = nook_core::VaultKeys::generate()?;
        let result = manager
            .persist_password_unlock_membership(&[], &identity, &keys)
            .await;
        assert!(
            result.is_err(),
            "membership persistence without an event log must fail"
        );
        Ok(())
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
            let store = NookDatabase::load_local_event_store(&self.vault.store_id).await?;
            let graph = store.load_graph(&self.vault.store_id)?;
            let projection = nook_core::VaultProjection::from_graph(&graph, &self.vault.store_id)?;
            let user_records: Vec<nook_core::StoredSecretRecord> =
                projection.live_secrets(&graph).into_values().collect();
            let mut meta = VaultMetaState::from_stored_records(&user_records)?;
            VaultMetaGraphProjection::new(&graph).materialize(&mut meta)?;
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
        let format = nook_core::VaultFormatDocument::new(content).detect()?;
        let records = nook_core::VaultFormatDocument::new(content).deserialize(format)?;
        let mut retained = Vec::with_capacity(records.len());
        for record in records {
            if !matches!((&record).classify()?, nook_core::VaultMetaRecord::Join(..)) {
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
        let existing_roster = VaultMember::resolve_member_roster(ResolveMemberRosterRequest {
            records: records,
            members_key: &keys.members_key,
        })?;
        let updated_roster = VaultMember::roster_add_member(RosterAddMemberRequest {
            roster: existing_roster,
            member: VaultMember::member_from_identity(MemberFromIdentityRequest {
                identity: identity,
                enrolled_at: &BrowserTimestamp::now().into_iso_string(),
            }),
        });
        let member_records = VaultMember::build_members_records(BuildMembersRecordsRequest {
            roster: updated_roster,
            members_key: &keys.members_key,
        })?;
        for record in &member_records {
            self.vault.meta.apply_record(record)?;
        }

        let operations = match self.vault.architecture.vault_type {
            VaultType::Simple => {
                let auth_record = identity.auth_record(&keys.secrets_key, &keys.members_key)?;
                let envelopes = nook_core::AuthEnvelopes::parse(auth_record.value.as_str())?;
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

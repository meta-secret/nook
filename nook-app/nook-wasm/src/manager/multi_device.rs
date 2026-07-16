//! Keys-mode multi-device flows.
//!
//! Wraps the join / approve / enroll choreography that the `auth:` /
//! `joins:` / `members:` sections of a keys-mode vault use. None of these
//! methods are reachable when the vault is in password mode — the
//! password-mode counterpart is `connectWithPassword` (`manager::password`).

use super::NookVaultManager;
use crate::NookError;
use crate::conversion::{LoadedVault, apply_member_records, load_stored_vault, wasm_iso_timestamp};
use crate::{NookJoinRequest, NookSecretRecord, NookVaultMember};
use wasm_bindgen::JsError;
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
impl NookVaultManager {
    /// Verify that passkey authorization loaded this browser's device identity.
    pub fn init_device(&mut self) -> Result<(), JsError> {
        self.ensure_device_identity()?;
        Ok(())
    }

    pub fn list_pending_joins(&self) -> Result<Vec<NookJoinRequest>, JsError> {
        Ok(self.pending_joins()?)
    }

    /// Pull the latest vault file from storage when it changed; update the active session.
    pub fn list_vault_members(&self) -> Result<Vec<NookVaultMember>, JsError> {
        Ok(self.vault_members()?)
    }

    /// Ensure the genesis / approver device appears in the roster when keys are
    /// present but `members:` rows were not replayed from the event log.
    #[wasm_bindgen(js_name = ensureVaultRosterHydrated)]
    pub async fn ensure_vault_roster_hydrated_js(&mut self) -> Result<bool, JsError> {
        Ok(self.ensure_vault_roster_hydrated().await?)
    }

    /// Device B requests access without decrypting the vault (writes join record only).
    pub async fn request_vault_access(
        &mut self,
        storage_mode: String,
        github_pat: String,
        github_repo: String,
        _requested_at: String,
    ) -> Result<(), JsError> {
        self.prepare_storage(&storage_mode, &github_pat, &github_repo)
            .await?;
        let identity = self.ensure_device_identity()?;
        let mut vault_missing = false;
        let content = self.fetch_vault_content(&mut vault_missing).await?;
        if vault_missing || content.trim().is_empty() {
            self.sync_events_from_current_provider().await?;
            if self.vault.store_id.is_empty() || !self.event_log_has_events().await? {
                return Err(NookError::Database("No vault found to join.".to_owned()).into());
            }
        } else {
            self.capture_vault_unlock(&content)?;
            self.sync_events_from_current_provider().await?;
            if self.vault.store_id.is_empty() || !self.event_log_has_events().await? {
                return Err(NookError::Database("Vault event log is required.".to_owned()).into());
            }
        }

        let auth_id =
            nook_core::SecretId::from_vault_record(nook_core::dec_auth_id(&identity).as_str());
        if self
            .stored_records_snapshot()
            .iter()
            .any(|record| record.key == auth_id)
        {
            return Err(NookError::Database(
                "This device is already enrolled. Use Connect vault.".to_owned(),
            )
            .into());
        }
        let signing = self.ensure_signing_identity().await?;
        let signing_pk = nook_core::DeviceSigningPublicKey::from_trusted(hex::encode(
            signing.verifying_key().as_bytes(),
        ));
        self.append_vault_operations(vec![nook_core::VaultOperation::JoinRequested {
            device_id: identity.device_id().clone(),
            encryption_public_key: identity.public_key().clone(),
            signing_public_key: signing_pk,
            label: nook_core::MemberLabel::from_trusted(String::new()),
        }])
        .await?;
        if self.storage.mode != nook_core::StorageMode::Local {
            self.flush_event_outbox().await?;
        }
        Ok(())
    }

    /// Device B enrolls with out-of-band `secrets_key` and `members_key`, then unlocks the vault.
    pub async fn enroll_and_connect(
        &mut self,
        storage_mode: String,
        github_pat: String,
        github_repo: String,
        secrets_key: String,
        members_key: String,
    ) -> Result<Vec<NookSecretRecord>, JsError> {
        self.prepare_storage(&storage_mode, &github_pat, &github_repo)
            .await?;
        let identity = self.ensure_device_identity()?;
        let mut vault_missing = false;
        let content = self.fetch_vault_content(&mut vault_missing).await?;
        if vault_missing || content.trim().is_empty() {
            return Err(NookError::Database("No vault found to join.".to_owned()).into());
        }
        // Fresh enrolment — adopt the remote unlock mode.
        self.capture_vault_unlock(&content)?;

        if self.vault.architecture.vault_type == nook_core::VaultType::Sentinel {
            return Err(nook_core::MultiDeviceError::SentinelCeremonyRequired.into());
        }

        let format = nook_core::detect_stored_format(&content)?;
        let mut records = nook_core::deserialize_stored(&content, format)?;
        let parsed_secrets = nook_core::SymmetricKey::parse(&secrets_key)?;
        let parsed_members = nook_core::SymmetricKey::parse(&members_key)?;

        let auth_id =
            nook_core::SecretId::from_vault_record(nook_core::dec_auth_id(&identity).as_str());
        records.retain(|record| record.key != auth_id);
        records.retain(|record| !nook_core::is_members_stored_record(record));
        let (auth, members) = nook_core::enroll_device_with_keys(
            &parsed_secrets,
            &parsed_members,
            &identity,
            &wasm_iso_timestamp(),
        )?;
        records.push(auth);
        records.extend(members);

        self.vault.meta = nook_core::VaultMetaState::from_stored_records(&records);
        self.persist_vault_change(Vec::new()).await?;

        let updated = nook_core::serialize_stored(&records, format)?;
        let loaded = load_stored_vault(updated.as_str(), &identity)?;
        let LoadedVault {
            meta,
            secrets_key: resolved_secrets_key,
            members_key: resolved_members_key,
        } = loaded;
        self.apply_vault_keys(resolved_secrets_key.as_str(), resolved_members_key.as_str())?;
        self.vault.meta = meta;
        Ok(self.get_records()?)
    }

    /// Device B publishes a join request record with its public key.
    pub async fn create_join_request(&mut self, requested_at: String) -> Result<(), JsError> {
        let identity = self.device_identity()?;
        let signing = self.ensure_signing_identity().await?;
        let signing_pk = nook_core::DeviceSigningPublicKey::from_trusted(hex::encode(
            signing.verifying_key().as_bytes(),
        ));
        let record = nook_core::create_join_request_record_with_signing_key(
            &identity,
            &requested_at,
            &signing_pk,
        )?;
        self.vault.meta.apply_record(&record);
        self.persist_vault_change(vec![nook_core::VaultOperation::JoinRequested {
            device_id: identity.device_id().clone(),
            encryption_public_key: identity.public_key().clone(),
            signing_public_key: signing_pk,
            label: nook_core::MemberLabel::from_trusted(String::new()),
        }])
        .await?;
        Ok(())
    }

    /// Device A approves a pending join by encrypting DEC for the requester.
    pub async fn approve_join_request(
        &mut self,
        join_device_id: String,
    ) -> Result<Vec<NookSecretRecord>, JsError> {
        self.application
            .validate_session_access(self.vault.architecture.vault_type)?;
        let identity = self.device_identity()?;
        let records = self.stored_records_snapshot();
        let pending = nook_core::list_join_requests(&records);
        let join_device = nook_core::DeviceId::parse(&join_device_id)?;
        let join = pending
            .into_iter()
            .find(|entry| entry.device_id == join_device)
            .ok_or_else(|| NookError::Database("Join request not found.".to_owned()))?;
        let secrets_key = nook_core::SymmetricKey::parse(&self.vault.secrets_key)?;
        let members_key = nook_core::SymmetricKey::parse(&self.vault.members_key)?;
        let mut operations = Vec::new();
        match self.vault.architecture.vault_type {
            nook_core::VaultType::Simple => {
                let (auth_record, join_key, member_records) = nook_core::approve_join_request(
                    &secrets_key,
                    &members_key,
                    &join,
                    &identity,
                    &records,
                )?;
                self.vault.meta.remove_key(&join_key);
                self.vault.meta.apply_record(&auth_record);
                apply_member_records(&mut self.vault.meta, &member_records);
                let envelopes: nook_core::AuthEnvelopes =
                    serde_json::from_str(auth_record.value.as_str())
                        .map_err(|e| NookError::Serialization(e.to_string()))?;
                operations.push(nook_core::VaultOperation::JoinApproved {
                    device_id: join.device_id.clone(),
                    encryption_public_key: join.public_key.clone(),
                    signing_public_key: join.signing_public_key.clone(),
                    label: nook_core::MemberLabel::from_trusted(String::new()),
                    secrets_key_ciphertext: envelopes.secrets_key.clone(),
                    members_key_ciphertext: envelopes.members_key.clone(),
                });
            }
            nook_core::VaultType::Sentinel => {
                if !self.vault.meta.sentinel_shares.is_empty() {
                    return Err(nook_core::MultiDeviceError::SentinelGenesisRosterFull.into());
                }
                let new_member = nook_core::member_from_join(&join)?;
                let roster = match nook_core::resolve_member_roster(&records, &members_key) {
                    Ok(existing) => nook_core::roster_add_member(existing, new_member),
                    Err(_) => vec![
                        nook_core::member_from_identity(&identity, &join.requested_at),
                        new_member,
                    ],
                };
                let member_records = nook_core::build_members_records(&roster, &members_key)?;
                self.vault
                    .meta
                    .remove_key(&nook_core::join_record_key(&join.device_id));
                apply_member_records(&mut self.vault.meta, &member_records);
                operations.push(nook_core::VaultOperation::SentinelParticipantEnrolled {
                    device_id: join.device_id.clone(),
                    encryption_public_key: join.public_key.clone(),
                    signing_public_key: join.signing_public_key.clone(),
                    label: nook_core::MemberLabel::from_trusted(String::new()),
                });
                if let Some(share_op) = self.maybe_issue_sentinel_shares(&roster)? {
                    operations.push(share_op);
                }
            }
        }
        self.persist_vault_change(operations).await?;
        Ok(self.get_records()?)
    }

    fn maybe_issue_sentinel_shares(
        &mut self,
        roster: &[nook_core::VaultMember],
    ) -> Result<Option<nook_core::VaultOperation>, NookError> {
        let policy = self.vault.architecture.sentinel.unwrap_or_default();
        if roster.len() > usize::from(policy.required_participants) {
            return Err(nook_core::MultiDeviceError::SentinelGenesisRosterFull.into());
        }
        if roster.len() < usize::from(policy.required_participants) {
            return Ok(None);
        }
        if !self.vault.meta.sentinel_shares.is_empty() {
            return Ok(None);
        }
        let keys = nook_core::VaultKeys {
            secrets_key: nook_core::SymmetricKey::parse(&self.vault.secrets_key)?,
            members_key: nook_core::SymmetricKey::parse(&self.vault.members_key)?,
        };
        let recipients: Vec<(nook_core::DeviceId, nook_core::DevicePublicKey)> = roster
            .iter()
            .map(|member| (member.device_id.clone(), member.public_key.clone()))
            .collect();
        let share_records = nook_core::create_sentinel_share_records_for_recipients(
            &keys,
            &recipients,
            policy.threshold,
        )?;
        let mut shares = Vec::with_capacity(share_records.len());
        for record in &share_records {
            self.vault.meta.apply_record(record);
            let envelope = nook_core::parse_sentinel_share_envelope(record.value.as_str())?;
            let device_id = record
                .key
                .as_str()
                .strip_prefix(nook_core::SENTINEL_SHARE_RECORD_PREFIX)
                .ok_or_else(|| {
                    NookError::Database("Invalid sentinel share record key.".to_owned())
                })?;
            shares.push(nook_core::SentinelShareIssuedPayload {
                device_id: nook_core::DeviceId::parse(device_id)?,
                version: envelope.version,
                threshold: envelope.threshold,
                required_participants: envelope.required_participants,
                share_index: envelope.share_index,
                ciphertext: envelope.ciphertext,
            });
        }
        if let Some(sentinel) = self.vault.architecture.sentinel.as_mut() {
            sentinel.ready_participants = u8::try_from(shares.len()).unwrap_or(u8::MAX);
        }
        Ok(Some(nook_core::VaultOperation::SentinelSharesIssued {
            shares,
        }))
    }
}

impl NookVaultManager {
    /// Approve an extension only when this manager was configured for the
    /// Simple app (or the unified development harness) and owns a Simple vault.
    pub async fn approve_extension_device(
        &mut self,
        join_device_id: String,
        join_public_key: String,
        join_signing_public_key: String,
        label: String,
    ) -> Result<Vec<NookSecretRecord>, JsError> {
        self.application
            .validate_extension_approval(self.vault.architecture.vault_type)?;
        let identity = self.device_identity()?;
        let records = self.stored_records_snapshot();
        let join = nook_core::JoinRequest {
            device_id: nook_core::DeviceId::parse(&join_device_id)?,
            public_key: nook_core::DevicePublicKey::parse(&join_public_key)?,
            signing_public_key: nook_core::DeviceSigningPublicKey::parse(&join_signing_public_key)?,
            requested_at: wasm_iso_timestamp(),
        };
        let secrets_key = nook_core::SymmetricKey::parse(&self.vault.secrets_key)?;
        let members_key = nook_core::SymmetricKey::parse(&self.vault.members_key)?;
        let (auth_record, _join_key, member_records) = nook_core::approve_join_request(
            &secrets_key,
            &members_key,
            &join,
            &identity,
            &records,
        )?;
        self.vault.meta.apply_record(&auth_record);
        apply_member_records(&mut self.vault.meta, &member_records);
        let envelopes: nook_core::AuthEnvelopes = serde_json::from_str(auth_record.value.as_str())
            .map_err(|e| NookError::Serialization(e.to_string()))?;
        let operations = vec![nook_core::VaultOperation::JoinApproved {
            device_id: join.device_id.clone(),
            encryption_public_key: join.public_key.clone(),
            signing_public_key: join.signing_public_key.clone(),
            label: nook_core::MemberLabel::from_trusted(label),
            secrets_key_ciphertext: envelopes.secrets_key.clone(),
            members_key_ciphertext: envelopes.members_key.clone(),
        }];
        self.persist_vault_change(operations).await?;
        Ok(self.get_records()?)
    }
}

#[wasm_bindgen]
impl NookVaultManager {
    #[wasm_bindgen(js_name = deviceSigningPublicKey)]
    pub async fn device_signing_public_key_js(&mut self) -> Result<String, JsError> {
        let signing = self.ensure_signing_identity().await?;
        Ok(hex::encode(signing.verifying_key().as_bytes()))
    }

    pub async fn deny_join_request(
        &mut self,
        join_device_id: String,
    ) -> Result<Vec<NookSecretRecord>, JsError> {
        let records = self.stored_records_snapshot();
        let join_device = nook_core::DeviceId::parse(&join_device_id)?;
        if !records.iter().any(|record| {
            nook_core::parse_join_request(record.value.as_str())
                .is_ok_and(|join| join.device_id == join_device)
        }) {
            return Err(NookError::Database("Join request not found.".to_owned()).into());
        }
        let updated = nook_core::deny_join_request(&records, &join_device);
        self.vault.meta = nook_core::VaultMetaState::from_stored_records(&updated);
        self.persist_vault_change(vec![nook_core::VaultOperation::JoinDenied {
            device_id: join_device,
        }])
        .await?;
        Ok(self.get_records()?)
    }

    pub async fn rename_vault_member(
        &mut self,
        auth_id: String,
        label: String,
    ) -> Result<(), JsError> {
        let records = self.stored_records_snapshot();
        let parsed_auth_id = nook_core::AuthKeyId::parse(&auth_id)?;
        let members_key = nook_core::SymmetricKey::parse(&self.vault.members_key)?;
        let member_records =
            nook_core::rename_vault_member(&records, &members_key, &parsed_auth_id, &label)?;
        apply_member_records(&mut self.vault.meta, &member_records);
        let roster = nook_core::resolve_member_roster(&records, &members_key)?;
        let device_id = roster
            .iter()
            .find(|member| member.auth_id == parsed_auth_id)
            .map(|member| member.device_id.to_string())
            .unwrap_or_default();
        self.persist_vault_change(vec![nook_core::VaultOperation::MemberRenamed {
            device_id: nook_core::DeviceId::parse(&device_id)?,
            label: nook_core::MemberLabel::from_trusted(label),
        }])
        .await?;
        Ok(())
    }

    pub async fn revoke_vault_member(
        &mut self,
        auth_id: String,
    ) -> Result<Vec<NookSecretRecord>, JsError> {
        if self.vault.architecture.vault_type == nook_core::VaultType::Sentinel {
            return Err(nook_core::MultiDeviceError::SentinelRevocationUnsupported.into());
        }
        let identity = self.device_identity()?;
        let parsed_auth_id = nook_core::AuthKeyId::parse(&auth_id)?;
        let is_self = parsed_auth_id == identity.auth_id();
        let records = self.stored_records_snapshot();
        let members_key = nook_core::SymmetricKey::parse(&self.vault.members_key)?;
        let device_id = nook_core::resolve_member_roster(&records, &members_key)
            .ok()
            .and_then(|roster| {
                roster
                    .iter()
                    .find(|member| member.auth_id == parsed_auth_id)
                    .map(|member| member.device_id.to_string())
            })
            .unwrap_or_default();
        let updated = nook_core::revoke_vault_member(&records, &members_key, &parsed_auth_id)?;
        self.vault.meta = nook_core::VaultMetaState::from_stored_records(&updated);

        if is_self {
            self.persist_vault_change(Vec::new()).await?;
            self.vault.secrets_key.clear();
            self.vault.members_key.clear();
            self.vault.crypto = None;
            return Ok(Vec::new());
        }

        self.ensure_event_log_ready().await?;
        self.rotate_security_epoch(nook_core::VaultOperation::DeviceRevoked {
            device_id: nook_core::DeviceId::parse(&device_id)?,
        })
        .await?;

        Ok(self.get_records()?)
    }

    /// Device B self-enrolls when it already holds `secrets_key` and `members_key` out-of-band.
    pub async fn enroll_with_keys(
        &mut self,
        secrets_key: String,
        members_key: String,
    ) -> Result<Vec<NookSecretRecord>, JsError> {
        if self.vault.architecture.vault_type == nook_core::VaultType::Sentinel {
            return Err(nook_core::MultiDeviceError::SentinelCeremonyRequired.into());
        }
        let identity = self.device_identity()?;
        let parsed_secrets = nook_core::SymmetricKey::parse(&secrets_key)?;
        let parsed_members = nook_core::SymmetricKey::parse(&members_key)?;
        let (auth, members) = nook_core::enroll_device_with_keys(
            &parsed_secrets,
            &parsed_members,
            &identity,
            &wasm_iso_timestamp(),
        )?;
        self.apply_vault_keys(&secrets_key, &members_key)?;
        self.vault.meta.apply_record(&auth);
        for member in &members {
            self.vault.meta.apply_record(member);
        }
        self.persist_vault_change(Vec::new()).await?;
        Ok(self.get_records()?)
    }

    /// Back-compat alias — `members_key` must equal `secrets_key` (legacy test path only).
    pub async fn enroll_with_dec(&mut self, dec: String) -> Result<Vec<NookSecretRecord>, JsError> {
        self.enroll_with_keys(dec.clone(), dec).await
    }
}

//! Keys-mode multi-device flows.
//!
//! Wraps the join / approve / enroll choreography that the `auth:` /
//! `joins:` / `members:` sections of a keys-mode vault use. None of these
//! methods are reachable when the vault is in password mode — the
//! password-mode counterpart is `connect_with_password` (`manager::password`).

use super::event_log::SecurityEpochRotationFailure;
use super::verified_access::VerifiedVaultAccessFlow;
use super::{NookVaultManager, VaultCryptoState};
use crate::BrowserTimestamp;
use crate::LoadedVaultUnlockRequest;
use crate::NookError;
use crate::conversion::LoadedVault;
use crate::{NookJoinRequest, NookSecretRecord, NookVaultMember};
use nook_core::{
    AuthKeyId, DeviceId, DevicePublicKey, DeviceSigningPublicKey, MemberLabel, MultiDeviceError,
    SecretId, SentinelConfiguration, StorageMode, SymmetricKey, VaultMetaState, VaultOperation,
    VaultType,
};
use nook_core::{
    BuildMembersRecordsRequest, MemberFromIdentityRequest, ResolveMemberRosterRequest,
    RosterAddMemberRequest, VaultMember,
};
use nook_core::{CreateSentinelShareRecordsForRecipientsRequest, SentinelShareEnvelope};
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
    #[wasm_bindgen]
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

        let auth_id = SecretId::from_vault_record(identity.auth_id().as_str());
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
        let signing_pk =
            DeviceSigningPublicKey::from_trusted(hex::encode(signing.verifying_key().as_bytes()));
        self.append_vault_operations(vec![VaultOperation::JoinRequested {
            device_id: identity.device_id().clone(),
            encryption_public_key: identity.public_key().clone(),
            signing_public_key: signing_pk,
            label: MemberLabel::from_trusted(String::new()),
        }])
        .await?;
        if self.storage.mode != StorageMode::Local {
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

        if self.vault.architecture.vault_type == VaultType::Sentinel {
            return Err(MultiDeviceError::SentinelCeremonyRequired.into());
        }

        let format = nook_core::VaultFormatDocument::new(&content).detect()?;
        let records = nook_core::VaultFormatDocument::new(&content).deserialize(format)?;
        let parsed_secrets = SymmetricKey::parse(&secrets_key)?;
        let parsed_members = SymmetricKey::parse(&members_key)?;

        let auth_id = SecretId::from_vault_record(identity.auth_id().as_str());
        let mut retained = Vec::with_capacity(records.len());
        for record in records {
            if record.key != auth_id
                && !matches!(
                    (&record).classify()?,
                    nook_core::VaultMetaRecord::Member(..)
                )
            {
                retained.push(record);
            }
        }
        let mut records = retained;
        let (auth, members) = nook_core::DeviceEnrollment::with_keys(
            &parsed_secrets,
            &parsed_members,
            &identity,
            &BrowserTimestamp::now().into_iso_string(),
        )
        .enroll()?;
        records.push(auth);
        records.extend(members);

        self.vault.meta = VaultMetaState::from_stored_records(&records)?;
        self.persist_vault_change(Vec::new()).await?;

        let updated = nook_core::VaultRecordSet::serialize(&records, format)?;
        let loaded = LoadedVault::unlock(LoadedVaultUnlockRequest {
            content: updated.as_str(),
            identity: &identity,
        })?;
        let LoadedVault {
            meta,
            secrets_key: resolved_secrets_key,
            members_key: resolved_members_key,
        } = loaded;
        self.apply_vault_keys(resolved_secrets_key.as_str(), resolved_members_key.as_str())?;
        self.vault.meta = meta;
        self.purge_legacy_plaintext_search_catalog().await?;
        let records = VerifiedVaultAccessFlow::EnrollAndConnect
            .complete(
                self.get_records(),
                identity.device_id(),
                &self.vault.store_id,
            )
            .await?;
        Ok(records)
    }

    /// Device B publishes a join request record with its public key.
    pub async fn create_join_request(&mut self, requested_at: String) -> Result<(), JsError> {
        let identity = self.device_identity()?;
        let signing = self.ensure_signing_identity().await?;
        let signing_pk =
            DeviceSigningPublicKey::from_trusted(hex::encode(signing.verifying_key().as_bytes()));
        let record =
            nook_core::JoinRequestIssuance::with_signing_key(&identity, &requested_at, &signing_pk)
                .issue()?;
        self.vault.meta.apply_record(&record)?;
        self.persist_vault_change(vec![VaultOperation::JoinRequested {
            device_id: identity.device_id().clone(),
            encryption_public_key: identity.public_key().clone(),
            signing_public_key: signing_pk,
            label: MemberLabel::from_trusted(String::new()),
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
        let pending = nook_core::VaultRecordView::new(&records).list_join_requests()?;
        let join_device = DeviceId::parse(&join_device_id)?;
        let join = pending
            .into_iter()
            .find(|entry| entry.device_id == join_device)
            .ok_or_else(|| NookError::Database("Join request not found.".to_owned()))?;
        let secrets_key = SymmetricKey::parse(&self.vault.secrets_key)?;
        let members_key = SymmetricKey::parse(&self.vault.members_key)?;
        let mut operations = Vec::new();
        match self.vault.architecture.vault_type {
            VaultType::Simple => {
                let (auth_record, join_key, member_records) = nook_core::JoinRequestApproval::new(
                    &secrets_key,
                    &members_key,
                    &join,
                    &identity,
                    &records,
                )
                .approve()?;
                self.vault.meta.remove_key(&join_key);
                self.vault.meta.apply_record(&auth_record)?;
                self.vault.meta.replace_member_records(&member_records)?;
                let envelopes: nook_core::AuthEnvelopes =
                    serde_json::from_str(auth_record.value.as_str())
                        .map_err(|e| NookError::Serialization(e.to_string()))?;
                operations.push(VaultOperation::JoinApproved {
                    device_id: join.device_id.clone(),
                    encryption_public_key: join.public_key.clone(),
                    signing_public_key: join.signing_public_key.clone(),
                    label: MemberLabel::from_trusted(String::new()),
                    secrets_key_ciphertext: envelopes.secrets_key.clone(),
                    members_key_ciphertext: envelopes.members_key.clone(),
                });
            }
            VaultType::Sentinel => {
                if !self.vault.meta.sentinel_shares.is_empty() {
                    return Err(MultiDeviceError::SentinelGenesisRosterFull.into());
                }
                let new_member = VaultMember::member_from_join(&join)?;
                let roster = match VaultMember::resolve_member_roster(ResolveMemberRosterRequest {
                    records: &records,
                    members_key: &members_key,
                }) {
                    Ok(existing) => VaultMember::roster_add_member(RosterAddMemberRequest {
                        roster: existing,
                        member: new_member,
                    }),
                    Err(_) => vec![
                        VaultMember::member_from_identity(MemberFromIdentityRequest {
                            identity: &identity,
                            enrolled_at: &join.requested_at,
                        }),
                        new_member,
                    ],
                };
                let member_records =
                    VaultMember::build_members_records(BuildMembersRecordsRequest {
                        roster: &roster,
                        members_key: &members_key,
                    })?;
                self.vault.meta.remove_key(join.device_id.as_str());
                self.vault.meta.replace_member_records(&member_records)?;
                operations.push(VaultOperation::SentinelParticipantEnrolled {
                    device_id: join.device_id.clone(),
                    encryption_public_key: join.public_key.clone(),
                    signing_public_key: join.signing_public_key.clone(),
                    label: MemberLabel::from_trusted(String::new()),
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
        let policy = self.vault.architecture.sentinel.policy_or_default();
        if roster.len() > usize::from(u8::from(policy.required_participants)) {
            return Err(MultiDeviceError::SentinelGenesisRosterFull.into());
        }
        if roster.len() < usize::from(u8::from(policy.required_participants)) {
            return Ok(None);
        }
        if !self.vault.meta.sentinel_shares.is_empty() {
            return Ok(None);
        }
        let keys = nook_core::VaultKeys {
            secrets_key: SymmetricKey::parse(&self.vault.secrets_key)?,
            members_key: SymmetricKey::parse(&self.vault.members_key)?,
        };
        let recipients: Vec<(nook_core::DeviceId, nook_core::DevicePublicKey)> = roster
            .iter()
            .map(|member| (member.device_id.clone(), member.public_key.clone()))
            .collect();
        let share_records = SentinelShareEnvelope::create_sentinel_share_records_for_recipients(
            CreateSentinelShareRecordsForRecipientsRequest {
                keys: &keys,
                recipients: &recipients,
                threshold: policy.threshold,
            },
        )?;
        let mut shares = Vec::with_capacity(share_records.len());
        for record in &share_records {
            self.vault.meta.apply_record(record)?;
            let envelope =
                SentinelShareEnvelope::parse_sentinel_share_envelope(record.value.as_str())?;
            let device_id = record
                .key
                .as_str()
                .strip_prefix(nook_core::SENTINEL_SHARE_RECORD_PREFIX)
                .ok_or_else(|| {
                    NookError::Database("Invalid sentinel share record key.".to_owned())
                })?;
            shares.push(nook_core::SentinelShareIssuedPayload {
                device_id: DeviceId::parse(device_id)?,
                version: envelope.version,
                threshold: envelope.threshold,
                required_participants: envelope.required_participants,
                share_index: envelope.share_index,
                ciphertext: envelope.ciphertext,
            });
        }
        self.vault.architecture.sentinel =
            SentinelConfiguration::Enabled(nook_core::SentinelPolicy {
                ready_participants: u8::try_from(shares.len()).unwrap_or(u8::MAX).into(),
                ..policy
            });
        Ok(Some(VaultOperation::SentinelSharesIssued { shares }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    fn sentinel_share_issuance_waits_for_quorum_and_projects_ready_participants()
    -> anyhow::Result<()> {
        let first = nook_core::DeviceIdentity::generate()?;
        let second = nook_core::DeviceIdentity::generate()?;
        let keys = nook_core::VaultKeys::generate()?;
        let policy = nook_core::SentinelPolicy {
            threshold: 2.into(),
            required_participants: 2.into(),
            ready_participants: 0.into(),
        };
        let mut manager = NookVaultManager::new();
        manager.vault.architecture = nook_core::VaultArchitecture::sentinel_personal(
            nook_core::DeviceMode::Standard,
            policy,
        );
        manager.vault.secrets_key = keys.secrets_key.to_string();
        manager.vault.members_key = keys.members_key.to_string();

        let one = vec![VaultMember::member_from_identity(
            MemberFromIdentityRequest {
                identity: &first,
                enrolled_at: "2026-09-06T00:00:00Z",
            },
        )];
        assert!(manager.maybe_issue_sentinel_shares(&one)?.is_none());

        let roster = vec![
            VaultMember::member_from_identity(MemberFromIdentityRequest {
                identity: &first,
                enrolled_at: "2026-09-06T00:00:00Z",
            }),
            VaultMember::member_from_identity(MemberFromIdentityRequest {
                identity: &second,
                enrolled_at: "2026-09-06T00:00:00Z",
            }),
        ];
        let operation = manager
            .maybe_issue_sentinel_shares(&roster)?
            .ok_or_else(|| anyhow::anyhow!("quorum should issue shares"))?;
        assert!(matches!(
            operation,
            VaultOperation::SentinelSharesIssued { ref shares } if shares.len() == 2
        ));
        assert_eq!(manager.vault.meta.sentinel_shares.len(), 2);
        assert_eq!(
            u8::from(
                manager
                    .vault
                    .architecture
                    .sentinel
                    .policy()?
                    .ready_participants
            ),
            2
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    #[allow(
        unknown_lints,
        non_local_effect_before_unhandled_error,
        reason = "the test intentionally observes a mutating overflow rejection before handling the result"
    )]
    fn sentinel_share_issuance_rejects_full_roster_and_reuses_existing_shares() -> anyhow::Result<()>
    {
        let first = nook_core::DeviceIdentity::generate()?;
        let second = nook_core::DeviceIdentity::generate()?;
        let third = nook_core::DeviceIdentity::generate()?;
        let keys = nook_core::VaultKeys::generate()?;
        let mut manager = NookVaultManager::new();
        manager.vault.architecture = nook_core::VaultArchitecture::sentinel_personal(
            nook_core::DeviceMode::Standard,
            nook_core::SentinelPolicy {
                threshold: 2.into(),
                required_participants: 2.into(),
                ready_participants: 0.into(),
            },
        );
        manager.vault.secrets_key = keys.secrets_key.to_string();
        manager.vault.members_key = keys.members_key.to_string();
        let roster = vec![
            VaultMember::member_from_identity(MemberFromIdentityRequest {
                identity: &first,
                enrolled_at: "2026-09-06T00:00:00Z",
            }),
            VaultMember::member_from_identity(MemberFromIdentityRequest {
                identity: &second,
                enrolled_at: "2026-09-06T00:00:00Z",
            }),
            VaultMember::member_from_identity(MemberFromIdentityRequest {
                identity: &third,
                enrolled_at: "2026-09-06T00:00:00Z",
            }),
        ];
        assert!(matches!(
            manager.maybe_issue_sentinel_shares(&roster),
            Err(NookError::Encryption(message))
                if message == MultiDeviceError::SentinelGenesisRosterFull.to_string()
        ));

        let quorum_roster = roster[..2].to_vec();
        assert!(
            manager
                .maybe_issue_sentinel_shares(&quorum_roster)?
                .is_some()
        );
        assert!(
            manager
                .maybe_issue_sentinel_shares(&quorum_roster)?
                .is_none()
        );
        Ok(())
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use super::*;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    fn js<T>(result: Result<T, JsError>) -> anyhow::Result<T> {
        result.map_err(|error| anyhow::anyhow!("{error:?}"))
    }

    #[wasm_bindgen_test]
    fn empty_multi_device_queries_are_safe() -> Result<(), JsError> {
        let mut manager = NookVaultManager::new();
        manager.vault.members_key = nook_core::VaultKeys::generate()?.members_key.to_string();
        assert!(manager.init_device().is_err());
        assert!(manager.list_pending_joins()?.is_empty());
        assert!(manager.list_vault_members()?.is_empty());
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn guarded_multi_device_operations_fail_closed() -> Result<(), JsError> {
        let mut manager = NookVaultManager::new();
        assert!(
            manager
                .deny_join_request("not-a-device".to_owned())
                .await
                .is_err()
        );
        assert!(
            manager
                .rename_vault_member("not-an-auth-id".to_owned(), "x".to_owned())
                .await
                .is_err()
        );

        manager.vault.architecture = nook_core::VaultArchitecture::sentinel_personal(
            nook_core::DeviceMode::Standard,
            nook_core::SentinelPolicy {
                threshold: 2.into(),
                required_participants: 3.into(),
                ready_participants: 0.into(),
            },
        );
        assert!(
            manager
                .revoke_vault_member("key_invalid".to_owned())
                .await
                .is_err()
        );
        assert!(
            manager
                .enroll_with_keys(String::new(), String::new())
                .await
                .is_err()
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn multi_device_identity_and_join_guards_fail_closed() -> Result<(), JsError> {
        let mut manager = NookVaultManager::new();
        assert!(manager.device_signing_public_key_js().await.is_err());
        assert!(
            manager
                .create_join_request("2026-09-06T00:00:00Z".to_owned())
                .await
                .is_err()
        );
        assert!(
            manager
                .approve_join_request("not-a-device".to_owned())
                .await
                .is_err()
        );
        assert!(
            manager
                .approve_extension_device(
                    "not-a-device".to_owned(),
                    "not-a-public-key".to_owned(),
                    "not-a-signing-key".to_owned(),
                    "label".to_owned(),
                )
                .await
                .is_err()
        );
        assert!(manager.ensure_vault_roster_hydrated_js().await.is_ok());
        Ok(())
    }

    #[wasm_bindgen_test]
    fn sentinel_share_quorum_branches_are_deterministic() -> anyhow::Result<()> {
        let first = nook_core::DeviceIdentity::generate()?;
        let second = nook_core::DeviceIdentity::generate()?;
        let third = nook_core::DeviceIdentity::generate()?;
        let keys = nook_core::VaultKeys::generate()?;
        let mut manager = NookVaultManager::new();
        manager.vault.architecture = nook_core::VaultArchitecture::sentinel_personal(
            nook_core::DeviceMode::Standard,
            nook_core::SentinelPolicy {
                threshold: 2.into(),
                required_participants: 2.into(),
                ready_participants: 0.into(),
            },
        );
        manager.vault.secrets_key = keys.secrets_key.to_string();
        manager.vault.members_key = keys.members_key.to_string();
        let one = vec![VaultMember::member_from_identity(
            MemberFromIdentityRequest {
                identity: &first,
                enrolled_at: "2026-09-06T00:00:00Z",
            },
        )];
        assert!(manager.maybe_issue_sentinel_shares(&one)?.is_none());

        let quorum = vec![
            VaultMember::member_from_identity(MemberFromIdentityRequest {
                identity: &first,
                enrolled_at: "2026-09-06T00:00:00Z",
            }),
            VaultMember::member_from_identity(MemberFromIdentityRequest {
                identity: &second,
                enrolled_at: "2026-09-06T00:00:00Z",
            }),
        ];
        assert!(manager.maybe_issue_sentinel_shares(&quorum)?.is_some());
        assert!(manager.maybe_issue_sentinel_shares(&quorum)?.is_none());

        let overflow = vec![
            quorum[0].clone(),
            quorum[1].clone(),
            VaultMember::member_from_identity(MemberFromIdentityRequest {
                identity: &third,
                enrolled_at: "2026-09-06T00:00:00Z",
            }),
        ];
        assert!(manager.maybe_issue_sentinel_shares(&overflow).is_err());
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn simple_keys_join_lifecycle_updates_pending_requests_and_roster() -> anyhow::Result<()>
    {
        let mut manager = NookVaultManager::new();
        js(manager.delete_local_browser_data().await)?;
        manager
            .finish_pin_device_protection("multi-device owner pin".to_owned())
            .await
            .map_err(|error| anyhow::anyhow!("{error:?}"))?;
        let identity = manager.device_identity()?;
        manager.initialize_genesis_vault(&identity)?;
        manager.vault.store_id = nook_core::StoreId::generate()?.to_string();
        manager.bootstrap_event_log_genesis().await?;

        assert!(manager.init_device().is_ok());
        assert!(js(manager.device_signing_public_key_js().await)?.len() > 10);
        assert!(js(manager.list_pending_joins())?.is_empty());
        let owner_auth_id = js(manager.list_vault_members())?
            .into_iter()
            .next()
            .map(|member| member.auth_id())
            .ok_or_else(|| anyhow::anyhow!("genesis owner is missing from roster"))?;

        manager
            .create_join_request("2026-09-07T00:00:00Z".to_owned())
            .await
            .map_err(|error| anyhow::anyhow!("{error:?}"))?;
        let pending = js(manager.list_pending_joins())?;
        assert_eq!(pending.len(), 1);
        let owner_join_device = pending[0].device_id();
        manager
            .deny_join_request(owner_join_device)
            .await
            .map_err(|error| anyhow::anyhow!("{error:?}"))?;
        assert!(js(manager.list_pending_joins())?.is_empty());

        let joiner = nook_core::DeviceIdentity::generate()?;
        let join_record =
            nook_core::JoinRequestIssuance::new(&joiner, "2026-09-07T00:01:00Z").issue()?;
        manager.vault.meta.apply_record(&join_record)?;
        assert_eq!(js(manager.list_pending_joins())?.len(), 1);

        manager
            .approve_join_request(joiner.device_id().to_string())
            .await
            .map_err(|error| anyhow::anyhow!("{error:?}"))?;
        assert!(js(manager.list_pending_joins())?.is_empty());
        let members = js(manager.list_vault_members())?;
        assert_eq!(members.len(), 2);
        assert!(
            members
                .iter()
                .any(|member| member.device_id() == joiner.device_id().to_string())
        );
        manager
            .rename_vault_member(owner_auth_id.clone(), "Work laptop".to_owned())
            .await
            .map_err(|error| anyhow::anyhow!("{error:?}"))?;
        assert!(
            js(manager.list_vault_members())?
                .iter()
                .any(|member| member.auth_id() == owner_auth_id)
        );

        js(manager.delete_local_browser_data().await)?;
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn simple_member_mutations_cover_extension_enrollment_and_revocation()
    -> anyhow::Result<()> {
        let mut manager = NookVaultManager::new();
        js(manager.delete_local_browser_data().await)?;
        manager
            .finish_pin_device_protection("multi-device mutation pin".to_owned())
            .await
            .map_err(|error| anyhow::anyhow!("{error:?}"))?;
        let owner_identity = manager.device_identity()?;
        manager.initialize_genesis_vault(&owner_identity)?;
        manager.vault.store_id = nook_core::StoreId::generate()?.to_string();
        manager.bootstrap_event_log_genesis().await?;

        let owner_auth_id = js(manager.list_vault_members())?
            .into_iter()
            .next()
            .map(|member| member.auth_id())
            .ok_or_else(|| anyhow::anyhow!("genesis owner is missing from roster"))?;
        let owner_signing_key = js(manager.device_signing_public_key_js().await)?;
        let joiner = nook_core::DeviceIdentity::generate()?;
        let records = js(manager
            .approve_extension_device(
                joiner.device_id().to_string(),
                joiner.public_key().to_string(),
                owner_signing_key,
                "Browser extension".to_owned(),
            )
            .await)?;
        assert!(records.is_empty());

        let extension_member = js(manager.list_vault_members())?
            .into_iter()
            .find(|member| member.device_id() == joiner.device_id().to_string())
            .ok_or_else(|| anyhow::anyhow!("approved extension is missing from roster"))?;
        assert!(extension_member.label().is_empty());
        assert!(
            js(manager.list_vault_members())?
                .into_iter()
                .any(|member| member.auth_id() == owner_auth_id)
        );

        let mut enrollee = NookVaultManager::new();
        let enrollee_identity = nook_core::DeviceIdentity::generate()?;
        enrollee.device.id = enrollee_identity.device_id().to_string();
        enrollee.device.identity_private_key = enrollee_identity.secret_string().into_inner();
        enrollee.vault.store_id = nook_core::StoreId::generate()?.to_string();
        enrollee.bootstrap_event_log_genesis().await?;
        let keys = nook_core::VaultKeys::generate()?;
        let enrolled = js(enrollee
            .enroll_with_keys(keys.secrets_key.to_string(), keys.members_key.to_string())
            .await)?;
        assert!(enrolled.is_empty());
        assert!(!js(enrollee.list_vault_members())?.is_empty());

        js(manager.delete_local_browser_data().await)?;
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn local_join_and_enrollment_require_a_vault_and_valid_keys() -> anyhow::Result<()> {
        let mut manager = NookVaultManager::new();
        js(manager.delete_local_browser_data().await)?;
        let identity = nook_core::DeviceIdentity::generate()?;
        manager.device.id = identity.device_id().to_string();
        manager.device.identity_private_key = identity.secret_string().into_inner();

        assert!(
            manager
                .request_vault_access(
                    "local".to_owned(),
                    String::new(),
                    String::new(),
                    "2026-09-07T00:00:00Z".to_owned(),
                )
                .await
                .is_err()
        );
        assert!(
            manager
                .enroll_and_connect(
                    "local".to_owned(),
                    String::new(),
                    String::new(),
                    String::new(),
                    String::new(),
                )
                .await
                .is_err()
        );

        manager.vault.architecture = nook_core::VaultArchitecture::sentinel_personal(
            nook_core::DeviceMode::Standard,
            nook_core::SentinelPolicy {
                threshold: 2.into(),
                required_participants: 2.into(),
                ready_participants: 0.into(),
            },
        );
        assert!(
            manager
                .enroll_with_keys(String::new(), String::new())
                .await
                .is_err()
        );
        assert!(manager.enroll_with_dec(String::new()).await.is_err());
        js(manager.delete_local_browser_data().await)?;
        Ok(())
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
            device_id: DeviceId::parse(&join_device_id)?,
            public_key: DevicePublicKey::parse(&join_public_key)?,
            signing_public_key: DeviceSigningPublicKey::parse(&join_signing_public_key)?,
            requested_at: BrowserTimestamp::now().into_iso_string(),
        };
        let secrets_key = SymmetricKey::parse(&self.vault.secrets_key)?;
        let members_key = SymmetricKey::parse(&self.vault.members_key)?;
        let (auth_record, _join_key, member_records) = nook_core::JoinRequestApproval::new(
            &secrets_key,
            &members_key,
            &join,
            &identity,
            &records,
        )
        .approve()?;
        self.vault.meta.apply_record(&auth_record)?;
        self.vault.meta.replace_member_records(&member_records)?;
        let envelopes: nook_core::AuthEnvelopes = serde_json::from_str(auth_record.value.as_str())
            .map_err(|e| NookError::Serialization(e.to_string()))?;
        let operations = vec![VaultOperation::JoinApproved {
            device_id: join.device_id.clone(),
            encryption_public_key: join.public_key.clone(),
            signing_public_key: join.signing_public_key.clone(),
            label: MemberLabel::from_trusted(label),
            secrets_key_ciphertext: envelopes.secrets_key.clone(),
            members_key_ciphertext: envelopes.members_key.clone(),
        }];
        self.persist_vault_change(operations).await?;
        Ok(self.get_records()?)
    }
}

#[wasm_bindgen]
impl NookVaultManager {
    #[wasm_bindgen]
    pub async fn device_signing_public_key_js(&mut self) -> Result<String, JsError> {
        let signing = self.ensure_signing_identity().await?;
        Ok(hex::encode(signing.verifying_key().as_bytes()))
    }

    pub async fn deny_join_request(
        &mut self,
        join_device_id: String,
    ) -> Result<Vec<NookSecretRecord>, JsError> {
        let records = self.stored_records_snapshot();
        let join_device = DeviceId::parse(&join_device_id)?;
        if !records.iter().any(|record| {
            nook_core::JoinRequest::parse_json(record.value.as_str())
                .is_ok_and(|join| join.device_id == join_device)
        }) {
            return Err(NookError::Database("Join request not found.".to_owned()).into());
        }
        let updated = nook_core::JoinRequestDenial::new(&records, &join_device).apply();
        self.vault.meta = VaultMetaState::from_stored_records(&updated)?;
        self.persist_vault_change(vec![VaultOperation::JoinDenied {
            device_id: join_device,
        }])
        .await?;
        Ok(self.get_records()?)
    }

    /// Device B self-enrolls when it already holds `secrets_key` and `members_key` out-of-band.
    pub async fn enroll_with_keys(
        &mut self,
        secrets_key: String,
        members_key: String,
    ) -> Result<Vec<NookSecretRecord>, JsError> {
        if self.vault.architecture.vault_type == VaultType::Sentinel {
            return Err(MultiDeviceError::SentinelCeremonyRequired.into());
        }
        let identity = self.device_identity()?;
        let parsed_secrets = SymmetricKey::parse(&secrets_key)?;
        let parsed_members = SymmetricKey::parse(&members_key)?;
        let (auth, members) = nook_core::DeviceEnrollment::with_keys(
            &parsed_secrets,
            &parsed_members,
            &identity,
            &BrowserTimestamp::now().into_iso_string(),
        )
        .enroll()?;
        self.apply_vault_keys(&secrets_key, &members_key)?;
        self.vault.meta.apply_record(&auth)?;
        for member in &members {
            self.vault.meta.apply_record(member)?;
        }
        self.persist_vault_change(Vec::new()).await?;
        self.purge_legacy_plaintext_search_catalog().await?;
        let records = VerifiedVaultAccessFlow::EnrollWithKeys
            .complete(
                self.get_records(),
                identity.device_id(),
                &self.vault.store_id,
            )
            .await?;
        Ok(records)
    }

    /// Back-compat alias — `members_key` must equal `secrets_key` (legacy test path only).
    pub async fn enroll_with_dec(&mut self, dec: String) -> Result<Vec<NookSecretRecord>, JsError> {
        self.enroll_with_keys(dec.clone(), dec).await
    }
}

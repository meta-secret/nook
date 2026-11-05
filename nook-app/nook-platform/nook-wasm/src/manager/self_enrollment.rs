//! Self-enrollment of a key holder into a Simple vault's log.
//!
//! An identity-approved installation already holds the vault keys from its
//! identity envelope, so it writes its own membership directly instead of
//! leaving a pending `JoinRequested` for an owner to approve.

use super::NookVaultManager;
use crate::BrowserTimestamp;
use crate::NookDatabase;
use crate::NookError;
use nook_core::{
    BuildMembersRecordsRequest, DeviceSigningPublicKey, MemberFromIdentityRequest, MemberLabel,
    MultiDeviceError, ResolveMemberRosterRequest, RosterAddMemberRequest, StorageMode, VaultMember,
    VaultMetaGraphProjection, VaultMetaState, VaultOperation, VaultType,
};

impl NookVaultManager {
    /// Load the vault records the provider holds: replay its event log when
    /// only events are there, otherwise read the stored YAML without join
    /// requests.
    pub(super) async fn load_vault_records(
        &mut self,
        content: &str,
        vault_missing: bool,
    ) -> Result<(bool, Vec<nook_core::StoredSecretRecord>), NookError> {
        let event_log_remote = self.storage.mode() != StorageMode::Local
            && (vault_missing || content.trim().is_empty());
        if event_log_remote {
            self.sync_events_from_current_provider().await?;
            if self.vault.store_id.is_empty() || !self.event_log_has_events().await? {
                return Err(NookError::Database(
                    "No event log found at this provider. Ask the inviter to confirm the repo/path."
                        .to_owned(),
                ));
            }
            return Ok((true, self.project_local_event_log().await?));
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
            if !matches!(record.classify()?, nook_core::VaultMetaRecord::Join(..)) {
                retained.push(record);
            }
        }
        self.capture_vault_metadata(content)?;
        Ok((false, retained))
    }

    /// Project the open vault from the event log stored here: its secrets
    /// and metadata.
    pub(in crate::manager) async fn project_local_event_log(
        &mut self,
    ) -> Result<Vec<nook_core::StoredSecretRecord>, NookError> {
        let store = NookDatabase::load_local_event_store(&self.vault.store_id).await?;
        let graph = store.load_graph(&self.vault.store_id)?;
        let projection = nook_core::VaultProjection::from_graph(&graph, &self.vault.store_id)?;
        let user_records: Vec<nook_core::StoredSecretRecord> =
            projection.live_secrets(&graph).into_values().collect();
        let mut meta = VaultMetaState::from_stored_records(&user_records)?;
        VaultMetaGraphProjection::new(&graph).materialize(&mut meta)?;
        self.vault.meta = meta;
        Ok(self.vault.meta.to_stored_records())
    }

    /// Write this key holder's membership into the vault log in one step.
    pub(in crate::manager) async fn persist_self_enrolled_membership(
        &mut self,
        records: &[nook_core::StoredSecretRecord],
        identity: &nook_core::DeviceIdentity,
        keys: &nook_core::VaultKeys,
    ) -> Result<(), NookError> {
        if self.vault.architecture.vault_type == VaultType::Sentinel {
            return Err(MultiDeviceError::SentinelCeremonyRequired.into());
        }
        if !self.event_log_has_events().await? {
            return Err(NookError::Database(
                "Vault event log is required.".to_owned(),
            ));
        }
        let signing = self.ensure_signing_identity().await?;
        let signing_pk =
            DeviceSigningPublicKey::from_trusted(hex::encode(signing.verifying_key().as_bytes()));
        let existing_roster = VaultMember::resolve_member_roster(ResolveMemberRosterRequest {
            records,
            members_key: &keys.members_key,
        })?;
        let updated_roster = VaultMember::roster_add_member(RosterAddMemberRequest {
            roster: existing_roster,
            member: VaultMember::member_from_identity(MemberFromIdentityRequest {
                identity,
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

        let auth_record = identity.auth_record(&keys.secrets_key, &keys.members_key)?;
        let envelopes = nook_core::AuthEnvelopes::parse(auth_record.value.as_str())?;
        self.vault.meta.apply_record(&auth_record)?;
        self.append_vault_operations(vec![VaultOperation::JoinApproved {
            device_id: identity.device_id().clone(),
            encryption_public_key: identity.public_key().clone(),
            signing_public_key: signing_pk,
            label: MemberLabel::from_trusted(String::new()),
            secrets_key_ciphertext: envelopes.secrets_key,
            members_key_ciphertext: envelopes.members_key,
        }])
        .await?;
        self.flush_event_outbox().await?;
        self.persist_projection_cache().await
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use super::*;

    use nook_core::{
        Database, DeviceIdentity, SecretId, SecretValue, VaultCrypto, VaultNameRef, VaultRecordSet,
        VaultStoreIdentityRef, VaultVersionWrite,
    };
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    async fn record_loading_filters_join_requests() -> anyhow::Result<()> {
        let keys = nook_core::VaultKeys::generate()?;
        let mut database = Database::new();
        let secret_id = SecretId::from_vault_record(
            format!("secret_{}", nook_core::CompactToken::generate()?).as_str(),
        );
        database.insert(
            secret_id,
            SecretValue::SecureNote(nook_core::SecureNoteSecret {
                title: "retained secret".to_owned(),
                note: "join rows are not vault records".to_owned(),
            }),
        );
        let crypto = VaultCrypto::new(&keys.secrets_key)?;
        let mut records = database.to_stored_records_with_crypto(&crypto)?;
        let joiner = DeviceIdentity::generate()?;
        records.push(nook_core::JoinRequestIssuance::new(&joiner, "2026-09-07T00:00:00Z").issue()?);
        let store_id = nook_core::StoreId::generate()?.to_string();
        let yaml = VaultRecordSet::serialize_yaml_with_name(
            &records,
            VaultStoreIdentityRef::Assigned(&store_id),
            VaultNameRef::Unnamed,
            VaultVersionWrite::Initial,
        )?;

        let mut manager = NookVaultManager::new();
        let (event_log_remote, retained) = manager.load_vault_records(yaml.as_str(), false).await?;
        assert!(!event_log_remote);
        assert_eq!(retained.len(), 1);
        assert!(!matches!(
            (&retained[0]).classify()?,
            nook_core::VaultMetaRecord::Join(..)
        ));
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn self_enrolled_membership_adds_an_authorized_member() -> anyhow::Result<()> {
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
            .persist_self_enrolled_membership(&records, &joiner_identity, &keys)
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
    async fn self_enrolled_membership_requires_an_event_log() -> anyhow::Result<()> {
        let mut manager = NookVaultManager::new();
        let identity = DeviceIdentity::generate()?;
        let keys = nook_core::VaultKeys::generate()?;
        let result = manager
            .persist_self_enrolled_membership(&[], &identity, &keys)
            .await;
        assert!(
            result.is_err(),
            "membership persistence without an event log must fail"
        );
        Ok(())
    }
}

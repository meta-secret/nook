use crate::RecordTypeDeclaration;
use crate::{
    AgeArmoredCiphertext, DeviceIdentitySecret, DevicePublicKey, DeviceSigningPublicKey, SecretId,
    SecretType, StoredRecordPayload, StoredSecretRecord, SymmetricKey,
};
use crate::{VaultMember, VaultMetaState};
use serde::{Deserialize, Serialize};

mod access;
mod join;
mod key_actions;
mod roster;
#[path = "multi_device_secret_sharing.rs"]
mod secret_sharing;
mod sentinel;
mod state;

pub use state::*;

pub use access::{ConnectAccessStatus, DeviceJoinStatus, SelfRosterSync};
pub use join::{DeviceEnrollment, JoinRequestApproval, JoinRequestDenial, JoinRequestIssuance};
pub use key_actions::{AuthRecordIssuance, VaultRecordView};

pub use sentinel::{
    OpenedSentinelShare, SENTINEL_SHARE_RECORD_PREFIX, SentinelKeyReconstruction,
    SentinelShareEnvelope, SentinelShareOpening, SentinelShareVersion,
};

/// `secrets_key` encrypts user secrets; `members_key` encrypts member catalog entries.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VaultKeys {
    pub secrets_key: SymmetricKey,
    pub members_key: SymmetricKey,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AuthEnvelopes {
    pub secrets_key: AgeArmoredCiphertext,
    pub members_key: AgeArmoredCiphertext,
}

#[cfg(test)]
mod tests {
    use std::io;

    use super::*;
    use crate::DeviceSigningPublicKey;

    const ENROLLED_AT: &str = "2026-06-21T00:00:00Z";
    fn genesis_vault(
        keys: &VaultKeys,
    ) -> anyhow::Result<(DeviceIdentity, Vec<StoredSecretRecord>)> {
        let genesis = DeviceIdentity::generate()?;
        let mut records = vec![genesis.auth_record(&keys.secrets_key, &keys.members_key)?];
        records.extend(VaultMember::genesis_members_records(
            GenesisMembersRecordsRequest {
                identity: &genesis,
                members_key: &keys.members_key,
                enrolled_at: ENROLLED_AT,
            },
        )?);
        Ok((genesis, records))
    }

    fn user_secret_record(id: &str, value: &str) -> StoredSecretRecord {
        StoredSecretRecord {
            key: SecretId::from_vault_record(id),
            secret_type: RecordTypeDeclaration::Secret(SecretType::Login),
            value: StoredRecordPayload::from_trusted(value.to_owned()),
        }
    }

    fn approve_pending_join(
        keys: &VaultKeys,
        approver: &DeviceIdentity,
        records: &mut Vec<StoredSecretRecord>,
        joiner: &DeviceIdentity,
    ) -> anyhow::Result<()> {
        let join = match VaultMetaState::pending_join_for_device(PendingJoinForDeviceRequest {
            records: records,
            device_id: joiner.device_id(),
        })? {
            DeviceJoinStatus::Pending(join) => join,
            DeviceJoinStatus::NotRequested => {
                return Err(io::Error::other("pending join fixture must exist").into());
            }
        };
        let (auth_record, join_key, member_records) = JoinRequestApproval::new(
            &keys.secrets_key,
            &keys.members_key,
            join,
            approver,
            records,
        )
        .approve()?;
        records.retain(|record| record.key.as_str() != join_key);
        records.push(auth_record);
        VaultMember::replace_member_records(ReplaceMemberRecordsRequest {
            records: records,
            member_records: member_records,
        })?;
        Ok(())
    }

    #[test]
    fn genesis_device_can_decrypt_vault_keys() -> anyhow::Result<()> {
        let keys = VaultKeys::generate()?;
        let (genesis, records) = genesis_vault(&keys)?;
        assert_eq!(
            VaultRecordView::new(&records).secrets_key(&genesis)?,
            keys.secrets_key
        );
        assert_eq!(
            VaultRecordView::new(&records).members_key(&genesis)?,
            keys.members_key
        );
        Ok(())
    }

    #[test]
    fn second_device_join_request_and_approval_roundtrips_key_access() -> anyhow::Result<()> {
        let keys = VaultKeys::generate()?;
        let (genesis, mut records) = genesis_vault(&keys)?;

        let joiner = DeviceIdentity::generate()?;
        records.push(JoinRequestIssuance::new(&joiner, ENROLLED_AT).issue()?);

        approve_pending_join(&keys, &genesis, &mut records, &joiner)?;

        assert_eq!(
            VaultRecordView::new(&records).secrets_key(&joiner)?,
            keys.secrets_key
        );
        assert_eq!(
            VaultRecordView::new(&records).members_key(&joiner)?,
            keys.members_key
        );
        assert_eq!(
            VaultMember::resolve_member_roster(ResolveMemberRosterRequest {
                records: &records,
                members_key: &keys.members_key
            })?
            .len(),
            2
        );
        Ok(())
    }

    #[test]
    fn vault_meta_state_classifies_roundtrips_and_removes_every_record_kind() -> anyhow::Result<()>
    {
        let keys = VaultKeys::generate()?;
        let (genesis, mut records) = genesis_vault(&keys)?;
        let joiner = DeviceIdentity::generate()?;
        let sentinel_participant = DeviceIdentity::generate()?;
        let sentinel_record = SentinelShareEnvelope::create_sentinel_share_records(
            CreateSentinelShareRecordsRequest {
                keys: &keys,
                participants: &[genesis.clone(), sentinel_participant.clone()],
                threshold: 2.into(),
            },
        )?
        .pop()
        .ok_or_else(|| io::Error::other("sentinel share record must exist"))?;
        let join_record = JoinRequestIssuance::with_signing_key(
            &joiner,
            ENROLLED_AT,
            &DeviceSigningPublicKey::from_trusted("a".repeat(64)),
        )
        .issue()?;
        let user_secret = user_secret_record("secret_login001", "encrypted-user-secret");
        records.push(join_record.clone());
        records.push(sentinel_record.clone());
        records.push(user_secret.clone());

        let mut state = VaultMetaState::from_stored_records(&records)?;
        assert_eq!(state.secrets.len(), 1);
        assert_eq!(state.auth.len(), 1);
        assert_eq!(state.joins.len(), 1);
        assert_eq!(state.members.len(), 1);
        assert_eq!(state.sentinel_shares.len(), 1);
        assert_eq!(
            state
                .joins
                .get(joiner.device_id())
                .ok_or_else(|| io::Error::other("joining member must exist"))?
                .signing_public_key
                .as_str(),
            "a".repeat(64)
        );

        let flattened = state.to_stored_records();
        assert_eq!(VaultMetaState::from_stored_records(&flattened)?, state);
        assert_eq!(
            VaultRecordView::new(&flattened).user_records()?,
            vec![user_secret.clone()]
        );

        state.remove_key(user_secret.key.as_str());
        state.remove_key(genesis.auth_id().as_str());
        state.remove_key(&genesis.auth_id().member_record_key());
        state.remove_key(joiner.device_id().as_str());
        state.remove_key(sentinel_record.key.as_str());
        assert!(state.is_empty());

        assert!(matches!(
            (&user_secret).classify()?,
            VaultMetaRecord::Secret(_, SecretType::Login, _)
        ));
        assert!(matches!(
            (&join_record).classify()?,
            VaultMetaRecord::Join(_, _)
        ));
        assert!(matches!(
            (&sentinel_record).classify()?,
            VaultMetaRecord::SentinelShare(_, _)
        ));

        let mut invalid_sentinel = sentinel_record;
        invalid_sentinel.value = StoredRecordPayload::from_trusted(
            invalid_sentinel
                .value
                .as_str()
                .replacen("\"version\":1", "\"version\":3", 1),
        );
        let before = state.clone();
        assert!((&invalid_sentinel).classify().is_err());
        match state.apply_record(&invalid_sentinel) {
            Err(_) => {}
            Ok(()) => return Err(anyhow::anyhow!("invalid share must be rejected")),
        }
        assert_eq!(state, before);
        assert!(VaultMetaState::from_stored_records(&[invalid_sentinel]).is_err());
        Ok(())
    }

    #[test]
    fn merge_remote_join_records_replaces_only_pending_join_bucket() -> anyhow::Result<()> {
        let keys = VaultKeys::generate()?;
        let (genesis, mut records) = genesis_vault(&keys)?;
        records.push(user_secret_record("secret_api001", "encrypted-user-secret"));

        let stale_joiner = DeviceIdentity::generate()?;
        records.push(JoinRequestIssuance::new(&stale_joiner, "2026-06-20T00:00:00Z").issue()?);
        let mut state = VaultMetaState::from_stored_records(&records)?;

        let fresh_joiner = DeviceIdentity::generate()?;
        let fresh_records = vec![JoinRequestIssuance::new(&fresh_joiner, ENROLLED_AT).issue()?];
        state.replace_join_records(&fresh_records)?;

        assert_eq!(state.secrets.len(), 1);
        assert_eq!(state.auth.len(), 1);
        assert_eq!(state.members.len(), 1);
        assert!(!state.joins.contains_key(stale_joiner.device_id()));
        assert_eq!(
            state.joins.keys().collect::<Vec<_>>(),
            vec![fresh_joiner.device_id()]
        );
        assert_eq!(
            VaultRecordView::new(&state.to_stored_records()).secrets_key(&genesis)?,
            keys.secrets_key
        );
        Ok(())
    }

    #[test]
    fn approve_join_falls_back_to_approver_when_roster_is_missing() -> anyhow::Result<()> {
        let keys = VaultKeys::generate()?;
        let genesis = DeviceIdentity::generate()?;
        let joiner = DeviceIdentity::generate()?;
        let wrong_members_key = SymmetricKey::generate_for_vault()?;
        let corrupt_member_record =
            VaultMember::build_members_records(BuildMembersRecordsRequest {
                roster: vec![VaultMember::member_from_identity(
                    MemberFromIdentityRequest {
                        identity: &genesis,
                        enrolled_at: ENROLLED_AT,
                    },
                )],
                members_key: &wrong_members_key,
            })?
            .into_iter()
            .next()
            .ok_or_else(|| io::Error::other("member record must exist"))?;
        let records = vec![
            JoinRequestIssuance::new(&joiner, ENROLLED_AT).issue()?,
            corrupt_member_record,
        ];
        let join = match VaultMetaState::pending_join_for_device(PendingJoinForDeviceRequest {
            records: &records,
            device_id: joiner.device_id(),
        })? {
            DeviceJoinStatus::Pending(join) => join,
            DeviceJoinStatus::NotRequested => {
                return Err(io::Error::other("pending join must exist").into());
            }
        };

        let (auth_record, join_key, member_records) = JoinRequestApproval::new(
            &keys.secrets_key,
            &keys.members_key,
            join,
            &genesis,
            &records,
        )
        .approve()?;
        let mut approved_records = vec![auth_record];
        approved_records.extend(member_records);

        assert_eq!(join_key, joiner.device_id().to_string());
        assert_eq!(
            VaultRecordView::new(&approved_records).secrets_key(&joiner)?,
            keys.secrets_key
        );
        let roster = VaultMember::resolve_member_roster(ResolveMemberRosterRequest {
            records: &approved_records,
            members_key: &keys.members_key,
        })?;
        assert_eq!(roster.len(), 2);
        assert!(
            roster
                .iter()
                .any(|member| member.auth_id == genesis.auth_id())
        );
        assert!(
            roster
                .iter()
                .any(|member| member.auth_id == joiner.auth_id())
        );
        Ok(())
    }
}

pub use roster::{
    BuildMembersRecordsRequest, DecryptMemberEntryRequest, EncryptMemberEntryRequest,
    GenesisMembersRecordsRequest, MemberFromIdentityRequest, RenameVaultMemberRequest,
    ReplaceMemberRecordsRequest, ResolveMemberRosterRequest, RevokeVaultMemberRequest,
};

pub use access::{
    AssessConnectAccessRequest, DeviceIsEnrolledRequest, EnsureSelfInRosterRequest,
    PendingJoinForDeviceRequest,
};

pub use roster::RosterAddMemberRequest;

pub use sentinel::{
    CreateSentinelRootShareRecordsForRecipientsRequest,
    CreateSentinelShareRecordsForRecipientsRequest, CreateSentinelShareRecordsRequest,
};

//! Encrypted vault-member roster storage and member lifecycle operations.

use super::{DeviceIdentity, JoinRequest, MemberEntry, VaultMember, VaultMetaRecord};
use crate::DeviceId;
use crate::MemberLabelState;
use crate::RecordTypeDeclaration;
use crate::{
    AgeArmoredCiphertext, AuthKeyId, MultiDeviceError, MultiDeviceResult, SecretId,
    StoredRecordPayload, StoredSecretRecord, SymmetricKey, VaultCrypto,
};

/// Named values required by VaultMember::member_from_identity.
pub struct MemberFromIdentityRequest<'a> {
    pub identity: &'a DeviceIdentity,
    pub enrolled_at: &'a str,
}

/// Named values required by VaultMember::build_members_records.
pub struct BuildMembersRecordsRequest<'a> {
    pub roster: Vec<VaultMember>,
    pub members_key: &'a SymmetricKey,
}

/// Named values required by VaultMember::resolve_member_roster.
pub struct ResolveMemberRosterRequest<'a> {
    pub records: &'a [StoredSecretRecord],
    pub members_key: &'a SymmetricKey,
}

/// Named values required by VaultMember::roster_add_member.
pub struct RosterAddMemberRequest {
    pub roster: Vec<VaultMember>,
    pub member: VaultMember,
}

/// Named values required by VaultMember::genesis_members_records.
pub struct GenesisMembersRecordsRequest<'a> {
    pub identity: &'a DeviceIdentity,
    pub members_key: &'a SymmetricKey,
    pub enrolled_at: &'a str,
}

/// Named values required by VaultMember::replace_member_records.
pub struct ReplaceMemberRecordsRequest<'a> {
    pub records: &'a mut Vec<StoredSecretRecord>,
    pub member_records: Vec<StoredSecretRecord>,
}

/// Named values required by VaultMember::rename_vault_member.
pub struct RenameVaultMemberRequest<'a> {
    pub records: &'a [StoredSecretRecord],
    pub members_key: &'a SymmetricKey,
    pub auth_id: &'a AuthKeyId,
    pub label: &'a str,
}

/// Named values required by VaultMember::revoke_vault_member.
pub struct RevokeVaultMemberRequest<'a> {
    pub records: &'a [StoredSecretRecord],
    pub members_key: &'a SymmetricKey,
    pub auth_id: &'a AuthKeyId,
}

impl VaultMember {
    #[must_use]
    pub fn member_from_identity(request: MemberFromIdentityRequest<'_>) -> VaultMember {
        let MemberFromIdentityRequest {
            identity,
            enrolled_at,
        } = request;
        VaultMember {
            auth_id: identity.auth_id(),
            device_id: identity.device_id().to_owned(),
            public_key: identity.public_key(),
            enrolled_at: enrolled_at.to_owned(),
            label: MemberLabelState::Unnamed,
        }
    }
}

impl TryFrom<JoinRequest> for VaultMember {
    type Error = MultiDeviceError;

    fn try_from(join: JoinRequest) -> MultiDeviceResult<Self> {
        Ok(Self {
            auth_id: join.public_key.auth_id()?,
            device_id: join.device_id,
            public_key: join.public_key,
            enrolled_at: join.requested_at,
            label: MemberLabelState::Unnamed,
        })
    }
}

impl From<VaultMember> for MemberEntry {
    fn from(member: VaultMember) -> Self {
        Self {
            pk_id: member.auth_id,
            pk: member.public_key,
            label: member.label,
            enrolled_at: member.enrolled_at,
        }
    }
}

impl TryFrom<MemberEntry> for VaultMember {
    type Error = MultiDeviceError;

    fn try_from(entry: MemberEntry) -> MultiDeviceResult<Self> {
        Ok(Self {
            device_id: entry.pk.try_app_id()?,
            auth_id: entry.pk_id,
            public_key: entry.pk,
            enrolled_at: entry.enrolled_at,
            label: entry.label,
        })
    }
}

/// Named values required by MemberEntry::encrypt_member_entry.
pub struct EncryptMemberEntryRequest<'a> {
    pub entry: &'a MemberEntry,
    pub members_key: &'a SymmetricKey,
}

/// Named values required by MemberEntry::decrypt_member_entry.
pub struct DecryptMemberEntryRequest<'a> {
    pub ciphertext: &'a AgeArmoredCiphertext,
    pub members_key: &'a SymmetricKey,
}

impl MemberEntry {
    pub fn encrypt_member_entry(
        request: EncryptMemberEntryRequest<'_>,
    ) -> MultiDeviceResult<AgeArmoredCiphertext> {
        let EncryptMemberEntryRequest { entry, members_key } = request;
        let json = serde_json::to_string(entry).map_err(MultiDeviceError::MemberEntrySerialize)?;
        Ok(VaultCrypto::new(members_key)?.encrypt_value(&json)?)
    }
}

impl MemberEntry {
    pub fn decrypt_member_entry(
        request: DecryptMemberEntryRequest<'_>,
    ) -> MultiDeviceResult<MemberEntry> {
        let DecryptMemberEntryRequest {
            ciphertext,
            members_key,
        } = request;
        let json = VaultCrypto::new(members_key)?.decrypt_value(ciphertext)?;
        serde_json::from_str(json.as_str()).map_err(MultiDeviceError::MemberEntryJson)
    }
}

impl VaultMember {
    pub fn build_members_records(
        request: BuildMembersRecordsRequest<'_>,
    ) -> MultiDeviceResult<Vec<StoredSecretRecord>> {
        let BuildMembersRecordsRequest {
            roster,
            members_key,
        } = request;
        let mut records = Vec::with_capacity(roster.len());
        for member in roster {
            let entry = MemberEntry::from(member);
            records.push(StoredSecretRecord {
                key: SecretId::from_vault_record(&entry.pk_id.member_record_key()),
                secret_type: RecordTypeDeclaration::Undeclared,
                value: StoredRecordPayload::from_age_armored(MemberEntry::encrypt_member_entry(
                    EncryptMemberEntryRequest {
                        entry: &entry,
                        members_key: members_key,
                    },
                )?),
            });
        }
        Ok(records)
    }
}

impl VaultMember {
    pub fn resolve_member_roster(
        request: ResolveMemberRosterRequest<'_>,
    ) -> MultiDeviceResult<Vec<VaultMember>> {
        let ResolveMemberRosterRequest {
            records,
            members_key,
        } = request;
        let mut roster = Vec::new();
        for record in records {
            if !matches!((record).classify()?, VaultMetaRecord::Member(..)) {
                continue;
            }
            let entry = MemberEntry::decrypt_member_entry(DecryptMemberEntryRequest {
                ciphertext: &AgeArmoredCiphertext::parse(record.value.as_str())?,
                members_key: members_key,
            })?;
            if !(&entry.pk_id).member_record_key_matches(record.key.as_str()) {
                let pk_id = crate::AuthKeyId::parse(entry.pk_id.as_str())
                    .map_or_else(|_| entry.pk_id.to_string(), |id| id.to_string());
                let expected_key = AuthKeyId::parse(&pk_id)
                    .unwrap_or(entry.pk_id.clone())
                    .member_record_key();
                return Err(MultiDeviceError::MemberRecordKeyMismatch {
                    expected_key,
                    actual_key: record.key.to_string(),
                });
            }
            roster.push(VaultMember::try_from(entry)?);
        }
        roster.sort_by(|a, b| a.auth_id.cmp(&b.auth_id));
        Ok(roster)
    }
}

impl VaultMember {
    #[must_use]
    pub fn roster_add_member(request: RosterAddMemberRequest) -> Vec<VaultMember> {
        let RosterAddMemberRequest { mut roster, member } = request;
        roster.retain(|entry| entry.auth_id != member.auth_id);
        roster.push(member);
        roster.sort_by(|a, b| a.auth_id.cmp(&b.auth_id));
        roster
    }
}

impl VaultMember {
    pub fn genesis_members_records(
        request: GenesisMembersRecordsRequest<'_>,
    ) -> MultiDeviceResult<Vec<StoredSecretRecord>> {
        let GenesisMembersRecordsRequest {
            identity,
            members_key,
            enrolled_at,
        } = request;
        VaultMember::build_members_records(BuildMembersRecordsRequest {
            roster: vec![VaultMember::member_from_identity(
                MemberFromIdentityRequest {
                    identity: identity,
                    enrolled_at: enrolled_at,
                },
            )],
            members_key: members_key,
        })
    }
}

impl VaultMember {
    pub fn replace_member_records(
        request: ReplaceMemberRecordsRequest<'_>,
    ) -> MultiDeviceResult<()> {
        let ReplaceMemberRecordsRequest {
            records,
            member_records,
        } = request;
        let mut replacement = Vec::with_capacity(records.len() + member_records.len());
        for record in records.iter() {
            if !matches!((record).classify()?, VaultMetaRecord::Member(..)) {
                replacement.push(record.clone());
            }
        }
        replacement.extend(member_records);
        *records = replacement;
        Ok(())
    }
}

impl VaultMember {
    pub fn rename_vault_member(
        request: RenameVaultMemberRequest<'_>,
    ) -> MultiDeviceResult<Vec<StoredSecretRecord>> {
        let RenameVaultMemberRequest {
            records,
            members_key,
            auth_id,
            label,
        } = request;
        if !crate::AuthKeyId::is_valid(auth_id.as_str()) {
            return Err(MultiDeviceError::InvalidMemberId);
        }
        let trimmed = label.trim();
        if trimmed.len() > 80 {
            return Err(MultiDeviceError::DeviceNameTooLong);
        }
        let roster = VaultMember::resolve_member_roster(ResolveMemberRosterRequest {
            records: records,
            members_key: members_key,
        })?;
        if !roster.iter().any(|member| member.auth_id == *auth_id) {
            return Err(MultiDeviceError::DeviceNotFound);
        }
        let updated_label = if trimmed.is_empty() {
            MemberLabelState::Unnamed
        } else {
            MemberLabelState::Named(trimmed.to_owned())
        };
        let roster = roster
            .into_iter()
            .map(|mut member| {
                if member.auth_id == *auth_id {
                    member.label.clone_from(&updated_label);
                }
                member
            })
            .collect::<Vec<_>>();
        VaultMember::build_members_records(BuildMembersRecordsRequest {
            roster: roster,
            members_key: members_key,
        })
    }
}

impl VaultMember {
    pub fn revoke_vault_member(
        request: RevokeVaultMemberRequest<'_>,
    ) -> MultiDeviceResult<Vec<StoredSecretRecord>> {
        let RevokeVaultMemberRequest {
            records,
            members_key,
            auth_id,
        } = request;
        if !crate::AuthKeyId::is_valid(auth_id.as_str()) {
            return Err(MultiDeviceError::InvalidMemberId);
        }
        let roster = VaultMember::resolve_member_roster(ResolveMemberRosterRequest {
            records: records,
            members_key: members_key,
        })?;
        if roster.len() <= 1 {
            return Err(MultiDeviceError::CannotRemoveLastAccess);
        }
        let revoked_device_id = roster
            .iter()
            .find(|member| member.auth_id == *auth_id)
            .map(|member| member.device_id.clone())
            .ok_or(MultiDeviceError::DeviceNotFound)?;
        let revoked_share_key = DeviceId::sentinel_share_record_key(&revoked_device_id);

        let mut updated: Vec<StoredSecretRecord> = records
            .iter()
            .filter(|record| {
                record.key.as_str() != auth_id.as_str()
                    && record.key.as_str() != auth_id.member_record_key()
                    && record.key.as_str() != revoked_share_key
            })
            .cloned()
            .collect();
        let remaining_roster: Vec<VaultMember> = roster
            .into_iter()
            .filter(|member| member.auth_id != *auth_id)
            .collect();
        tracing::info!(
            scope = "multi-device",
            auth_id = auth_id.as_str(),
            remaining_members = remaining_roster.len(),
            "revoked vault member"
        );
        VaultMember::replace_member_records(ReplaceMemberRecordsRequest {
            records: &mut updated,
            member_records: VaultMember::build_members_records(BuildMembersRecordsRequest {
                roster: remaining_roster,
                members_key: members_key,
            })?,
        })?;
        Ok(updated)
    }
}

#[cfg(test)]
mod tests {
    use crate::DeviceJoinStatus;
    use std::io;

    use super::*;
    use crate::auth::multi_device::{
        JoinRequestApproval, JoinRequestIssuance, MEMBER_RECORD_PREFIX, VaultKeys, VaultRecordView,
    };
    use crate::{
        CreateSentinelShareRecordsRequest, PendingJoinForDeviceRequest, SecretType,
        SentinelShareEnvelope, StoredRecordPayload, VaultMetaState,
    };

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
    fn rename_vault_member_trims_clears_and_preserves_key_access() -> anyhow::Result<()> {
        let keys = VaultKeys::generate()?;
        let (genesis, mut records) = genesis_vault(&keys)?;
        let joiner = DeviceIdentity::generate()?;
        records.push(JoinRequestIssuance::new(&joiner, ENROLLED_AT).issue()?);
        approve_pending_join(&keys, &genesis, &mut records, &joiner)?;

        let renamed = VaultMember::rename_vault_member(RenameVaultMemberRequest {
            records: &records,
            members_key: &keys.members_key,
            auth_id: &joiner.auth_id(),
            label: "  Travel iPad  ",
        })?;
        let roster = VaultMember::resolve_member_roster(ResolveMemberRosterRequest {
            records: &renamed,
            members_key: &keys.members_key,
        })?;
        assert_eq!(
            roster
                .iter()
                .find(|member| member.auth_id == joiner.auth_id())
                .ok_or_else(|| io::Error::other("renamed member must exist"))?
                .label,
            MemberLabelState::Named("Travel iPad".to_owned())
        );
        assert_eq!(
            VaultRecordView::new(&records).members_key(&joiner)?,
            keys.members_key
        );

        let cleared = VaultMember::rename_vault_member(RenameVaultMemberRequest {
            records: &renamed,
            members_key: &keys.members_key,
            auth_id: &joiner.auth_id(),
            label: "   ",
        })?;
        let roster = VaultMember::resolve_member_roster(ResolveMemberRosterRequest {
            records: &cleared,
            members_key: &keys.members_key,
        })?;
        assert_eq!(
            roster
                .iter()
                .find(|member| member.auth_id == joiner.auth_id())
                .ok_or_else(|| io::Error::other("renamed member must exist"))?
                .label,
            MemberLabelState::Unnamed
        );
        Ok(())
    }

    #[test]
    fn revoke_vault_member_removes_auth_and_member_rows_but_not_user_secrets() -> anyhow::Result<()>
    {
        let keys = VaultKeys::generate()?;
        let (genesis, mut records) = genesis_vault(&keys)?;
        let joiner = DeviceIdentity::generate()?;
        let user_secret = user_secret_record("secret_note001", "encrypted-user-secret");
        records.push(JoinRequestIssuance::new(&joiner, ENROLLED_AT).issue()?);
        records.push(user_secret.clone());
        approve_pending_join(&keys, &genesis, &mut records, &joiner)?;
        records.extend(SentinelShareEnvelope::create_sentinel_share_records(
            CreateSentinelShareRecordsRequest {
                keys: &keys,
                participants: &[genesis.clone(), joiner.clone()],
                threshold: 2.into(),
            },
        )?);

        let revoked = VaultMember::revoke_vault_member(RevokeVaultMemberRequest {
            records: &records,
            members_key: &keys.members_key,
            auth_id: &joiner.auth_id(),
        })?;

        assert!(VaultRecordView::new(&revoked).secrets_key(&joiner).is_err());
        assert_eq!(
            VaultRecordView::new(&revoked).secrets_key(&genesis)?,
            keys.secrets_key
        );
        assert!(revoked.iter().any(|record| record == &user_secret));
        assert!(!revoked.iter().any(|record| {
            record.key.as_str() == DeviceId::sentinel_share_record_key(joiner.device_id())
        }));
        assert!(revoked.iter().any(|record| {
            record.key.as_str() == DeviceId::sentinel_share_record_key(genesis.device_id())
        }));
        let roster = VaultMember::resolve_member_roster(ResolveMemberRosterRequest {
            records: &revoked,
            members_key: &keys.members_key,
        })?;
        assert_eq!(roster.len(), 1);
        assert_eq!(roster[0].auth_id, genesis.auth_id());
        Ok(())
    }

    #[test]
    fn revoke_last_access_and_missing_member_are_errors() -> anyhow::Result<()> {
        let keys = VaultKeys::generate()?;
        let (genesis, records) = genesis_vault(&keys)?;
        let stranger = DeviceIdentity::generate()?;

        assert!(matches!(
            VaultMember::revoke_vault_member(RevokeVaultMemberRequest {
                records: &records,
                members_key: &keys.members_key,
                auth_id: &genesis.auth_id()
            }),
            Err(MultiDeviceError::CannotRemoveLastAccess)
        ));
        assert!(matches!(
            VaultMember::rename_vault_member(RenameVaultMemberRequest {
                records: &records,
                members_key: &keys.members_key,
                auth_id: &stranger.auth_id(),
                label: "Phone"
            }),
            Err(MultiDeviceError::DeviceNotFound)
        ));
        assert!(matches!(
            VaultMember::rename_vault_member(RenameVaultMemberRequest {
                records: &records,
                members_key: &keys.members_key,
                auth_id: &genesis.auth_id(),
                label: &"x".repeat(81)
            }),
            Err(MultiDeviceError::DeviceNameTooLong)
        ));
        Ok(())
    }

    #[test]
    fn member_roster_rejects_mismatched_record_key() -> anyhow::Result<()> {
        let keys = VaultKeys::generate()?;
        let (genesis, records) = genesis_vault(&keys)?;
        let mut member_record = records
            .iter()
            .find(|record| record.key.as_str().starts_with(MEMBER_RECORD_PREFIX))
            .ok_or_else(|| io::Error::other("member record must exist"))?
            .clone();
        let other_identity = DeviceIdentity::generate()?;
        member_record.key =
            SecretId::from_vault_record(&other_identity.auth_id().member_record_key());

        assert!(matches!(
            VaultMember::resolve_member_roster(ResolveMemberRosterRequest {
                records: &[member_record],
                members_key: &keys.members_key
            }),
            Err(MultiDeviceError::MemberRecordKeyMismatch { .. })
        ));
        assert_eq!(
            VaultMember::resolve_member_roster(ResolveMemberRosterRequest {
                records: &records,
                members_key: &keys.members_key
            })?[0]
                .auth_id,
            genesis.auth_id()
        );
        Ok(())
    }
}

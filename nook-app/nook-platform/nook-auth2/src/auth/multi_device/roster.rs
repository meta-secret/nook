//! Encrypted vault-member roster storage and member lifecycle operations.

use super::{
    DeviceIdentity, JoinRequest, MemberEntry, VaultMember, VaultMetaRecord,
    member_record_key_matches, sentinel_share_record_key,
};
use crate::{
    AgeArmoredCiphertext, AuthKeyId, MultiDeviceError, MultiDeviceResult, SecretId,
    StoredRecordPayload, StoredSecretRecord, SymmetricKey, VaultCrypto,
};

#[must_use]
pub fn member_from_identity(identity: &DeviceIdentity, enrolled_at: &str) -> VaultMember {
    VaultMember {
        auth_id: identity.auth_id(),
        device_id: identity.device_id().to_owned(),
        public_key: identity.public_key(),
        enrolled_at: enrolled_at.to_owned(),
        label: None,
    }
}

pub fn member_from_join(join: &JoinRequest) -> MultiDeviceResult<VaultMember> {
    Ok(VaultMember {
        auth_id: join.public_key.auth_id()?,
        device_id: join.device_id.clone(),
        public_key: join.public_key.clone(),
        enrolled_at: join.requested_at.clone(),
        label: None,
    })
}

fn member_to_entry(member: &VaultMember) -> MemberEntry {
    MemberEntry {
        pk_id: member.auth_id.clone(),
        pk: member.public_key.clone(),
        label: member.label.clone(),
        enrolled_at: member.enrolled_at.clone(),
    }
}

fn entry_to_member(entry: &MemberEntry) -> MultiDeviceResult<VaultMember> {
    Ok(VaultMember {
        auth_id: entry.pk_id.clone(),
        device_id: entry.pk.try_app_id()?,
        public_key: entry.pk.clone(),
        enrolled_at: entry.enrolled_at.clone(),
        label: entry.label.clone(),
    })
}

pub fn encrypt_member_entry(
    entry: &MemberEntry,
    members_key: &SymmetricKey,
) -> MultiDeviceResult<AgeArmoredCiphertext> {
    let json = serde_json::to_string(entry).map_err(MultiDeviceError::MemberEntrySerialize)?;
    Ok(VaultCrypto::new(members_key)?.encrypt_value(&json)?)
}

pub fn decrypt_member_entry(
    ciphertext: &AgeArmoredCiphertext,
    members_key: &SymmetricKey,
) -> MultiDeviceResult<MemberEntry> {
    let json = VaultCrypto::new(members_key)?.decrypt_value(ciphertext)?;
    serde_json::from_str(json.as_str()).map_err(MultiDeviceError::MemberEntryJson)
}

pub fn build_members_records(
    roster: &[VaultMember],
    members_key: &SymmetricKey,
) -> MultiDeviceResult<Vec<StoredSecretRecord>> {
    let mut records = Vec::with_capacity(roster.len());
    for member in roster {
        let entry = member_to_entry(member);
        records.push(StoredSecretRecord {
            key: SecretId::from_vault_record(&entry.pk_id.member_record_key()),
            secret_type: None,
            value: StoredRecordPayload::from_age_armored(encrypt_member_entry(
                &entry,
                members_key,
            )?),
        });
    }
    Ok(records)
}

pub fn resolve_member_roster(
    records: &[StoredSecretRecord],
    members_key: &SymmetricKey,
) -> MultiDeviceResult<Vec<VaultMember>> {
    let mut roster = Vec::new();
    for record in records {
        if !VaultMetaRecord::is_member(record)? {
            continue;
        }
        let entry = decrypt_member_entry(
            &AgeArmoredCiphertext::parse(record.value.as_str())?,
            members_key,
        )?;
        if !member_record_key_matches(record.key.as_str(), &entry.pk_id) {
            let pk_id = crate::normalize_auth_key_id(entry.pk_id.as_str())
                .map_or_else(|_| entry.pk_id.to_string(), |id| id.to_string());
            let expected_key = AuthKeyId::parse(&pk_id)
                .unwrap_or(entry.pk_id.clone())
                .member_record_key();
            return Err(MultiDeviceError::MemberRecordKeyMismatch {
                expected_key,
                actual_key: record.key.to_string(),
            });
        }
        roster.push(entry_to_member(&entry)?);
    }
    roster.sort_by(|a, b| a.auth_id.cmp(&b.auth_id));
    Ok(roster)
}

#[must_use]
pub fn roster_add_member(mut roster: Vec<VaultMember>, member: VaultMember) -> Vec<VaultMember> {
    roster.retain(|entry| entry.auth_id != member.auth_id);
    roster.push(member);
    roster.sort_by(|a, b| a.auth_id.cmp(&b.auth_id));
    roster
}

pub fn genesis_members_records(
    identity: &DeviceIdentity,
    members_key: &SymmetricKey,
    enrolled_at: &str,
) -> MultiDeviceResult<Vec<StoredSecretRecord>> {
    build_members_records(&[member_from_identity(identity, enrolled_at)], members_key)
}

pub fn replace_member_records(
    records: &mut Vec<StoredSecretRecord>,
    member_records: Vec<StoredSecretRecord>,
) -> MultiDeviceResult<()> {
    let mut replacement = Vec::with_capacity(records.len() + member_records.len());
    for record in records.iter() {
        if !VaultMetaRecord::is_member(record)? {
            replacement.push(record.clone());
        }
    }
    replacement.extend(member_records);
    *records = replacement;
    Ok(())
}

pub fn rename_vault_member(
    records: &[StoredSecretRecord],
    members_key: &SymmetricKey,
    auth_id: &AuthKeyId,
    label: &str,
) -> MultiDeviceResult<Vec<StoredSecretRecord>> {
    if !crate::is_auth_key_id(auth_id.as_str()) {
        return Err(MultiDeviceError::InvalidMemberId);
    }
    let trimmed = label.trim();
    if trimmed.len() > 80 {
        return Err(MultiDeviceError::DeviceNameTooLong);
    }
    let roster = resolve_member_roster(records, members_key)?;
    if !roster.iter().any(|member| member.auth_id == *auth_id) {
        return Err(MultiDeviceError::DeviceNotFound);
    }
    let updated_label = if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_owned())
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
    build_members_records(&roster, members_key)
}

pub fn revoke_vault_member(
    records: &[StoredSecretRecord],
    members_key: &SymmetricKey,
    auth_id: &AuthKeyId,
) -> MultiDeviceResult<Vec<StoredSecretRecord>> {
    if !crate::is_auth_key_id(auth_id.as_str()) {
        return Err(MultiDeviceError::InvalidMemberId);
    }
    let roster = resolve_member_roster(records, members_key)?;
    if roster.len() <= 1 {
        return Err(MultiDeviceError::CannotRemoveLastAccess);
    }
    let revoked_device_id = roster
        .iter()
        .find(|member| member.auth_id == *auth_id)
        .map(|member| member.device_id.clone())
        .ok_or(MultiDeviceError::DeviceNotFound)?;
    let revoked_share_key = sentinel_share_record_key(&revoked_device_id);

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
    replace_member_records(
        &mut updated,
        build_members_records(&remaining_roster, members_key)?,
    )?;
    Ok(updated)
}

#[cfg(test)]
mod tests {
    use std::io;

    use super::*;
    use crate::auth::multi_device::{
        JoinRequestApproval, JoinRequestIssuance, MEMBER_RECORD_PREFIX, VaultKeys, VaultRecordView,
        create_sentinel_share_records, pending_join_for_device,
    };
    use crate::{SecretType, StoredRecordPayload};

    const ENROLLED_AT: &str = "2026-06-21T00:00:00Z";

    fn genesis_vault(
        keys: &VaultKeys,
    ) -> anyhow::Result<(DeviceIdentity, Vec<StoredSecretRecord>)> {
        let genesis = DeviceIdentity::generate()?;
        let mut records = vec![genesis.auth_record(&keys.secrets_key, &keys.members_key)?];
        records.extend(genesis_members_records(
            &genesis,
            &keys.members_key,
            ENROLLED_AT,
        )?);
        Ok((genesis, records))
    }

    fn user_secret_record(id: &str, value: &str) -> StoredSecretRecord {
        StoredSecretRecord {
            key: SecretId::from_vault_record(id),
            secret_type: Some(SecretType::Login),
            value: StoredRecordPayload::from_trusted(value.to_owned()),
        }
    }

    fn approve_pending_join(
        keys: &VaultKeys,
        approver: &DeviceIdentity,
        records: &mut Vec<StoredSecretRecord>,
        joiner: &DeviceIdentity,
    ) -> anyhow::Result<()> {
        let join = pending_join_for_device(records, joiner.device_id())?
            .ok_or_else(|| io::Error::other("pending join fixture must exist"))?;
        let (auth_record, join_key, member_records) = JoinRequestApproval::new(
            &keys.secrets_key,
            &keys.members_key,
            &join,
            approver,
            records,
        )
        .approve()?;
        records.retain(|record| record.key.as_str() != join_key);
        records.push(auth_record);
        replace_member_records(records, member_records)?;
        Ok(())
    }

    #[test]
    fn rename_vault_member_trims_clears_and_preserves_key_access() -> anyhow::Result<()> {
        let keys = VaultKeys::generate()?;
        let (genesis, mut records) = genesis_vault(&keys)?;
        let joiner = DeviceIdentity::generate()?;
        records.push(JoinRequestIssuance::new(&joiner, ENROLLED_AT).issue()?);
        approve_pending_join(&keys, &genesis, &mut records, &joiner)?;

        let renamed = rename_vault_member(
            &records,
            &keys.members_key,
            &joiner.auth_id(),
            "  Travel iPad  ",
        )?;
        let roster = resolve_member_roster(&renamed, &keys.members_key)?;
        assert_eq!(
            roster
                .iter()
                .find(|member| member.auth_id == joiner.auth_id())
                .ok_or_else(|| io::Error::other("renamed member must exist"))?
                .label
                .as_deref(),
            Some("Travel iPad")
        );
        assert_eq!(
            VaultRecordView::new(&records).members_key(&joiner)?,
            keys.members_key
        );

        let cleared = rename_vault_member(&renamed, &keys.members_key, &joiner.auth_id(), "   ")?;
        let roster = resolve_member_roster(&cleared, &keys.members_key)?;
        assert_eq!(
            roster
                .iter()
                .find(|member| member.auth_id == joiner.auth_id())
                .ok_or_else(|| io::Error::other("renamed member must exist"))?
                .label,
            None
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
        records.extend(create_sentinel_share_records(
            &keys,
            &[genesis.clone(), joiner.clone()],
            2.into(),
        )?);

        let revoked = revoke_vault_member(&records, &keys.members_key, &joiner.auth_id())?;

        assert!(VaultRecordView::new(&revoked).secrets_key(&joiner).is_err());
        assert_eq!(
            VaultRecordView::new(&revoked).secrets_key(&genesis)?,
            keys.secrets_key
        );
        assert!(revoked.iter().any(|record| record == &user_secret));
        assert!(!revoked.iter().any(|record| {
            record.key.as_str() == sentinel_share_record_key(joiner.device_id())
        }));
        assert!(revoked.iter().any(|record| {
            record.key.as_str() == sentinel_share_record_key(genesis.device_id())
        }));
        let roster = resolve_member_roster(&revoked, &keys.members_key)?;
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
            revoke_vault_member(&records, &keys.members_key, &genesis.auth_id()),
            Err(MultiDeviceError::CannotRemoveLastAccess)
        ));
        assert!(matches!(
            rename_vault_member(&records, &keys.members_key, &stranger.auth_id(), "Phone"),
            Err(MultiDeviceError::DeviceNotFound)
        ));
        assert!(matches!(
            rename_vault_member(
                &records,
                &keys.members_key,
                &genesis.auth_id(),
                &"x".repeat(81)
            ),
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
            resolve_member_roster(&[member_record], &keys.members_key),
            Err(MultiDeviceError::MemberRecordKeyMismatch { .. })
        ));
        assert_eq!(
            resolve_member_roster(&records, &keys.members_key)?[0].auth_id,
            genesis.auth_id()
        );
        Ok(())
    }
}

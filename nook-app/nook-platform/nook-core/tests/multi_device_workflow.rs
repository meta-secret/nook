//! Multi-device vault keys workflow integration tests.

use nook_auth2::{
    GenesisMembersRecordsRequest, RenameVaultMemberRequest, ReplaceMemberRecordsRequest,
    ResolveMemberRosterRequest, RevokeVaultMemberRequest, VaultMember,
};
use nook_core::MemberLabelState;
use std::io;

use nook_core::{
    ApiKeySecret, Database, DeviceEnrollment, DeviceIdentity, JoinRequestApproval,
    JoinRequestIssuance, SecretId, SecretValue, VaultCrypto, VaultFormat, VaultFormatDocument,
    VaultKeys, VaultRecordSet, VaultRecordView,
};

fn sid(label: &str) -> SecretId {
    SecretId::from_vault_record(label)
}

fn api_key(value: &str) -> SecretValue {
    SecretValue::ApiKey(ApiKeySecret {
        website_url: "https://example.com".to_owned(),
        key: value.to_owned(),
        expires_at: String::new(),
    })
}

fn encrypt_user_secrets(
    db: &Database,
    crypto: &VaultCrypto,
) -> anyhow::Result<Vec<nook_core::StoredSecretRecord>> {
    Ok(db.to_stored_records_with_crypto(crypto)?)
}

fn genesis_vault(
    keys: &VaultKeys,
) -> anyhow::Result<(DeviceIdentity, Vec<nook_core::StoredSecretRecord>)> {
    let genesis = DeviceIdentity::generate()?;
    let mut records = vec![genesis.auth_record(&keys.secrets_key, &keys.members_key)?];
    records.extend(VaultMember::genesis_members_records(
        GenesisMembersRecordsRequest {
            identity: &genesis,
            members_key: &keys.members_key,
            enrolled_at: "2026-06-21T00:00:00Z",
        },
    )?);
    Ok((genesis, records))
}

#[test]
fn three_device_join_flow_unlocks_shared_vault_and_roster() -> anyhow::Result<()> {
    let keys = VaultKeys::generate()?;
    let crypto = VaultCrypto::new(&keys.secrets_key)?;

    let (genesis, mut records) = genesis_vault(&keys)?;

    let mut db = Database::new();
    db.insert(sid("github.com"), api_key("hunter2"));
    records.extend(encrypt_user_secrets(&db, &crypto)?);

    let device_two = DeviceIdentity::generate()?;
    records.push(JoinRequestIssuance::new(&device_two, "2026-06-21T00:00:00Z").issue()?);
    let join_two = VaultRecordView::new(&records)
        .list_join_requests()?
        .pop()
        .ok_or_else(|| io::Error::other("test pop value must exist"))?;
    let (auth_two, join_key, member_records) = JoinRequestApproval::new(
        &keys.secrets_key,
        &keys.members_key,
        join_two,
        &genesis,
        &records,
    )
    .approve()?;
    records.retain(|record| record.key.as_str() != join_key);
    records.push(auth_two);
    VaultMember::replace_member_records(ReplaceMemberRecordsRequest {
        records: &mut records,
        member_records: member_records,
    })?;

    let device_three = DeviceIdentity::generate()?;
    records.push(JoinRequestIssuance::new(&device_three, "2026-06-21T01:00:00Z").issue()?);
    let join_three = VaultRecordView::new(&records)
        .list_join_requests()?
        .pop()
        .ok_or_else(|| io::Error::other("test pop value must exist"))?;
    let (auth_three, join_key, member_records) = JoinRequestApproval::new(
        &keys.secrets_key,
        &keys.members_key,
        join_three,
        &genesis,
        &records,
    )
    .approve()?;
    records.retain(|record| record.key.as_str() != join_key);
    records.push(auth_three);
    VaultMember::replace_member_records(ReplaceMemberRecordsRequest {
        records: &mut records,
        member_records: member_records,
    })?;

    let yaml = VaultRecordSet::serialize(&records, VaultFormat::Yaml)?;
    let yaml_str = yaml.as_str();
    assert!(yaml_str.contains("auth:"));
    assert!(yaml_str.contains("members:"));
    assert!(yaml_str.contains("pk_id:"));
    assert!(yaml_str.contains("secrets_key:"));
    assert!(yaml_str.contains("members_key:"));
    assert!(yaml_str.contains("ciphertext:"));
    assert!(yaml_str.contains("secrets:"));
    assert!(!yaml_str.contains("age1"));

    let loaded = VaultFormatDocument::new(yaml_str).deserialize(VaultFormat::Yaml)?;

    for device in [&genesis, &device_two, &device_three] {
        let resolved_secrets = VaultRecordView::new(&loaded).secrets_key(device)?;
        let resolved_members = VaultRecordView::new(&loaded).members_key(device)?;
        assert_eq!(resolved_secrets, keys.secrets_key);
        assert_eq!(resolved_members, keys.members_key);
        let roster = VaultMember::resolve_member_roster(ResolveMemberRosterRequest {
            records: &loaded,
            members_key: &keys.members_key,
        })?;
        assert_eq!(roster.len(), 3);
        let user_records = VaultRecordView::new(&loaded).user_records()?;
        let unlocked = Database::from_stored_records_with_crypto(&user_records, &crypto)?;
        assert_eq!(unlocked.list().len(), 1);
        assert_eq!(unlocked.list()[0].data, api_key("hunter2"));
    }
    Ok(())
}

#[test]
fn vault_without_auth_envelope_fails_to_resolve_secrets_key() -> anyhow::Result<()> {
    let crypto = VaultCrypto::new(&VaultKeys::generate()?.secrets_key)?;
    let mut db = Database::new();
    db.insert(sid("site"), api_key("secret"));
    let records = encrypt_user_secrets(&db, &crypto)?;

    let device = DeviceIdentity::generate()?;
    assert!(VaultRecordView::new(&records).secrets_key(&device).is_err());
    Ok(())
}

#[test]
fn oob_enroll_writes_self_member_roster_only() -> anyhow::Result<()> {
    let keys = VaultKeys::generate()?;
    let device = DeviceIdentity::generate()?;
    let (auth, members) = DeviceEnrollment::with_keys(
        &keys.secrets_key,
        &keys.members_key,
        &device,
        "2026-06-21T02:00:00Z",
    )
    .enroll()?;
    let mut records = vec![auth];
    records.extend(members);
    let roster = VaultMember::resolve_member_roster(ResolveMemberRosterRequest {
        records: &records,
        members_key: &keys.members_key,
    })?;
    assert_eq!(roster.len(), 1);
    assert_eq!(roster[0].device_id, device.device_id().to_owned());
    Ok(())
}

#[test]
fn yaml_roundtrip_preserves_secrets_and_members_key_resolution() -> anyhow::Result<()> {
    let keys = VaultKeys::generate()?;
    let (genesis, records) = genesis_vault(&keys)?;

    let yaml = VaultRecordSet::serialize(&records, VaultFormat::Yaml)?;
    let loaded = VaultFormatDocument::new(yaml.as_str()).deserialize(VaultFormat::Yaml)?;

    assert_eq!(
        VaultRecordView::new(&loaded).secrets_key(&genesis)?,
        keys.secrets_key
    );
    assert_eq!(
        VaultRecordView::new(&loaded).members_key(&genesis)?,
        keys.members_key
    );
    Ok(())
}

#[test]
fn resolve_members_key_fails_without_auth_envelope() -> anyhow::Result<()> {
    let device = DeviceIdentity::generate()?;
    assert!(VaultRecordView::new(&[]).members_key(&device).is_err());
    Ok(())
}

#[test]
fn member_roster_entries_expose_pk_id_and_public_key() -> anyhow::Result<()> {
    let keys = VaultKeys::generate()?;
    let device = DeviceIdentity::generate()?;
    let (auth, members) = DeviceEnrollment::with_keys(
        &keys.secrets_key,
        &keys.members_key,
        &device,
        "2026-06-21T03:00:00Z",
    )
    .enroll()?;
    let mut records = vec![auth];
    records.extend(members);

    let roster = VaultMember::resolve_member_roster(ResolveMemberRosterRequest {
        records: &records,
        members_key: &keys.members_key,
    })?;
    assert_eq!(roster.len(), 1);
    assert_eq!(roster[0].auth_id, device.auth_id());
    assert_eq!(roster[0].public_key, device.public_key());
    assert_eq!(roster[0].device_id, device.device_id().to_owned());
    Ok(())
}

#[test]
fn approve_join_writes_distinct_secrets_and_members_envelopes() -> anyhow::Result<()> {
    let keys = VaultKeys::generate()?;
    let (genesis, mut records) = genesis_vault(&keys)?;
    let joiner = DeviceIdentity::generate()?;
    records.push(JoinRequestIssuance::new(&joiner, "2026-06-21T04:00:00Z").issue()?);
    let join = VaultRecordView::new(&records)
        .list_join_requests()?
        .pop()
        .ok_or_else(|| io::Error::other("test pop value must exist"))?;

    let (auth, join_key, _) = JoinRequestApproval::new(
        &keys.secrets_key,
        &keys.members_key,
        join,
        &genesis,
        &records,
    )
    .approve()?;
    records.retain(|r| r.key.as_str() != join_key);
    records.push(auth.clone());

    let env = nook_core::AuthEnvelopes::parse(auth.value.as_str())?;
    assert_ne!(env.secrets_key, env.members_key);
    assert_eq!(joiner.decrypt_envelope(&env.secrets_key)?, keys.secrets_key);
    assert_eq!(joiner.decrypt_envelope(&env.members_key)?, keys.members_key);
    Ok(())
}

#[test]
fn rename_member_label_survives_yaml_roundtrip() -> anyhow::Result<()> {
    let keys = VaultKeys::generate()?;
    let (device, mut records) = genesis_vault(&keys)?;
    let member_records = VaultMember::rename_vault_member(RenameVaultMemberRequest {
        records: &records,
        members_key: &keys.members_key,
        auth_id: &device.auth_id(),
        label: "Kitchen iPad",
    })?;
    VaultMember::replace_member_records(ReplaceMemberRecordsRequest {
        records: &mut records,
        member_records: member_records,
    })?;

    let yaml = VaultRecordSet::serialize(&records, VaultFormat::Yaml)?;
    assert!(!yaml.as_str().contains("Kitchen iPad"));
    let loaded = VaultFormatDocument::new(yaml.as_str()).deserialize(VaultFormat::Yaml)?;
    let roster = VaultMember::resolve_member_roster(ResolveMemberRosterRequest {
        records: &loaded,
        members_key: &keys.members_key,
    })?;
    assert_eq!(roster.len(), 1);
    assert_eq!(
        roster[0].label,
        MemberLabelState::Named("Kitchen iPad".to_owned())
    );
    Ok(())
}

#[test]
fn revoked_device_cannot_resolve_keys_after_yaml_roundtrip() -> anyhow::Result<()> {
    let keys = VaultKeys::generate()?;
    let (genesis, mut records) = genesis_vault(&keys)?;
    let joiner = DeviceIdentity::generate()?;
    records.push(JoinRequestIssuance::new(&joiner, "2026-06-21T04:00:00Z").issue()?);
    let join = VaultRecordView::new(&records)
        .list_join_requests()?
        .pop()
        .ok_or_else(|| io::Error::other("test pop value must exist"))?;

    let (auth, join_key, member_records) = JoinRequestApproval::new(
        &keys.secrets_key,
        &keys.members_key,
        join,
        &genesis,
        &records,
    )
    .approve()?;
    records.retain(|r| r.key.as_str() != join_key);
    records.push(auth);
    VaultMember::replace_member_records(ReplaceMemberRecordsRequest {
        records: &mut records,
        member_records: member_records,
    })?;

    let revoked = VaultMember::revoke_vault_member(RevokeVaultMemberRequest {
        records: &records,
        members_key: &keys.members_key,
        auth_id: &joiner.auth_id(),
    })?;
    let yaml = VaultRecordSet::serialize(&revoked, VaultFormat::Yaml)?;
    let loaded = VaultFormatDocument::new(yaml.as_str()).deserialize(VaultFormat::Yaml)?;

    assert!(VaultRecordView::new(&loaded).secrets_key(&joiner).is_err());
    assert_eq!(
        VaultRecordView::new(&loaded).secrets_key(&genesis)?,
        keys.secrets_key
    );
    let roster = VaultMember::resolve_member_roster(ResolveMemberRosterRequest {
        records: &loaded,
        members_key: &keys.members_key,
    })?;
    assert_eq!(roster.len(), 1);
    assert_eq!(roster[0].auth_id, genesis.auth_id());
    Ok(())
}

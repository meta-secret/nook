use super::*;

const ENROLLED_AT: &str = "2026-06-21T00:00:00Z";
type SentinelShareFixture = (VaultKeys, [DeviceIdentity; 3], Vec<StoredSecretRecord>);

fn genesis_vault(keys: &VaultKeys) -> anyhow::Result<(DeviceIdentity, Vec<StoredSecretRecord>)> {
    let genesis = DeviceIdentity::generate()?;
    let mut records = vec![genesis_auth_record(
        &genesis,
        &keys.secrets_key,
        &keys.members_key,
    )?];
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
    let join = pending_join_for_device(records, joiner.device_id())
        .ok_or_else(|| std::io::Error::other("pending join fixture must exist"))?;
    let (auth_record, join_key, member_records) = approve_join_request(
        &keys.secrets_key,
        &keys.members_key,
        &join,
        approver,
        records,
    )?;
    records.retain(|record| record.key.as_str() != join_key);
    records.push(auth_record);
    replace_member_records(records, member_records);
    Ok(())
}

fn sentinel_share_fixture() -> anyhow::Result<SentinelShareFixture> {
    let keys = generate_vault_keys()?;
    let identities = [
        DeviceIdentity::generate()?,
        DeviceIdentity::generate()?,
        DeviceIdentity::generate()?,
    ];
    let records = create_sentinel_share_records(&keys, &identities, 2)?;
    Ok((keys, identities, records))
}

#[test]
fn genesis_device_can_decrypt_vault_keys() -> anyhow::Result<()> {
    let keys = generate_vault_keys()?;
    let (genesis, records) = genesis_vault(&keys)?;
    assert_eq!(resolve_secrets_key(&records, &genesis)?, keys.secrets_key);
    assert_eq!(resolve_members_key(&records, &genesis)?, keys.members_key);
    Ok(())
}

#[test]
fn second_device_join_request_and_approval_roundtrips_key_access() -> anyhow::Result<()> {
    let keys = generate_vault_keys()?;
    let (genesis, mut records) = genesis_vault(&keys)?;

    let joiner = DeviceIdentity::generate()?;
    records.push(create_join_request_record(&joiner, ENROLLED_AT)?);

    approve_pending_join(&keys, &genesis, &mut records, &joiner)?;

    assert_eq!(resolve_secrets_key(&records, &joiner)?, keys.secrets_key);
    assert_eq!(resolve_members_key(&records, &joiner)?, keys.members_key);
    assert_eq!(resolve_member_roster(&records, &keys.members_key)?.len(), 2);
    Ok(())
}

#[test]
fn vault_meta_state_classifies_roundtrips_and_removes_every_record_kind() -> anyhow::Result<()> {
    let keys = generate_vault_keys()?;
    let (genesis, mut records) = genesis_vault(&keys)?;
    let joiner = DeviceIdentity::generate()?;
    let sentinel_participant = DeviceIdentity::generate()?;
    let sentinel_record =
        create_sentinel_share_records(&keys, &[genesis.clone(), sentinel_participant.clone()], 2)?
            .pop()
            .ok_or_else(|| std::io::Error::other("sentinel share record must exist"))?;
    let join_record = create_join_request_record_with_signing_key(
        &joiner,
        ENROLLED_AT,
        &DeviceSigningPublicKey::from_trusted("a".repeat(64)),
    )?;
    let user_secret = user_secret_record("secret_login001", "encrypted-user-secret");
    records.push(join_record.clone());
    records.push(sentinel_record.clone());
    records.push(user_secret.clone());

    let mut state = VaultMetaState::from_stored_records(&records);
    assert_eq!(state.secrets.len(), 1);
    assert_eq!(state.auth.len(), 1);
    assert_eq!(state.joins.len(), 1);
    assert_eq!(state.members.len(), 1);
    assert_eq!(state.sentinel_shares.len(), 1);
    assert_eq!(
        state
            .joins
            .get(joiner.device_id())
            .ok_or_else(|| std::io::Error::other("joining member must exist"))?
            .signing_public_key
            .as_str(),
        "a".repeat(64)
    );

    let flattened = state.to_stored_records();
    assert_eq!(VaultMetaState::from_stored_records(&flattened), state);
    assert_eq!(user_stored_records(&flattened), vec![user_secret.clone()]);

    state.remove_key(user_secret.key.as_str());
    state.remove_key(genesis.auth_id().as_str());
    state.remove_key(&member_stored_key(&genesis.auth_id()));
    state.remove_key(joiner.device_id().as_str());
    state.remove_key(sentinel_record.key.as_str());
    assert!(state.is_empty());

    assert!(matches!(
        VaultMetaRecord::classify(&user_secret),
        VaultMetaRecord::Secret(_, SecretType::Login, _)
    ));
    assert!(matches!(
        VaultMetaRecord::classify(&join_record),
        VaultMetaRecord::Join(_, _)
    ));
    assert!(matches!(
        VaultMetaRecord::classify(&sentinel_record),
        VaultMetaRecord::SentinelShare(_, _)
    ));
    Ok(())
}

#[test]
fn sentinel_threshold_shares_reconstruct_keys_without_full_device_envelopes() -> anyhow::Result<()>
{
    let (keys, [first, second, third], records) = sentinel_share_fixture()?;

    assert_eq!(records.len(), 3);
    assert!(records.iter().all(is_sentinel_share_stored_record));
    assert!(records.iter().all(|record| !is_auth_stored_record(record)));
    assert!(resolve_secrets_key(&records, &first).is_err());
    assert!(reconstruct_sentinel_vault_keys(&records, std::slice::from_ref(&first)).is_err());

    let reconstructed =
        reconstruct_sentinel_vault_keys(&records, &[first.clone(), second.clone()])?;
    assert_eq!(reconstructed, keys);

    let alternate = reconstruct_sentinel_vault_keys(&records, &[second, third])?;
    assert_eq!(alternate, keys);
    Ok(())
}

#[test]
fn opened_sentinel_shares_reconstruct_without_peer_identities() -> anyhow::Result<()> {
    let (keys, [first, second, third], records) = sentinel_share_fixture()?;

    let opened_first = open_sentinel_share_for_identity(&records, &first)?;
    let opened_second = open_sentinel_share_for_identity(&records, &second)?;
    assert_eq!(opened_first.device_id, first.device_id().as_str());
    assert_eq!(opened_second.threshold, 2);

    assert!(
        reconstruct_sentinel_vault_keys_from_opened(&records, std::slice::from_ref(&opened_first))
            .is_err()
    );

    let reconstructed =
        reconstruct_sentinel_vault_keys_from_opened(&records, &[opened_first, opened_second])?;
    assert_eq!(reconstructed, keys);

    // Share-row enrollment counts as Ready without an auth envelope.
    assert!(device_is_enrolled(&records, &first));
    assert_eq!(
        assess_connect_access(&records, &third),
        ConnectAccessStatus::Ready
    );
    assert!(resolve_secrets_key(&records, &first).is_err());
    Ok(())
}

#[test]
fn sentinel_member_row_without_auth_counts_as_enrolled() -> anyhow::Result<()> {
    let keys = generate_vault_keys()?;
    let participant = DeviceIdentity::generate()?;
    let members = genesis_members_records(&participant, &keys.members_key, ENROLLED_AT)?;
    assert!(device_is_enrolled(&members, &participant));
    assert_eq!(
        assess_connect_access(&members, &participant),
        ConnectAccessStatus::Ready
    );
    assert!(resolve_secrets_key(&members, &participant).is_err());
    Ok(())
}

#[test]
fn merge_remote_join_records_replaces_only_pending_join_bucket() -> anyhow::Result<()> {
    let keys = generate_vault_keys()?;
    let (genesis, mut records) = genesis_vault(&keys)?;
    records.push(user_secret_record("secret_api001", "encrypted-user-secret"));

    let stale_joiner = DeviceIdentity::generate()?;
    records.push(create_join_request_record(
        &stale_joiner,
        "2026-06-20T00:00:00Z",
    )?);
    let mut state = VaultMetaState::from_stored_records(&records);

    let fresh_joiner = DeviceIdentity::generate()?;
    let fresh_records = vec![create_join_request_record(&fresh_joiner, ENROLLED_AT)?];
    merge_remote_join_records(&mut state, &fresh_records);

    assert_eq!(state.secrets.len(), 1);
    assert_eq!(state.auth.len(), 1);
    assert_eq!(state.members.len(), 1);
    assert!(!state.joins.contains_key(stale_joiner.device_id()));
    assert_eq!(
        state.joins.keys().collect::<Vec<_>>(),
        vec![fresh_joiner.device_id()]
    );
    assert_eq!(
        resolve_secrets_key(&state.to_stored_records(), &genesis)?,
        keys.secrets_key
    );
    Ok(())
}

#[test]
fn connect_access_status_distinguishes_ready_pending_and_unenrolled_devices() -> anyhow::Result<()>
{
    let keys = generate_vault_keys()?;
    let (genesis, mut records) = genesis_vault(&keys)?;
    let pending = DeviceIdentity::generate()?;
    let stranger = DeviceIdentity::generate()?;

    records.push(create_join_request_record(&pending, ENROLLED_AT)?);

    assert_eq!(
        assess_connect_access(&records, &genesis),
        ConnectAccessStatus::Ready
    );
    assert_eq!(
        assess_connect_access(&records, &pending),
        ConnectAccessStatus::JoinPending
    );
    assert_eq!(
        assess_connect_access(&records, &stranger),
        ConnectAccessStatus::NeedsEnrollment
    );
    Ok(())
}

#[test]
fn approve_join_falls_back_to_approver_when_roster_is_missing() -> anyhow::Result<()> {
    let keys = generate_vault_keys()?;
    let genesis = DeviceIdentity::generate()?;
    let joiner = DeviceIdentity::generate()?;
    let wrong_members_key = generate_symmetric_key()?;
    let corrupt_member_record = build_members_records(
        &[member_from_identity(&genesis, ENROLLED_AT)],
        &wrong_members_key,
    )?
    .into_iter()
    .next()
    .ok_or_else(|| std::io::Error::other("member record must exist"))?;
    let records = vec![
        create_join_request_record(&joiner, ENROLLED_AT)?,
        corrupt_member_record,
    ];
    let join = pending_join_for_device(&records, joiner.device_id())
        .ok_or_else(|| std::io::Error::other("pending join must exist"))?;

    let (auth_record, join_key, member_records) = approve_join_request(
        &keys.secrets_key,
        &keys.members_key,
        &join,
        &genesis,
        &records,
    )?;
    let mut approved_records = vec![auth_record];
    approved_records.extend(member_records);

    assert_eq!(join_key, join_record_key(joiner.device_id()));
    assert_eq!(
        resolve_secrets_key(&approved_records, &joiner)?,
        keys.secrets_key
    );
    let roster = resolve_member_roster(&approved_records, &keys.members_key)?;
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

#[test]
fn ensure_self_in_roster_adds_missing_current_identity_once() -> anyhow::Result<()> {
    let keys = generate_vault_keys()?;
    let (genesis, mut records) = genesis_vault(&keys)?;
    let joiner = DeviceIdentity::generate()?;
    records.push(create_join_request_record(&joiner, ENROLLED_AT)?);
    approve_pending_join(&keys, &genesis, &mut records, &joiner)?;

    let mut missing_joiner_roster = records
        .iter()
        .filter(|record| record.key.as_str() != member_stored_key(&joiner.auth_id()))
        .cloned()
        .collect::<Vec<_>>();
    let SelfRosterSync::Updated(repaired) =
        ensure_self_in_roster(&missing_joiner_roster, &joiner, &keys.members_key)?
    else {
        panic!("missing roster member should produce an update");
    };
    replace_member_records(&mut missing_joiner_roster, repaired);

    let roster = resolve_member_roster(&missing_joiner_roster, &keys.members_key)?;
    assert_eq!(roster.len(), 2);
    assert!(
        roster
            .iter()
            .any(|member| member.auth_id == joiner.auth_id())
    );
    assert_eq!(
        ensure_self_in_roster(&missing_joiner_roster, &joiner, &keys.members_key)?,
        SelfRosterSync::Current
    );
    Ok(())
}

#[test]
fn rename_vault_member_trims_clears_and_preserves_key_access() -> anyhow::Result<()> {
    let keys = generate_vault_keys()?;
    let (genesis, mut records) = genesis_vault(&keys)?;
    let joiner = DeviceIdentity::generate()?;
    records.push(create_join_request_record(&joiner, ENROLLED_AT)?);
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
            .ok_or_else(|| std::io::Error::other("renamed member must exist"))?
            .label
            .as_deref(),
        Some("Travel iPad")
    );
    assert_eq!(resolve_members_key(&records, &joiner)?, keys.members_key);

    let cleared = rename_vault_member(&renamed, &keys.members_key, &joiner.auth_id(), "   ")?;
    let roster = resolve_member_roster(&cleared, &keys.members_key)?;
    assert_eq!(
        roster
            .iter()
            .find(|member| member.auth_id == joiner.auth_id())
            .ok_or_else(|| std::io::Error::other("renamed member must exist"))?
            .label,
        None
    );
    Ok(())
}

#[test]
fn revoke_vault_member_removes_auth_and_member_rows_but_not_user_secrets() -> anyhow::Result<()> {
    let keys = generate_vault_keys()?;
    let (genesis, mut records) = genesis_vault(&keys)?;
    let joiner = DeviceIdentity::generate()?;
    let user_secret = user_secret_record("secret_note001", "encrypted-user-secret");
    records.push(create_join_request_record(&joiner, ENROLLED_AT)?);
    records.push(user_secret.clone());
    approve_pending_join(&keys, &genesis, &mut records, &joiner)?;
    records.extend(create_sentinel_share_records(
        &keys,
        &[genesis.clone(), joiner.clone()],
        2,
    )?);

    let revoked = revoke_vault_member(&records, &keys.members_key, &joiner.auth_id())?;

    assert!(resolve_secrets_key(&revoked, &joiner).is_err());
    assert_eq!(resolve_secrets_key(&revoked, &genesis)?, keys.secrets_key);
    assert!(revoked.iter().any(|record| record == &user_secret));
    assert!(
        !revoked
            .iter()
            .any(|record| { record.key.as_str() == sentinel_share_record_key(joiner.device_id()) })
    );
    assert!(
        revoked.iter().any(|record| {
            record.key.as_str() == sentinel_share_record_key(genesis.device_id())
        })
    );
    let roster = resolve_member_roster(&revoked, &keys.members_key)?;
    assert_eq!(roster.len(), 1);
    assert_eq!(roster[0].auth_id, genesis.auth_id());
    Ok(())
}

#[test]
fn revoke_last_access_and_missing_member_are_errors() -> anyhow::Result<()> {
    let keys = generate_vault_keys()?;
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
    let keys = generate_vault_keys()?;
    let (genesis, records) = genesis_vault(&keys)?;
    let mut member_record = records
        .iter()
        .find(|record| is_members_stored_record(record))
        .ok_or_else(|| std::io::Error::other("member record must exist"))?
        .clone();
    let other_identity = DeviceIdentity::generate()?;
    member_record.key = SecretId::from_vault_record(&member_stored_key(&other_identity.auth_id()));

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

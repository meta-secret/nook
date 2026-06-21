//! Multi-device vault keys workflow integration tests.

use nook_core::{
    Database, DeviceIdentity, VaultCrypto, VaultFormat, VaultKeys, approve_join_request,
    create_join_request_record, deserialize_stored, enroll_device_with_keys, generate_vault_keys,
    genesis_auth_record, genesis_members_records, list_join_requests, replace_member_records,
    resolve_member_roster, resolve_members_key, resolve_secrets_key, serialize_stored,
    user_stored_records,
};

fn encrypt_user_secrets(db: &Database, crypto: &VaultCrypto) -> Vec<nook_core::StoredSecretRecord> {
    db.to_stored_records_with_crypto(crypto).unwrap()
}

fn genesis_vault(keys: &VaultKeys) -> (DeviceIdentity, Vec<nook_core::StoredSecretRecord>) {
    let genesis = DeviceIdentity::generate().unwrap();
    let mut records =
        vec![genesis_auth_record(&genesis, &keys.secrets_key, &keys.members_key).unwrap()];
    records.extend(
        genesis_members_records(&genesis, &keys.members_key, "2026-06-21T00:00:00Z").unwrap(),
    );
    (genesis, records)
}

#[test]
fn three_device_join_flow_unlocks_shared_vault_and_roster() {
    let keys = generate_vault_keys().unwrap();
    let crypto = VaultCrypto::new(&keys.secrets_key).unwrap();

    let (genesis, mut records) = genesis_vault(&keys);

    let mut db = Database::new();
    db.insert("github.com".to_owned(), "hunter2".to_owned());
    records.extend(encrypt_user_secrets(&db, &crypto));

    let device_two = DeviceIdentity::generate().unwrap();
    records.push(create_join_request_record(&device_two, "2026-06-21T00:00:00Z").unwrap());
    let join_two = list_join_requests(&records).pop().unwrap();
    let (auth_two, join_key, member_records) = approve_join_request(
        &keys.secrets_key,
        &keys.members_key,
        &join_two,
        &genesis,
        &records,
    )
    .unwrap();
    records.retain(|record| record.key != join_key);
    records.push(auth_two);
    replace_member_records(&mut records, member_records);

    let device_three = DeviceIdentity::generate().unwrap();
    records.push(create_join_request_record(&device_three, "2026-06-21T01:00:00Z").unwrap());
    let join_three = list_join_requests(&records).pop().unwrap();
    let (auth_three, join_key, member_records) = approve_join_request(
        &keys.secrets_key,
        &keys.members_key,
        &join_three,
        &genesis,
        &records,
    )
    .unwrap();
    records.retain(|record| record.key != join_key);
    records.push(auth_three);
    replace_member_records(&mut records, member_records);

    let yaml = serialize_stored(&records, VaultFormat::Yaml).unwrap();
    assert!(yaml.contains("auth:"));
    assert!(yaml.contains("members:"));
    assert!(yaml.contains("pk_id:"));
    assert!(yaml.contains("secrets_key:"));
    assert!(yaml.contains("members_key:"));
    assert!(yaml.contains("ciphertext:"));
    assert!(yaml.contains("secrets:"));
    assert!(!yaml.contains("age1"));

    let loaded = deserialize_stored(&yaml, VaultFormat::Yaml).unwrap();

    for device in [&genesis, &device_two, &device_three] {
        let resolved_secrets = resolve_secrets_key(&loaded, device).unwrap();
        let resolved_members = resolve_members_key(&loaded, device).unwrap();
        assert_eq!(resolved_secrets, keys.secrets_key);
        assert_eq!(resolved_members, keys.members_key);
        let roster = resolve_member_roster(&loaded, &keys.members_key).unwrap();
        assert_eq!(roster.len(), 3);
        let user_records = user_stored_records(&loaded);
        let unlocked = Database::from_stored_records_with_crypto(&user_records, &crypto).unwrap();
        assert_eq!(unlocked.list().len(), 1);
        assert_eq!(unlocked.list()[0].value, "hunter2");
    }
}

#[test]
fn vault_without_auth_envelope_fails_to_resolve_secrets_key() {
    let crypto = VaultCrypto::new(&generate_vault_keys().unwrap().secrets_key).unwrap();
    let mut db = Database::new();
    db.insert("site".to_owned(), "secret".to_owned());
    let records = encrypt_user_secrets(&db, &crypto);

    let device = DeviceIdentity::generate().unwrap();
    assert!(resolve_secrets_key(&records, &device).is_err());
}

#[test]
fn oob_enroll_writes_self_member_roster_only() {
    let keys = generate_vault_keys().unwrap();
    let device = DeviceIdentity::generate().unwrap();
    let (auth, members) = enroll_device_with_keys(
        &keys.secrets_key,
        &keys.members_key,
        &device,
        "2026-06-21T02:00:00Z",
    )
    .unwrap();
    let mut records = vec![auth];
    records.extend(members);
    let roster = resolve_member_roster(&records, &keys.members_key).unwrap();
    assert_eq!(roster.len(), 1);
    assert_eq!(roster[0].device_id, device.device_id().to_owned());
}

#[test]
fn yaml_roundtrip_preserves_secrets_and_members_key_resolution() {
    let keys = generate_vault_keys().unwrap();
    let (genesis, records) = genesis_vault(&keys);

    let yaml = serialize_stored(&records, VaultFormat::Yaml).unwrap();
    let loaded = deserialize_stored(&yaml, VaultFormat::Yaml).unwrap();

    assert_eq!(
        resolve_secrets_key(&loaded, &genesis).unwrap(),
        keys.secrets_key
    );
    assert_eq!(
        resolve_members_key(&loaded, &genesis).unwrap(),
        keys.members_key
    );
}

#[test]
fn resolve_members_key_fails_without_auth_envelope() {
    let device = DeviceIdentity::generate().unwrap();
    assert!(resolve_members_key(&[], &device).is_err());
}

#[test]
fn member_roster_entries_expose_pk_id_and_public_key() {
    let keys = generate_vault_keys().unwrap();
    let device = DeviceIdentity::generate().unwrap();
    let (auth, members) = enroll_device_with_keys(
        &keys.secrets_key,
        &keys.members_key,
        &device,
        "2026-06-21T03:00:00Z",
    )
    .unwrap();
    let mut records = vec![auth];
    records.extend(members);

    let roster = resolve_member_roster(&records, &keys.members_key).unwrap();
    assert_eq!(roster.len(), 1);
    assert_eq!(roster[0].auth_id, device.auth_id());
    assert_eq!(roster[0].public_key, device.public_key());
    assert_eq!(roster[0].device_id, device.device_id().to_owned());
}

#[test]
fn approve_join_writes_distinct_secrets_and_members_envelopes() {
    let keys = generate_vault_keys().unwrap();
    let (genesis, mut records) = genesis_vault(&keys);
    let joiner = DeviceIdentity::generate().unwrap();
    records.push(create_join_request_record(&joiner, "2026-06-21T04:00:00Z").unwrap());
    let join = list_join_requests(&records).pop().unwrap();

    let (auth, join_key, _) = approve_join_request(
        &keys.secrets_key,
        &keys.members_key,
        &join,
        &genesis,
        &records,
    )
    .unwrap();
    records.retain(|r| r.key != join_key);
    records.push(auth.clone());

    let env = nook_core::parse_auth_envelopes(&auth.value).unwrap();
    assert_ne!(env.secrets_key, env.members_key);
    assert_eq!(
        joiner.decrypt_envelope(&env.secrets_key).unwrap(),
        keys.secrets_key
    );
    assert_eq!(
        joiner.decrypt_envelope(&env.members_key).unwrap(),
        keys.members_key
    );
}

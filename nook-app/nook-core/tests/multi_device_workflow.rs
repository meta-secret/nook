//! Multi-device vault keys workflow integration tests.

use nook_core::{
    ApiKeySecret, Database, DeviceIdentity, SecretId, SecretValue, VaultCrypto, VaultFormat,
    VaultKeys, approve_join_request, create_join_request_record, deserialize_stored,
    enroll_device_with_keys, generate_vault_keys, genesis_auth_record, genesis_members_records,
    list_join_requests, rename_vault_member, replace_member_records, resolve_member_roster,
    resolve_members_key, resolve_secrets_key, revoke_vault_member, serialize_stored,
    user_stored_records,
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

fn encrypt_user_secrets(db: &Database, crypto: &VaultCrypto) -> Vec<nook_core::StoredSecretRecord> {
    db.to_stored_records_with_crypto(crypto)
        .expect("multi device workflow test setup should succeed")
}

fn genesis_vault(keys: &VaultKeys) -> (DeviceIdentity, Vec<nook_core::StoredSecretRecord>) {
    let genesis =
        DeviceIdentity::generate().expect("multi device workflow test setup should succeed");
    let mut records = vec![
        genesis_auth_record(&genesis, &keys.secrets_key, &keys.members_key)
            .expect("multi device workflow test setup should succeed"),
    ];
    records.extend(
        genesis_members_records(&genesis, &keys.members_key, "2026-06-21T00:00:00Z")
            .expect("multi device workflow test setup should succeed"),
    );
    (genesis, records)
}

#[test]
fn three_device_join_flow_unlocks_shared_vault_and_roster() {
    let keys = generate_vault_keys().expect("multi device workflow test setup should succeed");
    let crypto = VaultCrypto::new(&keys.secrets_key)
        .expect("multi device workflow test setup should succeed");

    let (genesis, mut records) = genesis_vault(&keys);

    let mut db = Database::new();
    db.insert(sid("github.com"), api_key("hunter2"));
    records.extend(encrypt_user_secrets(&db, &crypto));

    let device_two =
        DeviceIdentity::generate().expect("multi device workflow test setup should succeed");
    records.push(
        create_join_request_record(&device_two, "2026-06-21T00:00:00Z")
            .expect("multi device workflow test setup should succeed"),
    );
    let join_two = list_join_requests(&records)
        .pop()
        .expect("multi device workflow test setup should succeed");
    let (auth_two, join_key, member_records) = approve_join_request(
        &keys.secrets_key,
        &keys.members_key,
        &join_two,
        &genesis,
        &records,
    )
    .expect("multi device workflow test setup should succeed");
    records.retain(|record| record.key.as_str() != join_key);
    records.push(auth_two);
    replace_member_records(&mut records, member_records);

    let device_three =
        DeviceIdentity::generate().expect("multi device workflow test setup should succeed");
    records.push(
        create_join_request_record(&device_three, "2026-06-21T01:00:00Z")
            .expect("multi device workflow test setup should succeed"),
    );
    let join_three = list_join_requests(&records)
        .pop()
        .expect("multi device workflow test setup should succeed");
    let (auth_three, join_key, member_records) = approve_join_request(
        &keys.secrets_key,
        &keys.members_key,
        &join_three,
        &genesis,
        &records,
    )
    .expect("multi device workflow test setup should succeed");
    records.retain(|record| record.key.as_str() != join_key);
    records.push(auth_three);
    replace_member_records(&mut records, member_records);

    let yaml = serialize_stored(&records, VaultFormat::Yaml)
        .expect("multi device workflow test setup should succeed");
    let yaml_str = yaml.as_str();
    assert!(yaml_str.contains("auth:"));
    assert!(yaml_str.contains("members:"));
    assert!(yaml_str.contains("pk_id:"));
    assert!(yaml_str.contains("secrets_key:"));
    assert!(yaml_str.contains("members_key:"));
    assert!(yaml_str.contains("ciphertext:"));
    assert!(yaml_str.contains("secrets:"));
    assert!(!yaml_str.contains("age1"));

    let loaded = deserialize_stored(yaml_str, VaultFormat::Yaml)
        .expect("multi device workflow test setup should succeed");

    for device in [&genesis, &device_two, &device_three] {
        let resolved_secrets = resolve_secrets_key(&loaded, device)
            .expect("multi device workflow test setup should succeed");
        let resolved_members = resolve_members_key(&loaded, device)
            .expect("multi device workflow test setup should succeed");
        assert_eq!(resolved_secrets, keys.secrets_key);
        assert_eq!(resolved_members, keys.members_key);
        let roster = resolve_member_roster(&loaded, &keys.members_key)
            .expect("multi device workflow test setup should succeed");
        assert_eq!(roster.len(), 3);
        let user_records = user_stored_records(&loaded);
        let unlocked = Database::from_stored_records_with_crypto(&user_records, &crypto)
            .expect("multi device workflow test setup should succeed");
        assert_eq!(unlocked.list().len(), 1);
        assert_eq!(unlocked.list()[0].data, api_key("hunter2"));
    }
}

#[test]
fn vault_without_auth_envelope_fails_to_resolve_secrets_key() {
    let crypto = VaultCrypto::new(
        &generate_vault_keys()
            .expect("multi device workflow test setup should succeed")
            .secrets_key,
    )
    .expect("multi device workflow test setup should succeed");
    let mut db = Database::new();
    db.insert(sid("site"), api_key("secret"));
    let records = encrypt_user_secrets(&db, &crypto);

    let device =
        DeviceIdentity::generate().expect("multi device workflow test setup should succeed");
    assert!(resolve_secrets_key(&records, &device).is_err());
}

#[test]
fn oob_enroll_writes_self_member_roster_only() {
    let keys = generate_vault_keys().expect("multi device workflow test setup should succeed");
    let device =
        DeviceIdentity::generate().expect("multi device workflow test setup should succeed");
    let (auth, members) = enroll_device_with_keys(
        &keys.secrets_key,
        &keys.members_key,
        &device,
        "2026-06-21T02:00:00Z",
    )
    .expect("multi device workflow test setup should succeed");
    let mut records = vec![auth];
    records.extend(members);
    let roster = resolve_member_roster(&records, &keys.members_key)
        .expect("multi device workflow test setup should succeed");
    assert_eq!(roster.len(), 1);
    assert_eq!(roster[0].device_id, device.device_id().to_owned());
}

#[test]
fn yaml_roundtrip_preserves_secrets_and_members_key_resolution() {
    let keys = generate_vault_keys().expect("multi device workflow test setup should succeed");
    let (genesis, records) = genesis_vault(&keys);

    let yaml = serialize_stored(&records, VaultFormat::Yaml)
        .expect("multi device workflow test setup should succeed");
    let loaded = deserialize_stored(yaml.as_str(), VaultFormat::Yaml)
        .expect("multi device workflow test setup should succeed");

    assert_eq!(
        resolve_secrets_key(&loaded, &genesis)
            .expect("multi device workflow test setup should succeed"),
        keys.secrets_key
    );
    assert_eq!(
        resolve_members_key(&loaded, &genesis)
            .expect("multi device workflow test setup should succeed"),
        keys.members_key
    );
}

#[test]
fn resolve_members_key_fails_without_auth_envelope() {
    let device =
        DeviceIdentity::generate().expect("multi device workflow test setup should succeed");
    assert!(resolve_members_key(&[], &device).is_err());
}

#[test]
fn member_roster_entries_expose_pk_id_and_public_key() {
    let keys = generate_vault_keys().expect("multi device workflow test setup should succeed");
    let device =
        DeviceIdentity::generate().expect("multi device workflow test setup should succeed");
    let (auth, members) = enroll_device_with_keys(
        &keys.secrets_key,
        &keys.members_key,
        &device,
        "2026-06-21T03:00:00Z",
    )
    .expect("multi device workflow test setup should succeed");
    let mut records = vec![auth];
    records.extend(members);

    let roster = resolve_member_roster(&records, &keys.members_key)
        .expect("multi device workflow test setup should succeed");
    assert_eq!(roster.len(), 1);
    assert_eq!(roster[0].auth_id, device.auth_id());
    assert_eq!(roster[0].public_key, device.public_key());
    assert_eq!(roster[0].device_id, device.device_id().to_owned());
}

#[test]
fn approve_join_writes_distinct_secrets_and_members_envelopes() {
    let keys = generate_vault_keys().expect("multi device workflow test setup should succeed");
    let (genesis, mut records) = genesis_vault(&keys);
    let joiner =
        DeviceIdentity::generate().expect("multi device workflow test setup should succeed");
    records.push(
        create_join_request_record(&joiner, "2026-06-21T04:00:00Z")
            .expect("multi device workflow test setup should succeed"),
    );
    let join = list_join_requests(&records)
        .pop()
        .expect("multi device workflow test setup should succeed");

    let (auth, join_key, _) = approve_join_request(
        &keys.secrets_key,
        &keys.members_key,
        &join,
        &genesis,
        &records,
    )
    .expect("multi device workflow test setup should succeed");
    records.retain(|r| r.key.as_str() != join_key);
    records.push(auth.clone());

    let env = nook_core::parse_auth_envelopes(auth.value.as_str())
        .expect("multi device workflow test setup should succeed");
    assert_ne!(env.secrets_key, env.members_key);
    assert_eq!(
        joiner
            .decrypt_envelope(&env.secrets_key)
            .expect("multi device workflow test setup should succeed"),
        keys.secrets_key
    );
    assert_eq!(
        joiner
            .decrypt_envelope(&env.members_key)
            .expect("multi device workflow test setup should succeed"),
        keys.members_key
    );
}

#[test]
fn rename_member_label_survives_yaml_roundtrip() {
    let keys = generate_vault_keys().expect("multi device workflow test setup should succeed");
    let (device, mut records) = genesis_vault(&keys);
    let member_records = rename_vault_member(
        &records,
        &keys.members_key,
        &device.auth_id(),
        "Kitchen iPad",
    )
    .expect("multi device workflow test setup should succeed");
    replace_member_records(&mut records, member_records);

    let yaml = serialize_stored(&records, VaultFormat::Yaml)
        .expect("multi device workflow test setup should succeed");
    assert!(!yaml.as_str().contains("Kitchen iPad"));
    let loaded = deserialize_stored(yaml.as_str(), VaultFormat::Yaml)
        .expect("multi device workflow test setup should succeed");
    let roster = resolve_member_roster(&loaded, &keys.members_key)
        .expect("multi device workflow test setup should succeed");
    assert_eq!(roster.len(), 1);
    assert_eq!(roster[0].label.as_deref(), Some("Kitchen iPad"));
}

#[test]
fn revoked_device_cannot_resolve_keys_after_yaml_roundtrip() {
    let keys = generate_vault_keys().expect("multi device workflow test setup should succeed");
    let (genesis, mut records) = genesis_vault(&keys);
    let joiner =
        DeviceIdentity::generate().expect("multi device workflow test setup should succeed");
    records.push(
        create_join_request_record(&joiner, "2026-06-21T04:00:00Z")
            .expect("multi device workflow test setup should succeed"),
    );
    let join = list_join_requests(&records)
        .pop()
        .expect("multi device workflow test setup should succeed");

    let (auth, join_key, member_records) = approve_join_request(
        &keys.secrets_key,
        &keys.members_key,
        &join,
        &genesis,
        &records,
    )
    .expect("multi device workflow test setup should succeed");
    records.retain(|r| r.key.as_str() != join_key);
    records.push(auth);
    replace_member_records(&mut records, member_records);

    let revoked = revoke_vault_member(&records, &keys.members_key, &joiner.auth_id())
        .expect("multi device workflow test setup should succeed");
    let yaml = serialize_stored(&revoked, VaultFormat::Yaml)
        .expect("multi device workflow test setup should succeed");
    let loaded = deserialize_stored(yaml.as_str(), VaultFormat::Yaml)
        .expect("multi device workflow test setup should succeed");

    assert!(resolve_secrets_key(&loaded, &joiner).is_err());
    assert_eq!(
        resolve_secrets_key(&loaded, &genesis)
            .expect("multi device workflow test setup should succeed"),
        keys.secrets_key
    );
    let roster = resolve_member_roster(&loaded, &keys.members_key)
        .expect("multi device workflow test setup should succeed");
    assert_eq!(roster.len(), 1);
    assert_eq!(roster[0].auth_id, genesis.auth_id());
}

//! End-to-end vault workflows mirroring the WASM session save path.

use nook_core::{
    ApiKeySecret, Database, PasswordOptions, ReplaceSecretInput, SecretId, SecretType, SecretValue,
    StoredRecordPayload, SymmetricKey, VaultCrypto, VaultFormat, VaultMetaState,
    deserialize_stored, filter_secrets, generate_password, replace_secret, serialize_stored,
    validate_connect, validate_secret_data, validate_secret_id,
};
use std::collections::HashMap;

const TEST_PASSPHRASE: &str = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

fn sid(label: &str) -> SecretId {
    SecretId::parse(label).unwrap_or_else(|_| SecretId::from_vault_record(label))
}

fn api_key(value: &str) -> SecretValue {
    SecretValue::ApiKey(ApiKeySecret {
        website_url: "https://example.com".to_owned(),
        key: value.to_owned(),
        expires_at: String::new(),
    })
}

fn test_key() -> SymmetricKey {
    SymmetricKey::parse(TEST_PASSPHRASE).unwrap()
}

fn encrypted_api_key(crypto: &VaultCrypto, value: &str) -> String {
    crypto
        .encrypt_value(api_key(value).to_yaml().unwrap().as_str())
        .unwrap()
        .as_str()
        .to_owned()
}

fn api_key_yaml(value: &str) -> String {
    api_key(value).to_yaml().unwrap().as_str().to_owned()
}

fn sample_db() -> Database {
    let mut db = Database::new();
    db.insert(sid("github.com"), api_key("hunter2"));
    db.insert(sid("work-vpn"), api_key("token-abc"));
    db
}

fn armored_cache_from_db(db: &Database, crypto: &VaultCrypto) -> HashMap<SecretId, String> {
    db.to_stored_records_with_crypto(crypto)
        .unwrap()
        .into_iter()
        .map(|record| (record.key, record.value.as_str().to_owned()))
        .collect()
}

fn save_armored_cache(armored: &HashMap<SecretId, String>) -> String {
    let secret_types = armored
        .keys()
        .map(|key| (key.clone(), SecretType::ApiKey))
        .collect();
    let records = Database::stored_records_from_armored(armored, &secret_types);
    serialize_stored(&records, VaultFormat::Yaml)
        .unwrap()
        .as_str()
        .to_owned()
}

fn load_vault(yaml: &str, crypto: &VaultCrypto) -> (Database, HashMap<SecretId, String>) {
    let records = deserialize_stored(yaml, VaultFormat::Yaml).unwrap();
    let mut armored = HashMap::with_capacity(records.len());
    for record in &records {
        armored.insert(record.key.clone(), record.value.as_str().to_owned());
    }
    let db = Database::from_stored_records_with_crypto(&records, crypto).unwrap();
    (db, armored)
}

#[test]
fn incremental_add_secret_matches_full_reencrypt() {
    let crypto = VaultCrypto::new(&test_key()).unwrap();
    let db = sample_db();
    let mut armored = armored_cache_from_db(&db, &crypto);

    let label = validate_secret_id("  api.example.com  ").unwrap();
    validate_secret_data("generated-secret").unwrap();
    armored.insert(
        label.clone(),
        encrypted_api_key(&crypto, "generated-secret"),
    );

    let yaml = save_armored_cache(&armored);
    let (restored, reloaded_armored) = load_vault(&yaml, &crypto);

    assert_eq!(restored.list().len(), 3);
    assert_eq!(
        restored.list().iter().find(|r| r.id == label).unwrap().data,
        api_key("generated-secret")
    );
    assert_eq!(armored.len(), reloaded_armored.len());
}

#[test]
fn incremental_delete_secret() {
    let crypto = VaultCrypto::new(&test_key()).unwrap();
    let mut armored = armored_cache_from_db(&sample_db(), &crypto);

    armored.remove(&sid("work-vpn"));
    let yaml = save_armored_cache(&armored);
    let (restored, _) = load_vault(&yaml, &crypto);

    assert_eq!(restored.list().len(), 1);
    assert_eq!(restored.list()[0].id.as_str(), "github.com");
}

#[test]
fn incremental_replace_secret_swaps_id_and_updates_armored_cache() {
    let crypto = VaultCrypto::new(&test_key()).unwrap();
    let mut db = Database::new();
    let mut state = VaultMetaState::default();

    let old_id = "github.com";
    let old_yaml = api_key_yaml("hunter2");
    db.insert(sid(old_id), api_key("hunter2"));
    state.secrets.insert(
        sid(old_id),
        (
            SecretType::ApiKey,
            StoredRecordPayload::from_trusted(
                crypto.encrypt_value(&old_yaml).unwrap().as_str().to_owned(),
            ),
        ),
    );

    let new_id = "github-updated.com";
    let new_yaml = api_key_yaml("new-token");
    replace_secret(
        &mut db,
        &mut state,
        &crypto,
        &ReplaceSecretInput {
            old_id,
            new_id,
            secret_type: SecretType::ApiKey,
            data_yaml: &new_yaml,
        },
    )
    .unwrap();

    assert_eq!(db.list().len(), 1);
    assert_eq!(db.list()[0].id.as_str(), new_id);
    assert_eq!(db.list()[0].data, api_key("new-token"));

    assert!(!state.secrets.contains_key(&sid(old_id)));
    assert!(state.secrets.contains_key(&sid(new_id)));
    assert_eq!(
        state.secrets.get(&sid(new_id)).map(|(t, _)| *t),
        Some(SecretType::ApiKey)
    );

    let decrypted = crypto
        .decrypt_value(&nook_core::AgeArmoredCiphertext::from_trusted_armored(
            state
                .secrets
                .get(&sid(new_id))
                .unwrap()
                .1
                .as_str()
                .to_owned(),
        ))
        .unwrap();
    assert_eq!(decrypted.as_str(), new_yaml);
}

#[test]
fn incremental_replace_secret_rejects_missing_old_id() {
    let crypto = VaultCrypto::new(&test_key()).unwrap();
    let mut db = Database::new();
    let mut state = VaultMetaState::default();

    let err = replace_secret(
        &mut db,
        &mut state,
        &crypto,
        &ReplaceSecretInput {
            old_id: "missing",
            new_id: "new-id",
            secret_type: SecretType::ApiKey,
            data_yaml: &api_key_yaml("value"),
        },
    )
    .unwrap_err();
    assert!(err.to_string().contains("not found"));
}

#[test]
fn incremental_replace_secret_rejects_duplicate_new_id() {
    let crypto = VaultCrypto::new(&test_key()).unwrap();
    let mut db = Database::new();
    let mut state = VaultMetaState::default();

    db.insert(sid("keep"), api_key("a"));
    db.insert(sid("replace-me"), api_key("b"));
    state.secrets.insert(
        sid("keep"),
        (
            SecretType::ApiKey,
            StoredRecordPayload::from_trusted(
                crypto
                    .encrypt_value(api_key_yaml("a"))
                    .unwrap()
                    .as_str()
                    .to_owned(),
            ),
        ),
    );
    state.secrets.insert(
        sid("replace-me"),
        (
            SecretType::ApiKey,
            StoredRecordPayload::from_trusted(
                crypto
                    .encrypt_value(api_key_yaml("b"))
                    .unwrap()
                    .as_str()
                    .to_owned(),
            ),
        ),
    );

    let err = replace_secret(
        &mut db,
        &mut state,
        &crypto,
        &ReplaceSecretInput {
            old_id: "replace-me",
            new_id: "keep",
            secret_type: SecretType::ApiKey,
            data_yaml: &api_key_yaml("c"),
        },
    )
    .unwrap_err();
    assert!(err.to_string().contains("already exists"));
}

#[test]
fn incremental_update_secret_replaces_armored_entry() {
    let crypto = VaultCrypto::new(&test_key()).unwrap();
    let mut armored = armored_cache_from_db(&sample_db(), &crypto);
    let old = armored.get(&sid("github.com")).unwrap().clone();

    armored.insert(
        sid("github.com"),
        encrypted_api_key(&crypto, "new-password"),
    );
    assert_ne!(armored.get(&sid("github.com")).unwrap(), &old);

    let yaml = save_armored_cache(&armored);
    let (restored, _) = load_vault(&yaml, &crypto);
    assert_eq!(
        restored
            .list()
            .iter()
            .find(|r| r.id.as_str() == "github.com")
            .unwrap()
            .data,
        api_key("new-password")
    );
}

#[test]
fn generated_password_can_be_stored_and_reloaded() {
    let crypto = VaultCrypto::new(&test_key()).unwrap();
    let password = generate_password(&PasswordOptions {
        length: 20,
        lowercase: true,
        uppercase: true,
        numbers: true,
        symbols: true,
    })
    .unwrap();

    let mut armored = HashMap::new();
    armored.insert(sid("generated"), encrypted_api_key(&crypto, &password));

    let yaml = save_armored_cache(&armored);
    let (restored, _) = load_vault(&yaml, &crypto);
    assert_eq!(restored.list()[0].data, api_key(&password));
}

#[test]
fn connect_validation_matches_ui_rules() {
    assert!(validate_connect("dropbox", "token").is_err());
    assert_eq!(validate_connect("local", "ignored").unwrap(), None);
    assert_eq!(
        validate_connect("github", "  ghp_abc  ")
            .unwrap()
            .unwrap()
            .as_str(),
        "ghp_abc"
    );
}

#[test]
fn filter_secrets_on_loaded_vault() {
    let crypto = VaultCrypto::new(&test_key()).unwrap();
    let yaml = save_armored_cache(&armored_cache_from_db(&sample_db(), &crypto));
    let (db, _) = load_vault(&yaml, &crypto);
    let records = db.list();

    assert_eq!(filter_secrets(&records, "hub").len(), 1);
    assert_eq!(filter_secrets(&records, "vpn").len(), 1);
    assert!(filter_secrets(&records, "missing").is_empty());
    assert_eq!(filter_secrets(&records, ""), records);
}

#[test]
fn yaml_vault_survives_add_delete_add_cycle() {
    let crypto = VaultCrypto::new(&test_key()).unwrap();
    let mut armored = armored_cache_from_db(&sample_db(), &crypto);

    armored.remove(&sid("work-vpn"));
    armored.insert(sid("staging"), encrypted_api_key(&crypto, "stage-pass"));
    let mid = save_armored_cache(&armored);
    let (mid_db, mut mid_armored) = load_vault(&mid, &crypto);
    assert_eq!(mid_db.list().len(), 2);

    mid_armored.remove(&sid("staging"));
    mid_armored.insert(sid("prod"), encrypted_api_key(&crypto, "prod-pass"));
    let final_yaml = save_armored_cache(&mid_armored);
    let (final_db, _) = load_vault(&final_yaml, &crypto);

    let records = final_db.list();
    let keys: Vec<&str> = records.iter().map(|r| r.id.as_str()).collect();
    assert_eq!(keys, vec!["github.com", "prod"]);
}

#[test]
fn stored_records_from_armored_matches_serialize_order() {
    let crypto = VaultCrypto::new(&test_key()).unwrap();
    let armored = armored_cache_from_db(&sample_db(), &crypto);
    let secret_types = armored
        .keys()
        .map(|key| (key.clone(), SecretType::ApiKey))
        .collect();
    let records = Database::stored_records_from_armored(&armored, &secret_types);

    assert_eq!(records[0].key.as_str(), "github.com");
    assert_eq!(records[1].key.as_str(), "work-vpn");
    assert!(
        records[0]
            .value
            .as_str()
            .contains("BEGIN AGE ENCRYPTED FILE")
    );
}

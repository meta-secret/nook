//! End-to-end vault workflows mirroring the WASM session save path.

use nook_core::{
    Database, PasswordOptions, VaultCrypto, VaultFormat, deserialize_stored, filter_secrets,
    generate_password, serialize_stored, validate_connect, validate_secret_label,
    validate_secret_value,
};
use std::collections::HashMap;

const TEST_PASSPHRASE: &str = "deadbeefdeadbeefdeadbeefdeadbeef";

fn sample_db() -> Database {
    let mut db = Database::new();
    db.insert("github.com".to_owned(), "hunter2".to_owned());
    db.insert("work-vpn".to_owned(), "token-abc".to_owned());
    db
}

fn armored_cache_from_db(db: &Database, crypto: &VaultCrypto) -> HashMap<String, String> {
    db.to_stored_records_with_crypto(crypto)
        .unwrap()
        .into_iter()
        .map(|record| (record.key, record.value))
        .collect()
}

fn save_armored_cache(armored: &HashMap<String, String>) -> String {
    let records = Database::stored_records_from_armored(armored);
    serialize_stored(&records, VaultFormat::Yaml).unwrap()
}

fn load_vault(yaml: &str, crypto: &VaultCrypto) -> (Database, HashMap<String, String>) {
    let records = deserialize_stored(yaml, VaultFormat::Yaml).unwrap();
    let mut armored = HashMap::with_capacity(records.len());
    for record in &records {
        armored.insert(record.key.clone(), record.value.clone());
    }
    let db = Database::from_stored_records_with_crypto(&records, crypto).unwrap();
    (db, armored)
}

#[test]
fn incremental_add_secret_matches_full_reencrypt() {
    let crypto = VaultCrypto::new(TEST_PASSPHRASE).unwrap();
    let db = sample_db();
    let mut armored = armored_cache_from_db(&db, &crypto);

    let label = validate_secret_label("  api.example.com  ").unwrap();
    validate_secret_value("generated-secret").unwrap();
    armored.insert(
        label.clone(),
        crypto.encrypt_value("generated-secret").unwrap(),
    );

    let yaml = save_armored_cache(&armored);
    let (restored, reloaded_armored) = load_vault(&yaml, &crypto);

    assert_eq!(restored.list().len(), 3);
    assert_eq!(
        restored
            .list()
            .iter()
            .find(|r| r.key == "api.example.com")
            .unwrap()
            .value,
        "generated-secret"
    );
    assert_eq!(armored.len(), reloaded_armored.len());
}

#[test]
fn incremental_delete_secret() {
    let crypto = VaultCrypto::new(TEST_PASSPHRASE).unwrap();
    let mut armored = armored_cache_from_db(&sample_db(), &crypto);

    armored.remove("work-vpn");
    let yaml = save_armored_cache(&armored);
    let (restored, _) = load_vault(&yaml, &crypto);

    assert_eq!(restored.list().len(), 1);
    assert_eq!(restored.list()[0].key, "github.com");
}

#[test]
fn incremental_update_secret_replaces_armored_entry() {
    let crypto = VaultCrypto::new(TEST_PASSPHRASE).unwrap();
    let mut armored = armored_cache_from_db(&sample_db(), &crypto);
    let old = armored.get("github.com").unwrap().clone();

    armored.insert(
        "github.com".to_owned(),
        crypto.encrypt_value("new-password").unwrap(),
    );
    assert_ne!(armored.get("github.com").unwrap(), &old);

    let yaml = save_armored_cache(&armored);
    let (restored, _) = load_vault(&yaml, &crypto);
    assert_eq!(
        restored
            .list()
            .iter()
            .find(|r| r.key == "github.com")
            .unwrap()
            .value,
        "new-password"
    );
}

#[test]
fn generated_password_can_be_stored_and_reloaded() {
    let crypto = VaultCrypto::new(TEST_PASSPHRASE).unwrap();
    let password = generate_password(&PasswordOptions {
        length: 20,
        lowercase: true,
        uppercase: true,
        numbers: true,
        symbols: true,
    })
    .unwrap();

    let mut armored = HashMap::new();
    armored.insert(
        "generated".to_owned(),
        crypto.encrypt_value(&password).unwrap(),
    );

    let yaml = save_armored_cache(&armored);
    let (restored, _) = load_vault(&yaml, &crypto);
    assert_eq!(restored.list()[0].value, password);
}

#[test]
fn connect_validation_matches_ui_rules() {
    assert!(validate_connect("dropbox", "token").is_err());
    assert_eq!(validate_connect("local", "ignored").unwrap(), None);
    assert_eq!(
        validate_connect("github", "  ghp_abc  ").unwrap(),
        Some("ghp_abc".to_owned())
    );
}

#[test]
fn filter_secrets_on_loaded_vault() {
    let crypto = VaultCrypto::new(TEST_PASSPHRASE).unwrap();
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
    let crypto = VaultCrypto::new(TEST_PASSPHRASE).unwrap();
    let mut armored = armored_cache_from_db(&sample_db(), &crypto);

    armored.remove("work-vpn");
    armored.insert(
        "staging".to_owned(),
        crypto.encrypt_value("stage-pass").unwrap(),
    );
    let mid = save_armored_cache(&armored);
    let (mid_db, mut mid_armored) = load_vault(&mid, &crypto);
    assert_eq!(mid_db.list().len(), 2);

    mid_armored.remove("staging");
    mid_armored.insert(
        "prod".to_owned(),
        crypto.encrypt_value("prod-pass").unwrap(),
    );
    let final_yaml = save_armored_cache(&mid_armored);
    let (final_db, _) = load_vault(&final_yaml, &crypto);

    let records = final_db.list();
    let keys: Vec<&str> = records.iter().map(|r| r.key.as_str()).collect();
    assert_eq!(keys, vec!["github.com", "prod"]);
}

#[test]
fn stored_records_from_armored_matches_serialize_order() {
    let crypto = VaultCrypto::new(TEST_PASSPHRASE).unwrap();
    let armored = armored_cache_from_db(&sample_db(), &crypto);
    let records = Database::stored_records_from_armored(&armored);

    assert_eq!(records[0].key, "github.com");
    assert_eq!(records[1].key, "work-vpn");
    assert!(records[0].value.contains("BEGIN AGE ENCRYPTED FILE"));
}

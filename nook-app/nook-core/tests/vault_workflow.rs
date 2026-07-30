//! End-to-end vault workflows mirroring the WASM session save path.

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use nook_core::{
    ApiKeySecret, Database, PasskeyRegistrationRequest, PasskeyRelyingParty, PasskeyUser,
    PasswordOptions, ReplaceSecretInput, SecretId, SecretType, SecretValue, StoredRecordPayload,
    SymmetricKey, VaultCrypto, VaultFormat, VaultMetaState, deserialize_stored, filter_secrets,
    generate_password, replace_secret, serialize_stored, validate_connect, validate_secret_data,
    validate_secret_id,
};
use std::collections::HashMap;
use std::hash::{DefaultHasher, Hash, Hasher};

const TEST_PASSPHRASE: &str = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

fn sid(label: &str) -> SecretId {
    let mut hasher = DefaultHasher::new();
    label.hash(&mut hasher);
    let token = URL_SAFE_NO_PAD.encode(hasher.finish().to_be_bytes());
    SecretId::from_vault_record(&format!("secret_{token}"))
}

fn api_key(value: &str) -> SecretValue {
    SecretValue::ApiKey(ApiKeySecret {
        website_url: "https://example.com".to_owned(),
        key: value.to_owned(),
        expires_at: String::new(),
    })
}

fn test_key() -> anyhow::Result<SymmetricKey> {
    Ok(SymmetricKey::parse(TEST_PASSPHRASE)?)
}

fn encrypted_api_key(crypto: &VaultCrypto, value: &str) -> anyhow::Result<String> {
    Ok(crypto
        .encrypt_value(api_key(value).to_yaml()?.as_str())?
        .as_str()
        .to_owned())
}

fn api_key_yaml(value: &str) -> anyhow::Result<String> {
    Ok(api_key(value).to_yaml()?.as_str().to_owned())
}

fn sample_db() -> Database {
    let mut db = Database::new();
    db.insert(sid("github.com"), api_key("hunter2"));
    db.insert(sid("work-vpn"), api_key("token-abc"));
    db
}

fn passkey() -> anyhow::Result<SecretValue> {
    let request = PasskeyRegistrationRequest {
        origin: "https://login.example.com".to_owned(),
        challenge: URL_SAFE_NO_PAD.encode([1_u8; 32]),
        relying_party: PasskeyRelyingParty {
            id: "login.example.com".to_owned(),
            name: "Example".to_owned(),
        },
        user: PasskeyUser {
            id: URL_SAFE_NO_PAD.encode([2_u8; 32]),
            name: "alice@example.com".to_owned(),
            display_name: "Alice".to_owned(),
        },
        algorithms: vec![-7],
        exclude_credentials: Vec::new(),
        resident_key_required: true,
        user_verification_required: true,
    };
    let mut passkey = nook_core::create_website_passkey(&request, &[])?.credential;
    passkey.signature_count = 7;
    Ok(SecretValue::Passkey(passkey))
}

fn armored_cache_from_db(
    db: &Database,
    crypto: &VaultCrypto,
) -> anyhow::Result<HashMap<SecretId, String>> {
    Ok(db
        .to_stored_records_with_crypto(crypto)?
        .into_iter()
        .map(|record| (record.key, record.value.as_str().to_owned()))
        .collect())
}

fn save_armored_cache(armored: &HashMap<SecretId, String>) -> anyhow::Result<String> {
    let secret_types = armored
        .keys()
        .map(|key| (key.clone(), SecretType::ApiKey))
        .collect();
    let records = Database::stored_records_from_armored(armored, &secret_types);
    Ok(serialize_stored(&records, VaultFormat::Yaml)?
        .as_str()
        .to_owned())
}

fn load_vault(
    yaml: &str,
    crypto: &VaultCrypto,
) -> anyhow::Result<(Database, HashMap<SecretId, String>)> {
    let records = deserialize_stored(yaml, VaultFormat::Yaml)?;
    let mut armored = HashMap::with_capacity(records.len());
    for record in &records {
        armored.insert(record.key.clone(), record.value.as_str().to_owned());
    }
    let db = Database::from_stored_records_with_crypto(&records, crypto)?;
    Ok((db, armored))
}

#[test]
fn passkey_round_trips_through_encrypted_vault_storage() -> anyhow::Result<()> {
    let crypto = VaultCrypto::new(&test_key()?)?;
    let mut database = Database::new();
    let expected = passkey()?;
    database.insert(sid("passkey-example"), expected.clone());

    let stored = database.to_stored_records_with_crypto(&crypto)?;
    assert_eq!(stored[0].secret_type, Some(SecretType::Passkey));
    assert!(!stored[0].value.as_str().contains("alice@example.com"));
    assert!(!stored[0].value.as_str().contains("login.example.com"));

    let yaml = serialize_stored(&stored, VaultFormat::Yaml)?;
    let parsed = deserialize_stored(yaml.as_str(), VaultFormat::Yaml)?;
    let restored = Database::from_stored_records_with_crypto(&parsed, &crypto)?;

    assert_eq!(
        restored
            .list()
            .iter()
            .find(|record| record.id == sid("passkey-example"))
            .ok_or_else(|| std::io::Error::other("passkey record must exist"))?
            .data,
        expected
    );
    Ok(())
}

#[test]
fn incremental_add_secret_matches_full_reencrypt() -> anyhow::Result<()> {
    let crypto = VaultCrypto::new(&test_key()?)?;
    let db = sample_db();
    let mut armored = armored_cache_from_db(&db, &crypto)?;

    let label = validate_secret_id("  secret_SMypl8K0w9Y  ")?;
    validate_secret_data("generated-secret")?;
    armored.insert(
        label.clone(),
        encrypted_api_key(&crypto, "generated-secret")?,
    );

    let yaml = save_armored_cache(&armored)?;
    let (restored, reloaded_armored) = load_vault(&yaml, &crypto)?;

    assert_eq!(restored.list().len(), 3);
    assert_eq!(
        restored
            .list()
            .iter()
            .find(|r| r.id == label)
            .ok_or_else(|| std::io::Error::other("added record must exist"))?
            .data,
        api_key("generated-secret")
    );
    assert_eq!(armored.len(), reloaded_armored.len());
    Ok(())
}

#[test]
fn incremental_delete_secret() -> anyhow::Result<()> {
    let crypto = VaultCrypto::new(&test_key()?)?;
    let mut armored = armored_cache_from_db(&sample_db(), &crypto)?;

    armored.remove(&sid("work-vpn"));
    let yaml = save_armored_cache(&armored)?;
    let (restored, _) = load_vault(&yaml, &crypto)?;

    assert_eq!(restored.list().len(), 1);
    assert_eq!(restored.list()[0].id, sid("github.com"));
    Ok(())
}

#[test]
fn incremental_replace_secret_swaps_id_and_updates_armored_cache() -> anyhow::Result<()> {
    let crypto = VaultCrypto::new(&test_key()?)?;
    let mut db = Database::new();
    let mut state = VaultMetaState::default();

    let old_secret_id = sid("github.com");
    let old_id = old_secret_id.as_str().to_owned();
    let old_yaml = api_key_yaml("hunter2")?;
    db.insert(old_secret_id.clone(), api_key("hunter2"));
    state.secrets.insert(
        old_secret_id.clone(),
        (
            SecretType::ApiKey,
            StoredRecordPayload::from_trusted(crypto.encrypt_value(&old_yaml)?.as_str().to_owned()),
        ),
    );

    let new_secret_id = sid("github-updated.com");
    let new_id = new_secret_id.as_str().to_owned();
    let new_yaml = api_key_yaml("new-token")?;
    replace_secret(
        &mut db,
        &mut state,
        &crypto,
        &ReplaceSecretInput {
            old_id: &old_id,
            new_id: &new_id,
            secret_type: SecretType::ApiKey,
            data_yaml: &new_yaml,
        },
    )?;

    assert_eq!(db.list().len(), 1);
    assert_eq!(db.list()[0].id.as_str(), new_id);
    assert_eq!(db.list()[0].data, api_key("new-token"));

    assert!(!state.secrets.contains_key(&old_secret_id));
    assert!(state.secrets.contains_key(&new_secret_id));
    assert_eq!(
        state.secrets.get(&new_secret_id).map(|(t, _)| *t),
        Some(SecretType::ApiKey)
    );

    let decrypted =
        crypto.decrypt_value(&nook_core::AgeArmoredCiphertext::from_trusted_armored(
            state
                .secrets
                .get(&new_secret_id)
                .ok_or_else(|| std::io::Error::other("replacement secret must exist"))?
                .1
                .as_str()
                .to_owned(),
        ))?;
    assert_eq!(decrypted.as_str(), new_yaml);
    Ok(())
}

#[test]
fn incremental_replace_secret_rejects_missing_old_id() -> anyhow::Result<()> {
    let crypto = VaultCrypto::new(&test_key()?)?;
    let mut db = Database::new();
    let mut state = VaultMetaState::default();
    let missing_id = sid("missing").into_inner();
    let new_id = sid("new-id").into_inner();

    let err = replace_secret(
        &mut db,
        &mut state,
        &crypto,
        &ReplaceSecretInput {
            old_id: &missing_id,
            new_id: &new_id,
            secret_type: SecretType::ApiKey,
            data_yaml: &api_key_yaml("value")?,
        },
    )
    .err()
    .ok_or_else(|| anyhow::anyhow!("vault workflow test should reject invalid input"))?;
    assert!(err.to_string().contains("not found"));
    Ok(())
}

#[test]
fn incremental_replace_secret_rejects_duplicate_new_id() -> anyhow::Result<()> {
    let crypto = VaultCrypto::new(&test_key()?)?;
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
                    .encrypt_value(api_key_yaml("a")?)?
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
                    .encrypt_value(api_key_yaml("b")?)?
                    .as_str()
                    .to_owned(),
            ),
        ),
    );
    let replace_id = sid("replace-me").into_inner();
    let keep_id = sid("keep").into_inner();

    let err = replace_secret(
        &mut db,
        &mut state,
        &crypto,
        &ReplaceSecretInput {
            old_id: &replace_id,
            new_id: &keep_id,
            secret_type: SecretType::ApiKey,
            data_yaml: &api_key_yaml("c")?,
        },
    )
    .err()
    .ok_or_else(|| anyhow::anyhow!("vault workflow test should reject invalid input"))?;
    assert!(err.to_string().contains("already exists"));
    Ok(())
}

#[test]
fn incremental_update_secret_replaces_armored_entry() -> anyhow::Result<()> {
    let crypto = VaultCrypto::new(&test_key()?)?;
    let mut armored = armored_cache_from_db(&sample_db(), &crypto)?;
    let old = armored
        .get(&sid("github.com"))
        .ok_or_else(|| std::io::Error::other("GitHub fixture must exist"))?
        .clone();

    armored.insert(
        sid("github.com"),
        encrypted_api_key(&crypto, "new-password")?,
    );
    assert_ne!(
        armored
            .get(&sid("github.com"))
            .ok_or_else(|| std::io::Error::other("updated armor must exist"))?,
        &old
    );

    let yaml = save_armored_cache(&armored)?;
    let (restored, _) = load_vault(&yaml, &crypto)?;
    assert_eq!(
        restored
            .list()
            .iter()
            .find(|r| r.id == sid("github.com"))
            .ok_or_else(|| std::io::Error::other("updated record must exist"))?
            .data,
        api_key("new-password")
    );
    Ok(())
}

#[test]
fn generated_password_can_be_stored_and_reloaded() -> anyhow::Result<()> {
    let crypto = VaultCrypto::new(&test_key()?)?;
    let password = generate_password(&PasswordOptions {
        length: 20,
        lowercase: true,
        uppercase: true,
        numbers: true,
        symbols: true,
    })?;

    let mut armored = HashMap::new();
    armored.insert(sid("generated"), encrypted_api_key(&crypto, &password)?);

    let yaml = save_armored_cache(&armored)?;
    let (restored, _) = load_vault(&yaml, &crypto)?;
    assert_eq!(restored.list()[0].data, api_key(&password));
    Ok(())
}

#[test]
fn connect_validation_matches_ui_rules() -> anyhow::Result<()> {
    assert!(validate_connect("dropbox", "token").is_err());
    assert_eq!(validate_connect("local", "ignored")?, None);
    assert_eq!(
        validate_connect("github", "  ghp_abc  ")?
            .ok_or_else(|| std::io::Error::other("GitHub credential must be returned"))?
            .as_str(),
        "ghp_abc"
    );
    Ok(())
}

#[test]
fn filter_secrets_on_loaded_vault() -> anyhow::Result<()> {
    let crypto = VaultCrypto::new(&test_key()?)?;
    let yaml = save_armored_cache(&armored_cache_from_db(&sample_db(), &crypto)?)?;
    let (db, _) = load_vault(&yaml, &crypto)?;
    let records = db.list();

    assert_eq!(
        filter_secrets(&records, sid("github.com").as_str()).len(),
        1
    );
    assert_eq!(filter_secrets(&records, sid("work-vpn").as_str()).len(), 1);
    assert!(filter_secrets(&records, "missing").is_empty());
    assert_eq!(filter_secrets(&records, ""), records);
    Ok(())
}

#[test]
fn yaml_vault_survives_add_delete_add_cycle() -> anyhow::Result<()> {
    let crypto = VaultCrypto::new(&test_key()?)?;
    let mut armored = armored_cache_from_db(&sample_db(), &crypto)?;

    armored.remove(&sid("work-vpn"));
    armored.insert(sid("staging"), encrypted_api_key(&crypto, "stage-pass")?);
    let mid = save_armored_cache(&armored)?;
    let (mid_db, mut mid_armored) = load_vault(&mid, &crypto)?;
    assert_eq!(mid_db.list().len(), 2);

    mid_armored.remove(&sid("staging"));
    mid_armored.insert(sid("prod"), encrypted_api_key(&crypto, "prod-pass")?);
    let final_yaml = save_armored_cache(&mid_armored)?;
    let (final_db, _) = load_vault(&final_yaml, &crypto)?;

    let records = final_db.list();
    let keys: Vec<String> = records.iter().map(|r| r.id.as_str().to_owned()).collect();
    assert_eq!(
        keys,
        vec![sid("github.com").into_inner(), sid("prod").into_inner()]
    );
    Ok(())
}

#[test]
fn stored_records_from_armored_matches_serialize_order() -> anyhow::Result<()> {
    let crypto = VaultCrypto::new(&test_key()?)?;
    let armored = armored_cache_from_db(&sample_db(), &crypto)?;
    let secret_types = armored
        .keys()
        .map(|key| (key.clone(), SecretType::ApiKey))
        .collect();
    let records = Database::stored_records_from_armored(&armored, &secret_types);

    assert_eq!(records[0].key, sid("github.com"));
    assert_eq!(records[1].key, sid("work-vpn"));
    assert!(
        records[0]
            .value
            .as_str()
            .contains("BEGIN AGE ENCRYPTED FILE")
    );
    Ok(())
}

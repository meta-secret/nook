//! In-memory session: the plaintext `Database` and its (en|de)cryption paths.
//!
//! The `Database` is a sorted map of `(id → SecretRecord)`. It is the only
//! place where plaintext user secrets ever live in the wasm-side session.
//! All wire formats (JSONL and YAML) are entered and left exclusively
//! through this struct, so encryption boundaries stay localised.

use crate::SecretId;
use crate::errors::{DatabaseError, DatabaseResult};
use crate::multi_device;
use crate::secret_types::{
    SecretRecord, SecretType, SecretValue, StoredRecordPayload, StoredSecretRecord,
};
use crate::vault_crypto::VaultCrypto;
use crate::vault_format::{self, VaultFormat};
use crate::vault_wire::{
    SessionJsonl, StoredVaultBlob, StoredVaultJsonl, StoredVaultYaml, SymmetricKey,
};
use std::collections::HashMap;

#[derive(Debug, Clone)]
pub struct Database {
    records: HashMap<SecretId, SecretRecord>,
}

impl Database {
    #[must_use]
    pub fn new() -> Self {
        Self {
            records: HashMap::new(),
        }
    }

    pub fn from_jsonl(jsonl: &SessionJsonl) -> DatabaseResult<Self> {
        let mut records = HashMap::new();
        for line in jsonl.as_str().lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let record: SecretRecord =
                serde_json::from_str(line).map_err(DatabaseError::JsonlParse)?;
            records.insert(record.id.clone(), record);
        }
        Ok(Self { records })
    }

    pub fn from_stored(stored: &StoredVaultBlob, passphrase: &str) -> DatabaseResult<Self> {
        let stored_records = vault_format::deserialize_stored(stored.as_str(), stored.format())?;
        Self::from_stored_records(&stored_records, passphrase)
    }

    pub fn from_stored_auto(stored: &str, passphrase: &str) -> DatabaseResult<Self> {
        Self::from_stored(&StoredVaultBlob::parse_auto(stored)?, passphrase)
    }

    pub fn from_stored_jsonl(
        stored_jsonl: &StoredVaultJsonl,
        passphrase: &str,
    ) -> DatabaseResult<Self> {
        Self::from_stored(&StoredVaultBlob::Jsonl(stored_jsonl.clone()), passphrase)
    }

    pub fn from_stored_yaml(
        stored_yaml: &StoredVaultYaml,
        passphrase: &str,
    ) -> DatabaseResult<Self> {
        Self::from_stored(&StoredVaultBlob::Yaml(stored_yaml.clone()), passphrase)
    }

    pub fn to_jsonl(&self) -> DatabaseResult<SessionJsonl> {
        let mut lines = Vec::new();
        let mut keys: Vec<&SecretId> = self.records.keys().collect();
        keys.sort();
        for key in keys {
            let record = self.records.get(key).unwrap();
            let line = serde_json::to_string(&record).map_err(DatabaseError::JsonlSerialize)?;
            lines.push(line);
        }
        Ok(SessionJsonl::from_trusted(lines.join("\n")))
    }

    pub fn to_stored(
        &self,
        passphrase: &str,
        format: VaultFormat,
    ) -> DatabaseResult<StoredVaultBlob> {
        let stored_records = self.to_stored_records(passphrase)?;
        Ok(match format {
            VaultFormat::Jsonl => StoredVaultBlob::Jsonl(StoredVaultJsonl::from_trusted(
                vault_format::serialize_stored(&stored_records, format)?,
            )),
            VaultFormat::Yaml => StoredVaultBlob::Yaml(StoredVaultYaml::from_trusted(
                vault_format::serialize_stored(&stored_records, format)?,
            )),
        })
    }

    pub fn to_stored_jsonl(&self, passphrase: &str) -> DatabaseResult<StoredVaultJsonl> {
        match self.to_stored(passphrase, VaultFormat::Jsonl)? {
            StoredVaultBlob::Jsonl(blob) => Ok(blob),
            StoredVaultBlob::Yaml(_) => unreachable!(),
        }
    }

    pub fn to_stored_yaml(&self, passphrase: &str) -> DatabaseResult<StoredVaultYaml> {
        match self.to_stored(passphrase, VaultFormat::Yaml)? {
            StoredVaultBlob::Yaml(blob) => Ok(blob),
            StoredVaultBlob::Jsonl(_) => unreachable!(),
        }
    }

    pub fn insert(&mut self, id: SecretId, data: SecretValue) {
        self.records.insert(
            id.clone(),
            SecretRecord {
                id,
                secret_type: data.secret_type(),
                data,
            },
        );
    }

    pub fn remove(&mut self, key: &SecretId) -> Option<SecretRecord> {
        self.records.remove(key)
    }

    #[must_use]
    pub fn list(&self) -> Vec<SecretRecord> {
        let mut records: Vec<SecretRecord> = self.records.values().cloned().collect();
        records.sort_by(|a, b| a.id.cmp(&b.id));
        records
    }

    pub fn from_stored_records(
        stored_records: &[StoredSecretRecord],
        passphrase: &str,
    ) -> DatabaseResult<Self> {
        Self::from_stored_records_with_key(stored_records, &SymmetricKey::parse(passphrase)?)
    }

    pub fn from_stored_records_with_key(
        stored_records: &[StoredSecretRecord],
        passphrase: &SymmetricKey,
    ) -> DatabaseResult<Self> {
        let crypto = VaultCrypto::new(passphrase)?;
        Self::from_stored_records_with_crypto(stored_records, &crypto)
    }

    pub fn from_stored_records_with_crypto(
        stored_records: &[StoredSecretRecord],
        crypto: &VaultCrypto,
    ) -> DatabaseResult<Self> {
        let user_records = multi_device::user_stored_records(stored_records);
        let mut records = HashMap::new();
        for stored in user_records {
            let secret_type = stored.secret_type.ok_or(DatabaseError::MissingSecretType {
                key: stored.key.clone(),
            })?;
            let decrypted = crypto
                .decrypt_value(&crate::AgeArmoredCiphertext::parse(stored.value.as_str())?)?;
            let value = SecretValue::from_yaml_str(secret_type, &decrypted)?;
            records.insert(
                stored.key.clone(),
                SecretRecord {
                    id: stored.key.clone(),
                    secret_type,
                    data: value,
                },
            );
        }
        Ok(Self { records })
    }

    fn to_stored_records(&self, passphrase: &str) -> DatabaseResult<Vec<StoredSecretRecord>> {
        let crypto = VaultCrypto::new(&SymmetricKey::parse(passphrase)?)?;
        self.to_stored_records_with_crypto(&crypto)
    }

    pub fn to_stored_records_with_crypto(
        &self,
        crypto: &VaultCrypto,
    ) -> DatabaseResult<Vec<StoredSecretRecord>> {
        let mut keys: Vec<&SecretId> = self.records.keys().collect();
        keys.sort();
        let mut stored_records = Vec::with_capacity(keys.len());
        for key in keys {
            let record = self.records.get(key).unwrap();
            let yaml = record.data.to_yaml()?;
            stored_records.push(StoredSecretRecord {
                key: key.clone(),
                secret_type: Some(record.secret_type),
                value: StoredRecordPayload::from_age_armored(crypto.encrypt_value(&yaml)?),
            });
        }
        Ok(stored_records)
    }

    /// Build sorted stored records from an armored-value cache (no encryption).
    #[must_use]
    pub fn stored_records_from_armored(
        armored: &HashMap<SecretId, String>,
        secret_types: &HashMap<SecretId, SecretType>,
    ) -> Vec<StoredSecretRecord> {
        let mut keys: Vec<&SecretId> = armored.keys().collect();
        keys.sort();
        keys.into_iter()
            .map(|key| StoredSecretRecord {
                key: key.clone(),
                secret_type: secret_types.get(key).copied(),
                value: StoredRecordPayload::from_trusted(
                    armored.get(key).cloned().unwrap_or_default(),
                ),
            })
            .collect()
    }
}

impl Default for Database {
    fn default() -> Self {
        Self::new()
    }
}
#[cfg(test)]
mod tests {
    use super::Database;
    use crate::secret_types::StoredRecordPayload;
    use crate::vault_wire::{SessionJsonl, StoredVaultBlob, StoredVaultJsonl, StoredVaultYaml};
    use crate::{
        ApiKeySecret, SecretId, SecretRecord, SecretType, SecretValue, StoredSecretRecord,
        VaultFormat,
    };

    fn sid(label: &str) -> SecretId {
        SecretId::from_vault_record(label)
    }

    const TEST_PASSPHRASE: &str =
        "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

    fn test_key() -> crate::SymmetricKey {
        crate::SymmetricKey::parse(TEST_PASSPHRASE).unwrap()
    }

    fn session_jsonl(raw: &str) -> crate::SessionJsonl {
        crate::SessionJsonl::parse(raw)
            .unwrap_or_else(|_| crate::SessionJsonl::from_trusted(raw.to_owned()))
    }

    fn api_key(value: &str) -> SecretValue {
        SecretValue::ApiKey(ApiKeySecret {
            website_url: "https://example.com".to_owned(),
            key: value.to_owned(),
            expires_at: String::new(),
        })
    }

    fn sample_db() -> Database {
        let mut db = Database::new();
        db.insert(sid("github.com"), api_key("hunter2"));
        db.insert(sid("work-vpn"), api_key("token-abc"));
        db
    }

    #[test]
    fn database_roundtrip() {
        let mut db = Database::new();
        db.insert(sid("foo"), api_key("bar"));
        db.insert(sid("hello"), api_key("world"));

        let jsonl = db.to_jsonl().unwrap();
        let parsed = Database::from_jsonl(&jsonl).unwrap();
        assert_eq!(parsed.list(), db.list());
    }

    #[test]
    fn stored_jsonl_encrypts_values_only() {
        let plaintext = sample_db().to_jsonl().unwrap();
        let passphrase = TEST_PASSPHRASE;

        let db = Database::from_jsonl(&plaintext).unwrap();
        let stored = db.to_stored_jsonl(passphrase).unwrap();

        assert!(stored.as_str().contains("\"id\":\"github.com\""));
        assert!(stored.as_str().contains("BEGIN AGE ENCRYPTED FILE"));
        assert!(!stored.as_str().contains("hunter2"));
        assert!(!stored.as_str().contains("token-abc"));

        let lines: Vec<StoredSecretRecord> = stored
            .as_str()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].key.as_str(), "github.com");

        let restored = Database::from_stored_jsonl(&stored, passphrase)
            .unwrap()
            .to_jsonl()
            .unwrap();
        assert_eq!(restored, plaintext);
    }

    #[test]
    fn stored_yaml_encrypts_values_only() {
        let plaintext = sample_db().to_jsonl().unwrap();
        let passphrase = TEST_PASSPHRASE;

        let db = Database::from_jsonl(&plaintext).unwrap();
        let stored = db.to_stored_yaml(passphrase).unwrap();

        assert!(stored.as_str().contains("github.com"));
        assert!(stored.as_str().contains("BEGIN AGE ENCRYPTED FILE"));
        assert!(stored.as_str().contains('|'));
        assert!(!stored.as_str().contains("hunter2"));
        assert!(!stored.as_str().contains("token-abc"));
        assert!(!stored.as_str().contains("\\n"));

        let restored = Database::from_stored_yaml(&stored, passphrase)
            .unwrap()
            .to_jsonl()
            .unwrap();
        assert_eq!(restored, plaintext);
    }

    #[test]
    fn stored_auto_detects_jsonl_and_yaml() {
        let plaintext = {
            let mut db = Database::new();
            db.insert(sid("x"), api_key("y"));
            db.to_jsonl().unwrap()
        };
        let passphrase = TEST_PASSPHRASE;
        let db = Database::from_jsonl(&plaintext).unwrap();

        let jsonl = db.to_stored_jsonl(passphrase).unwrap();
        let yaml = db.to_stored_yaml(passphrase).unwrap();

        assert_eq!(
            Database::from_stored_auto(jsonl.as_str(), passphrase)
                .unwrap()
                .to_jsonl()
                .unwrap(),
            plaintext
        );
        assert_eq!(
            Database::from_stored_auto(yaml.as_str(), passphrase)
                .unwrap()
                .to_jsonl()
                .unwrap(),
            plaintext
        );
    }

    #[test]
    fn to_stored_respects_format() {
        let mut db = Database::new();
        db.insert(sid("a"), api_key("1"));
        let passphrase = TEST_PASSPHRASE;

        let jsonl = db.to_stored(passphrase, VaultFormat::Jsonl).unwrap();
        assert!(jsonl.as_str().trim_start().starts_with('{'));

        let yaml = db.to_stored(passphrase, VaultFormat::Yaml).unwrap();
        assert!(yaml.as_str().contains("secrets:"));
    }

    #[test]
    fn example_fixtures_roundtrip() {
        let fixtures = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures");
        let passphrase = TEST_PASSPHRASE;

        let session = std::fs::read_to_string(fixtures.join("session.example.jsonl"))
            .expect("missing fixtures/session.example.jsonl — run: cargo run --example generate_vault_fixtures -p nook-core");
        let yaml = std::fs::read_to_string(fixtures.join("nook-vault.example.yaml"))
            .expect("missing fixtures/nook-vault.example.yaml");
        let jsonl = std::fs::read_to_string(fixtures.join("nook-vault.example.jsonl"))
            .expect("missing fixtures/nook-vault.example.jsonl");

        assert!(yaml.as_str().contains("secrets:"));
        assert!(yaml.as_str().contains('|'));
        assert!(
            jsonl
                .lines()
                .all(|line| line.trim().is_empty() || line.trim_start().starts_with('{'))
        );

        let from_yaml =
            Database::from_stored_yaml(&StoredVaultYaml::from_trusted(yaml.clone()), passphrase)
                .unwrap();
        let from_jsonl =
            Database::from_stored_jsonl(&StoredVaultJsonl::from_trusted(jsonl.clone()), passphrase)
                .unwrap();
        assert_eq!(from_yaml.to_jsonl().unwrap(), session_jsonl(&session));
        assert_eq!(from_jsonl.to_jsonl().unwrap(), session_jsonl(&session));
    }

    #[test]
    fn wrong_passphrase_fails() {
        const WRONG_PASSPHRASE: &str =
            "cafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe";
        let db = sample_db();
        let stored = db.to_stored_jsonl(TEST_PASSPHRASE).unwrap();
        assert!(Database::from_stored_jsonl(&stored, WRONG_PASSPHRASE).is_err());

        let stored_yaml = db.to_stored_yaml(TEST_PASSPHRASE).unwrap();
        assert!(Database::from_stored_yaml(&stored_yaml, WRONG_PASSPHRASE).is_err());
        assert!(Database::from_stored_auto(stored_yaml.as_str(), WRONG_PASSPHRASE).is_err());
    }

    #[test]
    fn empty_vault_roundtrip_all_formats() {
        let db = Database::new();
        assert!(db.to_jsonl().unwrap().as_str().is_empty());
        assert!(db.list().is_empty());

        let stored_yaml = db.to_stored_yaml(TEST_PASSPHRASE).unwrap();
        let stored_jsonl = db.to_stored_jsonl(TEST_PASSPHRASE).unwrap();

        assert!(
            Database::from_stored_yaml(&stored_yaml, TEST_PASSPHRASE)
                .unwrap()
                .list()
                .is_empty()
        );
        assert!(
            Database::from_stored_jsonl(&stored_jsonl, TEST_PASSPHRASE)
                .unwrap()
                .list()
                .is_empty()
        );
        assert!(
            Database::from_stored_auto(stored_yaml.as_str(), TEST_PASSPHRASE)
                .unwrap()
                .list()
                .is_empty()
        );
    }

    #[test]
    fn insert_overwrites_duplicate_key() {
        let mut db = Database::new();
        db.insert(sid("site"), api_key("old"));
        db.insert(sid("site"), api_key("new"));

        assert_eq!(db.list().len(), 1);
        assert_eq!(db.list()[0].data, api_key("new"));
    }

    #[test]
    fn remove_returns_previous_value() {
        let mut db = sample_db();
        assert_eq!(
            db.remove(&sid("github.com")).unwrap().data,
            api_key("hunter2")
        );
        assert_eq!(db.remove(&sid("github.com")), None);
        assert_eq!(db.list().len(), 1);
    }

    #[test]
    fn list_is_sorted_by_key() {
        let records = sample_db().list();
        let keys: Vec<&str> = records.iter().map(|r| r.id.as_str()).collect();
        assert_eq!(keys, vec!["github.com", "work-vpn"]);
    }

    #[test]
    fn from_jsonl_duplicate_keys_last_line_wins() {
        let first = SecretRecord {
            id: sid("dup"),
            secret_type: SecretType::ApiKey,
            data: api_key("first"),
        };
        let second = SecretRecord {
            id: sid("dup"),
            secret_type: SecretType::ApiKey,
            data: api_key("second"),
        };
        let jsonl = format!(
            "{}\n{}",
            serde_json::to_string(&first).unwrap(),
            serde_json::to_string(&second).unwrap()
        );
        let db = Database::from_jsonl(&session_jsonl(&jsonl)).unwrap();
        assert_eq!(db.list().len(), 1);
        assert_eq!(db.list()[0].data, api_key("second"));
    }

    #[test]
    fn from_jsonl_rejects_invalid_json() {
        assert!(
            SessionJsonl::parse(
                r#"{"key":"x","type":"api-key","value":{}}
{broken"#
            )
            .is_err()
        );
    }

    #[test]
    fn unicode_and_special_characters_roundtrip() {
        let key = "🔐 café.example.com";
        let value = "パスワード \"quotes\" \\ backslash\nline2";
        let mut db = Database::new();
        db.insert(sid(key), api_key(value));

        let jsonl = db.to_jsonl().unwrap();
        let restored = Database::from_jsonl(&jsonl).unwrap();
        assert_eq!(
            restored.list(),
            vec![SecretRecord {
                id: sid(key),
                secret_type: SecretType::ApiKey,
                data: api_key(value),
            }]
        );

        let stored_yaml = db.to_stored_yaml(TEST_PASSPHRASE).unwrap();
        let from_yaml = Database::from_stored_yaml(&stored_yaml, TEST_PASSPHRASE).unwrap();
        assert_eq!(from_yaml.list()[0].id.as_str(), key);
        assert_eq!(from_yaml.list()[0].data, api_key(value));
    }

    #[test]
    fn empty_secret_value_roundtrip() {
        let mut db = Database::new();
        db.insert(sid("empty-value"), api_key(""));

        let stored = db.to_stored_yaml(TEST_PASSPHRASE).unwrap();
        let restored = Database::from_stored_yaml(&stored, TEST_PASSPHRASE).unwrap();
        assert_eq!(restored.list()[0].data, api_key(""));
    }

    #[test]
    fn yaml_and_jsonl_stored_formats_decrypt_to_same_plaintext() {
        let db = sample_db();
        let expected = db.to_jsonl().unwrap();

        let yaml = db.to_stored_yaml(TEST_PASSPHRASE).unwrap();
        let jsonl = db.to_stored_jsonl(TEST_PASSPHRASE).unwrap();

        assert_eq!(
            Database::from_stored_yaml(&yaml, TEST_PASSPHRASE)
                .unwrap()
                .to_jsonl()
                .unwrap(),
            expected
        );
        assert_eq!(
            Database::from_stored_jsonl(&jsonl, TEST_PASSPHRASE)
                .unwrap()
                .to_jsonl()
                .unwrap(),
            expected
        );
    }

    #[test]
    fn mutate_through_stored_yaml_roundtrip() {
        let mut db = sample_db();
        db.insert(sid("new-entry"), api_key("added-later"));
        db.remove(&sid("work-vpn"));

        let stored = db.to_stored_yaml(TEST_PASSPHRASE).unwrap();
        let mut restored = Database::from_stored_yaml(&stored, TEST_PASSPHRASE).unwrap();
        restored.insert(sid("another"), api_key("value"));

        let final_jsonl = restored.to_jsonl().unwrap();
        assert!(final_jsonl.as_str().contains("github.com"));
        assert!(final_jsonl.as_str().contains("new-entry"));
        assert!(final_jsonl.as_str().contains("another"));
        assert!(!final_jsonl.as_str().contains("work-vpn"));
    }

    #[test]
    fn from_stored_with_wrong_format_fails() {
        let db = sample_db();
        let yaml = db.to_stored_yaml(TEST_PASSPHRASE).unwrap();
        let jsonl = db.to_stored_jsonl(TEST_PASSPHRASE).unwrap();

        let wrong_jsonl =
            StoredVaultBlob::Jsonl(StoredVaultJsonl::from_trusted(yaml.as_str().to_owned()));
        let wrong_yaml =
            StoredVaultBlob::Yaml(StoredVaultYaml::from_trusted(jsonl.as_str().to_owned()));
        assert!(Database::from_stored(&wrong_jsonl, TEST_PASSPHRASE).is_err());
        assert!(Database::from_stored(&wrong_yaml, TEST_PASSPHRASE).is_err());
    }

    #[test]
    fn multiline_secret_uses_yaml_block_scalar_not_escapes() {
        let mut db = Database::new();
        db.insert(sid("notes"), api_key("line-one\nline-two\nline-three"));

        let stored = db.to_stored_yaml(TEST_PASSPHRASE).unwrap();
        assert!(stored.as_str().contains('|'));
        assert!(!stored.as_str().contains("\\n"));

        let restored = Database::from_stored_yaml(&stored, TEST_PASSPHRASE).unwrap();
        assert_eq!(
            restored.list()[0].data,
            api_key("line-one\nline-two\nline-three")
        );
    }

    #[test]
    fn stored_jsonl_ids_remain_plaintext() {
        let db = sample_db();
        let stored = db.to_stored_jsonl(TEST_PASSPHRASE).unwrap();
        let lines: Vec<StoredSecretRecord> = stored
            .as_str()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();

        assert_eq!(lines[0].key.as_str(), "github.com");
        assert_eq!(lines[1].key.as_str(), "work-vpn");
        for line in &lines {
            assert!(line.value.as_str().contains("BEGIN AGE ENCRYPTED FILE"));
        }
    }

    #[test]
    fn stored_records_from_armored_is_sorted_and_preserves_ciphertext() {
        use crate::VaultCrypto;
        use std::collections::HashMap;

        let crypto = VaultCrypto::new(&test_key()).unwrap();
        let mut armored = HashMap::new();
        armored.insert(
            sid("z-last"),
            crypto.encrypt_value("z").unwrap().as_str().to_owned(),
        );
        armored.insert(
            sid("a-first"),
            crypto.encrypt_value("a").unwrap().as_str().to_owned(),
        );

        let secret_types = HashMap::from([
            (sid("z-last"), SecretType::ApiKey),
            (sid("a-first"), SecretType::ApiKey),
        ]);
        let records = Database::stored_records_from_armored(&armored, &secret_types);
        assert_eq!(records.len(), 2);
        assert_eq!(records[0].key.as_str(), "a-first");
        assert_eq!(records[1].key.as_str(), "z-last");
        assert_ne!(records[0].value.as_str(), records[1].value.as_str());
    }

    #[test]
    fn stored_records_from_armored_empty() {
        use std::collections::HashMap;

        assert!(Database::stored_records_from_armored(&HashMap::new(), &HashMap::new()).is_empty());
    }

    #[test]
    fn stored_records_with_crypto_roundtrip() {
        use crate::VaultCrypto;

        let crypto = VaultCrypto::new(&test_key()).unwrap();
        let db = sample_db();
        let stored = db.to_stored_records_with_crypto(&crypto).unwrap();
        let restored = Database::from_stored_records_with_crypto(&stored, &crypto).unwrap();
        assert_eq!(restored.to_jsonl().unwrap(), db.to_jsonl().unwrap());
    }

    #[test]
    fn stored_type_is_plaintext_and_selects_decrypted_payload() {
        let mut db = Database::new();
        db.insert(
            sid("login-id"),
            SecretValue::Login(crate::LoginSecret {
                website_url: "https://example.com".to_owned(),
                username: "alice".to_owned(),
                password: "private-password".to_owned(),
                notes: String::new(),
            }),
        );

        let stored = db.to_stored_yaml(TEST_PASSPHRASE).unwrap();
        assert!(stored.as_str().contains("type: login"));
        assert!(!stored.as_str().contains("private-password"));
        assert_eq!(
            Database::from_stored_yaml(&stored, TEST_PASSPHRASE)
                .unwrap()
                .list(),
            db.list()
        );
    }

    #[test]
    fn typed_payload_yaml_preserves_multiline_notes() {
        let value = SecretValue::Login(crate::LoginSecret {
            website_url: "https://example.com".to_owned(),
            username: "alice".to_owned(),
            password: "secret".to_owned(),
            notes: "first line\nsecond line\nthird line".to_owned(),
        });

        let yaml = value.to_yaml().unwrap();
        assert!(yaml.as_str().contains("notes: |-"));
        assert!(yaml.as_str().contains("  second line"));
        assert_eq!(
            SecretValue::from_yaml(SecretType::Login, &yaml).unwrap(),
            value
        );
    }

    #[test]
    fn missing_or_mismatched_type_metadata_is_rejected() {
        let crypto = crate::VaultCrypto::new(&test_key()).unwrap();
        let login_yaml = crate::SecretValue::Login(crate::LoginSecret {
            website_url: "https://example.com".to_owned(),
            username: "alice".to_owned(),
            password: "secret".to_owned(),
            notes: String::new(),
        })
        .to_yaml()
        .unwrap();
        let ciphertext = crypto.encrypt_value(login_yaml.as_str()).unwrap();

        let missing = StoredSecretRecord {
            key: sid("missing"),
            secret_type: None,
            value: StoredRecordPayload::from_age_armored(ciphertext.clone()),
        };
        assert!(Database::from_stored_records_with_crypto(&[missing], &crypto).is_err());

        let mismatched = StoredSecretRecord {
            key: sid("mismatched"),
            secret_type: Some(SecretType::SeedPhrase),
            value: StoredRecordPayload::from_age_armored(ciphertext),
        };
        assert!(Database::from_stored_records_with_crypto(&[mismatched], &crypto).is_err());
    }

    #[test]
    fn validate_before_insert_rejects_blank_label() {
        use crate::{validate_secret_data, validate_secret_id};

        assert!(validate_secret_id("   ").is_err());
        assert!(validate_secret_data("").is_err());
    }
}

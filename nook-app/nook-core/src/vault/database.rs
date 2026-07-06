//! In-memory session: the plaintext `Database` and its (en|de)cryption paths.
//!
//! The `Database` is a sorted map of `(id → SecretRecord)`. It is the only
//! place where plaintext user secrets ever live in the wasm-side session.
//! YAML storage enters and leaves through this struct, so encryption boundaries
//! stay localised.

use crate::SecretId;
use crate::errors::{DatabaseError, DatabaseResult};
use crate::multi_device;
use crate::secret_types::{
    SecretRecord, SecretType, SecretValue, StoredRecordPayload, StoredSecretRecord,
};
use crate::vault_crypto::VaultCrypto;
use crate::vault_format;
use crate::vault_wire::{StoredVaultBlob, StoredVaultYaml, SymmetricKey};
use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Database {
    records: HashMap<SecretId, SecretRecord>,
}

impl Default for Database {
    fn default() -> Self {
        Self::new()
    }
}

impl Database {
    #[must_use]
    pub fn new() -> Self {
        Self {
            records: HashMap::new(),
        }
    }

    pub fn from_stored(stored: &StoredVaultBlob, passphrase: &str) -> DatabaseResult<Self> {
        let stored_records = vault_format::deserialize_stored(stored.as_str(), stored.format())?;
        Self::from_stored_records(&stored_records, passphrase)
    }

    pub fn from_stored_auto(stored: &str, passphrase: &str) -> DatabaseResult<Self> {
        Self::from_stored(&StoredVaultBlob::parse_auto(stored)?, passphrase)
    }

    pub fn from_stored_yaml(
        stored_yaml: &StoredVaultYaml,
        passphrase: &str,
    ) -> DatabaseResult<Self> {
        Self::from_stored(&StoredVaultBlob::Yaml(stored_yaml.clone()), passphrase)
    }

    pub fn to_stored(&self, passphrase: &str) -> DatabaseResult<StoredVaultBlob> {
        let stored_records = self.to_stored_records(passphrase)?;
        vault_format::serialize_stored(&stored_records, crate::VaultFormat::Yaml)
            .map_err(Into::into)
    }

    pub fn to_stored_yaml(&self, passphrase: &str) -> DatabaseResult<StoredVaultYaml> {
        match self.to_stored(passphrase)? {
            StoredVaultBlob::Yaml(blob) => Ok(blob),
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

    pub fn remove_and_zeroize(&mut self, key: &SecretId) -> bool {
        let Some(mut record) = self.records.remove(key) else {
            return false;
        };
        record.zeroize_plaintext();
        true
    }

    pub fn clear(&mut self) {
        for record in self.records.values_mut() {
            record.zeroize_plaintext();
        }
        self.records.clear();
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
            let value = SecretValue::from_yaml_str(secret_type, decrypted.as_str())?;
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

#[cfg(test)]
mod tests {
    use super::Database;
    use crate::secret_types::StoredRecordPayload;
    use crate::vault_wire::StoredVaultYaml;
    use crate::{ApiKeySecret, SecretId, SecretType, SecretValue, StoredSecretRecord};

    fn sid(label: &str) -> SecretId {
        SecretId::from_vault_record(label)
    }

    const TEST_PASSPHRASE: &str =
        "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

    fn test_key() -> crate::SymmetricKey {
        crate::SymmetricKey::parse(TEST_PASSPHRASE).unwrap()
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

        let parsed = db.clone();
        assert_eq!(parsed.list(), db.list());
    }

    #[test]
    fn stored_yaml_encrypts_values_only() {
        let passphrase = TEST_PASSPHRASE;

        let db = sample_db();
        let stored = db.to_stored_yaml(passphrase).unwrap();

        assert!(stored.as_str().contains("github.com"));
        assert!(stored.as_str().contains("BEGIN AGE ENCRYPTED FILE"));
        assert!(stored.as_str().contains('|'));
        assert!(!stored.as_str().contains("hunter2"));
        assert!(!stored.as_str().contains("token-abc"));
        assert!(!stored.as_str().contains("\\n"));

        let restored = Database::from_stored_yaml(&stored, passphrase).unwrap();
        assert_eq!(restored.list(), db.list());
    }

    #[test]
    fn stored_auto_accepts_yaml() {
        let passphrase = TEST_PASSPHRASE;
        let mut db = Database::new();
        db.insert(sid("x"), api_key("y"));
        let yaml = db.to_stored_yaml(passphrase).unwrap();

        assert_eq!(
            Database::from_stored_auto(yaml.as_str(), passphrase)
                .unwrap()
                .list(),
            db.list()
        );
    }

    #[test]
    fn to_stored_writes_yaml() {
        let mut db = Database::new();
        db.insert(sid("a"), api_key("1"));
        let passphrase = TEST_PASSPHRASE;

        let yaml = db.to_stored(passphrase).unwrap();
        assert!(yaml.as_str().contains("secrets:"));
    }

    #[test]
    fn example_fixtures_roundtrip() {
        let fixtures = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures");
        let passphrase = TEST_PASSPHRASE;

        let yaml = std::fs::read_to_string(fixtures.join("nook-projection.example.yaml"))
            .expect("missing fixtures/nook-projection.example.yaml");

        assert!(yaml.as_str().contains("secrets:"));
        assert!(yaml.as_str().contains('|'));

        let from_yaml =
            Database::from_stored_yaml(&StoredVaultYaml::from_trusted(yaml.clone()), passphrase)
                .unwrap();
        let ids: Vec<_> = from_yaml
            .list()
            .into_iter()
            .map(|record| record.id.to_string())
            .collect();
        assert_eq!(ids, vec!["github.com", "notes", "work-vpn"]);
    }

    #[test]
    fn wrong_passphrase_fails() {
        const WRONG_PASSPHRASE: &str =
            "cafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe";
        let db = sample_db();
        let stored_yaml = db.to_stored_yaml(TEST_PASSPHRASE).unwrap();
        assert!(Database::from_stored_yaml(&stored_yaml, WRONG_PASSPHRASE).is_err());
        assert!(Database::from_stored_auto(stored_yaml.as_str(), WRONG_PASSPHRASE).is_err());
    }

    #[test]
    fn empty_vault_roundtrip_yaml() {
        let db = Database::new();
        assert!(db.list().is_empty());

        let stored_yaml = db.to_stored_yaml(TEST_PASSPHRASE).unwrap();

        assert!(
            Database::from_stored_yaml(&stored_yaml, TEST_PASSPHRASE)
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
    fn unicode_and_special_characters_roundtrip() {
        let key = "🔐 café.example.com";
        let value = "パスワード \"quotes\" \\ backslash\nline2";
        let mut db = Database::new();
        db.insert(sid(key), api_key(value));

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
    fn mutate_through_stored_yaml_roundtrip() {
        let mut db = sample_db();
        db.insert(sid("new-entry"), api_key("added-later"));
        db.remove(&sid("work-vpn"));

        let stored = db.to_stored_yaml(TEST_PASSPHRASE).unwrap();
        let mut restored = Database::from_stored_yaml(&stored, TEST_PASSPHRASE).unwrap();
        restored.insert(sid("another"), api_key("value"));

        let keys: Vec<String> = restored
            .list()
            .into_iter()
            .map(|record| record.id.to_string())
            .collect();
        assert!(keys.contains(&"github.com".to_owned()));
        assert!(keys.contains(&"new-entry".to_owned()));
        assert!(keys.contains(&"another".to_owned()));
        assert!(!keys.contains(&"work-vpn".to_owned()));
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
        assert_eq!(restored.list(), db.list());
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

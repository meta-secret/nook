#![allow(
    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::uninlined_format_args
)]

mod vault_format;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};

pub use vault_format::{detect_stored_format, VaultFormat};

/// Plaintext secret (in memory only).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SecretRecord {
    pub key: String,
    pub value: String,
}

/// One record on disk — label is plaintext, `value` is armored age ciphertext.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StoredSecretRecord {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone)]
pub struct Database {
    records: HashMap<String, String>,
}

impl Database {
    #[must_use]
    pub fn new() -> Self {
        Self {
            records: HashMap::new(),
        }
    }

    pub fn from_jsonl(jsonl: &str) -> Result<Self, String> {
        let mut records = HashMap::new();
        for line in jsonl.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let record: SecretRecord = serde_json::from_str(line)
                .map_err(|e| format!("Failed to parse JSONL line: {}", e))?;
            records.insert(record.key, record.value);
        }
        Ok(Self { records })
    }

    pub fn from_stored(stored: &str, passphrase: &str, format: VaultFormat) -> Result<Self, String> {
        let stored_records = vault_format::deserialize_stored(stored, format)?;
        Self::from_stored_records(stored_records, passphrase)
    }

    pub fn from_stored_auto(stored: &str, passphrase: &str) -> Result<Self, String> {
        let format = detect_stored_format(stored)?;
        Self::from_stored(stored, passphrase, format)
    }

    pub fn from_stored_jsonl(stored_jsonl: &str, passphrase: &str) -> Result<Self, String> {
        Self::from_stored(stored_jsonl, passphrase, VaultFormat::Jsonl)
    }

    pub fn from_stored_yaml(stored_yaml: &str, passphrase: &str) -> Result<Self, String> {
        Self::from_stored(stored_yaml, passphrase, VaultFormat::Yaml)
    }

    pub fn to_jsonl(&self) -> Result<String, String> {
        let mut lines = Vec::new();
        let mut keys: Vec<&String> = self.records.keys().collect();
        keys.sort();
        for key in keys {
            let value = self.records.get(key).unwrap();
            let record = SecretRecord {
                key: key.clone(),
                value: value.clone(),
            };
            let line = serde_json::to_string(&record)
                .map_err(|e| format!("Failed to serialize record: {}", e))?;
            lines.push(line);
        }
        Ok(lines.join("\n"))
    }

    pub fn to_stored(&self, passphrase: &str, format: VaultFormat) -> Result<String, String> {
        let stored_records = self.to_stored_records(passphrase)?;
        vault_format::serialize_stored(&stored_records, format)
    }

    pub fn to_stored_jsonl(&self, passphrase: &str) -> Result<String, String> {
        self.to_stored(passphrase, VaultFormat::Jsonl)
    }

    pub fn to_stored_yaml(&self, passphrase: &str) -> Result<String, String> {
        self.to_stored(passphrase, VaultFormat::Yaml)
    }

    pub fn insert(&mut self, key: String, value: String) {
        self.records.insert(key, value);
    }

    pub fn remove(&mut self, key: &str) -> Option<String> {
        self.records.remove(key)
    }

    #[must_use]
    pub fn list(&self) -> Vec<SecretRecord> {
        let mut records: Vec<SecretRecord> = self
            .records
            .iter()
            .map(|(k, v)| SecretRecord {
                key: k.clone(),
                value: v.clone(),
            })
            .collect();
        records.sort_by(|a, b| a.key.cmp(&b.key));
        records
    }

    fn from_stored_records(
        stored_records: Vec<StoredSecretRecord>,
        passphrase: &str,
    ) -> Result<Self, String> {
        let mut records = HashMap::new();
        for stored in stored_records {
            let value = decrypt_value(&stored.value, passphrase)?;
            records.insert(stored.key, value);
        }
        Ok(Self { records })
    }

    fn to_stored_records(&self, passphrase: &str) -> Result<Vec<StoredSecretRecord>, String> {
        let mut keys: Vec<&String> = self.records.keys().collect();
        keys.sort();
        let mut stored_records = Vec::with_capacity(keys.len());
        for key in keys {
            let value = self.records.get(key).unwrap();
            stored_records.push(StoredSecretRecord {
                key: key.clone(),
                value: encrypt_value(value, passphrase)?,
            });
        }
        Ok(stored_records)
    }
}

impl Default for Database {
    fn default() -> Self {
        Self::new()
    }
}

fn encrypt_value(plaintext: &str, passphrase: &str) -> Result<String, String> {
    use age::armor::{ArmoredWriter, Format};

    let encryptor = age::Encryptor::with_user_passphrase(age::secrecy::SecretString::from(
        passphrase.to_owned(),
    ));
    let mut armored = Vec::new();
    let armor_writer = ArmoredWriter::wrap_output(&mut armored, Format::AsciiArmor)
        .map_err(|e| format!("Armor wrap error: {}", e))?;
    let mut writer = encryptor
        .wrap_output(armor_writer)
        .map_err(|e| format!("Encryption error: {}", e))?;
    writer
        .write_all(plaintext.as_bytes())
        .map_err(|e| format!("Write error: {}", e))?;
    writer
        .finish()
        .map_err(|e| format!("Finish error: {}", e))?
        .finish()
        .map_err(|e| format!("Armor finish error: {}", e))?;

    String::from_utf8(armored).map_err(|e| format!("Invalid UTF-8 armor: {}", e))
}

fn decrypt_value(armored: &str, passphrase: &str) -> Result<String, String> {
    use age::armor::ArmoredReader;

    let identity =
        age::scrypt::Identity::new(age::secrecy::SecretString::from(passphrase.to_owned()));

    let decryptor = age::Decryptor::new_buffered(ArmoredReader::new(armored.as_bytes()))
        .map_err(|e| format!("Decryption setup error: {}", e))?;

    let mut reader = decryptor
        .decrypt(std::iter::once(&identity as &dyn age::Identity))
        .map_err(|e| format!("Decryption error: {}", e))?;

    let mut decrypted = String::new();
    reader
        .read_to_string(&mut decrypted)
        .map_err(|e| format!("Read error: {}", e))?;
    Ok(decrypted)
}

#[cfg(test)]
mod tests {
    use super::{Database, SecretRecord, StoredSecretRecord, VaultFormat};

    const TEST_PASSPHRASE: &str = "deadbeefdeadbeefdeadbeefdeadbeef";

    fn sample_db() -> Database {
        let mut db = Database::new();
        db.insert("github.com".to_owned(), "hunter2".to_owned());
        db.insert("work-vpn".to_owned(), "token-abc".to_owned());
        db
    }

    #[test]
    fn database_roundtrip() {
        let mut db = Database::new();
        db.insert("foo".to_owned(), "bar".to_owned());
        db.insert("hello".to_owned(), "world".to_owned());

        let jsonl = db.to_jsonl().unwrap();
        assert_eq!(
            jsonl,
            r#"{"key":"foo","value":"bar"}
{"key":"hello","value":"world"}"#
        );

        let parsed = Database::from_jsonl(&jsonl).unwrap();
        assert_eq!(parsed.list().len(), 2);
    }

    #[test]
    fn stored_jsonl_encrypts_values_only() {
        let plaintext = r#"{"key":"github.com","value":"hunter2"}
{"key":"work-vpn","value":"token-abc"}"#;
        let passphrase = "deadbeefdeadbeefdeadbeefdeadbeef";

        let db = Database::from_jsonl(plaintext).unwrap();
        let stored = db.to_stored_jsonl(passphrase).unwrap();

        assert!(stored.contains("\"key\":\"github.com\""));
        assert!(stored.contains("BEGIN AGE ENCRYPTED FILE"));
        assert!(!stored.contains("hunter2"));
        assert!(!stored.contains("token-abc"));

        let lines: Vec<StoredSecretRecord> = stored
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].key, "github.com");

        let restored = Database::from_stored_jsonl(&stored, passphrase)
            .unwrap()
            .to_jsonl()
            .unwrap();
        assert_eq!(restored, plaintext);
    }

    #[test]
    fn stored_yaml_encrypts_values_only() {
        let plaintext = r#"{"key":"github.com","value":"hunter2"}
{"key":"work-vpn","value":"token-abc"}"#;
        let passphrase = "deadbeefdeadbeefdeadbeefdeadbeef";

        let db = Database::from_jsonl(plaintext).unwrap();
        let stored = db.to_stored_yaml(passphrase).unwrap();

        assert!(stored.contains("github.com"));
        assert!(stored.contains("BEGIN AGE ENCRYPTED FILE"));
        assert!(stored.contains("|"));
        assert!(!stored.contains("hunter2"));
        assert!(!stored.contains("token-abc"));
        assert!(!stored.contains("\\n"));

        let restored = Database::from_stored_yaml(&stored, passphrase)
            .unwrap()
            .to_jsonl()
            .unwrap();
        assert_eq!(restored, plaintext);
    }

    #[test]
    fn stored_auto_detects_jsonl_and_yaml() {
        let plaintext = r#"{"key":"x","value":"y"}"#;
        let passphrase = "deadbeefdeadbeefdeadbeefdeadbeef";
        let db = Database::from_jsonl(plaintext).unwrap();

        let jsonl = db.to_stored_jsonl(passphrase).unwrap();
        let yaml = db.to_stored_yaml(passphrase).unwrap();

        assert_eq!(
            Database::from_stored_auto(&jsonl, passphrase)
                .unwrap()
                .to_jsonl()
                .unwrap(),
            plaintext
        );
        assert_eq!(
            Database::from_stored_auto(&yaml, passphrase)
                .unwrap()
                .to_jsonl()
                .unwrap(),
            plaintext
        );
    }

    #[test]
    fn to_stored_respects_format() {
        let mut db = Database::new();
        db.insert("a".to_owned(), "1".to_owned());
        let passphrase = "deadbeefdeadbeefdeadbeefdeadbeef";

        let jsonl = db.to_stored(passphrase, VaultFormat::Jsonl).unwrap();
        assert!(jsonl.trim_start().starts_with('{'));

        let yaml = db.to_stored(passphrase, VaultFormat::Yaml).unwrap();
        assert!(yaml.contains("secrets:"));
    }

    #[test]
    fn example_fixtures_roundtrip() {
        let fixtures = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures");
        let passphrase = "deadbeefdeadbeefdeadbeefdeadbeef";

        let session = std::fs::read_to_string(fixtures.join("session.example.jsonl"))
            .expect("missing fixtures/session.example.jsonl — run: cargo run --example generate_vault_fixtures -p nook-core");
        let yaml = std::fs::read_to_string(fixtures.join("nook-vault.example.yaml"))
            .expect("missing fixtures/nook-vault.example.yaml");
        let jsonl = std::fs::read_to_string(fixtures.join("nook-vault.example.jsonl"))
            .expect("missing fixtures/nook-vault.example.jsonl");

        assert!(yaml.contains("secrets:"));
        assert!(yaml.contains("|"));
        assert!(jsonl.lines().all(|line| line.trim().is_empty() || line.trim_start().starts_with('{')));

        let from_yaml = Database::from_stored_yaml(&yaml, passphrase).unwrap();
        let from_jsonl = Database::from_stored_jsonl(&jsonl, passphrase).unwrap();
        assert_eq!(from_yaml.to_jsonl().unwrap(), session);
        assert_eq!(from_jsonl.to_jsonl().unwrap(), session);
    }

    #[test]
    fn wrong_passphrase_fails() {
        let db = Database::from_jsonl(r#"{"key":"x","value":"y"}"#).unwrap();
        let stored = db.to_stored_jsonl("correct-key").unwrap();
        assert!(Database::from_stored_jsonl(&stored, "wrong-key").is_err());

        let stored_yaml = db.to_stored_yaml("correct-key").unwrap();
        assert!(Database::from_stored_yaml(&stored_yaml, "wrong-key").is_err());
        assert!(Database::from_stored_auto(&stored_yaml, "wrong-key").is_err());
    }

    #[test]
    fn empty_vault_roundtrip_all_formats() {
        let db = Database::new();
        assert!(db.to_jsonl().unwrap().is_empty());
        assert!(db.list().is_empty());

        let stored_yaml = db.to_stored_yaml(TEST_PASSPHRASE).unwrap();
        let stored_jsonl = db.to_stored_jsonl(TEST_PASSPHRASE).unwrap();

        assert!(Database::from_stored_yaml(&stored_yaml, TEST_PASSPHRASE)
            .unwrap()
            .list()
            .is_empty());
        assert!(Database::from_stored_jsonl(&stored_jsonl, TEST_PASSPHRASE)
            .unwrap()
            .list()
            .is_empty());
        assert!(Database::from_stored_auto(&stored_yaml, TEST_PASSPHRASE)
            .unwrap()
            .list()
            .is_empty());
    }

    #[test]
    fn insert_overwrites_duplicate_key() {
        let mut db = Database::new();
        db.insert("site".to_owned(), "old".to_owned());
        db.insert("site".to_owned(), "new".to_owned());

        assert_eq!(db.list().len(), 1);
        assert_eq!(db.list()[0].value, "new");
    }

    #[test]
    fn remove_returns_previous_value() {
        let mut db = sample_db();
        assert_eq!(db.remove("github.com"), Some("hunter2".to_owned()));
        assert_eq!(db.remove("github.com"), None);
        assert_eq!(db.list().len(), 1);
    }

    #[test]
    fn list_is_sorted_by_key() {
        let records = sample_db().list();
        let keys: Vec<&str> = records.iter().map(|r| r.key.as_str()).collect();
        assert_eq!(keys, vec!["github.com", "work-vpn"]);
    }

    #[test]
    fn from_jsonl_duplicate_keys_last_line_wins() {
        let jsonl = r#"{"key":"dup","value":"first"}
{"key":"dup","value":"second"}"#;
        let db = Database::from_jsonl(jsonl).unwrap();
        assert_eq!(db.list().len(), 1);
        assert_eq!(db.list()[0].value, "second");
    }

    #[test]
    fn from_jsonl_rejects_invalid_json() {
        let err = Database::from_jsonl(r#"{"key":"x","value":"y"}
{broken"#).unwrap_err();
        assert!(err.contains("Failed to parse JSONL line"));
    }

    #[test]
    fn unicode_and_special_characters_roundtrip() {
        let key = "🔐 café.example.com";
        let value = "パスワード \"quotes\" \\ backslash\nline2";
        let mut db = Database::new();
        db.insert(key.to_owned(), value.to_owned());

        let jsonl = db.to_jsonl().unwrap();
        let restored = Database::from_jsonl(&jsonl).unwrap();
        assert_eq!(restored.list(), vec![SecretRecord {
            key: key.to_owned(),
            value: value.to_owned(),
        }]);

        let stored_yaml = db.to_stored_yaml(TEST_PASSPHRASE).unwrap();
        let from_yaml = Database::from_stored_yaml(&stored_yaml, TEST_PASSPHRASE).unwrap();
        assert_eq!(from_yaml.list()[0].key, key);
        assert_eq!(from_yaml.list()[0].value, value);
    }

    #[test]
    fn empty_secret_value_roundtrip() {
        let mut db = Database::new();
        db.insert("empty-value".to_owned(), String::new());

        let stored = db.to_stored_yaml(TEST_PASSPHRASE).unwrap();
        let restored = Database::from_stored_yaml(&stored, TEST_PASSPHRASE).unwrap();
        assert_eq!(restored.list()[0].value, "");
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
        db.insert("new-entry".to_owned(), "added-later".to_owned());
        db.remove("work-vpn");

        let stored = db.to_stored_yaml(TEST_PASSPHRASE).unwrap();
        let mut restored = Database::from_stored_yaml(&stored, TEST_PASSPHRASE).unwrap();
        restored.insert("another".to_owned(), "value".to_owned());

        let final_jsonl = restored.to_jsonl().unwrap();
        assert!(final_jsonl.contains("github.com"));
        assert!(final_jsonl.contains("new-entry"));
        assert!(final_jsonl.contains("another"));
        assert!(!final_jsonl.contains("work-vpn"));
    }

    #[test]
    fn from_stored_with_wrong_format_fails() {
        let db = sample_db();
        let yaml = db.to_stored_yaml(TEST_PASSPHRASE).unwrap();
        let jsonl = db.to_stored_jsonl(TEST_PASSPHRASE).unwrap();

        assert!(Database::from_stored(&yaml, TEST_PASSPHRASE, VaultFormat::Jsonl).is_err());
        assert!(Database::from_stored(&jsonl, TEST_PASSPHRASE, VaultFormat::Yaml).is_err());
    }

    #[test]
    fn multiline_secret_uses_yaml_block_scalar_not_escapes() {
        let mut db = Database::new();
        db.insert(
            "notes".to_owned(),
            "line-one\nline-two\nline-three".to_owned(),
        );

        let stored = db.to_stored_yaml(TEST_PASSPHRASE).unwrap();
        assert!(stored.contains('|'));
        assert!(!stored.contains("\\n"));

        let restored = Database::from_stored_yaml(&stored, TEST_PASSPHRASE).unwrap();
        assert_eq!(restored.list()[0].value, "line-one\nline-two\nline-three");
    }

    #[test]
    fn stored_jsonl_keys_remain_plaintext() {
        let db = sample_db();
        let stored = db.to_stored_jsonl(TEST_PASSPHRASE).unwrap();
        let lines: Vec<StoredSecretRecord> = stored
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();

        assert_eq!(lines[0].key, "github.com");
        assert_eq!(lines[1].key, "work-vpn");
        for line in &lines {
            assert!(line.value.contains("BEGIN AGE ENCRYPTED FILE"));
        }
    }
}

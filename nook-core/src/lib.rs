#![allow(
    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::uninlined_format_args
)]

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};

#[cfg(test)]
mod tests {
    use super::{Database, decrypt, encrypt};

    #[test]
    fn database_roundtrip() {
        let mut db = Database::new();
        db.insert("foo".to_owned(), "bar".to_owned());
        db.insert("hello".to_owned(), "world".to_owned());

        let jsonl = db.to_jsonl().unwrap();
        // Check order is alphabetical by key
        assert_eq!(
            jsonl,
            r#"{"key":"foo","value":"bar"}
{"key":"hello","value":"world"}"#
        );

        let parsed_db = Database::from_jsonl(&jsonl).unwrap();
        assert_eq!(parsed_db.list().len(), 2);
        assert_eq!(parsed_db.records.get("foo").unwrap(), "bar");
        assert_eq!(parsed_db.records.get("hello").unwrap(), "world");
    }

    #[test]
    fn database_insert_and_remove() {
        let mut db = Database::new();
        db.insert("foo".to_owned(), "bar".to_owned());
        assert_eq!(db.list()[0].key, "foo");

        db.remove("foo");
        assert!(db.list().is_empty());
    }

    #[test]
    fn encryption_roundtrip() {
        let plaintext = "secret payload 123";
        let passphrase = "my-secure-password";

        let ciphertext = encrypt(plaintext, passphrase).unwrap();
        assert_ne!(plaintext, ciphertext);

        let decrypted = decrypt(&ciphertext, passphrase).unwrap();
        assert_eq!(plaintext, decrypted);

        // Decryption fails with wrong passphrase
        assert!(decrypt(&ciphertext, "wrong-password").is_err());
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SecretRecord {
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
}

impl Default for Database {
    fn default() -> Self {
        Self::new()
    }
}

pub fn encrypt(plaintext: &str, passphrase: &str) -> Result<String, String> {
    if passphrase.is_empty() {
        return Ok(plaintext.to_string());
    }
    let encryptor = age::Encryptor::with_user_passphrase(age::secrecy::SecretString::from(
        passphrase.to_owned(),
    ));
    let mut encrypted = vec![];
    let mut writer = encryptor
        .wrap_output(&mut encrypted)
        .map_err(|e| format!("Encryption error: {}", e))?;
    writer
        .write_all(plaintext.as_bytes())
        .map_err(|e| format!("Write error: {}", e))?;
    writer
        .finish()
        .map_err(|e| format!("Finish error: {}", e))?;

    Ok(hex::encode(encrypted))
}

pub fn decrypt(ciphertext_hex: &str, passphrase: &str) -> Result<String, String> {
    if passphrase.is_empty() {
        return Ok(ciphertext_hex.to_string());
    }
    let ciphertext = hex::decode(ciphertext_hex).map_err(|e| format!("Invalid hex: {}", e))?;

    let identity =
        age::scrypt::Identity::new(age::secrecy::SecretString::from(passphrase.to_owned()));

    let decryptor = match age::Decryptor::new(&ciphertext[..]) {
        Ok(d) => d,
        Err(e) => return Err(format!("Decryption setup error: {}", e)),
    };

    let mut reader = decryptor
        .decrypt(std::iter::once(&identity as &dyn age::Identity))
        .map_err(|e| format!("Decryption error: {}", e))?;

    let mut decrypted = String::new();
    reader
        .read_to_string(&mut decrypted)
        .map_err(|e| format!("Read error: {}", e))?;
    Ok(decrypted)
}

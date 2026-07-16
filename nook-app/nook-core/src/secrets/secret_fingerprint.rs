//! Vault-keyed, provider-neutral secret fingerprints for duplicate detection.

use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;

use crate::{SecretValue, SymmetricKey};

const FINGERPRINT_DOMAIN: &[u8] = b"nook/secret-fingerprint/v1\0";
const IMPORT_METADATA_MARKERS: [&str; 2] = ["## Bitwarden", "## 1Password"];

/// Opaque HMAC-SHA-256 tag. It can reveal equality inside one vault, but it
/// cannot be tested against guessed plaintext without that vault's secret key.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SecretFingerprint(String);

impl SecretFingerprint {
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    #[must_use]
    pub fn from_trusted(value: String) -> Self {
        Self(value)
    }
}

fn normalized_text(value: &str) -> String {
    value.replace("\r\n", "\n").trim().to_owned()
}

fn provider_neutral_notes(value: &str) -> String {
    let normalized = normalized_text(value);
    let marker_index = IMPORT_METADATA_MARKERS
        .iter()
        .filter_map(|marker| {
            normalized
                .find(&format!("\n\n{marker}"))
                .map(|index| index + 2)
                .or_else(|| normalized.starts_with(marker).then_some(0))
        })
        .min();
    marker_index.map_or(normalized.clone(), |index| {
        normalized[..index].trim_end().to_owned()
    })
}

fn append_field(bytes: &mut Vec<u8>, value: &str) {
    bytes.extend_from_slice(value.len().to_string().as_bytes());
    bytes.push(b':');
    bytes.extend_from_slice(value.as_bytes());
    bytes.push(0);
}

fn canonical_identity(value: &SecretValue) -> Vec<u8> {
    let mut bytes = Vec::new();
    bytes.extend_from_slice(FINGERPRINT_DOMAIN);
    match value {
        SecretValue::Login(login) => {
            append_field(&mut bytes, "login");
            append_field(&mut bytes, normalized_text(&login.website_url).as_str());
            append_field(&mut bytes, normalized_text(&login.username).as_str());
            append_field(&mut bytes, login.password.as_str());
            append_field(&mut bytes, provider_neutral_notes(&login.notes).as_str());
        }
        SecretValue::ApiKey(api_key) => {
            append_field(&mut bytes, "api-key");
            append_field(&mut bytes, normalized_text(&api_key.website_url).as_str());
            append_field(&mut bytes, api_key.key.as_str());
            append_field(&mut bytes, normalized_text(&api_key.expires_at).as_str());
        }
        SecretValue::SeedPhrase(seed_phrase) => {
            append_field(&mut bytes, "seed-phrase");
            append_field(&mut bytes, normalized_text(&seed_phrase.name).as_str());
            append_field(
                &mut bytes,
                seed_phrase
                    .seed
                    .split_whitespace()
                    .collect::<Vec<_>>()
                    .join(" ")
                    .as_str(),
            );
        }
        SecretValue::SecureNote(note) => {
            append_field(&mut bytes, "secure-note");
            append_field(&mut bytes, normalized_text(&note.title).as_str());
            append_field(&mut bytes, provider_neutral_notes(&note.note).as_str());
        }
    }
    bytes
}

/// Compute a deterministic tag scoped to one vault key.
#[must_use]
pub fn secret_fingerprint(value: &SecretValue, secrets_key: &SymmetricKey) -> SecretFingerprint {
    let mut mac = Hmac::<Sha256>::new_from_slice(secrets_key.as_str().as_bytes())
        .expect("HMAC accepts keys of any length");
    mac.update(&canonical_identity(value));
    SecretFingerprint::from_trusted(format!(
        "hmac-sha256:v1:{}",
        hex::encode(mac.finalize().into_bytes())
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{LoginSecret, SecureNoteSecret};

    fn key(byte: char) -> SymmetricKey {
        SymmetricKey::parse(&byte.to_string().repeat(64)).unwrap()
    }

    #[test]
    fn fingerprints_are_vault_scoped_and_deterministic() {
        let value = SecretValue::Login(LoginSecret {
            website_url: "https://example.com".to_owned(),
            username: "alice".to_owned(),
            password: "correct horse".to_owned(),
            notes: "personal".to_owned(),
        });
        assert_eq!(
            secret_fingerprint(&value, &key('a')),
            secret_fingerprint(&value, &key('a'))
        );
        assert_ne!(
            secret_fingerprint(&value, &key('a')),
            secret_fingerprint(&value, &key('b'))
        );
    }

    #[test]
    fn provider_metadata_does_not_split_the_same_login() {
        let bitwarden = SecretValue::Login(LoginSecret {
            website_url: " https://example.com ".to_owned(),
            username: "alice".to_owned(),
            password: "secret".to_owned(),
            notes: "shared note\n\n## Bitwarden\n- totp: abc".to_owned(),
        });
        let onepassword = SecretValue::Login(LoginSecret {
            website_url: "https://example.com".to_owned(),
            username: "alice".to_owned(),
            password: "secret".to_owned(),
            notes: "shared note\n\n## 1Password\n- vault: Personal".to_owned(),
        });
        assert_eq!(
            secret_fingerprint(&bitwarden, &key('a')),
            secret_fingerprint(&onepassword, &key('a'))
        );
    }

    #[test]
    fn meaningful_note_changes_remain_distinct() {
        let first = SecretValue::SecureNote(SecureNoteSecret {
            title: "Recovery".to_owned(),
            note: "first".to_owned(),
        });
        let second = SecretValue::SecureNote(SecureNoteSecret {
            title: "Recovery".to_owned(),
            note: "second".to_owned(),
        });
        assert_ne!(
            secret_fingerprint(&first, &key('a')),
            secret_fingerprint(&second, &key('a'))
        );
    }
}

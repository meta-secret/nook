//! Vault-keyed identity and secret-version fingerprints for import reconciliation.

use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;

use crate::{LoginSecret, SecretValue, SecureNoteSecret, SymmetricKey};

const IDENTITY_DOMAIN: &[u8] = b"nook/secret-identity/v1\0";
const VERSION_DOMAIN: &[u8] = b"nook/secret-version/v1\0";
const IMPORT_METADATA_MARKERS: [&str; 2] = ["## Bitwarden", "## 1Password"];
const LOGIN_IMPORT_METADATA_MARKERS: [&str; 4] = [
    "## Bitwarden",
    "## 1Password",
    "## Browser password manager",
    "## Apple Passwords",
];

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

fn provider_neutral_notes(value: &str, markers: &[&str]) -> String {
    let normalized = normalized_text(value);
    let marker_index = markers
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
    match value {
        SecretValue::Login(login) => {
            append_field(&mut bytes, "login");
            append_field(&mut bytes, normalized_text(&login.website_url).as_str());
            append_field(&mut bytes, normalized_text(&login.username).as_str());
        }
        SecretValue::ApiKey(api_key) => {
            append_field(&mut bytes, "api-key");
            append_field(&mut bytes, normalized_text(&api_key.website_url).as_str());
        }
        SecretValue::SeedPhrase(seed_phrase) => {
            append_field(&mut bytes, "seed-phrase");
            append_field(&mut bytes, normalized_text(&seed_phrase.name).as_str());
        }
        SecretValue::SecureNote(note) => {
            append_field(&mut bytes, "secure-note");
            append_field(&mut bytes, normalized_text(&note.title).as_str());
        }
        SecretValue::Authenticator(authenticator) => {
            append_field(&mut bytes, "authenticator");
            append_field(&mut bytes, normalized_text(&authenticator.issuer).as_str());
            append_field(&mut bytes, normalized_text(&authenticator.account).as_str());
        }
    }
    bytes
}

fn canonical_secret_version(value: &SecretValue) -> Vec<u8> {
    let mut bytes = canonical_identity(value);
    match value {
        SecretValue::Login(login) => append_field(&mut bytes, login.password.as_str()),
        SecretValue::ApiKey(api_key) => append_field(&mut bytes, api_key.key.as_str()),
        SecretValue::SeedPhrase(seed_phrase) => append_field(
            &mut bytes,
            seed_phrase
                .seed
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
                .as_str(),
        ),
        SecretValue::SecureNote(note) => {
            append_field(
                &mut bytes,
                provider_neutral_notes(&note.note, &IMPORT_METADATA_MARKERS).as_str(),
            );
        }
        SecretValue::Authenticator(authenticator) => {
            append_field(&mut bytes, authenticator.secret.as_str());
            append_field(&mut bytes, authenticator.algorithm.as_str());
            append_field(&mut bytes, authenticator.digits.get().to_string().as_str());
            append_field(&mut bytes, authenticator.period.get().to_string().as_str());
            let mut backup_codes = authenticator
                .backup_codes
                .iter()
                .map(|code| normalized_text(code))
                .collect::<Vec<_>>();
            backup_codes.sort();
            for code in backup_codes {
                append_field(&mut bytes, code.as_str());
            }
        }
    }
    bytes
}

fn fingerprint(domain: &[u8], canonical: &[u8], secrets_key: &SymmetricKey) -> SecretFingerprint {
    let mut mac = Hmac::<Sha256>::new_from_slice(secrets_key.as_str().as_bytes())
        .expect("HMAC accepts keys of any length");
    mac.update(domain);
    mac.update(canonical);
    SecretFingerprint::from_trusted(format!(
        "hmac-sha256:v1:{}",
        hex::encode(mac.finalize().into_bytes())
    ))
}

/// Compute the logical item identity without its password or provider metadata.
#[must_use]
pub fn secret_identity_fingerprint(
    value: &SecretValue,
    secrets_key: &SymmetricKey,
) -> SecretFingerprint {
    fingerprint(IDENTITY_DOMAIN, &canonical_identity(value), secrets_key)
}

/// Compute one secret-value version, bound to its logical item identity.
#[must_use]
pub fn secret_fingerprint(value: &SecretValue, secrets_key: &SymmetricKey) -> SecretFingerprint {
    fingerprint(
        VERSION_DOMAIN,
        &canonical_secret_version(value),
        secrets_key,
    )
}

fn merge_notes(existing: &str, incoming: &str, markers: &[&str]) -> String {
    let existing = normalized_text(existing);
    let incoming = normalized_text(incoming);
    if incoming.is_empty() || existing == incoming || existing.contains(&incoming) {
        existing
    } else if existing.is_empty() || incoming.contains(&existing) {
        incoming
    } else {
        let existing_base = provider_neutral_notes(&existing, markers);
        let incoming_base = provider_neutral_notes(&incoming, markers);
        if existing_base == incoming_base {
            let incoming_metadata = incoming[incoming_base.len()..].trim();
            if incoming_metadata.is_empty() || existing.contains(incoming_metadata) {
                existing
            } else {
                format!("{existing}\n\n{incoming_metadata}")
            }
        } else {
            format!("{existing}\n\n{incoming}")
        }
    }
}

/// Enrich an existing matching secret version with fields carried by another provider.
#[must_use]
pub fn enrich_secret(existing: &SecretValue, incoming: &SecretValue) -> SecretValue {
    match (existing, incoming) {
        (SecretValue::Login(existing), SecretValue::Login(incoming)) => {
            SecretValue::Login(LoginSecret {
                website_url: existing.website_url.clone(),
                username: existing.username.clone(),
                password: existing.password.clone(),
                notes: merge_notes(
                    &existing.notes,
                    &incoming.notes,
                    &LOGIN_IMPORT_METADATA_MARKERS,
                ),
            })
        }
        (SecretValue::SecureNote(existing), SecretValue::SecureNote(incoming)) => {
            SecretValue::SecureNote(SecureNoteSecret {
                title: existing.title.clone(),
                note: merge_notes(&existing.note, &incoming.note, &IMPORT_METADATA_MARKERS),
            })
        }
        _ => existing.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        AuthenticatorSecret, LoginSecret, SecureNoteSecret, TotpAlgorithm, TotpDigits, TotpPeriod,
        TotpSecret,
    };

    fn key(byte: char) -> SymmetricKey {
        SymmetricKey::parse(&byte.to_string().repeat(64)).unwrap()
    }

    fn authenticator(secret: &str, backup_codes: &[&str]) -> SecretValue {
        SecretValue::Authenticator(AuthenticatorSecret {
            issuer: "Example".to_owned(),
            account: "alice@example.com".to_owned(),
            secret: TotpSecret::parse(secret).unwrap(),
            algorithm: TotpAlgorithm::Sha1,
            digits: TotpDigits::parse(6).unwrap(),
            period: TotpPeriod::parse(30).unwrap(),
            backup_codes: backup_codes.iter().map(ToString::to_string).collect(),
        })
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
    fn identity_ignores_password_and_provider_metadata() {
        let bitwarden = SecretValue::Login(LoginSecret {
            website_url: " https://example.com ".to_owned(),
            username: "alice".to_owned(),
            password: "old".to_owned(),
            notes: "shared note\n\n## Bitwarden\n- totp: abc".to_owned(),
        });
        let onepassword = SecretValue::Login(LoginSecret {
            website_url: "https://example.com".to_owned(),
            username: "alice".to_owned(),
            password: "new".to_owned(),
            notes: "shared note\n\n## 1Password\n- vault: Personal".to_owned(),
        });
        assert_eq!(
            secret_identity_fingerprint(&bitwarden, &key('a')),
            secret_identity_fingerprint(&onepassword, &key('a'))
        );
    }

    #[test]
    fn different_passwords_are_different_versions() {
        assert_ne!(
            secret_fingerprint(
                &SecretValue::Login(LoginSecret {
                    website_url: "https://example.com".to_owned(),
                    username: "alice".to_owned(),
                    password: "old".to_owned(),
                    notes: String::new(),
                }),
                &key('a')
            ),
            secret_fingerprint(
                &SecretValue::Login(LoginSecret {
                    website_url: "https://example.com".to_owned(),
                    username: "alice".to_owned(),
                    password: "new".to_owned(),
                    notes: String::new(),
                }),
                &key('a')
            )
        );
    }

    #[test]
    fn login_versions_ignore_all_supported_importer_metadata() {
        let chrome = SecretValue::Login(LoginSecret {
            website_url: "https://example.com".to_owned(),
            username: "alice".to_owned(),
            password: "secret".to_owned(),
            notes: "shared note\n\n## Browser password manager\n- name: Example".to_owned(),
        });
        let apple = SecretValue::Login(LoginSecret {
            website_url: "https://example.com".to_owned(),
            username: "alice".to_owned(),
            password: "secret".to_owned(),
            notes: "shared note\n\n## Apple Passwords\n- title: Example".to_owned(),
        });

        assert_eq!(
            secret_fingerprint(&chrome, &key('a')),
            secret_fingerprint(&apple, &key('a'))
        );
    }

    #[test]
    fn meaningful_secure_note_changes_remain_distinct() {
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

    #[test]
    fn login_only_import_markers_remain_meaningful_in_secure_notes() {
        let first = SecretValue::SecureNote(SecureNoteSecret {
            title: "Migration guide".to_owned(),
            note: "Steps\n\n## Apple Passwords\nUse the first export".to_owned(),
        });
        let second = SecretValue::SecureNote(SecureNoteSecret {
            title: "Migration guide".to_owned(),
            note: "Steps\n\n## Apple Passwords\nUse the second export".to_owned(),
        });

        assert_ne!(
            secret_fingerprint(&first, &key('a')),
            secret_fingerprint(&second, &key('a'))
        );
    }

    #[test]
    fn authenticator_identity_excludes_secret_material() {
        let first = authenticator("JBSWY3DPEHPK3PXP", &["alpha"]);
        let second = authenticator("KRSXG5DSNFXGOIDB", &["beta"]);
        assert_eq!(
            secret_identity_fingerprint(&first, &key('a')),
            secret_identity_fingerprint(&second, &key('a'))
        );
        assert_ne!(
            secret_fingerprint(&first, &key('a')),
            secret_fingerprint(&second, &key('a'))
        );
    }

    #[test]
    fn authenticator_backup_code_order_does_not_create_a_new_version() {
        assert_eq!(
            secret_fingerprint(
                &authenticator("JBSWY3DPEHPK3PXP", &["alpha", "beta"]),
                &key('a')
            ),
            secret_fingerprint(
                &authenticator("JBSWY3DPEHPK3PXP", &["beta", "alpha"]),
                &key('a')
            )
        );
    }

    #[test]
    fn matching_login_versions_merge_provider_fields() {
        let existing = SecretValue::Login(LoginSecret {
            website_url: "https://example.com".to_owned(),
            username: "alice".to_owned(),
            password: "secret".to_owned(),
            notes: "note\n\n## Bitwarden\n- field.PIN: 1234".to_owned(),
        });
        let incoming = SecretValue::Login(LoginSecret {
            website_url: "https://example.com".to_owned(),
            username: "alice".to_owned(),
            password: "secret".to_owned(),
            notes: "note\n\n## 1Password\n- Security.TOTP: abc".to_owned(),
        });
        let SecretValue::Login(merged) = enrich_secret(&existing, &incoming) else {
            panic!("expected login");
        };
        assert!(merged.notes.contains("field.PIN: 1234"));
        assert!(merged.notes.contains("Security.TOTP: abc"));
        assert_eq!(merged.notes.matches("note").count(), 1);
        let merged_again = enrich_secret(&SecretValue::Login(merged.clone()), &incoming);
        assert_eq!(merged_again, SecretValue::Login(merged));
    }
}

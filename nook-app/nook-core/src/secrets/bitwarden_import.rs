//! Bitwarden vault-item conversion into Nook's typed plaintext secret model.

use aes::cipher::{BlockModeDecrypt, KeyIvInit, block_padding::Pkcs7};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use hkdf::Hkdf;
use hmac::{Hmac, Mac};
use pbkdf2::{pbkdf2_hmac, sha2::Sha256 as Pbkdf2Sha256};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use thiserror::Error;
use zeroize::{Zeroize, Zeroizing};

use crate::{CreditCardSecret, LoginSecret, SecretValue, SecureNoteSecret};

const MIN_PBKDF2_ITERATIONS: u32 = 5_000;
const MAX_PBKDF2_ITERATIONS: u32 = 10_000_000;
const MIN_ARGON2_MEMORY_MIB: u32 = 16;
const MAX_ARGON2_MEMORY_MIB: u32 = 1_024;
const MIN_ARGON2_ITERATIONS: u32 = 2;
const MAX_ARGON2_ITERATIONS: u32 = 20;
const MAX_ARGON2_PARALLELISM: u32 = 16;

#[derive(Debug, Error)]
pub enum BitwardenImportError {
    #[error("Bitwarden returned invalid JSON: {0}")]
    InvalidJson(#[from] serde_json::Error),
    #[error("This is not a Bitwarden JSON export: the items list is missing.")]
    InvalidResponse,
    #[error("This password-protected Bitwarden export requires its export password.")]
    PasswordRequired,
    #[error("The Bitwarden export password is incorrect or the encrypted file was modified.")]
    InvalidPassword,
    #[error(
        "This account-restricted Bitwarden export cannot be imported. Export a password-protected encrypted JSON file instead."
    )]
    AccountRestrictedExport,
    #[error("The encrypted Bitwarden export is invalid: {0}")]
    InvalidEncryptedExport(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BitwardenImportPlan {
    pub items: Vec<SecretValue>,
    pub source_count: usize,
    pub skipped_unsupported: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BitwardenItem {
    #[serde(rename = "type")]
    item_type: u8,
    #[serde(default, deserialize_with = "deserialize_string_or_default")]
    name: String,
    #[serde(default, deserialize_with = "deserialize_string_or_default")]
    notes: String,
    #[serde(default)]
    fields: Vec<BitwardenField>,
    login: Option<BitwardenLogin>,
    card: Option<BitwardenCard>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BitwardenCard {
    #[serde(default, deserialize_with = "deserialize_string_or_default")]
    cardholder_name: String,
    #[serde(default, deserialize_with = "deserialize_string_or_default")]
    brand: String,
    #[serde(default, deserialize_with = "deserialize_string_or_default")]
    number: String,
    #[serde(default, deserialize_with = "deserialize_string_or_default")]
    exp_month: String,
    #[serde(default, deserialize_with = "deserialize_string_or_default")]
    exp_year: String,
    #[serde(default, deserialize_with = "deserialize_string_or_default")]
    code: String,
}

#[derive(Debug, Deserialize)]
struct BitwardenLogin {
    #[serde(default, deserialize_with = "deserialize_string_or_default")]
    username: String,
    #[serde(default, deserialize_with = "deserialize_string_or_default")]
    password: String,
    #[serde(default, deserialize_with = "deserialize_string_or_default")]
    totp: String,
    #[serde(default)]
    uris: Vec<BitwardenUri>,
}

#[derive(Debug, Deserialize)]
struct BitwardenField {
    #[serde(default, deserialize_with = "deserialize_string_or_default")]
    name: String,
    #[serde(default, deserialize_with = "deserialize_string_or_default")]
    value: String,
}

#[derive(Debug, Deserialize)]
struct BitwardenUri {
    #[serde(default, deserialize_with = "deserialize_string_or_default")]
    uri: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EncryptedBitwardenExport {
    password_protected: bool,
    salt: String,
    kdf_type: u32,
    kdf_iterations: u32,
    kdf_memory: Option<u32>,
    kdf_parallelism: Option<u32>,
    #[serde(rename = "encKeyValidation_DO_NOT_EDIT")]
    enc_key_validation: String,
    data: String,
}

struct BitwardenEncryptionKey {
    encryption: Zeroizing<[u8; 32]>,
    authentication: Zeroizing<[u8; 32]>,
}

struct EncStringParts {
    iv: [u8; 16],
    ciphertext: Zeroizing<Vec<u8>>,
    mac: [u8; 32],
}

fn deserialize_string_or_default<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Ok(Option::<String>::deserialize(deserializer)?.unwrap_or_default())
}

fn encrypted_error(message: impl Into<String>) -> BitwardenImportError {
    BitwardenImportError::InvalidEncryptedExport(message.into())
}

fn validate_range(
    name: &str,
    value: u32,
    minimum: u32,
    maximum: u32,
) -> Result<u32, BitwardenImportError> {
    if (minimum..=maximum).contains(&value) {
        Ok(value)
    } else {
        Err(encrypted_error(format!(
            "{name} must be between {minimum} and {maximum}."
        )))
    }
}

fn derive_export_key(
    export: &EncryptedBitwardenExport,
    password: &str,
) -> Result<BitwardenEncryptionKey, BitwardenImportError> {
    let mut derived = Zeroizing::new([0_u8; 32]);
    match export.kdf_type {
        0 => {
            let iterations = validate_range(
                "PBKDF2 iterations",
                export.kdf_iterations,
                MIN_PBKDF2_ITERATIONS,
                MAX_PBKDF2_ITERATIONS,
            )?;
            pbkdf2_hmac::<Pbkdf2Sha256>(
                password.as_bytes(),
                export.salt.as_bytes(),
                iterations,
                derived.as_mut(),
            );
        }
        1 => {
            let memory_mib = validate_range(
                "Argon2 memory",
                export
                    .kdf_memory
                    .ok_or_else(|| encrypted_error("Argon2 memory is missing."))?,
                MIN_ARGON2_MEMORY_MIB,
                MAX_ARGON2_MEMORY_MIB,
            )?;
            let iterations = validate_range(
                "Argon2 iterations",
                export.kdf_iterations,
                MIN_ARGON2_ITERATIONS,
                MAX_ARGON2_ITERATIONS,
            )?;
            let parallelism = validate_range(
                "Argon2 parallelism",
                export
                    .kdf_parallelism
                    .ok_or_else(|| encrypted_error("Argon2 parallelism is missing."))?,
                1,
                MAX_ARGON2_PARALLELISM,
            )?;
            let memory_cost_kib = memory_mib
                .checked_mul(1_024)
                .ok_or_else(|| encrypted_error("Argon2 memory is too large."))?;
            let params = Params::new(memory_cost_kib, iterations, parallelism, Some(32))
                .map_err(|error| encrypted_error(format!("invalid Argon2 settings: {error}")))?;
            let salt_hash = Sha256::digest(export.salt.as_bytes());
            Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
                .hash_password_into(password.as_bytes(), &salt_hash, derived.as_mut())
                .map_err(|error| encrypted_error(format!("Argon2 failed: {error}")))?;
        }
        other => {
            return Err(encrypted_error(format!("unsupported KDF type {other}.")));
        }
    }

    let hkdf = Hkdf::<Sha256>::from_prk(derived.as_ref())
        .map_err(|_| encrypted_error("derived key has the wrong length."))?;
    let mut encryption = Zeroizing::new([0_u8; 32]);
    let mut authentication = Zeroizing::new([0_u8; 32]);
    hkdf.expand(b"enc", encryption.as_mut())
        .map_err(|_| encrypted_error("could not derive the encryption key."))?;
    hkdf.expand(b"mac", authentication.as_mut())
        .map_err(|_| encrypted_error("could not derive the authentication key."))?;
    Ok(BitwardenEncryptionKey {
        encryption,
        authentication,
    })
}

fn decode_enc_string(encoded: &str) -> Result<EncStringParts, BitwardenImportError> {
    let payload = encoded
        .strip_prefix("2.")
        .ok_or_else(|| encrypted_error("encrypted data must use Bitwarden type 2."))?;
    let mut parts = payload.split('|');
    let iv = parts
        .next()
        .and_then(|value| BASE64.decode(value).ok())
        .and_then(|value| value.try_into().ok())
        .ok_or_else(|| encrypted_error("encrypted data has an invalid IV."))?;
    let ciphertext = parts
        .next()
        .and_then(|value| BASE64.decode(value).ok())
        .filter(|value| !value.is_empty() && value.len() % 16 == 0)
        .map(Zeroizing::new)
        .ok_or_else(|| encrypted_error("encrypted data has invalid ciphertext."))?;
    let mac = parts
        .next()
        .and_then(|value| BASE64.decode(value).ok())
        .and_then(|value| value.try_into().ok())
        .ok_or_else(|| encrypted_error("encrypted data has an invalid MAC."))?;
    if parts.next().is_some() {
        return Err(encrypted_error("encrypted data has too many fields."));
    }
    Ok(EncStringParts {
        iv,
        ciphertext,
        mac,
    })
}

fn decrypt_enc_string(
    encoded: &str,
    key: &BitwardenEncryptionKey,
) -> Result<Zeroizing<String>, BitwardenImportError> {
    let EncStringParts {
        iv,
        mut ciphertext,
        mac,
    } = decode_enc_string(encoded)?;
    let mut verifier = Hmac::<Sha256>::new_from_slice(key.authentication.as_ref())
        .map_err(|_| encrypted_error("authentication key has the wrong length."))?;
    verifier.update(&iv);
    verifier.update(ciphertext.as_ref());
    verifier
        .verify_slice(&mac)
        .map_err(|_| BitwardenImportError::InvalidPassword)?;

    let plaintext = cbc::Decryptor::<aes::Aes256>::new((&*key.encryption).into(), (&iv).into())
        .decrypt_padded::<Pkcs7>(ciphertext.as_mut())
        .map_err(|_| BitwardenImportError::InvalidPassword)?;
    let plaintext =
        String::from_utf8(plaintext.to_vec()).map_err(|_| BitwardenImportError::InvalidPassword)?;
    ciphertext.zeroize();
    Ok(Zeroizing::new(plaintext))
}

fn parse_items(value: &serde_json::Value) -> Result<Vec<BitwardenItem>, BitwardenImportError> {
    let items = value
        .get("items")
        .ok_or(BitwardenImportError::InvalidResponse)?;
    serde_json::from_value(items.clone()).map_err(Into::into)
}

fn append_bitwarden_metadata(
    notes: &mut String,
    metadata: impl IntoIterator<Item = (String, String)>,
) {
    super::import_support::append_import_metadata(notes, "Bitwarden", metadata);
}

fn custom_field_metadata(fields: Vec<BitwardenField>) -> Vec<(String, String)> {
    fields
        .into_iter()
        .enumerate()
        .map(|(index, field)| {
            let name = field.name.trim();
            let key = if name.is_empty() {
                format!("field[{}]", index + 1)
            } else {
                format!("field.{name}")
            };
            (key, field.value)
        })
        .collect()
}

fn convert_login(item: BitwardenItem) -> Option<SecretValue> {
    let login = item.login?;
    let uris = login
        .uris
        .into_iter()
        .map(|entry| entry.uri.trim().to_owned())
        .filter(|uri| !uri.is_empty())
        .collect::<Vec<_>>();
    let website_url = uris
        .first()
        .cloned()
        .unwrap_or_else(|| item.name.trim().to_owned());
    let mut metadata = Vec::new();
    metadata.push(("totp".to_owned(), login.totp));
    metadata.extend(
        uris.into_iter()
            .skip(1)
            .enumerate()
            .map(|(index, uri)| (format!("uri[{}]", index + 2), uri)),
    );
    metadata.extend(custom_field_metadata(item.fields));
    let mut notes = item.notes;
    append_bitwarden_metadata(&mut notes, metadata);

    Some(SecretValue::Login(LoginSecret {
        website_url: website_url.trim().to_owned(),
        username: login.username,
        password: login.password,
        notes,
    }))
}

fn convert_card(item: BitwardenItem) -> Option<SecretValue> {
    let card = item.card?;
    let mut notes = item.notes;
    let mut metadata = custom_field_metadata(item.fields);
    if !card.brand.trim().is_empty() {
        metadata.insert(0, ("brand".to_owned(), card.brand));
    }
    append_bitwarden_metadata(&mut notes, metadata);
    CreditCardSecret::from_fields(
        item.name.trim(),
        card.cardholder_name.trim(),
        card.number.trim(),
        card.exp_month.trim(),
        card.exp_year.trim(),
        card.code.trim(),
        &notes,
    )
    .ok()
    .map(SecretValue::CreditCard)
}

fn convert_item(item: BitwardenItem) -> Option<SecretValue> {
    match item.item_type {
        1 => convert_login(item),
        2 => {
            let mut notes = item.notes;
            append_bitwarden_metadata(&mut notes, custom_field_metadata(item.fields));
            Some(SecretValue::SecureNote(SecureNoteSecret {
                title: item.name.trim().to_owned(),
                note: notes,
            }))
        }
        3 => convert_card(item),
        _ => None,
    }
}

fn plan_plaintext(value: &serde_json::Value) -> Result<BitwardenImportPlan, BitwardenImportError> {
    let items = parse_items(value)?;
    let source_count = items.len();
    let converted = items
        .into_iter()
        .filter_map(convert_item)
        .collect::<Vec<_>>();
    let skipped_unsupported = source_count.saturating_sub(converted.len());
    Ok(BitwardenImportPlan {
        items: converted,
        source_count,
        skipped_unsupported,
    })
}

/// Parse a plaintext Bitwarden JSON export.
pub fn plan_bitwarden_import(json: &str) -> Result<BitwardenImportPlan, BitwardenImportError> {
    plan_bitwarden_import_with_password(json, None)
}

/// Parse a plaintext or password-protected encrypted Bitwarden JSON export.
pub fn plan_bitwarden_import_with_password(
    json: &str,
    password: Option<&str>,
) -> Result<BitwardenImportPlan, BitwardenImportError> {
    let value: serde_json::Value = serde_json::from_str(json)?;
    if !value
        .get("encrypted")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false)
    {
        return plan_plaintext(&value);
    }

    if value
        .get("passwordProtected")
        .and_then(serde_json::Value::as_bool)
        == Some(false)
    {
        return Err(BitwardenImportError::AccountRestrictedExport);
    }

    let export: EncryptedBitwardenExport = serde_json::from_value(value)
        .map_err(|error| encrypted_error(format!("missing or invalid metadata: {error}")))?;
    if !export.password_protected {
        return Err(BitwardenImportError::AccountRestrictedExport);
    }
    let password = password
        .filter(|password| !password.is_empty())
        .ok_or(BitwardenImportError::PasswordRequired)?;
    let key = derive_export_key(&export, password)?;
    decrypt_enc_string(&export.enc_key_validation, &key)?;
    let decrypted = decrypt_enc_string(&export.data, &key)?;
    let value: serde_json::Value = serde_json::from_str(decrypted.as_str())
        .map_err(|_| BitwardenImportError::InvalidPassword)?;
    plan_plaintext(&value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_export_login_fields() {
        let json = r#"{
          "items": [{
            "id": "bw-1", "type": 1, "name": "GitHub work", "notes": "recovery codes elsewhere",
            "fields": [{"name": "PIN", "value": "1234"}],
            "login": {"username": "alice", "password": "secret", "totp": "otpauth://secret",
              "uris": [{"uri": "https://github.com/login"}, {"uri": "https://gist.github.com"}]}}
          ]
        }"#;

        let plan = plan_bitwarden_import(json).unwrap();
        assert_eq!(plan.source_count, 1);
        assert_eq!(plan.skipped_unsupported, 0);
        let SecretValue::Login(login) = &plan.items[0] else {
            panic!("expected login")
        };
        assert_eq!(login.website_url, "https://github.com/login");
        assert_eq!(login.username, "alice");
        assert_eq!(login.password, "secret");
        assert_eq!(
            login.notes,
            "recovery codes elsewhere\n\n## Bitwarden\n- totp: otpauth://secret\n- uri[2]: https://gist.github.com\n- field.PIN: 1234"
        );
    }

    #[test]
    fn converts_plaintext_export_notes_and_skips_unsupported_items() {
        let json = r#"{"items":[
          {"type":2,"name":"Private note","notes":"hello"},
          {"type":3,"name":"Card","card":{"cardholderName":"Ada","number":"4111111111111111","expMonth":"12","expYear":"2030","code":"123","brand":"Visa"}},
          {"type":4,"name":"Identity"}
        ]}"#;
        let plan = plan_bitwarden_import(json).unwrap();
        assert_eq!(plan.source_count, 3);
        assert_eq!(plan.skipped_unsupported, 1);
        assert_eq!(plan.items.len(), 2);
        assert_eq!(
            plan.items[0],
            SecretValue::SecureNote(SecureNoteSecret {
                title: "Private note".to_owned(),
                note: "hello".to_owned(),
            })
        );
        let SecretValue::CreditCard(card) = &plan.items[1] else {
            panic!("expected credit card");
        };
        assert_eq!(card.title, "Card");
        assert_eq!(card.number, "4111111111111111");
        assert_eq!(card.cardholder_name, "Ada");
        assert!(card.notes.contains("brand: Visa"));
    }

    #[test]
    fn preserves_secure_note_custom_fields() {
        let plan = plan_bitwarden_import(
            r#"{"items":[{
                "type":2,
                "name":"Recovery",
                "notes":"Keep offline",
                "fields":[
                    {"name":"answer","value":"blue"},
                    {"name":null,"value":"unnamed secret"},
                    {"name":"empty","value":null}
                ]
            }]}"#,
        )
        .unwrap();
        assert_eq!(
            plan.items,
            vec![SecretValue::SecureNote(SecureNoteSecret {
                title: "Recovery".to_owned(),
                note:
                    "Keep offline\n\n## Bitwarden\n- field.answer: blue\n- field[2]: unnamed secret"
                        .to_owned(),
            })]
        );
    }

    #[test]
    fn accepts_real_export_shape_with_folders_dates_nulls_and_fido_fields() {
        let plan =
            plan_bitwarden_import(include_str!("fixtures/bitwarden_real_export.json")).unwrap();
        assert_eq!(plan.source_count, 2);
        assert_eq!(plan.skipped_unsupported, 0);
        assert_eq!(plan.items.len(), 2);

        let SecretValue::Login(first) = &plan.items[0] else {
            panic!("expected first login")
        };
        assert_eq!(first.website_url, "https://my.1password.com/signin");
        assert_eq!(first.username, "");
        assert_eq!(first.password, "");
        assert_eq!(first.notes, "bla bla bla");

        let SecretValue::Login(second) = &plan.items[1] else {
            panic!("expected second login")
        };
        assert_eq!(second.website_url, "http://rabbitmq.9dev.io:15672/");
        assert_eq!(second.username, "guest");
        assert_eq!(second.password, "guest");
    }

    #[test]
    fn accepts_null_optional_login_fields() {
        let plan = plan_bitwarden_import(
            r#"{"items":[{"type":1,"name":"Example","notes":null,"login":{"username":null,"password":"pw","totp":null,"uris":[{"uri":null}]}}]}"#,
        )
        .unwrap();
        let SecretValue::Login(login) = &plan.items[0] else {
            panic!("expected login")
        };
        assert_eq!(login.website_url, "Example");
        assert_eq!(login.username, "");
        assert_eq!(login.password, "pw");
    }

    #[test]
    fn password_is_required_for_password_protected_exports() {
        let error = plan_bitwarden_import(
            r#"{"encrypted":true,"passwordProtected":true,"salt":"salt","kdfType":0,"kdfIterations":600000,"encKeyValidation_DO_NOT_EDIT":"2.a|b|c","data":"2.a|b|c"}"#,
        )
        .unwrap_err();
        assert!(matches!(error, BitwardenImportError::PasswordRequired));
    }

    #[test]
    fn recognizes_current_bitwarden_million_iteration_encrypted_export_envelope() {
        // Mirrors a current real-world password-protected export without
        // retaining the user's encrypted vault payload in the repository.
        let error = plan_bitwarden_import(
            r#"{
                "encrypted": true,
                "passwordProtected": true,
                "salt": "H9dHvU7fbVqilXoI625l+g==",
                "kdfType": 0,
                "kdfIterations": 1000000,
                "encKeyValidation_DO_NOT_EDIT": "2.AAECAwQFBgcICQoLDA0ODw==|AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA|AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
                "data": "2.EBESExQVFhcYGRobHB0eHw==|AAAAAAAAAAAAAAAAAAAAAA==|AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
            }"#,
        )
        .unwrap_err();
        assert!(matches!(error, BitwardenImportError::PasswordRequired));
    }

    #[test]
    fn rejects_account_restricted_exports() {
        let error = plan_bitwarden_import_with_password(
            r#"{"encrypted":true,"passwordProtected":false,"salt":"","kdfType":0,"kdfIterations":600000,"encKeyValidation_DO_NOT_EDIT":"","data":""}"#,
            Some("password"),
        )
        .unwrap_err();
        assert!(matches!(
            error,
            BitwardenImportError::AccountRestrictedExport
        ));
    }

    #[test]
    fn decrypts_bitwarden_password_protected_pbkdf2_fixture() {
        let plan = plan_bitwarden_import_with_password(
            include_str!("fixtures/bitwarden_encrypted_pbkdf2.json"),
            Some("correct horse battery staple"),
        )
        .unwrap();
        assert_eq!(plan.source_count, 2);
        assert_eq!(plan.skipped_unsupported, 0);
        assert_eq!(plan.items.len(), 2);
    }

    #[test]
    fn derives_bitwarden_argon2id_export_key() {
        // Expected values come from Bitwarden SDK's Argon2id KDF vector, then
        // its documented HKDF "enc" / "mac" expansion.
        let export = EncryptedBitwardenExport {
            password_protected: true,
            salt: "test_key".to_owned(),
            kdf_type: 1,
            kdf_iterations: 4,
            kdf_memory: Some(32),
            kdf_parallelism: Some(2),
            enc_key_validation: String::new(),
            data: String::new(),
        };
        let key = derive_export_key(&export, "67t9b5g67$%Dh89n").unwrap();
        assert_eq!(
            *key.encryption,
            [
                236, 253, 166, 121, 207, 124, 98, 149, 42, 141, 97, 226, 207, 71, 173, 60, 10, 0,
                184, 255, 252, 87, 62, 32, 188, 166, 173, 223, 146, 159, 222, 219,
            ]
        );
        assert_eq!(
            *key.authentication,
            [
                214, 144, 76, 173, 225, 106, 132, 131, 173, 56, 134, 241, 223, 227, 165, 161, 146,
                37, 111, 206, 155, 24, 224, 151, 134, 189, 202, 0, 27, 149, 131, 21,
            ]
        );
    }

    #[test]
    fn rejects_wrong_password_for_encrypted_fixture() {
        let error = plan_bitwarden_import_with_password(
            include_str!("fixtures/bitwarden_encrypted_pbkdf2.json"),
            Some("wrong password"),
        )
        .unwrap_err();
        assert!(matches!(error, BitwardenImportError::InvalidPassword));
    }
}

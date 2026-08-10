//! Password-encrypted enrollment envelopes and their browser deep links.

use super::{
    DecryptedEnrollmentPayload, EnrollmentCodeEnvelope, EnrollmentEntryLabel, EnrollmentIssueInput,
    EnrollmentProviderPayload, validate_provider,
};
use crate::errors::{EnrollmentError, EnrollmentResult};
use aes_gcm::{
    Aes256Gcm,
    aead::{Aead, KeyInit, array::Array},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use getrandom::fill;
use pbkdf2::{pbkdf2_hmac, sha2::Sha256};
use percent_encoding::{AsciiSet, CONTROLS, percent_decode_str, utf8_percent_encode};

const PBKDF2_ITERATIONS: u32 = 210_000;
const SALT_LEN: usize = 16;
const IV_LEN: usize = 12;
const KEY_LEN: usize = 32;
const ENROLLMENT_KDF: &str = "pbkdf2-sha256";
const ENROLLMENT_CIPHER: &str = "aes-gcm-256";
const ENROLLMENT_HASH_PREFIX: &str = "#enroll=";

const ENCODE_URI_COMPONENT: &AsciiSet = &CONTROLS
    .add(b' ')
    .add(b'"')
    .add(b'#')
    .add(b'$')
    .add(b'%')
    .add(b'&')
    .add(b'+')
    .add(b',')
    .add(b'/')
    .add(b':')
    .add(b';')
    .add(b'<')
    .add(b'=')
    .add(b'>')
    .add(b'?')
    .add(b'@')
    .add(b'[')
    .add(b'\\')
    .add(b']')
    .add(b'^')
    .add(b'`')
    .add(b'{')
    .add(b'|')
    .add(b'}');

pub fn encrypt_enrollment_payload(
    payload: &EnrollmentIssueInput,
    password: &str,
    entry_label: &str,
) -> EnrollmentResult<String> {
    let password = password.trim();
    if password.is_empty() {
        return Err(EnrollmentError::EncryptPasswordRequired);
    }

    let entry_id = payload.entry_id.trim();
    if entry_id.is_empty() {
        return Err(EnrollmentError::EntryIdRequired);
    }

    validate_provider(&payload.provider)?;
    let vault_name = payload.vault_name.trim();
    if vault_name.is_empty() {
        return Err(EnrollmentError::MissingField {
            field: "vault_name",
        });
    }

    let inner = EnrollmentProviderPayload {
        provider: payload.provider.clone(),
        vault_name: vault_name.to_owned(),
    };
    let mut salt = [0u8; SALT_LEN];
    let mut iv = [0u8; IV_LEN];
    fill(&mut salt).map_err(|e| EnrollmentError::RandomBytes(e.to_string()))?;
    fill(&mut iv).map_err(|e| EnrollmentError::RandomBytes(e.to_string()))?;

    let key = derive_enrollment_key(password, &salt, PBKDF2_ITERATIONS);
    let cipher = Aes256Gcm::new(&Array(key));
    let plaintext = serde_json::to_vec(&inner).map_err(EnrollmentError::Serialize)?;
    let ciphertext = cipher
        .encrypt(&Array(iv), plaintext.as_slice())
        .map_err(|_| EnrollmentError::WrongPassword)?;

    let label = entry_label.trim();
    let envelope = EnrollmentCodeEnvelope {
        entry_id: entry_id.to_owned(),
        entry_label: if label.is_empty() {
            EnrollmentEntryLabel::Unlabeled
        } else {
            EnrollmentEntryLabel::Labeled(label.to_owned())
        },
        issued_at: payload.issued_at.clone(),
        kdf: ENROLLMENT_KDF.to_owned(),
        iterations: PBKDF2_ITERATIONS,
        salt: base64_url_encode(&salt),
        cipher: ENROLLMENT_CIPHER.to_owned(),
        iv: base64_url_encode(&iv),
        ct: base64_url_encode(&ciphertext),
    };
    let encoded = serde_json::to_vec(&envelope).map_err(EnrollmentError::Serialize)?;
    Ok(base64_url_encode(&encoded))
}

pub fn decrypt_enrollment_payload(
    code: &str,
    password: &str,
) -> EnrollmentResult<DecryptedEnrollmentPayload> {
    let envelope = parse_enrollment_envelope(code)?;
    let password = password.trim();
    if password.is_empty() {
        return Err(EnrollmentError::DecryptPasswordRequired);
    }

    let salt = base64_url_decode(&envelope.salt)?;
    let iv = decode_fixed::<IV_LEN>(&envelope.iv)?;
    let ciphertext = base64_url_decode(&envelope.ct)?;
    let key = derive_enrollment_key(password, &salt, envelope.iterations);
    let cipher = Aes256Gcm::new(&Array(key));
    let plaintext = cipher
        .decrypt(&Array(iv), ciphertext.as_slice())
        .map_err(|_| EnrollmentError::WrongPassword)?;
    let provider_payload: EnrollmentProviderPayload =
        serde_json::from_slice(&plaintext).map_err(|_| EnrollmentError::WrongPassword)?;
    let EnrollmentProviderPayload {
        provider,
        vault_name,
    } = provider_payload;
    validate_provider(&provider)?;
    if vault_name.trim().is_empty() {
        return Err(EnrollmentError::WrongPassword);
    }

    Ok(DecryptedEnrollmentPayload {
        provider,
        vault_name,
        entry_id: envelope.entry_id,
        issued_at: envelope.issued_at,
    })
}

pub fn parse_enrollment_envelope(code: &str) -> EnrollmentResult<EnrollmentCodeEnvelope> {
    let cleaned = code.trim();
    if cleaned.is_empty() {
        return Err(EnrollmentError::InvalidCode);
    }
    let bytes = base64_url_decode(cleaned)?;
    let envelope: EnrollmentCodeEnvelope =
        serde_json::from_slice(&bytes).map_err(|_| EnrollmentError::InvalidCode)?;
    validate_envelope(&envelope)?;
    Ok(envelope)
}

/// Deep link scanned from a QR code — opens the browser and carries the raw
/// enrollment code in the hash. The browser supplies `base_url`.
#[must_use]
pub fn build_enrollment_link(code: &str, base_url: &str) -> String {
    let base = base_url.trim_end_matches('/');
    let encoded = utf8_percent_encode(code, ENCODE_URI_COMPONENT).to_string();
    format!("{base}/{ENROLLMENT_HASH_PREFIX}{encoded}")
}

/// Accept raw base64url enrollment codes or full enrollment links.
#[must_use]
pub fn normalize_enrollment_code(input: &str) -> String {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    if trimmed.contains("://") {
        if let Some(raw) = enrollment_query_value(trimmed) {
            return decode_uri_component(raw);
        }
        if let Some(hash) = trimmed.split_once('#').map(|(_, hash)| hash) {
            let prefixed = format!("#{hash}");
            if let Some(raw) = prefixed.strip_prefix(ENROLLMENT_HASH_PREFIX) {
                return decode_uri_component(raw);
            }
        }
    }

    if let Some(raw) = trimmed.strip_prefix(ENROLLMENT_HASH_PREFIX) {
        return decode_uri_component(raw);
    }

    if let Some(raw) = enrollment_query_value(trimmed) {
        return decode_uri_component(raw);
    }

    trimmed.to_owned()
}

pub fn peek_enrollment_entry_id(code: &str) -> EnrollmentResult<String> {
    Ok(parse_enrollment_envelope(code)?.entry_id)
}

pub fn peek_enrollment_entry_label(code: &str) -> EnrollmentResult<EnrollmentEntryLabel> {
    Ok(parse_enrollment_envelope(code)?.entry_label)
}

pub fn peek_enrollment_issued_at(code: &str) -> EnrollmentResult<String> {
    Ok(parse_enrollment_envelope(code)?.issued_at)
}

fn validate_envelope(envelope: &EnrollmentCodeEnvelope) -> EnrollmentResult<()> {
    if envelope.kdf != ENROLLMENT_KDF || envelope.cipher != ENROLLMENT_CIPHER {
        return Err(EnrollmentError::UnsupportedEncryptionParameters);
    }
    if envelope.iterations == 0 {
        return Err(EnrollmentError::MissingKdfParameters);
    }
    if envelope.entry_id.is_empty() {
        return Err(EnrollmentError::MissingEntryId);
    }
    if matches!(&envelope.entry_label, EnrollmentEntryLabel::Labeled(label) if label.is_empty()) {
        return Err(EnrollmentError::InvalidEntryLabel);
    }
    for (field, value) in [
        ("salt", envelope.salt.as_str()),
        ("iv", envelope.iv.as_str()),
        ("ct", envelope.ct.as_str()),
        ("issued_at", envelope.issued_at.as_str()),
    ] {
        if value.is_empty() {
            return Err(EnrollmentError::MissingField { field });
        }
    }
    Ok(())
}

fn derive_enrollment_key(password: &str, salt: &[u8], iterations: u32) -> [u8; KEY_LEN] {
    let mut key = [0u8; KEY_LEN];
    pbkdf2_hmac::<Sha256>(password.as_bytes(), salt, iterations, &mut key);
    key
}

fn decode_fixed<const N: usize>(encoded: &str) -> EnrollmentResult<[u8; N]> {
    let bytes = base64_url_decode(encoded)?;
    bytes.try_into().map_err(|_| EnrollmentError::InvalidCode)
}

fn base64_url_encode(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

fn base64_url_decode(encoded: &str) -> EnrollmentResult<Vec<u8>> {
    URL_SAFE_NO_PAD
        .decode(encoded)
        .map_err(|_| EnrollmentError::InvalidCode)
}

fn enrollment_query_value(input: &str) -> Option<&str> {
    let query = input
        .split_once('?')?
        .1
        .split('#')
        .next()
        .unwrap_or_default();
    query.split('&').find_map(|part| {
        let (key, value) = part.split_once('=')?;
        (key == "enroll").then_some(value)
    })
}

fn decode_uri_component(value: &str) -> String {
    percent_decode_str(value).decode_utf8_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::enrollment::{EnrollmentProvider, PersonalEnrollmentProvider};
    use serde_json::json;

    fn github_payload() -> EnrollmentIssueInput {
        EnrollmentIssueInput {
            provider: EnrollmentProvider::personal(PersonalEnrollmentProvider::github(
                "github_pat_11AAAAbbbbCCCC".to_owned(),
                "team-vault".to_owned(),
            )),
            vault_name: "Team vault".to_owned(),
            entry_id: "entry-1".to_owned(),
            issued_at: "2026-06-23T12:00:00Z".to_owned(),
        }
    }

    #[test]
    fn encrypts_provider_credentials_and_peeks_outer_fields() -> anyhow::Result<()> {
        let code = encrypt_enrollment_payload(&github_payload(), "vault-pass-99", "Work laptop")?;
        assert_eq!(peek_enrollment_entry_id(&code)?, "entry-1");
        assert_eq!(
            peek_enrollment_entry_label(&code)?,
            EnrollmentEntryLabel::Labeled("Work laptop".to_owned())
        );
        assert_eq!(peek_enrollment_issued_at(&code)?, "2026-06-23T12:00:00Z");

        let envelope = parse_enrollment_envelope(&code)?;
        let serialized = serde_json::to_string(&envelope)?;
        assert!(!serialized.contains("vault-pass-99"));
        assert!(!serialized.contains("github_pat_11AAAAbbbbCCCC"));
        assert!(!serialized.contains("Team vault"));
        assert!(!envelope.ct.is_empty());
        Ok(())
    }

    #[test]
    fn enrollment_link_roundtrip_normalizes_hash_and_query_forms() {
        let code = "abc-123_DEF";
        let link = build_enrollment_link(code, "https://nook.example/");
        assert_eq!(link, "https://nook.example/#enroll=abc-123_DEF");
        assert_eq!(normalize_enrollment_code(&link), code);
        assert_eq!(
            normalize_enrollment_code("https://nook.example/?enroll=abc%20123"),
            "abc 123"
        );
        assert_eq!(normalize_enrollment_code("#enroll=abc%2F123"), "abc/123");
        assert_eq!(normalize_enrollment_code("  raw-code  "), "raw-code");
    }

    #[test]
    fn decrypts_roundtrip_payload() -> anyhow::Result<()> {
        let input = github_payload();
        let code = encrypt_enrollment_payload(&input, "vault-pass-99", "")?;
        let decrypted = decrypt_enrollment_payload(&code, "vault-pass-99")?;
        assert_eq!(decrypted.provider, input.provider);
        assert_eq!(decrypted.vault_name, "Team vault");
        assert_eq!(decrypted.entry_id, input.entry_id);
        assert_eq!(decrypted.issued_at, input.issued_at);
        Ok(())
    }

    #[test]
    fn rejects_wrong_password() -> anyhow::Result<()> {
        let code = encrypt_enrollment_payload(&github_payload(), "hunter2", "")?;
        let err = decrypt_enrollment_payload(&code, "wrong-pass")
            .err()
            .ok_or_else(|| anyhow::anyhow!("enrollment test should reject invalid input"))?;
        assert_eq!(
            err.to_string(),
            "Vault password does not decrypt this enrollment code."
        );
        Ok(())
    }

    #[test]
    fn rejects_malformed_codes() -> anyhow::Result<()> {
        let malformed = base64_url_encode(
            serde_json::to_vec(&json!({"provider": {"type": "local"}}))?.as_slice(),
        );
        let err = decrypt_enrollment_payload(&malformed, "pw")
            .err()
            .ok_or_else(|| anyhow::anyhow!("enrollment test should reject invalid input"))?;
        assert_eq!(err.to_string(), "Invalid enrollment code.");
        assert!(peek_enrollment_entry_id(&malformed).is_err());
        Ok(())
    }
}

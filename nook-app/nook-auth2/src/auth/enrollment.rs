//! Enrollment-code payloads for one-step QR-based device joins.

use aes_gcm::{
    Aes256Gcm,
    aead::{Aead, KeyInit, array::Array},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use getrandom::getrandom;
use pbkdf2::{pbkdf2_hmac, sha2::Sha256};
use percent_encoding::{AsciiSet, CONTROLS, percent_decode_str, utf8_percent_encode};
use serde::{Deserialize, Serialize};
use std::marker::PhantomData;

use crate::errors::{EnrollmentError, EnrollmentResult};

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

/// Marker state for enrollment payloads that intentionally transfer the
/// selected provider credential inside the encrypted enrollment code.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PersonalCredentialTransfer;

/// Marker state for enrollment payloads that carry only a shared provider
/// target. There is deliberately no credential-bearing constructor for this
/// state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SharedProviderGrant;

mod enrollment_state_sealed {
    pub trait Sealed {}
}

/// Sealed mapping from an onboarding typestate to the only provider data shape
/// legal in that state.
pub trait EnrollmentState:
    enrollment_state_sealed::Sealed + std::fmt::Debug + Clone + PartialEq + Eq
{
    type Provider: std::fmt::Debug + Clone + PartialEq + Eq;
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum PersonalEnrollmentProviderData {
    Local,
    Github {
        pat: String,
        repo: String,
    },
    #[serde(rename = "oauth-file")]
    OauthFile {
        preset: String,
        access_token: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        refresh_token: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        expires_at: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        file_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        file_name: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        account_email: Option<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum SharedEnrollmentProviderData {
    #[serde(rename = "shared-provider-grant")]
    GoogleDrive {
        sync_provider_type: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        oauth_preset: Option<String>,
        joiner_identity_kind: String,
        joiner_identity: String,
        /// Shared Drive folder id (or other provider storage target) the joiner
        /// syncs under with their own OAuth token. Absent for legacy codes that
        /// relied on a manual grant ceremony only.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        storage_target_id: Option<String>,
    },
    /// Credential-free `CloudKit` share handoff. The target contains only the
    /// stable share/zone location; the recipient authenticates with their own
    /// iCloud account before accepting it.
    #[serde(rename = "icloud-shared")]
    ICloud { storage_target_id: String },
}

impl enrollment_state_sealed::Sealed for PersonalCredentialTransfer {}

impl EnrollmentState for PersonalCredentialTransfer {
    type Provider = PersonalEnrollmentProviderData;
}

impl enrollment_state_sealed::Sealed for SharedProviderGrant {}

impl EnrollmentState for SharedProviderGrant {
    type Provider = SharedEnrollmentProviderData;
}

/// A provider whose legal fields are selected by the compile-time onboarding
/// state. The private fields prevent constructing a shared state from personal
/// provider data (and therefore from OAuth/PAT credentials).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
#[serde(bound(
    serialize = "State::Provider: Serialize",
    deserialize = "State::Provider: Deserialize<'de>"
))]
pub struct TypedEnrollmentProvider<State: EnrollmentState> {
    provider: State::Provider,
    #[serde(skip)]
    state: PhantomData<State>,
}

pub type PersonalEnrollmentProvider = TypedEnrollmentProvider<PersonalCredentialTransfer>;
pub type SharedEnrollmentProvider = TypedEnrollmentProvider<SharedProviderGrant>;

impl PersonalEnrollmentProvider {
    #[must_use]
    pub fn local() -> Self {
        Self {
            provider: PersonalEnrollmentProviderData::Local,
            state: PhantomData,
        }
    }

    #[must_use]
    pub fn github(pat: String, repo: String) -> Self {
        Self {
            provider: PersonalEnrollmentProviderData::Github { pat, repo },
            state: PhantomData,
        }
    }

    #[allow(clippy::too_many_arguments)]
    #[must_use]
    pub fn oauth_file(
        preset: String,
        access_token: String,
        refresh_token: Option<String>,
        expires_at: Option<String>,
        file_id: Option<String>,
        file_name: Option<String>,
        account_email: Option<String>,
    ) -> Self {
        Self {
            provider: PersonalEnrollmentProviderData::OauthFile {
                preset,
                access_token,
                refresh_token,
                expires_at,
                file_id,
                file_name,
                account_email,
            },
            state: PhantomData,
        }
    }

    #[must_use]
    pub const fn data(&self) -> &PersonalEnrollmentProviderData {
        &self.provider
    }
}

impl SharedEnrollmentProvider {
    /// Construct a shared Google Drive target. Credentials are not accepted by
    /// this typestate constructor.
    ///
    /// ```compile_fail
    /// use nook_auth2::SharedEnrollmentProvider;
    /// SharedEnrollmentProvider::google_drive(
    ///     "joiner@example.com".to_owned(),
    ///     "shared-folder".to_owned(),
    ///     "owner-oauth-token".to_owned(),
    /// );
    /// ```
    #[must_use]
    pub fn google_drive(joiner_identity: String, storage_target_id: String) -> Self {
        Self {
            provider: SharedEnrollmentProviderData::GoogleDrive {
                sync_provider_type: "oauth-file".to_owned(),
                oauth_preset: Some("google-drive".to_owned()),
                joiner_identity_kind: "email".to_owned(),
                joiner_identity,
                storage_target_id: Some(storage_target_id),
            },
            state: PhantomData,
        }
    }

    #[must_use]
    pub fn legacy_google_drive(
        sync_provider_type: String,
        oauth_preset: Option<String>,
        joiner_identity_kind: String,
        joiner_identity: String,
        storage_target_id: Option<String>,
    ) -> Self {
        Self {
            provider: SharedEnrollmentProviderData::GoogleDrive {
                sync_provider_type,
                oauth_preset,
                joiner_identity_kind,
                joiner_identity,
                storage_target_id,
            },
            state: PhantomData,
        }
    }

    #[must_use]
    pub fn icloud(storage_target_id: String) -> Self {
        Self {
            provider: SharedEnrollmentProviderData::ICloud { storage_target_id },
            state: PhantomData,
        }
    }

    #[must_use]
    pub const fn data(&self) -> &SharedEnrollmentProviderData {
        &self.provider
    }
}

/// Type-erased enrollment provider used at serialization and WASM boundaries.
/// Each variant contains a provider already proven to be in the corresponding
/// typestate, so a shared payload cannot contain personal credentials.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "onboardingType",
    content = "provider",
    rename_all = "kebab-case"
)]
pub enum EnrollmentProvider {
    PersonalCredentialTransfer(PersonalEnrollmentProvider),
    SharedProviderGrant(SharedEnrollmentProvider),
}

impl EnrollmentProvider {
    #[must_use]
    pub const fn personal(provider: PersonalEnrollmentProvider) -> Self {
        Self::PersonalCredentialTransfer(provider)
    }

    #[must_use]
    pub const fn shared(provider: SharedEnrollmentProvider) -> Self {
        Self::SharedProviderGrant(provider)
    }

    #[must_use]
    pub const fn personal_data(&self) -> Option<&PersonalEnrollmentProviderData> {
        match self {
            Self::PersonalCredentialTransfer(provider) => Some(provider.data()),
            Self::SharedProviderGrant(_) => None,
        }
    }

    #[must_use]
    pub const fn shared_data(&self) -> Option<&SharedEnrollmentProviderData> {
        match self {
            Self::PersonalCredentialTransfer(_) => None,
            Self::SharedProviderGrant(provider) => Some(provider.data()),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnrollmentIssueInput {
    pub provider: EnrollmentProvider,
    pub vault_name: String,
    pub entry_id: String,
    pub issued_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecryptedEnrollmentPayload {
    pub provider: EnrollmentProvider,
    pub vault_name: Option<String>,
    pub entry_id: String,
    pub issued_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EnrollmentCodeEnvelope {
    pub entry_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entry_label: Option<String>,
    pub issued_at: String,
    pub kdf: String,
    pub iterations: u32,
    pub salt: String,
    pub cipher: String,
    pub iv: String,
    pub ct: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct EnrollmentProviderPayload {
    provider: EnrollmentProvider,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    vault_name: Option<String>,
}

/// Compatibility decoder for enrollment codes issued before onboarding mode
/// became an explicit wire field. A legacy OAuth provider is always classified
/// as personal; it can never be reinterpreted as a shared provider grant.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(untagged)]
enum LegacyEnrollmentProvider {
    Personal(PersonalEnrollmentProviderData),
    Shared(SharedEnrollmentProviderData),
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
struct LegacyEnrollmentProviderPayload {
    provider: LegacyEnrollmentProvider,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(untagged)]
enum DecodableEnrollmentProviderPayload {
    Typed(EnrollmentProviderPayload),
    Legacy(LegacyEnrollmentProviderPayload),
}

impl DecodableEnrollmentProviderPayload {
    fn into_provider(self) -> EnrollmentProvider {
        match self {
            Self::Typed(payload) => payload.provider,
            Self::Legacy(payload) => match payload.provider {
                LegacyEnrollmentProvider::Personal(provider) => {
                    EnrollmentProvider::personal(TypedEnrollmentProvider {
                        provider,
                        state: PhantomData,
                    })
                }
                LegacyEnrollmentProvider::Shared(provider) => {
                    EnrollmentProvider::shared(TypedEnrollmentProvider {
                        provider,
                        state: PhantomData,
                    })
                }
            },
        }
    }
}

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

    let inner = EnrollmentProviderPayload {
        provider: payload.provider.clone(),
        vault_name: (!payload.vault_name.trim().is_empty())
            .then(|| payload.vault_name.trim().to_owned()),
    };
    let mut salt = [0u8; SALT_LEN];
    let mut iv = [0u8; IV_LEN];
    getrandom(&mut salt).map_err(|e| EnrollmentError::RandomBytes(e.to_string()))?;
    getrandom(&mut iv).map_err(|e| EnrollmentError::RandomBytes(e.to_string()))?;

    let key = derive_enrollment_key(password, &salt, PBKDF2_ITERATIONS);
    let cipher = Aes256Gcm::new(&Array(key));
    let plaintext = serde_json::to_vec(&inner).map_err(EnrollmentError::Serialize)?;
    let ciphertext = cipher
        .encrypt(&Array(iv), plaintext.as_slice())
        .map_err(|_| EnrollmentError::WrongPassword)?;

    let label = entry_label.trim();
    let envelope = EnrollmentCodeEnvelope {
        entry_id: entry_id.to_owned(),
        entry_label: (!label.is_empty()).then(|| label.to_owned()),
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
    let provider_payload: DecodableEnrollmentProviderPayload =
        serde_json::from_slice(&plaintext).map_err(|_| EnrollmentError::WrongPassword)?;
    let (provider, vault_name) = match provider_payload {
        DecodableEnrollmentProviderPayload::Typed(payload) => {
            (payload.provider, payload.vault_name)
        }
        legacy @ DecodableEnrollmentProviderPayload::Legacy(_) => (legacy.into_provider(), None),
    };
    validate_provider(&provider)?;

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
        serde_json::from_slice(&bytes).map_err(|e| classify_envelope_parse_error(&e))?;
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

#[must_use]
pub fn peek_enrollment_entry_id(code: &str) -> Option<String> {
    parse_enrollment_envelope(code)
        .ok()
        .map(|envelope| envelope.entry_id)
}

#[must_use]
pub fn peek_enrollment_entry_label(code: &str) -> Option<String> {
    parse_enrollment_envelope(code)
        .ok()
        .and_then(|envelope| envelope.entry_label)
}

#[must_use]
pub fn peek_enrollment_issued_at(code: &str) -> Option<String> {
    parse_enrollment_envelope(code)
        .ok()
        .map(|envelope| envelope.issued_at)
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
    if envelope
        .entry_label
        .as_ref()
        .is_some_and(std::string::String::is_empty)
    {
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

fn validate_provider(provider: &EnrollmentProvider) -> EnrollmentResult<()> {
    match provider {
        EnrollmentProvider::PersonalCredentialTransfer(provider) => match provider.data() {
            PersonalEnrollmentProviderData::Local => Ok(()),
            PersonalEnrollmentProviderData::Github { pat, repo } => {
                if pat.is_empty() || repo.is_empty() {
                    return Err(EnrollmentError::MalformedGithubProvider);
                }
                Ok(())
            }
            PersonalEnrollmentProviderData::OauthFile {
                preset,
                access_token,
                ..
            } => {
                if !matches!(preset.as_str(), "google-drive" | "icloud")
                    || access_token.trim().is_empty()
                {
                    return Err(EnrollmentError::MalformedOauthFileProvider);
                }
                Ok(())
            }
        },
        EnrollmentProvider::SharedProviderGrant(provider) => match provider.data() {
            SharedEnrollmentProviderData::GoogleDrive {
                sync_provider_type,
                oauth_preset,
                joiner_identity_kind,
                joiner_identity,
                storage_target_id,
            } => {
                if sync_provider_type.trim() != "oauth-file"
                    || oauth_preset.as_deref().unwrap_or("google-drive") != "google-drive"
                    || joiner_identity_kind.trim() != "email"
                    || !is_plausible_email(joiner_identity)
                {
                    return Err(EnrollmentError::MalformedSharedProviderGrant);
                }
                if storage_target_id
                    .as_deref()
                    .is_none_or(|target| target.trim().is_empty())
                {
                    return Err(EnrollmentError::MalformedSharedProviderGrant);
                }
                Ok(())
            }
            SharedEnrollmentProviderData::ICloud { storage_target_id } => {
                if storage_target_id.trim().is_empty()
                    || !storage_target_id.trim().starts_with("icloud-share-v1:")
                {
                    return Err(EnrollmentError::MalformedSharedProviderGrant);
                }
                Ok(())
            }
        },
    }
}

#[must_use]
pub fn is_plausible_email(value: &str) -> bool {
    let trimmed = value.trim();
    let Some((local, domain)) = trimmed.split_once('@') else {
        return false;
    };
    !local.is_empty()
        && domain.contains('.')
        && !domain.starts_with('.')
        && !domain.ends_with('.')
        && !trimmed.chars().any(char::is_whitespace)
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

fn classify_envelope_parse_error(_error: &serde_json::Error) -> EnrollmentError {
    EnrollmentError::InvalidCode
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
    fn encrypts_provider_credentials_and_peeks_outer_fields() {
        let code = encrypt_enrollment_payload(&github_payload(), "vault-pass-99", "Work laptop")
            .expect("encrypt enrollment");
        assert_eq!(peek_enrollment_entry_id(&code).as_deref(), Some("entry-1"));
        assert_eq!(
            peek_enrollment_entry_label(&code).as_deref(),
            Some("Work laptop")
        );
        assert_eq!(
            peek_enrollment_issued_at(&code).as_deref(),
            Some("2026-06-23T12:00:00Z")
        );

        let envelope = parse_enrollment_envelope(&code).unwrap();
        let serialized = serde_json::to_string(&envelope).unwrap();
        assert!(!serialized.contains("vault-pass-99"));
        assert!(!serialized.contains("github_pat_11AAAAbbbbCCCC"));
        assert!(!serialized.contains("Team vault"));
        assert!(!envelope.ct.is_empty());
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
    fn decrypts_roundtrip_payload() {
        let input = github_payload();
        let code = encrypt_enrollment_payload(&input, "vault-pass-99", "").unwrap();
        let decrypted = decrypt_enrollment_payload(&code, "vault-pass-99").unwrap();
        assert_eq!(decrypted.provider, input.provider);
        assert_eq!(decrypted.vault_name.as_deref(), Some("Team vault"));
        assert_eq!(decrypted.entry_id, input.entry_id);
        assert_eq!(decrypted.issued_at, input.issued_at);
    }

    #[test]
    fn rejects_wrong_password() {
        let code = encrypt_enrollment_payload(&github_payload(), "hunter2", "").unwrap();
        let err = decrypt_enrollment_payload(&code, "wrong-pass").unwrap_err();
        assert_eq!(
            err.to_string(),
            "Vault password does not decrypt this enrollment code."
        );
    }

    #[test]
    fn rejects_malformed_codes() {
        let malformed = base64_url_encode(
            serde_json::to_vec(&json!({"provider": {"type": "local"}}))
                .unwrap()
                .as_slice(),
        );
        let err = decrypt_enrollment_payload(&malformed, "pw").unwrap_err();
        assert_eq!(err.to_string(), "Invalid enrollment code.");
        assert_eq!(peek_enrollment_entry_id(&malformed), None);
    }

    #[test]
    fn preserves_local_provider() {
        let input = EnrollmentIssueInput {
            provider: EnrollmentProvider::personal(PersonalEnrollmentProvider::local()),
            vault_name: "Local vault".to_owned(),
            entry_id: "entry-local".to_owned(),
            issued_at: "2026-06-23T12:00:00Z".to_owned(),
        };
        let code = encrypt_enrollment_payload(&input, "hunter2", "").unwrap();
        let decrypted = decrypt_enrollment_payload(&code, "hunter2").unwrap();
        assert_eq!(
            decrypted.provider,
            EnrollmentProvider::personal(PersonalEnrollmentProvider::local())
        );
    }

    #[test]
    fn shared_provider_grant_roundtrips_without_provider_credentials() {
        let input = EnrollmentIssueInput {
            provider: EnrollmentProvider::shared(SharedEnrollmentProvider::google_drive(
                "joiner@example.com".to_owned(),
                "shared-folder-abc".to_owned(),
            )),
            vault_name: "Shared vault".to_owned(),
            entry_id: "entry-shared".to_owned(),
            issued_at: "2026-06-23T12:00:00Z".to_owned(),
        };
        let code = encrypt_enrollment_payload(&input, "hunter2", "Shared Drive grant").unwrap();
        let decrypted = decrypt_enrollment_payload(&code, "hunter2").unwrap();
        assert_eq!(decrypted.provider, input.provider);
        match decrypted.provider.shared_data() {
            Some(SharedEnrollmentProviderData::GoogleDrive {
                storage_target_id, ..
            }) => {
                assert_eq!(storage_target_id.as_deref(), Some("shared-folder-abc"));
            }
            other => panic!("expected shared grant, got {other:?}"),
        }

        let envelope = parse_enrollment_envelope(&code).unwrap();
        let serialized = serde_json::to_string(&envelope).unwrap();
        assert!(!serialized.contains("ya29."));
        assert!(!serialized.contains("github_pat_"));
        assert!(!serialized.contains("hunter2"));
    }

    #[test]
    fn shared_typestate_wire_rejects_personal_oauth_provider_data() {
        let provider = EnrollmentProvider::shared(SharedEnrollmentProvider::google_drive(
            "joiner@example.com".to_owned(),
            "shared-folder-abc".to_owned(),
        ));
        let value = serde_json::to_value(EnrollmentProviderPayload {
            provider,
            vault_name: Some("Shared vault".to_owned()),
        })
        .unwrap();
        assert_eq!(value["provider"]["onboardingType"], "shared-provider-grant");
        assert_eq!(
            value["provider"]["provider"]["type"],
            "shared-provider-grant"
        );
        let serialized = value.to_string();
        assert!(!serialized.contains("access_token"));
        assert!(!serialized.contains("refresh_token"));

        let invalid = json!({
            "provider": {
                "onboardingType": "shared-provider-grant",
                "provider": {
                    "type": "oauth-file",
                    "preset": "google-drive",
                    "access_token": "owner-token"
                }
            }
        });
        assert!(serde_json::from_value::<EnrollmentProviderPayload>(invalid).is_err());
    }

    #[test]
    fn legacy_oauth_wire_is_classified_as_personal_only() {
        let legacy = json!({
            "provider": {
                "type": "oauth-file",
                "preset": "google-drive",
                "access_token": "legacy-owner-token"
            }
        });
        let decoded: DecodableEnrollmentProviderPayload = serde_json::from_value(legacy).unwrap();
        let provider = decoded.into_provider();
        assert!(provider.shared_data().is_none());
        assert!(matches!(
            provider.personal_data(),
            Some(PersonalEnrollmentProviderData::OauthFile { access_token, .. })
                if access_token == "legacy-owner-token"
        ));
    }

    #[test]
    fn shared_icloud_target_roundtrips_without_provider_credentials() {
        let storage_target_id = concat!(
            "icloud-share-v1:",
            r#"{"role":"owner","zoneName":"zone","ownerRecordName":"owner","rootRecordName":"root","shortGuid":"guid"}"#
        )
        .to_owned();
        let input = EnrollmentIssueInput {
            provider: EnrollmentProvider::shared(SharedEnrollmentProvider::icloud(
                storage_target_id.clone(),
            )),
            vault_name: "Shared iCloud vault".to_owned(),
            entry_id: "entry-icloud-shared".to_owned(),
            issued_at: "2026-06-23T12:00:00Z".to_owned(),
        };
        let code = encrypt_enrollment_payload(&input, "hunter2", "Shared iCloud").unwrap();
        let decrypted = decrypt_enrollment_payload(&code, "hunter2").unwrap();
        assert_eq!(decrypted.provider, input.provider);
        assert!(!code.contains("web-auth-token"));
        assert!(storage_target_id.contains("shortGuid"));
    }

    #[test]
    fn shared_provider_grant_rejects_missing_storage_target_id() {
        let input = EnrollmentIssueInput {
            provider: EnrollmentProvider::shared(SharedEnrollmentProvider::legacy_google_drive(
                "oauth-file".to_owned(),
                Some("google-drive".to_owned()),
                "email".to_owned(),
                "joiner@example.com".to_owned(),
                None,
            )),
            vault_name: "Shared vault".to_owned(),
            entry_id: "entry-shared-legacy".to_owned(),
            issued_at: "2026-06-23T12:00:00Z".to_owned(),
        };
        assert!(matches!(
            encrypt_enrollment_payload(&input, "hunter2", ""),
            Err(EnrollmentError::MalformedSharedProviderGrant)
        ));
    }

    #[test]
    fn personal_oauth_file_provider_roundtrips_inside_encrypted_payload() {
        let input = EnrollmentIssueInput {
            provider: EnrollmentProvider::personal(PersonalEnrollmentProvider::oauth_file(
                "google-drive".to_owned(),
                "ya29.secret".to_owned(),
                Some("refresh.secret".to_owned()),
                Some("2026-07-09T00:00:00Z".to_owned()),
                Some("drive-file-id".to_owned()),
                Some("nook-backup.yaml".to_owned()),
                Some("owner@example.com".to_owned()),
            )),
            vault_name: "OAuth vault".to_owned(),
            entry_id: "entry-oauth".to_owned(),
            issued_at: "2026-07-09T00:00:00Z".to_owned(),
        };
        let code = encrypt_enrollment_payload(&input, "correct horse", "OAuth entry").unwrap();
        assert!(!code.contains("ya29.secret"));
        assert!(!code.contains("refresh.secret"));

        let decrypted = decrypt_enrollment_payload(&code, "correct horse").unwrap();
        assert_eq!(decrypted.provider, input.provider);
    }

    #[test]
    fn malformed_oauth_file_provider_has_provider_specific_error() {
        let input = EnrollmentIssueInput {
            provider: EnrollmentProvider::personal(PersonalEnrollmentProvider::oauth_file(
                "unsupported".to_owned(),
                String::new(),
                None,
                None,
                None,
                None,
                None,
            )),
            vault_name: "OAuth vault".to_owned(),
            entry_id: "entry-oauth".to_owned(),
            issued_at: "2026-07-09T00:00:00Z".to_owned(),
        };
        assert!(matches!(
            encrypt_enrollment_payload(&input, "correct horse", "OAuth entry"),
            Err(EnrollmentError::MalformedOauthFileProvider)
        ));
    }

    #[test]
    fn shared_provider_grant_rejects_unsupported_identity() {
        let input = EnrollmentIssueInput {
            provider: EnrollmentProvider::shared(SharedEnrollmentProvider::legacy_google_drive(
                "github".to_owned(),
                None,
                "email".to_owned(),
                "joiner@example.com".to_owned(),
                None,
            )),
            vault_name: "Shared vault".to_owned(),
            entry_id: "entry-shared".to_owned(),
            issued_at: "2026-06-23T12:00:00Z".to_owned(),
        };
        assert!(encrypt_enrollment_payload(&input, "hunter2", "").is_err());
    }
}

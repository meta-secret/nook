//! Enrollment-code payloads for one-step QR-based device joins.

use serde::{Deserialize, Serialize};
use std::marker::PhantomData;

use crate::errors::{EnrollmentError, EnrollmentResult};

mod code;
pub use code::{
    build_enrollment_link, decrypt_enrollment_payload, encrypt_enrollment_payload,
    normalize_enrollment_code, parse_enrollment_envelope, peek_enrollment_entry_id,
    peek_enrollment_entry_label, peek_enrollment_issued_at,
};

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
#[serde(tag = "state", content = "token", rename_all = "snake_case")]
pub enum OAuthRefreshCredential {
    NotIssued,
    Token(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", content = "expires_at", rename_all = "snake_case")]
pub enum OAuthTokenExpiry {
    Unknown,
    ExpiresAt(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum OAuthRemoteFile {
    Unresolved,
    FileId { file_id: String },
    FileName { file_name: String },
    Identified { file_id: String, file_name: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", content = "email", rename_all = "snake_case")]
pub enum OAuthAccountIdentity {
    Unknown,
    Email(String),
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
        refresh: OAuthRefreshCredential,
        expiry: OAuthTokenExpiry,
        remote_file: OAuthRemoteFile,
        account: OAuthAccountIdentity,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum SharedEnrollmentProviderData {
    #[serde(rename = "shared-provider-grant")]
    GoogleDrive {
        sync_provider_type: String,
        oauth_preset: String,
        joiner_identity_kind: String,
        joiner_identity: String,
        /// Shared Drive folder id the joiner syncs under with their own OAuth token.
        storage_target_id: String,
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
        refresh: OAuthRefreshCredential,
        expiry: OAuthTokenExpiry,
        remote_file: OAuthRemoteFile,
        account: OAuthAccountIdentity,
    ) -> Self {
        Self {
            provider: PersonalEnrollmentProviderData::OauthFile {
                preset,
                access_token,
                refresh,
                expiry,
                remote_file,
                account,
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
                oauth_preset: "google-drive".to_owned(),
                joiner_identity_kind: "email".to_owned(),
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EnrollmentProviderDataRef<'a> {
    Personal(&'a PersonalEnrollmentProviderData),
    Shared(&'a SharedEnrollmentProviderData),
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
    pub const fn data(&self) -> EnrollmentProviderDataRef<'_> {
        match self {
            Self::PersonalCredentialTransfer(provider) => {
                EnrollmentProviderDataRef::Personal(provider.data())
            }
            Self::SharedProviderGrant(provider) => {
                EnrollmentProviderDataRef::Shared(provider.data())
            }
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
    pub vault_name: String,
    pub entry_id: String,
    pub issued_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", content = "label", rename_all = "snake_case")]
pub enum EnrollmentEntryLabel {
    Unlabeled,
    Labeled(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EnrollmentCodeEnvelope {
    pub entry_id: String,
    pub entry_label: EnrollmentEntryLabel,
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
    vault_name: String,
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
                    || oauth_preset != "google-drive"
                    || joiner_identity_kind.trim() != "email"
                    || !is_plausible_email(joiner_identity)
                {
                    return Err(EnrollmentError::MalformedSharedProviderGrant);
                }
                if storage_target_id.trim().is_empty() {
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

#[cfg(test)]
#[allow(clippy::unnecessary_wraps)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn preserves_local_provider() -> anyhow::Result<()> {
        let input = EnrollmentIssueInput {
            provider: EnrollmentProvider::personal(PersonalEnrollmentProvider::local()),
            vault_name: "Local vault".to_owned(),
            entry_id: "entry-local".to_owned(),
            issued_at: "2026-06-23T12:00:00Z".to_owned(),
        };
        let code = encrypt_enrollment_payload(&input, "hunter2", "")?;
        let decrypted = decrypt_enrollment_payload(&code, "hunter2")?;
        assert_eq!(
            decrypted.provider,
            EnrollmentProvider::personal(PersonalEnrollmentProvider::local())
        );
        Ok(())
    }

    #[test]
    fn shared_provider_grant_roundtrips_without_provider_credentials() -> anyhow::Result<()> {
        let input = EnrollmentIssueInput {
            provider: EnrollmentProvider::shared(SharedEnrollmentProvider::google_drive(
                "joiner@example.com".to_owned(),
                "shared-folder-abc".to_owned(),
            )),
            vault_name: "Shared vault".to_owned(),
            entry_id: "entry-shared".to_owned(),
            issued_at: "2026-06-23T12:00:00Z".to_owned(),
        };
        let code = encrypt_enrollment_payload(&input, "hunter2", "Shared Drive grant")?;
        let decrypted = decrypt_enrollment_payload(&code, "hunter2")?;
        assert_eq!(decrypted.provider, input.provider);
        match decrypted.provider.data() {
            EnrollmentProviderDataRef::Shared(SharedEnrollmentProviderData::GoogleDrive {
                storage_target_id,
                ..
            }) => {
                assert_eq!(storage_target_id, "shared-folder-abc");
            }
            other => panic!("expected shared grant, got {other:?}"),
        }

        let envelope = parse_enrollment_envelope(&code)?;
        let serialized = serde_json::to_string(&envelope)?;
        assert!(!serialized.contains("ya29."));
        assert!(!serialized.contains("github_pat_"));
        assert!(!serialized.contains("hunter2"));
        Ok(())
    }

    #[test]
    fn shared_typestate_wire_rejects_personal_oauth_provider_data() -> anyhow::Result<()> {
        let provider = EnrollmentProvider::shared(SharedEnrollmentProvider::google_drive(
            "joiner@example.com".to_owned(),
            "shared-folder-abc".to_owned(),
        ));
        let payload = EnrollmentProviderPayload {
            provider,
            vault_name: "Shared vault".to_owned(),
        };
        let encoded = serde_json::to_vec(&payload)?;
        let decoded: EnrollmentProviderPayload = serde_json::from_slice(&encoded)?;
        assert_eq!(decoded.vault_name, "Shared vault");
        match decoded.provider.data() {
            EnrollmentProviderDataRef::Shared(SharedEnrollmentProviderData::GoogleDrive {
                storage_target_id,
                ..
            }) => assert_eq!(storage_target_id, "shared-folder-abc"),
            other => anyhow::bail!("expected shared Google Drive grant, got {other:?}"),
        }
        let serialized = String::from_utf8(encoded)?;
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
        Ok(())
    }

    #[test]
    fn shared_icloud_target_roundtrips_without_provider_credentials() -> anyhow::Result<()> {
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
        let code = encrypt_enrollment_payload(&input, "hunter2", "Shared iCloud")?;
        let decrypted = decrypt_enrollment_payload(&code, "hunter2")?;
        assert_eq!(decrypted.provider, input.provider);
        assert!(!code.contains("web-auth-token"));
        assert!(storage_target_id.contains("shortGuid"));
        Ok(())
    }

    #[test]
    fn personal_oauth_file_provider_roundtrips_inside_encrypted_payload() -> anyhow::Result<()> {
        let input = EnrollmentIssueInput {
            provider: EnrollmentProvider::personal(PersonalEnrollmentProvider::oauth_file(
                "google-drive".to_owned(),
                "ya29.secret".to_owned(),
                OAuthRefreshCredential::Token("refresh.secret".to_owned()),
                OAuthTokenExpiry::ExpiresAt("2026-07-09T00:00:00Z".to_owned()),
                OAuthRemoteFile::Identified {
                    file_id: "drive-file-id".to_owned(),
                    file_name: "nook-backup.yaml".to_owned(),
                },
                OAuthAccountIdentity::Email("owner@example.com".to_owned()),
            )),
            vault_name: "OAuth vault".to_owned(),
            entry_id: "entry-oauth".to_owned(),
            issued_at: "2026-07-09T00:00:00Z".to_owned(),
        };
        let code = encrypt_enrollment_payload(&input, "correct horse", "OAuth entry")?;
        assert!(!code.contains("ya29.secret"));
        assert!(!code.contains("refresh.secret"));

        let decrypted = decrypt_enrollment_payload(&code, "correct horse")?;
        assert_eq!(decrypted.provider, input.provider);
        Ok(())
    }

    #[test]
    fn malformed_oauth_file_provider_has_provider_specific_error() {
        let input = EnrollmentIssueInput {
            provider: EnrollmentProvider::personal(PersonalEnrollmentProvider::oauth_file(
                "unsupported".to_owned(),
                String::new(),
                OAuthRefreshCredential::NotIssued,
                OAuthTokenExpiry::Unknown,
                OAuthRemoteFile::Unresolved,
                OAuthAccountIdentity::Unknown,
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
}

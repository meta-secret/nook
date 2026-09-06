#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! Enrollment-code payloads for one-step QR-based device joins.

use crate::EnrollmentKeyDerivationIterations;
use serde::{Deserialize, Serialize};
use std::{fmt, marker::PhantomData};

use crate::errors::{EnrollmentError, EnrollmentResult};

mod code;
pub use code::{
    CheckedEnrollmentEnvelope, CheckedEnrollmentIssuance, EnrollmentIssuance, EnrollmentLinkInput,
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
    enrollment_state_sealed::Sealed + fmt::Debug + Clone + PartialEq + Eq
{
    type Provider: fmt::Debug + Clone + PartialEq + Eq;
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
    pub iterations: EnrollmentKeyDerivationIterations,
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

impl EnrollmentProvider {
    fn validate(&self) -> EnrollmentResult<()> {
        match self {
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
                        || (EnrollmentEmail {
                            value: joiner_identity,
                        })
                        .check_plausibility()
                        .is_err()
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
}
/// Borrowed joiner-email input. Plausibility preserves the enrollment check;
/// it does not establish mailbox ownership or full email syntax validation.
pub struct EnrollmentEmail<'a> {
    pub value: &'a str,
}
impl EnrollmentEmail<'_> {
    pub fn check_plausibility(self) -> EnrollmentResult<()> {
        let trimmed = self.value.trim();
        let Some((local, domain)) = trimmed.split_once('@') else {
            return Err(EnrollmentError::MalformedSharedProviderGrant);
        };
        if !local.is_empty()
            && domain.contains('.')
            && !domain.starts_with('.')
            && !domain.ends_with('.')
            && !trimmed.chars().any(char::is_whitespace)
        {
            Ok(())
        } else {
            Err(EnrollmentError::MalformedSharedProviderGrant)
        }
    }
}
#[cfg(test)]
mod tests {
    use super::{
        EnrollmentEmail, EnrollmentProvider, EnrollmentProviderDataRef, EnrollmentProviderPayload,
        OAuthAccountIdentity, OAuthRefreshCredential, OAuthRemoteFile, OAuthTokenExpiry,
        PersonalEnrollmentProvider, SharedEnrollmentProvider, SharedEnrollmentProviderData,
    };
    use crate::EnrollmentError;
    use serde_json::json;

    #[test]
    fn joiner_email_keeps_the_existing_permissive_plausibility_boundary() {
        for value in ["a@b.c", "  a@b.c  ", "a@b@c.d", "a@b..c"] {
            assert!(EnrollmentEmail { value }.check_plausibility().is_ok());
        }
        for value in [
            "", "a", "@b.c", "a@b", "a@.b", "a@b.", "a b@c.d", "a@b.c\td",
        ] {
            assert!(matches!(
                EnrollmentEmail { value }.check_plausibility(),
                Err(EnrollmentError::MalformedSharedProviderGrant)
            ));
        }
    }

    #[test]
    fn provider_validation_keeps_raw_github_and_trimmed_shared_target_checks() -> anyhow::Result<()>
    {
        EnrollmentProvider::personal(PersonalEnrollmentProvider::github(
            " ".to_owned(),
            " ".to_owned(),
        ))
        .validate()?;
        let missing = EnrollmentProvider::personal(PersonalEnrollmentProvider::github(
            String::new(),
            "repo".to_owned(),
        ));
        assert!(matches!(
            missing.validate(),
            Err(EnrollmentError::MalformedGithubProvider)
        ));
        EnrollmentProvider::shared(SharedEnrollmentProvider::google_drive(
            " a@b.c ".to_owned(),
            " folder ".to_owned(),
        ))
        .validate()?;
        let missing_target = EnrollmentProvider::shared(SharedEnrollmentProvider::google_drive(
            "a@b.c".to_owned(),
            " ".to_owned(),
        ));
        assert!(matches!(
            missing_target.validate(),
            Err(EnrollmentError::MalformedSharedProviderGrant)
        ));
        // Enrollment checks this prefix; parsing the share target belongs elsewhere.
        EnrollmentProvider::shared(SharedEnrollmentProvider::icloud(
            "  icloud-share-v1:anything  ".to_owned(),
        ))
        .validate()?;
        let wrong_case = EnrollmentProvider::shared(SharedEnrollmentProvider::icloud(
            "ICloud-share-v1:anything".to_owned(),
        ));
        assert!(matches!(
            wrong_case.validate(),
            Err(EnrollmentError::MalformedSharedProviderGrant)
        ));
        Ok(())
    }

    struct OAuthProviderCase<'a> {
        preset: &'a str,
        token: &'a str,
    }
    impl OAuthProviderCase<'_> {
        fn provider(self) -> EnrollmentProvider {
            EnrollmentProvider::personal(PersonalEnrollmentProvider::oauth_file(
                self.preset.to_owned(),
                self.token.to_owned(),
                OAuthRefreshCredential::NotIssued,
                OAuthTokenExpiry::Unknown,
                OAuthRemoteFile::Unresolved,
                OAuthAccountIdentity::Unknown,
            ))
        }
    }

    #[test]
    fn oauth_provider_checks_preserve_case_and_token_whitespace_semantics() -> anyhow::Result<()> {
        for preset in ["google-drive", "icloud"] {
            OAuthProviderCase {
                preset,
                token: " token ",
            }
            .provider()
            .validate()?;
        }
        for case in [
            OAuthProviderCase {
                preset: "google-drive ",
                token: "token",
            },
            OAuthProviderCase {
                preset: "Google-drive",
                token: "token",
            },
            OAuthProviderCase {
                preset: "icloud",
                token: " \n",
            },
        ] {
            assert!(matches!(
                case.provider().validate(),
                Err(EnrollmentError::MalformedOauthFileProvider)
            ));
        }
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
}

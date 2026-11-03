#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! Enrollment-code payloads for one-step QR-based device joins.

use crate::{EnrollmentKeyDerivationIterations, IsoTimestamp, ProviderSecretText, S3KeyPrefix};
use serde::{Deserialize, Serialize};
use std::{fmt, marker::PhantomData};

use crate::errors::{EnrollmentError, EnrollmentResult};

mod code;
mod providers;
pub use code::{
    CheckedEnrollmentEnvelope, CheckedEnrollmentIssuance, EnrollmentIssuance, EnrollmentLinkInput,
};
pub use providers::EnrollmentProviders;

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

/// The account an OAuth sign-in names. It outlives the sign-in, so a later
/// sign-in that names none keeps the one known before.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, tsify::Tsify)]
#[serde(tag = "state", content = "email", rename_all = "snake_case")]
pub enum OAuthAccountIdentity {
    Unknown,
    Email(String),
}

/// The companion handoff of an OAuth provider: this browser's sign-in and the
/// provider's shared target, as its row holds them. Nook-core validates the
/// target again when the companion turns the code into its provider.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "preset", rename_all = "kebab-case", deny_unknown_fields)]
pub enum OAuthFileEnrollment {
    GoogleDrive {
        access_token: ProviderSecretText,
        expires_at: IsoTimestamp,
        account: OAuthAccountIdentity,
        folder_id: String,
    },
    #[serde(rename = "icloud")]
    ICloud {
        web_auth_token: ProviderSecretText,
        account: OAuthAccountIdentity,
        share_target: String,
    },
}

impl OAuthFileEnrollment {
    /// The shared target is required; the token is never blank by its type.
    fn check(&self) -> EnrollmentResult<()> {
        let target = match self {
            Self::GoogleDrive { folder_id, .. } => folder_id,
            Self::ICloud { share_target, .. } => share_target,
        };
        match target.trim() {
            "" => Err(EnrollmentError::MalformedOauthFileProvider),
            _ => Ok(()),
        }
    }
}

/// Where an S3 invite's objects live: everything the joiner needs except the
/// key that signs its requests.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct S3EnrollmentLocation {
    pub endpoint: String,
    pub region: String,
    pub bucket: String,
    pub key_prefix: S3KeyPrefix,
}

/// The key an S3 invite gives the joiner: one the inviter chose, carried
/// inside the passphrase-encrypted code, or none, so the new device adds
/// its own. The secret is never blank by its type.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum S3EnrollmentKey {
    Included {
        access_key_id: String,
        secret_access_key: ProviderSecretText,
    },
    JoinerProvides,
}

/// An S3 invite: the location and the key choice for it. Nook-core builds it
/// from a validated provider row and validates every field again when the
/// joiner projects it back into one; this crate only checks that the required
/// fields are present.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct S3EnrollmentConnection {
    pub location: S3EnrollmentLocation,
    pub key: S3EnrollmentKey,
}

impl S3EnrollmentConnection {
    fn check(&self) -> EnrollmentResult<()> {
        let location = &self.location;
        let key_id = match &self.key {
            S3EnrollmentKey::Included { access_key_id, .. } => vec![access_key_id.as_str()],
            S3EnrollmentKey::JoinerProvides => Vec::new(),
        };
        let required = [
            location.endpoint.as_str(),
            location.region.as_str(),
            location.bucket.as_str(),
        ];
        match required
            .into_iter()
            .chain(key_id)
            .find(|field| field.trim().is_empty())
        {
            Some(_) => Err(EnrollmentError::MalformedS3Provider),
            None => Ok(()),
        }
    }
}

/// The token a GitHub invite gives the joiner: one the inviter chose, carried
/// inside the encrypted code, or none, so the new device adds its own.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum GithubEnrollmentToken {
    Included { pat: ProviderSecretText },
    JoinerProvides,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum PersonalEnrollmentProviderData {
    Local,
    Github {
        token: GithubEnrollmentToken,
        repo: String,
    },
    #[serde(rename = "oauth-file")]
    OauthFile(OAuthFileEnrollment),
    S3(S3EnrollmentConnection),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum SharedEnrollmentProviderData {
    #[serde(rename = "shared-provider-grant")]
    GoogleDrive {
        sync_provider_type: String,
        oauth_preset: String,
        joiner_identity_kind: String,
        /// Authorized Google account (email) the joining device signs in with.
        /// Drive access comes from the folder's permissions, not from this field.
        joiner_identity: String,
        /// Shared Drive folder id the joiner syncs under with their own OAuth token.
        storage_target_id: String,
    },
    /// Credential-free `CloudKit` share handoff. The target contains only the
    /// stable share/zone location; the recipient authenticates with the
    /// authorized iCloud account named by `joiner_identity` before accepting it.
    #[serde(rename = "icloud-shared")]
    ICloud {
        joiner_identity: String,
        storage_target_id: String,
    },
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
    pub fn github(token: GithubEnrollmentToken, repo: String) -> Self {
        Self {
            provider: PersonalEnrollmentProviderData::Github { token, repo },
            state: PhantomData,
        }
    }

    /// An S3 location and the key choice for it, transferred like the GitHub
    /// token.
    #[must_use]
    pub fn s3(connection: S3EnrollmentConnection) -> Self {
        Self {
            provider: PersonalEnrollmentProviderData::S3(connection),
            state: PhantomData,
        }
    }

    /// This browser's OAuth sign-in and the provider's shared target, for the
    /// same-browser companion only.
    #[must_use]
    pub fn oauth_file(enrollment: OAuthFileEnrollment) -> Self {
        Self {
            provider: PersonalEnrollmentProviderData::OauthFile(enrollment),
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
    pub fn icloud(joiner_identity: String, storage_target_id: String) -> Self {
        Self {
            provider: SharedEnrollmentProviderData::ICloud {
                joiner_identity,
                storage_target_id,
            },
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

/// Identity an enrollment code invites the joining installation into. The
/// provider is the mount through which the joiner reaches that identity's
/// control log; no vault is named by the code.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EnrollmentIdentityTarget {
    pub identity_id: crate::IdentityId,
    pub label: String,
}

impl EnrollmentIdentityTarget {
    fn check(&self) -> EnrollmentResult<()> {
        crate::IdentityId::parse(self.identity_id.as_str()).map_err(|_| {
            EnrollmentError::MissingField {
                field: "identity_id",
            }
        })?;
        if self.label.trim().is_empty() {
            return Err(EnrollmentError::MissingField {
                field: "identity_label",
            });
        }
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn fixture(label: &str) -> Self {
        Self {
            identity_id: crate::IdentityId::test_fixture(),
            label: label.to_owned(),
        }
    }
}

/// Ed25519 seed of a one-time invite key. The issuing member records the
/// matching public key in the identity log; the code's holder proves the
/// invite by signing its own keys with this seed. Redacted in `Debug`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct InviteSigningSeed(crate::SymmetricKey);

impl InviteSigningSeed {
    pub fn generate() -> crate::ValidationResult<Self> {
        crate::SymmetricKey::generate().map(Self)
    }

    /// The invite's signing key; the seed was validated as 32 hex bytes.
    pub fn signing_key(&self) -> crate::ValidationResult<ed25519_dalek::SigningKey> {
        let mut seed = zeroize::Zeroizing::new([0u8; 32]);
        hex::decode_to_slice(self.0.as_str(), seed.as_mut_slice())
            .map_err(|_| crate::ValidationError::SymmetricKeyInvalid)?;
        Ok(ed25519_dalek::SigningKey::from_bytes(&seed))
    }
}

/// One vault an invite opens: its DEK pair at its current key epoch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EnrollmentInviteVault {
    pub store_id: crate::StoreId,
    pub key_epoch: crate::IdentityVaultEventId,
    pub secrets_key: crate::SymmetricKey,
    pub members_key: crate::SymmetricKey,
}

impl EnrollmentInviteVault {
    #[must_use]
    pub fn keys(&self) -> crate::VaultKeys {
        crate::VaultKeys {
            secrets_key: self.secrets_key.clone(),
            members_key: self.members_key.clone(),
        }
    }
}

/// One-time invitation into an identity, carried inside the passphrase-
/// encrypted enrollment code. The joiner signs itself into the identity with
/// the seed and takes every owned vault's DEK from here, with no approval.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EnrollmentInvite {
    pub invite_id: crate::IdentityInviteId,
    pub signing_seed: InviteSigningSeed,
    pub vaults: Vec<EnrollmentInviteVault>,
}

impl EnrollmentInvite {
    /// An invite opening one vault, for round-trip tests.
    #[cfg(test)]
    pub(crate) fn fixture() -> crate::ValidationResult<Self> {
        Ok(Self {
            invite_id: crate::IdentityInviteId::parse("inv_abcdefghijk")?,
            signing_seed: InviteSigningSeed::generate()?,
            vaults: vec![EnrollmentInviteVault {
                store_id: crate::StoreId::parse("store_abcdefghijk")?,
                key_epoch: crate::IdentityVaultEventId::parse(
                    "sha256u:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
                )?,
                secrets_key: crate::SymmetricKey::generate()?,
                members_key: crate::SymmetricKey::generate()?,
            }],
        })
    }

    fn check(&self) -> EnrollmentResult<()> {
        let mut stores = self
            .vaults
            .iter()
            .map(|vault| &vault.store_id)
            .collect::<Vec<_>>();
        stores.sort();
        stores.dedup();
        if stores.len() != self.vaults.len() {
            return Err(EnrollmentError::MissingField {
                field: "invite_vaults",
            });
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnrollmentIssueInput {
    pub providers: EnrollmentProviders,
    pub identity: EnrollmentIdentityTarget,
    pub invite: EnrollmentInvite,
    pub entry_id: String,
    pub issued_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecryptedEnrollmentPayload {
    pub providers: EnrollmentProviders,
    pub identity: EnrollmentIdentityTarget,
    pub invite: EnrollmentInvite,
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
    providers: EnrollmentProviders,
    identity: EnrollmentIdentityTarget,
    invite: EnrollmentInvite,
}

impl EnrollmentProvider {
    fn validate(&self) -> EnrollmentResult<()> {
        match self {
            EnrollmentProvider::PersonalCredentialTransfer(provider) => match provider.data() {
                PersonalEnrollmentProviderData::Local => Ok(()),
                // A carried token is never blank by its type; the repository
                // is required whoever adds the token.
                PersonalEnrollmentProviderData::Github { repo, .. } => match repo.as_str() {
                    "" => Err(EnrollmentError::MalformedGithubProvider),
                    _ => Ok(()),
                },
                PersonalEnrollmentProviderData::OauthFile(enrollment) => enrollment.check(),
                PersonalEnrollmentProviderData::S3(connection) => connection.check(),
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
                SharedEnrollmentProviderData::ICloud {
                    joiner_identity,
                    storage_target_id,
                } => {
                    if (EnrollmentEmail {
                        value: joiner_identity,
                    })
                    .check_plausibility()
                    .is_err()
                        || storage_target_id.trim().is_empty()
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
        GithubEnrollmentToken, OAuthAccountIdentity, OAuthFileEnrollment,
        PersonalEnrollmentProvider, SharedEnrollmentProvider, SharedEnrollmentProviderData,
    };
    use crate::{EnrollmentError, IsoTimestamp, ProviderSecretText};
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
        let token = || -> anyhow::Result<GithubEnrollmentToken> {
            Ok(GithubEnrollmentToken::Included {
                pat: ProviderSecretText::try_from("github_pat_TEST-ONLY".to_owned())?,
            })
        };
        EnrollmentProvider::personal(PersonalEnrollmentProvider::github(token()?, " ".to_owned()))
            .validate()?;
        let missing = EnrollmentProvider::personal(PersonalEnrollmentProvider::github(
            token()?,
            String::new(),
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
            "member@icloud.com".to_owned(),
            "  icloud-share-v1:anything  ".to_owned(),
        ))
        .validate()?;
        let wrong_case = EnrollmentProvider::shared(SharedEnrollmentProvider::icloud(
            "member@icloud.com".to_owned(),
            "ICloud-share-v1:anything".to_owned(),
        ));
        assert!(matches!(
            wrong_case.validate(),
            Err(EnrollmentError::MalformedSharedProviderGrant)
        ));
        // The invite names the authorized iCloud account the new device uses.
        let missing_account = EnrollmentProvider::shared(SharedEnrollmentProvider::icloud(
            " ".to_owned(),
            "icloud-share-v1:anything".to_owned(),
        ));
        assert!(matches!(
            missing_account.validate(),
            Err(EnrollmentError::MalformedSharedProviderGrant)
        ));
        Ok(())
    }

    impl OAuthFileEnrollment {
        fn google_drive_fixture(folder_id: &str) -> anyhow::Result<Self> {
            Ok(Self::GoogleDrive {
                access_token: ProviderSecretText::try_from("TEST-ONLY-drive-token".to_owned())?,
                expires_at: IsoTimestamp::parse("2030-01-01T00:00:00Z")?,
                account: OAuthAccountIdentity::Email("owner@example.com".to_owned()),
                folder_id: folder_id.to_owned(),
            })
        }

        fn icloud_fixture(share_target: &str) -> anyhow::Result<Self> {
            Ok(Self::ICloud {
                web_auth_token: ProviderSecretText::try_from("TEST-ONLY-icloud-token".to_owned())?,
                account: OAuthAccountIdentity::Unknown,
                share_target: share_target.to_owned(),
            })
        }

        fn provider(self) -> EnrollmentProvider {
            EnrollmentProvider::personal(PersonalEnrollmentProvider::oauth_file(self))
        }
    }

    #[test]
    fn an_oauth_handoff_needs_its_shared_target_and_round_trips_by_preset() -> anyhow::Result<()> {
        for enrollment in [
            OAuthFileEnrollment::google_drive_fixture("folder-1")?,
            OAuthFileEnrollment::icloud_fixture("icloud-share-v1:{}")?,
        ] {
            let provider = enrollment.provider();
            provider.validate()?;
            let wire = serde_json::to_value(&provider)?;
            assert_eq!(
                serde_json::from_value::<EnrollmentProvider>(wire)?,
                provider
            );
            assert!(!format!("{provider:?}").contains("TEST-ONLY"));
        }
        assert_eq!(
            serde_json::to_value(
                OAuthFileEnrollment::google_drive_fixture("folder-1")?.provider()
            )?,
            json!({
                "onboardingType": "personal-credential-transfer",
                "provider": {
                    "type": "oauth-file",
                    "preset": "google-drive",
                    "access_token": "TEST-ONLY-drive-token",
                    "expires_at": "2030-01-01T00:00:00Z",
                    "account": { "state": "email", "email": "owner@example.com" },
                    "folder_id": "folder-1",
                }
            })
        );
        for missing in [
            OAuthFileEnrollment::google_drive_fixture(" ")?,
            OAuthFileEnrollment::icloud_fixture("")?,
        ] {
            assert!(matches!(
                missing.provider().validate(),
                Err(EnrollmentError::MalformedOauthFileProvider)
            ));
        }
        // An older handoff with a refresh token or a file slot is not this shape.
        let older = json!({
            "onboardingType": "personal-credential-transfer",
            "provider": {
                "type": "oauth-file",
                "preset": "google-drive",
                "access_token": "TEST-ONLY-drive-token",
                "expires_at": "2030-01-01T00:00:00Z",
                "account": { "state": "unknown" },
                "folder_id": "folder-1",
                "refresh": { "state": "not_issued" },
            }
        });
        assert!(serde_json::from_value::<EnrollmentProvider>(older).is_err());
        let blank_token = json!({
            "onboardingType": "personal-credential-transfer",
            "provider": {
                "type": "oauth-file",
                "preset": "icloud",
                "web_auth_token": " ",
                "account": { "state": "unknown" },
                "share_target": "icloud-share-v1:{}",
            }
        });
        assert!(serde_json::from_value::<EnrollmentProvider>(blank_token).is_err());
        Ok(())
    }
    #[test]
    fn shared_typestate_wire_rejects_personal_oauth_provider_data() -> anyhow::Result<()> {
        let provider = EnrollmentProvider::shared(SharedEnrollmentProvider::google_drive(
            "joiner@example.com".to_owned(),
            "shared-folder-abc".to_owned(),
        ));
        let payload = EnrollmentProviderPayload {
            providers: super::EnrollmentProviders::single(provider),
            identity: super::EnrollmentIdentityTarget::fixture("Shared identity"),
            invite: super::EnrollmentInvite::fixture()?,
        };
        let encoded = serde_json::to_vec(&payload)?;
        let decoded: EnrollmentProviderPayload = serde_json::from_slice(&encoded)?;
        assert_eq!(decoded.identity.label, "Shared identity");
        match decoded.providers.first().data() {
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
            "providers": [{
                "onboardingType": "shared-provider-grant",
                "provider": {
                    "type": "oauth-file",
                    "preset": "google-drive",
                    "access_token": "owner-token"
                }
            }]
        });
        assert!(serde_json::from_value::<EnrollmentProviderPayload>(invalid).is_err());
        Ok(())
    }
}

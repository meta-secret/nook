//! Enrollment payload selection for persisted sync-provider rows.
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]

use serde::{Deserialize, Serialize};
use tsify::Tsify;

use crate::errors::{ValidationError, ValidationResult};
use crate::{
    EnrollmentProvider, GithubEnrollmentToken, GithubPat, GithubProvider, GithubRepoName,
    OAuthFileEnrollment, OAuthFilePreset, OAuthFileProvider, OnboardingType,
    PersonalEnrollmentProvider, ProviderCredentialEncoding, ProviderKind, ProviderSecretText,
    ReplicationType, S3Connection, S3EnrollmentConnection, S3EnrollmentKey,
    SharedEnrollmentProvider, SharedGrantProviderOutcome, SharedStorageTargetSelection,
    StorageProvider, StoredProvider, VaultArchitecture,
};

/// Whose key or token a credential-bearing device invite hands the new
/// device. A GitHub invite carries this device's token or none; an S3 invite
/// carries this device's key, one of the row's saved spare keys, or none.
/// Every other personal invite carries the row's own data.
#[derive(Serialize, Deserialize, Tsify)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum EnrollmentCredentialChoice {
    /// This device's own key or token, as its row holds it.
    Inviter,
    /// A spare key the S3 row saves, named by its access key id.
    SavedKey { access_key_id: String },
    /// The location alone: the new device adds its own key.
    JoinerProvides,
}

impl EnrollmentCredentialChoice {
    /// The token a GitHub invite carries for this choice.
    fn github_token(&self, row: &GithubProvider) -> ValidationResult<GithubEnrollmentToken> {
        match self {
            Self::Inviter => Ok(GithubEnrollmentToken::Included {
                pat: ProviderSecretText::try_from(
                    GithubPat::parse(row.token.expose())?.into_inner(),
                )?,
            }),
            Self::SavedKey { .. } => Err(ValidationError::EnrollmentCredentialMismatch),
            Self::JoinerProvides => Ok(GithubEnrollmentToken::JoinerProvides),
        }
    }

    /// The key an S3 invite carries for this choice.
    fn s3_key(&self, row: &S3Connection) -> ValidationResult<S3EnrollmentKey> {
        match self {
            Self::Inviter => Ok(row.enrollment_key()),
            Self::SavedKey { access_key_id } => row.spare_enrollment_key(access_key_id),
            Self::JoinerProvides => Ok(S3EnrollmentKey::JoinerProvides),
        }
    }

    /// Whether the invite reads a secret the row saves.
    const fn reads_row_secret(&self) -> bool {
        match self {
            Self::Inviter | Self::SavedKey { .. } => true,
            Self::JoinerProvides => false,
        }
    }
}

/// Borrowed configuration for one enrollment payload construction.
/// Admission selects the existing personal or shared payload boundary, not provider authorization.
///
/// Payload construction consumes the request:
/// ```compile_fail
/// use nook_core::ProviderEnrollmentRequest;
/// fn twice(request: ProviderEnrollmentRequest<'_>) {
///     let _ = request.build();
///     let _ = request.build();
/// }
/// ```
/// The intermediate selection is private:
/// ```compile_fail
/// use nook_core::ProviderEnrollmentRequest;
/// fn bypass(request: ProviderEnrollmentRequest<'_>) {
///     let _ = request.admit();
/// }
/// ```
/// Requests do not clone the construction continuation:
/// ```compile_fail
/// use nook_core::ProviderEnrollmentRequest;
/// fn duplicate(request: ProviderEnrollmentRequest<'_>) {
///     let _ = request.clone();
/// }
/// ```
pub enum EnrollmentAudience<'a> {
    /// A credential-bearing invite: a new device's, or the same-browser
    /// companion handoff (the paired extension), sealed to that device's key.
    /// The choice says whose key a GitHub or S3 invite carries.
    Personal(EnrollmentCredentialChoice),
    /// A new device that signs in with one of the provider's authorized
    /// accounts. The invite names that account and carries no credential.
    Shared(SharedEnrollmentAudience<'a>),
}
pub struct SharedEnrollmentAudience<'a> {
    /// Authorized account (email) picked from the provider's access list.
    pub joiner_identity: &'a str,
}
pub struct ProviderEnrollmentRequest<'a> {
    pub provider: &'a StorageProvider,
    pub architecture: &'a VaultArchitecture,
    pub audience: EnrollmentAudience<'a>,
}

struct CheckedProviderEnrollment<'a> {
    request: ProviderEnrollmentRequest<'a>,
    onboarding: OnboardingType,
}

impl<'a> ProviderEnrollmentRequest<'a> {
    pub fn build(self) -> ValidationResult<EnrollmentProvider> {
        self.admit()?.build()
    }

    /// OAuth-file providers are shared, so a new device always receives a
    /// credential-free grant. Only the same-browser companion handoff of a
    /// personal-replication vault may transfer this browser's OAuth session.
    fn admit(self) -> ValidationResult<CheckedProviderEnrollment<'a>> {
        let onboarding = match (&self.audience, self.provider.kind()) {
            (EnrollmentAudience::Personal(_), ProviderKind::OauthFile(_))
                if self.architecture.replication_type == ReplicationType::Personal =>
            {
                self.architecture.validate()?;
                OnboardingType::PersonalCredentialTransfer
            }
            _ => self.provider.onboarding_type(self.architecture)?,
        };
        Ok(CheckedProviderEnrollment {
            request: self,
            onboarding,
        })
    }
}

impl CheckedProviderEnrollment<'_> {
    fn build(self) -> ValidationResult<EnrollmentProvider> {
        match self.onboarding {
            OnboardingType::PersonalCredentialTransfer => {
                self.personal().map(EnrollmentProvider::personal)
            }
            OnboardingType::SharedProviderGrant => self.shared().map(EnrollmentProvider::shared),
        }
    }
}

/// Ordered provider observations for an exact shared-target credential selection.
pub struct SharedGrantProviderSelection<'a> {
    pub providers: &'a [StorageProvider],
    pub preset: OAuthFilePreset,
    pub target: &'a SharedStorageTargetSelection,
}

/// Select a saved OAuth provider that can authorize a shared enrollment
/// target. A bound target may reuse only the credential persisted for that
/// exact Drive folder or iCloud share.
impl SharedGrantProviderSelection<'_> {
    #[must_use]
    pub fn resolve(self) -> SharedGrantProviderOutcome {
        let Self {
            providers,
            preset,
            target,
        } = self;
        match providers.iter().find(|provider| {
            let StoredProvider::OauthFile(oauth) = &provider.provider else {
                return false;
            };
            match (target, oauth) {
                (SharedStorageTargetSelection::Create, oauth) => oauth.preset() == preset,
                (
                    SharedStorageTargetSelection::Existing(target_id),
                    OAuthFileProvider::GoogleDrive(drive),
                ) => {
                    preset == OAuthFilePreset::GoogleDrive && drive.folder_id.as_str() == target_id
                }
                (
                    SharedStorageTargetSelection::Existing(target_id),
                    OAuthFileProvider::ICloud(icloud),
                ) => preset == OAuthFilePreset::ICloud && icloud.share_target.as_str() == target_id,
            }
        }) {
            Some(provider) => SharedGrantProviderOutcome::Existing {
                provider: Box::new(provider.clone()),
            },
            None => SharedGrantProviderOutcome::AuthorizationRequired,
        }
    }
}

/// Resolve the device-invite handoff from vault policy and the provider kind.
/// Google Drive and iCloud providers are always shared: a new device signs in
/// with its own authorized account, so their invites never carry the owner's
/// OAuth credential, whatever the vault's default replication policy.
impl StorageProvider {
    pub fn onboarding_type(
        &self,
        architecture: &VaultArchitecture,
    ) -> ValidationResult<OnboardingType> {
        architecture.validate()?;
        let effective_replication = match self.kind() {
            ProviderKind::OauthFile(_) => ReplicationType::Shared,
            ProviderKind::Local
            | ProviderKind::LocalFolder
            | ProviderKind::Github
            | ProviderKind::S3 => architecture.replication_type,
        };
        self.validate_replication(effective_replication)?;
        Ok(match effective_replication {
            ReplicationType::Personal => OnboardingType::PersonalCredentialTransfer,
            ReplicationType::Shared => OnboardingType::SharedProviderGrant,
        })
    }
}

/// Resolve the onboarding ceremony encoded by an enrollment provider payload.
///
/// Credential-bearing provider variants are restricted to trusted-device
/// onboarding. Shared-target variants contain no provider credential fields and
/// always require the joining device to authenticate independently.
impl OnboardingType {
    #[must_use]
    pub const fn from_enrollment(provider: &EnrollmentProvider) -> Self {
        match provider {
            EnrollmentProvider::PersonalCredentialTransfer(_) => {
                OnboardingType::PersonalCredentialTransfer
            }
            EnrollmentProvider::SharedProviderGrant(_) => OnboardingType::SharedProviderGrant,
        }
    }
}

/// Build only the credential-bearing enrollment typestate. Its return value
/// cannot be wrapped as a shared-provider payload. A row whose credential is
/// still sealed at rest fails closed before any payload is built.
impl CheckedProviderEnrollment<'_> {
    fn personal(self) -> ValidationResult<PersonalEnrollmentProvider> {
        let ProviderEnrollmentRequest {
            provider, audience, ..
        } = self.request;
        provider.validate_replication(ReplicationType::Personal)?;
        let EnrollmentAudience::Personal(choice) = audience else {
            return Err(ValidationError::EnrollmentCredentialMismatch);
        };
        // A key left to the joiner reads no saved secret: a sealed row still
        // names its location.
        if choice.reads_row_secret()
            && provider.provider.secrets().into_iter().any(|secret| {
                ProviderCredentialEncoding::observe(secret)
                    == ProviderCredentialEncoding::ArmorMarked
            })
        {
            return Err(ValidationError::ProviderCredentialSealed);
        }
        Ok(match (&provider.provider, &choice) {
            (
                StoredProvider::Local {} | StoredProvider::LocalFolder(_),
                EnrollmentCredentialChoice::Inviter,
            ) => PersonalEnrollmentProvider::local(),
            (StoredProvider::Github(github), choice) => PersonalEnrollmentProvider::github(
                choice.github_token(github)?,
                GithubRepoName::parse(github.repository.name())?.into_inner(),
            ),
            // The location travels with the chosen key, like the GitHub token.
            (StoredProvider::S3(connection), choice) => {
                PersonalEnrollmentProvider::s3(S3EnrollmentConnection {
                    location: connection.enrollment_location(),
                    key: choice.s3_key(connection)?,
                })
            }
            (
                StoredProvider::Local {}
                | StoredProvider::LocalFolder(_)
                | StoredProvider::OauthFile(_),
                EnrollmentCredentialChoice::SavedKey { .. }
                | EnrollmentCredentialChoice::JoinerProvides,
            ) => return Err(ValidationError::EnrollmentCredentialMismatch),
            // The companion connects through the same shared target.
            (
                StoredProvider::OauthFile(OAuthFileProvider::GoogleDrive(drive)),
                EnrollmentCredentialChoice::Inviter,
            ) => PersonalEnrollmentProvider::oauth_file(OAuthFileEnrollment::GoogleDrive {
                access_token: drive.authorization.access_token.clone(),
                expires_at: drive.authorization.expires_at.clone(),
                account: drive.account.clone(),
                folder_id: drive.folder_id.as_str().to_owned(),
            }),
            (
                StoredProvider::OauthFile(OAuthFileProvider::ICloud(icloud)),
                EnrollmentCredentialChoice::Inviter,
            ) => PersonalEnrollmentProvider::oauth_file(OAuthFileEnrollment::ICloud {
                web_auth_token: icloud.web_auth_token.clone(),
                account: icloud.account.clone(),
                share_target: icloud.share_target.as_str().to_owned(),
            }),
        })
    }
}

/// Build only the credential-free shared-provider typestate. Even though the
/// saved row contains this browser's credential, this return type has no
/// credential fields or credential-bearing constructors. The invite carries
/// the provider's shared target and the authorized account the new device
/// signs in with; access itself comes from the provider's sharing list.
impl CheckedProviderEnrollment<'_> {
    fn shared(self) -> ValidationResult<SharedEnrollmentProvider> {
        let ProviderEnrollmentRequest {
            provider, audience, ..
        } = self.request;
        provider.validate_replication(ReplicationType::Shared)?;
        let StoredProvider::OauthFile(oauth) = &provider.provider else {
            return Err(ValidationError::SharedStorageTargetRequired);
        };
        let EnrollmentAudience::Shared(audience) = audience else {
            return Err(ValidationError::SharedJoinerIdentityRequired);
        };
        let identity = match audience.joiner_identity.trim() {
            "" => return Err(ValidationError::SharedJoinerIdentityRequired),
            identity => identity.to_owned(),
        };
        Ok(match oauth {
            OAuthFileProvider::GoogleDrive(drive) => SharedEnrollmentProvider::google_drive(
                identity,
                drive.folder_id.as_str().to_owned(),
            ),
            OAuthFileProvider::ICloud(icloud) => {
                SharedEnrollmentProvider::icloud(identity, icloud.share_target.as_str().to_owned())
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use std::ptr;

    use super::{
        CheckedProviderEnrollment, EnrollmentAudience, EnrollmentCredentialChoice,
        ProviderEnrollmentRequest, SharedEnrollmentAudience, SharedGrantProviderOutcome,
        SharedGrantProviderSelection,
    };
    use crate::errors::ValidationError;
    use crate::{
        DeviceIdentity, EnrollmentProvider, EnrollmentProviderDataRef, GithubEnrollmentToken,
        GithubProvider, OAuthFileEnrollment, OAuthFilePreset, OnboardingType,
        PersonalEnrollmentProvider, PersonalEnrollmentProviderData, ProviderSecretText,
        ReplicationType, S3EnrollmentConnection, S3EnrollmentKey, S3KeyDraft, S3SpareKeyAddition,
        S3SpareKeyRequest, SharedEnrollmentProvider, SharedStorageTargetSelection, StorageProvider,
        StoredProvider, VaultArchitecture, VaultType,
    };

    fn inviter() -> EnrollmentAudience<'static> {
        EnrollmentAudience::Personal(EnrollmentCredentialChoice::Inviter)
    }

    fn saved_key(access_key_id: &str) -> EnrollmentAudience<'static> {
        EnrollmentAudience::Personal(EnrollmentCredentialChoice::SavedKey {
            access_key_id: access_key_id.to_owned(),
        })
    }

    /// The S3 fixture row with a spare key `device-b` saved beside its own.
    fn s3_row_with_spare() -> anyhow::Result<StorageProvider> {
        let addition = S3SpareKeyRequest {
            provider: row(StoredProvider::s3_fixture()?),
            key: S3KeyDraft {
                access_key_id: "device-b".to_owned(),
                secret_access_key: "TEST-ONLY-device-b-secret".to_owned(),
            },
        }
        .add()?;
        match addition {
            S3SpareKeyAddition::Added { provider } => Ok(*provider),
            S3SpareKeyAddition::Invalid { fields } => anyhow::bail!("refused: {fields:?}"),
        }
    }

    fn shared_audience(joiner_identity: &str) -> EnrollmentAudience<'_> {
        EnrollmentAudience::Shared(SharedEnrollmentAudience { joiner_identity })
    }

    fn shared_architecture() -> VaultArchitecture {
        VaultArchitecture {
            replication_type: ReplicationType::Shared,
            ..VaultArchitecture::default()
        }
    }

    fn build(
        provider: &StorageProvider,
        architecture: &VaultArchitecture,
        audience: EnrollmentAudience<'_>,
    ) -> Result<EnrollmentProvider, ValidationError> {
        ProviderEnrollmentRequest {
            provider,
            architecture,
            audience,
        }
        .build()
    }

    fn row(provider: StoredProvider) -> StorageProvider {
        StorageProvider::fixture("row", provider)
    }

    #[test]
    fn device_invites_for_oauth_providers_are_always_credential_free() -> anyhow::Result<()> {
        let github = row(StoredProvider::github_fixture()?);
        assert!(build(&github, &shared_architecture(), shared_audience("a@b.com")).is_err());
        // A personal-replication vault still sends Drive invites as grants:
        // the new device signs in with its own authorized account.
        let drive = row(StoredProvider::google_drive_fixture()?);
        assert_eq!(
            drive.onboarding_type(&VaultArchitecture::default()),
            Ok(OnboardingType::SharedProviderGrant)
        );
        assert_eq!(
            build(
                &drive,
                &VaultArchitecture::default(),
                shared_audience(" joiner@example.com ")
            )?,
            EnrollmentProvider::shared(SharedEnrollmentProvider::google_drive(
                "joiner@example.com".to_owned(),
                "folder-1".to_owned(),
            ))
        );
        let icloud = row(StoredProvider::icloud_fixture()?);
        let StoredProvider::OauthFile(crate::OAuthFileProvider::ICloud(share)) = &icloud.provider
        else {
            anyhow::bail!("the iCloud fixture is an iCloud row");
        };
        let payload = build(
            &icloud,
            &VaultArchitecture::default(),
            shared_audience("m@icloud.com"),
        )?;
        assert_eq!(
            payload,
            EnrollmentProvider::shared(SharedEnrollmentProvider::icloud(
                "m@icloud.com".to_owned(),
                share.share_target.as_str().to_owned(),
            ))
        );
        assert!(!serde_json::to_string(&payload)?.contains("TEST-ONLY"));
        Ok(())
    }

    #[test]
    fn only_the_companion_handoff_transfers_the_oauth_session() -> anyhow::Result<()> {
        let drive = row(StoredProvider::google_drive_fixture()?);
        let companion = build(&drive, &VaultArchitecture::default(), inviter())?;
        let EnrollmentProviderDataRef::Personal(PersonalEnrollmentProviderData::OauthFile(
            OAuthFileEnrollment::GoogleDrive {
                access_token,
                folder_id,
                ..
            },
        )) = companion.data()
        else {
            anyhow::bail!("a companion handoff builds a personal OAuth payload");
        };
        // The companion connects through the same shared folder.
        assert_eq!(folder_id, "folder-1");
        assert_eq!(access_token.expose(), "TEST-ONLY-drive-token");
        // A shared-replication vault never transfers a session, even to the
        // companion; it must name an authorized account instead.
        assert_eq!(
            build(&drive, &shared_architecture(), inviter()),
            Err(ValidationError::SharedJoinerIdentityRequired)
        );
        Ok(())
    }

    #[test]
    fn a_personal_invite_carries_each_providers_own_payload() -> anyhow::Result<()> {
        let personal = VaultArchitecture::default();
        for provider in [
            StoredProvider::Local {},
            StoredProvider::local_folder_fixture()?,
        ] {
            assert_eq!(
                build(&row(provider), &personal, inviter())?,
                EnrollmentProvider::personal(PersonalEnrollmentProvider::local())
            );
        }
        assert_eq!(
            build(
                &row(StoredProvider::github_fixture()?),
                &personal,
                inviter()
            )?,
            EnrollmentProvider::personal(PersonalEnrollmentProvider::github(
                GithubEnrollmentToken::Included {
                    pat: ProviderSecretText::try_from("github_pat_11TESTONLYNOTREAL".to_owned())?,
                },
                "team-vault".to_owned(),
            ))
        );
        let s3 = row(StoredProvider::s3_fixture()?);
        let StoredProvider::S3(connection) = &s3.provider else {
            anyhow::bail!("the S3 fixture is an S3 row");
        };
        assert_eq!(
            build(&s3, &personal, inviter())?,
            EnrollmentProvider::personal(PersonalEnrollmentProvider::s3(S3EnrollmentConnection {
                location: connection.enrollment_location(),
                key: connection.enrollment_key(),
            }))
        );
        let icloud = row(StoredProvider::icloud_fixture()?);
        assert!(matches!(
            build(&icloud, &personal, inviter())?.data(),
            EnrollmentProviderDataRef::Personal(PersonalEnrollmentProviderData::OauthFile(
                OAuthFileEnrollment::ICloud { .. }
            ))
        ));
        Ok(())
    }

    #[test]
    fn a_sealed_row_never_becomes_a_personal_invite() -> anyhow::Result<()> {
        let identity = DeviceIdentity::generate()?;
        for provider in [
            StoredProvider::github_fixture()?,
            StoredProvider::s3_fixture()?,
        ] {
            let sealed = row(provider.transition_secrets(|secret| {
                ProviderSecretText::try_from(
                    identity
                        .public_key()
                        .seal_bytes(secret.expose().as_bytes())?
                        .into_inner(),
                )
                .map_err(anyhow::Error::from)
            })?);
            assert_eq!(
                build(&sealed, &VaultArchitecture::default(), inviter()),
                Err(ValidationError::ProviderCredentialSealed)
            );
        }
        Ok(())
    }

    #[test]
    fn a_saved_spare_key_travels_in_place_of_the_row_key() -> anyhow::Result<()> {
        let personal = VaultArchitecture::default();
        let s3 = s3_row_with_spare()?;
        let StoredProvider::S3(connection) = &s3.provider else {
            anyhow::bail!("the S3 fixture is an S3 row");
        };
        assert_eq!(
            build(&s3, &personal, saved_key(" device-b "))?,
            EnrollmentProvider::personal(PersonalEnrollmentProvider::s3(S3EnrollmentConnection {
                location: connection.enrollment_location(),
                key: S3EnrollmentKey::Included {
                    access_key_id: "device-b".to_owned(),
                    secret_access_key: ProviderSecretText::try_from(
                        "TEST-ONLY-device-b-secret".to_owned()
                    )?,
                },
            }))
        );
        // The row's own key is not a spare, and an unsaved one is refused.
        for missing in ["device-a", "device-c"] {
            assert_eq!(
                build(&s3, &personal, saved_key(missing)),
                Err(ValidationError::S3AccessKeyNotSaved)
            );
        }
        // A sealed spare never travels.
        let identity = DeviceIdentity::generate()?;
        let sealed = row(s3.provider.transition_secrets(|secret| {
            ProviderSecretText::try_from(
                identity
                    .public_key()
                    .seal_bytes(secret.expose().as_bytes())?
                    .into_inner(),
            )
            .map_err(anyhow::Error::from)
        })?);
        assert_eq!(
            build(&sealed, &personal, saved_key("device-b")),
            Err(ValidationError::ProviderCredentialSealed)
        );
        Ok(())
    }

    #[test]
    fn a_key_of_the_wrong_kind_is_refused() -> anyhow::Result<()> {
        let personal = VaultArchitecture::default();
        let mismatched = [
            (StoredProvider::github_fixture()?, saved_key("device-b")),
            (StoredProvider::Local {}, saved_key("device-b")),
            (
                StoredProvider::google_drive_fixture()?,
                saved_key("device-b"),
            ),
            (
                StoredProvider::google_drive_fixture()?,
                EnrollmentAudience::Personal(EnrollmentCredentialChoice::JoinerProvides),
            ),
        ];
        for (provider, audience) in mismatched {
            assert_eq!(
                build(&row(provider), &personal, audience),
                Err(ValidationError::EnrollmentCredentialMismatch)
            );
        }
        // A personal invite names whose key it carries; a shared audience does not.
        assert_eq!(
            build(
                &row(StoredProvider::github_fixture()?),
                &personal,
                shared_audience("joiner@example.com")
            ),
            Err(ValidationError::EnrollmentCredentialMismatch)
        );
        Ok(())
    }

    #[test]
    fn the_key_choice_reads_back_in_its_tagged_shape() -> anyhow::Result<()> {
        for (wire, choice) in [
            (
                serde_json::json!({ "kind": "inviter" }),
                EnrollmentCredentialChoice::Inviter,
            ),
            (
                serde_json::json!({ "kind": "savedKey", "accessKeyId": "device-b" }),
                EnrollmentCredentialChoice::SavedKey {
                    access_key_id: "device-b".to_owned(),
                },
            ),
            (
                serde_json::json!({ "kind": "joinerProvides" }),
                EnrollmentCredentialChoice::JoinerProvides,
            ),
        ] {
            assert_eq!(serde_json::to_value(&choice)?, wire);
            assert_eq!(
                serde_json::to_value(serde_json::from_value::<EnrollmentCredentialChoice>(wire)?)?,
                serde_json::to_value(&choice)?
            );
        }
        assert!(
            serde_json::from_value::<EnrollmentCredentialChoice>(
                serde_json::json!({ "kind": "replacement" })
            )
            .is_err()
        );
        Ok(())
    }

    #[test]
    fn a_key_left_to_the_joiner_carries_only_the_location() -> anyhow::Result<()> {
        let joiner = || EnrollmentAudience::Personal(EnrollmentCredentialChoice::JoinerProvides);
        let personal = VaultArchitecture::default();
        let s3 = row(StoredProvider::s3_fixture()?);
        let StoredProvider::S3(connection) = &s3.provider else {
            anyhow::bail!("the S3 fixture is an S3 row");
        };
        let payload = build(&s3, &personal, joiner())?;
        assert_eq!(
            payload,
            EnrollmentProvider::personal(PersonalEnrollmentProvider::s3(S3EnrollmentConnection {
                location: connection.enrollment_location(),
                key: S3EnrollmentKey::JoinerProvides,
            }))
        );
        let github = build(&row(StoredProvider::github_fixture()?), &personal, joiner())?;
        assert_eq!(
            github,
            EnrollmentProvider::personal(PersonalEnrollmentProvider::github(
                GithubEnrollmentToken::JoinerProvides,
                "team-vault".to_owned(),
            ))
        );
        for wire in [
            serde_json::to_string(&payload)?,
            serde_json::to_string(&github)?,
        ] {
            assert!(!wire.contains("TEST-ONLY"), "{wire}");
            assert!(!wire.contains("device-a"), "{wire}");
        }
        // A sealed row still names its location: its secret is not read.
        let identity = DeviceIdentity::generate()?;
        let sealed = row(StoredProvider::s3_fixture()?.transition_secrets(|secret| {
            ProviderSecretText::try_from(
                identity
                    .public_key()
                    .seal_bytes(secret.expose().as_bytes())?
                    .into_inner(),
            )
            .map_err(anyhow::Error::from)
        })?);
        assert!(build(&sealed, &personal, joiner()).is_ok());
        Ok(())
    }

    #[test]
    fn architecture_rejection_precedes_the_payload() -> anyhow::Result<()> {
        let provider = row(StoredProvider::Github(GithubProvider::fixture(
            "bad name", "pat",
        )?));
        let invalid = VaultArchitecture {
            vault_type: VaultType::Sentinel,
            ..VaultArchitecture::default()
        };
        assert_eq!(
            build(&provider, &invalid, inviter()),
            Err(ValidationError::InvalidSentinelPolicy)
        );
        assert_eq!(
            build(&provider, &VaultArchitecture::default(), inviter()),
            Err(ValidationError::GithubRepoChars)
        );
        Ok(())
    }

    #[test]
    fn admitted_selection_retains_original_request_until_consuming_construction()
    -> anyhow::Result<()> {
        let provider = row(StoredProvider::google_drive_fixture()?);
        let architecture = shared_architecture();
        let checked: CheckedProviderEnrollment<'_> = ProviderEnrollmentRequest {
            provider: &provider,
            architecture: &architecture,
            audience: shared_audience(" joiner@example.com "),
        }
        .admit()?;
        assert!(ptr::eq(checked.request.provider, &raw const provider));
        assert!(ptr::eq(
            checked.request.architecture,
            &raw const architecture
        ));
        assert_eq!(checked.onboarding, OnboardingType::SharedProviderGrant);
        let encoded = serde_json::to_string(&checked.build()?)?;
        assert!(!encoded.contains("access_token"));
        Ok(())
    }

    #[test]
    fn device_invites_require_the_authorized_account() -> anyhow::Result<()> {
        let provider = row(StoredProvider::google_drive_fixture()?);
        assert_eq!(
            build(
                &provider,
                &VaultArchitecture::default(),
                shared_audience("  ")
            ),
            Err(ValidationError::SharedJoinerIdentityRequired)
        );
        Ok(())
    }

    #[test]
    fn grant_selection_compares_the_preset_and_the_exact_target() -> anyhow::Result<()> {
        let drive = row(StoredProvider::google_drive_fixture()?);
        let icloud = row(StoredProvider::icloud_fixture()?);
        let providers = [
            row(StoredProvider::github_fixture()?),
            drive.clone(),
            icloud.clone(),
        ];
        let select = |preset, target: &SharedStorageTargetSelection| {
            SharedGrantProviderSelection {
                providers: &providers,
                preset,
                target,
            }
            .resolve()
        };
        let existing = |provider: &StorageProvider| SharedGrantProviderOutcome::Existing {
            provider: Box::new(provider.clone()),
        };
        assert_eq!(
            select(
                OAuthFilePreset::GoogleDrive,
                &SharedStorageTargetSelection::Create
            ),
            existing(&drive)
        );
        assert_eq!(
            select(
                OAuthFilePreset::GoogleDrive,
                &SharedStorageTargetSelection::Existing("folder-1".to_owned())
            ),
            existing(&drive)
        );
        assert_eq!(
            select(
                OAuthFilePreset::GoogleDrive,
                &SharedStorageTargetSelection::Existing("folder-2".to_owned())
            ),
            SharedGrantProviderOutcome::AuthorizationRequired
        );
        assert_eq!(
            select(
                OAuthFilePreset::ICloud,
                &SharedStorageTargetSelection::Create
            ),
            existing(&icloud)
        );
        Ok(())
    }
}

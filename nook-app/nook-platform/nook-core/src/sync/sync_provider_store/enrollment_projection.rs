//! The provider a joiner sets up from an enrollment code.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use crate::errors::ValidationResult;
use crate::{
    EnrollmentProvider, EnrollmentProviderDataRef, GithubDraft, GithubDraftToken,
    GithubEnrollmentToken, GoogleDriveAccess, GoogleDriveAuthorization, GoogleDriveDraft,
    GoogleDriveFolder, GoogleDriveFolderId, GoogleDriveSignIn, ICloudAccess, ICloudDraft,
    ICloudShare, ICloudShareTargetId, ICloudSignIn, OAuthFileDraft, OAuthFileEnrollment,
    PersonalEnrollmentProviderData, ProviderDraft, S3Connection, S3Draft, S3EnrollmentKey,
    S3Location, SharedEnrollmentProviderData, StoredGithubRepository, ValidationError,
};

/// The joiner's side of an S3 invite: the inviter's connection, validated
/// again as a stored one is, for the joiner's new provider row. Saving that
/// row seals its secret. A provider that carries no personal S3 connection
/// has none to give.
impl TryFrom<&EnrollmentProvider> for S3Connection {
    type Error = ValidationError;
    fn try_from(provider: &EnrollmentProvider) -> ValidationResult<Self> {
        let EnrollmentProviderDataRef::Personal(PersonalEnrollmentProviderData::S3(connection)) =
            provider.data()
        else {
            return Err(ValidationError::S3StorageTargetInvalid);
        };
        Self::try_from(connection)
    }
}

/// The draft a decrypted code gives the joiner. A personal code carries the
/// provider complete, validated again here, or its location with the key left
/// to the joiner; a shared grant names the target and leaves the sign-in to
/// the joiner's own account.
impl TryFrom<&EnrollmentProvider> for ProviderDraft {
    type Error = ValidationError;
    fn try_from(provider: &EnrollmentProvider) -> ValidationResult<Self> {
        Ok(match provider.data() {
            EnrollmentProviderDataRef::Personal(PersonalEnrollmentProviderData::Local) => {
                Self::Local {}
            }
            EnrollmentProviderDataRef::Personal(PersonalEnrollmentProviderData::Github {
                token,
                repo,
            }) => Self::Github(GithubDraft {
                repository: match repo.trim() {
                    "" => StoredGithubRepository::DefaultRepository,
                    repo => StoredGithubRepository::Repository(repo.to_owned()),
                },
                token: match token {
                    GithubEnrollmentToken::Included { pat } => {
                        GithubDraftToken::Entered(pat.clone())
                    }
                    GithubEnrollmentToken::JoinerProvides => GithubDraftToken::AwaitingToken,
                },
            }),
            EnrollmentProviderDataRef::Personal(PersonalEnrollmentProviderData::OauthFile(
                OAuthFileEnrollment::GoogleDrive {
                    access_token,
                    expires_at,
                    account,
                    folder_id,
                },
            )) => Self::OauthFile(OAuthFileDraft::GoogleDrive(GoogleDriveDraft {
                sign_in: GoogleDriveSignIn::SignedIn(GoogleDriveAccess {
                    authorization: GoogleDriveAuthorization {
                        access_token: access_token.clone(),
                        expires_at: expires_at.clone(),
                    },
                    account: account.clone(),
                }),
                folder: GoogleDriveFolder::Connected(GoogleDriveFolderId::parse(folder_id)?),
            })),
            EnrollmentProviderDataRef::Personal(PersonalEnrollmentProviderData::OauthFile(
                OAuthFileEnrollment::ICloud {
                    web_auth_token,
                    account,
                    share_target,
                },
            )) => Self::OauthFile(OAuthFileDraft::ICloud(ICloudDraft {
                sign_in: ICloudSignIn::SignedIn(ICloudAccess {
                    web_auth_token: web_auth_token.clone(),
                    account: account.clone(),
                }),
                share: ICloudShare::Shared(ICloudShareTargetId::try_from(share_target.clone())?),
            })),
            EnrollmentProviderDataRef::Personal(PersonalEnrollmentProviderData::S3(connection)) => {
                match &connection.key {
                    S3EnrollmentKey::Included { .. } => {
                        Self::S3(S3Draft::Ready(S3Connection::try_from(connection)?))
                    }
                    S3EnrollmentKey::JoinerProvides => Self::S3(S3Draft::AwaitingKey(
                        S3Location::try_from(&connection.location)?,
                    )),
                }
            }
            EnrollmentProviderDataRef::Shared(SharedEnrollmentProviderData::GoogleDrive {
                storage_target_id,
                ..
            }) => Self::OauthFile(OAuthFileDraft::GoogleDrive(GoogleDriveDraft {
                sign_in: GoogleDriveSignIn::AwaitingSignIn,
                folder: GoogleDriveFolder::Connected(GoogleDriveFolderId::parse(
                    storage_target_id,
                )?),
            })),
            EnrollmentProviderDataRef::Shared(SharedEnrollmentProviderData::ICloud {
                storage_target_id,
                ..
            }) => Self::OauthFile(OAuthFileDraft::ICloud(ICloudDraft {
                sign_in: ICloudSignIn::AwaitingSignIn,
                share: ICloudShare::Shared(ICloudShareTargetId::try_from(
                    storage_target_id.clone(),
                )?),
            })),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        CheckedEnrollmentEnvelope, EnrollmentAudience, EnrollmentCredentialChoice,
        EnrollmentIdentityTarget, EnrollmentInvite, EnrollmentIssuance, EnrollmentIssueInput,
        EnrollmentProviders, IdentityId, IdentityInviteId, InviteSigningSeed, OnboardingType,
        PersonalEnrollmentProvider, ProviderDraftGap, ProviderEnrollmentRequest,
        ProviderSecretText, ReplicationType, S3EnrollmentConnection, S3EnrollmentLocation,
        S3KeyDraft, S3KeyPrefix, SharedEnrollmentAudience, SharedEnrollmentProvider,
        StorageProvider, StoredProvider, VaultArchitecture,
    };

    const S3_SECRET: &str = "TEST-ONLY-device-a-secret-not-real";

    fn issue(provider: EnrollmentProvider) -> anyhow::Result<String> {
        let input = EnrollmentIssueInput {
            providers: EnrollmentProviders::single(provider),
            identity: EnrollmentIdentityTarget {
                identity_id: IdentityId::generate()?,
                label: "Team keyring".to_owned(),
            },
            invite: EnrollmentInvite {
                invite_id: IdentityInviteId::parse("inv_abcdefghijk")?,
                signing_seed: InviteSigningSeed::generate()?,
                vaults: Vec::new(),
            },
            entry_id: "entry-s3".to_owned(),
            issued_at: "2026-10-31T12:00:00Z".to_owned(),
        };
        Ok(EnrollmentIssuance {
            input: &input,
            password: "invite passphrase",
            entry_label: "Laptop",
        }
        .check()?
        .issue()?)
    }

    fn companion(provider: StoredProvider) -> anyhow::Result<EnrollmentProvider> {
        invite_with(provider, EnrollmentCredentialChoice::Inviter)
    }

    fn invite_with(
        provider: StoredProvider,
        choice: EnrollmentCredentialChoice,
    ) -> anyhow::Result<EnrollmentProvider> {
        Ok(ProviderEnrollmentRequest {
            provider: &StorageProvider::fixture("row", provider),
            architecture: &VaultArchitecture::default(),
            audience: EnrollmentAudience::Personal(choice),
        }
        .build()?)
    }

    fn decrypted_first(provider: EnrollmentProvider) -> anyhow::Result<EnrollmentProvider> {
        let code = issue(provider)?;
        let decrypted = CheckedEnrollmentEnvelope::parse(&code)?.decrypt("invite passphrase")?;
        Ok(decrypted.providers.first().clone())
    }

    #[test]
    fn every_personal_code_restores_its_provider_complete() -> anyhow::Result<()> {
        for provider in StoredProvider::every_fixture()? {
            if matches!(provider, StoredProvider::LocalFolder(_)) {
                // A local folder is chosen per installation: its code is local.
                continue;
            }
            let code = issue(companion(provider.clone())?)?;
            let decrypted =
                CheckedEnrollmentEnvelope::parse(&code)?.decrypt("invite passphrase")?;
            let draft = ProviderDraft::try_from(decrypted.providers.first())?;
            assert_eq!(draft.complete(), Ok(provider));
        }
        Ok(())
    }

    #[test]
    fn an_s3_invite_hands_the_joiner_the_inviters_connection_and_key() -> anyhow::Result<()> {
        let provider = companion(StoredProvider::s3_fixture()?)?;
        assert_eq!(
            OnboardingType::from_enrollment(&provider),
            OnboardingType::PersonalCredentialTransfer
        );
        let code = issue(provider)?;
        assert!(!code.contains(S3_SECRET));
        let decrypted = CheckedEnrollmentEnvelope::parse(&code)?.decrypt("invite passphrase")?;
        assert_eq!(
            S3Connection::try_from(decrypted.providers.first())?,
            S3Connection::fixture()?
        );
        Ok(())
    }

    #[test]
    fn s3_invites_need_a_personal_vault_and_a_valid_connection() -> anyhow::Result<()> {
        let shared = VaultArchitecture {
            replication_type: ReplicationType::Shared,
            ..VaultArchitecture::default()
        };
        assert!(matches!(
            ProviderEnrollmentRequest {
                provider: &StorageProvider::fixture("s3", StoredProvider::s3_fixture()?),
                architecture: &shared,
                audience: EnrollmentAudience::Shared(SharedEnrollmentAudience {
                    joiner_identity: "joiner@example.com",
                }),
            }
            .build(),
            Err(ValidationError::UnsupportedProviderReplication { .. })
        ));
        // A decrypted code whose connection fails validation adds no provider.
        let tampered =
            EnrollmentProvider::personal(PersonalEnrollmentProvider::s3(S3EnrollmentConnection {
                location: S3EnrollmentLocation {
                    endpoint: "http://s3.example.com".to_owned(),
                    region: "us-east-1".to_owned(),
                    bucket: "nook-dev".to_owned(),
                    key_prefix: S3KeyPrefix::BucketRoot,
                },
                key: crate::S3EnrollmentKey::Included {
                    access_key_id: "device-a".to_owned(),
                    secret_access_key: ProviderSecretText::try_from(S3_SECRET.to_owned())?,
                },
            }));
        assert_eq!(
            S3Connection::try_from(&tampered),
            Err(ValidationError::S3EndpointInsecure)
        );
        assert_eq!(
            ProviderDraft::try_from(&tampered),
            Err(ValidationError::S3EndpointInsecure)
        );
        assert_eq!(
            S3Connection::try_from(&EnrollmentProvider::personal(
                PersonalEnrollmentProvider::local()
            )),
            Err(ValidationError::S3StorageTargetInvalid)
        );
        Ok(())
    }

    #[test]
    fn a_key_left_to_the_joiner_projects_a_draft_that_knows_its_location() -> anyhow::Result<()> {
        let s3 = decrypted_first(invite_with(
            StoredProvider::s3_fixture()?,
            EnrollmentCredentialChoice::JoinerProvides,
        )?)?;
        let location = S3Connection::fixture()?.location();
        let draft = ProviderDraft::try_from(&s3)?;
        assert_eq!(
            draft,
            ProviderDraft::S3(S3Draft::AwaitingKey(location.clone()))
        );
        assert_eq!(draft.clone().complete(), Err(ProviderDraftGap::S3Key));
        // The invite gives no connection until the joiner adds its key.
        assert_eq!(
            S3Connection::try_from(&s3),
            Err(ValidationError::S3AccessKeyIdRequired)
        );
        // The S3 form completes the location with just the key.
        let typed = S3KeyDraft {
            access_key_id: "device-a".to_owned(),
            secret_access_key: S3_SECRET.to_owned(),
        };
        assert_eq!(
            location.with_key(&typed),
            crate::S3DraftValidation::Valid {
                configuration: S3Connection::fixture()?
            }
        );

        let github = decrypted_first(invite_with(
            StoredProvider::github_fixture()?,
            EnrollmentCredentialChoice::JoinerProvides,
        )?)?;
        assert_eq!(
            ProviderDraft::try_from(&github)?,
            ProviderDraft::Github(GithubDraft {
                repository: StoredGithubRepository::Repository("team-vault".to_owned()),
                token: GithubDraftToken::AwaitingToken,
            })
        );
        Ok(())
    }

    #[test]
    fn a_spare_key_projects_a_complete_provider_with_that_key() -> anyhow::Result<()> {
        let crate::S3SpareKeyAddition::Added {
            provider: with_spare,
        } = (crate::S3SpareKeyRequest {
            provider: StorageProvider::fixture("row", StoredProvider::s3_fixture()?),
            key: S3KeyDraft {
                access_key_id: "device-b".to_owned(),
                secret_access_key: "TEST-ONLY-device-b-secret".to_owned(),
            },
        })
        .add()?
        else {
            anyhow::bail!("the spare key is saved");
        };
        let s3 = decrypted_first(invite_with(
            with_spare.provider,
            EnrollmentCredentialChoice::SavedKey {
                access_key_id: "device-b".to_owned(),
            },
        )?)?;
        let Ok(StoredProvider::S3(connection)) = ProviderDraft::try_from(&s3)?.complete() else {
            anyhow::bail!("an S3 invite with a key completes as S3");
        };
        assert_eq!(connection.storage_detail(), "127.0.0.1:8333 · device-b");
        assert_eq!(connection.location(), S3Connection::fixture()?.location());
        assert!(!format!("{connection:?}").contains("TEST-ONLY-device-b-secret"));
        Ok(())
    }

    #[test]
    fn a_shared_grant_names_the_target_and_waits_for_the_joiners_sign_in() -> anyhow::Result<()> {
        let drive = ProviderDraft::try_from(&EnrollmentProvider::shared(
            SharedEnrollmentProvider::google_drive(
                "joiner@example.com".to_owned(),
                "folder-1".to_owned(),
            ),
        ))?;
        assert_eq!(
            drive,
            ProviderDraft::OauthFile(OAuthFileDraft::GoogleDrive(GoogleDriveDraft {
                sign_in: GoogleDriveSignIn::AwaitingSignIn,
                folder: GoogleDriveFolder::Connected(GoogleDriveFolderId::parse("folder-1")?),
            }))
        );
        assert_eq!(drive.complete(), Err(ProviderDraftGap::OAuthSignIn));
        let share = ICloudShareTargetId::fixture()?;
        let icloud = ProviderDraft::try_from(&EnrollmentProvider::shared(
            SharedEnrollmentProvider::icloud(
                "member@icloud.com".to_owned(),
                share.as_str().to_owned(),
            ),
        ))?;
        assert!(matches!(
            icloud,
            ProviderDraft::OauthFile(OAuthFileDraft::ICloud(ICloudDraft {
                sign_in: ICloudSignIn::AwaitingSignIn,
                share: ICloudShare::Shared(_),
            }))
        ));
        // A grant whose target is not one is no draft.
        for damaged in [
            SharedEnrollmentProvider::google_drive("j@x.y".to_owned(), "a b".to_owned()),
            SharedEnrollmentProvider::icloud("j@x.y".to_owned(), "icloud-share-v1:{}".to_owned()),
        ] {
            assert!(ProviderDraft::try_from(&EnrollmentProvider::shared(damaged)).is_err());
        }
        Ok(())
    }
}

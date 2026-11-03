#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
//! The OAuth setups. Each has two independent dimensions: an owner signs in
//! and then binds the shared target, while a shared-grant joiner knows the
//! target from the invite and signs in afterwards.

use serde::{Deserialize, Serialize};
use tsify::Tsify;

use super::{ProviderCredentialReadiness, ProviderDraft, ProviderDraftGap};
use crate::{
    GoogleDriveAuthorization, GoogleDriveFolderId, GoogleDriveProvider, ICloudProvider,
    ICloudShareTargetId, OAuthAccountIdentity, OAuthFilePreset, OAuthFileProvider,
    ProviderSecretText,
};

/// An OAuth setup, tagged by its preset.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "preset", rename_all = "kebab-case")]
pub enum OAuthFileDraft {
    GoogleDrive(GoogleDriveDraft),
    #[serde(rename = "icloud")]
    ICloud(ICloudDraft),
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GoogleDriveDraft {
    pub sign_in: GoogleDriveSignIn,
    pub folder: GoogleDriveFolder,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(
    tag = "state",
    content = "value",
    rename_all = "camelCase",
    deny_unknown_fields
)]
pub enum GoogleDriveSignIn {
    AwaitingSignIn,
    SignedIn(GoogleDriveAccess),
}

/// What a Google sign-in gives the setup: the authorization and the account
/// it names.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GoogleDriveAccess {
    pub authorization: GoogleDriveAuthorization,
    pub account: OAuthAccountIdentity,
}

/// The vault folder, before and after it is created or chosen.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(
    tag = "state",
    content = "value",
    rename_all = "camelCase",
    deny_unknown_fields
)]
pub enum GoogleDriveFolder {
    NotConnected,
    Connected(GoogleDriveFolderId),
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ICloudDraft {
    pub sign_in: ICloudSignIn,
    pub share: ICloudShare,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(
    tag = "state",
    content = "value",
    rename_all = "camelCase",
    deny_unknown_fields
)]
pub enum ICloudSignIn {
    AwaitingSignIn,
    SignedIn(ICloudAccess),
}

/// What a `CloudKit` sign-in gives the setup: its web-auth token and the
/// account it names.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ICloudAccess {
    pub web_auth_token: ProviderSecretText,
    pub account: OAuthAccountIdentity,
}

/// The `CloudKit` share, before and after it is created or accepted.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(
    tag = "state",
    content = "value",
    rename_all = "camelCase",
    deny_unknown_fields
)]
pub enum ICloudShare {
    Unbound,
    Shared(ICloudShareTargetId),
}

/// A draft operation for another provider than the draft's: binding a Drive
/// folder to an S3 draft, for example. It is a caller bug.
#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
#[error("{}", ProviderDraftMismatch::KEY)]
pub struct ProviderDraftMismatch;

impl ProviderDraftMismatch {
    const KEY: &'static str = "errors.validation.provider_draft_mismatch";
}

/// A Google sign-in to apply to the draft being set up.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GoogleDriveSignInRequest {
    pub draft: ProviderDraft,
    pub access: GoogleDriveAccess,
}

/// A `CloudKit` sign-in to apply to the draft being set up.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ICloudSignInRequest {
    pub draft: ProviderDraft,
    pub access: ICloudAccess,
}

/// The vault folder a Google Drive draft connects through.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GoogleDriveFolderBinding {
    pub draft: ProviderDraft,
    pub folder_id: GoogleDriveFolderId,
}

/// The `CloudKit` share an iCloud draft connects through.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ICloudShareBinding {
    pub draft: ProviderDraft,
    pub share_target: ICloudShareTargetId,
}

impl OAuthFileDraft {
    /// A preset's setup before its sign-in and its target.
    #[must_use]
    pub const fn begin(preset: OAuthFilePreset) -> Self {
        match preset {
            OAuthFilePreset::GoogleDrive => Self::GoogleDrive(GoogleDriveDraft {
                sign_in: GoogleDriveSignIn::AwaitingSignIn,
                folder: GoogleDriveFolder::NotConnected,
            }),
            OAuthFilePreset::ICloud => Self::ICloud(ICloudDraft {
                sign_in: ICloudSignIn::AwaitingSignIn,
                share: ICloudShare::Unbound,
            }),
        }
    }

    #[must_use]
    pub const fn preset(&self) -> OAuthFilePreset {
        match self {
            Self::GoogleDrive(_) => OAuthFilePreset::GoogleDrive,
            Self::ICloud(_) => OAuthFilePreset::ICloud,
        }
    }

    /// The provider a signed-in, bound setup becomes. The sign-in is asked
    /// for first.
    pub(crate) fn complete(self) -> Result<OAuthFileProvider, ProviderDraftGap> {
        match self {
            Self::GoogleDrive(GoogleDriveDraft {
                sign_in: GoogleDriveSignIn::SignedIn(access),
                folder: GoogleDriveFolder::Connected(folder_id),
            }) => Ok(OAuthFileProvider::GoogleDrive(GoogleDriveProvider {
                authorization: access.authorization,
                account: access.account,
                folder_id,
            })),
            Self::ICloud(ICloudDraft {
                sign_in: ICloudSignIn::SignedIn(access),
                share: ICloudShare::Shared(share_target),
            }) => Ok(OAuthFileProvider::ICloud(ICloudProvider {
                web_auth_token: access.web_auth_token,
                account: access.account,
                share_target,
            })),
            Self::GoogleDrive(GoogleDriveDraft {
                sign_in: GoogleDriveSignIn::AwaitingSignIn,
                ..
            })
            | Self::ICloud(ICloudDraft {
                sign_in: ICloudSignIn::AwaitingSignIn,
                ..
            }) => Err(ProviderDraftGap::OAuthSignIn),
            Self::GoogleDrive(GoogleDriveDraft {
                folder: GoogleDriveFolder::NotConnected,
                ..
            })
            | Self::ICloud(ICloudDraft {
                share: ICloudShare::Unbound,
                ..
            }) => Err(ProviderDraftGap::SharedTarget),
        }
    }

    pub(crate) const fn credential_readiness(&self) -> ProviderCredentialReadiness {
        match self {
            Self::GoogleDrive(GoogleDriveDraft {
                sign_in: GoogleDriveSignIn::SignedIn(_),
                ..
            })
            | Self::ICloud(ICloudDraft {
                sign_in: ICloudSignIn::SignedIn(_),
                ..
            }) => ProviderCredentialReadiness::Ready,
            Self::GoogleDrive(GoogleDriveDraft {
                sign_in: GoogleDriveSignIn::AwaitingSignIn,
                ..
            })
            | Self::ICloud(ICloudDraft {
                sign_in: ICloudSignIn::AwaitingSignIn,
                ..
            }) => ProviderCredentialReadiness::Required(ProviderDraftGap::OAuthSignIn),
        }
    }
}

/// A saved OAuth provider as the draft of its complete setup.
impl From<OAuthFileProvider> for OAuthFileDraft {
    fn from(provider: OAuthFileProvider) -> Self {
        match provider {
            OAuthFileProvider::GoogleDrive(drive) => Self::GoogleDrive(GoogleDriveDraft {
                sign_in: GoogleDriveSignIn::SignedIn(GoogleDriveAccess {
                    authorization: drive.authorization,
                    account: drive.account,
                }),
                folder: GoogleDriveFolder::Connected(drive.folder_id),
            }),
            OAuthFileProvider::ICloud(icloud) => Self::ICloud(ICloudDraft {
                sign_in: ICloudSignIn::SignedIn(ICloudAccess {
                    web_auth_token: icloud.web_auth_token,
                    account: icloud.account,
                }),
                share: ICloudShare::Shared(icloud.share_target),
            }),
        }
    }
}

impl OAuthFileDraft {
    /// A fresh sign-in's account, or the earlier one it replaces when the
    /// fresh sign-in named none.
    fn account_after(
        fresh: OAuthAccountIdentity,
        earlier: OAuthAccountIdentity,
    ) -> OAuthAccountIdentity {
        match (fresh, earlier) {
            (OAuthAccountIdentity::Unknown, earlier) => earlier,
            (fresh, _) => fresh,
        }
    }
}

impl ProviderDraft {
    /// A Google sign-in. A Drive draft keeps its folder and, when the sign-in
    /// names no account, the account it knew; any other draft becomes a Drive
    /// draft without a folder.
    #[must_use]
    pub fn with_google_drive_access(self, access: GoogleDriveAccess) -> Self {
        let (earlier, folder) = match self {
            Self::OauthFile(OAuthFileDraft::GoogleDrive(GoogleDriveDraft {
                sign_in: GoogleDriveSignIn::SignedIn(earlier),
                folder,
            })) => (earlier.account, folder),
            Self::OauthFile(OAuthFileDraft::GoogleDrive(GoogleDriveDraft {
                sign_in: GoogleDriveSignIn::AwaitingSignIn,
                folder,
            })) => (OAuthAccountIdentity::Unknown, folder),
            Self::Local {}
            | Self::LocalFolder(_)
            | Self::Github(_)
            | Self::OauthFile(OAuthFileDraft::ICloud(_))
            | Self::S3(_) => (
                OAuthAccountIdentity::Unknown,
                GoogleDriveFolder::NotConnected,
            ),
        };
        Self::OauthFile(OAuthFileDraft::GoogleDrive(GoogleDriveDraft {
            sign_in: GoogleDriveSignIn::SignedIn(GoogleDriveAccess {
                authorization: access.authorization,
                account: OAuthFileDraft::account_after(access.account, earlier),
            }),
            folder,
        }))
    }

    /// A `CloudKit` sign-in. An iCloud draft keeps its share and, when the
    /// sign-in names no account, the account it knew; any other draft becomes
    /// an iCloud draft without a share.
    #[must_use]
    pub fn with_icloud_access(self, access: ICloudAccess) -> Self {
        let (earlier, share) = match self {
            Self::OauthFile(OAuthFileDraft::ICloud(ICloudDraft {
                sign_in: ICloudSignIn::SignedIn(earlier),
                share,
            })) => (earlier.account, share),
            Self::OauthFile(OAuthFileDraft::ICloud(ICloudDraft {
                sign_in: ICloudSignIn::AwaitingSignIn,
                share,
            })) => (OAuthAccountIdentity::Unknown, share),
            Self::Local {}
            | Self::LocalFolder(_)
            | Self::Github(_)
            | Self::OauthFile(OAuthFileDraft::GoogleDrive(_))
            | Self::S3(_) => (OAuthAccountIdentity::Unknown, ICloudShare::Unbound),
        };
        Self::OauthFile(OAuthFileDraft::ICloud(ICloudDraft {
            sign_in: ICloudSignIn::SignedIn(ICloudAccess {
                web_auth_token: access.web_auth_token,
                account: OAuthFileDraft::account_after(access.account, earlier),
            }),
            share,
        }))
    }

    /// The vault folder a Google Drive draft connects through.
    pub fn with_google_drive_folder(
        self,
        folder_id: GoogleDriveFolderId,
    ) -> Result<Self, ProviderDraftMismatch> {
        match self {
            Self::OauthFile(OAuthFileDraft::GoogleDrive(GoogleDriveDraft { sign_in, .. })) => Ok(
                Self::OauthFile(OAuthFileDraft::GoogleDrive(GoogleDriveDraft {
                    sign_in,
                    folder: GoogleDriveFolder::Connected(folder_id),
                })),
            ),
            Self::Local {}
            | Self::LocalFolder(_)
            | Self::Github(_)
            | Self::OauthFile(OAuthFileDraft::ICloud(_))
            | Self::S3(_) => Err(ProviderDraftMismatch),
        }
    }

    /// The `CloudKit` share an iCloud draft connects through.
    pub fn with_icloud_share(
        self,
        share_target: ICloudShareTargetId,
    ) -> Result<Self, ProviderDraftMismatch> {
        match self {
            Self::OauthFile(OAuthFileDraft::ICloud(ICloudDraft { sign_in, .. })) => {
                Ok(Self::OauthFile(OAuthFileDraft::ICloud(ICloudDraft {
                    sign_in,
                    share: ICloudShare::Shared(share_target),
                })))
            }
            Self::Local {}
            | Self::LocalFolder(_)
            | Self::Github(_)
            | Self::OauthFile(OAuthFileDraft::GoogleDrive(_))
            | Self::S3(_) => Err(ProviderDraftMismatch),
        }
    }
}

impl GoogleDriveSignInRequest {
    #[must_use]
    pub fn apply(self) -> ProviderDraft {
        self.draft.with_google_drive_access(self.access)
    }
}

impl ICloudSignInRequest {
    #[must_use]
    pub fn apply(self) -> ProviderDraft {
        self.draft.with_icloud_access(self.access)
    }
}

impl GoogleDriveFolderBinding {
    pub fn apply(self) -> Result<ProviderDraft, ProviderDraftMismatch> {
        self.draft.with_google_drive_folder(self.folder_id)
    }
}

impl ICloudShareBinding {
    pub fn apply(self) -> Result<ProviderDraft, ProviderDraftMismatch> {
        self.draft.with_icloud_share(self.share_target)
    }
}

#[cfg(test)]
mod tests {
    use super::{
        GoogleDriveAccess, GoogleDriveFolder, GoogleDriveSignIn, ICloudAccess, ICloudShare,
        ICloudSignIn, OAuthFileDraft, ProviderDraftMismatch,
    };
    use crate::{
        GoogleDriveAuthorization, GoogleDriveFolderId, ICloudShareTargetId, OAuthAccountIdentity,
        OAuthFilePreset, ProviderDraft, ProviderDraftGap, ProviderKind, ProviderSecretText,
    };

    fn email(address: &str) -> OAuthAccountIdentity {
        OAuthAccountIdentity::Email(address.to_owned())
    }

    fn drive_access(
        token: &str,
        account: OAuthAccountIdentity,
    ) -> anyhow::Result<GoogleDriveAccess> {
        Ok(GoogleDriveAccess {
            authorization: GoogleDriveAuthorization::fixture(token)?,
            account,
        })
    }

    fn icloud_access(account: OAuthAccountIdentity) -> anyhow::Result<ICloudAccess> {
        Ok(ICloudAccess {
            web_auth_token: ProviderSecretText::try_from("TEST-ONLY-icloud-token".to_owned())?,
            account,
        })
    }

    fn drive(draft: &ProviderDraft) -> anyhow::Result<(&GoogleDriveSignIn, &GoogleDriveFolder)> {
        match draft {
            ProviderDraft::OauthFile(OAuthFileDraft::GoogleDrive(drive)) => {
                Ok((&drive.sign_in, &drive.folder))
            }
            other => anyhow::bail!("expected a Drive draft, got {:?}", other.kind()),
        }
    }

    #[test]
    fn a_drive_sign_in_keeps_the_folder_and_the_known_account() -> anyhow::Result<()> {
        let folder = GoogleDriveFolderId::parse("folder-1")?;
        let bound = ProviderDraft::begin(ProviderKind::OauthFile(OAuthFilePreset::GoogleDrive))
            .with_google_drive_folder(folder.clone())?;
        // A joiner knows the folder before signing in.
        assert_eq!(bound.clone().complete(), Err(ProviderDraftGap::OAuthSignIn));
        let signed_in =
            bound.with_google_drive_access(drive_access("TEST-ONLY-a", email("a@b.c"))?);
        let (_, kept) = drive(&signed_in)?;
        assert_eq!(kept, &GoogleDriveFolder::Connected(folder));
        // A later sign-in that names no account keeps the one known before.
        let refreshed = signed_in
            .with_google_drive_access(drive_access("TEST-ONLY-b", OAuthAccountIdentity::Unknown)?);
        let (GoogleDriveSignIn::SignedIn(access), _) = drive(&refreshed)? else {
            anyhow::bail!("the draft is signed in");
        };
        assert_eq!(access.account, email("a@b.c"));
        assert_eq!(access.authorization.access_token.expose(), "TEST-ONLY-b");
        assert!(refreshed.complete().is_ok());
        Ok(())
    }

    #[test]
    fn another_draft_becomes_an_unbound_drive_or_icloud_draft() -> anyhow::Result<()> {
        let from_github = ProviderDraft::begin(ProviderKind::Github)
            .with_google_drive_access(drive_access("TEST-ONLY-a", OAuthAccountIdentity::Unknown)?);
        assert_eq!(drive(&from_github)?.1, &GoogleDriveFolder::NotConnected);
        assert_eq!(from_github.complete(), Err(ProviderDraftGap::SharedTarget));

        let share = ICloudShareTargetId::fixture()?;
        let icloud = ProviderDraft::begin(ProviderKind::OauthFile(OAuthFilePreset::ICloud))
            .with_icloud_share(share.clone())?
            .with_icloud_access(icloud_access(email("m@icloud.com"))?);
        assert!(icloud.clone().complete().is_ok());
        // Switching presets starts over: the share belongs to iCloud.
        let switched = icloud
            .with_google_drive_access(drive_access("TEST-ONLY-a", OAuthAccountIdentity::Unknown)?);
        assert_eq!(drive(&switched)?.1, &GoogleDriveFolder::NotConnected);
        let back = switched.with_icloud_access(icloud_access(OAuthAccountIdentity::Unknown)?);
        let ProviderDraft::OauthFile(OAuthFileDraft::ICloud(back)) = back else {
            anyhow::bail!("expected an iCloud draft");
        };
        assert_eq!(back.share, ICloudShare::Unbound);
        assert!(matches!(back.sign_in, ICloudSignIn::SignedIn(_)));
        Ok(())
    }

    #[test]
    fn a_target_binds_only_to_its_own_preset() -> anyhow::Result<()> {
        let folder = GoogleDriveFolderId::parse("folder-1")?;
        let share = ICloudShareTargetId::fixture()?;
        for kind in [
            ProviderKind::Local,
            ProviderKind::LocalFolder,
            ProviderKind::Github,
            ProviderKind::S3,
            ProviderKind::OauthFile(OAuthFilePreset::ICloud),
        ] {
            assert_eq!(
                ProviderDraft::begin(kind).with_google_drive_folder(folder.clone()),
                Err(ProviderDraftMismatch)
            );
        }
        assert_eq!(
            ProviderDraft::begin(ProviderKind::OauthFile(OAuthFilePreset::GoogleDrive))
                .with_icloud_share(share),
            Err(ProviderDraftMismatch)
        );
        assert_eq!(
            ProviderDraftMismatch.to_string(),
            "errors.validation.provider_draft_mismatch"
        );
        Ok(())
    }
}

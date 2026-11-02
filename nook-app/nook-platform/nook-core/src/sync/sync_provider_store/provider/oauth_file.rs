#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
//! Google Drive and iCloud providers: a sign-in and the shared target every
//! authorized account reaches.
//!
//! Both are always shared. A Drive vault folder lists its authorized accounts
//! in its permissions; an iCloud `CloudKit` share lists them as participants.
//! Each account signs in with its own token, which never leaves its browser
//! except in the same-browser companion handoff.

use nook_event_log::IdentityMountTarget;
use serde::{Deserialize, Serialize};
use tsify::Tsify;

use crate::{
    GoogleDriveFolderId, ICloudShareTargetId, IsoTimestamp, OAuthAccountIdentity, OAuthFilePreset,
    ProviderSecretText, ProviderStorageDetailLabels, ProviderTargetKey, StorageConnection,
};

/// The one authorization a Google sign-in returns: its token and when it
/// expires. A later sign-in replaces both together.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GoogleDriveAuthorization {
    pub access_token: ProviderSecretText,
    pub expires_at: IsoTimestamp,
}

/// A Google Drive vault folder and this browser's sign-in to it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GoogleDriveProvider {
    pub authorization: GoogleDriveAuthorization,
    pub account: OAuthAccountIdentity,
    pub folder_id: GoogleDriveFolderId,
}

/// An iCloud `CloudKit` share and this browser's web-auth token for it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ICloudProvider {
    pub web_auth_token: ProviderSecretText,
    pub account: OAuthAccountIdentity,
    pub share_target: ICloudShareTargetId,
}

/// An OAuth provider, tagged by its preset.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "preset", rename_all = "kebab-case")]
pub enum OAuthFileProvider {
    GoogleDrive(GoogleDriveProvider),
    #[serde(rename = "icloud")]
    ICloud(ICloudProvider),
}

impl OAuthFilePreset {
    /// `Google Drive` or `iCloud`: the label of a provider of this preset.
    #[must_use]
    pub const fn provider_label(self) -> &'static str {
        match self {
            Self::GoogleDrive => "Google Drive",
            Self::ICloud => "iCloud",
        }
    }
}

impl ICloudProvider {
    /// The event file name the iCloud detail line has always shown. It is
    /// display text only; no row stores a file name.
    const DETAIL_FILE_NAME: &'static str = "nook-events";
}

impl OAuthFileProvider {
    #[must_use]
    pub const fn preset(&self) -> OAuthFilePreset {
        match self {
            Self::GoogleDrive(_) => OAuthFilePreset::GoogleDrive,
            Self::ICloud(_) => OAuthFilePreset::ICloud,
        }
    }

    #[must_use]
    pub const fn account(&self) -> &OAuthAccountIdentity {
        match self {
            Self::GoogleDrive(drive) => &drive.account,
            Self::ICloud(icloud) => &icloud.account,
        }
    }

    /// The token this browser's sign-in holds.
    #[must_use]
    pub const fn token(&self) -> &ProviderSecretText {
        match self {
            Self::GoogleDrive(drive) => &drive.authorization.access_token,
            Self::ICloud(icloud) => &icloud.web_auth_token,
        }
    }

    /// The account's email, trimmed, or `fallback` when the sign-in named none.
    fn account_or<'a>(account: &'a OAuthAccountIdentity, fallback: &'a str) -> &'a str {
        match account {
            OAuthAccountIdentity::Email(email) if !email.trim().is_empty() => email.trim(),
            OAuthAccountIdentity::Email(_) | OAuthAccountIdentity::Unknown => fallback,
        }
    }

    /// The detail line. Google Drive keeps one Nook folder per account, so it
    /// names the account alone; iCloud keeps the event file's name before it.
    #[must_use]
    pub fn storage_detail(&self, labels: &ProviderStorageDetailLabels) -> String {
        match self {
            Self::GoogleDrive(drive) => {
                Self::account_or(&drive.account, &labels.google_signed_in).to_owned()
            }
            Self::ICloud(icloud) => format!(
                "{} · {}",
                ICloudProvider::DETAIL_FILE_NAME,
                Self::account_or(&icloud.account, &labels.icloud_signed_in)
            ),
        }
    }

    /// One shared target of one account is one provider; a sign-in that named
    /// no account is told apart by its token.
    #[must_use]
    pub fn target_key(&self) -> ProviderTargetKey {
        let account = Self::account_or(self.account(), self.token().expose().trim());
        match self {
            Self::GoogleDrive(drive) => format!(
                "oauth-file:google-drive:shared:{}:{account}",
                drive.folder_id.as_str()
            ),
            Self::ICloud(icloud) => {
                format!(
                    "oauth-file:icloud:{}:{account}",
                    icloud.share_target.as_str()
                )
            }
        }
        .into()
    }

    #[must_use]
    pub fn mount_target(&self) -> IdentityMountTarget {
        match self {
            Self::GoogleDrive(drive) => IdentityMountTarget::GoogleDrive {
                folder_id: drive.folder_id.as_str().to_owned(),
            },
            Self::ICloud(icloud) => IdentityMountTarget::ICloud {
                share_target: icloud.share_target.as_str().to_owned(),
            },
        }
    }

    #[must_use]
    pub fn storage_connection(&self) -> StorageConnection {
        match self {
            Self::GoogleDrive(drive) => StorageConnection::GoogleDrive {
                token: drive.authorization.access_token.clone(),
                folder_id: drive.folder_id.clone(),
            },
            Self::ICloud(icloud) => StorageConnection::ICloud {
                token: icloud.web_auth_token.clone(),
                share_target: icloud.share_target.clone(),
            },
        }
    }

    /// This provider with a fresh sign-in merged into a saved one of the same
    /// target: the fresh authorization as one unit, the saved account when it
    /// is known, and the target the sign-in reached.
    #[must_use]
    pub fn merged_into(self, saved: &Self) -> Self {
        let account = match saved.account() {
            OAuthAccountIdentity::Email(_) => saved.account().clone(),
            OAuthAccountIdentity::Unknown => self.account().clone(),
        };
        match self {
            Self::GoogleDrive(drive) => Self::GoogleDrive(GoogleDriveProvider { account, ..drive }),
            Self::ICloud(icloud) => Self::ICloud(ICloudProvider { account, ..icloud }),
        }
    }

    pub(crate) fn transition_secrets<E>(
        &self,
        mut transition: impl FnMut(&ProviderSecretText) -> Result<ProviderSecretText, E>,
    ) -> Result<Self, E> {
        Ok(match self {
            Self::GoogleDrive(drive) => Self::GoogleDrive(GoogleDriveProvider {
                authorization: GoogleDriveAuthorization {
                    access_token: transition(&drive.authorization.access_token)?,
                    expires_at: drive.authorization.expires_at.clone(),
                },
                account: drive.account.clone(),
                folder_id: drive.folder_id.clone(),
            }),
            Self::ICloud(icloud) => Self::ICloud(ICloudProvider {
                web_auth_token: transition(&icloud.web_auth_token)?,
                account: icloud.account.clone(),
                share_target: icloud.share_target.clone(),
            }),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::{GoogleDriveAuthorization, GoogleDriveProvider, ICloudProvider, OAuthFileProvider};
    use crate::{
        GoogleDriveFolderId, ICloudShareRole, ICloudShareTargetId, ICloudSharedTarget,
        IdentityMountTarget, IsoTimestamp, OAuthAccountIdentity, ProviderSecretText,
        ProviderStorageDetailLabels,
    };
    use serde_json::json;

    impl GoogleDriveAuthorization {
        pub(crate) fn fixture(token: &str) -> anyhow::Result<Self> {
            Ok(Self {
                access_token: ProviderSecretText::try_from(token.to_owned())?,
                expires_at: IsoTimestamp::parse("2030-01-01T00:00:00Z")?,
            })
        }
    }

    impl ICloudShareTargetId {
        pub(crate) fn fixture() -> anyhow::Result<Self> {
            let target = ICloudSharedTarget::new(
                ICloudShareRole::Owner,
                "nook-zone",
                "owner-record",
                "root-record",
                "short-guid",
            )?;
            Ok(Self::try_from(target.to_storage_id()?)?)
        }
    }

    impl OAuthFileProvider {
        pub(crate) fn google_drive_fixture(
            folder_id: &str,
            account: OAuthAccountIdentity,
        ) -> anyhow::Result<Self> {
            Ok(Self::GoogleDrive(GoogleDriveProvider {
                authorization: GoogleDriveAuthorization::fixture("TEST-ONLY-drive-token")?,
                account,
                folder_id: GoogleDriveFolderId::parse(folder_id)?,
            }))
        }

        pub(crate) fn icloud_fixture(account: OAuthAccountIdentity) -> anyhow::Result<Self> {
            Ok(Self::ICloud(ICloudProvider {
                web_auth_token: ProviderSecretText::try_from("TEST-ONLY-icloud-token".to_owned())?,
                account,
                share_target: ICloudShareTargetId::fixture()?,
            }))
        }
    }

    fn email(address: &str) -> OAuthAccountIdentity {
        OAuthAccountIdentity::Email(address.to_owned())
    }

    #[test]
    fn a_drive_provider_names_its_account_and_folder() -> anyhow::Result<()> {
        let labels = ProviderStorageDetailLabels::catalog_fixture();
        let drive = OAuthFileProvider::google_drive_fixture("folder-1", email(" a@b.c "))?;
        assert_eq!(drive.storage_detail(&labels), "a@b.c");
        assert_eq!(
            drive.mount_target(),
            IdentityMountTarget::GoogleDrive {
                folder_id: "folder-1".to_owned()
            }
        );
        let unnamed =
            OAuthFileProvider::google_drive_fixture("folder-1", OAuthAccountIdentity::Unknown)?;
        assert_eq!(unnamed.storage_detail(&labels), labels.google_signed_in);
        assert_ne!(drive.target_key(), unnamed.target_key());
        assert_eq!(
            drive.target_key(),
            OAuthFileProvider::google_drive_fixture("folder-1", email("a@b.c"))?.target_key()
        );
        assert_ne!(
            drive.target_key(),
            OAuthFileProvider::google_drive_fixture("folder-2", email("a@b.c"))?.target_key()
        );
        Ok(())
    }

    #[test]
    fn an_icloud_provider_keeps_its_detail_line_and_share() -> anyhow::Result<()> {
        let labels = ProviderStorageDetailLabels::catalog_fixture();
        let icloud = OAuthFileProvider::icloud_fixture(email("m@icloud.com"))?;
        assert_eq!(icloud.storage_detail(&labels), "nook-events · m@icloud.com");
        assert_eq!(
            OAuthFileProvider::icloud_fixture(OAuthAccountIdentity::Unknown)?
                .storage_detail(&labels),
            format!("nook-events · {}", labels.icloud_signed_in)
        );
        assert!(matches!(
            icloud.mount_target(),
            IdentityMountTarget::ICloud { .. }
        ));
        Ok(())
    }

    #[test]
    fn a_fresh_sign_in_takes_the_saved_account_when_it_is_known() -> anyhow::Result<()> {
        let saved = OAuthFileProvider::google_drive_fixture("folder-1", email("saved@b.c"))?;
        let fresh = OAuthFileProvider::GoogleDrive(GoogleDriveProvider {
            authorization: GoogleDriveAuthorization::fixture("TEST-ONLY-fresh-token")?,
            account: OAuthAccountIdentity::Unknown,
            folder_id: GoogleDriveFolderId::parse("folder-1")?,
        });
        let merged = fresh.clone().merged_into(&saved);
        assert_eq!(merged.token().expose(), "TEST-ONLY-fresh-token");
        assert_eq!(merged.account(), &email("saved@b.c"));
        let unknown_saved =
            OAuthFileProvider::google_drive_fixture("folder-1", OAuthAccountIdentity::Unknown)?;
        let named_fresh = OAuthFileProvider::google_drive_fixture("folder-1", email("new@b.c"))?;
        assert_eq!(
            named_fresh.merged_into(&unknown_saved).account(),
            &email("new@b.c")
        );
        Ok(())
    }

    #[test]
    fn each_preset_reads_back_only_with_its_own_fields() -> anyhow::Result<()> {
        let drive = OAuthFileProvider::google_drive_fixture("folder-1", email("a@b.c"))?;
        let wire = serde_json::to_value(&drive)?;
        assert_eq!(
            wire,
            json!({
                "preset": "google-drive",
                "authorization": {
                    "accessToken": "TEST-ONLY-drive-token",
                    "expiresAt": "2030-01-01T00:00:00Z",
                },
                "account": { "state": "email", "email": "a@b.c" },
                "folderId": "folder-1",
            })
        );
        assert_eq!(serde_json::from_value::<OAuthFileProvider>(wire)?, drive);
        let icloud = OAuthFileProvider::icloud_fixture(OAuthAccountIdentity::Unknown)?;
        assert_eq!(
            serde_json::from_value::<OAuthFileProvider>(serde_json::to_value(&icloud)?)?,
            icloud
        );
        let share = serde_json::to_value(ICloudShareTargetId::fixture()?)?;
        for mixed in [
            json!({
                "preset": "google-drive",
                "authorization": { "accessToken": "t", "expiresAt": "2030-01-01T00:00:00Z" },
                "account": { "state": "unknown" },
                "folderId": "folder-1",
                "shareTarget": share,
            }),
            json!({
                "preset": "icloud",
                "webAuthToken": "t",
                "account": { "state": "unknown" },
                "shareTarget": share,
                "folderId": "folder-1",
            }),
            json!({
                "preset": "icloud",
                "webAuthToken": " ",
                "account": { "state": "unknown" },
                "shareTarget": share,
            }),
            json!({
                "preset": "google-drive",
                "authorization": { "accessToken": "t", "expiresAt": "2030-01-01T00:00:00Z" },
                "account": { "state": "unknown" },
                "folderId": "https://drive.google.com/drive/folders/folder-1",
            }),
        ] {
            assert!(
                serde_json::from_value::<OAuthFileProvider>(mixed.clone()).is_err(),
                "{mixed}"
            );
        }
        assert!(!format!("{drive:?}").contains("TEST-ONLY"));
        Ok(())
    }
}

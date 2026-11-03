#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
//! A fresh OAuth sign-in reaching the saved rows it belongs to outside a
//! save: a token refresh, or the wider grant a Drive sync asks for.
//!
//! A row is found by its shared target, not by its duplicate key: the key of
//! a row whose sign-in named no account holds the old token, which a refresh
//! has just replaced.

use serde::Deserialize;
use tsify::Tsify;

use crate::{
    AuthProvidersSnapshot, GoogleDriveProvider, ICloudProvider, OAuthAccountIdentity,
    OAuthFileProvider, ProviderDraft, StorageProvider, StoredProvider,
};

/// A draft holding a fresh sign-in, and the saved rows it may belong to.
#[derive(Debug, Deserialize, Tsify)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProviderSignInUpdate {
    pub snapshot: AuthProvidersSnapshot,
    pub draft: ProviderDraft,
}

/// Whose sign-in a fresh account is, against a saved row's account.
enum SignInAccount {
    /// The row's own sign-in, keeping whichever account is known: the saved
    /// one first, as a save's merge does.
    Own(OAuthAccountIdentity),
    /// Two different known accounts are two providers.
    Other,
}

impl SignInAccount {
    fn between(saved: &OAuthAccountIdentity, fresh: &OAuthAccountIdentity) -> Self {
        match (saved, fresh) {
            (
                OAuthAccountIdentity::Email(saved_email),
                OAuthAccountIdentity::Email(fresh_email),
            ) if saved_email.trim() != fresh_email.trim() => Self::Other,
            (OAuthAccountIdentity::Email(_), _) => Self::Own(saved.clone()),
            (OAuthAccountIdentity::Unknown, _) => Self::Own(fresh.clone()),
        }
    }
}

impl ProviderSignInUpdate {
    /// The snapshot with the draft's sign-in in every saved row of its
    /// target and account. A draft that is not signed in, or not bound to
    /// its target yet, belongs to no saved row and changes nothing.
    #[must_use]
    pub fn apply(self) -> AuthProvidersSnapshot {
        let Self { snapshot, draft } = self;
        let fresh = match draft {
            ProviderDraft::OauthFile(oauth) => match oauth.complete() {
                Ok(fresh) => fresh,
                Err(_) => return snapshot,
            },
            ProviderDraft::Local {}
            | ProviderDraft::LocalFolder(_)
            | ProviderDraft::Github(_)
            | ProviderDraft::S3(_) => return snapshot,
        };
        AuthProvidersSnapshot {
            providers: snapshot
                .providers
                .into_iter()
                .map(|row| row.with_sign_in(&fresh))
                .collect(),
            active_vault_store_id: snapshot.active_vault_store_id,
        }
    }
}

impl StorageProvider {
    fn with_sign_in(self, fresh: &OAuthFileProvider) -> Self {
        match self.provider {
            StoredProvider::OauthFile(saved) => Self {
                provider: StoredProvider::OauthFile(saved.with_sign_in(fresh)),
                ..self
            },
            other => Self {
                provider: other,
                ..self
            },
        }
    }
}

impl OAuthFileProvider {
    /// This saved provider after a fresh sign-in: one to its own target and
    /// account replaces its authorization as one unit. One to another target
    /// or another known account leaves it as it is.
    fn with_sign_in(self, fresh: &Self) -> Self {
        let account = match SignInAccount::between(self.account(), fresh.account()) {
            SignInAccount::Own(account) => account,
            SignInAccount::Other => return self,
        };
        match (self, fresh) {
            (Self::GoogleDrive(saved), Self::GoogleDrive(signed_in))
                if saved.folder_id == signed_in.folder_id =>
            {
                Self::GoogleDrive(GoogleDriveProvider {
                    authorization: signed_in.authorization.clone(),
                    account,
                    folder_id: saved.folder_id,
                })
            }
            (Self::ICloud(saved), Self::ICloud(signed_in))
                if saved.share_target == signed_in.share_target =>
            {
                Self::ICloud(ICloudProvider {
                    web_auth_token: signed_in.web_auth_token.clone(),
                    account,
                    share_target: saved.share_target,
                })
            }
            (saved, _) => saved,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::ProviderSignInUpdate;
    use crate::{
        ActiveVaultScope, AuthProvidersSnapshot, GoogleDriveAccess, GoogleDriveAuthorization,
        GoogleDriveFolderId, ICloudAccess, ICloudShareTargetId, OAuthAccountIdentity,
        OAuthFilePreset, OAuthFileProvider, ProviderDraft, ProviderKind, ProviderSecretText,
        StorageProvider, StoredProvider,
    };

    fn email(address: &str) -> OAuthAccountIdentity {
        OAuthAccountIdentity::Email(address.to_owned())
    }

    fn drive_row(
        id: &str,
        folder_id: &str,
        account: OAuthAccountIdentity,
    ) -> anyhow::Result<StorageProvider> {
        Ok(StorageProvider::fixture(
            id,
            StoredProvider::OauthFile(OAuthFileProvider::google_drive_fixture(folder_id, account)?),
        ))
    }

    fn icloud_row(id: &str, account: OAuthAccountIdentity) -> anyhow::Result<StorageProvider> {
        Ok(StorageProvider::fixture(
            id,
            StoredProvider::OauthFile(OAuthFileProvider::icloud_fixture(account)?),
        ))
    }

    fn snapshot(providers: Vec<StorageProvider>) -> AuthProvidersSnapshot {
        AuthProvidersSnapshot {
            providers,
            active_vault_store_id: ActiveVaultScope::StoreId("store-1".to_owned()),
        }
    }

    fn fresh_drive(account: OAuthAccountIdentity) -> anyhow::Result<GoogleDriveAccess> {
        Ok(GoogleDriveAccess {
            authorization: GoogleDriveAuthorization::fixture("TEST-ONLY-fresh-drive")?,
            account,
        })
    }

    /// A Drive draft signed in afresh and bound to `folder_id`.
    fn drive_draft(
        folder_id: &str,
        account: OAuthAccountIdentity,
    ) -> anyhow::Result<ProviderDraft> {
        Ok(
            ProviderDraft::begin(ProviderKind::OauthFile(OAuthFilePreset::GoogleDrive))
                .with_google_drive_folder(GoogleDriveFolderId::parse(folder_id)?)?
                .with_google_drive_access(fresh_drive(account)?),
        )
    }

    fn drive_of(row: &StorageProvider) -> anyhow::Result<(&str, &OAuthAccountIdentity)> {
        match &row.provider {
            StoredProvider::OauthFile(OAuthFileProvider::GoogleDrive(drive)) => {
                Ok((drive.authorization.access_token.expose(), &drive.account))
            }
            _ => anyhow::bail!("{} should be a Drive row", row.id),
        }
    }

    #[test]
    fn a_fresh_drive_sign_in_reaches_every_row_of_its_folder_and_account() -> anyhow::Result<()> {
        let github = StorageProvider::fixture("github", StoredProvider::github_fixture()?);
        let icloud = icloud_row("icloud", OAuthAccountIdentity::Unknown)?;
        let other_account = drive_row("other-account", "folder-1", email("z@b.c"))?;
        let other_folder = drive_row("other-folder", "folder-2", OAuthAccountIdentity::Unknown)?;
        let updated = ProviderSignInUpdate {
            snapshot: snapshot(vec![
                drive_row("unnamed", "folder-1", OAuthAccountIdentity::Unknown)?,
                drive_row("named", "folder-1", email("a@b.c"))?,
                other_account.clone(),
                other_folder.clone(),
                icloud.clone(),
                github.clone(),
            ]),
            draft: drive_draft("folder-1", email("a@b.c"))?,
        }
        .apply();

        let [unnamed, named, kept @ ..] = updated.providers.as_slice() else {
            anyhow::bail!("every row stays");
        };
        let fresh = GoogleDriveAuthorization::fixture("TEST-ONLY-fresh-drive")?;
        for row in [unnamed, named] {
            // The authorization moves as one unit, and the row learns the
            // account the sign-in named.
            let StoredProvider::OauthFile(OAuthFileProvider::GoogleDrive(drive)) = &row.provider
            else {
                anyhow::bail!("{} should be a Drive row", row.id);
            };
            assert_eq!(drive.authorization, fresh);
            assert_eq!(drive.account, email("a@b.c"));
            assert_eq!(drive.folder_id, GoogleDriveFolderId::parse("folder-1")?);
        }
        assert_eq!(kept, [other_account, other_folder, icloud, github]);
        assert_eq!(
            updated.active_vault_store_id,
            ActiveVaultScope::StoreId("store-1".to_owned())
        );
        Ok(())
    }

    #[test]
    fn a_sign_in_naming_no_account_keeps_each_rows_known_account() -> anyhow::Result<()> {
        let updated = ProviderSignInUpdate {
            snapshot: snapshot(vec![drive_row("named", "folder-1", email("a@b.c"))?]),
            draft: drive_draft("folder-1", OAuthAccountIdentity::Unknown)?,
        }
        .apply();
        let [row] = updated.providers.as_slice() else {
            anyhow::bail!("the row stays");
        };
        assert_eq!(drive_of(row)?, ("TEST-ONLY-fresh-drive", &email("a@b.c")));
        Ok(())
    }

    #[test]
    fn a_fresh_icloud_sign_in_reaches_the_rows_of_its_share() -> anyhow::Result<()> {
        let drive = drive_row("drive", "folder-1", OAuthAccountIdentity::Unknown)?;
        let draft = ProviderDraft::begin(ProviderKind::OauthFile(OAuthFilePreset::ICloud))
            .with_icloud_share(ICloudShareTargetId::fixture()?)?
            .with_icloud_access(ICloudAccess {
                web_auth_token: ProviderSecretText::try_from("TEST-ONLY-fresh-icloud".to_owned())?,
                account: email("m@icloud.com"),
            });
        let updated = ProviderSignInUpdate {
            snapshot: snapshot(vec![
                icloud_row("icloud", OAuthAccountIdentity::Unknown)?,
                drive.clone(),
            ]),
            draft,
        }
        .apply();
        let [icloud, kept] = updated.providers.as_slice() else {
            anyhow::bail!("both rows stay");
        };
        let StoredProvider::OauthFile(OAuthFileProvider::ICloud(icloud)) = &icloud.provider else {
            anyhow::bail!("the first row should be an iCloud row");
        };
        assert_eq!(icloud.web_auth_token.expose(), "TEST-ONLY-fresh-icloud");
        assert_eq!(icloud.account, email("m@icloud.com"));
        assert_eq!(icloud.share_target, ICloudShareTargetId::fixture()?);
        assert_eq!(kept, &drive);
        Ok(())
    }

    #[test]
    fn a_draft_without_a_sign_in_or_a_target_changes_nothing() -> anyhow::Result<()> {
        let rows = snapshot(vec![
            drive_row("drive", "folder-1", OAuthAccountIdentity::Unknown)?,
            icloud_row("icloud", OAuthAccountIdentity::Unknown)?,
        ]);
        let drive = ProviderKind::OauthFile(OAuthFilePreset::GoogleDrive);
        for draft in [
            // Bound to the folder, not signed in.
            ProviderDraft::begin(drive)
                .with_google_drive_folder(GoogleDriveFolderId::parse("folder-1")?)?,
            // Signed in, with no folder yet.
            ProviderDraft::begin(drive).with_google_drive_access(fresh_drive(email("a@b.c"))?),
            ProviderDraft::begin(ProviderKind::OauthFile(OAuthFilePreset::ICloud)),
            ProviderDraft::from(StoredProvider::github_fixture()?),
            ProviderDraft::begin(ProviderKind::Local),
        ] {
            let kind = draft.kind();
            assert_eq!(
                ProviderSignInUpdate {
                    snapshot: rows.clone(),
                    draft,
                }
                .apply(),
                rows,
                "{kind:?}"
            );
        }
        Ok(())
    }
}

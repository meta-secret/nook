//! Which My Drive folder a new Google Drive provider syncs under.
//!
//! Every Google account holds one app-owned Nook root folder in My Drive,
//! always named [`NOOK_PROVIDER_ROOT_NAME`]. Connect & sync looks it up among
//! the signed-in account's My Drive root folders before creating it, so
//! every connect reaches the same root instead of adding another folder.
//! Several candidates only exist when the user duplicated the root by hand;
//! the lookup then fails closed rather than guessing.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use crate::GoogleDriveFolderId;
use crate::errors::{ValidationError, ValidationResult};
use crate::provider_vault_listing::NOOK_PROVIDER_ROOT_NAME;
use serde::Deserialize;

/// The Drive MIME type of a folder.
pub const DRIVE_FOLDER_MIME_TYPE: &str = "application/vnd.google-apps.folder";

/// One My Drive root folder a vault-folder lookup reported.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DriveVaultFolderObservation {
    pub id: String,
    pub name: String,
    pub mime_type: String,
}

/// The Nook root folder Connect & sync binds the provider to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DriveVaultFolderSelection {
    /// The account has no Nook root yet: create it.
    Create,
    /// The account's one Nook root: sync beside the vaults already in it.
    Existing(GoogleDriveFolderId),
}

/// The root folders Drive reported for the fixed Nook root name.
pub struct DriveVaultFolderLookup<'a> {
    pub folders: &'a [DriveVaultFolderObservation],
}

impl DriveVaultFolderLookup<'_> {
    /// The fixed name of every account's Nook root folder.
    #[must_use]
    pub const fn root_name() -> &'static str {
        NOOK_PROVIDER_ROOT_NAME
    }

    /// Reuse the one Nook root, create it when none exists, and refuse to
    /// choose between several.
    pub fn select(self) -> ValidationResult<DriveVaultFolderSelection> {
        let matching = self
            .folders
            .iter()
            .filter(|folder| {
                folder.name == NOOK_PROVIDER_ROOT_NAME && folder.mime_type == DRIVE_FOLDER_MIME_TYPE
            })
            .collect::<Vec<_>>();
        match matching.as_slice() {
            [] => Ok(DriveVaultFolderSelection::Create),
            [folder] => Ok(DriveVaultFolderSelection::Existing(
                GoogleDriveFolderId::parse(&folder.id)?,
            )),
            _ => Err(ValidationError::GoogleDriveVaultFolderAmbiguous),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder(id: &str, name: &str) -> DriveVaultFolderObservation {
        DriveVaultFolderObservation {
            id: id.to_owned(),
            name: name.to_owned(),
            mime_type: DRIVE_FOLDER_MIME_TYPE.to_owned(),
        }
    }

    fn select(
        folders: &[DriveVaultFolderObservation],
    ) -> ValidationResult<DriveVaultFolderSelection> {
        DriveVaultFolderLookup { folders }.select()
    }

    #[test]
    fn every_account_uses_the_fixed_nook_root_name() {
        assert_eq!(DriveVaultFolderLookup::root_name(), "Nook");
    }

    #[test]
    fn creates_the_root_only_when_none_exists() -> anyhow::Result<()> {
        assert_eq!(select(&[])?, DriveVaultFolderSelection::Create);
        let mut file = folder("file-1", "Nook");
        file.mime_type = "text/plain".to_owned();
        assert_eq!(
            select(&[file, folder("other", "nook-events")])?,
            DriveVaultFolderSelection::Create
        );
        Ok(())
    }

    #[test]
    fn earlier_named_folders_are_ignored() -> anyhow::Result<()> {
        assert_eq!(
            select(&[
                folder("old-1", "nook-events"),
                folder("old-2", "nook-events"),
                folder("root", "Nook"),
            ])?,
            DriveVaultFolderSelection::Existing(GoogleDriveFolderId::parse("root")?)
        );
        Ok(())
    }

    #[test]
    fn a_duplicated_root_fails_without_guessing() {
        assert_eq!(
            select(&[folder("a", "Nook"), folder("b", "Nook")]),
            Err(ValidationError::GoogleDriveVaultFolderAmbiguous)
        );
    }

    #[test]
    fn an_existing_root_without_a_usable_id_is_rejected() {
        assert_eq!(
            select(&[folder(" ", "Nook")]),
            Err(ValidationError::SharedStorageTargetRequired)
        );
        assert_eq!(
            select(&[folder("bad/id", "Nook")]),
            Err(ValidationError::SharedStorageTargetInvalid)
        );
    }
}

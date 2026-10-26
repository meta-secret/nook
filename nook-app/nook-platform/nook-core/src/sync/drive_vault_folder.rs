//! Which My Drive folder a new Google Drive provider syncs under.
//!
//! Connect & sync looks up the folder named in setup among the signed-in
//! account's My Drive root folders before creating one. Reusing an existing
//! folder keeps an existing vault reachable instead of hiding it behind an
//! empty duplicate; several candidates fail closed rather than guessing.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use crate::GoogleDriveFolderId;
use crate::errors::{ValidationError, ValidationResult};
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

/// The vault folder Connect & sync binds the provider to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DriveVaultFolderSelection {
    /// No folder carries the name yet: create it.
    Create,
    /// Exactly one folder carries the name: sync with the events already in it.
    Existing(GoogleDriveFolderId),
}

/// The folder name from setup and the root folders Drive reported for it.
pub struct DriveVaultFolderLookup<'a> {
    pub name: &'a str,
    pub folders: &'a [DriveVaultFolderObservation],
}

impl DriveVaultFolderLookup<'_> {
    /// Reuse the one folder with exactly this name, create one when none
    /// exists, and refuse to choose between several.
    pub fn select(self) -> ValidationResult<DriveVaultFolderSelection> {
        let name = self.name.trim();
        let matching = self
            .folders
            .iter()
            .filter(|folder| folder.name == name && folder.mime_type == DRIVE_FOLDER_MIME_TYPE)
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
        name: &str,
        folders: &[DriveVaultFolderObservation],
    ) -> ValidationResult<DriveVaultFolderSelection> {
        DriveVaultFolderLookup { name, folders }.select()
    }

    #[test]
    fn creates_the_folder_only_when_none_carries_the_name() -> anyhow::Result<()> {
        assert_eq!(
            select("nook-events", &[])?,
            DriveVaultFolderSelection::Create
        );
        let mut file = folder("file-1", "nook-events");
        file.mime_type = "text/plain".to_owned();
        assert_eq!(
            select("nook-events", &[file, folder("other", "Other vault")])?,
            DriveVaultFolderSelection::Create
        );
        Ok(())
    }

    #[test]
    fn reuses_the_one_existing_folder_with_that_name() -> anyhow::Result<()> {
        assert_eq!(
            select(
                "  nook-events ",
                &[
                    folder("other", "Other vault"),
                    folder("vault-folder", "nook-events")
                ]
            )?,
            DriveVaultFolderSelection::Existing(GoogleDriveFolderId::parse("vault-folder")?)
        );
        Ok(())
    }

    #[test]
    fn several_folders_with_the_name_fail_without_guessing() {
        assert_eq!(
            select(
                "nook-events",
                &[folder("a", "nook-events"), folder("b", "nook-events")]
            ),
            Err(ValidationError::GoogleDriveVaultFolderAmbiguous)
        );
    }

    #[test]
    fn an_existing_folder_without_a_usable_id_is_rejected() {
        assert_eq!(
            select("nook-events", &[folder(" ", "nook-events")]),
            Err(ValidationError::SharedStorageTargetRequired)
        );
        assert_eq!(
            select("nook-events", &[folder("bad/id", "nook-events")]),
            Err(ValidationError::SharedStorageTargetInvalid)
        );
    }
}

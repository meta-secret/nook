#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
//! A folder this browser picked with the File System Access API.

use serde::{Deserialize, Serialize};
use tsify::Tsify;

use crate::errors::{ValidationError, ValidationResult};

/// The folder's name as the browser's folder picker reported it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(from = "String")]
#[tsify(type = "string")]
pub struct LocalFolderName(String);

/// The id this browser keeps the folder's handle under, to reopen it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(try_from = "String")]
#[tsify(type = "string")]
pub struct LocalFolderHandleId(String);

/// A picked folder: its name and the handle that reopens it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalFolderProvider {
    pub directory_name: LocalFolderName,
    pub handle_id: LocalFolderHandleId,
}

impl From<String> for LocalFolderName {
    fn from(name: String) -> Self {
        Self(name)
    }
}

impl LocalFolderName {
    #[must_use]
    pub fn as_str(&self) -> &str {
        let Self(name) = self;
        name
    }

    /// `Local backup · name`, or `Local backup` for a blank name.
    #[must_use]
    pub fn label(&self) -> String {
        match self.as_str().trim() {
            "" => "Local backup".to_owned(),
            name => format!("Local backup · {name}"),
        }
    }
}

/// A blank id names no handle.
impl TryFrom<String> for LocalFolderHandleId {
    type Error = ValidationError;
    fn try_from(id: String) -> ValidationResult<Self> {
        match id.trim() {
            "" => Err(ValidationError::LocalFolderHandleInvalid),
            id => Ok(Self(id.to_owned())),
        }
    }
}

impl LocalFolderHandleId {
    #[must_use]
    pub fn as_str(&self) -> &str {
        let Self(id) = self;
        id
    }
}

impl LocalFolderProvider {
    /// The detail line: the folder's name, or the reconnect hint when the
    /// picker reported a blank one.
    #[must_use]
    pub fn storage_detail(&self, needs_reconnect: &str) -> String {
        match self.directory_name.as_str().trim() {
            "" => needs_reconnect.to_owned(),
            name => name.to_owned(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{LocalFolderHandleId, LocalFolderName, LocalFolderProvider};
    use crate::errors::ValidationError;
    use serde_json::json;
    use tsify::Tsify;

    impl LocalFolderProvider {
        pub(crate) fn fixture(name: &str, handle_id: &str) -> anyhow::Result<Self> {
            Ok(Self {
                directory_name: LocalFolderName::from(name.to_owned()),
                handle_id: LocalFolderHandleId::try_from(handle_id.to_owned())?,
            })
        }
    }

    #[test]
    fn a_folder_reads_back_with_a_handle_and_labels_by_its_name() -> anyhow::Result<()> {
        let folder = LocalFolderProvider::fixture(" Nook Backup ", " handle-1 ")?;
        assert_eq!(folder.handle_id.as_str(), "handle-1");
        assert_eq!(folder.directory_name.label(), "Local backup · Nook Backup");
        assert_eq!(folder.storage_detail("Reconnect"), "Nook Backup");
        let unnamed = LocalFolderProvider::fixture(" ", "handle-1")?;
        assert_eq!(unnamed.directory_name.label(), "Local backup");
        assert_eq!(unnamed.storage_detail("Reconnect"), "Reconnect");
        let wire = serde_json::to_value(&folder)?;
        assert_eq!(
            wire,
            json!({ "directoryName": " Nook Backup ", "handleId": "handle-1" })
        );
        assert_eq!(serde_json::from_value::<LocalFolderProvider>(wire)?, folder);
        for damaged in [
            json!({ "directoryName": "Nook", "handleId": " " }),
            json!({ "directoryName": "Nook" }),
            json!({ "directoryName": "Nook", "handleId": "h", "token": "x" }),
        ] {
            assert!(serde_json::from_value::<LocalFolderProvider>(damaged).is_err());
        }
        assert_eq!(
            LocalFolderHandleId::try_from(String::new()),
            Err(ValidationError::LocalFolderHandleInvalid)
        );
        assert!(LocalFolderHandleId::DECL.ends_with("export type LocalFolderHandleId = string;"));
        Ok(())
    }
}

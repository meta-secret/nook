//! Google Drive child folders that separate event-log namespaces.
//!
//! A legacy vault root keeps listing only the direct children of its event
//! parent. Identity logs and namespaced vaults live one folder deeper, so their
//! files never enter a legacy vault's fail-closed classification.

#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use nook_core::{DriveEventParent, EventLogLocation};
use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::NookError;

const DRIVE_FOLDER_MIME_TYPE: &str = "application/vnd.google-apps.folder";

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NamespaceFolderList {
    #[serde(default)]
    files: Vec<NamespaceFolder>,
    #[serde(default)]
    next_page_token: Option<String>,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NamespaceFolder {
    #[serde(default)]
    id: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    mime_type: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NamespaceFolderMetadata<'a> {
    name: &'a str,
    mime_type: &'a str,
    parents: [&'a str; 1],
}

/// Resolve the Drive event parent that holds one event-log namespace.
pub(crate) struct DriveNamespace<'a> {
    pub(crate) token: &'a str,
    pub(crate) parent: &'a DriveEventParent,
    pub(crate) location: &'a EventLogLocation,
}

impl DriveNamespace<'_> {
    fn folder_name(tag: &str) -> String {
        format!("nook-{}", tag.replace(':', "-"))
    }

    fn parent_id(parent: &DriveEventParent) -> &str {
        match parent {
            DriveEventParent::AppDataFolder => "appDataFolder",
            DriveEventParent::PrivateAppDataFolder { folder_id }
            | DriveEventParent::SharedFolder { folder_id } => folder_id.as_str(),
        }
    }

    fn child_parent(parent: &DriveEventParent, folder_id: String) -> DriveEventParent {
        match parent {
            DriveEventParent::AppDataFolder | DriveEventParent::PrivateAppDataFolder { .. } => {
                DriveEventParent::PrivateAppDataFolder { folder_id }
            }
            DriveEventParent::SharedFolder { .. } => DriveEventParent::SharedFolder { folder_id },
        }
    }

    fn in_app_data(parent: &DriveEventParent) -> bool {
        matches!(
            parent,
            DriveEventParent::AppDataFolder | DriveEventParent::PrivateAppDataFolder { .. }
        )
    }

    fn query(parent: &DriveEventParent, name: &str) -> String {
        let escaped_name = name.replace('\\', "\\\\").replace('\'', "\\'");
        let escaped_parent = Self::parent_id(parent).replace('\'', "\\'");
        format!(
            "name = '{escaped_name}' and mimeType = '{DRIVE_FOLDER_MIME_TYPE}' and '{escaped_parent}' in parents and trashed = false"
        )
    }

    fn select(folders: &[NamespaceFolder]) -> Result<Option<String>, NookError> {
        match folders {
            [] => Ok(None),
            [folder] if !folder.id.trim().is_empty() => Ok(Some(folder.id.trim().to_owned())),
            [_] => Err(NookError::Drive(
                "Google Drive namespace folder is missing its ID.".to_owned(),
            )),
            _ => Err(NookError::Drive(
                "Google Drive contains ambiguous namespace folders; sync stopped before choosing one."
                    .to_owned(),
            )),
        }
    }

    async fn list(&self, name: &str) -> Result<Vec<NamespaceFolder>, NookError> {
        let client = Client::new();
        let query = Self::query(self.parent, name);
        let mut page_token: Option<String> = None;
        let mut folders = Vec::new();
        loop {
            let mut request = client
                .get("https://www.googleapis.com/drive/v3/files")
                .header("Authorization", format!("Bearer {}", self.token.trim()))
                .query(&[
                    ("q", query.as_str()),
                    ("fields", "nextPageToken,files(id,name,mimeType)"),
                    ("pageSize", "1000"),
                ]);
            if Self::in_app_data(self.parent) {
                request = request.query(&[("spaces", "appDataFolder")]);
            }
            if let Some(page) = page_token.as_deref() {
                request = request.query(&[("pageToken", page)]);
            }
            let response = request.send().await?;
            if !response.status().is_success() {
                return Err(NookError::Drive(format!(
                    "Google Drive namespace lookup failed with status {}",
                    response.status()
                )));
            }
            let body: NamespaceFolderList = response
                .json()
                .await
                .map_err(|error| NookError::Serialization(error.to_string()))?;
            folders.extend(body.files.into_iter().filter(|folder| {
                folder.name == name && folder.mime_type == DRIVE_FOLDER_MIME_TYPE
            }));
            page_token = body.next_page_token;
            if page_token.is_none() {
                return Ok(folders);
            }
        }
    }

    async fn create(&self, name: &str) -> Result<String, NookError> {
        let response = Client::new()
            .post("https://www.googleapis.com/drive/v3/files")
            .header("Authorization", format!("Bearer {}", self.token.trim()))
            .header("User-Agent", "nook-wasm")
            .json(&NamespaceFolderMetadata {
                name,
                mime_type: DRIVE_FOLDER_MIME_TYPE,
                parents: [Self::parent_id(self.parent)],
            })
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(NookError::Drive(format!(
                "Google Drive namespace creation failed with status {}",
                response.status()
            )));
        }
        let created: NamespaceFolder = response
            .json()
            .await
            .map_err(|error| NookError::Serialization(error.to_string()))?;
        if created.id.trim().is_empty() || created.name != name {
            return Err(NookError::Drive(
                "Google Drive returned an invalid namespace folder.".to_owned(),
            ));
        }
        Ok(created.id.trim().to_owned())
    }

    /// Identity ids that have a namespace folder under this parent.
    pub(crate) async fn list_identity_ids(&self) -> Result<Vec<String>, NookError> {
        let client = Client::new();
        let escaped_parent = Self::parent_id(self.parent).replace('\'', "\\'");
        let query = format!(
            "name contains 'nook-identity-' and mimeType = '{DRIVE_FOLDER_MIME_TYPE}' and '{escaped_parent}' in parents and trashed = false"
        );
        let mut request = client
            .get("https://www.googleapis.com/drive/v3/files")
            .header("Authorization", format!("Bearer {}", self.token.trim()))
            .query(&[
                ("q", query.as_str()),
                ("fields", "files(id,name,mimeType)"),
                ("pageSize", "1000"),
            ]);
        if Self::in_app_data(self.parent) {
            request = request.query(&[("spaces", "appDataFolder")]);
        }
        let response = request.send().await?;
        if !response.status().is_success() {
            return Err(NookError::Drive(format!(
                "Google Drive identity lookup failed with status {}",
                response.status()
            )));
        }
        let body: NamespaceFolderList = response
            .json()
            .await
            .map_err(|error| NookError::Serialization(error.to_string()))?;
        let mut ids = body
            .files
            .into_iter()
            .filter_map(|folder| {
                folder
                    .name
                    .strip_prefix("nook-identity-")
                    .map(str::to_owned)
            })
            .collect::<Vec<_>>();
        ids.sort();
        ids.dedup();
        Ok(ids)
    }

    /// The legacy root is the parent itself. Other namespaces resolve or
    /// create one child folder; a duplicate fails closed.
    pub(crate) async fn resolve(&self) -> Result<DriveEventParent, NookError> {
        let Some(tag) = self.location.namespace_tag() else {
            return Ok(self.parent.clone());
        };
        let name = Self::folder_name(&tag);
        if let Some(folder_id) = Self::select(&self.list(&name).await?)? {
            return Ok(Self::child_parent(self.parent, folder_id));
        }
        let created = self.create(&name).await?;
        // A second lookup catches a concurrent creation before any write picks
        // one of two ambiguous parents.
        let folder_id = Self::select(&self.list(&name).await?)?.unwrap_or(created);
        Ok(Self::child_parent(self.parent, folder_id))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test callback"
        )
    )]
    fn namespace_folders_stay_inside_their_parent_scope() -> anyhow::Result<()> {
        let identity = nook_core::IdentityId::parse("idn_abcdefghijk")?;
        let tag = EventLogLocation::Identity(identity)
            .namespace_tag()
            .ok_or_else(|| anyhow::anyhow!("identity logs are namespaced"))?;
        assert_eq!(
            DriveNamespace::folder_name(&tag),
            "nook-identity-idn_abcdefghijk"
        );
        let shared = DriveEventParent::SharedFolder {
            folder_id: "shared-root".to_owned(),
        };
        assert_eq!(
            DriveNamespace::child_parent(&shared, "child".to_owned()),
            DriveEventParent::SharedFolder {
                folder_id: "child".to_owned()
            }
        );
        assert_eq!(
            DriveNamespace::child_parent(&DriveEventParent::AppDataFolder, "child".to_owned()),
            DriveEventParent::PrivateAppDataFolder {
                folder_id: "child".to_owned()
            }
        );
        assert_eq!(
            DriveNamespace::query(&shared, "nook-o'neil"),
            "name = 'nook-o\\'neil' and mimeType = 'application/vnd.google-apps.folder' and 'shared-root' in parents and trashed = false"
        );
        assert!(DriveNamespace::select(&[]).is_ok_and(|selected| selected.is_none()));
        let duplicate = [NamespaceFolder::default(), NamespaceFolder::default()];
        assert!(DriveNamespace::select(&duplicate).is_err());
        Ok(())
    }
}

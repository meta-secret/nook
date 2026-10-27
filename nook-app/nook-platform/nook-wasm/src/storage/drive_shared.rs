//! Google Drive Nook root helpers. Opening, creating, and sharing the root
//! need only `drive.file`; reading events other authorized accounts created
//! there also needs `drive.readonly`.
//!
//! Every Drive provider syncs under the account's one `Nook` root folder in
//! My Drive, each identity and vault in its own subfolder. The root's Drive
//! permissions are the provider's authorized accounts: sharing it with an
//! account lets a device signed in as that account join the vault.

use crate::DriveStorageClient;

use super::drive::wire::{FileIdentity, FileName};
use crate::NookError;
use serde::{Deserialize, Serialize};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DriveFolderCreateRequest<'a> {
    name: &'a str,
    mime_type: &'static str,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DriveFolderPermissionRequest<'a> {
    #[serde(rename = "type")]
    permission_type: &'static str,
    role: &'static str,
    email_address: &'a str,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DriveVaultFolderListResponse {
    #[serde(default)]
    files: Vec<nook_core::DriveVaultFolderObservation>,
    #[serde(default)]
    next_page_token: Option<String>,
}

/// The vault folder Connect & sync bound the provider to.
pub(crate) struct DriveVaultFolderConnection {
    pub(crate) id: String,
    pub(crate) name: String,
    /// The folder existed before this connect; its events are kept.
    pub(crate) existed: bool,
}

#[derive(Deserialize)]
struct DriveFileCreateResponse {
    #[serde(default)]
    id: FileIdentity,
    #[serde(default)]
    name: FileName,
}

pub(crate) struct DriveStorageClientShareFolderWithEmail<'a> {
    pub(crate) folder_id: &'a str,
    pub(crate) email: &'a str,
}
impl DriveStorageClient<'_> {
    fn shared_drive_error(request: DriveStorageClientSharedDriveError<'_>) -> NookError {
        let DriveStorageClientSharedDriveError { status, body } = request;
        NookError::Drive(format!(
            "Google Drive API responded with status {status}{}",
            if body.is_empty() {
                String::new()
            } else {
                format!(" — {body}")
            }
        ))
    }
}

impl DriveStorageClient<'_> {
    /// My Drive root folders this account owns with exactly this name. With
    /// `drive.file` alone Drive reports only folders Nook created.
    fn vault_folder_query(name: &str) -> String {
        let escaped_name = name.replace('\\', "\\\\").replace('\'', "\\'");
        format!(
            "name = '{escaped_name}' and mimeType = '{}' and 'root' in parents and 'me' in owners and trashed = false",
            nook_core::DRIVE_FOLDER_MIME_TYPE
        )
    }
}

impl DriveStorageClient<'_> {
    fn create_folder_projection(
        request: DriveStorageClientCreateFolderProjection<'_>,
    ) -> Result<(String, String), NookError> {
        let DriveStorageClientCreateFolderProjection {
            parsed,
            fallback_name,
        } = request;
        let folder_id = match parsed.id {
            FileIdentity::Reported(id) if !id.trim().is_empty() => id,
            _ => {
                return Err(NookError::Drive(
                    "Drive folder create response missing id.".to_owned(),
                ));
            }
        };
        let folder_name = match parsed.name {
            FileName::Reported(name) if !name.trim().is_empty() => name,
            _ => fallback_name.to_owned(),
        };
        Ok((folder_id, folder_name))
    }
}

/// Open the account's one Nook root folder, creating it only when none
/// exists. Requires `drive.file` scope.
impl DriveStorageClient<'_> {
    /// The account's Nook root, looked up without creating it.
    pub(crate) async fn find_vault_folder(
        &self,
    ) -> Result<nook_core::DriveVaultFolderSelection, NookError> {
        let folders = self.list_vault_folders().await?;
        Ok(nook_core::DriveVaultFolderLookup { folders: &folders }.select()?)
    }

    pub(crate) async fn connect_vault_folder(
        &self,
    ) -> Result<DriveVaultFolderConnection, NookError> {
        let folder_name = nook_core::DriveVaultFolderLookup::root_name();
        if let nook_core::DriveVaultFolderSelection::Existing(folder_id) =
            self.find_vault_folder().await?
        {
            return Ok(DriveVaultFolderConnection {
                id: folder_id.into_inner(),
                name: folder_name.to_owned(),
                existed: true,
            });
        }
        let (id, name) = self.create_vault_folder(folder_name).await?;
        Ok(DriveVaultFolderConnection {
            id,
            name,
            existed: false,
        })
    }

    async fn list_vault_folders(
        &self,
    ) -> Result<Vec<nook_core::DriveVaultFolderObservation>, NookError> {
        let token = nook_core::OauthAccessToken::parse(self.as_str())?;
        let query =
            DriveStorageClient::vault_folder_query(nook_core::DriveVaultFolderLookup::root_name());
        let mut page_token: Option<String> = None;
        let mut folders = Vec::new();
        loop {
            let mut request = self
                .client
                .get("https://www.googleapis.com/drive/v3/files")
                .query(&[
                    ("q", query.as_str()),
                    ("fields", "nextPageToken,files(id,name,mimeType)"),
                    ("pageSize", "100"),
                    ("spaces", "drive"),
                ])
                .header("Authorization", format!("Bearer {}", token.as_ref()));
            if let Some(page) = page_token.as_deref() {
                request = request.query(&[("pageToken", page)]);
            }
            let response = request.send().await?;
            if !response.status().is_success() {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                return Err(DriveStorageClient::shared_drive_error(
                    DriveStorageClientSharedDriveError {
                        status,
                        body: &body,
                    },
                ));
            }
            let parsed: DriveVaultFolderListResponse = response.json().await.map_err(|error| {
                NookError::Serialization(format!("Failed to parse Drive folder list: {error}"))
            })?;
            folders.extend(parsed.files);
            page_token = parsed.next_page_token;
            if page_token.is_none() {
                return Ok(folders);
            }
        }
    }

    async fn create_vault_folder(&self, folder_name: &str) -> Result<(String, String), NookError> {
        let token = nook_core::OauthAccessToken::parse(self.as_str())?;
        let client = &self.client;
        let response = client
            .post("https://www.googleapis.com/drive/v3/files")
            .query(&[("fields", "id,name")])
            .header("Authorization", format!("Bearer {}", token.as_ref()))
            .header("Content-Type", "application/json")
            .json(&DriveFolderCreateRequest {
                name: folder_name,
                mime_type: nook_core::DRIVE_FOLDER_MIME_TYPE,
            })
            .send()
            .await?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(DriveStorageClient::shared_drive_error(
                DriveStorageClientSharedDriveError {
                    status,
                    body: &body,
                },
            ));
        }
        let parsed: DriveFileCreateResponse = response.json().await.map_err(|e| {
            NookError::Serialization(format!("Failed to parse Drive folder create: {e}"))
        })?;
        DriveStorageClient::create_folder_projection(DriveStorageClientCreateFolderProjection {
            parsed,
            fallback_name: folder_name,
        })
    }
}

/// Grant writer access on the vault folder to one more authorized account.
impl DriveStorageClient<'_> {
    pub(crate) async fn share_folder_with_email(
        &self,
        request: DriveStorageClientShareFolderWithEmail<'_>,
    ) -> Result<(), NookError> {
        let DriveStorageClientShareFolderWithEmail { folder_id, email } = request;
        let access_token = self.as_str();
        let token = nook_core::OauthAccessToken::parse(access_token)?;
        let folder_id = folder_id.trim();
        let email = email.trim();
        if folder_id.is_empty() {
            return Err(NookError::Drive(
                "Shared Drive folder id is required to grant access.".to_owned(),
            ));
        }
        if email.is_empty() {
            return Err(NookError::Drive(
                "Joiner email is required to grant shared Drive access.".to_owned(),
            ));
        }
        let client = &self.client;
        let url = format!(
            "https://www.googleapis.com/drive/v3/files/{}/permissions",
            urlencoding::encode(folder_id)
        );
        let response = client
            .post(&url)
            .query(&[
                ("sendNotificationEmail", "true"),
                ("supportsAllDrives", "true"),
            ])
            .header("Authorization", format!("Bearer {}", token.as_ref()))
            .header("Content-Type", "application/json")
            .json(&DriveFolderPermissionRequest {
                permission_type: "user",
                role: "writer",
                email_address: email,
            })
            .send()
            .await?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(DriveStorageClient::shared_drive_error(
                DriveStorageClientSharedDriveError {
                    status,
                    body: &body,
                },
            ));
        }
        Ok(())
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DrivePermissionListResponse {
    #[serde(default)]
    permissions: Vec<nook_core::DrivePermissionObservation>,
    #[serde(default)]
    next_page_token: Option<String>,
}

/// Read and revoke the vault folder's Drive permissions: its authorized
/// accounts. Requires `drive.file` on a folder this app created.
impl DriveStorageClient<'_> {
    pub(crate) async fn list_folder_permissions(
        &self,
        folder_id: &str,
    ) -> Result<Vec<nook_core::DrivePermissionObservation>, NookError> {
        let token = nook_core::OauthAccessToken::parse(self.as_str())?;
        let folder_id = nook_core::GoogleDriveFolderId::parse(folder_id)?;
        let url = format!(
            "https://www.googleapis.com/drive/v3/files/{}/permissions",
            urlencoding::encode(folder_id.as_str())
        );
        let mut page_token: Option<String> = None;
        let mut permissions = Vec::new();
        loop {
            let mut request = self
                .client
                .get(&url)
                .query(&[
                    (
                        "fields",
                        "nextPageToken,permissions(id,type,role,emailAddress,deleted)",
                    ),
                    ("pageSize", "100"),
                    ("supportsAllDrives", "true"),
                ])
                .header("Authorization", format!("Bearer {}", token.as_ref()));
            if let Some(page) = page_token.as_deref() {
                request = request.query(&[("pageToken", page)]);
            }
            let response = request.send().await?;
            if !response.status().is_success() {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                return Err(DriveStorageClient::shared_drive_error(
                    DriveStorageClientSharedDriveError {
                        status,
                        body: &body,
                    },
                ));
            }
            let parsed: DrivePermissionListResponse = response.json().await.map_err(|error| {
                NookError::Serialization(format!("Failed to parse Drive permissions: {error}"))
            })?;
            permissions.extend(parsed.permissions);
            page_token = parsed.next_page_token;
            if page_token.is_none() {
                break;
            }
        }
        Ok(permissions)
    }

    pub(crate) async fn delete_folder_permission(
        &self,
        folder_id: &str,
        permission_id: &str,
    ) -> Result<(), NookError> {
        let token = nook_core::OauthAccessToken::parse(self.as_str())?;
        let folder_id = nook_core::GoogleDriveFolderId::parse(folder_id)?;
        let permission_id = permission_id.trim();
        if permission_id.is_empty() {
            return Err(NookError::Drive(
                "Drive permission id is required to revoke access.".to_owned(),
            ));
        }
        let url = format!(
            "https://www.googleapis.com/drive/v3/files/{}/permissions/{}",
            urlencoding::encode(folder_id.as_str()),
            urlencoding::encode(permission_id)
        );
        let response = self
            .client
            .delete(&url)
            .query(&[("supportsAllDrives", "true")])
            .header("Authorization", format!("Bearer {}", token.as_ref()))
            .send()
            .await?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(DriveStorageClient::shared_drive_error(
                DriveStorageClientSharedDriveError {
                    status,
                    body: &body,
                },
            ));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    fn drive_errors_preserve_status_and_optional_body() {
        assert!(matches!(
            DriveStorageClient::shared_drive_error(DriveStorageClientSharedDriveError { status: reqwest::StatusCode::BAD_REQUEST, body: "bad query" }),
            NookError::Drive(message)
                if message == "Google Drive API responded with status 400 Bad Request — bad query"
        ));
        assert!(matches!(
            DriveStorageClient::shared_drive_error(DriveStorageClientSharedDriveError { status: reqwest::StatusCode::SERVICE_UNAVAILABLE, body: "" }),
            NookError::Drive(message)
                if message == "Google Drive API responded with status 503 Service Unavailable"
        ));
    }

    #[wasm_bindgen_test]
    fn shared_drive_response_shapes_accept_optional_fields() -> anyhow::Result<()> {
        let created: DriveFileCreateResponse =
            serde_json::from_str(r#"{"id":"folder-1","name":"Shared"}"#)?;
        assert_eq!(created.id, FileIdentity::Reported("folder-1".to_owned()));
        assert_eq!(created.name, FileName::Reported("Shared".to_owned()));

        Ok(())
    }

    #[wasm_bindgen_test]
    fn vault_folder_lookup_scopes_to_owned_root_folders_and_escapes_the_name() {
        assert_eq!(
            DriveStorageClient::vault_folder_query("Bob's \\ vault"),
            "name = 'Bob\\'s \\\\ vault' and mimeType = 'application/vnd.google-apps.folder' and 'root' in parents and 'me' in owners and trashed = false"
        );
    }

    #[wasm_bindgen_test]
    fn vault_folder_list_response_accepts_missing_fields() -> anyhow::Result<()> {
        let listed: DriveVaultFolderListResponse = serde_json::from_str(
            r#"{"files":[{"id":"folder-1","name":"nook-events","mimeType":"application/vnd.google-apps.folder"}],"nextPageToken":"next"}"#,
        )?;
        assert_eq!(listed.files.len(), 1);
        assert_eq!(listed.next_page_token.as_deref(), Some("next"));
        let empty: DriveVaultFolderListResponse = serde_json::from_str("{}")?;
        assert!(empty.files.is_empty() && empty.next_page_token.is_none());
        Ok(())
    }

    #[wasm_bindgen_test]
    fn create_folder_projection_requires_id_and_falls_back_to_name() -> anyhow::Result<()> {
        let Err(missing_id) = DriveStorageClient::create_folder_projection(
            DriveStorageClientCreateFolderProjection {
                parsed: DriveFileCreateResponse {
                    id: FileIdentity::Reported("  ".to_owned()),
                    name: FileName::Reported("Shared".to_owned()),
                },
                fallback_name: "Fallback",
            },
        ) else {
            anyhow::bail!("a folder response without an id must be rejected");
        };
        assert!(matches!(missing_id, NookError::Drive(message) if message.contains("missing id")));

        let projected = DriveStorageClient::create_folder_projection(
            DriveStorageClientCreateFolderProjection {
                parsed: DriveFileCreateResponse {
                    id: FileIdentity::Reported("folder-1".to_owned()),
                    name: FileName::Reported("  ".to_owned()),
                },
                fallback_name: "Fallback",
            },
        )?;
        assert_eq!(projected, ("folder-1".to_owned(), "Fallback".to_owned()));
        Ok(())
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use super::*;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    async fn shared_drive_input_guards_fail_before_network_access() -> anyhow::Result<()> {
        assert!(
            DriveStorageClient::new("")
                .connect_vault_folder()
                .await
                .is_err()
        );
        assert!(
            DriveStorageClient::new("ya29.test")
                .share_folder_with_email(DriveStorageClientShareFolderWithEmail {
                    folder_id: "",
                    email: "joiner@example.test"
                })
                .await
                .is_err()
        );
        assert!(
            DriveStorageClient::new("ya29.test")
                .share_folder_with_email(DriveStorageClientShareFolderWithEmail {
                    folder_id: "folder-1",
                    email: ""
                })
                .await
                .is_err()
        );
        Ok(())
    }
}
/// Named values required by `DriveStorageClient::shared_drive_error`.
#[derive(Clone, Copy)]
pub(crate) struct DriveStorageClientSharedDriveError<'a> {
    pub(crate) status: reqwest::StatusCode,
    pub(crate) body: &'a str,
}
/// Named values required by `DriveStorageClient::create_folder_projection`.
pub(crate) struct DriveStorageClientCreateFolderProjection<'a> {
    parsed: DriveFileCreateResponse,
    pub(crate) fallback_name: &'a str,
}

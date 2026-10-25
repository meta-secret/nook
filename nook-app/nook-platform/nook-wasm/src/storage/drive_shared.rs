//! Google Drive vault folder helpers (`drive.file` writes plus
//! `drive.readonly` for cross-account event reads).
//!
//! Every Drive provider syncs under one My Drive folder. Its Drive
//! permissions are the provider's authorized accounts: sharing the folder
//! with an account lets a device signed in as that account join the vault.

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
    fn shared_folder_name(name: &str) -> &str {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            "Nook shared vault"
        } else {
            trimmed
        }
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

/// Create a My Drive folder for a shared vault. Requires `drive.file` scope.
impl DriveStorageClient<'_> {
    pub(crate) async fn create_shared_vault_folder(
        &self,
        name: &str,
    ) -> Result<(String, String), NookError> {
        let access_token = self.as_str();
        let token = nook_core::OauthAccessToken::parse(access_token)?;
        let folder_name = DriveStorageClient::shared_folder_name(name);
        let client = &self.client;
        let response = client
            .post("https://www.googleapis.com/drive/v3/files")
            .query(&[("fields", "id,name")])
            .header("Authorization", format!("Bearer {}", token.as_ref()))
            .header("Content-Type", "application/json")
            .json(&DriveFolderCreateRequest {
                name: folder_name,
                mime_type: "application/vnd.google-apps.folder",
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
    fn shared_folder_name_trims_and_defaults() {
        assert_eq!(
            DriveStorageClient::shared_folder_name("  Family vault  "),
            "Family vault"
        );
        assert_eq!(
            DriveStorageClient::shared_folder_name("\t"),
            "Nook shared vault"
        );
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
                .create_shared_vault_folder("Shared")
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

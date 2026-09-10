//! Shared Google Drive vault folder helpers (`drive.file` writes plus
//! `drive.readonly` for cross-account event reads).
//!
//! Private providers keep using `drive.appdata`. Shared providers create a
//! dedicated My Drive folder, share it with another account, and sync event
//! files under that parent.

use crate::DriveStorageClient;
use nook_core::i18n_keys;

use super::drive::wire::{
    AppendPermission, CapabilityReport, FileIdentity, FileName,
    FolderCapabilities as DriveFolderCapabilities, MediaType,
};
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DriveFolderMetadataResponse {
    #[serde(default)]
    id: FileIdentity,
    #[serde(default)]
    name: FileName,
    #[serde(default)]
    mime_type: MediaType,
    #[serde(default)]
    capabilities: CapabilityReport,
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

impl DriveStorageClient<'_> {
    fn verify_folder_projection(
        request: DriveStorageClientVerifyFolderProjection,
    ) -> Result<(String, String), NookError> {
        let DriveStorageClientVerifyFolderProjection {
            parsed,
            fallback_id,
        } = request;
        if !matches!(&parsed.mime_type, MediaType::Declared(value) if value == "application/vnd.google-apps.folder")
        {
            return Err(NookError::Drive(
                i18n_keys::PROVIDER_SETUP_GOOGLE_SHARED_NOT_FOLDER.to_owned(),
            ));
        }
        if !matches!(
            parsed.capabilities,
            CapabilityReport::Reported(DriveFolderCapabilities {
                can_add_children: AppendPermission::Reported(true)
            })
        ) {
            return Err(NookError::Drive(
                i18n_keys::PROVIDER_SETUP_GOOGLE_SHARED_NOT_WRITABLE.to_owned(),
            ));
        }
        Ok((
            match parsed.id {
                FileIdentity::Reported(id) if !id.trim().is_empty() => id,
                _ => fallback_id,
            },
            match parsed.name {
                FileName::Reported(name) if !name.trim().is_empty() => name,
                _ => "Nook shared vault".to_owned(),
            },
        ))
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

/// Grant writer access on a shared vault folder to the joiner email.
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

/// Verify that the signed-in account can append events to an existing shared
/// Drive folder. The input may be a raw id or a standard Drive folder URL.
impl DriveStorageClient<'_> {
    pub(crate) async fn verify_shared_vault_folder(
        &self,
        folder_ref: &str,
    ) -> Result<(String, String), NookError> {
        let access_token = self.as_str();
        let token = nook_core::OauthAccessToken::parse(access_token)?;
        let folder_id = nook_core::GoogleDriveFolderId::parse(folder_ref)?;
        let client = &self.client;
        let url = format!(
            "https://www.googleapis.com/drive/v3/files/{}",
            urlencoding::encode(folder_id.as_str())
        );
        let response = client
            .get(&url)
            .query(&[
                ("fields", "id,name,mimeType,capabilities(canAddChildren)"),
                ("supportsAllDrives", "true"),
            ])
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
        let parsed: DriveFolderMetadataResponse = response.json().await.map_err(|error| {
            NookError::Serialization(format!("Failed to parse Drive folder metadata: {error}"))
        })?;
        DriveStorageClient::verify_folder_projection(DriveStorageClientVerifyFolderProjection {
            parsed,
            fallback_id: folder_id.into_inner(),
        })
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

        let metadata: DriveFolderMetadataResponse = serde_json::from_str(
            r#"{"id":"folder-1","name":"Shared","mimeType":"application/vnd.google-apps.folder","capabilities":{"canAddChildren":true}}"#,
        )?;
        assert_eq!(metadata.id, FileIdentity::Reported("folder-1".to_owned()));
        assert_eq!(metadata.name, FileName::Reported("Shared".to_owned()));
        assert_eq!(
            metadata.mime_type,
            MediaType::Declared("application/vnd.google-apps.folder".to_owned())
        );
        assert!(matches!(
            metadata.capabilities,
            CapabilityReport::Reported(DriveFolderCapabilities {
                can_add_children: AppendPermission::Reported(true)
            })
        ));

        let missing: DriveFolderMetadataResponse = serde_json::from_str("{}")?;
        assert!(matches!(missing.id, FileIdentity::Unreported));
        assert!(matches!(missing.capabilities, CapabilityReport::Unreported));
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
        let missing_id = DriveStorageClient::create_folder_projection(
            DriveStorageClientCreateFolderProjection {
                parsed: DriveFileCreateResponse {
                    id: FileIdentity::Reported("  ".to_owned()),
                    name: FileName::Reported("Shared".to_owned()),
                },
                fallback_name: "Fallback",
            },
        )
        .expect_err("a folder response without an id must be rejected");
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

    #[wasm_bindgen_test]
    fn verify_folder_projection_enforces_folder_and_write_capability() -> anyhow::Result<()> {
        let not_folder = DriveStorageClient::verify_folder_projection(
            DriveStorageClientVerifyFolderProjection {
                parsed: DriveFolderMetadataResponse {
                    id: FileIdentity::Reported("folder-1".to_owned()),
                    name: FileName::Reported("Shared".to_owned()),
                    mime_type: MediaType::Declared("text/plain".to_owned()),
                    capabilities: CapabilityReport::Reported(DriveFolderCapabilities {
                        can_add_children: AppendPermission::Reported(true),
                    }),
                },
                fallback_id: "fallback".to_owned(),
            },
        )
        .expect_err("non-folder metadata must be rejected");
        assert!(
            matches!(not_folder, NookError::Drive(message) if message == i18n_keys::PROVIDER_SETUP_GOOGLE_SHARED_NOT_FOLDER)
        );

        let not_writable = DriveStorageClient::verify_folder_projection(
            DriveStorageClientVerifyFolderProjection {
                parsed: DriveFolderMetadataResponse {
                    id: FileIdentity::Reported("folder-1".to_owned()),
                    name: FileName::Reported("Shared".to_owned()),
                    mime_type: MediaType::Declared("application/vnd.google-apps.folder".to_owned()),
                    capabilities: CapabilityReport::Reported(DriveFolderCapabilities {
                        can_add_children: AppendPermission::Reported(false),
                    }),
                },
                fallback_id: "fallback".to_owned(),
            },
        )
        .expect_err("non-writable folders must be rejected");
        assert!(
            matches!(not_writable, NookError::Drive(message) if message == i18n_keys::PROVIDER_SETUP_GOOGLE_SHARED_NOT_WRITABLE)
        );

        let projected = DriveStorageClient::verify_folder_projection(
            DriveStorageClientVerifyFolderProjection {
                parsed: DriveFolderMetadataResponse {
                    id: FileIdentity::Unreported,
                    name: FileName::Unreported,
                    mime_type: MediaType::Declared("application/vnd.google-apps.folder".to_owned()),
                    capabilities: CapabilityReport::Reported(DriveFolderCapabilities {
                        can_add_children: AppendPermission::Reported(true),
                    }),
                },
                fallback_id: "fallback".to_owned(),
            },
        )?;
        assert_eq!(
            projected,
            ("fallback".to_owned(), "Nook shared vault".to_owned())
        );
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
        assert!(
            DriveStorageClient::new("ya29.test")
                .verify_shared_vault_folder("")
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

/// Named values required by `DriveStorageClient::verify_folder_projection`.
pub(crate) struct DriveStorageClientVerifyFolderProjection {
    parsed: DriveFolderMetadataResponse,
    pub(crate) fallback_id: String,
}

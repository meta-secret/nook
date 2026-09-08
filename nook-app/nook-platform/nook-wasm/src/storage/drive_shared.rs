//! Shared Google Drive vault folder helpers (`drive.file` writes plus
//! `drive.readonly` for cross-account event reads).
//!
//! Private providers keep using `drive.appdata`. Shared providers create a
//! dedicated My Drive folder, share it with another account, and sync event
//! files under that parent.

use nook_core::i18n_keys;
use reqwest::Client;

use crate::NookError;
use serde::Deserialize;

#[derive(Deserialize)]
struct DriveFileCreateResponse {
    id: Option<String>,
    name: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DriveFolderCapabilities {
    can_add_children: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DriveFolderMetadataResponse {
    id: Option<String>,
    name: Option<String>,
    mime_type: Option<String>,
    capabilities: Option<DriveFolderCapabilities>,
}

fn drive_error(status: reqwest::StatusCode, body: &str) -> NookError {
    NookError::Drive(format!(
        "Google Drive API responded with status {status}{}",
        if body.is_empty() {
            String::new()
        } else {
            format!(" — {body}")
        }
    ))
}

fn shared_folder_name(name: &str) -> &str {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        "Nook shared vault"
    } else {
        trimmed
    }
}

fn create_folder_projection(
    parsed: DriveFileCreateResponse,
    fallback_name: &str,
) -> Result<(String, String), NookError> {
    let folder_id = parsed
        .id
        .filter(|id| !id.trim().is_empty())
        .ok_or_else(|| NookError::Drive("Drive folder create response missing id.".to_owned()))?;
    let folder_name = parsed
        .name
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| fallback_name.to_owned());
    Ok((folder_id, folder_name))
}

fn verify_folder_projection(
    parsed: DriveFolderMetadataResponse,
    fallback_id: String,
) -> Result<(String, String), NookError> {
    if parsed.mime_type.as_deref() != Some("application/vnd.google-apps.folder") {
        return Err(NookError::Drive(
            i18n_keys::PROVIDER_SETUP_GOOGLE_SHARED_NOT_FOLDER.to_owned(),
        ));
    }
    if parsed
        .capabilities
        .and_then(|capabilities| capabilities.can_add_children)
        != Some(true)
    {
        return Err(NookError::Drive(
            i18n_keys::PROVIDER_SETUP_GOOGLE_SHARED_NOT_WRITABLE.to_owned(),
        ));
    }
    Ok((
        parsed
            .id
            .filter(|id| !id.trim().is_empty())
            .unwrap_or(fallback_id),
        parsed
            .name
            .filter(|name| !name.trim().is_empty())
            .unwrap_or_else(|| "Nook shared vault".to_owned()),
    ))
}

/// Create a My Drive folder for a shared vault. Requires `drive.file` scope.
pub(crate) async fn create_shared_vault_folder(
    access_token: &str,
    name: &str,
) -> Result<(String, String), NookError> {
    let token = nook_core::OauthAccessToken::parse(access_token)?;
    let folder_name = shared_folder_name(name);
    let client = Client::new();
    let response = client
        .post("https://www.googleapis.com/drive/v3/files")
        .query(&[("fields", "id,name")])
        .header("Authorization", format!("Bearer {}", token.as_ref()))
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "name": folder_name,
            "mimeType": "application/vnd.google-apps.folder",
        }))
        .send()
        .await?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(drive_error(status, &body));
    }
    let parsed: DriveFileCreateResponse = response.json().await.map_err(|e| {
        NookError::Serialization(format!("Failed to parse Drive folder create: {e}"))
    })?;
    create_folder_projection(parsed, folder_name)
}

/// Grant writer access on a shared vault folder to the joiner email.
pub(crate) async fn share_folder_with_email(
    access_token: &str,
    folder_id: &str,
    email: &str,
) -> Result<(), NookError> {
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
    let client = Client::new();
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
        .json(&serde_json::json!({
            "type": "user",
            "role": "writer",
            "emailAddress": email,
        }))
        .send()
        .await?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(drive_error(status, &body));
    }
    Ok(())
}

/// Verify that the signed-in account can append events to an existing shared
/// Drive folder. The input may be a raw id or a standard Drive folder URL.
pub(crate) async fn verify_shared_vault_folder(
    access_token: &str,
    folder_ref: &str,
) -> Result<(String, String), NookError> {
    let token = nook_core::OauthAccessToken::parse(access_token)?;
    let folder_id = nook_core::GoogleDriveFolderId::parse(folder_ref)?;
    let client = Client::new();
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
        return Err(drive_error(status, &body));
    }
    let parsed: DriveFolderMetadataResponse = response.json().await.map_err(|error| {
        NookError::Serialization(format!("Failed to parse Drive folder metadata: {error}"))
    })?;
    verify_folder_projection(parsed, folder_id.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    fn drive_errors_preserve_status_and_optional_body() {
        assert!(matches!(
            drive_error(reqwest::StatusCode::BAD_REQUEST, "bad query"),
            NookError::Drive(message)
                if message == "Google Drive API responded with status 400 Bad Request — bad query"
        ));
        assert!(matches!(
            drive_error(reqwest::StatusCode::SERVICE_UNAVAILABLE, ""),
            NookError::Drive(message)
                if message == "Google Drive API responded with status 503 Service Unavailable"
        ));
    }

    #[wasm_bindgen_test]
    fn shared_drive_response_shapes_accept_optional_fields() -> anyhow::Result<()> {
        let created: DriveFileCreateResponse =
            serde_json::from_str(r#"{"id":"folder-1","name":"Shared"}"#)?;
        assert_eq!(created.id.as_deref(), Some("folder-1"));
        assert_eq!(created.name.as_deref(), Some("Shared"));

        let metadata: DriveFolderMetadataResponse = serde_json::from_str(
            r#"{"id":"folder-1","name":"Shared","mimeType":"application/vnd.google-apps.folder","capabilities":{"canAddChildren":true}}"#,
        )?;
        assert_eq!(metadata.id.as_deref(), Some("folder-1"));
        assert_eq!(metadata.name.as_deref(), Some("Shared"));
        assert_eq!(
            metadata.mime_type.as_deref(),
            Some("application/vnd.google-apps.folder")
        );
        assert_eq!(
            metadata
                .capabilities
                .and_then(|capabilities| capabilities.can_add_children),
            Some(true)
        );

        let missing: DriveFolderMetadataResponse = serde_json::from_str("{}")?;
        assert!(missing.id.is_none());
        assert!(missing.capabilities.is_none());
        Ok(())
    }

    #[wasm_bindgen_test]
    fn shared_folder_name_trims_and_defaults() {
        assert_eq!(shared_folder_name("  Family vault  "), "Family vault");
        assert_eq!(shared_folder_name("\t"), "Nook shared vault");
    }

    #[wasm_bindgen_test]
    fn create_folder_projection_requires_id_and_falls_back_to_name() -> anyhow::Result<()> {
        let missing_id = create_folder_projection(
            DriveFileCreateResponse {
                id: Some("  ".to_owned()),
                name: Some("Shared".to_owned()),
            },
            "Fallback",
        )
        .expect_err("a folder response without an id must be rejected");
        assert!(matches!(missing_id, NookError::Drive(message) if message.contains("missing id")));

        let projected = create_folder_projection(
            DriveFileCreateResponse {
                id: Some("folder-1".to_owned()),
                name: Some("  ".to_owned()),
            },
            "Fallback",
        )?;
        assert_eq!(projected, ("folder-1".to_owned(), "Fallback".to_owned()));
        Ok(())
    }

    #[wasm_bindgen_test]
    fn verify_folder_projection_enforces_folder_and_write_capability() -> anyhow::Result<()> {
        let not_folder = verify_folder_projection(
            DriveFolderMetadataResponse {
                id: Some("folder-1".to_owned()),
                name: Some("Shared".to_owned()),
                mime_type: Some("text/plain".to_owned()),
                capabilities: Some(DriveFolderCapabilities {
                    can_add_children: Some(true),
                }),
            },
            "fallback".to_owned(),
        )
        .expect_err("non-folder metadata must be rejected");
        assert!(
            matches!(not_folder, NookError::Drive(message) if message == i18n_keys::PROVIDER_SETUP_GOOGLE_SHARED_NOT_FOLDER)
        );

        let not_writable = verify_folder_projection(
            DriveFolderMetadataResponse {
                id: Some("folder-1".to_owned()),
                name: Some("Shared".to_owned()),
                mime_type: Some("application/vnd.google-apps.folder".to_owned()),
                capabilities: Some(DriveFolderCapabilities {
                    can_add_children: Some(false),
                }),
            },
            "fallback".to_owned(),
        )
        .expect_err("non-writable folders must be rejected");
        assert!(
            matches!(not_writable, NookError::Drive(message) if message == i18n_keys::PROVIDER_SETUP_GOOGLE_SHARED_NOT_WRITABLE)
        );

        let projected = verify_folder_projection(
            DriveFolderMetadataResponse {
                id: None,
                name: None,
                mime_type: Some("application/vnd.google-apps.folder".to_owned()),
                capabilities: Some(DriveFolderCapabilities {
                    can_add_children: Some(true),
                }),
            },
            "fallback".to_owned(),
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
        assert!(create_shared_vault_folder("", "Shared").await.is_err());
        assert!(
            share_folder_with_email("ya29.test", "", "joiner@example.test")
                .await
                .is_err()
        );
        assert!(
            share_folder_with_email("ya29.test", "folder-1", "")
                .await
                .is_err()
        );
        assert!(verify_shared_vault_folder("ya29.test", "").await.is_err());
        Ok(())
    }
}

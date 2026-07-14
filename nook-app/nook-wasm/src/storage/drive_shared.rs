//! Shared Google Drive vault folder helpers (`drive.file` writes plus
//! `drive.readonly` for cross-account event reads).
//!
//! Private providers keep using `drive.appdata`. Shared providers create a
//! dedicated My Drive folder, share it with another account, and sync event
//! files under that parent.

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

/// Create a My Drive folder for a shared vault. Requires `drive.file` scope.
pub(crate) async fn create_shared_vault_folder(
    access_token: &str,
    name: &str,
) -> Result<(String, String), NookError> {
    let token = nook_core::validate_oauth_access_token(access_token)?;
    let folder_name = {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            "Nook shared vault"
        } else {
            trimmed
        }
    };
    let client = reqwest::Client::new();
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
    let folder_id = parsed
        .id
        .filter(|id| !id.trim().is_empty())
        .ok_or_else(|| NookError::Drive("Drive folder create response missing id.".to_owned()))?;
    let folder_name = parsed
        .name
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| folder_name.to_owned());
    Ok((folder_id, folder_name))
}

/// Grant writer access on a shared vault folder to the joiner email.
pub(crate) async fn share_folder_with_email(
    access_token: &str,
    folder_id: &str,
    email: &str,
) -> Result<(), NookError> {
    let token = nook_core::validate_oauth_access_token(access_token)?;
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
    let client = reqwest::Client::new();
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
    let token = nook_core::validate_oauth_access_token(access_token)?;
    let folder_id = nook_core::normalize_google_drive_folder_ref(folder_ref)?;
    let client = reqwest::Client::new();
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
    if parsed.mime_type.as_deref() != Some("application/vnd.google-apps.folder") {
        return Err(NookError::Drive(
            "provider_setup.google_shared_not_folder".to_owned(),
        ));
    }
    if parsed
        .capabilities
        .and_then(|capabilities| capabilities.can_add_children)
        != Some(true)
    {
        return Err(NookError::Drive(
            "provider_setup.google_shared_not_writable".to_owned(),
        ));
    }
    Ok((
        parsed
            .id
            .filter(|id| !id.trim().is_empty())
            .unwrap_or_else(|| folder_id.into_inner()),
        parsed
            .name
            .filter(|name| !name.trim().is_empty())
            .unwrap_or_else(|| "Nook shared vault".to_owned()),
    ))
}

//! Shared Google Drive vault folder helpers (`drive.file` scope).
//!
//! Personal vaults keep using `drive.appdata`. Shared replication creates a
//! dedicated My Drive folder, shares it with the joiner email, and syncs event
//! files under that parent.

use crate::NookError;
use serde::Deserialize;

#[derive(Deserialize)]
struct DriveFileCreateResponse {
    id: Option<String>,
    name: Option<String>,
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
            ("sendNotificationEmail", "false"),
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

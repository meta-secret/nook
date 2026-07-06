//! Google Drive account verification for event-log sync.

use crate::NookError;
use serde::Deserialize;

#[derive(Deserialize)]
#[allow(dead_code)]
struct DriveAboutUser {
    #[serde(rename = "emailAddress")]
    email_address: Option<String>,
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct DriveAboutResponse {
    user: Option<DriveAboutUser>,
}

fn drive_headers(access_token: &str) -> [(&'static str, String); 2] {
    [
        ("Authorization", format!("Bearer {}", access_token.trim())),
        ("User-Agent", "nook-wasm".to_owned()),
    ]
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

pub(crate) async fn verify_drive_access(access_token: &str) -> Result<(), NookError> {
    let token = nook_core::validate_oauth_access_token(access_token)?;
    let client = reqwest::Client::new();
    let mut request = client
        .get("https://www.googleapis.com/drive/v3/about")
        .query(&[("fields", "user")]);
    for (name, value) in drive_headers(token.as_ref()) {
        request = request.header(name, value);
    }
    let response = request.send().await?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err(NookError::Drive(
            "Google Drive rejected the access token (401). Sign in again.".to_owned(),
        ));
    }
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(drive_error(status, &body));
    }
    let _parsed: DriveAboutResponse = response
        .json()
        .await
        .map_err(|e| NookError::Serialization(format!("Failed to parse Drive about: {e}")))?;
    Ok(())
}

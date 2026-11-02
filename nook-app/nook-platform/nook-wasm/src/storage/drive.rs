//! Google Drive account verification for event-log sync.
pub(crate) mod wire;

use nook_core::ProviderSecretText;
use reqwest::header::USER_AGENT;
use reqwest::{Client, StatusCode};

use crate::NookError;
pub(crate) struct DriveStorageClient<'a> {
    pub(super) client: Client,
    credential: &'a ProviderSecretText,
}
impl<'a> DriveStorageClient<'a> {
    pub(crate) fn new(credential: &'a ProviderSecretText) -> Self {
        Self {
            client: Client::new(),
            credential,
        }
    }
    /// The token every Drive request carries as its bearer credential.
    pub(super) fn as_str(&self) -> &'a str {
        self.credential.expose()
    }

    /// A raw token from the page, checked once: a blank one fails with
    /// `OauthAccessTokenEmpty`, as before.
    pub(crate) fn access_token(raw: &str) -> Result<ProviderSecretText, NookError> {
        let token = nook_core::OauthAccessToken::parse(raw)?;
        Ok(ProviderSecretText::try_from(token.as_ref().to_owned())?)
    }
}

use serde::Deserialize;

#[derive(Deserialize)]
#[allow(dead_code)]
struct DriveAboutUser {
    #[serde(rename = "emailAddress")]
    #[serde(default)]
    email_address: DriveEmailDisclosure,
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct DriveAboutResponse {
    #[serde(default)]
    user: DriveAccountObservation,
}

impl DriveStorageClient<'_> {
    fn drive_error(request: DriveStorageClientDriveError<'_>) -> NookError {
        let DriveStorageClientDriveError { status, body } = request;
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
    pub(crate) async fn verify_drive_access(&self) -> Result<(), NookError> {
        let response = self
            .client
            .get("https://www.googleapis.com/drive/v3/about")
            .query(&[("fields", "user")])
            .bearer_auth(self.as_str())
            .header(USER_AGENT, "nook-wasm")
            .send()
            .await?;
        if response.status() == StatusCode::UNAUTHORIZED {
            return Err(NookError::Drive(
                "Google Drive rejected the access token (401). Sign in again.".to_owned(),
            ));
        }
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(DriveStorageClient::drive_error(
                DriveStorageClientDriveError {
                    status,
                    body: &body,
                },
            ));
        }
        let _parsed: DriveAboutResponse = response
            .json()
            .await
            .map_err(|e| NookError::Serialization(format!("Failed to parse Drive about: {e}")))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    fn errors_preserve_status_and_optional_body_without_leaking_empty_delimiters() {
        assert!(matches!(
            DriveStorageClient::drive_error(DriveStorageClientDriveError { status: StatusCode::BAD_REQUEST, body: "bad query" }),
            NookError::Drive(message)
                if message == "Google Drive API responded with status 400 Bad Request — bad query"
        ));
        assert!(matches!(
            DriveStorageClient::drive_error(DriveStorageClientDriveError { status: StatusCode::SERVICE_UNAVAILABLE, body: "" }),
            NookError::Drive(message)
                if message == "Google Drive API responded with status 503 Service Unavailable"
        ));
    }

    #[wasm_bindgen_test]
    fn about_response_accepts_optional_user_payloads() -> anyhow::Result<()> {
        let with_user: DriveAboutResponse =
            serde_json::from_str(r#"{"user":{"emailAddress":"person@example.test"}}"#)?;
        assert!(
            matches!(with_user.user, DriveAccountObservation::Account(DriveAboutUser { email_address: DriveEmailDisclosure::Address(email) }) if email == "person@example.test")
        );
        let without_user: DriveAboutResponse = serde_json::from_str("{}")?;
        assert!(matches!(
            without_user.user,
            DriveAccountObservation::Unreported
        ));
        Ok(())
    }
}
/// Named values required by `DriveStorageClient::drive_error`.
#[derive(Clone, Copy)]
pub(crate) struct DriveStorageClientDriveError<'a> {
    pub(crate) status: reqwest::StatusCode,
    pub(crate) body: &'a str,
}
#[derive(Default, Deserialize)]
#[serde(untagged)]
#[allow(dead_code)]
enum DriveEmailDisclosure {
    Address(String),
    #[default]
    Undisclosed,
}
#[derive(Default, Deserialize)]
#[serde(untagged)]
#[allow(dead_code)]
enum DriveAccountObservation {
    Account(DriveAboutUser),
    #[default]
    Unreported,
}

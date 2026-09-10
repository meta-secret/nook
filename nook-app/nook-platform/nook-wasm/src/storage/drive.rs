//! Google Drive account verification for event-log sync.
pub(crate) mod wire;

use reqwest::{Client, StatusCode};

use crate::NookError;
pub(crate) struct DriveStorageClient<'a> {
    pub(super) client: Client,
    credential: &'a str,
}
impl<'a> DriveStorageClient<'a> {
    pub(crate) fn new(credential: &'a str) -> Self {
        Self {
            client: Client::new(),
            credential,
        }
    }
    pub(super) fn as_str(&self) -> &'a str {
        self.credential
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
    fn drive_headers(&self) -> [(&'static str, String); 2] {
        let access_token = self.as_str();
        [
            ("Authorization", format!("Bearer {}", access_token.trim())),
            ("User-Agent", "nook-wasm".to_owned()),
        ]
    }
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
        let access_token = self.as_str();
        let token = nook_core::OauthAccessToken::parse(access_token)?;
        let client = &self.client;
        let mut request = client
            .get("https://www.googleapis.com/drive/v3/about")
            .query(&[("fields", "user")]);
        for (name, value) in DriveStorageClient::new(token.as_ref()).drive_headers() {
            request = request.header(name, value);
        }
        let response = request.send().await?;
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
    fn headers_trim_access_tokens_and_keep_the_product_user_agent() {
        assert_eq!(
            DriveStorageClient::new("  token-123  ").drive_headers(),
            [
                ("Authorization", "Bearer token-123".to_owned()),
                ("User-Agent", "nook-wasm".to_owned()),
            ]
        );
    }

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
        let without_user: DriveAboutResponse = serde_json::from_str(r#"{}"#)?;
        assert!(matches!(
            without_user.user,
            DriveAccountObservation::Unreported
        ));
        Ok(())
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
    )]
    async fn access_verification_rejects_empty_token_before_network() {
        let error = DriveStorageClient::new("  ")
            .verify_drive_access()
            .await
            .expect_err("empty OAuth access token must fail closed");
        assert!(matches!(
            error,
            NookError::Database(message)
                if message == nook_core::ValidationError::OauthAccessTokenEmpty.to_string()
        ));
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

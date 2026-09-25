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

use serde::{Deserialize, Serialize};

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

const DRIVE_FOLDER_MIME_TYPE: &str = "application/vnd.google-apps.folder";
const PRIVATE_EVENT_FOLDER_PREFIX: &str = "nook-events-v2-";

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DrivePrivateFolderListResponse {
    #[serde(default)]
    files: Vec<DrivePrivateFolderResource>,
    #[serde(default)]
    next_page_token: Option<String>,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DrivePrivateFolderResource {
    #[serde(default)]
    id: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    mime_type: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DrivePrivateFolderMetadata<'a> {
    name: &'a str,
    mime_type: &'static str,
    parents: [&'static str; 1],
}

fn private_event_folder_name(file_name: &nook_core::DriveBackupName) -> String {
    format!("{PRIVATE_EVENT_FOLDER_PREFIX}{}", file_name.as_str())
}

fn private_event_folder_query(name: &str) -> String {
    let escaped_name = name.replace('\\', "\\\\").replace('\'', "\\'");
    format!(
        "name = '{escaped_name}' and mimeType = '{DRIVE_FOLDER_MIME_TYPE}' and 'appDataFolder' in parents and trashed = false"
    )
}

fn private_event_folder_metadata(name: &str) -> DrivePrivateFolderMetadata<'_> {
    DrivePrivateFolderMetadata {
        name,
        mime_type: DRIVE_FOLDER_MIME_TYPE,
        parents: ["appDataFolder"],
    }
}

fn select_private_event_folder(
    folders: &[DrivePrivateFolderResource],
) -> Result<Option<String>, NookError> {
    if folders.len() > 1 {
        return Err(NookError::Drive(
            "Google Drive contains ambiguous private target folders; choose a unique target name before syncing.".to_owned(),
        ));
    }
    let Some(folder) = folders.first() else {
        return Ok(None);
    };
    if folder.id.trim().is_empty() {
        return Err(NookError::Drive(
            "Google Drive private target folder is missing its ID.".to_owned(),
        ));
    }
    Ok(Some(validate_private_event_folder_id(&folder.id)?))
}

fn validate_private_event_folder_id(folder_id: &str) -> Result<String, NookError> {
    nook_core::GoogleDriveFolderId::parse(folder_id)
        .map(nook_core::GoogleDriveFolderId::into_inner)
        .map_err(|_| {
            NookError::Drive(
                "Google Drive returned an invalid private target folder ID.".to_owned(),
            )
        })
}

fn private_target_api_error(operation: &str, status: StatusCode) -> NookError {
    NookError::Drive(format!(
        "Google Drive private target {operation} failed with status {status}"
    ))
}

impl DriveStorageClient<'_> {
    async fn list_private_event_folders(
        &self,
        name: &str,
    ) -> Result<Vec<DrivePrivateFolderResource>, NookError> {
        let token = self.as_str().trim();
        let query = private_event_folder_query(name);
        let mut page_token: Option<String> = None;
        let mut folders = Vec::new();
        loop {
            let mut request = self
                .client
                .get("https://www.googleapis.com/drive/v3/files")
                .query(&[
                    ("q", query.as_str()),
                    ("spaces", "appDataFolder"),
                    ("fields", "nextPageToken,files(id,name,mimeType)"),
                    ("pageSize", "1000"),
                ]);
            if let Some(page) = page_token.as_deref() {
                request = request.query(&[("pageToken", page)]);
            }
            let mut request = request;
            for (header, value) in DriveStorageClient::new(token).drive_headers() {
                request = request.header(header, value);
            }
            let response = request.send().await?;
            if !response.status().is_success() {
                return Err(NookError::Drive(format!(
                    "Google Drive private target lookup failed with status {}",
                    response.status()
                )));
            }
            let body: DrivePrivateFolderListResponse = response
                .json()
                .await
                .map_err(|error| NookError::Serialization(error.to_string()))?;
            folders.extend(body.files.into_iter().filter(|folder| {
                folder.name == name && folder.mime_type == DRIVE_FOLDER_MIME_TYPE
            }));
            page_token = body.next_page_token;
            if page_token.is_none() {
                break;
            }
        }
        Ok(folders)
    }

    /// Find or create the deterministic appData child folder used by a new
    /// private Drive target. Legacy-root targets never call this method.
    pub(crate) async fn ensure_private_event_folder(
        &self,
        file_name: &nook_core::DriveBackupName,
    ) -> Result<String, NookError> {
        let name = private_event_folder_name(file_name);
        let folders = self.list_private_event_folders(&name).await?;
        if let Some(folder_id) = select_private_event_folder(&folders)? {
            return Ok(folder_id);
        }

        let token = self.as_str().trim();
        let metadata = private_event_folder_metadata(&name);
        let response = self
            .client
            .post("https://www.googleapis.com/drive/v3/files")
            .header("Authorization", format!("Bearer {token}"))
            .header("User-Agent", "nook-wasm")
            .json(&metadata)
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(private_target_api_error("creation", response.status()));
        }
        let created: DrivePrivateFolderResource = response
            .json()
            .await
            .map_err(|error| NookError::Serialization(error.to_string()))?;
        if created.id.trim().is_empty()
            || created.name != name
            || created.mime_type != DRIVE_FOLDER_MIME_TYPE
        {
            return Err(NookError::Drive(
                "Google Drive returned an invalid private target folder.".to_owned(),
            ));
        }
        let created_id = validate_private_event_folder_id(&created.id)?;

        // A second lookup catches duplicate folder creation races before any
        // event write can select one of two ambiguous parents.
        let folders = self.list_private_event_folders(&name).await?;
        Ok(select_private_event_folder(&folders)?.unwrap_or(created_id))
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
    fn private_target_folder_name_query_and_metadata_are_stable() -> anyhow::Result<()> {
        let name = nook_core::DriveBackupName::parse("family_vault.yaml")?;
        let folder_name = private_event_folder_name(&name);
        assert_eq!(folder_name, "nook-events-v2-family_vault.yaml");
        assert!(private_event_folder_query(&folder_name).contains(
            "name = 'nook-events-v2-family_vault.yaml' and mimeType = 'application/vnd.google-apps.folder' and 'appDataFolder' in parents and trashed = false"
        ));
        let metadata = serde_json::to_value(private_event_folder_metadata(&folder_name))?;
        assert_eq!(metadata["name"], folder_name);
        assert_eq!(metadata["mimeType"], DRIVE_FOLDER_MIME_TYPE);
        assert_eq!(metadata["parents"][0], "appDataFolder");
        Ok(())
    }

    #[wasm_bindgen_test]
    fn private_target_folder_selection_rejects_ambiguity_and_invalid_ids() {
        let one = DrivePrivateFolderResource {
            id: "folder-id".to_owned(),
            name: "target".to_owned(),
            mime_type: DRIVE_FOLDER_MIME_TYPE.to_owned(),
        };
        assert_eq!(
            select_private_event_folder(std::slice::from_ref(&one)).unwrap(),
            Some("folder-id".to_owned())
        );
        assert_eq!(select_private_event_folder(&[]).unwrap(), None);
        assert!(matches!(
            select_private_event_folder(&[one, DrivePrivateFolderResource {
                id: "another-folder".to_owned(),
                name: "target".to_owned(),
                mime_type: DRIVE_FOLDER_MIME_TYPE.to_owned(),
            }]),
            Err(NookError::Drive(message)) if message.contains("ambiguous")
        ));
        assert!(matches!(
            select_private_event_folder(&[DrivePrivateFolderResource {
                id: " ".to_owned(),
                name: "target".to_owned(),
                mime_type: DRIVE_FOLDER_MIME_TYPE.to_owned(),
            }]),
            Err(NookError::Drive(message)) if message.contains("missing its ID")
        ));
        assert!(matches!(
            select_private_event_folder(&[DrivePrivateFolderResource {
                id: "folder/with/slashes".to_owned(),
                name: "target".to_owned(),
                mime_type: DRIVE_FOLDER_MIME_TYPE.to_owned(),
            }]),
            Err(NookError::Drive(message)) if message.contains("invalid private target folder ID")
        ));
    }

    #[wasm_bindgen_test]
    fn private_target_http_errors_are_status_only() {
        assert!(matches!(
            private_target_api_error("creation", StatusCode::FORBIDDEN),
            NookError::Drive(message)
                if message == "Google Drive private target creation failed with status 403 Forbidden"
                    && !message.contains("response body")
                    && !message.contains("token")
        ));
    }

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
        let without_user: DriveAboutResponse = serde_json::from_str("{}")?;
        assert!(matches!(
            without_user.user,
            DriveAccountObservation::Unreported
        ));
        Ok(())
    }

    #[wasm_bindgen_test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    async fn access_verification_rejects_empty_token_before_network() -> anyhow::Result<()> {
        let Err(error) = DriveStorageClient::new("  ").verify_drive_access().await else {
            anyhow::bail!("empty OAuth access token must fail closed");
        };
        assert!(matches!(
            error,
            NookError::Database(message)
                if message == nook_core::ValidationError::OauthAccessTokenEmpty.to_string()
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

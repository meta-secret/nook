//! Google Drive immutable event file adapter.

#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

#[cfg(test)]
use nook_core::GenesisImportRequest;
use reqwest::Client;
use serde::{Deserialize, Serialize, de::IgnoredAny};
use std::str;

use super::checked_event_write::CheckedEventWrite;
use super::drive::wire::{FileIdentity, FileName, PageCompletion};
use super::remote_event::RemoteEventRead;
use crate::NookError;

#[derive(Default, Deserialize)]
#[serde(untagged)]
enum EventAttestation {
    Declared(DriveEventProperties),
    #[default]
    Unattested,
}
#[derive(Debug, PartialEq, Eq)]
enum ListedEvent {
    Unrelated,
    Event(String),
}
struct DriveEventCandidates<'a, I: IntoIterator<Item = Vec<u8>>> {
    event_id: &'a EventId,
    candidates: I,
}
struct AcceptedDriveEvent {
    event: VaultEvent,
    bytes: Vec<u8>,
}
enum DriveCandidateSelection {
    NoMatchingEvent,
    Accepted(AcceptedDriveEvent),
}
struct DriveEventQuery<'a> {
    url: &'a str,
    parent: &'a DriveEventParent,
}
impl DriveEventQuery<'_> {
    fn scoped_url(self) -> String {
        match self.parent {
            DriveEventParent::AppDataFolder => format!("{}&spaces=appDataFolder", self.url),
            DriveEventParent::SharedFolder { .. } => self.url.to_owned(),
        }
    }
}
enum DrivePageRequest {
    FirstPage,
    Continuation(String),
}

use nook_core::{DriveEventParent, EventId, VaultEvent};

pub(crate) struct DriveEventStore<'a> {
    pub(crate) token: &'a str,
    pub(crate) parent: &'a DriveEventParent,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DriveEventListResponse {
    #[serde(default)]
    files: Vec<DriveEventListRow>,
    #[serde(default)]
    next_page_token: PageCompletion,
}
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DriveEventFile {
    #[serde(default)]
    id: FileIdentity,
    #[serde(default)]
    name: FileName,
    #[serde(default)]
    app_properties: EventAttestation,
}
/// Drive listings can contain unrelated or malformed files. Only admitted rows
/// participate; strict write metadata below remains a separate contract.
#[derive(Deserialize)]
#[serde(untagged)]
enum DriveEventListRow {
    File(DriveEventFile),
    Unrelated(IgnoredAny),
}
#[derive(Deserialize, Serialize)]

struct DriveEventProperties {
    event_id: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DriveEventMetadata<'a> {
    name: &'a str,
    parents: [&'a str; 1],
    app_properties: DriveEventProperties,
}

const DRIVE_EVENT_MISSING: &str = "Drive event file missing.";
const SHA256_BASE64URL_LEN: usize = 43;

impl DriveEventStore<'_> {
    fn is_sha256_base64url_digest(digest: &str) -> bool {
        digest.len() == SHA256_BASE64URL_LEN
            && digest
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    }
}

/// Accept Drive list rows only when the filename digest matches Nook's
/// `appProperties.event_id`. Name-only `{digest}.yaml` junk is ignored so assess
/// / sync do not download leftover non-event files.
impl DriveEventStore<'_> {
    fn drive_listed_event_id(file: &DriveEventFile) -> ListedEvent {
        let (FileName::Reported(name), EventAttestation::Declared(properties)) =
            (&file.name, &file.app_properties)
        else {
            return ListedEvent::Unrelated;
        };
        let Some(digest) = name.strip_suffix(".yaml") else {
            return ListedEvent::Unrelated;
        };
        if !Self::is_sha256_base64url_digest(digest) {
            return ListedEvent::Unrelated;
        }
        let expected = format!("sha256u:{digest}");
        if properties.event_id == expected {
            ListedEvent::Event(expected)
        } else {
            ListedEvent::Unrelated
        }
    }
    fn list_event_ids_from_response(body: &DriveEventListResponse) -> Vec<String> {
        let mut ids = Vec::new();
        for row in &body.files {
            if let DriveEventListRow::File(file) = row
                && let ListedEvent::Event(id) = Self::drive_listed_event_id(file)
            {
                ids.push(id);
            }
        }
        ids
    }
    fn list_page_token(body: &DriveEventListResponse) -> PageCompletion {
        body.next_page_token.clone()
    }
}

/// Select content-addressed event bytes from same-name Drive candidates.
///
/// Unreadable or wrong-id candidates are skipped so a junk/empty duplicate cannot
/// block a valid event file. Divergent valid events for one id are corruption.
impl DriveEventStore<'_> {
    fn select_matching_drive_event_bytes(
        request: DriveEventCandidates<'_, impl IntoIterator<Item = Vec<u8>>>,
    ) -> Result<RemoteEventRead, NookError> {
        let DriveEventCandidates {
            event_id,
            candidates,
        } = request;
        let mut accepted = DriveCandidateSelection::NoMatchingEvent;
        for bytes in candidates {
            let storage_bytes = bytes.clone().into();
            let Ok(event) = VaultEvent::parse_remote_event_storage_bytes(&storage_bytes) else {
                continue;
            };
            let Ok(parsed_id) = event.id() else {
                continue;
            };
            if parsed_id != *event_id {
                continue;
            }
            if let DriveCandidateSelection::Accepted(existing) = &accepted {
                if existing.event == event {
                    continue;
                }
                return Err(NookError::Drive(
                    "Drive duplicate event files contain different events.".to_owned(),
                ));
            }
            accepted = DriveCandidateSelection::Accepted(AcceptedDriveEvent { event, bytes });
        }
        Ok(match accepted {
            DriveCandidateSelection::NoMatchingEvent => RemoteEventRead::Unavailable,
            DriveCandidateSelection::Accepted(event) => {
                RemoteEventRead::Retrieved(event.bytes.into())
            }
        })
    }

    fn parent_query_fragment(parent: &DriveEventParent) -> String {
        match parent {
            DriveEventParent::AppDataFolder => "'appDataFolder' in parents".to_owned(),
            DriveEventParent::SharedFolder { folder_id } => {
                format!("'{}' in parents", folder_id.replace('\'', "\\'"))
            }
        }
    }

    fn parent_id_for_create(parent: &DriveEventParent) -> &str {
        match parent {
            DriveEventParent::AppDataFolder => "appDataFolder",
            DriveEventParent::SharedFolder { folder_id } => folder_id.as_str(),
        }
    }

    pub(crate) async fn list_drive_event_ids(&self) -> Result<Vec<String>, NookError> {
        let token = self.token;
        let parent = self.parent;
        let token = token.trim();
        let query = format!(
            "name contains '.yaml' and {} and trashed=false",
            Self::parent_query_fragment(parent)
        );
        let url = format!(
            "https://www.googleapis.com/drive/v3/files?q={}&fields=nextPageToken,files(id,name,appProperties)&pageSize=1000",
            urlencoding::encode(&query)
        );
        let url = DriveEventQuery { url: &url, parent }.scoped_url();
        let client = Client::new();
        let mut event_ids = Vec::new();
        let mut page_token = DrivePageRequest::FirstPage;

        loop {
            let mut request_url = url.clone();
            if let DrivePageRequest::Continuation(page) = &page_token {
                request_url.push_str("&pageToken=");
                request_url.push_str(&urlencoding::encode(page));
            }
            let response = client
                .get(&request_url)
                .header("Authorization", format!("Bearer {token}"))
                .send()
                .await?;
            if !response.status().is_success() {
                return Err(NookError::Drive(format!(
                    "Drive list events failed: {}",
                    response.status()
                )));
            }
            let body: DriveEventListResponse = response
                .json()
                .await
                .map_err(|e| NookError::Serialization(e.to_string()))?;
            event_ids.extend(Self::list_event_ids_from_response(&body));
            page_token = match Self::list_page_token(&body) {
                PageCompletion::Complete => break,
                PageCompletion::Continue(token) => DrivePageRequest::Continuation(token),
            };
        }
        Ok(event_ids)
    }

    pub(crate) async fn fetch_drive_event(&self, event_id: &EventId) -> Result<Vec<u8>, NookError> {
        match self.read_drive_event(event_id).await? {
            RemoteEventRead::Retrieved(bytes) => Ok(bytes.into()),
            RemoteEventRead::Unavailable => Err(NookError::Drive(DRIVE_EVENT_MISSING.to_owned())),
        }
    }

    pub(crate) async fn read_drive_event(
        &self,
        event_id: &EventId,
    ) -> Result<RemoteEventRead, NookError> {
        let token = self.token;
        let parent = self.parent;
        let token = token.trim();
        let file_ids = Self::lookup_drive_event_file_ids(
            token,
            parent,
            &format!("{}.yaml", event_id.encoded_digest()),
        )
        .await?;
        if file_ids.is_empty() {
            return Ok(RemoteEventRead::Unavailable);
        }

        let client = Client::new();
        let mut candidates = Vec::with_capacity(file_ids.len());
        for file_id in file_ids {
            candidates.push(Self::download_drive_event_file(&client, token, &file_id).await?);
        }
        // Same-name junk/empty files are skipped; only content-addressed matches count.
        // When every candidate is unreadable, treat the event as absent so put-if-absent
        // can publish good local bytes beside the leftover name.
        Self::select_matching_drive_event_bytes(DriveEventCandidates {
            event_id,
            candidates,
        })
    }

    async fn lookup_drive_event_file_ids(
        token: &str,
        parent: &DriveEventParent,
        file_name: &str,
    ) -> Result<Vec<String>, NookError> {
        let query = format!(
            "name = '{}' and {} and trashed=false",
            file_name.replace('\'', "\\'"),
            Self::parent_query_fragment(parent)
        );
        let list_url = format!(
            "https://www.googleapis.com/drive/v3/files?q={}&fields=files(id)",
            urlencoding::encode(&query)
        );
        let list_url = DriveEventQuery {
            url: &list_url,
            parent,
        }
        .scoped_url();
        let client = Client::new();
        let response = client
            .get(&list_url)
            .header("Authorization", format!("Bearer {token}"))
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(NookError::Drive(format!(
                "Drive lookup event failed: {}",
                response.status()
            )));
        }
        let body: DriveEventListResponse = response
            .json()
            .await
            .map_err(|e| NookError::Serialization(e.to_string()))?;
        let mut ids = Vec::new();
        for row in body.files {
            if let DriveEventListRow::File(DriveEventFile {
                id: FileIdentity::Reported(id),
                ..
            }) = row
            {
                ids.push(id);
            }
        }
        Ok(ids)
    }

    async fn download_drive_event_file(
        client: &reqwest::Client,
        token: &str,
        file_id: &str,
    ) -> Result<Vec<u8>, NookError> {
        let download_url = format!("https://www.googleapis.com/drive/v3/files/{file_id}?alt=media");
        let download = client
            .get(&download_url)
            .header("Authorization", format!("Bearer {token}"))
            .send()
            .await?;
        if !download.status().is_success() {
            return Err(NookError::Drive(format!(
                "Drive download event failed: {}",
                download.status()
            )));
        }
        let bytes = download
            .bytes()
            .await
            .map_err(|e| NookError::Drive(format!("Drive read event body: {e}")))?;
        Ok(bytes.to_vec())
    }

    pub(crate) async fn put_drive_event_if_absent(
        &self,
        event_id: &EventId,
        bytes: &[u8],
    ) -> Result<String, NookError> {
        let checked = CheckedEventWrite::parse(bytes, event_id, "Drive")?;
        self.put_checked(checked).await
    }

    async fn put_checked(&self, checked: CheckedEventWrite<'_>) -> Result<String, NookError> {
        let token = self.token.trim();
        let parent = self.parent;
        let event_id = checked.event_id();
        let bytes = checked.bytes();
        match self.fetch_drive_event(event_id).await {
            Ok(existing) if checked.matches(&existing) => {
                return Ok(String::new());
            }
            Ok(_) => {
                return Err(NookError::Drive(
                    "Drive event path already exists with different bytes.".to_owned(),
                ));
            }
            Err(NookError::Drive(message)) if message == DRIVE_EVENT_MISSING => {}
            Err(err) => return Err(err),
        }
        let file_name = format!("{}.yaml", event_id.encoded_digest());
        let content = str::from_utf8(bytes)
            .map_err(|e| NookError::Serialization(format!("Event YAML must be UTF-8: {e}")))?;
        let (boundary, body) = Self::event_upload_body(parent, event_id, &file_name, content)
            .map_err(|error| NookError::Serialization(error.to_string()))?;

        let client = Client::new();
        let response = client
            .post("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart")
            .header("Authorization", format!("Bearer {token}"))
            .header(
                "Content-Type",
                format!("multipart/related; boundary={boundary}"),
            )
            .body(body)
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(NookError::Drive(format!(
                "Drive event create failed: {}",
                response.status()
            )));
        }
        let parsed: DriveEventFile = response
            .json()
            .await
            .map_err(|e| NookError::Serialization(e.to_string()))?;
        match parsed.id {
            FileIdentity::Reported(id) => Ok(id),
            FileIdentity::Unreported => Err(NookError::Drive(
                "Drive event create response missing file id.".to_owned(),
            )),
        }
    }

    fn event_upload_body(
        parent: &DriveEventParent,
        event_id: &EventId,
        file_name: &str,
        content: &str,
    ) -> serde_json::Result<(String, String)> {
        let metadata = DriveEventMetadata {
            name: file_name,
            parents: [Self::parent_id_for_create(parent)],
            app_properties: DriveEventProperties {
                event_id: event_id.to_string(),
            },
        };
        let boundary = "nook_event_boundary";
        let mut body = String::new();
        body.push_str("--");
        body.push_str(boundary);
        body.push_str("\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n");
        body.push_str(&serde_json::to_string(&metadata)?);
        body.push_str("\r\n--");
        body.push_str(boundary);
        body.push_str("\r\nContent-Type: application/x-yaml\r\n\r\n");
        body.push_str(content);
        body.push_str("\r\n--");
        body.push_str(boundary);
        body.push_str("--");
        Ok((boundary.to_owned(), body))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nook_core::{
        Ed25519Signature, EventId, GenesisImportPayload, IsoTimestamp, SigningIdentity, StoreId,
        VaultEvent,
    };
    use wasm_bindgen_test::wasm_bindgen_test;

    struct EventFixture(EventId, VaultEvent, Vec<u8>);

    impl EventFixture {
        fn new() -> anyhow::Result<Self> {
            let (identity, _seed) = SigningIdentity::generate()?;
            let event = VaultEvent::build_genesis_import_event(GenesisImportRequest {
                store_id: &StoreId::parse("store_testtoken11")?,
                actor_id: &identity.actor_id()?,
                key_epoch: &EventId::parse("sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo")?,
                payload: GenesisImportPayload {
                    source_content_hash: nook_auth2::Sha256Hex::from_trusted("deadbeef".repeat(8)),
                    secrets: vec![],
                    password_entries: vec![],
                },
                created_at: &IsoTimestamp::from_trusted("2026-06-28T00:00:00Z".to_owned()),
                signing_key: identity.signing_key(),
            })?;
            let event_id = event.id()?;
            let bytes = VaultEvent::serialize_event_storage_yaml(&event)?.into();
            Ok(Self(event_id, event, bytes))
        }
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test callback"
    )]
    fn select_matching_skips_unreadable_duplicate_and_keeps_valid_event() -> anyhow::Result<()> {
        let EventFixture(event_id, _, bytes) = EventFixture::new()?;
        let selected = DriveEventStore::select_matching_drive_event_bytes(DriveEventCandidates {
            event_id: &event_id,
            candidates: [b"not yaml".to_vec(), Vec::new(), bytes.clone()],
        })?;
        assert_eq!(selected, RemoteEventRead::Retrieved(bytes.into()));
        Ok(())
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test callback"
    )]
    fn select_matching_treats_all_unreadable_candidates_as_absent() -> anyhow::Result<()> {
        let EventFixture(event_id, _, _) = EventFixture::new()?;
        let selected = DriveEventStore::select_matching_drive_event_bytes(DriveEventCandidates {
            event_id: &event_id,
            candidates: [b"not yaml".to_vec(), b"{bad:".to_vec()],
        })?;
        assert_eq!(selected, RemoteEventRead::Unavailable);
        Ok(())
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test callback"
    )]
    fn select_matching_accepts_identical_duplicates() -> anyhow::Result<()> {
        let EventFixture(event_id, _, bytes) = EventFixture::new()?;
        let selected = DriveEventStore::select_matching_drive_event_bytes(DriveEventCandidates {
            event_id: &event_id,
            candidates: [bytes.clone(), bytes.clone()],
        })?;
        assert_eq!(selected, RemoteEventRead::Retrieved(bytes.into()));
        Ok(())
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test callback"
    )]
    fn select_matching_rejects_same_id_divergent_envelopes() -> anyhow::Result<()> {
        let EventFixture(event_id, mut event, bytes) = EventFixture::new()?;
        event.signature = Ed25519Signature::from_trusted(format!("ed25519:{}", "11".repeat(64)));
        let divergent = VaultEvent::serialize_event_storage_yaml(&event)?.into();
        let err = DriveEventStore::select_matching_drive_event_bytes(DriveEventCandidates {
            event_id: &event_id,
            candidates: [bytes, divergent],
        })
        .err()
        .ok_or_else(|| anyhow::anyhow!("expected divergent duplicate corruption"))?;
        assert!(
            matches!(err, NookError::Drive(ref message) if message.contains("different events")),
            "unexpected error: {err}"
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test callback"
    )]
    fn select_matching_ignores_a_valid_event_for_a_different_requested_id() -> anyhow::Result<()> {
        let EventFixture(event_id, _, _) = EventFixture::new()?;
        let EventFixture(other_id, _, other_bytes) = EventFixture::new()?;
        assert_ne!(event_id, other_id);
        let selected = DriveEventStore::select_matching_drive_event_bytes(DriveEventCandidates {
            event_id: &event_id,
            candidates: [other_bytes],
        })?;
        assert_eq!(selected, RemoteEventRead::Unavailable);
        Ok(())
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test callback"
    )]
    fn multipart_upload_body_preserves_parent_event_id_and_yaml() -> anyhow::Result<()> {
        let event_id = EventId::parse(&format!("sha256u:{}", "A".repeat(43)))?;
        let parent = DriveEventParent::SharedFolder {
            folder_id: "shared-folder".to_owned(),
        };
        let (boundary, body) =
            DriveEventStore::event_upload_body(&parent, &event_id, "event.yaml", "event: yaml")?;
        assert_eq!(boundary, "nook_event_boundary");
        assert!(body.contains("\"name\":\"event.yaml\""));
        assert!(body.contains("\"parents\":[\"shared-folder\"]"));
        assert!(body.contains(&format!("\"event_id\":\"{}\"", event_id)));
        assert!(body.contains("Content-Type: application/x-yaml"));
        assert!(body.contains("\r\n\r\nevent: yaml\r\n--nook_event_boundary--"));
        Ok(())
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
    )]
    async fn event_write_rejects_mismatched_event_id_before_network() -> anyhow::Result<()> {
        let EventFixture(_, _, bytes) = EventFixture::new()?;
        let requested_id = EventId::parse(&format!("sha256u:{}", "A".repeat(43)))?;
        let store = DriveEventStore {
            token: "",
            parent: &DriveEventParent::AppDataFolder,
        };
        let error = store
            .put_drive_event_if_absent(&requested_id, &bytes)
            .await
            .expect_err("mismatched event id must fail before network");
        assert!(matches!(
            error,
            NookError::Serialization(message) if message.contains("Drive event id mismatch")
        ));
        Ok(())
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test callback"
    )]
    fn private_and_shared_queries_keep_their_original_scope() {
        let private = DriveEventParent::AppDataFolder;
        let shared = DriveEventParent::SharedFolder {
            folder_id: "owner's-folder".to_owned(),
        };
        assert_eq!(
            DriveEventStore::parent_query_fragment(&private),
            "'appDataFolder' in parents"
        );
        assert_eq!(
            DriveEventQuery {
                url: "files?q=events",
                parent: &private
            }
            .scoped_url(),
            "files?q=events&spaces=appDataFolder"
        );
        assert_eq!(
            DriveEventStore::parent_id_for_create(&private),
            "appDataFolder"
        );
        assert_eq!(
            DriveEventStore::parent_query_fragment(&shared),
            "'owner\\'s-folder' in parents"
        );
        assert_eq!(
            DriveEventQuery {
                url: "files?q=events",
                parent: &shared
            }
            .scoped_url(),
            "files?q=events"
        );
        assert_eq!(
            DriveEventStore::parent_id_for_create(&shared),
            "owner's-folder"
        );
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test callback"
    )]
    fn listed_event_id_requires_matching_app_property() {
        let digest = "ej6ZESIzRFVmd4iZqrvM3e7_ABEiM0RVZneImaq7zN0";
        let mut file = DriveEventFile {
            id: FileIdentity::Unreported,
            name: FileName::Reported(format!("{digest}.yaml")),
            app_properties: EventAttestation::Declared(DriveEventProperties {
                event_id: format!("sha256u:{digest}"),
            }),
        };
        assert_eq!(
            DriveEventStore::drive_listed_event_id(&file),
            ListedEvent::Event(format!("sha256u:{digest}"))
        );
        file.app_properties = EventAttestation::Unattested;
        assert_eq!(
            DriveEventStore::drive_listed_event_id(&file),
            ListedEvent::Unrelated
        );
        file.app_properties = EventAttestation::Declared(DriveEventProperties {
            event_id: "wrong".to_owned(),
        });
        assert_eq!(
            DriveEventStore::drive_listed_event_id(&file),
            ListedEvent::Unrelated
        );
        file.name = FileName::Reported("notes.yaml".to_owned());
        assert_eq!(
            DriveEventStore::drive_listed_event_id(&file),
            ListedEvent::Unrelated
        );
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test callback"
    )]
    fn list_response_projection_accepts_only_matching_event_rows() -> anyhow::Result<()> {
        let digest = "ej6ZESIzRFVmd4iZqrvM3e7_ABEiM0RVZneImaq7zN0";
        let event_id = format!("sha256u:{digest}");
        let body: DriveEventListResponse = serde_json::from_value(serde_json::json!({
            "files": [
                {"name": format!("{digest}.yaml"), "appProperties": {"event_id": event_id}},
                {"name": format!("{digest}.yaml")},
                {"name": "notes.yaml", "appProperties": {"event_id": "sha256u:notes"}},
                {"name": format!("{digest}.yaml"), "appProperties": {"event_id": "wrong"}}
            ]
        }))?;
        assert_eq!(
            DriveEventStore::list_event_ids_from_response(&body),
            vec![event_id]
        );
        assert_eq!(
            DriveEventStore::list_event_ids_from_response(&DriveEventListResponse::default()),
            Vec::<String>::new()
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test callback"
    )]
    fn list_response_projection_preserves_page_token_only_when_string() -> anyhow::Result<()> {
        let body: DriveEventListResponse = serde_json::from_str(r#"{"nextPageToken":"page-2"}"#)?;
        assert_eq!(
            DriveEventStore::list_page_token(&body),
            PageCompletion::Continue("page-2".to_owned())
        );
        assert!(serde_json::from_str::<DriveEventListResponse>(r#"{"nextPageToken":2}"#).is_err());
        Ok(())
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test callback"
    )]
    fn digest_filter_rejects_wrong_length_and_non_base64url_bytes() {
        let digest = "ej6ZESIzRFVmd4iZqrvM3e7_ABEiM0RVZneImaq7zN0";
        assert!(DriveEventStore::is_sha256_base64url_digest(digest));
        assert!(!DriveEventStore::is_sha256_base64url_digest("short"));
        assert!(!DriveEventStore::is_sha256_base64url_digest(&format!(
            "{}!",
            &digest[..42]
        )));
        assert_eq!(
            DriveEventStore::drive_listed_event_id(&DriveEventFile {
                name: FileName::Reported(format!("{digest}.json")),
                app_properties: EventAttestation::Declared(DriveEventProperties {
                    event_id: "ignored".to_owned()
                }),
                ..DriveEventFile::default()
            }),
            ListedEvent::Unrelated
        );
    }
    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test callback"
    )]
    fn malformed_listing_rows_preserve_valid_event_siblings() -> anyhow::Result<()> {
        let digest = "q".repeat(SHA256_BASE64URL_LEN);
        let event_id = format!("sha256u:{digest}");
        let json = format!(
            r#"{{"files":[{{"id":"valid","name":"{digest}.yaml","appProperties":{{"event_id":"{event_id}"}}}},{{"name":"{digest}.yaml","appProperties":{{}}}},{{"name":"{digest}.yaml","appProperties":{{"event_id":4}}}},{{"name":"{digest}.yaml","appProperties":null}},{{"name":3}},{{"appProperties":[]}},null,{{"name":"unrelated.yaml"}}],"nextPageToken":"next"}}"#
        );
        let response: DriveEventListResponse = serde_json::from_str(&json)?;
        assert_eq!(
            DriveEventStore::list_event_ids_from_response(&response),
            vec![event_id.clone()]
        );
        assert_eq!(
            DriveEventStore::list_page_token(&response),
            PageCompletion::Continue("next".to_owned())
        );
        let properties = DriveEventProperties { event_id };
        assert_eq!(
            serde_json::to_string(&properties)?,
            format!(r#"{{"event_id":"sha256u:{digest}"}}"#)
        );
        Ok(())
    }
}

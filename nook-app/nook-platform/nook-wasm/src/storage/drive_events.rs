//! Google Drive immutable event file adapter.

#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use reqwest::Client;
use std::str;

use super::checked_event_write::CheckedEventWrite;
use crate::NookError;
use nook_core::{DriveEventParent, EventId, VaultEvent, parse_remote_event_storage_bytes};

pub(crate) struct DriveEventStore<'a> {
    pub(crate) token: &'a str,
    pub(crate) parent: &'a DriveEventParent,
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
    fn drive_listed_event_id(name: &str, app_event_id: Option<&str>) -> Option<String> {
        let digest = name.strip_suffix(".yaml")?;
        if !Self::is_sha256_base64url_digest(digest) {
            return None;
        }
        let expected = format!("sha256u:{digest}");
        match app_event_id {
            Some(id) if id == expected => Some(expected),
            Some(_) | None => None,
        }
    }

    fn list_event_ids_from_response(body: &serde_json::Value) -> Vec<String> {
        body.get("files")
            .and_then(|value| value.as_array())
            .into_iter()
            .flatten()
            .filter_map(|file| {
                let name = file.get("name").and_then(|value| value.as_str())?;
                let app_event_id = file
                    .get("appProperties")
                    .and_then(|properties| properties.get("event_id"))
                    .and_then(|value| value.as_str());
                Self::drive_listed_event_id(name, app_event_id)
            })
            .collect()
    }

    fn list_page_token(body: &serde_json::Value) -> Option<String> {
        body.get("nextPageToken")
            .and_then(|value| value.as_str())
            .map(str::to_owned)
    }
}

/// Select content-addressed event bytes from same-name Drive candidates.
///
/// Unreadable or wrong-id candidates are skipped so a junk/empty duplicate cannot
/// block a valid event file. Divergent valid events for one id are corruption.
impl DriveEventStore<'_> {
    fn select_matching_drive_event_bytes(
        event_id: &EventId,
        candidates: impl IntoIterator<Item = Vec<u8>>,
    ) -> Result<Option<Vec<u8>>, NookError> {
        let mut accepted: Option<(VaultEvent, Vec<u8>)> = None;
        for bytes in candidates {
            let storage_bytes = bytes.clone().into();
            let Ok(event) = parse_remote_event_storage_bytes(&storage_bytes) else {
                continue;
            };
            let Ok(parsed_id) = event.id() else {
                continue;
            };
            if parsed_id != *event_id {
                continue;
            }
            if let Some((existing_event, _)) = &accepted {
                if existing_event == &event {
                    continue;
                }
                return Err(NookError::Drive(
                    "Drive duplicate event files contain different events.".to_owned(),
                ));
            }
            accepted = Some((event, bytes));
        }
        Ok(accepted.map(|(_, bytes)| bytes))
    }

    fn parent_query_fragment(parent: &DriveEventParent) -> String {
        match parent {
            DriveEventParent::AppDataFolder => "'appDataFolder' in parents".to_owned(),
            DriveEventParent::SharedFolder { folder_id } => {
                format!("'{}' in parents", folder_id.replace('\'', "\\'"))
            }
        }
    }

    fn list_spaces_query(parent: &DriveEventParent) -> Option<&'static str> {
        match parent {
            DriveEventParent::AppDataFolder => Some("appDataFolder"),
            DriveEventParent::SharedFolder { .. } => None,
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
        let mut url = format!(
            "https://www.googleapis.com/drive/v3/files?q={}&fields=nextPageToken,files(id,name,appProperties)&pageSize=1000",
            urlencoding::encode(&query)
        );
        if let Some(spaces) = Self::list_spaces_query(parent) {
            url.push_str("&spaces=");
            url.push_str(spaces);
        }
        let client = Client::new();
        let mut event_ids = Vec::new();
        let mut page_token: Option<String> = None;

        loop {
            let mut request_url = url.clone();
            if let Some(page) = &page_token {
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
            let body: serde_json::Value = response
                .json()
                .await
                .map_err(|e| NookError::Serialization(e.to_string()))?;
            event_ids.extend(Self::list_event_ids_from_response(&body));
            page_token = Self::list_page_token(&body);
            if page_token.is_none() {
                break;
            }
        }
        Ok(event_ids)
    }

    pub(crate) async fn fetch_drive_event(&self, event_id: &EventId) -> Result<Vec<u8>, NookError> {
        self.fetch_drive_event_optional(event_id)
            .await?
            .ok_or_else(|| NookError::Drive(DRIVE_EVENT_MISSING.to_owned()))
    }

    pub(crate) async fn fetch_drive_event_optional(
        &self,
        event_id: &EventId,
    ) -> Result<Option<Vec<u8>>, NookError> {
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
            return Ok(None);
        }

        let client = Client::new();
        let mut candidates = Vec::with_capacity(file_ids.len());
        for file_id in file_ids {
            candidates.push(Self::download_drive_event_file(&client, token, &file_id).await?);
        }
        // Same-name junk/empty files are skipped; only content-addressed matches count.
        // When every candidate is unreadable, treat the event as absent so put-if-absent
        // can publish good local bytes beside the leftover name.
        Self::select_matching_drive_event_bytes(event_id, candidates)
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
        let mut list_url = format!(
            "https://www.googleapis.com/drive/v3/files?q={}&fields=files(id)",
            urlencoding::encode(&query)
        );
        if let Some(spaces) = Self::list_spaces_query(parent) {
            list_url.push_str("&spaces=");
            list_url.push_str(spaces);
        }
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
        let body: serde_json::Value = response
            .json()
            .await
            .map_err(|e| NookError::Serialization(e.to_string()))?;
        let Some(files) = body.get("files").and_then(|v| v.as_array()) else {
            return Ok(Vec::new());
        };
        Ok(files
            .iter()
            .filter_map(|file| file.get("id").and_then(|v| v.as_str()).map(str::to_owned))
            .collect())
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
        let (boundary, body) = Self::event_upload_body(parent, event_id, &file_name, content);

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
        let parsed: serde_json::Value = response
            .json()
            .await
            .map_err(|e| NookError::Serialization(e.to_string()))?;
        parsed
            .get("id")
            .and_then(|v| v.as_str())
            .map(str::to_owned)
            .ok_or_else(|| {
                NookError::Drive("Drive event create response missing file id.".to_owned())
            })
    }

    fn event_upload_body(
        parent: &DriveEventParent,
        event_id: &EventId,
        file_name: &str,
        content: &str,
    ) -> (String, String) {
        let metadata = serde_json::json!({
            "name": file_name,
            "parents": [Self::parent_id_for_create(parent)],
            "appProperties": {
                "event_id": event_id.as_str(),
            }
        });
        let boundary = "nook_event_boundary";
        let mut body = String::new();
        body.push_str("--");
        body.push_str(boundary);
        body.push_str("\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n");
        body.push_str(&metadata.to_string());
        body.push_str("\r\n--");
        body.push_str(boundary);
        body.push_str("\r\nContent-Type: application/x-yaml\r\n\r\n");
        body.push_str(content);
        body.push_str("\r\n--");
        body.push_str(boundary);
        body.push_str("--");
        (boundary.to_owned(), body)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nook_core::{
        Ed25519Signature, EventId, GenesisImportPayload, IsoTimestamp, SigningIdentity, StoreId,
        VaultEvent, build_genesis_import_event, serialize_event_storage_yaml,
    };
    use wasm_bindgen_test::wasm_bindgen_test;

    struct EventFixture(EventId, VaultEvent, Vec<u8>);

    impl EventFixture {
        fn new() -> anyhow::Result<Self> {
            let (identity, _seed) = SigningIdentity::generate()?;
            let event = build_genesis_import_event(
                &StoreId::parse("store_testtoken11")?,
                &identity.actor_id()?,
                &EventId::parse("sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo")?,
                GenesisImportPayload {
                    source_content_hash: nook_auth2::Sha256Hex::from_trusted("deadbeef".repeat(8)),
                    secrets: vec![],
                    password_entries: vec![],
                },
                &IsoTimestamp::from_trusted("2026-06-28T00:00:00Z".to_owned()),
                identity.signing_key(),
            )?;
            let event_id = event.id()?;
            let bytes = serialize_event_storage_yaml(&event)?.into();
            Ok(Self(event_id, event, bytes))
        }
    }

    #[wasm_bindgen_test]
    fn select_matching_skips_unreadable_duplicate_and_keeps_valid_event() -> anyhow::Result<()> {
        let EventFixture(event_id, _, bytes) = EventFixture::new()?;
        let selected = DriveEventStore::select_matching_drive_event_bytes(
            &event_id,
            [b"not yaml".to_vec(), Vec::new(), bytes.clone()],
        )?;
        assert_eq!(selected, Some(bytes));
        Ok(())
    }

    #[wasm_bindgen_test]
    fn select_matching_treats_all_unreadable_candidates_as_absent() -> anyhow::Result<()> {
        let EventFixture(event_id, _, _) = EventFixture::new()?;
        let selected = DriveEventStore::select_matching_drive_event_bytes(
            &event_id,
            [b"not yaml".to_vec(), b"{bad:".to_vec()],
        )?;
        assert_eq!(selected, None);
        Ok(())
    }

    #[wasm_bindgen_test]
    fn select_matching_accepts_identical_duplicates() -> anyhow::Result<()> {
        let EventFixture(event_id, _, bytes) = EventFixture::new()?;
        let selected = DriveEventStore::select_matching_drive_event_bytes(
            &event_id,
            [bytes.clone(), bytes.clone()],
        )?;
        assert_eq!(selected, Some(bytes));
        Ok(())
    }

    #[wasm_bindgen_test]
    fn select_matching_rejects_same_id_divergent_envelopes() -> anyhow::Result<()> {
        let EventFixture(event_id, mut event, bytes) = EventFixture::new()?;
        event.signature = Ed25519Signature::from_trusted(format!("ed25519:{}", "11".repeat(64)));
        let divergent = serialize_event_storage_yaml(&event)?.into();
        let err = DriveEventStore::select_matching_drive_event_bytes(&event_id, [bytes, divergent])
            .err()
            .ok_or_else(|| anyhow::anyhow!("expected divergent duplicate corruption"))?;
        assert!(
            matches!(err, NookError::Drive(ref message) if message.contains("different events")),
            "unexpected error: {err}"
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    fn select_matching_ignores_a_valid_event_for_a_different_requested_id() -> anyhow::Result<()> {
        let EventFixture(event_id, _, _) = EventFixture::new()?;
        let EventFixture(other_id, _, other_bytes) = EventFixture::new()?;
        assert_ne!(event_id, other_id);
        let selected =
            DriveEventStore::select_matching_drive_event_bytes(&event_id, [other_bytes])?;
        assert_eq!(selected, None);
        Ok(())
    }

    #[wasm_bindgen_test]
    fn multipart_upload_body_preserves_parent_event_id_and_yaml() -> anyhow::Result<()> {
        let event_id = EventId::parse(&format!("sha256u:{}", "A".repeat(43)))?;
        let parent = DriveEventParent::SharedFolder {
            folder_id: "shared-folder".to_owned(),
        };
        let (boundary, body) =
            DriveEventStore::event_upload_body(&parent, &event_id, "event.yaml", "event: yaml");
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
            DriveEventStore::list_spaces_query(&private),
            Some("appDataFolder")
        );
        assert_eq!(
            DriveEventStore::parent_id_for_create(&private),
            "appDataFolder"
        );
        assert_eq!(
            DriveEventStore::parent_query_fragment(&shared),
            "'owner\\'s-folder' in parents"
        );
        assert_eq!(DriveEventStore::list_spaces_query(&shared), None);
        assert_eq!(
            DriveEventStore::parent_id_for_create(&shared),
            "owner's-folder"
        );
    }

    #[wasm_bindgen_test]
    fn listed_event_id_requires_matching_app_property() {
        let digest = "ej6ZESIzRFVmd4iZqrvM3e7_ABEiM0RVZneImaq7zN0";
        let name = format!("{digest}.yaml");
        let expected = format!("sha256u:{digest}");
        assert_eq!(
            DriveEventStore::drive_listed_event_id(&name, Some(expected.as_str())),
            Some(expected.clone())
        );
        assert_eq!(DriveEventStore::drive_listed_event_id(&name, None), None);
        assert_eq!(
            DriveEventStore::drive_listed_event_id(
                &name,
                Some("sha256u:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
            ),
            None
        );
        assert_eq!(
            DriveEventStore::drive_listed_event_id("notes.yaml", Some("sha256u:notes")),
            None
        );
    }

    #[wasm_bindgen_test]
    fn list_response_projection_accepts_only_matching_event_rows() -> anyhow::Result<()> {
        let digest = "ej6ZESIzRFVmd4iZqrvM3e7_ABEiM0RVZneImaq7zN0";
        let event_id = format!("sha256u:{digest}");
        let body = serde_json::json!({
            "files": [
                {"name": format!("{digest}.yaml"), "appProperties": {"event_id": event_id}},
                {"name": format!("{digest}.yaml")},
                {"name": "notes.yaml", "appProperties": {"event_id": "sha256u:notes"}},
                {"name": 42, "appProperties": {"event_id": "ignored"}},
                {"name": format!("{digest}.yaml"), "appProperties": {"event_id": "wrong"}}
            ]
        });
        assert_eq!(
            DriveEventStore::list_event_ids_from_response(&body),
            vec![event_id]
        );
        assert_eq!(
            DriveEventStore::list_event_ids_from_response(&serde_json::json!({})),
            Vec::<String>::new()
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    fn list_response_projection_preserves_page_token_only_when_string() {
        let body = serde_json::json!({"nextPageToken": "page-2"});
        assert_eq!(
            DriveEventStore::list_page_token(&body).as_deref(),
            Some("page-2")
        );
        assert_eq!(
            DriveEventStore::list_page_token(&serde_json::json!({"nextPageToken": 2})),
            None
        );
    }

    #[wasm_bindgen_test]
    fn digest_filter_rejects_wrong_length_and_non_base64url_bytes() {
        let digest = "ej6ZESIzRFVmd4iZqrvM3e7_ABEiM0RVZneImaq7zN0";
        assert!(DriveEventStore::is_sha256_base64url_digest(digest));
        assert!(!DriveEventStore::is_sha256_base64url_digest("short"));
        assert!(!DriveEventStore::is_sha256_base64url_digest(&format!(
            "{}!",
            &digest[..42]
        )));
        assert_eq!(
            DriveEventStore::drive_listed_event_id(&format!("{digest}.json"), Some("ignored")),
            None
        );
    }
}

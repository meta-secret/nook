//! Google Drive immutable event file adapter.

#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use futures_util::{StreamExt, TryStreamExt, stream};
#[cfg(test)]
use nook_core::GenesisImportRequest;
use nook_core::ProviderSecretText;
use reqwest::Client;
use serde::{Deserialize, Serialize, de::IgnoredAny};
use std::collections::{BTreeMap, BTreeSet};
use std::str;

use super::checked_event_write::{CheckedEventWrite, ParsedLogEvent};
use super::drive::wire::{
    CreatedTime, DriveFileId, DriveFileIds, DrivePageRequest, PageAfter, PageCompletion,
};
use super::event_store::{EventStore, StoredEventRead};
use super::omittable_list::OmittableList;
use super::remote_event::RemoteEventRead;
use crate::NookError;

/// Boundary conversion: Drive's optional `appProperties`, read here as declared or unattested.
#[derive(Deserialize)]
#[serde(from = "Option<DriveEventProperties>")]
enum EventAttestation {
    Declared(DriveEventProperties),
    Unattested,
}
impl From<Option<DriveEventProperties>> for EventAttestation {
    fn from(properties: Option<DriveEventProperties>) -> Self {
        match properties {
            Some(properties) => Self::Declared(properties),
            None => Self::Unattested,
        }
    }
}
#[derive(Debug, PartialEq, Eq)]
enum ListedEvent {
    Unrelated,
    Event(String),
}
struct DriveEventCandidates<'a, I: IntoIterator<Item = Vec<u8>>> {
    event_id: &'a EventId,
    location: &'a EventLogLocation,
    candidates: I,
}
struct AcceptedDriveEvent {
    event: ParsedLogEvent,
    bytes: Vec<u8>,
}
enum DriveCandidateSelection {
    NoMatchingEvent,
    Accepted(Box<AcceptedDriveEvent>),
}
impl DriveCandidateSelection {
    fn accepted(event: AcceptedDriveEvent) -> Self {
        Self::Accepted(Box::new(event))
    }
}
/// One admitted event file of a listing: its event, when Drive created it,
/// and the file it downloads from.
struct ListedDriveEvent {
    event_id: EventId,
    created: CreatedTime,
    file_id: String,
}
/// One event of a listing to read, from the files the listing named for it.
struct ListedEventRead<'a> {
    client: &'a Client,
    event_id: EventId,
    file_ids: Vec<String>,
}

use nook_core::{DriveEventParent, EventId, EventLogLocation, LocalEventWrite};

/// Event IO under an already resolved namespace parent; see `DriveNamespace`.
pub(crate) struct DriveEventStore<'a> {
    pub(crate) token: &'a ProviderSecretText,
    pub(crate) parent: DriveEventParent,
    pub(crate) location: &'a EventLogLocation,
}

/// One page of the event listing.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DriveEventListResponse {
    files: OmittableList<DriveEventListRow>,
    next_page_token: PageCompletion,
}
/// An event file row with every field the listing asks for.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DriveEventFile {
    id: String,
    name: String,
    app_properties: EventAttestation,
    created_time: CreatedTime,
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
        let EventAttestation::Declared(properties) = &file.app_properties else {
            return ListedEvent::Unrelated;
        };
        let name = &file.name;
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
    /// The admitted event files of one page's rows; the event id is parsed
    /// here, once.
    fn listed_events_from_rows(
        rows: Vec<DriveEventListRow>,
    ) -> Result<Vec<ListedDriveEvent>, NookError> {
        let mut events = Vec::new();
        for row in rows {
            if let DriveEventListRow::File(file) = row
                && let ListedEvent::Event(event_id) = Self::drive_listed_event_id(&file)
            {
                events.push(ListedDriveEvent {
                    event_id: EventId::parse(&event_id)?,
                    created: file.created_time,
                    file_id: file.id,
                });
            }
        }
        Ok(events)
    }

    /// Each listed event with the files that hold it, duplicates together.
    fn files_by_event(listed: Vec<ListedDriveEvent>) -> BTreeMap<EventId, Vec<String>> {
        let mut files: BTreeMap<EventId, Vec<String>> = BTreeMap::new();
        for event in listed {
            files.entry(event.event_id).or_default().push(event.file_id);
        }
        files
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
            location,
            candidates,
        } = request;
        let mut accepted = DriveCandidateSelection::NoMatchingEvent;
        for bytes in candidates {
            let Ok(event) = ParsedLogEvent::parse(&bytes, location) else {
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
            accepted = DriveCandidateSelection::accepted(AcceptedDriveEvent { event, bytes });
        }
        Ok(match accepted {
            DriveCandidateSelection::NoMatchingEvent => RemoteEventRead::Unavailable,
            DriveCandidateSelection::Accepted(event) => {
                RemoteEventRead::Retrieved(event.bytes.into())
            }
        })
    }

    fn parent_query_fragment(parent: &DriveEventParent) -> String {
        format!("'{}' in parents", parent.folder_id.replace('\'', "\\'"))
    }

    fn parent_id_for_create(parent: &DriveEventParent) -> &str {
        parent.folder_id.as_str()
    }

    /// When Drive created each event file in this namespace: one entry per
    /// event, read from the listing alone. Duplicate files of one event
    /// count once.
    pub(crate) async fn list_drive_event_times(
        &self,
    ) -> Result<Vec<nook_core::ProviderVaultTime>, NookError> {
        let mut events = BTreeMap::new();
        for listed in self.list_drive_events().await? {
            events.entry(listed.event_id).or_insert(listed.created);
        }
        events.values().map(CreatedTime::provider_time).collect()
    }

    async fn list_drive_events(&self) -> Result<Vec<ListedDriveEvent>, NookError> {
        let token = self.token;
        let parent = &self.parent;
        let token = token.expose();
        let query = format!(
            "name contains '.yaml' and {} and trashed=false",
            Self::parent_query_fragment(parent)
        );
        let url = format!(
            "https://www.googleapis.com/drive/v3/files?q={}&fields=nextPageToken,files(id,name,appProperties,createdTime)&pageSize=1000",
            urlencoding::encode(&query)
        );
        let client = Client::new();
        let mut event_ids = Vec::new();
        let mut page_token = DrivePageRequest::FirstPage;

        loop {
            let mut request_url = url.clone();
            if let DrivePageRequest::Continuation(page) = &page_token {
                request_url.push_str("&pageToken=");
                request_url.push_str(&urlencoding::encode(page));
            }
            let response = client.get(&request_url).bearer_auth(token).send().await?;
            if !response.status().is_success() {
                return Err(NookError::Drive(format!(
                    "Drive list events failed: {}",
                    response.status()
                )));
            }
            let DriveEventListResponse {
                files,
                next_page_token,
            } = response
                .json()
                .await
                .map_err(|e| NookError::Serialization(e.to_string()))?;
            event_ids.extend(Self::listed_events_from_rows(files.into_rows())?);
            page_token = match DrivePageRequest::after(next_page_token) {
                PageAfter::Next(next) => next,
                PageAfter::Done => break,
            };
        }
        Ok(event_ids)
    }

    /// Every event in this namespace, from one listing: each event downloads
    /// from the files the listing names, several at a time, instead of one
    /// name lookup and one download per event in turn.
    async fn read_drive_events(&self) -> Result<Vec<StoredEventRead>, NookError> {
        let client = Client::new();
        stream::iter(Self::files_by_event(self.list_drive_events().await?))
            .map(|(event_id, file_ids)| {
                self.read_listed_event(ListedEventRead {
                    client: &client,
                    event_id,
                    file_ids,
                })
            })
            .buffered(<Self as EventStore>::READ_CONCURRENCY)
            .try_collect()
            .await
    }

    async fn read_listed_event(
        &self,
        read: ListedEventRead<'_>,
    ) -> Result<StoredEventRead, NookError> {
        let event_id = read.event_id;
        let token = self.token.expose();
        let mut candidates = Vec::with_capacity(read.file_ids.len());
        for file_id in &read.file_ids {
            candidates.push(Self::download_drive_event_file(read.client, token, file_id).await?);
        }
        let selected = Self::select_matching_drive_event_bytes(DriveEventCandidates {
            event_id: &event_id,
            location: self.location,
            candidates,
        })?;
        Ok(StoredEventRead {
            event_id,
            read: selected,
        })
    }

    async fn read_drive_event(&self, event_id: &EventId) -> Result<RemoteEventRead, NookError> {
        let token = self.token;
        let parent = &self.parent;
        let token = token.expose();
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
            location: self.location,
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
        let client = Client::new();
        let response = client.get(&list_url).bearer_auth(token).send().await?;
        if !response.status().is_success() {
            return Err(NookError::Drive(format!(
                "Drive lookup event failed: {}",
                response.status()
            )));
        }
        let body: DriveFileIds = response
            .json()
            .await
            .map_err(|e| NookError::Serialization(e.to_string()))?;
        Ok(body
            .files
            .into_rows()
            .into_iter()
            .map(|file| file.id)
            .collect())
    }

    async fn download_drive_event_file(
        client: &reqwest::Client,
        token: &str,
        file_id: &str,
    ) -> Result<Vec<u8>, NookError> {
        let download_url = format!("https://www.googleapis.com/drive/v3/files/{file_id}?alt=media");
        let download = client.get(&download_url).bearer_auth(token).send().await?;
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

    /// The same event already stored is a success; other bytes fail. The
    /// created file's id is required in Drive's answer.
    async fn put_drive_event(&self, checked: CheckedEventWrite<'_>) -> Result<(), NookError> {
        let token = self.token.expose();
        let parent = &self.parent;
        let event_id = checked.event_id();
        let bytes = checked.bytes();
        match self.read_drive_event(event_id).await? {
            RemoteEventRead::Retrieved(existing) if checked.matches(existing.as_ref()) => {
                return Ok(());
            }
            RemoteEventRead::Retrieved(_) => {
                return Err(NookError::Drive(
                    "Drive event path already exists with different bytes.".to_owned(),
                ));
            }
            RemoteEventRead::Unavailable => {}
        }
        let file_name = format!("{}.yaml", event_id.encoded_digest());
        let content = str::from_utf8(bytes)
            .map_err(|e| NookError::Serialization(format!("Event YAML must be UTF-8: {e}")))?;
        let (boundary, body) = Self::event_upload_body(parent, event_id, &file_name, content)
            .map_err(|error| NookError::Serialization(error.to_string()))?;

        let client = Client::new();
        let response = client
            .post("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart")
            .bearer_auth(token)
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
        // The answer must name the created file.
        let _created: DriveFileId = response.json().await.map_err(|e| {
            NookError::Drive(format!("Drive event create response missing file id: {e}"))
        })?;
        Ok(())
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

impl EventStore for DriveEventStore<'_> {
    async fn event_ids(&self) -> Result<BTreeSet<EventId>, NookError> {
        Ok(self
            .list_drive_events()
            .await?
            .into_iter()
            .map(|listed| listed.event_id)
            .collect())
    }

    /// No file of the event's name in the namespace folder reads as an
    /// event the namespace does not hold.
    async fn read(&self, event_id: &EventId) -> Result<RemoteEventRead, NookError> {
        self.read_drive_event(event_id).await
    }

    async fn put_checked(&self, event: CheckedEventWrite<'_>) -> Result<(), NookError> {
        self.put_drive_event(event).await
    }

    /// Delete the namespace folder, which is this store's parent.
    async fn delete_events(&self) -> Result<(), NookError> {
        let response = Client::new()
            .delete(format!(
                "https://www.googleapis.com/drive/v3/files/{}",
                urlencoding::encode(self.parent.folder_id.as_str())
            ))
            .bearer_auth(self.token.expose())
            .query(&[("supportsAllDrives", "true")])
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(NookError::Drive(format!(
                "Google Drive namespace deletion failed with status {}",
                response.status()
            )));
        }
        Ok(())
    }

    /// One listing and several downloads at once, instead of one name lookup
    /// and one download per event.
    async fn events(&self) -> Result<Vec<LocalEventWrite>, NookError> {
        Ok(self
            .read_drive_events()
            .await?
            .into_iter()
            .flat_map(StoredEventRead::into_events)
            .collect())
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
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test callback"
        )
    )]
    fn select_matching_skips_unreadable_duplicate_and_keeps_valid_event() -> anyhow::Result<()> {
        let EventFixture(event_id, _, bytes) = EventFixture::new()?;
        let selected = DriveEventStore::select_matching_drive_event_bytes(DriveEventCandidates {
            location: &nook_core::EventLogLocation::Vault(nook_core::StoreId::parse(
                "store_abcdefghijk",
            )?),
            event_id: &event_id,
            candidates: [b"not yaml".to_vec(), Vec::new(), bytes.clone()],
        })?;
        assert_eq!(selected, RemoteEventRead::Retrieved(bytes.into()));
        Ok(())
    }

    #[wasm_bindgen_test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test callback"
        )
    )]
    fn select_matching_treats_all_unreadable_candidates_as_absent() -> anyhow::Result<()> {
        let EventFixture(event_id, _, _) = EventFixture::new()?;
        let selected = DriveEventStore::select_matching_drive_event_bytes(DriveEventCandidates {
            location: &nook_core::EventLogLocation::Vault(nook_core::StoreId::parse(
                "store_abcdefghijk",
            )?),
            event_id: &event_id,
            candidates: [b"not yaml".to_vec(), b"{bad:".to_vec()],
        })?;
        assert_eq!(selected, RemoteEventRead::Unavailable);
        Ok(())
    }

    #[wasm_bindgen_test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test callback"
        )
    )]
    fn select_matching_accepts_identical_duplicates() -> anyhow::Result<()> {
        let EventFixture(event_id, _, bytes) = EventFixture::new()?;
        let selected = DriveEventStore::select_matching_drive_event_bytes(DriveEventCandidates {
            location: &nook_core::EventLogLocation::Vault(nook_core::StoreId::parse(
                "store_abcdefghijk",
            )?),
            event_id: &event_id,
            candidates: [bytes.clone(), bytes.clone()],
        })?;
        assert_eq!(selected, RemoteEventRead::Retrieved(bytes.into()));
        Ok(())
    }

    #[wasm_bindgen_test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test callback"
        )
    )]
    fn select_matching_rejects_same_id_divergent_envelopes() -> anyhow::Result<()> {
        let EventFixture(event_id, mut event, bytes) = EventFixture::new()?;
        event.signature = Ed25519Signature::from_trusted(format!("ed25519:{}", "11".repeat(64)));
        let divergent = VaultEvent::serialize_event_storage_yaml(&event)?.into();
        let err = DriveEventStore::select_matching_drive_event_bytes(DriveEventCandidates {
            location: &nook_core::EventLogLocation::Vault(nook_core::StoreId::parse(
                "store_abcdefghijk",
            )?),
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
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test callback"
        )
    )]
    fn select_matching_ignores_a_valid_event_for_a_different_requested_id() -> anyhow::Result<()> {
        let EventFixture(event_id, _, _) = EventFixture::new()?;
        let EventFixture(other_id, _, other_bytes) = EventFixture::new()?;
        assert_ne!(event_id, other_id);
        let selected = DriveEventStore::select_matching_drive_event_bytes(DriveEventCandidates {
            location: &nook_core::EventLogLocation::Vault(nook_core::StoreId::parse(
                "store_abcdefghijk",
            )?),
            event_id: &event_id,
            candidates: [other_bytes],
        })?;
        assert_eq!(selected, RemoteEventRead::Unavailable);
        Ok(())
    }

    #[wasm_bindgen_test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test callback"
        )
    )]
    fn multipart_upload_body_preserves_parent_event_id_and_yaml() -> anyhow::Result<()> {
        let event_id = EventId::parse(&format!("sha256u:{}", "A".repeat(43)))?;
        let parent = DriveEventParent::shared_folder_id("shared-folder");
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
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test callback"
        )
    )]
    fn shared_folder_queries_scope_to_the_vault_folder() {
        let shared = DriveEventParent::shared_folder_id("owner's-folder");
        assert_eq!(
            DriveEventStore::parent_query_fragment(&shared),
            "'owner\\'s-folder' in parents"
        );
        assert_eq!(
            DriveEventStore::parent_id_for_create(&shared),
            "owner's-folder"
        );
    }

    const FIRST: &str = "ej6ZESIzRFVmd4iZqrvM3e7_ABEiM0RVZneImaq7zN0";
    const SECOND: &str = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";

    fn row(id: &str, digest: &str) -> serde_json::Value {
        serde_json::json!({
            "id": id,
            "name": format!("{digest}.yaml"),
            "appProperties": {"event_id": format!("sha256u:{digest}")},
            "createdTime": "2026-11-01T12:00:00Z",
        })
    }

    fn listed(page: DriveEventListResponse) -> anyhow::Result<Vec<String>> {
        Ok(
            DriveEventStore::listed_events_from_rows(page.files.into_rows())?
                .into_iter()
                .map(|listed| listed.event_id.to_string())
                .collect(),
        )
    }

    #[wasm_bindgen_test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test callback"
        )
    )]
    fn a_listing_admits_only_complete_rows_whose_name_and_property_agree() -> anyhow::Result<()> {
        let name = format!("{FIRST}.yaml");
        let unattested = serde_json::json!({
            "id": "plain", "name": name, "appProperties": null, "createdTime": "2026-11-01T12:00:00Z",
        });
        let wrong = serde_json::json!({
            "id": "wrong", "name": name, "appProperties": {"event_id": "wrong"},
            "createdTime": "2026-11-01T12:00:00Z",
        });
        let no_time = serde_json::json!({
            "id": "timeless", "name": name, "appProperties": {"event_id": format!("sha256u:{FIRST}")},
        });
        let page: DriveEventListResponse = serde_json::from_value(serde_json::json!({
            "files": [
                row("file-a", FIRST),
                unattested,
                wrong,
                no_time,
                {"id": "notes", "name": "notes.yaml", "createdTime": "2026-11-01T12:00:00Z"},
                {"name": 3},
                null,
            ],
            "nextPageToken": "next",
        }))?;
        assert_eq!(
            page.next_page_token,
            PageCompletion::Continue("next".to_owned())
        );
        assert_eq!(listed(page)?, [format!("sha256u:{FIRST}")]);
        Ok(())
    }

    #[wasm_bindgen_test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test callback"
        )
    )]
    fn a_last_page_may_omit_its_files_and_its_token() -> anyhow::Result<()> {
        let page: DriveEventListResponse = serde_json::from_str("{}")?;
        assert_eq!(page.next_page_token, PageCompletion::Complete);
        assert!(listed(page)?.is_empty());
        assert!(serde_json::from_str::<DriveEventListResponse>(r#"{"nextPageToken":2}"#).is_err());
        Ok(())
    }

    #[wasm_bindgen_test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test callback"
        )
    )]
    fn one_listing_names_every_file_each_event_downloads_from() -> anyhow::Result<()> {
        let page: DriveEventListResponse = serde_json::from_value(serde_json::json!({
            "files": [row("file-a", FIRST), row("file-b", SECOND), row("file-a-copy", FIRST)],
        }))?;
        let files = DriveEventStore::files_by_event(DriveEventStore::listed_events_from_rows(
            page.files.into_rows(),
        )?);
        let by_event: Vec<(String, Vec<String>)> = files
            .into_iter()
            .map(|(event_id, ids)| (event_id.to_string(), ids))
            .collect();
        assert_eq!(
            by_event,
            vec![
                (format!("sha256u:{SECOND}"), vec!["file-b".to_owned()]),
                (
                    format!("sha256u:{FIRST}"),
                    vec!["file-a".to_owned(), "file-a-copy".to_owned()]
                ),
            ]
        );
        assert!(DriveEventStore::is_sha256_base64url_digest(FIRST));
        assert!(!DriveEventStore::is_sha256_base64url_digest("short"));
        Ok(())
    }
}

#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! S3-compatible storage: the core's signed requests, sent with `reqwest`.
//!
//! nook-core addresses, signs, and classifies every request; this module only
//! sends each one exactly as built and hands the status and body back. A
//! failure keeps its category and status: never the request URL, the
//! `Authorization` header, the secret, or the response body. Requests address
//! only keys the event layout builds; a listed key is read back, never sent.

mod vault_listing;

use std::collections::BTreeSet;
use std::time::{Duration, UNIX_EPOCH};

use js_sys::Date;
use nook_core::{
    EventId, EventLogNamespaceKind, EventStorageBytes, PlacedNamespace, S3Connection,
    S3EventAddress, S3ExistingEvent, S3HttpRequest, S3IdentityFolder, S3ListObjects, S3ListPage,
    S3ListedEvent, S3ListedKey, S3ListedNamespace, S3ListingContinuation, S3ObjectRead,
    S3ObjectUpload, S3ObjectWrite, S3RequestSigner, S3Response,
};
use reqwest::{Client, Request};

use super::checked_event_write::CheckedEventWrite;
use super::event_store::EventStore;
use super::remote_event::RemoteEventRead;
use crate::NookError;

pub(crate) use vault_listing::S3VaultListing;

/// Every key and folder one listing reported, across all of its pages.
struct S3ListedObjects {
    keys: Vec<String>,
    folders: Vec<String>,
}

/// One S3 location, reached with this device's key.
#[derive(Clone, Copy)]
pub(crate) struct S3Storage<'a> {
    pub(crate) connection: &'a S3Connection,
}

impl S3Storage<'_> {
    /// Signs at the browser clock's current instant. Each request is signed
    /// when it is built, so a long listing never sends a stale signature.
    fn signer(&self) -> S3RequestSigner<'_> {
        #[expect(
            clippy::cast_possible_truncation,
            clippy::cast_sign_loss,
            reason = "Date.now() is a whole, non-negative millisecond count far below u64::MAX; \
                      `as` saturates otherwise, and the signer refuses an unsignable time"
        )]
        let milliseconds = Date::now() as u64;
        S3RequestSigner {
            connection: self.connection,
            time: UNIX_EPOCH + Duration::from_millis(milliseconds),
        }
    }

    /// Send one signed request exactly as built. The URL sets `Host`; a
    /// failed fetch, a refused CORS preflight included, is a network failure
    /// without the URL.
    async fn send(request: S3HttpRequest) -> Result<S3Response, NookError> {
        let request =
            Request::try_from(request).map_err(|error| NookError::Network(error.without_url()))?;
        let response = Client::new()
            .execute(request)
            .await
            .map_err(|error| NookError::Network(error.without_url()))?;
        let status = response.status();
        let body = response
            .bytes()
            .await
            .map_err(|error| NookError::Network(error.without_url()))?;
        Ok(S3Response { status, body })
    }

    /// Every key and folder directly below a prefix, page after page.
    async fn list(&self, prefix: String) -> Result<S3ListedObjects, NookError> {
        let mut listed = S3ListedObjects {
            keys: Vec::new(),
            folders: Vec::new(),
        };
        let mut listing = S3ListObjects {
            prefix,
            page: S3ListPage::First,
        };
        loop {
            let answer = Self::send(self.signer().list_objects(&listing)?)
                .await?
                .into_listing()?;
            listed.keys.extend(answer.keys);
            listed.folders.extend(answer.folders);
            match answer.continuation {
                S3ListingContinuation::Complete => return Ok(listed),
                S3ListingContinuation::Continues(token) => listing.page = S3ListPage::After(token),
            }
        }
    }

    /// Every namespace of one kind at this location, each in the identity
    /// folder that files it; unrelated folders are ignored.
    pub(crate) async fn namespaces(
        &self,
        kind: EventLogNamespaceKind,
    ) -> Result<Vec<PlacedNamespace>, NookError> {
        let connection = self.connection;
        let identity_folders = self.list(connection.identity_folders_listing()).await?;
        let mut placed = Vec::new();
        for folder in &identity_folders.folders {
            let S3IdentityFolder::Identity(identity) = connection.listed_identity_folder(folder)
            else {
                continue;
            };
            let namespaces = self
                .list(connection.identity_namespaces_listing(&identity))
                .await?;
            placed.extend(
                namespaces
                    .folders
                    .iter()
                    .filter_map(|folder| match connection.listed_namespace(folder) {
                        S3ListedNamespace::Namespace(namespace) => Some(namespace),
                        S3ListedNamespace::Unrelated => None,
                    })
                    .filter(|namespace| namespace.location().kind() == kind),
            );
        }
        Ok(placed)
    }
}

/// One namespace's events at an S3 location.
#[derive(Clone, Copy)]
pub(crate) struct S3EventStore<'a> {
    pub(crate) storage: S3Storage<'a>,
    pub(crate) placed: &'a PlacedNamespace,
}

impl EventStore for S3EventStore<'_> {
    /// The events the namespace holds, read from the event keys directly in
    /// its `events/` folder.
    async fn event_ids(&self) -> Result<BTreeSet<EventId>, NookError> {
        let connection = self.storage.connection;
        let listed = self
            .storage
            .list(connection.namespace_listing(self.placed))
            .await?;
        Ok(listed
            .keys
            .iter()
            .filter_map(|key| {
                match connection.listed_event(S3ListedKey {
                    placed: self.placed,
                    key,
                }) {
                    S3ListedEvent::Event(event_id) => Some(event_id),
                    S3ListedEvent::Unrelated => None,
                }
            })
            .collect())
    }

    /// One event's stored bytes, or that the namespace does not hold it.
    async fn read(&self, event_id: &EventId) -> Result<RemoteEventRead, NookError> {
        let request = self.storage.signer().get_object(S3EventAddress {
            placed: self.placed,
            event_id,
        })?;
        Ok(match S3Storage::send(request).await?.into_object_read()? {
            S3ObjectRead::Found(bytes) => RemoteEventRead::Retrieved(bytes),
            S3ObjectRead::Absent => RemoteEventRead::Unavailable,
        })
    }

    /// Create one event object. A key already taken is read back: the same
    /// bytes mean the event is stored, any other bytes fail the write.
    async fn put_checked(&self, checked: CheckedEventWrite<'_>) -> Result<(), NookError> {
        let event_id = checked.event_id();
        let event = S3EventAddress {
            placed: self.placed,
            event_id,
        };
        let requested = EventStorageBytes::from(checked.bytes().to_vec());
        let request = self.storage.signer().put_object_if_absent(S3ObjectUpload {
            event,
            body: &requested,
        })?;
        match S3Storage::send(request).await?.into_object_write()? {
            S3ObjectWrite::Created => Ok(()),
            S3ObjectWrite::AlreadyExists => {
                let stored = S3Storage::send(self.storage.signer().get_object(event)?)
                    .await?
                    .into_object_read()?;
                Ok(S3ExistingEvent {
                    event_id,
                    requested: &requested,
                }
                .settle(stored)?)
            }
        }
    }

    /// Delete every event the namespace holds. An object already gone is
    /// deleted as well.
    async fn delete_events(&self) -> Result<(), NookError> {
        for event_id in self.event_ids().await? {
            let request = self.storage.signer().delete_object(S3EventAddress {
                placed: self.placed,
                event_id: &event_id,
            })?;
            S3Storage::send(request).await?.into_object_deletion()?;
        }
        Ok(())
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use super::{S3EventStore, S3Storage};
    use crate::NookError;
    use crate::storage::checked_event_write::tests::EventFixture;
    use crate::storage::event_store::EventStore;
    use crate::storage::fetch_stub::{FetchRoute, FetchStub};
    use crate::storage::remote_event::RemoteEventRead;
    use crate::test_fixtures::WasmFixture;
    use nook_core::{
        EventLogNamespaceKind, IdentityId, PlacedNamespace, S3Connection, S3RequestFailure, StoreId,
    };
    use std::str;
    use wasm_bindgen_test::{wasm_bindgen_test, wasm_bindgen_test_configure};

    wasm_bindgen_test_configure!(run_in_browser);

    /// The digest of an event the listing names but no object holds.
    const DIGEST: &str = "ej6ZESIzRFVmd4iZqrvM3e7_ABEiM0RVZneImaq7zN0";
    const EVENTS: &str = "/nook-dev/e2e/meta-secret-nook/idn_abcdefghijk/store_testtoken11/events";
    const KEYS: &str = "e2e/meta-secret-nook/idn_abcdefghijk/store_testtoken11/events";

    struct Fixture {
        connection: S3Connection,
        vault: PlacedNamespace,
        event: EventFixture,
    }

    impl Fixture {
        fn new() -> anyhow::Result<Self> {
            Ok(Self {
                connection: WasmFixture::s3_connection()?,
                vault: PlacedNamespace::vault(
                    IdentityId::parse("idn_abcdefghijk")?,
                    StoreId::parse("store_testtoken11")?,
                ),
                event: EventFixture::new()?,
            })
        }

        fn digest(&self) -> &str {
            self.event.event_id.encoded_digest()
        }

        fn body(&self) -> anyhow::Result<&str> {
            Ok(str::from_utf8(&self.event.bytes)?)
        }

        fn store(&self) -> S3EventStore<'_> {
            S3EventStore {
                storage: S3Storage {
                    connection: &self.connection,
                },
                placed: &self.vault,
            }
        }
    }

    /// An S3 answer: a status and an XML or event body.
    fn answer(method: &'static str, url_contains: &str, status: u16, body: &str) -> FetchRoute {
        FetchRoute {
            method,
            url_contains: url_contains.to_owned(),
            status,
            body: body.to_owned(),
        }
    }

    fn listing(keys: &[String]) -> String {
        let contents = keys.iter().fold(String::new(), |contents, key| {
            contents + "<Contents><Key>" + key + "</Key></Contents>"
        });
        format!("<ListBucketResult><IsTruncated>false</IsTruncated>{contents}</ListBucketResult>")
    }

    #[wasm_bindgen_test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    async fn an_s3_namespace_lists_reads_and_settles_its_event_objects() -> anyhow::Result<()> {
        let fixture = Fixture::new()?;
        let digest = fixture.digest();
        let key = format!("{KEYS}/{digest}.yaml");
        let stub = FetchStub::install(vec![
            answer(
                "GET",
                "list-type=2",
                200,
                &listing(&[
                    key.clone(),
                    format!("{key}.tmp"),
                    "e2e/notes.txt".to_owned(),
                ]),
            ),
            answer(
                "GET",
                &format!("{EVENTS}/{digest}.yaml"),
                200,
                fixture.body()?,
            ),
            answer(
                "PUT",
                &format!("{EVENTS}/{digest}.yaml"),
                412,
                "<Error><Code>PreconditionFailed</Code></Error>",
            ),
            answer(
                "GET",
                &format!("{EVENTS}/{digest}.yaml"),
                200,
                fixture.body()?,
            ),
        ])
        .map_err(|error| anyhow::anyhow!("{error}"))?;
        let store = fixture.store();
        let ids = store
            .event_ids()
            .await
            .map_err(|error| anyhow::anyhow!("{error}"))?;
        assert_eq!(
            ids.into_iter().collect::<Vec<_>>(),
            vec![fixture.event.event_id.clone()]
        );
        assert_eq!(
            store
                .read(&fixture.event.event_id)
                .await
                .map_err(|error| anyhow::anyhow!("{error}"))?,
            RemoteEventRead::Retrieved(fixture.event.bytes.clone().into())
        );
        // A taken key holding the same bytes is the event already stored.
        store
            .put_checked(fixture.event.checked(fixture.vault.location())?)
            .await
            .map_err(|error| anyhow::anyhow!("{error}"))?;
        let calls = stub.calls();
        assert_eq!(calls.len(), 4, "{calls:?}");
        for call in &calls {
            assert!(!call.contains("TEST-ONLY"), "{call}");
        }
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
    async fn a_refused_key_and_diverged_bytes_fail_without_the_request() -> anyhow::Result<()> {
        let fixture = Fixture::new()?;
        let digest = fixture.digest();
        let _stub = FetchStub::install(vec![
            answer(
                "GET",
                "list-type=2",
                403,
                "<Error><Code>AccessDenied</Code></Error>",
            ),
            answer("PUT", &format!("{EVENTS}/{digest}.yaml"), 412, ""),
            answer(
                "GET",
                &format!("{EVENTS}/{digest}.yaml"),
                200,
                "event: other\n",
            ),
            answer(
                "GET",
                &format!("{EVENTS}/{digest}.yaml"),
                404,
                "<Error><Code>NoSuchKey</Code></Error>",
            ),
        ])
        .map_err(|error| anyhow::anyhow!("{error}"))?;
        let store = fixture.store();
        let refused = store.event_ids().await;
        assert!(
            matches!(
                refused,
                Err(NookError::S3Request(S3RequestFailure::KeyAccessDenied))
            ),
            "{refused:?}"
        );
        let diverged = store
            .put_checked(fixture.event.checked(fixture.vault.location())?)
            .await;
        assert!(
            matches!(
                diverged,
                Err(NookError::S3Request(
                    S3RequestFailure::EventContentDiverged { .. }
                ))
            ),
            "{diverged:?}"
        );
        assert_eq!(
            store
                .read(&fixture.event.event_id)
                .await
                .map_err(|error| anyhow::anyhow!("{error}"))?,
            RemoteEventRead::Unavailable
        );
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
    async fn every_listed_event_is_read_and_a_vanished_one_left_out() -> anyhow::Result<()> {
        let fixture = Fixture::new()?;
        let digest = fixture.digest();
        let stub = FetchStub::install(vec![
            answer(
                "GET",
                "list-type=2",
                200,
                &listing(&[
                    format!("{KEYS}/{digest}.yaml"),
                    format!("{KEYS}/{DIGEST}.yaml"),
                ]),
            ),
            answer(
                "GET",
                &format!("{EVENTS}/{digest}.yaml"),
                200,
                fixture.body()?,
            ),
            answer(
                "GET",
                &format!("{EVENTS}/{DIGEST}.yaml"),
                404,
                "<Error><Code>NoSuchKey</Code></Error>",
            ),
        ])
        .map_err(|error| anyhow::anyhow!("{error}"))?;
        let events = fixture
            .store()
            .events()
            .await
            .map_err(|error| anyhow::anyhow!("{error}"))?;
        assert_eq!(events.len(), 1);
        assert!(
            events
                .iter()
                .all(|event| event.event_id == fixture.event.event_id)
        );
        assert_eq!(stub.calls().len(), 3);
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
    async fn deleting_a_namespace_deletes_only_its_event_objects() -> anyhow::Result<()> {
        let fixture = Fixture::new()?;
        let digest = fixture.digest();
        let key = format!("{KEYS}/{digest}.yaml");
        let stub = FetchStub::install(vec![
            answer(
                "GET",
                "list-type=2",
                200,
                &listing(&[key.clone(), format!("{KEYS}/../x.yaml")]),
            ),
            answer("DELETE", &format!("{EVENTS}/{digest}.yaml"), 204, ""),
        ])
        .map_err(|error| anyhow::anyhow!("{error}"))?;
        fixture
            .store()
            .delete_events()
            .await
            .map_err(|error| anyhow::anyhow!("{error}"))?;
        // The listed `..` key is never echoed into a request.
        let calls = stub.calls();
        assert_eq!(
            calls
                .iter()
                .filter(|call| call.starts_with("DELETE "))
                .count(),
            1,
            "{calls:?}"
        );
        assert!(calls.iter().all(|call| !call.contains("..")), "{calls:?}");
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
    async fn namespaces_are_read_from_identity_folders_and_unrelated_folders_ignored()
    -> anyhow::Result<()> {
        let fixture = Fixture::new()?;
        let _stub = FetchStub::install(vec![
            answer(
                "GET",
                "prefix=e2e%2Fmeta-secret-nook%2F",
                200,
                "<ListBucketResult><IsTruncated>false</IsTruncated>\
                 <CommonPrefixes><Prefix>e2e/meta-secret-nook/idn_abcdefghijk/</Prefix></CommonPrefixes>\
                 <CommonPrefixes><Prefix>e2e/meta-secret-nook/backups/</Prefix></CommonPrefixes>\
                 </ListBucketResult>",
            ),
            answer(
                "GET",
                "prefix=e2e%2Fmeta-secret-nook%2Fidn_abcdefghijk%2F",
                200,
                "<ListBucketResult><IsTruncated>false</IsTruncated>\
                 <CommonPrefixes><Prefix>e2e/meta-secret-nook/idn_abcdefghijk/log/</Prefix></CommonPrefixes>\
                 <CommonPrefixes><Prefix>e2e/meta-secret-nook/idn_abcdefghijk/store_abcdefghijk/</Prefix></CommonPrefixes>\
                 <CommonPrefixes><Prefix>e2e/meta-secret-nook/idn_abcdefghijk/archive/</Prefix></CommonPrefixes>\
                 </ListBucketResult>",
            ),
        ])
        .map_err(|error| anyhow::anyhow!("{error}"))?;
        let vaults = S3Storage {
            connection: &fixture.connection,
        }
        .namespaces(EventLogNamespaceKind::Vault)
        .await
        .map_err(|error| anyhow::anyhow!("{error}"))?;
        assert_eq!(
            vaults,
            vec![PlacedNamespace::vault(
                IdentityId::parse("idn_abcdefghijk")?,
                StoreId::parse("store_abcdefghijk")?,
            )]
        );
        Ok(())
    }
}

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

use js_sys::Date;
use nook_core::{
    EventId, EventLogNamespaceKind, EventStorageBytes, PlacedNamespace, S3CommonPrefix,
    S3Connection, S3EventAddress, S3ExistingEvent, S3HttpMethod, S3HttpRequest, S3HttpStatus,
    S3IdentityFolder, S3ListDepth, S3ListObjects, S3ListPage, S3ListPageSize, S3ListPrefix,
    S3ListedEvent, S3ListedKey, S3ListedNamespace, S3ListedObjectKey, S3ListingContinuation,
    S3ObjectDeletion, S3ObjectKey, S3ObjectRead, S3ObjectUpload, S3ObjectWrite, S3RequestBody,
    S3RequestSigner, S3RequestTime, S3Response, S3ResponseBody, S3UnixSeconds,
};
use reqwest::{Client, Method, RequestBuilder};

use super::remote_event::RemoteEventRead;
use crate::NookError;

pub(crate) use vault_listing::S3VaultListing;

/// Every key and folder one listing reported, across all of its pages.
struct S3ListedObjects {
    keys: Vec<S3ListedObjectKey>,
    folders: Vec<S3CommonPrefix>,
}

/// One S3 location, reached with this device's key.
#[derive(Clone, Copy)]
pub(crate) struct S3Storage<'a> {
    pub(crate) connection: &'a S3Connection,
}

impl S3Storage<'_> {
    /// The browser clock in whole seconds. Each request is signed when it is
    /// built, so a long listing never sends a stale signature.
    fn request_time() -> Result<S3RequestTime, NookError> {
        #[expect(
            clippy::cast_possible_truncation,
            clippy::cast_sign_loss,
            reason = "Date.now() is a whole, non-negative millisecond count far below u64::MAX; \
                      `as` saturates otherwise, and the signer refuses an unsignable time"
        )]
        let seconds = (Date::now() / 1000.0) as u64;
        Ok(S3RequestTime::try_from(S3UnixSeconds::from(seconds))?)
    }

    fn signer(&self) -> Result<S3RequestSigner<'_>, NookError> {
        Ok(S3RequestSigner {
            connection: self.connection,
            time: Self::request_time()?,
        })
    }

    /// Send one signed request exactly as built. The URL sets `Host`; a
    /// failed fetch, a refused CORS preflight included, is a network failure
    /// without the URL.
    async fn send(request: S3HttpRequest) -> Result<S3Response, NookError> {
        let method = match request.method {
            S3HttpMethod::Get => Method::GET,
            S3HttpMethod::Put => Method::PUT,
            S3HttpMethod::Delete => Method::DELETE,
        };
        let builder = request.headers.iter().fold(
            Client::new().request(method, request.url.as_str()),
            |builder: RequestBuilder, header| builder.header(header.name.as_str(), header.value()),
        );
        let builder = match request.body {
            S3RequestBody::Empty => builder,
            S3RequestBody::Event(bytes) => builder.body(Vec::<u8>::from(bytes)),
        };
        let response = builder
            .send()
            .await
            .map_err(|error| NookError::Network(error.without_url()))?;
        let status = S3HttpStatus::from(response.status().as_u16());
        let body = response
            .bytes()
            .await
            .map_err(|error| NookError::Network(error.without_url()))?;
        Ok(S3Response {
            status,
            body: S3ResponseBody::from(body.to_vec()),
        })
    }

    /// The first page of one listing.
    fn listing(prefix: S3ListPrefix) -> S3ListObjects {
        S3ListObjects {
            prefix,
            depth: S3ListDepth::DirectChildren,
            page: S3ListPage::First,
            page_size: S3ListPageSize::MAXIMUM,
        }
    }

    /// Every key and folder directly below a prefix, page after page.
    async fn list(&self, prefix: S3ListPrefix) -> Result<S3ListedObjects, NookError> {
        let mut listed = S3ListedObjects {
            keys: Vec::new(),
            folders: Vec::new(),
        };
        let mut page = Self::listing(prefix);
        loop {
            let answer = Self::send(self.signer()?.list_objects(&page)?)
                .await?
                .into_listing()?;
            listed.keys.extend(answer.keys);
            listed.folders.extend(answer.folders);
            match answer.continuation {
                S3ListingContinuation::Complete => return Ok(listed),
                S3ListingContinuation::Continues(token) => page = page.next_page(token),
            }
        }
    }

    /// Every namespace of one kind at this location, each in the identity
    /// folder that files it; unrelated folders are ignored.
    pub(crate) async fn namespaces(
        &self,
        kind: EventLogNamespaceKind,
    ) -> Result<Vec<PlacedNamespace>, NookError> {
        let prefix = &self.connection.location.key_prefix;
        let identity_folders = self.list(prefix.identity_folders_listing()).await?;
        let mut placed = Vec::new();
        for folder in &identity_folders.folders {
            let S3IdentityFolder::Identity(identity) = prefix.listed_identity_folder(folder) else {
                continue;
            };
            let namespaces = self
                .list(prefix.identity_namespaces_listing(&identity))
                .await?;
            placed.extend(
                namespaces
                    .folders
                    .iter()
                    .filter_map(|folder| match prefix.listed_namespace(folder) {
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

impl S3EventStore<'_> {
    fn key(&self, event_id: &EventId) -> S3ObjectKey {
        self.storage
            .connection
            .location
            .key_prefix
            .event_key(S3EventAddress {
                placed: self.placed,
                event_id,
            })
    }

    /// The events the namespace holds, read from the event keys directly in
    /// its `events/` folder.
    pub(crate) async fn event_ids(&self) -> Result<BTreeSet<EventId>, NookError> {
        let prefix = &self.storage.connection.location.key_prefix;
        let listed = self
            .storage
            .list(prefix.namespace_listing(self.placed))
            .await?;
        Ok(listed
            .keys
            .iter()
            .filter_map(|key| {
                match prefix.listed_event(S3ListedKey {
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
    pub(crate) async fn read(&self, event_id: &EventId) -> Result<RemoteEventRead, NookError> {
        let request = self.storage.signer()?.get_object(&self.key(event_id))?;
        Ok(match S3Storage::send(request).await?.into_object_read()? {
            S3ObjectRead::Found(bytes) => RemoteEventRead::Retrieved(bytes),
            S3ObjectRead::Absent => RemoteEventRead::Unavailable,
        })
    }

    /// Create one event object. A key already taken is read back: the same
    /// bytes mean the event is stored, any other bytes fail the write.
    pub(crate) async fn put_if_absent(
        &self,
        event_id: &EventId,
        bytes: &[u8],
    ) -> Result<(), NookError> {
        let key = self.key(event_id);
        let requested = EventStorageBytes::from(bytes.to_vec());
        let request = self
            .storage
            .signer()?
            .put_object_if_absent(S3ObjectUpload {
                key: &key,
                body: &requested,
            })?;
        match S3Storage::send(request).await?.into_object_write()? {
            S3ObjectWrite::Created => Ok(()),
            S3ObjectWrite::AlreadyExists => {
                let stored = S3Storage::send(self.storage.signer()?.get_object(&key)?)
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

    /// Delete every event the namespace holds; returns how many went.
    pub(crate) async fn delete_events(&self) -> Result<usize, NookError> {
        let mut outcomes = Vec::new();
        for event_id in self.event_ids().await? {
            let request = self.storage.signer()?.delete_object(&self.key(&event_id))?;
            outcomes.push(S3Storage::send(request).await?.into_object_deletion()?);
        }
        Ok(outcomes
            .iter()
            .filter(|outcome| **outcome == S3ObjectDeletion::Deleted)
            .count())
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use super::{S3EventStore, S3Storage};
    use crate::NookError;
    use crate::storage::fetch_stub::{FetchRoute, FetchStub};
    use crate::storage::remote_event::RemoteEventRead;
    use nook_core::{
        EventId, EventLogNamespaceKind, IdentityId, PlacedNamespace, S3AccessKeyId, S3BucketName,
        S3Connection, S3Credentials, S3Endpoint, S3KeyPrefix, S3Location, S3Region,
        S3RequestFailure, S3SecretAccessKey, StoreId,
    };
    use wasm_bindgen_test::{wasm_bindgen_test, wasm_bindgen_test_configure};

    wasm_bindgen_test_configure!(run_in_browser);

    const DIGEST: &str = "ej6ZESIzRFVmd4iZqrvM3e7_ABEiM0RVZneImaq7zN0";
    const EVENTS: &str = "/nook-dev/e2e/meta-secret-nook/idn_abcdefghijk/store_abcdefghijk/events";

    struct Fixture {
        connection: S3Connection,
        vault: PlacedNamespace,
        event_id: EventId,
    }

    impl Fixture {
        fn new() -> anyhow::Result<Self> {
            Ok(Self {
                connection: S3Connection {
                    location: S3Location {
                        endpoint: S3Endpoint::parse("http://127.0.0.1:8333")?,
                        region: S3Region::parse("us-east-1")?,
                        bucket: S3BucketName::parse("nook-dev")?,
                        key_prefix: S3KeyPrefix::parse("e2e")?,
                    },
                    credentials: S3Credentials {
                        access_key_id: S3AccessKeyId::parse("device-a")?,
                        secret_access_key: S3SecretAccessKey::parse(
                            "TEST-ONLY-device-a-secret-not-real",
                        )?,
                    },
                },
                vault: PlacedNamespace::vault(
                    IdentityId::parse("idn_abcdefghijk")?,
                    StoreId::parse("store_abcdefghijk")?,
                ),
                event_id: EventId::parse(&format!("sha256u:{DIGEST}"))?,
            })
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
        let key =
            format!("e2e/meta-secret-nook/idn_abcdefghijk/store_abcdefghijk/events/{DIGEST}.yaml");
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
                &format!("{EVENTS}/{DIGEST}.yaml"),
                200,
                "event: first\n",
            ),
            answer(
                "PUT",
                &format!("{EVENTS}/{DIGEST}.yaml"),
                412,
                "<Error><Code>PreconditionFailed</Code></Error>",
            ),
            answer(
                "GET",
                &format!("{EVENTS}/{DIGEST}.yaml"),
                200,
                "event: first\n",
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
            vec![fixture.event_id.clone()]
        );
        assert_eq!(
            store
                .read(&fixture.event_id)
                .await
                .map_err(|error| anyhow::anyhow!("{error}"))?,
            RemoteEventRead::Retrieved(b"event: first\n".to_vec().into())
        );
        // A taken key holding the same bytes is the event already stored.
        store
            .put_if_absent(&fixture.event_id, b"event: first\n")
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
        let _stub = FetchStub::install(vec![
            answer(
                "GET",
                "list-type=2",
                403,
                "<Error><Code>AccessDenied</Code></Error>",
            ),
            answer("PUT", &format!("{EVENTS}/{DIGEST}.yaml"), 412, ""),
            answer(
                "GET",
                &format!("{EVENTS}/{DIGEST}.yaml"),
                200,
                "event: other\n",
            ),
            answer(
                "GET",
                &format!("{EVENTS}/{DIGEST}.yaml"),
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
            .put_if_absent(&fixture.event_id, b"event: first\n")
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
                .read(&fixture.event_id)
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
    async fn deleting_a_namespace_deletes_only_its_event_objects() -> anyhow::Result<()> {
        let fixture = Fixture::new()?;
        let key =
            format!("e2e/meta-secret-nook/idn_abcdefghijk/store_abcdefghijk/events/{DIGEST}.yaml");
        let stub = FetchStub::install(vec![
            answer(
                "GET",
                "list-type=2",
                200,
                &listing(&[
                    key.clone(),
                    "e2e/meta-secret-nook/idn_abcdefghijk/store_abcdefghijk/events/../x.yaml"
                        .to_owned(),
                ]),
            ),
            answer("DELETE", &format!("{EVENTS}/{DIGEST}.yaml"), 204, ""),
        ])
        .map_err(|error| anyhow::anyhow!("{error}"))?;
        let deleted = fixture
            .store()
            .delete_events()
            .await
            .map_err(|error| anyhow::anyhow!("{error}"))?;
        assert_eq!(deleted, 1);
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
        assert_eq!(vaults, vec![fixture.vault.clone()]);
        Ok(())
    }
}

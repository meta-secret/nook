#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! An S3 location as the provider vault listing reads it: the setup and
//! recovery listings, Check access, and identity joins read it the way they
//! read a Google Drive account or a local folder.
//!
//! S3 reports how many event objects a namespace holds, not when they were
//! made, so each vault is observed by its event count. S3 has no folders of
//! its own: an identity's log is at the location only while it holds an
//! event. Nothing is decrypted.

use nook_core::{
    EventLogNamespaceKind, IdentityId, LocalEventWrite, PlacedNamespace, ProviderVaultObservation,
    StoreId,
};

use super::{S3EventStore, S3Storage};
use crate::NookError;
use crate::storage::provider_vault_listing::{
    CountedVaultNamespace, NamespaceWrite, ProviderLocation,
};
use std::future::{self, Future};

use crate::storage::event_store::EventStore;

/// The namespaces at one S3 location.
#[derive(Clone, Copy)]
pub(crate) struct S3VaultListing<'a> {
    pub(crate) storage: S3Storage<'a>,
}

impl ProviderLocation for S3VaultListing<'_> {
    type Namespace = PlacedNamespace;
    const PROVIDER: &'static str = "S3";

    async fn namespaces(
        &self,
        kind: EventLogNamespaceKind,
    ) -> Result<Vec<PlacedNamespace>, NookError> {
        self.storage.namespaces(kind).await
    }

    fn placed(namespace: &PlacedNamespace) -> &PlacedNamespace {
        namespace
    }

    /// A vault, by how many event objects it holds.
    async fn observation(
        &self,
        store_id: StoreId,
        vault: PlacedNamespace,
    ) -> Result<ProviderVaultObservation, NookError> {
        let event_count = S3EventStore {
            storage: self.storage,
            placed: &vault,
        }
        .event_ids()
        .await?
        .len();
        Ok(CountedVaultNamespace {
            store_id,
            identity: vault.identity().clone(),
            event_count,
        }
        .observation())
    }

    async fn events(&self, placed: &PlacedNamespace) -> Result<Vec<LocalEventWrite>, NookError> {
        S3EventStore {
            storage: self.storage,
            placed,
        }
        .events()
        .await
    }

    /// The identity's log, named by its path with no request: a log the
    /// location does not hold reads as empty, and core refuses an empty log
    /// before any flow writes into it.
    fn identity_log(
        &self,
        identity_id: &IdentityId,
    ) -> impl Future<Output = Result<PlacedNamespace, NookError>> {
        future::ready(Ok(PlacedNamespace::identity_log(identity_id.clone())))
    }

    async fn put_event(&self, write: NamespaceWrite<'_, PlacedNamespace>) -> Result<(), NookError> {
        S3EventStore {
            storage: self.storage,
            placed: write.namespace,
        }
        .put_checked(write.event)
        .await
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use std::slice;

    use super::{ProviderLocation, S3VaultListing};
    use crate::storage::fetch_stub::{FetchRoute, FetchStub};
    use crate::storage::s3::S3Storage;
    use crate::test_fixtures::WasmFixture;
    use nook_core::{EventId, IdentityId, StoreId};
    use wasm_bindgen_test::{wasm_bindgen_test, wasm_bindgen_test_configure};

    wasm_bindgen_test_configure!(run_in_browser);

    const DIGEST: &str = "ej6ZESIzRFVmd4iZqrvM3e7_ABEiM0RVZneImaq7zN0";
    const ROOT: &str = "e2e/meta-secret-nook";
    /// The query value of a listing prefix below the root.
    const ROOT_QUERY: &str = "prefix=e2e%2Fmeta-secret-nook%2F";

    /// A listing page with these keys and folders.
    fn page(keys: &[String], folders: &[String]) -> String {
        let keys = keys.iter().fold(String::new(), |page, key| {
            page + "<Contents><Key>" + key + "</Key></Contents>"
        });
        let folders = folders.iter().fold(String::new(), |page, folder| {
            page + "<CommonPrefixes><Prefix>" + folder + "</Prefix></CommonPrefixes>"
        });
        format!(
            "<ListBucketResult><IsTruncated>false</IsTruncated>{keys}{folders}</ListBucketResult>"
        )
    }

    fn listed(url_contains: &str, body: String) -> FetchRoute {
        FetchRoute {
            method: "GET",
            url_contains: url_contains.to_owned(),
            status: 200,
            body,
        }
    }

    /// A listing that lists the given identities' folders.
    fn identity_folders(identities: &[&str]) -> FetchRoute {
        let folders = identities
            .iter()
            .map(|identity| format!("{ROOT}/{identity}/"))
            .collect::<Vec<_>>();
        // Every later listing URL contains this prefix too; routes are taken
        // in order, so this one answers the first request, the root listing.
        listed(ROOT_QUERY, page(&[], &folders))
    }

    #[wasm_bindgen_test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    async fn an_identity_log_is_listed_once_per_read_and_an_absent_one_is_empty()
    -> anyhow::Result<()> {
        let connection = WasmFixture::s3_connection()?;
        let location = S3VaultListing {
            storage: S3Storage {
                connection: &connection,
            },
        };
        let held = IdentityId::parse("idn_abcdefghijk")?;
        let key = format!("{ROOT}/idn_abcdefghijk/log/events/{DIGEST}.yaml");
        // Each read lists the log once; nothing lists it first to find it.
        let stub = FetchStub::install(vec![
            listed("idn_strangerabc%2Flog%2Fevents%2F", page(&[], &[])),
            listed("idn_abcdefghijk%2Flog%2Fevents%2F", page(&[key], &[])),
            FetchRoute::ok(
                "GET",
                &format!("/log/events/{DIGEST}.yaml"),
                "kind: genesis\n",
            ),
        ])
        .map_err(|error| anyhow::anyhow!("{error}"))?;
        let stranger = IdentityId::parse("idn_strangerabc")?;
        // A log the location does not hold reads as empty; core refuses an
        // empty log before any flow writes into it.
        assert!(
            location
                .identity_events(&stranger)
                .await
                .map_err(|error| anyhow::anyhow!("{error}"))?
                .is_empty()
        );
        let event_id = EventId::parse(&format!("sha256u:{DIGEST}"))?;
        // A malformed event is refused before any request.
        assert!(
            location
                .put_identity_event(&stranger, &event_id, b"kind: join\n")
                .await
                .is_err()
        );
        let events = location
            .identity_events(&held)
            .await
            .map_err(|error| anyhow::anyhow!("{error}"))?;
        assert_eq!(events.len(), 1);
        let calls = stub.calls();
        assert_eq!(calls.len(), 3, "{calls:?}");
        assert!(
            calls.iter().all(|call| !call.starts_with("PUT ")),
            "{calls:?}"
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
    async fn each_vault_is_observed_by_its_event_count() -> anyhow::Result<()> {
        let connection = WasmFixture::s3_connection()?;
        let store_id = StoreId::parse("store_abcdefghijk")?;
        let vault = format!("{ROOT}/idn_abcdefghijk/store_abcdefghijk/");
        let _stub = FetchStub::install(vec![
            identity_folders(&["idn_abcdefghijk"]),
            listed("idn_abcdefghijk%2F", page(&[], slice::from_ref(&vault))),
            listed(
                "store_abcdefghijk%2Fevents%2F",
                page(
                    &[
                        format!("{vault}events/{DIGEST}.yaml"),
                        format!("{vault}events/{}.yaml", "A".repeat(43)),
                        format!("{vault}events/notes.txt"),
                    ],
                    &[],
                ),
            ),
        ])
        .map_err(|error| anyhow::anyhow!("{error}"))?;
        let observations = S3VaultListing {
            storage: S3Storage {
                connection: &connection,
            },
        }
        .observations()
        .await
        .map_err(|error| anyhow::anyhow!("{error}"))?;
        let [observation] = observations.as_slice() else {
            anyhow::bail!("one vault is listed: {observations:?}");
        };
        assert_eq!(observation.store_id, store_id);
        assert_eq!(observation.identity, IdentityId::parse("idn_abcdefghijk")?);
        assert_eq!(observation.events.len(), 2);
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
    async fn a_vault_filed_under_two_identities_fails_closed() -> anyhow::Result<()> {
        let connection = WasmFixture::s3_connection()?;
        let _stub = FetchStub::install(vec![
            identity_folders(&["idn_abcdefghijk", "idn_strangerabc"]),
            listed(
                "idn_abcdefghijk%2F",
                page(&[], &[format!("{ROOT}/idn_abcdefghijk/store_abcdefghijk/")]),
            ),
            listed(
                "idn_strangerabc%2F",
                page(&[], &[format!("{ROOT}/idn_strangerabc/store_abcdefghijk/")]),
            ),
        ])
        .map_err(|error| anyhow::anyhow!("{error}"))?;
        let observed = S3VaultListing {
            storage: S3Storage {
                connection: &connection,
            },
        }
        .observations()
        .await;
        assert!(observed.is_err(), "{observed:?}");
        Ok(())
    }
}

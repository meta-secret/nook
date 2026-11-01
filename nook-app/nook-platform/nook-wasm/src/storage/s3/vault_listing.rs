#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! What an S3 location holds, read before or without connecting to it: the
//! setup and recovery listings, Check access, and identity joins read it the
//! way they read a Google Drive account or a local folder.
//!
//! S3 reports how many event objects a namespace holds, not when they were
//! made, so each vault is observed by its event count. Nothing is decrypted.

use nook_core::{
    CheckedVaultEvents, EventId, EventLogLocation, EventLogNamespaceKind, EventStorageBytes,
    IdentityId, ListedIdentityLog, LocalEventWrite, PlacedNamespace, ProviderIdentityLogEvents,
    ProviderVaultObservation, VaultPlacement,
};

use super::{S3EventStore, S3Storage};
use crate::NookError;
use crate::storage::provider_vault_listing::{
    BrowserHeldVaults, CountedVaultNamespace, InspectedVaults,
};
use crate::storage::remote_event::RemoteEventRead;

/// The namespaces at one S3 location.
#[derive(Clone, Copy)]
pub(crate) struct S3VaultListing<'a> {
    pub(crate) storage: S3Storage<'a>,
}

impl S3VaultListing<'_> {
    /// Every event one namespace holds, read and not yet verified.
    async fn namespace_events(
        &self,
        placed: &PlacedNamespace,
    ) -> Result<Vec<LocalEventWrite>, NookError> {
        let store = S3EventStore {
            storage: self.storage,
            placed,
        };
        let mut events = Vec::new();
        for event_id in store.event_ids().await? {
            if let RemoteEventRead::Retrieved(bytes) = store.read(&event_id).await? {
                events.push(LocalEventWrite { event_id, bytes });
            }
        }
        Ok(events)
    }

    /// One observation per vault namespace. A vault filed under two
    /// identities fails closed, as sync does.
    pub(crate) async fn observations(&self) -> Result<Vec<ProviderVaultObservation>, NookError> {
        let vaults = self
            .storage
            .namespaces(EventLogNamespaceKind::Vault)
            .await?;
        let mut observations = Vec::new();
        for listed in &vaults {
            let EventLogLocation::Vault(store_id) = listed.location() else {
                continue;
            };
            let VaultPlacement::Filed(placed) = VaultPlacement::of(store_id, vaults.clone())?
            else {
                continue;
            };
            let event_count = S3EventStore {
                storage: self.storage,
                placed: &placed,
            }
            .event_ids()
            .await?
            .len();
            observations.push(
                CountedVaultNamespace {
                    store_id: store_id.clone(),
                    identity: placed.identity().clone(),
                    event_count,
                }
                .observation(),
            );
        }
        Ok(observations)
    }

    /// The raw control log of every identity folder at the location.
    pub(crate) async fn identity_log_events(
        &self,
    ) -> Result<Vec<ProviderIdentityLogEvents>, NookError> {
        let mut logs = Vec::new();
        for placed in self
            .storage
            .namespaces(EventLogNamespaceKind::Identity)
            .await?
        {
            logs.push(ProviderIdentityLogEvents {
                identity_id: placed.identity().clone(),
                events: self
                    .namespace_events(&placed)
                    .await?
                    .into_iter()
                    .map(|event| event.bytes)
                    .collect(),
            });
        }
        Ok(logs)
    }

    /// Every identity log at the location, read and verified against the
    /// key this browser lists with.
    pub(crate) async fn identity_logs(
        &self,
        held: &BrowserHeldVaults,
    ) -> Result<Vec<ListedIdentityLog>, NookError> {
        self.identity_log_events()
            .await?
            .into_iter()
            .map(|events| Ok(events.read(held.listing_key.as_ref())?))
            .collect()
    }

    /// What the events of the vaults no identity here holds tell without
    /// their keys: a backup password, a grant, or a request for this app.
    pub(crate) async fn inspect_vaults(
        &self,
        held: &BrowserHeldVaults,
        observations: &[ProviderVaultObservation],
    ) -> Result<InspectedVaults, NookError> {
        let vaults = self
            .storage
            .namespaces(EventLogNamespaceKind::Vault)
            .await?;
        let mut inspected = InspectedVaults::default();
        for store_id in held.unheld(observations) {
            let VaultPlacement::Filed(placed) = VaultPlacement::of(&store_id, vaults.clone())?
            else {
                continue;
            };
            let events = self.namespace_events(&placed).await?;
            inspected.record(store_id, events, held.app_id.as_ref())?;
        }
        Ok(inspected)
    }

    /// Every vault at the location with the identity filing it and its
    /// events, read without its keys.
    pub(crate) async fn all_vault_events(&self) -> Result<Vec<CheckedVaultEvents>, NookError> {
        let mut vaults = Vec::new();
        for placed in self
            .storage
            .namespaces(EventLogNamespaceKind::Vault)
            .await?
        {
            let EventLogLocation::Vault(store_id) = placed.location().clone() else {
                continue;
            };
            vaults.push(CheckedVaultEvents {
                events: self.namespace_events(&placed).await?,
                filed_under: placed.identity().clone(),
                store_id,
            });
        }
        Ok(vaults)
    }

    /// One identity's control log events, read and not yet verified. An
    /// identity the location does not hold has none to read.
    pub(crate) async fn identity_events(
        &self,
        identity_id: &IdentityId,
    ) -> Result<Vec<EventStorageBytes>, NookError> {
        let events = self
            .namespace_events(&PlacedNamespace::identity_log(identity_id.clone()))
            .await?;
        match events.as_slice() {
            [] => Err(Self::identity_not_here()),
            [_, ..] => Ok(events.into_iter().map(|event| event.bytes).collect()),
        }
    }

    /// Write one event into an identity's log the location already holds.
    pub(crate) async fn put_identity_event(
        &self,
        identity_id: &IdentityId,
        event_id: &EventId,
        bytes: &[u8],
    ) -> Result<(), NookError> {
        let placed = PlacedNamespace::identity_log(identity_id.clone());
        let store = S3EventStore {
            storage: self.storage,
            placed: &placed,
        };
        match store.event_ids().await?.first() {
            Some(_) => store.put_if_absent(event_id, bytes).await,
            None => Err(Self::identity_not_here()),
        }
    }

    fn identity_not_here() -> NookError {
        NookError::Database("The identity is not at this S3 location.".to_owned())
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use std::slice;

    use super::S3VaultListing;
    use crate::storage::fetch_stub::{FetchRoute, FetchStub};
    use crate::storage::s3::S3Storage;
    use nook_core::{EventId, IdentityId, S3Connection, S3ConnectionDraft, StoreId};
    use wasm_bindgen_test::{wasm_bindgen_test, wasm_bindgen_test_configure};

    wasm_bindgen_test_configure!(run_in_browser);

    const DIGEST: &str = "ej6ZESIzRFVmd4iZqrvM3e7_ABEiM0RVZneImaq7zN0";
    const ROOT: &str = "e2e/meta-secret-nook";
    /// The query value of a listing prefix below the root.
    const ROOT_QUERY: &str = "prefix=e2e%2Fmeta-secret-nook%2F";

    fn connection() -> anyhow::Result<S3Connection> {
        Ok(S3Connection::try_from(S3ConnectionDraft {
            endpoint: "http://127.0.0.1:8333".to_owned(),
            region: "us-east-1".to_owned(),
            bucket: "nook-dev".to_owned(),
            key_prefix: "e2e".to_owned(),
            access_key_id: "device-a".to_owned(),
            secret_access_key: "TEST-ONLY-device-a-secret-not-real".to_owned(),
        })?)
    }

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
    async fn an_identity_log_is_read_only_where_the_location_holds_it() -> anyhow::Result<()> {
        let connection = connection()?;
        let location = S3VaultListing {
            storage: S3Storage {
                connection: &connection,
            },
        };
        let held = IdentityId::parse("idn_abcdefghijk")?;
        let key = format!("{ROOT}/idn_abcdefghijk/log/events/{DIGEST}.yaml");
        let stub = FetchStub::install(vec![
            listed("idn_strangerabc%2Flog%2Fevents%2F", page(&[], &[])),
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
        assert!(location.identity_events(&stranger).await.is_err());
        let event_id = EventId::parse(&format!("sha256u:{DIGEST}"))?;
        // Writing into a log the location does not hold is refused unsent.
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
        let connection = connection()?;
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
        let connection = connection()?;
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

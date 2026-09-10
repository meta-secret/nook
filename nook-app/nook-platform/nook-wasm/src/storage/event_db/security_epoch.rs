#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! Transaction-bound persistence for admitted event graphs.
use crate::NookError;
#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
use crate::storage::indexed_db::StoredStringRecord;
#[cfg(all(test, target_arch = "wasm32"))]
use nook_core::GenesisImportRequest;
use nook_core::LocalEventBytes;
use nook_core::{EventGraph, EventId, EventInsertStatus, LocalEventStore, VaultEvent};
mod requests;
mod transaction;
pub(crate) use requests::{EpochPairAppend, EventAppend, RemoteEventUnion};
use transaction::{
    AppendKind, EventString, EventTransaction, PersistedEventIds, TransactionEvents,
};
/// Vault scope only. Admission and commit remain private to each operation.
#[derive(Clone, Copy)]
pub(crate) struct VaultEventPersistence<'a> {
    store_id: &'a str,
}
struct VaultAppendGraph<'a> {
    graph: EventGraph,
    store_id: &'a str,
}
struct EventBytes<'a> {
    event_id: EventId,
    bytes: &'a [u8],
}
/// Graph admission binds these entries to this exact live transaction.
/// Serialized bytes remain the caller's supplied bytes, as before this migration.
///
/// The prepared capability is not part of the public WASM or Rust surface.
///
/// ```compile_fail,E0603
/// use nook_wasm::storage::event_db::security_epoch::PreparedEventAppend;
/// ```
struct PreparedEventAppend<'a, 'b> {
    vault: VaultEventPersistence<'a>,
    transaction: EventTransaction,
    ids: Vec<String>,
    graph: EventGraph,
    entries: Vec<EventBytes<'b>>,
}
/// Remote admission likewise cannot be constructed by an external caller.
///
/// ```compile_fail,E0603
/// use nook_wasm::storage::event_db::security_epoch::PreparedRemoteUnion;
/// ```
struct PreparedRemoteUnion<'a> {
    vault: VaultEventPersistence<'a>,
    transaction: EventTransaction,
    persisted_ids: Vec<String>,
    local: LocalEventStore,
    heads: Vec<String>,
}
impl<'a> VaultEventPersistence<'a> {
    #[must_use]
    pub(crate) fn new(store_id: &'a str) -> Self {
        Self { store_id }
    }
    fn event_key(&self, event_id: &str) -> String {
        format!("event:{}:{event_id}", self.store_id)
    }
    fn index_key(&self) -> String {
        format!("event_index:{}", self.store_id)
    }
    fn heads_key(&self) -> String {
        format!("event_heads:{}", self.store_id)
    }
    pub(crate) async fn append(&self, request: EventAppend<'_>) -> Result<Vec<String>, NookError> {
        self.prepare_append(request).await?.commit().await
    }
    pub(crate) async fn append_epoch_pair(
        &self,
        request: EpochPairAppend<'_>,
    ) -> Result<Vec<String>, NookError> {
        self.prepare_pair(request).await?.commit().await
    }
    pub(crate) async fn union_remote(
        &self,
        request: RemoteEventUnion<'_>,
    ) -> Result<(Vec<String>, LocalEventStore), NookError> {
        self.prepare_union(request).await?.commit().await
    }
    async fn prepare_append<'b>(
        &self,
        request: EventAppend<'b>,
    ) -> Result<PreparedEventAppend<'a, 'b>, NookError> {
        let transaction = EventTransaction::begin(AppendKind::Single).await?;
        let (ids, local) = TransactionEvents {
            store: &transaction.events,
            vault: *self,
        }
        .load()
        .await?;
        let graph = VaultAppendGraph {
            graph: local.load_graph(self.store_id)?,
            store_id: self.store_id,
        };
        let (graph, event_id) = graph.insert(request.event)?;
        Ok(PreparedEventAppend {
            vault: *self,
            transaction,
            ids,
            graph: graph.graph,
            entries: vec![EventBytes {
                event_id,
                bytes: request.bytes,
            }],
        })
    }
    async fn prepare_pair<'b>(
        &self,
        request: EpochPairAppend<'b>,
    ) -> Result<PreparedEventAppend<'a, 'b>, NookError> {
        let transaction = EventTransaction::begin(AppendKind::EpochPair).await?;
        let (ids, local) = TransactionEvents {
            store: &transaction.events,
            vault: *self,
        }
        .load()
        .await?;
        let graph = VaultAppendGraph {
            graph: local.load_graph(self.store_id)?,
            store_id: self.store_id,
        };
        let (graph, trigger_id, checkpoint_id) = graph.insert_pair(request)?;
        Ok(PreparedEventAppend {
            vault: *self,
            transaction,
            ids,
            graph: graph.graph,
            entries: vec![
                EventBytes {
                    event_id: trigger_id,
                    bytes: request.trigger.bytes,
                },
                EventBytes {
                    event_id: checkpoint_id,
                    bytes: request.checkpoint.bytes,
                },
            ],
        })
    }
    async fn prepare_union<'b>(
        &self,
        request: RemoteEventUnion<'b>,
    ) -> Result<PreparedRemoteUnion<'a>, NookError> {
        let store_id = self.store_id;
        let remote_events = request.events;
        let transaction = EventTransaction::begin(AppendKind::Remote).await?;
        let (persisted_ids, mut local) = TransactionEvents {
            store: &transaction.events,
            vault: *self,
        }
        .load()
        .await?;
        let typed_events = remote_events
            .iter()
            .map(|(event_id, bytes)| (event_id.clone(), bytes.clone().into()))
            .collect::<Vec<_>>();
        let heads = match local.union_remote(nook_core::LocalRemoteUnion {
            remote_events: &typed_events,
            store_id,
        }) {
            Ok(outcome) => {
                local = outcome.store;
                Ok(outcome.heads)
            }
            Err(rejected) => {
                local = rejected.store;
                Err(rejected.cause)
            }
        }?;
        let graph = local.load_graph(store_id)?;
        if !nook_core::VaultProjection::from_graph(&graph, store_id)?
            .security_conflicts
            .is_empty()
        {
            return Err(NookError::Database(
                "Remote events conflict with a concurrent security transition.".to_owned(),
            ));
        }
        Ok(PreparedRemoteUnion {
            vault: *self,
            transaction,
            persisted_ids,
            local,
            heads,
        })
    }
}
impl VaultAppendGraph<'_> {
    fn insert(mut self, event: &VaultEvent) -> Result<(Self, EventId), NookError> {
        let store_id = self.store_id;
        let graph = &mut self.graph;
        let event_id = event.id()?;
        if !graph.contains(&event_id) {
            let mut current = graph.heads();
            let mut expected = event.body.parents.clone();
            current.sort();
            expected.sort();
            if current != expected {
                return Err(NookError::Database(
                    "Vault changed before the event could commit.".to_owned(),
                ));
            }
        }
        match match graph.clone().insert(nook_core::EventGraphInsert {
            event: event.clone(),
            expected_store_id: store_id,
        }) {
            Ok(inserted) => {
                *graph = inserted.graph;
                Ok(inserted.status)
            }
            Err(rejected) => {
                *graph = rejected.graph;
                Err(rejected.cause)
            }
        }? {
            EventInsertStatus::Applied | EventInsertStatus::Duplicate => {}
            EventInsertStatus::Quarantined(reason) => {
                return Err(NookError::Database(format!(
                    "Refusing to append unauthorized vault event: {reason}"
                )));
            }
            EventInsertStatus::Pending(reason) => {
                return Err(NookError::Database(format!(
                    "Refusing to append vault event with unresolved parents: {reason:?}"
                )));
            }
        }
        Ok((self, event_id))
    }
}
impl VaultAppendGraph<'_> {
    fn insert_pair(
        mut self,
        request: EpochPairAppend<'_>,
    ) -> Result<(Self, EventId, EventId), NookError> {
        let store_id = self.store_id;
        let graph = &mut self.graph;
        let trigger = request.trigger.event;
        let checkpoint = request.checkpoint.event;
        let trigger_id = trigger.id()?;
        let checkpoint_id = checkpoint.id()?;
        if checkpoint.body.parents.as_slice() != [trigger_id.clone()]
            || checkpoint.body.key_epoch != trigger_id
        {
            return Err(NookError::Database(
                "Security epoch checkpoint does not directly commit its trigger.".to_owned(),
            ));
        }
        if !graph.contains(&trigger_id) {
            let mut current = graph.heads();
            let mut expected = trigger.body.parents.clone();
            current.sort();
            expected.sort();
            if current != expected {
                return Err(NookError::Database(
                    "Vault changed before the security epoch pair could commit.".to_owned(),
                ));
            }
        } else if !graph.contains(&checkpoint_id) && graph.heads() != vec![trigger_id.clone()] {
            return Err(NookError::Database(
                "Vault changed between the security epoch trigger and checkpoint.".to_owned(),
            ));
        }
        for event in [trigger, checkpoint] {
            match match graph.clone().insert(nook_core::EventGraphInsert {
                event: event.clone(),
                expected_store_id: store_id,
            }) {
                Ok(inserted) => {
                    *graph = inserted.graph;
                    Ok(inserted.status)
                }
                Err(rejected) => {
                    *graph = rejected.graph;
                    Err(rejected.cause)
                }
            }? {
                EventInsertStatus::Applied | EventInsertStatus::Duplicate => {}
                EventInsertStatus::Quarantined(reason) => {
                    return Err(NookError::Database(format!(
                        "Refusing conflicting security epoch event: {reason}"
                    )));
                }
                EventInsertStatus::Pending(reason) => {
                    return Err(NookError::Database(format!(
                        "Refusing security epoch event with unresolved parents: {reason:?}"
                    )));
                }
            }
        }
        let projection = nook_core::VaultProjection::from_graph(graph, store_id)?;
        if projection.security_conflicts.iter().any(|conflict| {
            conflict.events.contains(&trigger_id) || conflict.events.contains(&checkpoint_id)
        }) {
            return Err(NookError::Database(
                "Concurrent security epoch transition detected; recovery is required.".to_owned(),
            ));
        }
        Ok((self, trigger_id, checkpoint_id))
    }
}
impl PreparedEventAppend<'_, '_> {
    async fn commit(self) -> Result<Vec<String>, NookError> {
        let Self {
            vault,
            transaction,
            mut ids,
            graph,
            entries,
        } = self;
        let store_id = vault.store_id;
        let events = &transaction.events;
        let projections = &transaction.projections;

        for EventBytes { event_id, bytes } in entries {
            let value = String::from_utf8(Vec::<u8>::from(bytes))
                .map_err(|error| NookError::Serialization(error.to_string()))?;
            EventString {
                store: events,
                key: &VaultEventPersistence::new(store_id).event_key(event_id.as_str()),
                context: "Epoch event",
            }
            .put(&value)
            .await?;
            if !ids.iter().any(|id| id == event_id.as_str()) {
                ids.push(event_id.as_str().to_owned());
            }
        }
        ids.sort();
        EventString {
            store: events,
            key: &VaultEventPersistence::new(store_id).index_key(),
            context: "Epoch index",
        }
        .put(
            &serde_json::to_string(&ids)
                .map_err(|error| NookError::Serialization(error.to_string()))?,
        )
        .await?;
        let heads = graph
            .heads()
            .into_iter()
            .map(EventId::into_inner)
            .collect::<Vec<_>>();
        EventString {
            store: projections,
            key: &VaultEventPersistence::new(store_id).heads_key(),
            context: "Epoch heads",
        }
        .put(
            &serde_json::to_string(&heads)
                .map_err(|error| NookError::Serialization(error.to_string()))?,
        )
        .await?;
        transaction.complete().await?;
        Ok(heads)
    }
}
impl PreparedRemoteUnion<'_> {
    async fn commit(self) -> Result<(Vec<String>, LocalEventStore), NookError> {
        let Self {
            vault,
            transaction,
            persisted_ids,
            local,
            heads,
        } = self;
        let store_id = vault.store_id;
        let events = &transaction.events;
        let projections = &transaction.projections;
        for event_id in local.event_ids() {
            if persisted_ids.iter().any(|id| id == event_id.as_str()) {
                continue;
            }
            let bytes = match local.get_bytes(&event_id) {
                LocalEventBytes::Stored(bytes) => bytes,
                LocalEventBytes::UnknownEvent => {
                    return Err(NookError::Database(
                        "Admitted remote event bytes are missing.".to_owned(),
                    ));
                }
            };
            let value = String::from_utf8(Vec::<u8>::from(bytes))
                .map_err(|error| NookError::Serialization(error.to_string()))?;
            EventString {
                store: events,
                key: &VaultEventPersistence::new(store_id).event_key(event_id.as_str()),
                context: "Remote event",
            }
            .put(&value)
            .await?;
        }
        let mut ids = local
            .event_ids()
            .into_iter()
            .map(|event_id| event_id.as_str().to_owned())
            .collect::<Vec<_>>();
        ids.sort();
        for event_id in (PersistedEventIds {
            ids: &persisted_ids,
        })
        .removed(&ids)
        {
            TransactionEvents {
                store: events,
                vault: VaultEventPersistence::new(store_id),
            }
            .delete(&event_id)
            .await?;
        }
        EventString {
            store: events,
            key: &VaultEventPersistence::new(store_id).index_key(),
            context: "Remote event index",
        }
        .put(
            &serde_json::to_string(&ids)
                .map_err(|error| NookError::Serialization(error.to_string()))?,
        )
        .await?;
        EventString {
            store: projections,
            key: &VaultEventPersistence::new(store_id).heads_key(),
            context: "Remote event heads",
        }
        .put(
            &serde_json::to_string(&heads)
                .map_err(|error| NookError::Serialization(error.to_string()))?,
        )
        .await?;
        transaction.complete().await?;
        Ok((heads, local))
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser {
    use super::*;
    use nook_core::{
        EpochMetadataState, EpochPasswordState, GenesisImportPayload, IsoTimestamp,
        PasswordEntryId, SigningIdentity, StoreId, VaultEventBody, VaultEventSchemaVersion,
        VaultOperation,
    };
    use std::slice;
    use wasm_bindgen_test::wasm_bindgen_test;

    struct StoredEvent {
        event: VaultEvent,
        bytes: Vec<u8>,
    }

    impl StoredEvent {
        fn new(event: VaultEvent) -> anyhow::Result<Self> {
            let bytes = VaultEvent::serialize_event_storage_yaml(&event)?.into();
            Ok(Self { event, bytes })
        }

        fn append(&self) -> EventAppend<'_> {
            EventAppend {
                event: &self.event,
                bytes: &self.bytes,
            }
        }

        fn remote(&self) -> anyhow::Result<(EventId, Vec<u8>)> {
            Ok((self.event.id()?, self.bytes.clone()))
        }
    }

    struct EventFixture {
        store_id: StoreId,
        genesis: StoredEvent,
        trigger: StoredEvent,
        checkpoint: StoredEvent,
    }

    impl EventFixture {
        fn new() -> anyhow::Result<Self> {
            let store_id = nook_core::StoreId::generate()?;
            let (signing, _) = SigningIdentity::generate()?;
            let created_at = IsoTimestamp::parse("2026-08-14T00:00:00Z")?;
            let genesis = StoredEvent::new(VaultEvent::build_genesis_import_event(
                GenesisImportRequest {
                    store_id: &store_id,
                    actor_id: &signing.actor_id()?,
                    key_epoch: &EventId::parse(
                        "sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo",
                    )?,
                    payload: GenesisImportPayload {
                        source_content_hash: nook_auth2::Sha256Hex::from_trusted("00".repeat(32)),
                        secrets: Vec::new(),
                        password_entries: Vec::new(),
                    },
                    created_at: &created_at,
                    signing_key: signing.signing_key(),
                },
            )?)?;
            let trigger = StoredEvent::new(VaultEvent::sign(
                VaultEventBody {
                    schema_version: VaultEventSchemaVersion::CURRENT,
                    store_id: store_id.clone(),
                    actor_id: signing.actor_id()?,
                    actor_signing_public_key: signing.public_key(),
                    parents: vec![genesis.event.id()?],
                    created_at: created_at.clone(),
                    key_epoch: genesis.event.id()?,
                    operations: vec![VaultOperation::PasswordRemoved {
                        entry_id: PasswordEntryId::from_trusted("pwdentry001".to_owned()),
                    }],
                },
                signing.signing_key(),
            )?)?;
            let checkpoint = StoredEvent::new(VaultEvent::sign(
                VaultEventBody {
                    schema_version: VaultEventSchemaVersion::CURRENT,
                    store_id: store_id.clone(),
                    actor_id: signing.actor_id()?,
                    actor_signing_public_key: signing.public_key(),
                    parents: vec![trigger.event.id()?],
                    created_at,
                    key_epoch: trigger.event.id()?,
                    operations: vec![VaultOperation::EpochCheckpoint {
                        secrets: Vec::new(),
                        members_checkpoint_hash: nook_auth2::Sha256Hex::from_trusted(
                            "00".repeat(32),
                        ),
                        rotated_meta_records: EpochMetadataState::Replace(Vec::new()),
                        password_entries: EpochPasswordState::Replace(Vec::new()),
                    }],
                },
                signing.signing_key(),
            )?)?;
            Ok(Self {
                store_id,
                genesis,
                trigger,
                checkpoint,
            })
        }

        fn persistence(&self) -> VaultEventPersistence<'_> {
            VaultEventPersistence::new(self.store_id.as_str())
        }

        fn pair(&self) -> EpochPairAppend<'_> {
            EpochPairAppend {
                trigger: self.trigger.append(),
                checkpoint: self.checkpoint.append(),
            }
        }

        async fn snapshot(&self) -> anyhow::Result<EventSnapshot> {
            let vault = self.persistence();
            let transaction = EventTransaction::begin(AppendKind::Single).await?;
            let index = EventString {
                store: &transaction.events,
                key: &vault.index_key(),
                context: "Test index",
            }
            .read()
            .await?;
            let heads = EventString {
                store: &transaction.projections,
                key: &vault.heads_key(),
                context: "Test heads",
            }
            .read()
            .await?;
            let mut rows = Vec::new();
            for record in [&self.genesis, &self.trigger, &self.checkpoint] {
                rows.push(
                    EventString {
                        store: &transaction.events,
                        key: &vault.event_key(record.event.id()?.as_str()),
                        context: "Test event",
                    }
                    .read()
                    .await?,
                );
            }
            transaction.complete().await?;
            Ok(EventSnapshot { index, heads, rows })
        }

        async fn seed_index(&self, ids: &[String]) -> anyhow::Result<()> {
            let transaction = EventTransaction::begin(AppendKind::Single).await?;
            EventString {
                store: &transaction.events,
                key: &self.persistence().index_key(),
                context: "Test index",
            }
            .put(&serde_json::to_string(ids)?)
            .await?;
            transaction.complete().await?;
            Ok(())
        }
    }

    #[derive(Debug, PartialEq, Eq)]
    struct EventSnapshot {
        index: StoredStringRecord,
        heads: StoredStringRecord,
        rows: Vec<StoredStringRecord>,
    }

    impl EventSnapshot {
        fn assert_empty(&self) {
            assert!(matches!(self.index, StoredStringRecord::MissingKey));
            assert!(matches!(self.heads, StoredStringRecord::MissingKey));
            assert_eq!(self.rows, vec![StoredStringRecord::MissingKey; 3]);
        }

        fn assert_committed(&self, fixture: &EventFixture) -> anyhow::Result<()> {
            let mut ids = vec![
                fixture.genesis.event.id()?.into_inner(),
                fixture.trigger.event.id()?.into_inner(),
                fixture.checkpoint.event.id()?.into_inner(),
            ];
            ids.sort();
            assert_eq!(
                self.index,
                StoredStringRecord::Stored(serde_json::to_string(&ids)?)
            );
            assert_eq!(
                self.heads,
                StoredStringRecord::Stored(serde_json::to_string(&vec![
                    fixture.checkpoint.event.id()?.into_inner()
                ])?)
            );
            assert_eq!(
                self.rows,
                vec![
                    StoredStringRecord::Stored(String::from_utf8(fixture.genesis.bytes.clone())?),
                    StoredStringRecord::Stored(String::from_utf8(fixture.trigger.bytes.clone())?),
                    StoredStringRecord::Stored(String::from_utf8(
                        fixture.checkpoint.bytes.clone()
                    )?),
                ]
            );
            Ok(())
        }
    }

    #[wasm_bindgen_test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    async fn unauthorized_actor_rejection_preserves_the_committed_frontier() -> anyhow::Result<()> {
        let fixture = EventFixture::new()?;
        let vault = fixture.persistence();
        vault.append(fixture.genesis.append()).await?;
        let before = fixture.snapshot().await?;
        let (outsider, _) = SigningIdentity::generate()?;
        let mut body = fixture.trigger.event.body.clone();
        body.actor_id = outsider.actor_id()?;
        body.actor_signing_public_key = outsider.public_key();
        let unauthorized = StoredEvent::new(VaultEvent::sign(body, outsider.signing_key())?)?;
        match vault.append(unauthorized.append()).await {
            Err(NookError::Database(message)) => {
                assert_eq!(
                    message,
                    format!(
                        "Refusing to append unauthorized vault event: Event actor {} was not authorized in causal history",
                        outsider.actor_id()?
                    )
                );
            }
            _ => anyhow::bail!("expected exact unauthorized actor rejection"),
        }
        assert_eq!(fixture.snapshot().await?, before);
        let transaction = EventTransaction::begin(AppendKind::Single).await?;
        assert!(matches!(
            EventString {
                store: &transaction.events,
                key: &vault.event_key(unauthorized.event.id()?.as_str()),
                context: "Test unauthorized event",
            }
            .read()
            .await?,
            StoredStringRecord::MissingKey
        ));
        transaction.complete().await?;
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
    async fn prepared_pair_drop_preserves_genesis_and_writes_neither_successor()
    -> anyhow::Result<()> {
        let fixture = EventFixture::new()?;
        let vault = fixture.persistence();
        vault.append(fixture.genesis.append()).await?;
        let before = fixture.snapshot().await?;
        let prepared = vault.prepare_pair(fixture.pair()).await?;
        assert_eq!(prepared.graph.heads(), vec![fixture.checkpoint.event.id()?]);
        drop(prepared);
        assert_eq!(fixture.snapshot().await?, before);
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
    async fn append_and_duplicate_keep_exact_bytes_index_and_heads() -> anyhow::Result<()> {
        let fixture = EventFixture::new()?;
        let vault = fixture.persistence();
        let expected = vec![fixture.genesis.event.id()?.into_inner()];
        assert_eq!(vault.append(fixture.genesis.append()).await?, expected);
        let snapshot = fixture.snapshot().await?;
        assert_eq!(
            snapshot.index,
            StoredStringRecord::Stored(serde_json::to_string(&expected)?)
        );
        assert_eq!(
            snapshot.heads,
            StoredStringRecord::Stored(serde_json::to_string(&expected)?)
        );
        assert_eq!(
            snapshot.rows,
            vec![
                StoredStringRecord::Stored(String::from_utf8(fixture.genesis.bytes.clone())?),
                StoredStringRecord::MissingKey,
                StoredStringRecord::MissingKey
            ]
        );
        assert_eq!(vault.append(fixture.genesis.append()).await?, expected);
        assert_eq!(fixture.snapshot().await?, snapshot);
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
    async fn prepared_append_drop_leaves_all_rows_absent() -> anyhow::Result<()> {
        let fixture = EventFixture::new()?;
        let prepared = fixture
            .persistence()
            .prepare_append(fixture.genesis.append())
            .await?;
        assert_eq!(prepared.graph.heads(), vec![fixture.genesis.event.id()?]);
        drop(prepared);
        fixture.snapshot().await?.assert_empty();
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
    async fn epoch_pair_commit_and_duplicate_keep_both_rows() -> anyhow::Result<()> {
        let fixture = EventFixture::new()?;
        let vault = fixture.persistence();
        vault.append(fixture.genesis.append()).await?;
        let prepared = vault.prepare_pair(fixture.pair()).await?;
        assert_eq!(prepared.entries.len(), 2);
        assert_eq!(
            prepared.commit().await?,
            vec![fixture.checkpoint.event.id()?.into_inner()]
        );
        let snapshot = fixture.snapshot().await?;
        snapshot.assert_committed(&fixture)?;
        vault.append_epoch_pair(fixture.pair()).await?;
        assert_eq!(fixture.snapshot().await?, snapshot);
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
    async fn pair_accepts_existing_trigger_at_its_exact_frontier() -> anyhow::Result<()> {
        let fixture = EventFixture::new()?;
        let vault = fixture.persistence();
        vault.append(fixture.genesis.append()).await?;
        assert_eq!(
            vault.append(fixture.trigger.append()).await?,
            vec![fixture.trigger.event.id()?.into_inner()]
        );
        let before = fixture.snapshot().await?;
        assert!(matches!(before.rows[1], StoredStringRecord::Stored(_)));
        assert!(matches!(before.rows[2], StoredStringRecord::MissingKey));
        assert_eq!(
            vault.append_epoch_pair(fixture.pair()).await?,
            vec![fixture.checkpoint.event.id()?.into_inner()]
        );
        fixture.snapshot().await?.assert_committed(&fixture)?;
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
    async fn pair_linkage_rejection_precedes_frontier_and_preserves_rows() -> anyhow::Result<()> {
        let fixture = EventFixture::new()?;
        let result = fixture
            .persistence()
            .append_epoch_pair(EpochPairAppend {
                trigger: fixture.trigger.append(),
                checkpoint: fixture.genesis.append(),
            })
            .await;
        match result {
            Err(NookError::Database(message)) => assert_eq!(
                message,
                "Security epoch checkpoint does not directly commit its trigger."
            ),
            _ => anyhow::bail!("expected exact checkpoint linkage rejection"),
        }
        fixture.snapshot().await?.assert_empty();
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
    async fn stale_frontier_and_invalid_bytes_do_not_write_first_row() -> anyhow::Result<()> {
        let fixture = EventFixture::new()?;
        let vault = fixture.persistence();
        match vault.append(fixture.trigger.append()).await {
            Err(NookError::Database(message)) => {
                assert_eq!(message, "Vault changed before the event could commit.");
            }
            _ => anyhow::bail!("expected exact stale frontier rejection"),
        }
        fixture.snapshot().await?.assert_empty();
        match vault
            .append(EventAppend {
                event: &fixture.genesis.event,
                bytes: &[0xff],
            })
            .await
        {
            Err(NookError::Serialization(_)) => {}
            _ => anyhow::bail!("expected UTF-8 rejection before the first event write"),
        }
        fixture.snapshot().await?.assert_empty();
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
    async fn remote_union_commit_matches_pair_persistence_and_duplicate() -> anyhow::Result<()> {
        let fixture = EventFixture::new()?;
        let vault = fixture.persistence();
        let remote = vec![
            fixture.checkpoint.remote()?,
            fixture.genesis.remote()?,
            fixture.trigger.remote()?,
        ];
        let prepared = vault
            .prepare_union(RemoteEventUnion { events: &remote })
            .await?;
        let (heads, local) = prepared.commit().await?;
        assert_eq!(heads, vec![fixture.checkpoint.event.id()?.into_inner()]);
        assert_eq!(local.event_ids().len(), 3);
        for (id, bytes) in &remote {
            assert_eq!(
                local.get_bytes(id),
                LocalEventBytes::Stored(bytes.clone().into())
            );
        }
        let snapshot = fixture.snapshot().await?;
        snapshot.assert_committed(&fixture)?;
        let (duplicate_heads, duplicate_local) = vault
            .union_remote(RemoteEventUnion { events: &remote })
            .await?;
        assert_eq!(duplicate_heads, heads);
        assert_eq!(duplicate_local.event_ids(), local.event_ids());
        assert_eq!(fixture.snapshot().await?, snapshot);
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
    async fn prepared_union_drop_and_malformed_union_preserve_existing_rows() -> anyhow::Result<()>
    {
        let fixture = EventFixture::new()?;
        let vault = fixture.persistence();
        vault.append(fixture.genesis.append()).await?;
        let before = fixture.snapshot().await?;
        let remote = vec![fixture.trigger.remote()?, fixture.checkpoint.remote()?];
        let prepared = vault
            .prepare_union(RemoteEventUnion { events: &remote })
            .await?;
        assert_eq!(prepared.local.event_ids().len(), 3);
        drop(prepared);
        assert_eq!(fixture.snapshot().await?, before);
        let malformed = (fixture.trigger.event.id()?, b"not an event".to_vec());
        match vault
            .union_remote(RemoteEventUnion {
                events: slice::from_ref(&malformed),
            })
            .await
        {
            Err(NookError::Database(message)) => {
                assert!(message.starts_with("failed to parse remote event:"));
            }
            _ => anyhow::bail!("expected malformed remote event rejection"),
        }
        assert_eq!(fixture.snapshot().await?, before);
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
    async fn permissive_missing_index_rows_are_retained_by_append_and_contracted_by_union()
    -> anyhow::Result<()> {
        let fixture = EventFixture::new()?;
        let missing = fixture.trigger.event.id()?.into_inner();
        let mut stale_ids = vec![missing, "not-an-event-id".to_owned()];
        fixture.seed_index(&stale_ids).await?;
        let vault = fixture.persistence();
        vault.append(fixture.genesis.append()).await?;
        stale_ids.push(fixture.genesis.event.id()?.into_inner());
        stale_ids.sort();
        let before = fixture.snapshot().await?;
        assert_eq!(
            before.index,
            StoredStringRecord::Stored(serde_json::to_string(&stale_ids)?)
        );
        assert!(matches!(before.rows[1], StoredStringRecord::MissingKey));
        let (heads, local) = vault.union_remote(RemoteEventUnion { events: &[] }).await?;
        assert_eq!(local.event_ids(), vec![fixture.genesis.event.id()?]);
        assert_eq!(heads, vec![fixture.genesis.event.id()?.into_inner()]);
        let after = fixture.snapshot().await?;
        assert_eq!(
            after.index,
            StoredStringRecord::Stored(serde_json::to_string(&heads)?)
        );
        assert_eq!(after.heads, before.heads);
        assert_eq!(after.rows, before.rows);
        Ok(())
    }
}

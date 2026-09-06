#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
use super::*;
#[test]
fn remote_contraction_identifies_orphan_rows_for_deletion() {
    let persisted = vec!["accepted".to_owned(), "quarantined".to_owned()];
    let accepted = vec!["accepted".to_owned()];
    assert_eq!(
        PersistedEventIds { ids: &persisted }.removed(&accepted),
        vec!["quarantined".to_owned()]
    );
}

#[cfg(all(target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser {
    use super::*;
    use nook_core::{
        EpochMetadataState, EpochPasswordState, GenesisImportPayload, IsoTimestamp,
        PasswordEntryId, Sha256Hex, SigningIdentity, StoreId, VaultEventBody,
        VaultEventSchemaVersion, VaultOperation,
    };
    use std::slice;
    use wasm_bindgen_test::wasm_bindgen_test;

    struct StoredEvent {
        event: VaultEvent,
        bytes: Vec<u8>,
    }

    impl StoredEvent {
        fn new(event: VaultEvent) -> anyhow::Result<Self> {
            let bytes = nook_core::serialize_event_storage_yaml(&event)?.into();
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
            let store_id = nook_core::generate_store_id()?;
            let (signing, _) = SigningIdentity::generate()?;
            let created_at = IsoTimestamp::parse("2026-08-14T00:00:00Z")?;
            let genesis = StoredEvent::new(nook_core::build_genesis_import_event(
                &store_id,
                &signing.actor_id()?,
                &EventId::parse("sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo")?,
                GenesisImportPayload {
                    source_content_hash: Sha256Hex::from_trusted("00".repeat(32)),
                    secrets: Vec::new(),
                    password_entries: Vec::new(),
                },
                &created_at,
                signing.signing_key(),
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
                        members_checkpoint_hash: Sha256Hex::from_trusted("00".repeat(32)),
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
        index: Option<String>,
        heads: Option<String>,
        rows: Vec<Option<String>>,
    }

    impl EventSnapshot {
        fn assert_empty(&self) {
            assert!(self.index.is_none());
            assert!(self.heads.is_none());
            assert_eq!(self.rows, vec![None, None, None]);
        }

        fn assert_committed(&self, fixture: &EventFixture) -> anyhow::Result<()> {
            let mut ids = vec![
                fixture.genesis.event.id()?.into_inner(),
                fixture.trigger.event.id()?.into_inner(),
                fixture.checkpoint.event.id()?.into_inner(),
            ];
            ids.sort();
            assert_eq!(self.index, Some(serde_json::to_string(&ids)?));
            assert_eq!(
                self.heads,
                Some(serde_json::to_string(&vec![
                    fixture.checkpoint.event.id()?.into_inner()
                ])?)
            );
            assert_eq!(
                self.rows,
                vec![
                    Some(String::from_utf8(fixture.genesis.bytes.clone())?),
                    Some(String::from_utf8(fixture.trigger.bytes.clone())?),
                    Some(String::from_utf8(fixture.checkpoint.bytes.clone())?),
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
        assert!(
            EventString {
                store: &transaction.events,
                key: &vault.event_key(unauthorized.event.id()?.as_str()),
                context: "Test unauthorized event",
            }
            .read()
            .await?
            .is_none()
        );
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
        assert_eq!(snapshot.index, Some(serde_json::to_string(&expected)?));
        assert_eq!(snapshot.heads, Some(serde_json::to_string(&expected)?));
        assert_eq!(
            snapshot.rows,
            vec![
                Some(String::from_utf8(fixture.genesis.bytes.clone())?),
                None,
                None
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
        assert!(before.rows[1].is_some());
        assert!(before.rows[2].is_none());
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
                local.get_bytes(id).map(Vec::<u8>::from),
                Some(bytes.clone())
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
                assert!(message.starts_with("failed to parse stored event:"));
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
        assert_eq!(before.index, Some(serde_json::to_string(&stale_ids)?));
        assert!(before.rows[1].is_none());
        let (heads, local) = vault.union_remote(RemoteEventUnion { events: &[] }).await?;
        assert_eq!(local.event_ids(), vec![fixture.genesis.event.id()?]);
        assert_eq!(heads, vec![fixture.genesis.event.id()?.into_inner()]);
        let after = fixture.snapshot().await?;
        assert_eq!(after.index, Some(serde_json::to_string(&heads)?));
        assert_eq!(after.heads, before.heads);
        assert_eq!(after.rows, before.rows);
        Ok(())
    }
}

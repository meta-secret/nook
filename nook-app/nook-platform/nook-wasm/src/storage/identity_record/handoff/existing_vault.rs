#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! Admission against the event store held by the handoff transaction.
use super::ExistingVaultImportCommit;
use crate::NookError;
use crate::storage::{event_db, identity_record};
use nook_core::{
    IdentityVaultDekEpoch, IdentityVaultDekEpochUpdate, IdentityVaultDekReconciliation,
    IdentityVaultEventId,
};
pub(super) struct ExistingVaultHandoffResult {
    pub(super) identity_id: nook_core::IdentityId,
    pub(super) vault_keys: nook_core::VaultKeys,
}
pub(super) struct ExistingVaultHandoff<'a> {
    pub(super) directory: &'a mut nook_core::IdentityDirectory,
    pub(super) events: &'a rexie::Store,
    pub(super) store_id: &'a nook_core::StoreId,
    pub(super) app_key: &'a nook_core::AppKey,
    pub(super) signing_public_key: &'a nook_core::DeviceSigningPublicKey,
    pub(super) existing: ExistingVaultImportCommit,
}
/// Retains the original transaction-store and destination borrows. This is
/// consumed immediately within the current transaction, not a reusable token.
///
/// ```compile_fail,E0603
/// use nook_wasm::storage::identity_record::handoff::existing_vault::CheckedExistingVaultHandoff;
/// ```
struct CheckedExistingVaultHandoff<'a> {
    input: ExistingVaultHandoff<'a>,
    reconciliation: IdentityVaultDekReconciliation,
}
struct HandoffCheckpoint<'a> {
    graph: &'a nook_core::EventGraph,
    checkpoint_event_id: &'a nook_core::EventId,
}
impl HandoffCheckpoint<'_> {
    fn ancestors(&self) -> Result<Vec<IdentityVaultEventId>, NookError> {
        let Self {
            graph,
            checkpoint_event_id,
        } = *self;

        graph
            .topological_order()?
            .into_iter()
            .filter(|event_id| {
                event_id == checkpoint_event_id || graph.is_ancestor(event_id, checkpoint_event_id)
            })
            .map(|event_id| IdentityVaultEventId::parse(event_id.as_str()))
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| NookError::Database(error.to_string()))
    }
}
impl<'a> ExistingVaultHandoff<'a> {
    pub(super) async fn import(self) -> Result<ExistingVaultHandoffResult, NookError> {
        self.check().await?.import()
    }
    async fn check(self) -> Result<CheckedExistingVaultHandoff<'a>, NookError> {
        let input = self;

        let graph =
            event_db::load_local_event_store_from_store(input.events, input.store_id.as_str())
                .await?
                .load_graph(input.store_id.as_str())?;
        if !graph.pending_events().is_empty() {
            return Err(NookError::Database(
                "Imported extension identity has an incomplete signed vault event graph."
                    .to_owned(),
            ));
        }
        let ordered_event_ids = graph.topological_order()?;
        let checkpoint_event_id = nook_core::current_epoch_checkpoint(&graph)?
            .or_else(|| ordered_event_ids.last().cloned())
            .ok_or_else(|| {
                NookError::Database(
                    "Imported extension identity has no committed vault events.".to_owned(),
                )
            })?;
        let checkpoint_event = graph.get(&checkpoint_event_id).ok_or_else(|| {
            NookError::Database("Imported extension identity checkpoint is missing.".to_owned())
        })?;
        let key_epoch = IdentityVaultEventId::parse(checkpoint_event.body.key_epoch.as_str())
            .map_err(|error| NookError::Database(error.to_string()))?;
        let checkpoint = IdentityVaultEventId::parse(checkpoint_event_id.as_str())
            .map_err(|error| NookError::Database(error.to_string()))?;
        let checkpoint_ancestors = HandoffCheckpoint {
            graph: &graph,
            checkpoint_event_id: &checkpoint_event_id,
        }
        .ancestors()?;
        let envelopes = nook_core::event_graph_active_device_envelopes(
            &graph,
            &input.existing.device_id,
            &input.app_key.public_key(),
            input.signing_public_key,
        )?
        .ok_or_else(|| {
            NookError::Database(
                "Imported extension identity is not active in the signed vault roster.".to_owned(),
            )
        })?;
        let reconciliation = IdentityVaultDekReconciliation {
            secrets_envelope: envelopes.secrets_key,
            members_envelope: envelopes.members_key,
            epoch_update: IdentityVaultDekEpochUpdate::Observe {
                key_epoch: IdentityVaultDekEpoch::Known {
                    key_epoch,
                    checkpoint,
                },
                checkpoint_ancestors,
            },
            authorized_auth_ids: nook_core::event_graph_active_auth_ids(&graph)?,
        };
        Ok(CheckedExistingVaultHandoff {
            input,
            reconciliation,
        })
    }
}
impl CheckedExistingVaultHandoff<'_> {
    fn import(self) -> Result<ExistingVaultHandoffResult, NookError> {
        let Self {
            input,
            reconciliation,
        } = self;
        let identity_id = input
            .directory
            .import_legacy_vault(
                &input.existing.label,
                input.app_key,
                input.store_id.clone(),
                reconciliation,
            )
            .map_err(identity_record::map_domain_error)?;
        let vault_keys = input
            .directory
            .open_or_generate_vault_dek_for_identity(
                &identity_id,
                input.app_key,
                input.store_id.clone(),
            )
            .map_err(identity_record::map_domain_error)?;
        Ok(ExistingVaultHandoffResult {
            identity_id,
            vault_keys,
        })
    }
}
#[cfg(test)]
mod tests {
    use crate::manager::PendingExtensionIdentityEnrollment;
    use crate::storage::identity_record;
    use crate::storage::indexed_db;
    use futures_util::future;
    use nook_core::{
        DeviceIdentity, DeviceSigningPublicKey, EventId, IdentityDirectory, IsoTimestamp,
        LocalEventStore, MemberLabel, Sha256Hex, SigningIdentity, VaultOperation,
    };
    use rexie::TransactionMode;

    use super::super::IdentityHandoffCommit;
    use super::{ExistingVaultHandoff, ExistingVaultImportCommit, HandoffCheckpoint, NookError};
    use crate::storage;
    use crate::storage::event_db;
    use identity_record::{IDENTITY_DIRECTORY_KEY, PendingSimpleGenesis};
    use wasm_bindgen_test::{wasm_bindgen_test, wasm_bindgen_test_configure};

    wasm_bindgen_test_configure!(run_in_browser);

    struct ImportFixture {
        identity: nook_core::DeviceIdentity,
        store_id: nook_core::StoreId,
        secrets_envelope: nook_core::AgeArmoredCiphertext,
        members_envelope: nook_core::AgeArmoredCiphertext,
    }

    #[derive(serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    struct LegacyGenesisMarker<'a> {
        store_id: &'a str,
        identity_id: &'a str,
    }

    impl ImportFixture {
        fn new() -> Result<Self, NookError> {
            let identity = DeviceIdentity::generate().map_err(identity_record::map_domain_error)?;
            let store_id =
                nook_core::generate_store_id().map_err(identity_record::map_domain_error)?;
            let mut material = IdentityDirectory::empty();
            let identity_id = material
                .create_identity("Imported", &identity, None)
                .map_err(identity_record::map_domain_error)?;
            let _ = material
                .open_or_generate_vault_dek_for_identity(&identity_id, &identity, store_id.clone())
                .map_err(identity_record::map_domain_error)?;
            let grant = &material
                .selected()
                .map_err(identity_record::map_domain_error)?
                .vault_deks[0];
            Ok(ImportFixture {
                identity,
                store_id,
                secrets_envelope: grant.secrets_envelopes[0].envelope.clone(),
                members_envelope: grant.members_envelopes[0].envelope.clone(),
            })
        }

        async fn assert_nothing_published(
            &self,
            signing_seed_before: Option<&String>,
        ) -> Result<(), NookError> {
            assert!(
                identity_record::load_identity_directory()
                    .await?
                    .identities()
                    .is_empty()
            );
            assert_eq!(
                event_db::load_signing_seed().await?.as_ref(),
                signing_seed_before
            );
            Ok(())
        }
    }
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    #[wasm_bindgen_test]
    async fn rejects_before_publishing_without_active_roster() -> Result<(), NookError> {
        identity_record::clear_identity_directory_for_test().await?;
        let fixture = ImportFixture::new()?;
        let signing_seed_before = event_db::load_signing_seed().await?;
        let signing_public_key = DeviceSigningPublicKey::parse(&"22".repeat(32))
            .map_err(|error| NookError::Database(error.to_string()))?;
        let enrollment = PendingExtensionIdentityEnrollment::ExistingVaultImport {
            store_id: fixture.store_id.clone(),
        };
        let signing_seed = "33".repeat(32);
        let result = IdentityHandoffCommit {
            app_key: &fixture.identity,
            signing_public_key: &signing_public_key,
            authorizer_signing: None,
            enrollment: &enrollment,
            signing_seed: Some(&signing_seed),
            existing_vault: Some(ExistingVaultImportCommit {
                device_id: fixture.identity.device_id().clone(),
                label: "Imported".to_owned(),
            }),
        }
        .commit()
        .await;

        assert!(result.is_err());
        fixture
            .assert_nothing_published(signing_seed_before.as_ref())
            .await?;
        identity_record::clear_identity_directory_for_test().await?;
        Ok(())
    }

    struct SignedAccessEvents {
        signing_public_key: nook_core::DeviceSigningPublicKey,
        approval_id: nook_core::EventId,
        approval_bytes: Vec<u8>,
        replacement_id: nook_core::EventId,
        replacement_bytes: Vec<u8>,
        replacement_keys: nook_core::VaultKeys,
        revocation_id: nook_core::EventId,
        revocation_bytes: Vec<u8>,
        pending_revocation_id: nook_core::EventId,
        pending_revocation_bytes: Vec<u8>,
    }

    impl SignedAccessEvents {
        #[allow(clippy::too_many_lines)] // One fixture keeps the causal access-event chain auditable.
        fn new(fixture: &ImportFixture) -> Result<SignedAccessEvents, NookError> {
            let (signing, _) = SigningIdentity::generate()
                .map_err(|error| NookError::Database(error.to_string()))?;
            let signing_public_key = signing.public_key();
            let actor_id = signing
                .actor_id()
                .map_err(|error| NookError::Database(error.to_string()))?;
            let key_epoch = EventId::parse("sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo")
                .map_err(|error| NookError::Database(error.to_string()))?;
            let created_at = IsoTimestamp::from_trusted("2026-08-15T00:00:00Z".to_owned());
            let (approval, approval_bytes) =
                nook_core::AppendEventInput::build(nook_core::AppendEventInput {
                    store_id: &fixture.store_id,
                    actor_id: &actor_id,
                    signing_identity: &signing,
                    parents: Vec::new(),
                    key_epoch: &key_epoch,
                    created_at: &created_at,
                    operations: vec![
                        VaultOperation::VaultImported {
                            source_content_hash: Sha256Hex::from_trusted("0".repeat(64)),
                            secrets: Vec::new(),
                            password_entries: Vec::new(),
                        },
                        VaultOperation::JoinApproved {
                            device_id: fixture.identity.device_id().clone(),
                            encryption_public_key: fixture.identity.public_key(),
                            signing_public_key: signing_public_key.clone(),
                            label: MemberLabel::from_trusted("Imported".to_owned()),
                            secrets_key_ciphertext: fixture.secrets_envelope.clone(),
                            members_key_ciphertext: fixture.members_envelope.clone(),
                        },
                    ],
                })
                .map_err(|error| NookError::Database(error.to_string()))?;
            let approval_id = approval
                .id()
                .map_err(|error| NookError::Database(error.to_string()))?;
            let replacement_keys =
                nook_core::generate_vault_keys().map_err(identity_record::map_domain_error)?;
            let replacement_secrets = nook_core::encrypt_for_recipient(
                replacement_keys.secrets_key.as_str().as_bytes(),
                &fixture.identity.public_key(),
            )
            .map_err(identity_record::map_domain_error)?;
            let replacement_members = nook_core::encrypt_for_recipient(
                replacement_keys.members_key.as_str().as_bytes(),
                &fixture.identity.public_key(),
            )
            .map_err(identity_record::map_domain_error)?;
            let (replacement, replacement_bytes) =
                nook_core::AppendEventInput::build(nook_core::AppendEventInput {
                    store_id: &fixture.store_id,
                    actor_id: &actor_id,
                    signing_identity: &signing,
                    parents: vec![approval_id.clone()],
                    key_epoch: &key_epoch,
                    created_at: &created_at,
                    operations: vec![VaultOperation::JoinApproved {
                        device_id: fixture.identity.device_id().clone(),
                        encryption_public_key: fixture.identity.public_key(),
                        signing_public_key: signing_public_key.clone(),
                        label: MemberLabel::from_trusted("Imported".to_owned()),
                        secrets_key_ciphertext: replacement_secrets,
                        members_key_ciphertext: replacement_members,
                    }],
                })
                .map_err(|error| NookError::Database(error.to_string()))?;
            let (revocation, revocation_bytes) =
                nook_core::AppendEventInput::build(nook_core::AppendEventInput {
                    store_id: &fixture.store_id,
                    actor_id: &actor_id,
                    signing_identity: &signing,
                    parents: vec![approval_id.clone()],
                    key_epoch: &key_epoch,
                    created_at: &created_at,
                    operations: vec![VaultOperation::DeviceRevoked {
                        device_id: fixture.identity.device_id().clone(),
                    }],
                })
                .map_err(|error| NookError::Database(error.to_string()))?;
            let missing_parent =
                EventId::parse("sha256u:rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrro")
                    .map_err(|error| NookError::Database(error.to_string()))?;
            let (pending_revocation, pending_revocation_bytes) =
                nook_core::AppendEventInput::build(nook_core::AppendEventInput {
                    store_id: &fixture.store_id,
                    actor_id: &actor_id,
                    signing_identity: &signing,
                    parents: vec![missing_parent],
                    key_epoch: &key_epoch,
                    created_at: &created_at,
                    operations: vec![VaultOperation::DeviceRevoked {
                        device_id: fixture.identity.device_id().clone(),
                    }],
                })
                .map_err(|error| NookError::Database(error.to_string()))?;
            Ok(SignedAccessEvents {
                signing_public_key,
                approval_id,
                approval_bytes: approval_bytes.into(),
                replacement_id: replacement
                    .id()
                    .map_err(|error| NookError::Database(error.to_string()))?,
                replacement_bytes: replacement_bytes.into(),
                replacement_keys,
                revocation_id: revocation
                    .id()
                    .map_err(|error| NookError::Database(error.to_string()))?,
                revocation_bytes: revocation_bytes.into(),
                pending_revocation_id: pending_revocation
                    .id()
                    .map_err(|error| NookError::Database(error.to_string()))?,
                pending_revocation_bytes: pending_revocation_bytes.into(),
            })
        }
    }
    #[test]
    fn selected_checkpoint_ancestors_exclude_concurrent_siblings() -> Result<(), NookError> {
        let fixture = ImportFixture::new()?;
        let events = SignedAccessEvents::new(&fixture)?;
        let mut local = LocalEventStore::new();
        for (event_id, bytes) in [
            (events.approval_id.clone(), events.approval_bytes.clone()),
            (
                events.replacement_id.clone(),
                events.replacement_bytes.clone(),
            ),
            (
                events.revocation_id.clone(),
                events.revocation_bytes.clone(),
            ),
        ] {
            local.put_event(event_id, bytes.into());
        }
        let graph = local.load_graph(fixture.store_id.as_str())?;

        let ancestors = HandoffCheckpoint {
            graph: &graph,
            checkpoint_event_id: &events.replacement_id,
        }
        .ancestors()?;

        assert!(
            ancestors
                .iter()
                .any(|id| id.as_str() == events.approval_id.as_str())
        );
        assert!(
            ancestors
                .iter()
                .any(|id| id.as_str() == events.replacement_id.as_str())
        );
        assert!(
            !ancestors
                .iter()
                .any(|id| id.as_str() == events.revocation_id.as_str())
        );
        Ok(())
    }

    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    #[wasm_bindgen_test]
    async fn handoff_uses_latest_transactional_roster_envelopes() -> Result<(), NookError> {
        identity_record::clear_identity_directory_for_test().await?;
        let fixture = ImportFixture::new()?;
        event_db::clear_local_event_store(fixture.store_id.as_str()).await?;
        let events = SignedAccessEvents::new(&fixture)?;
        for (event_id, bytes) in [
            (&events.approval_id, &events.approval_bytes),
            (&events.replacement_id, &events.replacement_bytes),
        ] {
            event_db::save_event_bytes(fixture.store_id.as_str(), event_id.as_str(), bytes).await?;
        }
        let enrollment = PendingExtensionIdentityEnrollment::ExistingVaultImport {
            store_id: fixture.store_id.clone(),
        };

        let committed = IdentityHandoffCommit {
            app_key: &fixture.identity,
            signing_public_key: &events.signing_public_key,
            authorizer_signing: None,
            enrollment: &enrollment,
            signing_seed: None,
            existing_vault: Some(ExistingVaultImportCommit {
                device_id: fixture.identity.device_id().clone(),
                label: "Imported".to_owned(),
            }),
        }
        .commit()
        .await?;
        assert_eq!(
            committed.existing_vault_keys,
            Some(events.replacement_keys.clone())
        );

        let mut directory = identity_record::load_identity_directory().await?;
        assert_eq!(
            directory
                .open_or_generate_vault_dek(&fixture.identity, fixture.store_id.clone())
                .map_err(identity_record::map_domain_error)?,
            events.replacement_keys
        );
        event_db::clear_local_event_store(fixture.store_id.as_str()).await?;
        identity_record::clear_identity_directory_for_test().await
    }

    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    #[wasm_bindgen_test]
    async fn handoff_transaction_preserves_pending_identity_during_migration()
    -> Result<(), NookError> {
        identity_record::clear_identity_directory_for_test().await?;
        let fixture = ImportFixture::new()?;
        event_db::clear_local_event_store(fixture.store_id.as_str()).await?;
        let events = SignedAccessEvents::new(&fixture)?;
        event_db::save_event_bytes(
            fixture.store_id.as_str(),
            events.approval_id.as_str(),
            &events.approval_bytes,
        )
        .await?;
        let mut directory = IdentityDirectory::empty();
        let pending_identity_id = directory
            .create_identity("Pending", &fixture.identity, None)
            .map_err(identity_record::map_domain_error)?;
        directory
            .create_identity("Concurrent duplicate", &fixture.identity, None)
            .map_err(identity_record::map_domain_error)?;
        indexed_db::idb_put_string(
            IDENTITY_DIRECTORY_KEY,
            &serde_json::to_string(&directory)
                .map_err(|error| NookError::Serialization(error.to_string()))?,
        )
        .await?;
        indexed_db::idb_put_string(
            identity_record::PENDING_SIMPLE_GENESIS_KEY,
            &serde_json::to_string(&LegacyGenesisMarker {
                store_id: fixture.store_id.as_str(),
                identity_id: pending_identity_id.as_str(),
            })
            .map_err(|error| NookError::Serialization(error.to_string()))?,
        )
        .await?;
        let enrollment = PendingExtensionIdentityEnrollment::ExistingVaultImport {
            store_id: fixture.store_id.clone(),
        };

        IdentityHandoffCommit {
            app_key: &fixture.identity,
            signing_public_key: &events.signing_public_key,
            authorizer_signing: None,
            enrollment: &enrollment,
            signing_seed: None,
            existing_vault: Some(ExistingVaultImportCommit {
                device_id: fixture.identity.device_id().clone(),
                label: "Imported".to_owned(),
            }),
        }
        .commit()
        .await?;

        let current = identity_record::load_identity_directory().await?;
        let pending = PendingSimpleGenesis::load_for_store(fixture.store_id.as_str())
            .await?
            .ok_or_else(|| NookError::Database("Pending marker disappeared.".to_owned()))?;
        assert_eq!(current.identities().len(), 1);
        assert_eq!(current.selected()?.identity_id, pending_identity_id);
        assert!(current.selected()?.owns_vault(&fixture.store_id));
        assert_eq!(pending.identity_id, pending_identity_id);
        event_db::clear_local_event_store(fixture.store_id.as_str()).await?;
        identity_record::clear_identity_directory_for_test().await
    }

    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    #[wasm_bindgen_test]
    async fn rejects_handoff_with_pending_roster_event() -> Result<(), NookError> {
        identity_record::clear_identity_directory_for_test().await?;
        let fixture = ImportFixture::new()?;
        let signing_seed_before = event_db::load_signing_seed().await?;
        event_db::clear_local_event_store(fixture.store_id.as_str()).await?;
        let events = SignedAccessEvents::new(&fixture)?;
        for (event_id, bytes) in [
            (&events.approval_id, &events.approval_bytes),
            (
                &events.pending_revocation_id,
                &events.pending_revocation_bytes,
            ),
        ] {
            event_db::save_event_bytes(fixture.store_id.as_str(), event_id.as_str(), bytes).await?;
        }
        let enrollment = PendingExtensionIdentityEnrollment::ExistingVaultImport {
            store_id: fixture.store_id.clone(),
        };
        let signing_seed = "33".repeat(32);

        let result = IdentityHandoffCommit {
            app_key: &fixture.identity,
            signing_public_key: &events.signing_public_key,
            authorizer_signing: None,
            enrollment: &enrollment,
            signing_seed: Some(&signing_seed),
            existing_vault: Some(ExistingVaultImportCommit {
                device_id: fixture.identity.device_id().clone(),
                label: "Imported".to_owned(),
            }),
        }
        .commit()
        .await;

        assert!(result.is_err());
        fixture
            .assert_nothing_published(signing_seed_before.as_ref())
            .await?;
        event_db::clear_local_event_store(fixture.store_id.as_str()).await?;
        identity_record::clear_identity_directory_for_test().await
    }

    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    #[wasm_bindgen_test]
    async fn concurrent_revocation_serializes_before_handoff() -> Result<(), NookError> {
        identity_record::clear_identity_directory_for_test().await?;
        let fixture = ImportFixture::new()?;
        let signing_seed_before = event_db::load_signing_seed().await?;
        event_db::clear_local_event_store(fixture.store_id.as_str()).await?;
        let events = SignedAccessEvents::new(&fixture)?;
        event_db::save_event_bytes(
            fixture.store_id.as_str(),
            events.approval_id.as_str(),
            &events.approval_bytes,
        )
        .await?;
        let approved_graph = event_db::load_local_event_store(fixture.store_id.as_str())
            .await?
            .load_graph(fixture.store_id.as_str())?;
        assert!(nook_core::event_graph_has_active_device_access(
            &approved_graph,
            fixture.identity.device_id(),
            &fixture.identity.public_key(),
            &events.signing_public_key,
        )?);

        let rexie = storage::open_nook_database().await?;
        let transaction = rexie
            .transaction(&["events"], TransactionMode::ReadWrite)
            .map_err(|error| {
                NookError::IndexedDb(format!("Revocation transaction error: {error:?}"))
            })?;
        let event_store = transaction.store("events").map_err(|error| {
            NookError::IndexedDb(format!("Revocation event store error: {error:?}"))
        })?;
        let revocation_write = async {
            event_db::save_event_bytes_to_store(
                &event_store,
                fixture.store_id.as_str(),
                events.revocation_id.as_str(),
                &events.revocation_bytes,
            )
            .await?;
            transaction.done().await.map(|_| ()).map_err(|error| {
                NookError::IndexedDb(format!("Revocation commit error: {error:?}"))
            })
        };
        let enrollment = PendingExtensionIdentityEnrollment::ExistingVaultImport {
            store_id: fixture.store_id.clone(),
        };
        let signing_seed = "33".repeat(32);
        let handoff = IdentityHandoffCommit {
            app_key: &fixture.identity,
            signing_public_key: &events.signing_public_key,
            authorizer_signing: None,
            enrollment: &enrollment,
            signing_seed: Some(&signing_seed),
            existing_vault: Some(ExistingVaultImportCommit {
                device_id: fixture.identity.device_id().clone(),
                label: "Imported".to_owned(),
            }),
        }
        .commit();
        let (revocation_result, handoff_result) = future::join(revocation_write, handoff).await;

        revocation_result?;
        assert!(handoff_result.is_err());
        fixture
            .assert_nothing_published(signing_seed_before.as_ref())
            .await?;
        let revoked_graph = event_db::load_local_event_store(fixture.store_id.as_str())
            .await?
            .load_graph(fixture.store_id.as_str())?;
        assert!(!nook_core::event_graph_has_active_device_access(
            &revoked_graph,
            fixture.identity.device_id(),
            &fixture.identity.public_key(),
            &events.signing_public_key,
        )?);
        event_db::clear_local_event_store(fixture.store_id.as_str()).await?;
        identity_record::clear_identity_directory_for_test().await?;
        Ok(())
    }

    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    #[wasm_bindgen_test]
    async fn checked_admission_holds_import_until_consumed() -> Result<(), NookError> {
        let fixture = ImportFixture::new()?;
        let events = SignedAccessEvents::new(&fixture)?;
        indexed_db::clear_vault_db().await?;
        event_db::save_event_bytes(
            fixture.store_id.as_str(),
            events.approval_id.as_str(),
            &events.approval_bytes,
        )
        .await?;
        let connection = storage::open_nook_database().await?;
        let transaction = connection
            .transaction(&["vault", "events"], TransactionMode::ReadWrite)
            .map_err(|error| {
                NookError::IndexedDb(format!("Admission transaction error: {error:?}"))
            })?;
        let store = transaction
            .store("events")
            .map_err(|error| NookError::IndexedDb(format!("Admission store error: {error:?}")))?;
        let mut directory = IdentityDirectory::empty();
        {
            let _checked = ExistingVaultHandoff {
                directory: &mut directory,
                events: &store,
                store_id: &fixture.store_id,
                app_key: &fixture.identity,
                signing_public_key: &events.signing_public_key,
                existing: ExistingVaultImportCommit {
                    device_id: fixture.identity.device_id().clone(),
                    label: "Imported".to_owned(),
                },
            }
            .check()
            .await?;
        }
        assert!(directory.identities().is_empty());
        let checked = ExistingVaultHandoff {
            directory: &mut directory,
            events: &store,
            store_id: &fixture.store_id,
            app_key: &fixture.identity,
            signing_public_key: &events.signing_public_key,
            existing: ExistingVaultImportCommit {
                device_id: fixture.identity.device_id().clone(),
                label: "Imported".to_owned(),
            },
        }
        .check()
        .await?;
        let imported = checked.import()?;
        assert_eq!(directory.identities().len(), 1);
        assert_eq!(directory.selected()?.identity_id, imported.identity_id);
        assert_eq!(
            imported.vault_keys.secrets_key,
            fixture
                .identity
                .decrypt_envelope(&fixture.secrets_envelope)?
        );
        transaction.done().await.map_err(|error| {
            NookError::IndexedDb(format!("Admission completion error: {error:?}"))
        })?;
        assert!(
            identity_record::load_identity_directory()
                .await?
                .identities()
                .is_empty()
        );
        assert!(event_db::load_signing_seed().await?.is_none());
        indexed_db::clear_vault_db().await
    }
}

//! Atomic identity handoff persistence and authorization checks.

use crate::manager;
use crate::manager::PendingExtensionIdentityEnrollment;
use crate::storage::event_db;
use nook_core::{IdentityVaultDekEpoch, IdentityVaultDekEpochUpdate, IdentityVaultEventId};
use rexie::TransactionMode;

#[cfg(test)]
use super::load_identity_directory;
use super::{IDENTITY_DIRECTORY_KEY, map_domain_error};
use crate::{NookError, storage::open_nook_database};

pub(crate) struct IdentityHandoffCommit<'a> {
    pub(crate) app_key: &'a nook_core::AppKey,
    pub(crate) signing_public_key: &'a nook_core::DeviceSigningPublicKey,
    pub(crate) authorizer_signing:
        Option<&'a (nook_core::AppId, nook_core::DeviceSigningPublicKey)>,
    pub(crate) enrollment: &'a manager::PendingExtensionIdentityEnrollment,
    pub(crate) signing_seed: Option<&'a str>,
    pub(crate) existing_vault: Option<ExistingVaultImportCommit>,
}

pub(crate) struct ExistingVaultImportCommit {
    pub(crate) device_id: nook_core::DeviceId,
    pub(crate) label: String,
}

pub(crate) struct IdentityHandoffCommitResult {
    pub(crate) existing_vault_keys: Option<nook_core::VaultKeys>,
}

struct ExistingVaultHandoffResult {
    identity_id: nook_core::IdentityId,
    vault_keys: nook_core::VaultKeys,
}

struct ExistingVaultHandoff<'a> {
    directory: &'a mut nook_core::IdentityDirectory,
    events: &'a rexie::Store,
    store_id: &'a nook_core::StoreId,
    app_key: &'a nook_core::AppKey,
    signing_public_key: &'a nook_core::DeviceSigningPublicKey,
    existing: ExistingVaultImportCommit,
}

fn identity_checkpoint_ancestors(
    graph: &nook_core::EventGraph,
    checkpoint_event_id: &nook_core::EventId,
) -> Result<Vec<nook_core::IdentityVaultEventId>, NookError> {
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

async fn import_existing_vault_handoff(
    input: ExistingVaultHandoff<'_>,
) -> Result<ExistingVaultHandoffResult, NookError> {
    let graph = event_db::load_local_event_store_from_store(input.events, input.store_id.as_str())
        .await?
        .load_graph(input.store_id.as_str())?;
    if !graph.pending_events().is_empty() {
        return Err(NookError::Database(
            "Imported extension identity has an incomplete signed vault event graph.".to_owned(),
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
    let checkpoint_ancestors = identity_checkpoint_ancestors(&graph, &checkpoint_event_id)?;
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
    let identity_id = input
        .directory
        .import_legacy_vault(
            &input.existing.label,
            input.app_key,
            input.store_id.clone(),
            nook_core::IdentityVaultDekReconciliation {
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
            },
        )
        .map_err(map_domain_error)?;
    let vault_keys = input
        .directory
        .open_or_generate_vault_dek_for_identity(
            &identity_id,
            input.app_key,
            input.store_id.clone(),
        )
        .map_err(map_domain_error)?;
    Ok(ExistingVaultHandoffResult {
        identity_id,
        vault_keys,
    })
}

fn handoff_store_names(
    enrollment: &manager::PendingExtensionIdentityEnrollment,
) -> &'static [&'static str] {
    if matches!(
        enrollment,
        PendingExtensionIdentityEnrollment::ExistingVaultImport { .. }
    ) {
        &["vault", "events"]
    } else {
        &["vault"]
    }
}

async fn persist_handoff_signing_seed(
    store: &rexie::Store,
    signing_seed: Option<&str>,
) -> Result<(), NookError> {
    let Some(seed) = signing_seed else {
        return Ok(());
    };
    let seed_key = serde_wasm_bindgen::to_value(event_db::SIGNING_SEED_KEY)
        .map_err(|error| NookError::IndexedDb(format!("Handoff seed key error: {error:?}")))?;
    let seed_value = serde_wasm_bindgen::to_value(seed)
        .map_err(|error| NookError::IndexedDb(format!("Handoff seed value error: {error:?}")))?;
    store
        .put(&seed_value, Some(&seed_key))
        .await
        .map_err(|error| NookError::IndexedDb(format!("Handoff seed write error: {error:?}")))?;
    Ok(())
}

/// Commit identity membership and its matching event signer in one transaction.
pub(crate) async fn commit_authenticated_identity_handoff(
    input: IdentityHandoffCommit<'_>,
) -> Result<IdentityHandoffCommitResult, NookError> {
    let rexie = open_nook_database().await?;
    let transaction = rexie
        .transaction(
            handoff_store_names(input.enrollment),
            TransactionMode::ReadWrite,
        )
        .map_err(|error| NookError::IndexedDb(format!("Handoff transaction error: {error:?}")))?;
    let store = transaction.store("vault").map_err(|error| {
        NookError::IndexedDb(format!("Handoff transaction store error: {error:?}"))
    })?;
    let directory_key = serde_wasm_bindgen::to_value(IDENTITY_DIRECTORY_KEY)
        .map_err(|error| NookError::IndexedDb(format!("Handoff key error: {error:?}")))?;
    let legacy_key = serde_wasm_bindgen::to_value(super::LEGACY_IDENTITY_RECORD_KEY)
        .map_err(|error| NookError::IndexedDb(format!("Handoff legacy key error: {error:?}")))?;
    let mut directory = super::load_directory_for_write(&store).await?;
    let (identity_id, existing_vault_keys) = match input.enrollment {
        PendingExtensionIdentityEnrollment::VaultCreation { .. } => {
            return Err(NookError::Database(
                "Vault-creation identity must publish with verified genesis.".to_owned(),
            ));
        }
        PendingExtensionIdentityEnrollment::PairedVault {
            authorizer,
            store_id,
        } => (
            directory
                .enroll_app_key_for_owned_vault(authorizer, input.app_key, store_id)
                .map_err(map_domain_error)?,
            None,
        ),
        PendingExtensionIdentityEnrollment::PairedVaultSessionUnlock { .. } => {
            return Err(NookError::Database(
                "Paired session unlock does not publish identity membership.".to_owned(),
            ));
        }
        PendingExtensionIdentityEnrollment::ExistingVaultImport { store_id } => {
            let existing = input.existing_vault.ok_or_else(|| {
                NookError::Database("Existing-vault handoff material is missing.".to_owned())
            })?;
            let events = transaction.store("events").map_err(|error| {
                NookError::IndexedDb(format!("Handoff event store error: {error:?}"))
            })?;
            let imported = import_existing_vault_handoff(ExistingVaultHandoff {
                directory: &mut directory,
                events: &events,
                store_id,
                app_key: input.app_key,
                signing_public_key: input.signing_public_key,
                existing,
            })
            .await?;
            (imported.identity_id, Some(imported.vault_keys))
        }
    };
    directory
        .set_member_signing_public_key(
            &identity_id,
            input.app_key.app_id(),
            input.signing_public_key,
        )
        .map_err(map_domain_error)?;
    if let Some((app_id, signing_public_key)) = input.authorizer_signing {
        directory
            .set_member_signing_public_key(&identity_id, app_id, signing_public_key)
            .map_err(map_domain_error)?;
    }
    directory.validate().map_err(map_domain_error)?;
    let encoded = serde_json::to_string(&directory)
        .map_err(|error| NookError::IndexedDb(format!("Handoff encode error: {error}")))?;
    let encoded_value = serde_wasm_bindgen::to_value(&encoded)
        .map_err(|error| NookError::IndexedDb(format!("Handoff value error: {error:?}")))?;
    store
        .put(&encoded_value, Some(&directory_key))
        .await
        .map_err(|error| NookError::IndexedDb(format!("Handoff write error: {error:?}")))?;
    store
        .delete(legacy_key)
        .await
        .map_err(|error| NookError::IndexedDb(format!("Handoff legacy delete error: {error:?}")))?;
    persist_handoff_signing_seed(&store, input.signing_seed).await?;
    transaction.done().await.map_err(|error| {
        NookError::IndexedDb(format!("Handoff transaction completion error: {error:?}"))
    })?;
    Ok(IdentityHandoffCommitResult {
        existing_vault_keys,
    })
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

    use super::*;
    use crate::storage::{event_db, identity_record::clear_identity_directory_for_test};
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    struct ImportFixture {
        identity: nook_core::DeviceIdentity,
        store_id: nook_core::StoreId,
        secrets_envelope: nook_core::AgeArmoredCiphertext,
        members_envelope: nook_core::AgeArmoredCiphertext,
    }

    fn import_fixture() -> Result<ImportFixture, NookError> {
        let identity = DeviceIdentity::generate().map_err(map_domain_error)?;
        let store_id = nook_core::generate_store_id().map_err(map_domain_error)?;
        let mut material = IdentityDirectory::empty();
        let identity_id = material
            .create_identity("Imported", &identity, None)
            .map_err(map_domain_error)?;
        let _ = material
            .open_or_generate_vault_dek_for_identity(&identity_id, &identity, store_id.clone())
            .map_err(map_domain_error)?;
        let grant = &material.selected().map_err(map_domain_error)?.vault_deks[0];
        Ok(ImportFixture {
            identity,
            store_id,
            secrets_envelope: grant.secrets_envelopes[0].envelope.clone(),
            members_envelope: grant.members_envelopes[0].envelope.clone(),
        })
    }

    async fn assert_nothing_published(
        signing_seed_before: Option<&String>,
    ) -> Result<(), NookError> {
        assert!(load_identity_directory().await?.identities().is_empty());
        assert_eq!(
            event_db::load_signing_seed().await?.as_ref(),
            signing_seed_before
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn rejects_before_publishing_without_active_roster() -> Result<(), NookError> {
        clear_identity_directory_for_test().await?;
        let fixture = import_fixture()?;
        let signing_seed_before = event_db::load_signing_seed().await?;
        let signing_public_key = DeviceSigningPublicKey::parse(&"22".repeat(32))
            .map_err(|error| NookError::Database(error.to_string()))?;
        let enrollment = PendingExtensionIdentityEnrollment::ExistingVaultImport {
            store_id: fixture.store_id.clone(),
        };
        let signing_seed = "33".repeat(32);
        let result = commit_authenticated_identity_handoff(IdentityHandoffCommit {
            app_key: &fixture.identity,
            signing_public_key: &signing_public_key,
            authorizer_signing: None,
            enrollment: &enrollment,
            signing_seed: Some(&signing_seed),
            existing_vault: Some(ExistingVaultImportCommit {
                device_id: fixture.identity.device_id().clone(),
                label: "Imported".to_owned(),
            }),
        })
        .await;

        assert!(result.is_err());
        assert_nothing_published(signing_seed_before.as_ref()).await?;
        clear_identity_directory_for_test().await?;
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

    #[allow(clippy::too_many_lines)] // One fixture keeps the causal access-event chain auditable.
    fn signed_access_events(fixture: &ImportFixture) -> Result<SignedAccessEvents, NookError> {
        let (signing, _) =
            SigningIdentity::generate().map_err(|error| NookError::Database(error.to_string()))?;
        let signing_public_key = signing.public_key();
        let actor_id = signing
            .actor_id()
            .map_err(|error| NookError::Database(error.to_string()))?;
        let key_epoch = EventId::parse("sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo")
            .map_err(|error| NookError::Database(error.to_string()))?;
        let created_at = IsoTimestamp::from_trusted("2026-08-15T00:00:00Z".to_owned());
        let (approval, approval_bytes) =
            nook_core::build_signed_event(nook_core::AppendEventInput {
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
        let replacement_keys = nook_core::generate_vault_keys().map_err(map_domain_error)?;
        let replacement_secrets = nook_core::encrypt_for_recipient(
            replacement_keys.secrets_key.as_str().as_bytes(),
            &fixture.identity.public_key(),
        )
        .map_err(map_domain_error)?;
        let replacement_members = nook_core::encrypt_for_recipient(
            replacement_keys.members_key.as_str().as_bytes(),
            &fixture.identity.public_key(),
        )
        .map_err(map_domain_error)?;
        let (replacement, replacement_bytes) =
            nook_core::build_signed_event(nook_core::AppendEventInput {
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
            nook_core::build_signed_event(nook_core::AppendEventInput {
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
        let missing_parent = EventId::parse("sha256u:rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrro")
            .map_err(|error| NookError::Database(error.to_string()))?;
        let (pending_revocation, pending_revocation_bytes) =
            nook_core::build_signed_event(nook_core::AppendEventInput {
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
            approval_bytes,
            replacement_id: replacement
                .id()
                .map_err(|error| NookError::Database(error.to_string()))?,
            replacement_bytes,
            replacement_keys,
            revocation_id: revocation
                .id()
                .map_err(|error| NookError::Database(error.to_string()))?,
            revocation_bytes,
            pending_revocation_id: pending_revocation
                .id()
                .map_err(|error| NookError::Database(error.to_string()))?,
            pending_revocation_bytes,
        })
    }

    #[test]
    fn selected_checkpoint_ancestors_exclude_concurrent_siblings() -> Result<(), NookError> {
        let fixture = import_fixture()?;
        let events = signed_access_events(&fixture)?;
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
            local.put_event(event_id, bytes);
        }
        let graph = local.load_graph(fixture.store_id.as_str())?;

        let ancestors = identity_checkpoint_ancestors(&graph, &events.replacement_id)?;

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

    #[wasm_bindgen_test]
    async fn handoff_uses_latest_transactional_roster_envelopes() -> Result<(), NookError> {
        clear_identity_directory_for_test().await?;
        let fixture = import_fixture()?;
        event_db::clear_local_event_store(fixture.store_id.as_str()).await?;
        let events = signed_access_events(&fixture)?;
        for (event_id, bytes) in [
            (&events.approval_id, &events.approval_bytes),
            (&events.replacement_id, &events.replacement_bytes),
        ] {
            event_db::save_event_bytes(fixture.store_id.as_str(), event_id.as_str(), bytes).await?;
        }
        let enrollment = PendingExtensionIdentityEnrollment::ExistingVaultImport {
            store_id: fixture.store_id.clone(),
        };

        let committed = commit_authenticated_identity_handoff(IdentityHandoffCommit {
            app_key: &fixture.identity,
            signing_public_key: &events.signing_public_key,
            authorizer_signing: None,
            enrollment: &enrollment,
            signing_seed: None,
            existing_vault: Some(ExistingVaultImportCommit {
                device_id: fixture.identity.device_id().clone(),
                label: "Imported".to_owned(),
            }),
        })
        .await?;
        assert_eq!(
            committed.existing_vault_keys,
            Some(events.replacement_keys.clone())
        );

        let mut directory = load_identity_directory().await?;
        assert_eq!(
            directory
                .open_or_generate_vault_dek(&fixture.identity, fixture.store_id.clone())
                .map_err(map_domain_error)?,
            events.replacement_keys
        );
        event_db::clear_local_event_store(fixture.store_id.as_str()).await?;
        clear_identity_directory_for_test().await
    }

    #[wasm_bindgen_test]
    async fn handoff_transaction_preserves_pending_identity_during_migration()
    -> Result<(), NookError> {
        clear_identity_directory_for_test().await?;
        let fixture = import_fixture()?;
        event_db::clear_local_event_store(fixture.store_id.as_str()).await?;
        let events = signed_access_events(&fixture)?;
        event_db::save_event_bytes(
            fixture.store_id.as_str(),
            events.approval_id.as_str(),
            &events.approval_bytes,
        )
        .await?;
        let mut directory = IdentityDirectory::empty();
        let pending_identity_id = directory
            .create_identity("Pending", &fixture.identity, None)
            .map_err(map_domain_error)?;
        directory
            .create_identity("Concurrent duplicate", &fixture.identity, None)
            .map_err(map_domain_error)?;
        indexed_db::idb_put_string(
            IDENTITY_DIRECTORY_KEY,
            &serde_json::to_string(&directory)
                .map_err(|error| NookError::Serialization(error.to_string()))?,
        )
        .await?;
        indexed_db::idb_put_string(
            identity_record::PENDING_SIMPLE_GENESIS_KEY,
            &serde_json::json!({
                "storeId": fixture.store_id.as_str(),
                "identityId": pending_identity_id.as_str(),
            })
            .to_string(),
        )
        .await?;
        let enrollment = PendingExtensionIdentityEnrollment::ExistingVaultImport {
            store_id: fixture.store_id.clone(),
        };

        commit_authenticated_identity_handoff(IdentityHandoffCommit {
            app_key: &fixture.identity,
            signing_public_key: &events.signing_public_key,
            authorizer_signing: None,
            enrollment: &enrollment,
            signing_seed: None,
            existing_vault: Some(ExistingVaultImportCommit {
                device_id: fixture.identity.device_id().clone(),
                label: "Imported".to_owned(),
            }),
        })
        .await?;

        let current = load_identity_directory().await?;
        let pending = identity_record::pending_simple_genesis_for_store(fixture.store_id.as_str())
            .await?
            .ok_or_else(|| NookError::Database("Pending marker disappeared.".to_owned()))?;
        assert_eq!(current.identities().len(), 1);
        assert_eq!(current.selected()?.identity_id, pending_identity_id);
        assert!(current.selected()?.owns_vault(&fixture.store_id));
        assert_eq!(pending.identity_id, pending_identity_id);
        event_db::clear_local_event_store(fixture.store_id.as_str()).await?;
        clear_identity_directory_for_test().await
    }

    #[wasm_bindgen_test]
    async fn rejects_handoff_with_pending_roster_event() -> Result<(), NookError> {
        clear_identity_directory_for_test().await?;
        let fixture = import_fixture()?;
        let signing_seed_before = event_db::load_signing_seed().await?;
        event_db::clear_local_event_store(fixture.store_id.as_str()).await?;
        let events = signed_access_events(&fixture)?;
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

        let result = commit_authenticated_identity_handoff(IdentityHandoffCommit {
            app_key: &fixture.identity,
            signing_public_key: &events.signing_public_key,
            authorizer_signing: None,
            enrollment: &enrollment,
            signing_seed: Some(&signing_seed),
            existing_vault: Some(ExistingVaultImportCommit {
                device_id: fixture.identity.device_id().clone(),
                label: "Imported".to_owned(),
            }),
        })
        .await;

        assert!(result.is_err());
        assert_nothing_published(signing_seed_before.as_ref()).await?;
        event_db::clear_local_event_store(fixture.store_id.as_str()).await?;
        clear_identity_directory_for_test().await
    }

    #[wasm_bindgen_test]
    async fn concurrent_revocation_serializes_before_handoff() -> Result<(), NookError> {
        clear_identity_directory_for_test().await?;
        let fixture = import_fixture()?;
        let signing_seed_before = event_db::load_signing_seed().await?;
        event_db::clear_local_event_store(fixture.store_id.as_str()).await?;
        let events = signed_access_events(&fixture)?;
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

        let rexie = open_nook_database().await?;
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
        let handoff = commit_authenticated_identity_handoff(IdentityHandoffCommit {
            app_key: &fixture.identity,
            signing_public_key: &events.signing_public_key,
            authorizer_signing: None,
            enrollment: &enrollment,
            signing_seed: Some(&signing_seed),
            existing_vault: Some(ExistingVaultImportCommit {
                device_id: fixture.identity.device_id().clone(),
                label: "Imported".to_owned(),
            }),
        });
        let (revocation_result, handoff_result) = future::join(revocation_write, handoff).await;

        revocation_result?;
        assert!(handoff_result.is_err());
        assert_nothing_published(signing_seed_before.as_ref()).await?;
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
        clear_identity_directory_for_test().await?;
        Ok(())
    }
}

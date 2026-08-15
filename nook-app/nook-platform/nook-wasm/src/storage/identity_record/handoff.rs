//! Atomic identity handoff persistence and authorization checks.

use super::{IDENTITY_DIRECTORY_KEY, decode_directory, load_identity_directory, map_domain_error};
use crate::{NookError, storage::open_nook_database};

pub(crate) struct IdentityHandoffCommit<'a> {
    pub(crate) app_key: &'a nook_core::AppKey,
    pub(crate) signing_public_key: &'a nook_core::DeviceSigningPublicKey,
    pub(crate) authorizer_signing:
        Option<&'a (nook_core::AppId, nook_core::DeviceSigningPublicKey)>,
    pub(crate) enrollment: &'a crate::manager::PendingExtensionIdentityEnrollment,
    pub(crate) signing_seed: Option<&'a str>,
    pub(crate) existing_vault: Option<ExistingVaultImportCommit>,
}

pub(crate) struct ExistingVaultImportCommit {
    pub(crate) device_id: nook_core::DeviceId,
    pub(crate) label: String,
}

struct ExistingVaultHandoff<'a> {
    directory: &'a mut nook_core::IdentityDirectory,
    events: &'a rexie::Store,
    store_id: &'a nook_core::StoreId,
    app_key: &'a nook_core::AppKey,
    signing_public_key: &'a nook_core::DeviceSigningPublicKey,
    existing: ExistingVaultImportCommit,
}

async fn import_existing_vault_handoff(
    input: ExistingVaultHandoff<'_>,
) -> Result<nook_core::IdentityId, NookError> {
    let graph = crate::storage::event_db::load_local_event_store_from_store(
        input.events,
        input.store_id.as_str(),
    )
    .await?
    .load_graph(input.store_id.as_str())?;
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
    input
        .directory
        .import_legacy_vault(
            &input.existing.label,
            input.app_key,
            input.store_id.clone(),
            nook_core::IdentityVaultDekReconciliation {
                secrets_envelope: envelopes.secrets_key,
                members_envelope: envelopes.members_key,
                authorized_auth_ids: nook_core::event_graph_active_auth_ids(&graph)?,
            },
        )
        .map_err(map_domain_error)
}

fn handoff_store_names(
    enrollment: &crate::manager::PendingExtensionIdentityEnrollment,
) -> &'static [&'static str] {
    if matches!(
        enrollment,
        crate::manager::PendingExtensionIdentityEnrollment::ExistingVaultImport { .. }
    ) {
        &["vault", "events"]
    } else {
        &["vault"]
    }
}

/// Commit identity membership and its matching event signer in one transaction.
pub(crate) async fn commit_authenticated_identity_handoff(
    input: IdentityHandoffCommit<'_>,
) -> Result<(), NookError> {
    let _ = load_identity_directory().await?;
    let rexie = open_nook_database().await?;
    let transaction = rexie
        .transaction(
            handoff_store_names(input.enrollment),
            rexie::TransactionMode::ReadWrite,
        )
        .map_err(|error| NookError::IndexedDb(format!("Handoff transaction error: {error:?}")))?;
    let store = transaction.store("vault").map_err(|error| {
        NookError::IndexedDb(format!("Handoff transaction store error: {error:?}"))
    })?;
    let directory_key = serde_wasm_bindgen::to_value(IDENTITY_DIRECTORY_KEY)
        .map_err(|error| NookError::IndexedDb(format!("Handoff key error: {error:?}")))?;
    let directory_value = store.get(directory_key.clone()).await.map_err(|error| {
        NookError::IndexedDb(format!("Handoff directory read error: {error:?}"))
    })?;
    let mut directory = directory_value
        .filter(|value| !value.is_undefined() && !value.is_null())
        .map(|value| {
            let raw: String = serde_wasm_bindgen::from_value(value).map_err(|error| {
                NookError::IndexedDb(format!("Handoff directory decode error: {error:?}"))
            })?;
            decode_directory(&raw)
        })
        .transpose()?
        .unwrap_or_else(nook_core::IdentityDirectory::empty);
    let identity_id = match input.enrollment {
        crate::manager::PendingExtensionIdentityEnrollment::VaultCreation { .. } => {
            return Err(NookError::Database(
                "Vault-creation identity must publish with verified genesis.".to_owned(),
            ));
        }
        crate::manager::PendingExtensionIdentityEnrollment::PairedVault {
            authorizer,
            store_id,
        } => directory
            .enroll_app_key_for_owned_vault(authorizer, input.app_key, store_id)
            .map_err(map_domain_error)?,
        crate::manager::PendingExtensionIdentityEnrollment::ExistingVaultImport { store_id } => {
            let existing = input.existing_vault.ok_or_else(|| {
                NookError::Database("Existing-vault handoff material is missing.".to_owned())
            })?;
            let events = transaction.store("events").map_err(|error| {
                NookError::IndexedDb(format!("Handoff event store error: {error:?}"))
            })?;
            import_existing_vault_handoff(ExistingVaultHandoff {
                directory: &mut directory,
                events: &events,
                store_id,
                app_key: input.app_key,
                signing_public_key: input.signing_public_key,
                existing,
            })
            .await?
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
    if let Some(seed) = input.signing_seed {
        let seed_key = serde_wasm_bindgen::to_value(crate::storage::event_db::SIGNING_SEED_KEY)
            .map_err(|error| NookError::IndexedDb(format!("Handoff seed key error: {error:?}")))?;
        let seed_value = serde_wasm_bindgen::to_value(seed).map_err(|error| {
            NookError::IndexedDb(format!("Handoff seed value error: {error:?}"))
        })?;
        store
            .put(&seed_value, Some(&seed_key))
            .await
            .map_err(|error| {
                NookError::IndexedDb(format!("Handoff seed write error: {error:?}"))
            })?;
    }
    transaction.done().await.map_err(|error| {
        NookError::IndexedDb(format!("Handoff transaction completion error: {error:?}"))
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
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
        let identity = nook_core::DeviceIdentity::generate().map_err(map_domain_error)?;
        let store_id = nook_core::generate_store_id().map_err(map_domain_error)?;
        let mut material = nook_core::IdentityDirectory::empty();
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
        signing_seed_before: &Option<String>,
    ) -> Result<(), NookError> {
        assert!(load_identity_directory().await?.identities().is_empty());
        assert_eq!(&event_db::load_signing_seed().await?, signing_seed_before);
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn rejects_before_publishing_without_active_roster() -> Result<(), NookError> {
        clear_identity_directory_for_test().await?;
        let fixture = import_fixture()?;
        let signing_seed_before = event_db::load_signing_seed().await?;
        let signing_public_key = nook_core::DeviceSigningPublicKey::parse(&"22".repeat(32))
            .map_err(|error| NookError::Database(error.to_string()))?;
        let enrollment = crate::manager::PendingExtensionIdentityEnrollment::ExistingVaultImport {
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
        assert_nothing_published(&signing_seed_before).await?;
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
    }

    fn signed_access_events(fixture: &ImportFixture) -> Result<SignedAccessEvents, NookError> {
        let (signing, _) = nook_core::SigningIdentity::generate()
            .map_err(|error| NookError::Database(error.to_string()))?;
        let signing_public_key = signing.public_key();
        let actor_id = signing
            .actor_id()
            .map_err(|error| NookError::Database(error.to_string()))?;
        let key_epoch =
            nook_core::EventId::parse("sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo")
                .map_err(|error| NookError::Database(error.to_string()))?;
        let created_at = nook_core::IsoTimestamp::from_trusted("2026-08-15T00:00:00Z".to_owned());
        let (approval, approval_bytes) =
            nook_core::build_signed_event(nook_core::AppendEventInput {
                store_id: &fixture.store_id,
                actor_id: &actor_id,
                signing_identity: &signing,
                parents: Vec::new(),
                key_epoch: &key_epoch,
                created_at: &created_at,
                operations: vec![
                    nook_core::VaultOperation::VaultImported {
                        source_content_hash: nook_core::Sha256Hex::from_trusted("0".repeat(64)),
                        secrets: Vec::new(),
                        password_entries: Vec::new(),
                    },
                    nook_core::VaultOperation::JoinApproved {
                        device_id: fixture.identity.device_id().clone(),
                        encryption_public_key: fixture.identity.public_key(),
                        signing_public_key: signing_public_key.clone(),
                        label: nook_core::MemberLabel::from_trusted("Imported".to_owned()),
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
                operations: vec![nook_core::VaultOperation::JoinApproved {
                    device_id: fixture.identity.device_id().clone(),
                    encryption_public_key: fixture.identity.public_key(),
                    signing_public_key: signing_public_key.clone(),
                    label: nook_core::MemberLabel::from_trusted("Imported".to_owned()),
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
                operations: vec![nook_core::VaultOperation::DeviceRevoked {
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
        })
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
        let enrollment = crate::manager::PendingExtensionIdentityEnrollment::ExistingVaultImport {
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
            .transaction(&["events"], rexie::TransactionMode::ReadWrite)
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
        let enrollment = crate::manager::PendingExtensionIdentityEnrollment::ExistingVaultImport {
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
        let (revocation_result, handoff_result) =
            futures_util::future::join(revocation_write, handoff).await;

        revocation_result?;
        assert!(handoff_result.is_err());
        assert_nothing_published(&signing_seed_before).await?;
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

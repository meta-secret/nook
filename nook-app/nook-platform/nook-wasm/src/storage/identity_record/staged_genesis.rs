#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! Staged identity ownership for crash-safe fresh-vault genesis.

use super::LocalIdentityRecovery;
use crate::BrowserTimestamp;
use crate::StoredStringRecord;
use crate::storage::identity_record::IdentityDirectoryWrite;
use crate::{IdbPutStringRequest, IndexedDbUpdate, NookDatabase};
use nook_core::AppKeyIdentityMembership;
use nook_core::IsoTimestamp;
use nook_core::MemberLabelState;
use nook_core::StoredSigningSeed;
use nook_core::{
    DirectoryCreationEnrollment, DirectoryMemberSigningUpdate, DirectoryOwnedVaultOpening,
    IdentityCreation, IdentityMemberSigningUpdate, IdentityVaultKeyOpening,
};

use std::{cell::RefCell, rc::Rc};

use super::genesis_flow::PendingSimpleGenesisFlow;
use super::simple_genesis::{
    PENDING_SIMPLE_GENESIS_KEY, PendingSimpleGenesis, PendingSimpleGenesisEvent,
};
use crate::storage::indexed_db::{self, StringUpdateGuard};
use crate::{NookError, conversion};

#[derive(Clone, Debug, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StagedSimpleGenesisIdentity {
    pub(crate) base_directory: nook_core::IdentityDirectory,
    pub(crate) directory: nook_core::IdentityDirectory,
}

pub(crate) struct StagedSimpleGenesisInput<'a> {
    pub(crate) app_key: &'a nook_core::AppKey,
    pub(crate) signing_public_key: &'a nook_core::DeviceSigningPublicKey,
    pub(crate) authorizer: Option<&'a nook_core::AppKey>,
    pub(crate) authorizer_signing:
        Option<&'a (nook_core::AppId, nook_core::DeviceSigningPublicKey)>,
    pub(crate) label: &'a str,
}

impl StagedSimpleGenesisInput<'_> {
    fn bind_identity(
        &self,
        mut directory: nook_core::IdentityDirectory,
    ) -> Result<nook_core::IdentityDirectoryResolution, NookError> {
        let live_owner = self.authorizer.unwrap_or(self.app_key);
        let owner_identity_id = match directory
            .identity_for_app_key(live_owner)
            .map_err(NookDatabase::map_domain_error)?
        {
            AppKeyIdentityMembership::Enrolled(identity_id) => {
                directory = directory
                    .select(&identity_id)
                    .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?;
                identity_id
            }
            AppKeyIdentityMembership::Unenrolled => {
                let created = directory
                    .create_identity(IdentityCreation {
                        label: self.label,
                        app_key: live_owner,
                        member_label: MemberLabelState::Unnamed,
                    })
                    .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?;
                directory = created.directory;
                created.identity_id
            }
        };
        if matches!(directory
            .identity_for_app_key(self.app_key)
            .map_err(NookDatabase::map_domain_error)?
            , AppKeyIdentityMembership::Enrolled(identity_id) if identity_id != owner_identity_id)
        {
            return Err(NookError::Database(
                "Staged app key belongs to another local identity.".to_owned(),
            ));
        }
        let enrolled = directory
            .enroll_selected_app_key_for_vault_creation(DirectoryCreationEnrollment {
                app_key: self.app_key,
                label: self.label,
            })
            .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?;
        if enrolled.identity_id != owner_identity_id {
            return Err(NookError::Database(
                "Staged app key resolved to another local identity.".to_owned(),
            ));
        }
        Ok(enrolled)
    }
    pub(crate) async fn begin_or_resume(
        self,
    ) -> Result<
        (
            PendingSimpleGenesis,
            nook_core::IdentityRecord,
            nook_core::VaultKeys,
        ),
        NookError,
    > {
        let input = self;
        if LocalIdentityRecovery::has_pending().await? {
            return Err(NookError::Database(
                "Pending identity recovery cleanup must finish before staged vault creation."
                    .to_owned(),
            ));
        }
        let base_directory = NookDatabase::load_identity_directory().await?;
        // Both snapshots are retained as distinct rollback/concurrency evidence.
        let bound = input.bind_identity(base_directory.clone())?;
        let mut staged_directory = bound.directory;
        let identity_id = bound.identity_id;
        staged_directory = staged_directory
            .set_member_signing_public_key(DirectoryMemberSigningUpdate {
                identity_id: &identity_id,
                member: IdentityMemberSigningUpdate {
                    app_id: input.app_key.app_id(),
                    signing_public_key: input.signing_public_key,
                },
            })
            .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?;
        if let Some((app_id, signing_public_key)) = input.authorizer_signing {
            staged_directory = staged_directory
                .set_member_signing_public_key(DirectoryMemberSigningUpdate {
                    identity_id: &identity_id,
                    member: IdentityMemberSigningUpdate {
                        app_id: app_id,
                        signing_public_key: signing_public_key,
                    },
                })
                .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?;
        }
        let store_id = nook_core::StoreId::generate().map_err(NookDatabase::map_domain_error)?;
        let opened_identity = staged_directory
            .open_or_generate_vault_dek_for_identity(DirectoryOwnedVaultOpening {
                identity_id: &identity_id,
                vault: IdentityVaultKeyOpening {
                    app_key: input.app_key,
                    store_id: store_id.clone(),
                },
            })
            .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?;
        staged_directory = opened_identity.directory;
        let proposed = PendingSimpleGenesis {
            store_id,
            identity_id,
            created_at: IsoTimestamp::parse(&BrowserTimestamp::now().into_iso_string())
                .map_err(|error| NookError::Database(error.to_string()))?,
            event_state: PendingSimpleGenesisEvent::AwaitingEvent,
            flow: PendingSimpleGenesisFlow::Staged(StagedSimpleGenesisIdentity {
                base_directory,
                directory: staged_directory,
            }),
        };
        let selected = Rc::new(RefCell::new(None));
        let captured = Rc::clone(&selected);
        NookDatabase::idb_update_string(IndexedDbUpdate {
            key: PENDING_SIMPLE_GENESIS_KEY,
            guard: StringUpdateGuard::Unconditional,
            update: move |current| {
                let pending = match current {
                    StoredStringRecord::MissingKey => proposed,
                    StoredStringRecord::Stored(raw) => PendingSimpleGenesis::decode(&raw)?,
                };
                if !pending.is_staged() {
                    return Err(NookError::IndexedDb(
                        "Pending Simple genesis belongs to another creation flow.".to_owned(),
                    ));
                }
                let encoded = pending.encode()?;
                *captured.borrow_mut() = Some(pending);
                Ok(encoded)
            },
        })
        .await?;
        let pending = selected.borrow_mut().take().ok_or_else(|| {
            NookError::IndexedDb("Staged Simple genesis produced no result.".to_owned())
        })?;
        let staged = pending.staged_identity().ok_or_else(|| {
            NookError::IndexedDb("Staged Simple genesis lost its identity state.".to_owned())
        })?;
        let identity = staged
            .directory
            .identities()
            .iter()
            .find(|identity| identity.identity_id == pending.identity_id)
            .cloned()
            .ok_or_else(|| {
                NookError::Database("Staged genesis identity disappeared.".to_owned())
            })?;
        let keys = staged
            .directory
            .open_vault_dek_for_identity(DirectoryOwnedVaultOpening {
                identity_id: &pending.identity_id,
                vault: IdentityVaultKeyOpening {
                    app_key: input.app_key,
                    store_id: pending.store_id.clone(),
                },
            })
            .map_err(NookDatabase::map_domain_error)?;

        Ok((pending, identity, keys))
    }
}
#[cfg(test)]
mod tests {
    use crate::storage::identity_record::IdentityDirectoryWrite;

    use nook_core::{
        DirectoryCreationEnrollment, DirectoryOwnedVaultOpening, IdentityCreation,
        IdentityVaultKeyOpening,
    };

    use super::super::{SimpleGenesisCompletion, SimpleGenesisEventInput, recovery};
    use crate::storage::identity_record;
    use crate::storage::{event_db, indexed_db};
    use nook_core::{AppKey, IdentityDirectory, IsoTimestamp, SigningIdentity};

    use super::{
        NookError, PENDING_SIMPLE_GENESIS_KEY, PendingSimpleGenesis, PendingSimpleGenesisEvent,
        PendingSimpleGenesisFlow, StagedSimpleGenesisIdentity, StagedSimpleGenesisInput,
    };
    use wasm_bindgen_test::{wasm_bindgen_test, wasm_bindgen_test_configure};

    wasm_bindgen_test_configure!(run_in_browser);

    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct StagedGenesisCompatibilityWire {
        flow: PendingSimpleGenesisFlow,
        staged_identity: StagedSimpleGenesisIdentity,
    }

    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    #[wasm_bindgen_test]
    async fn staged_identity_publishes_only_with_genesis_cleanup() -> Result<(), NookError> {
        NookDatabase::clear_identity_directory_for_test().await?;
        let authorizer = AppKey::generate().map_err(NookDatabase::map_domain_error)?;
        let extension = AppKey::generate().map_err(NookDatabase::map_domain_error)?;
        let (authorizer_signing, _) =
            SigningIdentity::generate().map_err(|error| NookError::Database(error.to_string()))?;
        let (extension_signing, _) =
            SigningIdentity::generate().map_err(|error| NookError::Database(error.to_string()))?;
        let authorizer_signing_pair =
            (authorizer.app_id().clone(), authorizer_signing.public_key());
        let (pending, _, _) = StagedSimpleGenesisInput {
            app_key: &extension,
            signing_public_key: &extension_signing.public_key(),
            authorizer: Some(&authorizer),
            authorizer_signing: Some(&authorizer_signing_pair),
            label: "Personal",
        }
        .begin_or_resume()
        .await?;

        let encoded = pending.encode()?;
        let wire: StagedGenesisCompatibilityWire = serde_json::from_str(&encoded)
            .map_err(|error| NookError::Database(error.to_string()))?;
        let PendingSimpleGenesisFlow::Staged(current_staged) = wire.flow else {
            return Err(NookError::Database(
                "Staged marker serialized as an ordinary flow.".to_owned(),
            ));
        };
        assert_eq!(current_staged, wire.staged_identity);
        assert!(PendingSimpleGenesis::decode(&encoded)?.is_staged());

        assert!(
            NookDatabase::load_identity_directory()
                .await?
                .identities()
                .is_empty()
        );
        SimpleGenesisCompletion::Staged {
            pending: &pending,
            signing_seed: "staged-signing-seed",
        }
        .clear_pending()
        .await?;
        let published = NookDatabase::load_identity_directory().await?;
        let identity = published
            .selected()
            .map_err(NookDatabase::map_domain_error)?;
        assert_eq!(identity.members.len(), 2);
        assert!(identity.owns_vault(&pending.store_id));
        assert_eq!(
            NookDatabase::load_signing_seed().await?,
            StoredSigningSeed::Stored("staged-signing-seed".to_owned())
        );
        NookDatabase::idb_delete_key(event_db::SIGNING_SEED_KEY).await?;
        NookDatabase::clear_identity_directory_for_test().await
    }

    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    #[wasm_bindgen_test]
    async fn pending_recovery_cleanup_blocks_staged_genesis() -> Result<(), NookError> {
        NookDatabase::clear_identity_directory_for_test().await?;
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: recovery::PENDING_LOCAL_IDENTITY_RECOVERY_CLEANUP_KEY,
            value: "pending",
        })
        .await?;
        let app_key = AppKey::generate().map_err(NookDatabase::map_domain_error)?;
        let (signing, _) = SigningIdentity::generate()?;

        let result = StagedSimpleGenesisInput {
            app_key: &app_key,
            signing_public_key: &signing.public_key(),
            authorizer: None,
            authorizer_signing: None,
            label: "Personal",
        }
        .begin_or_resume()
        .await;

        assert!(matches!(
            result,
            Err(NookError::Database(message)) if message.contains("recovery cleanup")
        ));
        assert!(
            NookDatabase::idb_get_string(PENDING_SIMPLE_GENESIS_KEY)
                .await?
                .is_none()
        );
        NookDatabase::idb_delete_key(recovery::PENDING_LOCAL_IDENTITY_RECOVERY_CLEANUP_KEY).await?;
        NookDatabase::clear_identity_directory_for_test().await
    }

    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    #[wasm_bindgen_test]
    async fn staged_publish_refuses_to_overwrite_concurrent_identity_update()
    -> Result<(), NookError> {
        NookDatabase::clear_identity_directory_for_test().await?;
        let extension = AppKey::generate().map_err(NookDatabase::map_domain_error)?;
        let (extension_signing, _) =
            SigningIdentity::generate().map_err(|error| NookError::Database(error.to_string()))?;
        let (pending, _, _) = StagedSimpleGenesisInput {
            app_key: &extension,
            signing_public_key: &extension_signing.public_key(),
            authorizer: None,
            authorizer_signing: None,
            label: "Personal",
        }
        .begin_or_resume()
        .await?;
        let concurrent = AppKey::generate().map_err(NookDatabase::map_domain_error)?;
        let concurrent_update = concurrent.clone();
        NookDatabase::update_identity_directory(move |mut directory| {
            let resolved_identity = directory
                .create_identity(IdentityCreation {
                    label: "Concurrent",
                    app_key: &concurrent_update,
                    member_label: MemberLabelState::Unnamed,
                })
                .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?;
            directory = resolved_identity.directory;
            Ok(IdentityDirectoryWrite::from(directory))
        })
        .await?;

        SimpleGenesisCompletion::Staged {
            pending: &pending,
            signing_seed: "staged-signing-seed",
        }
        .clear_pending()
        .await?;
        let current = NookDatabase::load_identity_directory().await?;
        assert_eq!(current.identities().len(), 2);
        assert!(
            current
                .identities()
                .iter()
                .any(|identity| identity.owns_vault(&pending.store_id))
        );
        assert!(matches!(
            current.identity_for_app_key(&concurrent)?,
            AppKeyIdentityMembership::Enrolled(_)
        ));
        assert!(
            PendingSimpleGenesis::load_for_store(pending.store_id.as_str())
                .await?
                .is_none()
        );
        NookDatabase::clear_identity_directory_for_test().await?;
        NookDatabase::idb_delete_key(event_db::SIGNING_SEED_KEY).await
    }

    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    #[wasm_bindgen_test]
    async fn directory_update_preserves_pending_identity_during_fallback_migration()
    -> Result<(), NookError> {
        NookDatabase::clear_identity_directory_for_test().await?;
        let app_key = AppKey::generate().map_err(NookDatabase::map_domain_error)?;
        let mut directory = IdentityDirectory::empty();
        let resolved_identity = directory
            .create_identity(IdentityCreation {
                label: "Pending",
                app_key: &app_key,
                member_label: MemberLabelState::Unnamed,
            })
            .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?;
        directory = resolved_identity.directory;
        let pending_identity_id = resolved_identity.identity_id;
        let resolved_identity = directory
            .create_identity(IdentityCreation {
                label: "Concurrent duplicate",
                app_key: &app_key,
                member_label: MemberLabelState::Unnamed,
            })
            .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?;
        directory = resolved_identity.directory;
        let store_id = nook_core::StoreId::generate().map_err(NookDatabase::map_domain_error)?;
        let pending = PendingSimpleGenesis {
            store_id,
            identity_id: pending_identity_id.clone(),
            created_at: IsoTimestamp::parse("2026-08-15T00:00:00.000Z")
                .map_err(|error| NookError::Database(error.to_string()))?,
            event_state: PendingSimpleGenesisEvent::AwaitingEvent,
            flow: PendingSimpleGenesisFlow::Staged(StagedSimpleGenesisIdentity {
                base_directory: directory.clone(),
                directory: directory.clone(),
            }),
        };
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: identity_record::IDENTITY_DIRECTORY_KEY,
            value: &serde_json::to_string(&directory)
                .map_err(|error| NookError::Serialization(error.to_string()))?,
        })
        .await?;
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: PENDING_SIMPLE_GENESIS_KEY,
            value: &pending.encode()?,
        })
        .await?;

        NookDatabase::update_identity_directory(|directory| {
            Ok(IdentityDirectoryWrite::from(directory))
        })
        .await?;

        let current = NookDatabase::load_identity_directory().await?;
        let normalized = PendingSimpleGenesis::load_for_store(pending.store_id.as_str())
            .await?
            .ok_or_else(|| NookError::Database("Pending marker disappeared.".to_owned()))?;
        let staged = normalized
            .staged_identity()
            .ok_or_else(|| NookError::Database("Staged snapshots disappeared.".to_owned()))?;
        assert_eq!(current.identities().len(), 1);
        assert_eq!(current.selected()?.identity_id, pending_identity_id);
        assert_eq!(staged.base_directory.identities().len(), 1);
        assert_eq!(staged.directory.identities().len(), 1);
        NookDatabase::clear_identity_directory_for_test().await
    }

    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    #[wasm_bindgen_test]
    async fn genesis_cleanup_preserves_pending_identity_during_fallback_migration()
    -> Result<(), NookError> {
        NookDatabase::clear_identity_directory_for_test().await?;
        let app_key = AppKey::generate().map_err(NookDatabase::map_domain_error)?;
        let initial_key = app_key.clone();
        NookDatabase::update_identity_directory(move |mut directory| {
            let resolved_identity = directory
                .create_identity(IdentityCreation {
                    label: "Pending",
                    app_key: &initial_key,
                    member_label: MemberLabelState::Unnamed,
                })
                .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?;
            directory = resolved_identity.directory;
            Ok(IdentityDirectoryWrite::from(directory))
        })
        .await?;
        let (signing, _) = SigningIdentity::generate()?;
        let (pending, _, _) = StagedSimpleGenesisInput {
            app_key: &app_key,
            signing_public_key: &signing.public_key(),
            authorizer: None,
            authorizer_signing: None,
            label: "Pending",
        }
        .begin_or_resume()
        .await?;
        let staged = pending
            .staged_identity()
            .ok_or_else(|| NookError::Database("Staged identity disappeared.".to_owned()))?;
        let mut concurrent = staged.base_directory.clone();
        let resolved_identity = concurrent
            .create_identity(IdentityCreation {
                label: "Concurrent duplicate",
                app_key: &app_key,
                member_label: MemberLabelState::Unnamed,
            })
            .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?;
        concurrent = resolved_identity.directory;
        let duplicate_id = resolved_identity.identity_id;
        concurrent = concurrent
            .select(&duplicate_id)
            .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?;
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: identity_record::IDENTITY_DIRECTORY_KEY,
            value: &serde_json::to_string(&concurrent)
                .map_err(|error| NookError::Serialization(error.to_string()))?,
        })
        .await?;

        SimpleGenesisCompletion::Staged {
            pending: &pending,
            signing_seed: "staged-signing-seed",
        }
        .clear_pending()
        .await?;

        let published = NookDatabase::load_identity_directory().await?;
        assert_eq!(published.identities().len(), 1);
        assert_eq!(published.selected()?.identity_id, pending.identity_id);
        assert!(published.selected()?.owns_vault(&pending.store_id));
        assert!(
            PendingSimpleGenesis::load_for_store(pending.store_id.as_str())
                .await?
                .is_none()
        );
        NookDatabase::idb_delete_key(event_db::SIGNING_SEED_KEY).await?;
        NookDatabase::clear_identity_directory_for_test().await
    }

    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    #[wasm_bindgen_test]
    async fn genesis_cleanup_normalizes_stale_staged_snapshots_after_live_migration()
    -> Result<(), NookError> {
        NookDatabase::clear_identity_directory_for_test().await?;
        let app_key = AppKey::generate().map_err(NookDatabase::map_domain_error)?;
        let mut legacy = IdentityDirectory::empty();
        let resolved_identity = legacy
            .create_identity(IdentityCreation {
                label: "Pending",
                app_key: &app_key,
                member_label: MemberLabelState::Unnamed,
            })
            .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?;
        legacy = resolved_identity.directory;
        let pending_identity_id = resolved_identity.identity_id;
        let resolved_identity = legacy
            .create_identity(IdentityCreation {
                label: "Concurrent duplicate",
                app_key: &app_key,
                member_label: MemberLabelState::Unnamed,
            })
            .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?;
        legacy = resolved_identity.directory;
        let duplicate_id = resolved_identity.identity_id;
        legacy = legacy
            .select(&duplicate_id)
            .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?;
        let store_id = nook_core::StoreId::generate().map_err(NookDatabase::map_domain_error)?;
        let mut candidate = legacy.clone();
        let opened_identity = candidate
            .open_or_generate_vault_dek_for_identity(DirectoryOwnedVaultOpening {
                identity_id: &pending_identity_id,
                vault: IdentityVaultKeyOpening {
                    app_key: &app_key,
                    store_id: store_id.clone(),
                },
            })
            .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?;
        candidate = opened_identity.directory;
        let pending = PendingSimpleGenesis {
            store_id,
            identity_id: pending_identity_id.clone(),
            created_at: IsoTimestamp::parse("2026-08-15T00:00:00.000Z")
                .map_err(|error| NookError::Database(error.to_string()))?,
            event_state: PendingSimpleGenesisEvent::AwaitingEvent,
            flow: PendingSimpleGenesisFlow::Staged(StagedSimpleGenesisIdentity {
                base_directory: legacy.clone(),
                directory: candidate,
            }),
        };
        let normalized = legacy
            .migrate_legacy_duplicate_app_key_ownership_preserving(&pending_identity_id)
            .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?
            .directory;
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: identity_record::IDENTITY_DIRECTORY_KEY,
            value: &serde_json::to_string(&normalized)
                .map_err(|error| NookError::Serialization(error.to_string()))?,
        })
        .await?;
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: PENDING_SIMPLE_GENESIS_KEY,
            value: &pending.encode()?,
        })
        .await?;

        SimpleGenesisCompletion::Staged {
            pending: &pending,
            signing_seed: "staged-signing-seed",
        }
        .clear_pending()
        .await?;

        let published = NookDatabase::load_identity_directory().await?;
        assert_eq!(published.identities().len(), 1);
        assert_eq!(published.selected()?.identity_id, pending_identity_id);
        assert!(published.selected()?.owns_vault(&pending.store_id));
        assert!(
            PendingSimpleGenesis::load_for_store(pending.store_id.as_str())
                .await?
                .is_none()
        );
        NookDatabase::idb_delete_key(event_db::SIGNING_SEED_KEY).await?;
        NookDatabase::clear_identity_directory_for_test().await
    }

    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    #[wasm_bindgen_test]
    async fn genesis_cleanup_rejects_candidate_only_overlap_during_legacy_migration()
    -> Result<(), NookError> {
        NookDatabase::clear_identity_directory_for_test().await?;
        let legacy_key = AppKey::generate().map_err(NookDatabase::map_domain_error)?;
        let candidate_key = AppKey::generate().map_err(NookDatabase::map_domain_error)?;
        let mut legacy = IdentityDirectory::empty();
        let resolved_identity = legacy
            .create_identity(IdentityCreation {
                label: "Pending",
                app_key: &legacy_key,
                member_label: MemberLabelState::Unnamed,
            })
            .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?;
        legacy = resolved_identity.directory;
        let pending_identity_id = resolved_identity.identity_id;
        let resolved_identity = legacy
            .create_identity(IdentityCreation {
                label: "Legacy duplicate",
                app_key: &legacy_key,
                member_label: MemberLabelState::Unnamed,
            })
            .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?;
        legacy = resolved_identity.directory;
        legacy = legacy
            .select(&pending_identity_id)
            .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?;
        let store_id = nook_core::StoreId::generate().map_err(NookDatabase::map_domain_error)?;
        let mut candidate = legacy.clone();
        let resolved_identity = candidate
            .enroll_selected_app_key_for_vault_creation(DirectoryCreationEnrollment {
                app_key: &candidate_key,
                label: "Pending",
            })
            .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?;
        candidate = resolved_identity.directory;
        let resolved_identity = candidate
            .create_identity(IdentityCreation {
                label: "Candidate overlap",
                app_key: &candidate_key,
                member_label: MemberLabelState::Unnamed,
            })
            .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?;
        candidate = resolved_identity.directory;
        let opened_identity = candidate
            .open_or_generate_vault_dek_for_identity(DirectoryOwnedVaultOpening {
                identity_id: &pending_identity_id,
                vault: IdentityVaultKeyOpening {
                    app_key: &legacy_key,
                    store_id: store_id.clone(),
                },
            })
            .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?;
        candidate = opened_identity.directory;
        let pending = PendingSimpleGenesis {
            store_id,
            identity_id: pending_identity_id.clone(),
            created_at: IsoTimestamp::parse("2026-08-15T00:00:00.000Z")
                .map_err(|error| NookError::Database(error.to_string()))?,
            event_state: PendingSimpleGenesisEvent::AwaitingEvent,
            flow: PendingSimpleGenesisFlow::Staged(StagedSimpleGenesisIdentity {
                base_directory: legacy.clone(),
                directory: candidate,
            }),
        };
        let normalized = legacy
            .migrate_legacy_duplicate_app_key_ownership_preserving(&pending_identity_id)
            .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?
            .directory;
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: identity_record::IDENTITY_DIRECTORY_KEY,
            value: &serde_json::to_string(&normalized)
                .map_err(|error| NookError::Serialization(error.to_string()))?,
        })
        .await?;
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: PENDING_SIMPLE_GENESIS_KEY,
            value: &pending.encode()?,
        })
        .await?;

        let result = SimpleGenesisCompletion::Staged {
            pending: &pending,
            signing_seed: "candidate-overlap-seed",
        }
        .clear_pending()
        .await;

        assert!(matches!(
            result,
            Err(NookError::Database(message)) if message.contains("more than one local identity")
        ));
        assert_eq!(NookDatabase::load_identity_directory().await?, normalized);
        assert!(
            PendingSimpleGenesis::load_for_store(pending.store_id.as_str())
                .await?
                .is_some()
        );
        NookDatabase::clear_identity_directory_for_test().await
    }

    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    #[wasm_bindgen_test]
    async fn unchanged_base_rejects_invalid_staged_candidate() -> Result<(), NookError> {
        NookDatabase::clear_identity_directory_for_test().await?;
        let selected_key = AppKey::generate().map_err(NookDatabase::map_domain_error)?;
        let overlapping_key = AppKey::generate().map_err(NookDatabase::map_domain_error)?;
        let mut base = IdentityDirectory::empty();
        let resolved_identity = base
            .create_identity(IdentityCreation {
                label: "Selected",
                app_key: &selected_key,
                member_label: MemberLabelState::Unnamed,
            })
            .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?;
        base = resolved_identity.directory;
        let selected_id = resolved_identity.identity_id;
        let resolved_identity = base
            .create_identity(IdentityCreation {
                label: "Other",
                app_key: &overlapping_key,
                member_label: MemberLabelState::Unnamed,
            })
            .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?;
        base = resolved_identity.directory;
        base = base
            .select(&selected_id)
            .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?;
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: identity_record::IDENTITY_DIRECTORY_KEY,
            value: &serde_json::to_string(&base)
                .map_err(|error| NookError::Serialization(error.to_string()))?,
        })
        .await?;
        let (signing, _) = SigningIdentity::generate()?;
        let pending = StagedSimpleGenesisInput {
            app_key: &overlapping_key,
            signing_public_key: &signing.public_key(),
            authorizer: Some(&selected_key),
            authorizer_signing: None,
            label: "Selected",
        }
        .begin_or_resume()
        .await;

        assert!(matches!(
            pending,
            Err(NookError::Database(message))
                if message.contains("belongs to another local identity")
        ));
        assert_eq!(NookDatabase::load_identity_directory().await?, base);
        assert!(
            NookDatabase::idb_get_string(PENDING_SIMPLE_GENESIS_KEY)
                .await?
                .is_none()
        );
        NookDatabase::clear_identity_directory_for_test().await
    }

    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    #[wasm_bindgen_test]
    async fn staged_signer_marker_resumes_with_authorizer_key() -> Result<(), NookError> {
        NookDatabase::clear_identity_directory_for_test().await?;
        let authorizer = AppKey::generate().map_err(NookDatabase::map_domain_error)?;
        let extension = AppKey::generate().map_err(NookDatabase::map_domain_error)?;
        let (authorizer_signing, _) =
            SigningIdentity::generate().map_err(|error| NookError::Database(error.to_string()))?;
        let (extension_signing, _) =
            SigningIdentity::generate().map_err(|error| NookError::Database(error.to_string()))?;
        let authorizer_signing_pair =
            (authorizer.app_id().clone(), authorizer_signing.public_key());
        let (pending, _, _) = StagedSimpleGenesisInput {
            app_key: &extension,
            signing_public_key: &extension_signing.public_key(),
            authorizer: Some(&authorizer),
            authorizer_signing: Some(&authorizer_signing_pair),
            label: "Personal",
        }
        .begin_or_resume()
        .await?;
        let first = (&pending)
            .pin_event(SimpleGenesisEventInput {
                app_key: &extension,
                proposed_yaml: "first-event\n".to_owned(),
                proposed_signing_seed: "first-seed".to_owned(),
            })
            .await?;
        let resumed = (&pending)
            .pin_event(SimpleGenesisEventInput {
                app_key: &authorizer,
                proposed_yaml: "ignored-event\n".to_owned(),
                proposed_signing_seed: "ignored-seed".to_owned(),
            })
            .await?;
        assert_eq!(resumed.event_yaml, first.event_yaml);
        assert_eq!(resumed.signing_seed, first.signing_seed);
        NookDatabase::clear_identity_directory_for_test().await
    }
}

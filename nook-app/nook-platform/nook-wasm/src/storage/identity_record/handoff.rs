#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! Atomic identity handoff persistence and authorization checks.

mod existing_vault;
use crate::NookDatabase;
#[cfg(all(test, target_arch = "wasm32"))]
use crate::manager::PendingExtensionIdentityEnrollment;
use crate::storage::event_db;
#[cfg(all(test, target_arch = "wasm32"))]
use crate::storage::indexed_db::StoredStringRecord;
#[cfg(all(test, target_arch = "wasm32"))]
use crate::{IdbPutStringRequest, manager};
use existing_vault::ExistingVaultHandoff;
#[cfg(all(test, target_arch = "wasm32"))]
use nook_core::MemberLabelState;
#[cfg(all(test, target_arch = "wasm32"))]
pub(crate) use nook_core::StoredSigningSeed;
use nook_core::{
    DirectoryMemberSigningUpdate, DirectoryVaultEnrollment, IdentityMemberSigningUpdate,
};
#[cfg(all(test, target_arch = "wasm32"))]
use nook_core::{DirectoryOwnedVaultOpening, IdentityCreation, IdentityVaultKeyOpening};
use rexie::TransactionMode;

#[cfg(all(test, target_arch = "wasm32"))]
use super as identity_record;
use super::IDENTITY_DIRECTORY_KEY;
use super::{AuthorizerMemberSigning, AuthorizerSigningUpdate, HandoffSignerPublication};
use crate::NookError;
#[cfg(all(test, target_arch = "wasm32"))]
use crate::storage;

pub(crate) enum IdentityHandoffOperation<'a> {
    PairedVault(PairedVaultEnrollment<'a>),
    ExistingVaultImport(ExistingVaultEnrollment<'a>),
}
pub(crate) struct PairedVaultEnrollment<'a> {
    pub(crate) authorizer: &'a nook_core::AppKey,
    pub(crate) store_id: &'a nook_core::StoreId,
}
pub(crate) struct ExistingVaultEnrollment<'a> {
    pub(crate) store_id: &'a nook_core::StoreId,
    pub(crate) existing: ExistingVaultImportCommit,
}
pub(crate) struct IdentityHandoffCommit<'a> {
    pub(crate) app_key: &'a nook_core::AppKey,
    pub(crate) signing_public_key: &'a nook_core::DeviceSigningPublicKey,
    pub(crate) authorizer_signing: &'a AuthorizerSigningUpdate,
    pub(crate) operation: IdentityHandoffOperation<'a>,
    pub(crate) signing_seed: HandoffSignerPublication<'a>,
}
pub(crate) struct ExistingVaultImportCommit {
    pub(crate) device_id: nook_core::DeviceId,
    pub(crate) label: String,
}
pub(crate) enum IdentityHandoffCommitResult {
    PairedVaultCommitted,
    ExistingVaultImported(nook_core::VaultKeys),
}
struct HandoffSigningSeed<'a> {
    store: &'a rexie::Store,
    seed: HandoffSignerPublication<'a>,
}
impl IdentityHandoffCommit<'_> {
    fn store_names(&self) -> &'static [&'static str] {
        match self.operation {
            IdentityHandoffOperation::PairedVault(_) => &["vault"],
            IdentityHandoffOperation::ExistingVaultImport(_) => &["vault", "events"],
        }
    }
    async fn persist_signing_seed(input: &HandoffSigningSeed<'_>) -> Result<(), NookError> {
        let HandoffSigningSeed {
            store,
            seed: signing_seed,
        } = *input;
        let HandoffSignerPublication::ReplaceWith(seed) = signing_seed else {
            return Ok(());
        };
        let seed_key = serde_wasm_bindgen::to_value(event_db::SIGNING_SEED_KEY)
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
        Ok(())
    }
    /// Commit identity membership and its matching event signer in one transaction.
    #[expect(
        clippy::too_many_lines,
        reason = "the transaction commit keeps its atomic write and rollback sequence together"
    )]
    pub(crate) async fn commit(self) -> Result<IdentityHandoffCommitResult, NookError> {
        let input = self;
        let rexie = NookDatabase::open_nook_database().await?;
        let transaction = rexie
            .transaction(input.store_names(), TransactionMode::ReadWrite)
            .map_err(|error| {
                NookError::IndexedDb(format!("Handoff transaction error: {error:?}"))
            })?;
        let store = transaction.store("vault").map_err(|error| {
            NookError::IndexedDb(format!("Handoff transaction store error: {error:?}"))
        })?;
        let directory_key = serde_wasm_bindgen::to_value(IDENTITY_DIRECTORY_KEY)
            .map_err(|error| NookError::IndexedDb(format!("Handoff key error: {error:?}")))?;
        let legacy_key =
            serde_wasm_bindgen::to_value(super::LEGACY_IDENTITY_RECORD_KEY).map_err(|error| {
                NookError::IndexedDb(format!("Handoff legacy key error: {error:?}"))
            })?;
        let mut directory = NookDatabase::load_directory_for_write(&store).await?;
        let (identity_id, result) = match input.operation {
            IdentityHandoffOperation::PairedVault(PairedVaultEnrollment {
                authorizer,
                store_id,
            }) => {
                let enrolled = directory
                    .enroll_app_key_for_owned_vault(DirectoryVaultEnrollment {
                        current_app_key: authorizer,
                        new_app_key: input.app_key,
                        store_id,
                    })
                    .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?;
                directory = enrolled.directory;
                (
                    enrolled.identity_id,
                    IdentityHandoffCommitResult::PairedVaultCommitted,
                )
            }
            IdentityHandoffOperation::ExistingVaultImport(ExistingVaultEnrollment {
                store_id,
                existing,
            }) => {
                let events = transaction.store("events").map_err(|error| {
                    NookError::IndexedDb(format!("Handoff event store error: {error:?}"))
                })?;
                let imported = ExistingVaultHandoff {
                    directory,
                    events: &events,
                    store_id,
                    app_key: input.app_key,
                    signing_public_key: input.signing_public_key,
                    existing,
                }
                .import()
                .await?;
                directory = imported.directory;
                (
                    imported.identity_id,
                    IdentityHandoffCommitResult::ExistingVaultImported(imported.vault_keys),
                )
            }
        };
        directory = directory
            .set_member_signing_public_key(DirectoryMemberSigningUpdate {
                identity_id: &identity_id,
                member: IdentityMemberSigningUpdate {
                    app_id: input.app_key.app_id(),
                    signing_public_key: input.signing_public_key,
                },
            })
            .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?;
        if let AuthorizerSigningUpdate::Verified(AuthorizerMemberSigning {
            app_id,
            signing_public_key,
        }) = input.authorizer_signing
        {
            directory = directory
                .set_member_signing_public_key(DirectoryMemberSigningUpdate {
                    identity_id: &identity_id,
                    member: IdentityMemberSigningUpdate {
                        app_id,
                        signing_public_key,
                    },
                })
                .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?;
        }
        directory
            .validate()
            .map_err(NookDatabase::map_domain_error)?;
        let encoded = serde_json::to_string(&directory)
            .map_err(|error| NookError::IndexedDb(format!("Handoff encode error: {error}")))?;
        let encoded_value = serde_wasm_bindgen::to_value(&encoded)
            .map_err(|error| NookError::IndexedDb(format!("Handoff value error: {error:?}")))?;
        store
            .put(&encoded_value, Some(&directory_key))
            .await
            .map_err(|error| NookError::IndexedDb(format!("Handoff write error: {error:?}")))?;
        store.delete(legacy_key).await.map_err(|error| {
            NookError::IndexedDb(format!("Handoff legacy delete error: {error:?}"))
        })?;
        Self::persist_signing_seed(&HandoffSigningSeed {
            store: &store,
            seed: input.signing_seed,
        })
        .await?;
        transaction.done().await.map_err(|error| {
            NookError::IndexedDb(format!("Handoff transaction completion error: {error:?}"))
        })?;
        Ok(result)
    }
}

#[cfg(all(test, target_arch = "wasm32"))]
mod tests {
    use nook_core::{
        DirectoryOwnedVaultOpening, IdentityCreation, IdentityVaultKeyOpening, MemberLabelState,
        StoredSigningSeed,
    };

    use super::{
        AuthorizerSigningUpdate, HandoffSignerPublication, IdentityHandoffCommit,
        IdentityHandoffCommitResult, IdentityHandoffOperation, PairedVaultEnrollment,
        PendingExtensionIdentityEnrollment,
    };
    use crate::storage::identity_record::VaultCreationAuthority;
    use crate::storage::{event_db, identity_record, indexed_db};
    use crate::{IdbPutStringRequest, NookDatabase, NookError, StoredStringRecord};
    use nook_core::{AppKey, DeviceSigningPublicKey, IdentityDirectory, SigningIdentity, StoreId};
    use wasm_bindgen_test::wasm_bindgen_test;

    struct HandoffFixture {
        app_key: AppKey,
        signing_public_key: DeviceSigningPublicKey,
        store_id: StoreId,
        seed: String,
    }
    impl HandoffFixture {
        fn new() -> Result<Self, NookError> {
            let (signing, _) = SigningIdentity::generate()?;
            Ok(Self {
                app_key: AppKey::generate()?,
                signing_public_key: signing.public_key(),
                store_id: StoreId::parse("store_abcdefghijk")
                    .map_err(|error| NookError::Database(error.to_string()))?,
                seed: "33".repeat(32),
            })
        }
        fn request<'a>(
            &'a self,
            enrollment: &'a PendingExtensionIdentityEnrollment,
        ) -> Result<IdentityHandoffCommit<'a>, NookError> {
            let operation = match enrollment {
                PendingExtensionIdentityEnrollment::PairedVault {
                    authorizer,
                    store_id,
                } => IdentityHandoffOperation::PairedVault(PairedVaultEnrollment {
                    authorizer,
                    store_id,
                }),
                PendingExtensionIdentityEnrollment::VaultCreation { .. } => {
                    return Err(NookError::Database(
                        "Vault-creation identity must publish with verified genesis.".to_owned(),
                    ));
                }
                PendingExtensionIdentityEnrollment::PairedVaultSessionUnlock { .. } => {
                    return Err(NookError::Database(
                        "Paired session unlock does not publish identity membership.".to_owned(),
                    ));
                }
                PendingExtensionIdentityEnrollment::ExistingVaultImport { .. } => {
                    return Err(NookError::Database(
                        "Existing-vault handoff material is missing.".to_owned(),
                    ));
                }
            };
            Ok(IdentityHandoffCommit {
                app_key: &self.app_key,
                signing_public_key: &self.signing_public_key,
                authorizer_signing: &AuthorizerSigningUpdate::RetainMembership,
                operation,
                signing_seed: HandoffSignerPublication::ReplaceWith(&self.seed),
            })
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
    async fn unsupported_handoffs_preserve_directory_and_signer() -> Result<(), NookError> {
        let fixture = HandoffFixture::new()?;
        for (enrollment, expected) in [
            (
                PendingExtensionIdentityEnrollment::VaultCreation {
                    authorizer: VaultCreationAuthority::NewIdentity,
                },
                "Vault-creation identity must publish with verified genesis.",
            ),
            (
                PendingExtensionIdentityEnrollment::PairedVaultSessionUnlock {
                    store_id: fixture.store_id.clone(),
                },
                "Paired session unlock does not publish identity membership.",
            ),
            (
                PendingExtensionIdentityEnrollment::ExistingVaultImport {
                    store_id: fixture.store_id.clone(),
                },
                "Existing-vault handoff material is missing.",
            ),
        ] {
            NookDatabase::clear_vault_db().await?;
            let result = match fixture.request(&enrollment) {
                Ok(commit) => commit.commit().await,
                Err(error) => Err(error),
            };
            assert!(matches!(result, Err(NookError::Database(message)) if message == expected));
            assert!(
                NookDatabase::load_identity_directory()
                    .await?
                    .identities()
                    .is_empty()
            );
            assert!(matches!(
                NookDatabase::load_signing_seed().await?,
                StoredSigningSeed::Missing
            ));
        }
        NookDatabase::clear_vault_db().await
    }

    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    #[wasm_bindgen_test]
    async fn paired_handoff_publishes_membership_and_matching_signer() -> Result<(), NookError> {
        let fixture = HandoffFixture::new()?;
        let authorizer = AppKey::generate()?;
        let mut directory = IdentityDirectory::empty();
        let resolved_identity = directory
            .create_identity(IdentityCreation {
                label: "Authorizer",
                app_key: &authorizer,
                member_label: MemberLabelState::Unnamed,
            })
            .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?;
        directory = resolved_identity.directory;
        let identity_id = resolved_identity.identity_id;
        let opened_identity = directory
            .open_or_generate_vault_dek_for_identity(DirectoryOwnedVaultOpening {
                identity_id: &identity_id,
                vault: IdentityVaultKeyOpening {
                    app_key: &authorizer,
                    store_id: fixture.store_id.clone(),
                },
            })
            .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))?;
        directory = opened_identity.directory;
        let encoded = serde_json::to_string(&directory)
            .map_err(|error| NookError::Serialization(error.to_string()))?;
        NookDatabase::clear_vault_db().await?;
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: identity_record::IDENTITY_DIRECTORY_KEY,
            value: &encoded,
        })
        .await?;
        let enrollment = PendingExtensionIdentityEnrollment::PairedVault {
            authorizer,
            store_id: fixture.store_id.clone(),
        };
        let committed = fixture.request(&enrollment)?.commit().await?;
        assert!(matches!(
            committed,
            IdentityHandoffCommitResult::PairedVaultCommitted
        ));
        let persisted = NookDatabase::load_identity_directory().await?;
        let record = persisted
            .identities()
            .iter()
            .find(|record| record.identity_id == identity_id)
            .ok_or_else(|| NookError::Database("Handoff identity is missing.".to_owned()))?;
        let member = record
            .members
            .iter()
            .find(|member| member.app_id == *fixture.app_key.app_id())
            .ok_or_else(|| NookError::Database("Handoff member is missing.".to_owned()))?;
        assert_eq!(member.signing_public_key, fixture.signing_public_key);
        assert_eq!(
            NookDatabase::load_signing_seed().await?,
            StoredSigningSeed::Stored(fixture.seed)
        );
        NookDatabase::clear_vault_db().await
    }

    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    #[wasm_bindgen_test]
    async fn dropping_unpolled_commit_does_not_publish() -> Result<(), NookError> {
        let fixture = HandoffFixture::new()?;
        let enrollment = PendingExtensionIdentityEnrollment::PairedVault {
            authorizer: AppKey::generate()?,
            store_id: fixture.store_id.clone(),
        };
        NookDatabase::clear_vault_db().await?;
        {
            let _commit = fixture.request(&enrollment)?.commit();
        }
        assert!(matches!(
            NookDatabase::idb_get_string(identity_record::IDENTITY_DIRECTORY_KEY).await?,
            StoredStringRecord::MissingKey
        ));
        assert!(matches!(
            NookDatabase::load_signing_seed().await?,
            StoredSigningSeed::Missing
        ));
        NookDatabase::clear_vault_db().await
    }
}

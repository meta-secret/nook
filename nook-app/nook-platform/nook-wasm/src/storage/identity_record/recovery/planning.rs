#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! Selection of the initiating local identity and surviving protected keys.
use super::target::{RecoveryScope, RetiredLocalIdentity};
use super::{RecoveryTarget, RetiredInstallation};
#[cfg(test)]
use crate::IdbPutStringRequest;
use crate::KeyringDbLoadKeyringForStore;
use crate::storage::indexed_db::StoredStringRecord;
use crate::storage::{device_access, identity_record, indexed_db};
#[cfg(test)]
use crate::{
    IdentityDbEnsureLocalIdentityForAppKey, IdentityDbGenerateVaultDekForIdentity,
    IdentityDbSaveNewProtectedLocalIdentity, IdentityDbSaveProtectedLocalIdentity,
    IdentityDbValidateVaultIdentityEnrollment,
};
use crate::{NookDatabase, NookError, ReadStringPreferringRequest};
#[cfg(all(test, target_arch = "wasm32"))]
use identity_record::keyring;
use nook_core::LocalIdentityKeyRetirement;
use nook_core::LocalIdentityProtection;
#[cfg(test)]
use nook_core::MemberLabelState;
use nook_core::RecoveryRetirement;
use nook_core::{AppId, IdentityDirectory, IdentitySelection, LocalIdentityKeyring};

pub(super) struct RecoveryState {
    pub(super) directory: nook_core::IdentityDirectory,
    pub(super) keyring: nook_core::LocalIdentityKeyring,
    pub(super) scope: RecoveryScope,
    pub(super) access_profile_keys: Vec<String>,
    pub(super) clear_reconciliation: bool,
}

mod directory;

pub(super) struct RecoveryPlanning<'a> {
    pub(super) store: &'a rexie::Store,
    pub(super) target: &'a RecoveryTarget,
}
struct FullRecovery {
    directory: IdentityDirectory,
    keyring: LocalIdentityKeyring,
}
struct RecoveryAccessProfile<'a> {
    app_id: &'a AppId,
}
impl RecoveryAccessProfile<'_> {
    fn key(&self) -> String {
        let app_id = self.app_id;

        format!("{}:{app_id}", device_access::DEVICE_ACCESS_PROFILE_KEY)
    }
}
impl RecoveryPlanning<'_> {
    async fn legacy_app_id(&self) -> RetiredInstallation {
        let store = self.store;
        match NookDatabase::read_string_preferring(ReadStringPreferringRequest {
            store,
            preferred_key: indexed_db::APP_ID_KEY,
            legacy_key: indexed_db::DEVICE_ID_KEY,
            label: "Identity reset app id",
        })
        .await
        {
            Ok(StoredStringRecord::Stored(raw)) => match AppId::parse(&raw) {
                Ok(app_id) => RetiredInstallation::App(app_id),
                Err(_) => RetiredInstallation::Unattributed,
            },
            Ok(StoredStringRecord::MissingKey) | Err(_) => RetiredInstallation::Unattributed,
        }
    }
    async fn full(self, input: FullRecovery) -> Result<RecoveryState, NookError> {
        let FullRecovery {
            mut directory,
            keyring,
        } = input;
        let target = self.target;
        let persisted_app_id = self.legacy_app_id().await;
        if let RecoveryTarget::App(expected) = target {
            let target_exists = keyring
                .entries()
                .iter()
                .any(|entry| entry.app_id() == expected)
                || matches!(&persisted_app_id, RetiredInstallation::App(app_id) if app_id == expected);
            if !target_exists {
                return Err(NookError::Database(
                    "Recovery target changed before confirmation".to_owned(),
                ));
            }
        }
        let mut app_ids = keyring
            .entries()
            .iter()
            .map(|entry| entry.app_id().clone())
            .collect::<Vec<_>>();
        if let RetiredInstallation::App(app_id) = &persisted_app_id {
            app_ids.push(app_id.clone());
        }
        let access_profile_keys = app_ids
            .iter()
            .map(|app_id| RecoveryAccessProfile { app_id }.key())
            .collect();
        directory = directory.reset_for_device_recovery(RecoveryRetirement::PreserveRetiredKeys);
        for app_id in app_ids {
            directory = directory.retire_app_id(app_id);
        }
        directory
            .validate()
            .map_err(|error| NookError::Database(error.to_string()))?;
        Ok(RecoveryState {
            directory,
            keyring: LocalIdentityKeyring::empty(),
            scope: RecoveryScope::Installation(match target {
                RecoveryTarget::App(app_id) => RetiredInstallation::App(app_id.clone()),
                RecoveryTarget::Unspecified => persisted_app_id,
            }),
            access_profile_keys,
            clear_reconciliation: true,
        })
    }
    #[expect(
        clippy::too_many_lines,
        reason = "recovery preparation keeps one ordered validation and persistence sequence"
    )]
    pub(super) async fn prepare(self) -> Result<RecoveryState, NookError> {
        let store = self.store;
        let target = self.target;
        let recovered_directory = self.directory().await?;
        if !recovered_directory.readable {
            let keyring = NookDatabase::load_persisted_keyring_for_recovery(store).await?;
            return self
                .full(FullRecovery {
                    directory: recovered_directory.value,
                    keyring,
                })
                .await;
        }
        let mut directory = recovered_directory.value;
        let mut keyring = NookDatabase::load_keyring_for_store(KeyringDbLoadKeyringForStore {
            store,
            directory: &directory,
        })
        .await?;
        let target_entry = if keyring.entries().is_empty() {
            IdentitySelection::Empty
        } else {
            let RecoveryTarget::App(expected) = target else {
                return Err(NookError::Database(
                    "Recovery requires the initiating app identity".to_owned(),
                ));
            };
            IdentitySelection::Selected(
                keyring
                    .entries()
                    .iter()
                    .find(|entry| entry.app_id() == expected)
                    .map(|entry| entry.identity_id().clone())
                    .ok_or_else(|| {
                        NookError::Database(
                            "Recovery target changed before confirmation".to_owned(),
                        )
                    })?,
            )
        };
        let (scope, access_profile_keys) = if let IdentitySelection::Selected(identity_id) =
            target_entry
        {
            let prior_selection = directory.selection().clone();
            let removed = keyring
                .remove(&identity_id)
                .map_err(|rejected| NookError::Database(rejected.into_cause().to_string()))?;
            keyring = removed.keyring;
            let entry = removed.entry;
            let retired_identity_id = identity_id;
            directory = directory
                .retire_local_identity_key(LocalIdentityKeyRetirement {
                    identity_id: entry.identity_id(),
                    app_id: entry.app_id(),
                })
                .map_err(|error| NookError::Database(error.to_string()))?;
            let surviving_selection = match prior_selection {
                IdentitySelection::Selected(identity_id)
                    if matches!(
                        keyring.entry(&identity_id),
                        LocalIdentityProtection::Protected(_)
                    ) =>
                {
                    IdentitySelection::Selected(identity_id)
                }
                IdentitySelection::Empty | IdentitySelection::Selected(_) => {
                    IdentitySelection::Empty
                }
            };
            if let IdentitySelection::Selected(identity_id) = surviving_selection {
                directory = directory
                    .select(&identity_id)
                    .map_err(|error| NookError::Database(error.to_string()))?;
            } else if let Some(next) = keyring.entries().first() {
                directory = directory
                    .select(next.identity_id())
                    .map_err(|error| NookError::Database(error.to_string()))?;
            } else {
                directory = directory.clear_selection();
            }
            (
                RecoveryScope::LocalIdentity(RetiredLocalIdentity {
                    identity_id: retired_identity_id,
                    app_id: entry.app_id().clone(),
                }),
                vec![
                    RecoveryAccessProfile {
                        app_id: entry.app_id(),
                    }
                    .key(),
                ],
            )
        } else {
            let persisted_app_id = self.legacy_app_id().await;
            if let RecoveryTarget::App(expected) = target
                && !matches!(&persisted_app_id, RetiredInstallation::App(app_id) if app_id == expected)
            {
                return Err(NookError::Database(
                    "Recovery target changed before confirmation".to_owned(),
                ));
            }
            directory = directory.reset_for_device_recovery(match &persisted_app_id {
                RetiredInstallation::App(app_id) => {
                    RecoveryRetirement::RetireInstallation(app_id.clone())
                }
                RetiredInstallation::Unattributed => RecoveryRetirement::PreserveRetiredKeys,
            });
            keyring = LocalIdentityKeyring::empty();
            (RecoveryScope::Installation(persisted_app_id), Vec::new())
        };
        directory
            .validate()
            .map_err(|error| NookError::Database(error.to_string()))?;
        Ok(RecoveryState {
            clear_reconciliation: keyring.entries().is_empty(),
            directory,
            keyring,
            scope,
            access_profile_keys,
        })
    }
}
#[cfg(test)]
mod tests {
    use crate::storage::identity_record::IdentityDirectoryWrite;
    use crate::storage::identity_record::PriorAppAuthorization;
    use crate::storage::identity_record::SimpleGenesisProgress;

    use super::*;
    use crate::storage::identity_record;
    use crate::storage::{device_access, event_db, indexed_db};
    use nook_core::{AppKey, DeviceSigningPublicKey, IdentitySelection};

    use super::super::LocalIdentityRecoveryRequest;
    use crate::NookError;
    use identity_record::{
        IDENTITY_DIRECTORY_KEY, PendingSimpleGenesis, RETIRED_APP_IDS_KEY, keyring,
    };
    use nook_core::DeviceIdentityProtection;

    use wasm_bindgen_test::{wasm_bindgen_test, wasm_bindgen_test_configure};

    wasm_bindgen_test_configure!(run_in_browser);

    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    #[wasm_bindgen_test]
    async fn destructive_recovery_forgets_stale_identity_ownership() -> Result<(), NookError> {
        NookDatabase::clear_identity_directory_for_test().await?;
        let inaccessible_key = AppKey::generate().map_err(NookDatabase::map_domain_error)?;
        let wrapped = DeviceIdentityProtection::new(&inaccessible_key.secret_string())
            .with_pin("test-pin")?;
        NookDatabase::save_protected_local_identity(IdentityDbSaveProtectedLocalIdentity {
            app_key: &inaccessible_key,
            record: &wrapped,
            label: "Personal",
        })
        .await?;
        let pending = identity_record::OrdinarySimpleGenesisRequest {
            app_key: &inaccessible_key,
            label: "Personal",
        }
        .begin_or_resume()
        .await?;
        let store_id = pending.store_id.clone();
        let _ =
            NookDatabase::generate_vault_dek_for_identity(IdentityDbGenerateVaultDekForIdentity {
                identity_id: &pending.identity_id,
                app_key: &inaccessible_key,
                store_id: store_id.clone(),
            })
            .await?;
        let marker_v2 = format!("pending_identity_reconciliation_v2:{store_id}");
        let marker_v1 = format!("pending_identity_reconciliation_v1:{store_id}");
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: &marker_v2,
            value: "stale-v2",
        })
        .await?;
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: &marker_v1,
            value: "stale-v1",
        })
        .await?;
        let current_app_id = NookDatabase::load_keyring().await?.entries()[0]
            .app_id()
            .clone();
        let recovery = LocalIdentityRecoveryRequest {
            target: RecoveryTarget::App(current_app_id),
        }
        .execute()
        .await?;

        assert!(matches!(
            NookDatabase::idb_get_string(&marker_v2).await?,
            StoredStringRecord::MissingKey
        ));
        assert!(matches!(
            NookDatabase::idb_get_string(&marker_v1).await?,
            StoredStringRecord::MissingKey
        ));

        let stale_result = NookDatabase::ensure_local_identity_for_app_key(
            IdentityDbEnsureLocalIdentityForAppKey {
                app_key: &inaccessible_key,
                label: "Stale",
            },
        )
        .await;
        assert!(matches!(
            stale_result,
            Err(NookError::Database(message)) if message.contains("retired")
        ));

        let replacement_key = AppKey::generate().map_err(NookDatabase::map_domain_error)?;
        let replacement = NookDatabase::ensure_local_identity_for_app_key(
            IdentityDbEnsureLocalIdentityForAppKey {
                app_key: &replacement_key,
                label: "Recovered",
            },
        )
        .await?;
        assert_ne!(replacement.identity_id, pending.identity_id);
        NookDatabase::validate_vault_identity_enrollment(
            IdentityDbValidateVaultIdentityEnrollment {
                app_key: &replacement_key,
                store_id: &store_id,
            },
        )
        .await?;
        assert!(matches!(
            PendingSimpleGenesis::load_for_store(store_id.as_str()).await?,
            SimpleGenesisProgress::NotPending
        ));
        recovery.complete().await?;
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
    async fn destructive_recovery_bypasses_a_corrupt_identity_directory() -> Result<(), NookError> {
        NookDatabase::clear_identity_directory_for_test().await?;
        let store_id = nook_core::StoreId::generate().map_err(NookDatabase::map_domain_error)?;
        let stale_key = AppKey::generate().map_err(NookDatabase::map_domain_error)?;
        let earlier_key = AppKey::generate().map_err(NookDatabase::map_domain_error)?;
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: RETIRED_APP_IDS_KEY,
            value: &serde_json::to_string(&vec![earlier_key.app_id()])
                .map_err(|error| NookError::IndexedDb(error.to_string()))?,
        })
        .await?;
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: "vault_registry",
            value: &format!(r#"{{"vaults":[{{"store_id":"{store_id}","label":""}}]}}"#),
        })
        .await?;
        let marker = format!("pending_identity_reconciliation_v2:{store_id}");
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: &marker,
            value: "inaccessible-plan",
        })
        .await?;
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: IDENTITY_DIRECTORY_KEY,
            value: "{future-or-corrupt",
        })
        .await?;
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: indexed_db::APP_ID_KEY,
            value: stale_key.app_id().as_str(),
        })
        .await?;
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: indexed_db::APP_KEY_WRAPPED_KEY,
            value: "inaccessible",
        })
        .await?;

        let recovery = LocalIdentityRecoveryRequest {
            target: RecoveryTarget::App(stale_key.app_id().clone()),
        }
        .execute()
        .await?;

        assert!(matches!(
            NookDatabase::idb_get_string(indexed_db::APP_KEY_WRAPPED_KEY).await?,
            StoredStringRecord::MissingKey
        ));
        assert!(matches!(
            NookDatabase::idb_get_string(&marker).await?,
            StoredStringRecord::MissingKey
        ));
        let recovered = NookDatabase::load_identity_directory().await?;
        assert!(recovered.identities().is_empty());
        assert!(matches!(
            NookDatabase::ensure_local_identity_for_app_key(IdentityDbEnsureLocalIdentityForAppKey { app_key: &stale_key, label: "Stale" }).await,
            Err(NookError::Database(message)) if message.contains("retired")
        ));
        assert!(
            NookDatabase::ensure_local_identity_for_app_key(
                IdentityDbEnsureLocalIdentityForAppKey {
                    app_key: &earlier_key,
                    label: "Earlier"
                }
            )
            .await
            .is_err()
        );
        recovery.complete().await?;
        NookDatabase::idb_delete_key("vault_registry").await?;
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
    async fn destructive_recovery_bypasses_corrupt_indexes_and_deletes_markers()
    -> Result<(), NookError> {
        NookDatabase::clear_identity_directory_for_test().await?;
        let store_id = nook_core::StoreId::generate().map_err(NookDatabase::map_domain_error)?;
        let marker = format!("pending_identity_reconciliation_v2:{store_id}");
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: IDENTITY_DIRECTORY_KEY,
            value: "{corrupt",
        })
        .await?;
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: "vault_registry",
            value: "{corrupt",
        })
        .await?;
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: RETIRED_APP_IDS_KEY,
            value: "{corrupt",
        })
        .await?;
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: &marker,
            value: "inaccessible-plan",
        })
        .await?;
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: indexed_db::APP_KEY_WRAPPED_KEY,
            value: "inaccessible",
        })
        .await?;
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: event_db::SIGNING_SEED_KEY,
            value: &"11".repeat(32),
        })
        .await?;
        let recovery = LocalIdentityRecoveryRequest {
            target: RecoveryTarget::Unspecified,
        }
        .execute()
        .await?;
        assert!(matches!(
            NookDatabase::idb_get_string(indexed_db::APP_KEY_WRAPPED_KEY).await?,
            StoredStringRecord::MissingKey
        ));
        assert!(matches!(
            NookDatabase::idb_get_string(event_db::SIGNING_SEED_KEY).await?,
            StoredStringRecord::MissingKey
        ));
        assert!(matches!(
            NookDatabase::idb_get_string(&marker).await?,
            StoredStringRecord::MissingKey
        ));
        let recovered = NookDatabase::load_identity_directory().await?;
        assert!(recovered.retired_app_ids().is_empty());
        recovery.complete().await?;
        NookDatabase::idb_delete_key("vault_registry").await?;
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
    async fn recovery_targets_the_initiating_identity_not_the_shared_selection()
    -> Result<(), NookError> {
        NookDatabase::clear_identity_directory_for_test().await?;
        NookDatabase::clear_keyring_for_test().await?;
        let first_key = AppKey::generate().map_err(NookDatabase::map_domain_error)?;
        let second_key = AppKey::generate().map_err(NookDatabase::map_domain_error)?;
        let first_wrapped =
            DeviceIdentityProtection::new(&first_key.secret_string()).with_pin("first-secret")?;
        let second_wrapped =
            DeviceIdentityProtection::new(&second_key.secret_string()).with_pin("second-secret")?;
        let first = NookDatabase::save_new_protected_local_identity(
            IdentityDbSaveNewProtectedLocalIdentity {
                app_key: &first_key,
                record: &first_wrapped,
                prior_app_key: PriorAppAuthorization::Unavailable,
                label: "Personal",
            },
        )
        .await?;
        let second = NookDatabase::save_new_protected_local_identity(
            IdentityDbSaveNewProtectedLocalIdentity {
                app_key: &second_key,
                record: &second_wrapped,
                prior_app_key: PriorAppAuthorization::Unavailable,
                label: "Work",
            },
        )
        .await?;
        let unrelated_store_id =
            nook_core::StoreId::generate().map_err(NookDatabase::map_domain_error)?;
        let unrelated_marker = format!("pending_identity_reconciliation_v2:{unrelated_store_id}");
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: &unrelated_marker,
            value: "remaining-identity-plan",
        })
        .await?;
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: device_access::DEVICE_ACCESS_PROFILE_KEY,
            value: "companion-access-evidence",
        })
        .await?;
        assert_eq!(
            NookDatabase::load_identity_directory().await?.selection(),
            &IdentitySelection::Selected(second.identity.identity_id.clone())
        );

        let recovery = LocalIdentityRecoveryRequest {
            target: RecoveryTarget::App(first_key.app_id().clone()),
        }
        .execute()
        .await?;
        let retried_recovery = LocalIdentityRecoveryRequest {
            target: RecoveryTarget::App(first_key.app_id().clone()),
        }
        .execute()
        .await?;
        assert_eq!(retried_recovery, recovery);

        let resumed_after_reload = LocalIdentityRecoveryRequest {
            target: RecoveryTarget::App(second_key.app_id().clone()),
        }
        .execute()
        .await?;
        assert_eq!(resumed_after_reload, recovery);

        let directory = NookDatabase::load_identity_directory().await?;
        assert_eq!(directory.identities().len(), 1);
        assert_eq!(
            directory.identities()[0].identity_id,
            second.identity.identity_id
        );
        assert!(directory.retired_app_ids().contains(first_key.app_id()));
        let remaining_keyring = NookDatabase::load_keyring().await?;
        assert_eq!(remaining_keyring.entries().len(), 1);
        assert_eq!(remaining_keyring.entries()[0].app_id(), second_key.app_id());
        assert_ne!(first.identity.identity_id, second.identity.identity_id);
        assert_eq!(
            NookDatabase::idb_get_string(&unrelated_marker).await?,
            StoredStringRecord::Stored("remaining-identity-plan".to_owned())
        );
        assert_eq!(
            NookDatabase::idb_get_string(device_access::DEVICE_ACCESS_PROFILE_KEY).await?,
            StoredStringRecord::Stored("companion-access-evidence".to_owned())
        );

        recovery.complete().await?;
        NookDatabase::idb_delete_key(&unrelated_marker).await?;
        NookDatabase::idb_delete_key(device_access::DEVICE_ACCESS_PROFILE_KEY).await?;
        NookDatabase::clear_keyring_for_test().await?;
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
    async fn scoped_recovery_preserves_a_different_surviving_selection() -> Result<(), NookError> {
        NookDatabase::clear_identity_directory_for_test().await?;
        NookDatabase::clear_keyring_for_test().await?;
        let first_key = AppKey::generate().map_err(NookDatabase::map_domain_error)?;
        let second_key = AppKey::generate().map_err(NookDatabase::map_domain_error)?;
        let third_key = AppKey::generate().map_err(NookDatabase::map_domain_error)?;
        let first_wrapped =
            DeviceIdentityProtection::new(&first_key.secret_string()).with_pin("first-secret")?;
        let second_wrapped =
            DeviceIdentityProtection::new(&second_key.secret_string()).with_pin("second-secret")?;
        let third_wrapped =
            DeviceIdentityProtection::new(&third_key.secret_string()).with_pin("third-secret")?;
        let first = NookDatabase::save_new_protected_local_identity(
            IdentityDbSaveNewProtectedLocalIdentity {
                app_key: &first_key,
                record: &first_wrapped,
                prior_app_key: PriorAppAuthorization::Unavailable,
                label: "Personal",
            },
        )
        .await?;
        NookDatabase::save_new_protected_local_identity(IdentityDbSaveNewProtectedLocalIdentity {
            app_key: &second_key,
            record: &second_wrapped,
            prior_app_key: PriorAppAuthorization::Unavailable,
            label: "Work",
        })
        .await?;
        let third = NookDatabase::save_new_protected_local_identity(
            IdentityDbSaveNewProtectedLocalIdentity {
                app_key: &third_key,
                record: &third_wrapped,
                prior_app_key: PriorAppAuthorization::Unavailable,
                label: "Family",
            },
        )
        .await?;

        let recovery = LocalIdentityRecoveryRequest {
            target: RecoveryTarget::App(first_key.app_id().clone()),
        }
        .execute()
        .await?;

        let directory = NookDatabase::load_identity_directory().await?;
        assert_eq!(directory.identities().len(), 2);
        assert_eq!(
            directory.selection(),
            &IdentitySelection::Selected(third.identity.identity_id)
        );
        assert!(directory.retired_app_ids().contains(first_key.app_id()));
        assert_ne!(
            first.identity.identity_id,
            directory.identities()[0].identity_id
        );
        recovery.complete().await?;
        NookDatabase::clear_keyring_for_test().await?;
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
    async fn recovery_rejects_a_corrupt_keyring_without_replacing_the_directory()
    -> Result<(), NookError> {
        NookDatabase::clear_identity_directory_for_test().await?;
        NookDatabase::clear_keyring_for_test().await?;
        let first_key = AppKey::generate().map_err(NookDatabase::map_domain_error)?;
        let second_key = AppKey::generate().map_err(NookDatabase::map_domain_error)?;
        let first_wrapped =
            DeviceIdentityProtection::new(&first_key.secret_string()).with_pin("first-secret")?;
        let second_wrapped =
            DeviceIdentityProtection::new(&second_key.secret_string()).with_pin("second-secret")?;
        NookDatabase::save_new_protected_local_identity(IdentityDbSaveNewProtectedLocalIdentity {
            app_key: &first_key,
            record: &first_wrapped,
            prior_app_key: PriorAppAuthorization::Unavailable,
            label: "Personal",
        })
        .await?;
        NookDatabase::save_new_protected_local_identity(IdentityDbSaveNewProtectedLocalIdentity {
            app_key: &second_key,
            record: &second_wrapped,
            prior_app_key: PriorAppAuthorization::Unavailable,
            label: "Work",
        })
        .await?;
        let directory_before = match NookDatabase::idb_get_string(IDENTITY_DIRECTORY_KEY).await? {
            StoredStringRecord::Stored(value) => Ok(value),
            StoredStringRecord::MissingKey => Err(NookError::IndexedDb(
                "Identity directory is missing".to_owned(),
            )),
        }?;
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: keyring::LOCAL_IDENTITY_KEYRING_KEY,
            value: "{future-or-corrupt",
        })
        .await?;

        let result = LocalIdentityRecoveryRequest {
            target: RecoveryTarget::App(second_key.app_id().clone()),
        }
        .execute()
        .await;

        assert!(matches!(
            result,
            Err(NookError::IndexedDb(message)) if message.contains("keyring decode")
        ));
        assert_eq!(
            NookDatabase::idb_get_string(IDENTITY_DIRECTORY_KEY).await?,
            StoredStringRecord::Stored(directory_before)
        );
        assert_eq!(
            NookDatabase::idb_get_string(keyring::LOCAL_IDENTITY_KEYRING_KEY).await?,
            StoredStringRecord::Stored("{future-or-corrupt".to_owned())
        );
        NookDatabase::clear_keyring_for_test().await?;
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
    async fn scoped_recovery_preserves_simple_genesis_owned_by_a_remaining_identity()
    -> Result<(), NookError> {
        NookDatabase::clear_identity_directory_for_test().await?;
        NookDatabase::clear_keyring_for_test().await?;
        let first_key = AppKey::generate().map_err(NookDatabase::map_domain_error)?;
        let second_key = AppKey::generate().map_err(NookDatabase::map_domain_error)?;
        let first_wrapped =
            DeviceIdentityProtection::new(&first_key.secret_string()).with_pin("first-secret")?;
        let second_wrapped =
            DeviceIdentityProtection::new(&second_key.secret_string()).with_pin("second-secret")?;
        let first = NookDatabase::save_new_protected_local_identity(
            IdentityDbSaveNewProtectedLocalIdentity {
                app_key: &first_key,
                record: &first_wrapped,
                prior_app_key: PriorAppAuthorization::Unavailable,
                label: "Personal",
            },
        )
        .await?;
        NookDatabase::save_new_protected_local_identity(IdentityDbSaveNewProtectedLocalIdentity {
            app_key: &second_key,
            record: &second_wrapped,
            prior_app_key: PriorAppAuthorization::Unavailable,
            label: "Work",
        })
        .await?;
        let pending = identity_record::OrdinarySimpleGenesisRequest {
            app_key: &first_key,
            label: "Personal",
        }
        .begin_or_resume()
        .await?;
        assert_eq!(pending.identity_id, first.identity.identity_id);

        let recovery = LocalIdentityRecoveryRequest {
            target: RecoveryTarget::App(second_key.app_id().clone()),
        }
        .execute()
        .await?;

        let preserved = PendingSimpleGenesis::load_for_store(pending.store_id.as_str())
            .await?
            .require_pending()
            .map_err(|_| NookError::IndexedDb("Pending Simple genesis was erased".to_owned()))?;
        assert_eq!(preserved.identity_id, first.identity.identity_id);
        recovery.complete().await?;
        NookDatabase::clear_keyring_for_test().await?;
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
    async fn peer_only_identity_does_not_block_replacement_local_protection()
    -> Result<(), NookError> {
        NookDatabase::clear_identity_directory_for_test().await?;
        NookDatabase::clear_keyring_for_test().await?;
        let local_key = AppKey::generate().map_err(NookDatabase::map_domain_error)?;
        let wrapped =
            DeviceIdentityProtection::new(&local_key.secret_string()).with_pin("local-secret")?;
        let saved = NookDatabase::save_new_protected_local_identity(
            IdentityDbSaveNewProtectedLocalIdentity {
                app_key: &local_key,
                record: &wrapped,
                prior_app_key: PriorAppAuthorization::Unavailable,
                label: "Personal",
            },
        )
        .await?;
        let peer_key = AppKey::generate().map_err(NookDatabase::map_domain_error)?;
        let identity_id = saved.identity.identity_id.clone();
        NookDatabase::update_identity_directory(move |directory| {
            directory
                .add_selected_member(nook_core::IdentityMember {
                    app_id: peer_key.app_id().clone(),
                    auth_id: peer_key.auth_id(),
                    public_key: peer_key.public_key(),
                    signing_public_key: DeviceSigningPublicKey::Unavailable,
                    label: MemberLabelState::Unnamed,
                })
                .map(IdentityDirectoryWrite::from)
                .map_err(|rejected| NookDatabase::map_domain_error(rejected.into_cause()))
        })
        .await?;

        let recovery = LocalIdentityRecoveryRequest {
            target: RecoveryTarget::App(local_key.app_id().clone()),
        }
        .execute()
        .await?;

        let recovered_directory = NookDatabase::load_identity_directory().await?;
        assert_eq!(recovered_directory.selection(), &IdentitySelection::Empty);
        assert_eq!(recovered_directory.identities().len(), 1);
        assert_eq!(recovered_directory.identities()[0].identity_id, identity_id);
        recovery.complete().await?;
        let replacement_key = AppKey::generate().map_err(NookDatabase::map_domain_error)?;
        let replacement_wrapped = DeviceIdentityProtection::new(&replacement_key.secret_string())
            .with_pin("replacement-secret")?;
        let replacement =
            NookDatabase::save_protected_local_identity(IdentityDbSaveProtectedLocalIdentity {
                app_key: &replacement_key,
                record: &replacement_wrapped,
                label: "Recovered",
            })
            .await?;
        assert_ne!(replacement.identity.identity_id, identity_id);
        NookDatabase::clear_keyring_for_test().await?;
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
    async fn scoped_recovery_rejects_an_unattributed_sentinel_marker() -> Result<(), NookError> {
        NookDatabase::clear_identity_directory_for_test().await?;
        NookDatabase::clear_keyring_for_test().await?;
        let first_key = AppKey::generate().map_err(NookDatabase::map_domain_error)?;
        let second_key = AppKey::generate().map_err(NookDatabase::map_domain_error)?;
        let first_wrapped =
            DeviceIdentityProtection::new(&first_key.secret_string()).with_pin("first-secret")?;
        let second_wrapped =
            DeviceIdentityProtection::new(&second_key.secret_string()).with_pin("second-secret")?;
        NookDatabase::save_new_protected_local_identity(IdentityDbSaveNewProtectedLocalIdentity {
            app_key: &first_key,
            record: &first_wrapped,
            prior_app_key: PriorAppAuthorization::Unavailable,
            label: "Personal",
        })
        .await?;
        NookDatabase::save_new_protected_local_identity(IdentityDbSaveNewProtectedLocalIdentity {
            app_key: &second_key,
            record: &second_wrapped,
            prior_app_key: PriorAppAuthorization::Unavailable,
            label: "Work",
        })
        .await?;
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: indexed_db::SENTINEL_GENESIS_FINALIZATION_PENDING_KEY,
            value: "{}",
        })
        .await?;

        let result = LocalIdentityRecoveryRequest {
            target: RecoveryTarget::App(second_key.app_id().clone()),
        }
        .execute()
        .await;

        assert!(matches!(
            result,
            Err(NookError::Database(message)) if message.contains("Sentinel")
        ));
        assert_eq!(NookDatabase::load_keyring().await?.entries().len(), 2);
        assert_eq!(
            NookDatabase::idb_get_string(indexed_db::SENTINEL_GENESIS_FINALIZATION_PENDING_KEY)
                .await?,
            StoredStringRecord::Stored("{}".to_owned())
        );
        NookDatabase::idb_delete_key(indexed_db::SENTINEL_GENESIS_FINALIZATION_PENDING_KEY).await?;
        NookDatabase::clear_keyring_for_test().await?;
        NookDatabase::clear_identity_directory_for_test().await
    }
}

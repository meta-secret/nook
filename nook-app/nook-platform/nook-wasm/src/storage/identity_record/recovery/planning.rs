#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! Selection of the initiating local identity and surviving protected keys.
use crate::NookError;
use crate::storage::{device_access, identity_record, indexed_db};
use identity_record::keyring;
use nook_core::{AppId, IdentityDirectory, IdentitySelection, LocalIdentityKeyring};
pub(super) struct RecoveryState {
    pub(super) directory: nook_core::IdentityDirectory,
    pub(super) keyring: nook_core::LocalIdentityKeyring,
    pub(super) retired_identity_id: Option<nook_core::IdentityId>,
    pub(super) retired_app_id: Option<nook_core::AppId>,
    pub(super) access_profile_keys: Vec<String>,
    pub(super) clear_reconciliation: bool,
}

struct RecoveryDirectory {
    value: IdentityDirectory,
    readable: bool,
}
pub(super) struct RecoveryPlanning<'a> {
    pub(super) store: &'a rexie::Store,
    pub(super) expected_app_id: Option<&'a AppId>,
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
    async fn directory(&self) -> Result<RecoveryDirectory, NookError> {
        let store = self.store;
        let directory_key = serde_wasm_bindgen::to_value(identity_record::IDENTITY_DIRECTORY_KEY)
            .map_err(|error| {
            NookError::IndexedDb(format!("Identity reset key error: {error:?}"))
        })?;
        let raw = store.get(directory_key).await.map_err(|error| {
            NookError::IndexedDb(format!("Identity reset read error: {error:?}"))
        })?;
        let (mut directory, readable) =
            match raw.filter(|value| !value.is_undefined() && !value.is_null()) {
                Some(value) => match serde_wasm_bindgen::from_value::<String>(value)
                    .ok()
                    .and_then(|raw| identity_record::decode_directory(&raw).ok())
                {
                    Some(directory) => (directory, true),
                    None => (IdentityDirectory::empty(), false),
                },
                // A missing directory cannot prove which identity owns a surviving
                // keyring entry. Route recovery through the same safe full-reset
                // path as corrupt or future-incompatible directory metadata.
                None => (IdentityDirectory::empty(), false),
            };
        for app_id in identity_record::load_retired_app_ids(store)
            .await
            .unwrap_or_default()
        {
            directory.retire_app_id(app_id);
        }
        Ok(RecoveryDirectory {
            value: directory,
            readable,
        })
    }
    async fn legacy_app_id(&self) -> Option<AppId> {
        let store = self.store;
        indexed_db::read_string_preferring(
            store,
            indexed_db::APP_ID_KEY,
            indexed_db::DEVICE_ID_KEY,
            "Identity reset app id",
        )
        .await
        .ok()
        .flatten()
        .and_then(|raw| AppId::parse(&raw).ok())
    }
    async fn full(self, input: FullRecovery) -> Result<RecoveryState, NookError> {
        let FullRecovery {
            mut directory,
            keyring,
        } = input;
        let expected_app_id = self.expected_app_id;
        let persisted_app_id = self.legacy_app_id().await;
        if let Some(expected) = expected_app_id {
            let target_exists = keyring
                .entries()
                .iter()
                .any(|entry| entry.app_id() == expected)
                || persisted_app_id.as_ref() == Some(expected);
            if !target_exists {
                return Err(NookError::Database(
                    "Recovery target changed before confirmation".to_owned(),
                ));
            }
        }
        let app_ids = keyring
            .entries()
            .iter()
            .map(|entry| entry.app_id().clone())
            .chain(persisted_app_id.clone())
            .collect::<Vec<_>>();
        let access_profile_keys = app_ids
            .iter()
            .map(|app_id| RecoveryAccessProfile { app_id }.key())
            .collect();
        directory.reset_for_device_recovery(None);
        for app_id in app_ids {
            directory.retire_app_id(app_id);
        }
        directory
            .validate()
            .map_err(|error| NookError::Database(error.to_string()))?;
        Ok(RecoveryState {
            directory,
            keyring: LocalIdentityKeyring::empty(),
            retired_identity_id: None,
            retired_app_id: expected_app_id.cloned().or(persisted_app_id),
            access_profile_keys,
            clear_reconciliation: true,
        })
    }
    pub(super) async fn prepare(self) -> Result<RecoveryState, NookError> {
        let store = self.store;
        let expected_app_id = self.expected_app_id;
        let recovered_directory = self.directory().await?;
        if !recovered_directory.readable {
            let keyring = keyring::load_persisted_keyring_for_recovery(store).await?;
            return self
                .full(FullRecovery {
                    directory: recovered_directory.value,
                    keyring,
                })
                .await;
        }
        let mut directory = recovered_directory.value;
        let mut keyring = keyring::load_keyring_for_store(store, &directory).await?;
        let target_entry = if keyring.entries().is_empty() {
            None
        } else {
            let expected = expected_app_id.ok_or_else(|| {
                NookError::Database("Recovery requires the initiating app identity".to_owned())
            })?;
            Some(
                keyring
                    .entries()
                    .iter()
                    .find(|entry| entry.app_id() == expected)
                    .cloned()
                    .ok_or_else(|| {
                        NookError::Database(
                            "Recovery target changed before confirmation".to_owned(),
                        )
                    })?,
            )
        };
        let (retired_identity_id, retired_app_id, access_profile_keys) =
            if let Some(entry) = target_entry {
                let prior_selection = directory.selection().clone();
                let retired_identity_id = entry.identity_id().clone();
                keyring
                    .remove(entry.identity_id())
                    .map_err(|error| NookError::Database(error.to_string()))?;
                directory
                    .retire_local_identity_key(entry.identity_id(), entry.app_id())
                    .map_err(|error| NookError::Database(error.to_string()))?;
                let surviving_selection = match prior_selection {
                    IdentitySelection::Selected(identity_id)
                        if keyring.entry(&identity_id).is_some() =>
                    {
                        Some(identity_id)
                    }
                    IdentitySelection::Empty | IdentitySelection::Selected(_) => None,
                };
                if let Some(identity_id) = surviving_selection {
                    directory
                        .select(&identity_id)
                        .map_err(|error| NookError::Database(error.to_string()))?;
                } else if let Some(next) = keyring.entries().first() {
                    directory
                        .select(next.identity_id())
                        .map_err(|error| NookError::Database(error.to_string()))?;
                } else {
                    directory.clear_selection();
                }
                (
                    Some(retired_identity_id),
                    Some(entry.app_id().clone()),
                    vec![
                        RecoveryAccessProfile {
                            app_id: entry.app_id(),
                        }
                        .key(),
                    ],
                )
            } else {
                let persisted_app_id = self.legacy_app_id().await;
                if let Some(expected) = expected_app_id
                    && persisted_app_id.as_ref() != Some(expected)
                {
                    return Err(NookError::Database(
                        "Recovery target changed before confirmation".to_owned(),
                    ));
                }
                directory.reset_for_device_recovery(persisted_app_id.clone());
                keyring = LocalIdentityKeyring::empty();
                (None, persisted_app_id, Vec::new())
            };
        directory
            .validate()
            .map_err(|error| NookError::Database(error.to_string()))?;
        Ok(RecoveryState {
            clear_reconciliation: keyring.entries().is_empty(),
            directory,
            keyring,
            retired_identity_id,
            retired_app_id,
            access_profile_keys,
        })
    }
}
#[cfg(test)]
mod tests {
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
        identity_record::clear_identity_directory_for_test().await?;
        let inaccessible_key = AppKey::generate().map_err(identity_record::map_domain_error)?;
        let wrapped = DeviceIdentityProtection::new(&inaccessible_key.secret_string())
            .with_pin("test-pin")?;
        identity_record::save_protected_local_identity(&inaccessible_key, &wrapped, "Personal")
            .await?;
        let pending = identity_record::OrdinarySimpleGenesisRequest {
            app_key: &inaccessible_key,
            label: "Personal",
        }
        .begin_or_resume()
        .await?;
        let store_id = pending.store_id.clone();
        let _ = identity_record::generate_vault_dek_for_identity(
            &pending.identity_id,
            &inaccessible_key,
            store_id.clone(),
        )
        .await?;
        let marker_v2 = format!("pending_identity_reconciliation_v2:{store_id}");
        let marker_v1 = format!("pending_identity_reconciliation_v1:{store_id}");
        indexed_db::idb_put_string(&marker_v2, "stale-v2").await?;
        indexed_db::idb_put_string(&marker_v1, "stale-v1").await?;
        let current_app_id = keyring::load_keyring().await?.entries()[0].app_id().clone();
        let recovery = LocalIdentityRecoveryRequest {
            expected_app_id: Some(current_app_id),
        }
        .execute()
        .await?;

        assert!(indexed_db::idb_get_string(&marker_v2).await?.is_none());
        assert!(indexed_db::idb_get_string(&marker_v1).await?.is_none());

        let stale_result =
            identity_record::ensure_local_identity_for_app_key(&inaccessible_key, "Stale").await;
        assert!(matches!(
            stale_result,
            Err(NookError::Database(message)) if message.contains("retired")
        ));

        let replacement_key = AppKey::generate().map_err(identity_record::map_domain_error)?;
        let replacement =
            identity_record::ensure_local_identity_for_app_key(&replacement_key, "Recovered")
                .await?;
        assert_ne!(replacement.identity_id, pending.identity_id);
        identity_record::validate_vault_identity_enrollment(&replacement_key, &store_id).await?;
        assert!(
            PendingSimpleGenesis::load_for_store(store_id.as_str())
                .await?
                .is_none()
        );
        recovery.complete().await?;
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
    async fn destructive_recovery_bypasses_a_corrupt_identity_directory() -> Result<(), NookError> {
        identity_record::clear_identity_directory_for_test().await?;
        let store_id = nook_core::StoreId::generate().map_err(identity_record::map_domain_error)?;
        let stale_key = AppKey::generate().map_err(identity_record::map_domain_error)?;
        let earlier_key = AppKey::generate().map_err(identity_record::map_domain_error)?;
        indexed_db::idb_put_string(
            RETIRED_APP_IDS_KEY,
            &serde_json::to_string(&vec![earlier_key.app_id()])
                .map_err(|error| NookError::IndexedDb(error.to_string()))?,
        )
        .await?;
        indexed_db::idb_put_string(
            "vault_registry",
            &format!(r#"{{"vaults":[{{"store_id":"{store_id}","label":""}}]}}"#),
        )
        .await?;
        let marker = format!("pending_identity_reconciliation_v2:{store_id}");
        indexed_db::idb_put_string(&marker, "inaccessible-plan").await?;
        indexed_db::idb_put_string(IDENTITY_DIRECTORY_KEY, "{future-or-corrupt").await?;
        indexed_db::idb_put_string(indexed_db::APP_ID_KEY, stale_key.app_id().as_str()).await?;
        indexed_db::idb_put_string(indexed_db::APP_KEY_WRAPPED_KEY, "inaccessible").await?;

        let recovery = LocalIdentityRecoveryRequest {
            expected_app_id: Some(stale_key.app_id().clone()),
        }
        .execute()
        .await?;

        assert!(
            indexed_db::idb_get_string(indexed_db::APP_KEY_WRAPPED_KEY)
                .await?
                .is_none()
        );
        assert!(indexed_db::idb_get_string(&marker).await?.is_none());
        let recovered = identity_record::load_identity_directory().await?;
        assert!(recovered.identities().is_empty());
        assert!(matches!(
            identity_record::ensure_local_identity_for_app_key(&stale_key, "Stale").await,
            Err(NookError::Database(message)) if message.contains("retired")
        ));
        assert!(
            identity_record::ensure_local_identity_for_app_key(&earlier_key, "Earlier")
                .await
                .is_err()
        );
        recovery.complete().await?;
        indexed_db::idb_delete_key("vault_registry").await?;
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
    async fn destructive_recovery_bypasses_corrupt_indexes_and_deletes_markers()
    -> Result<(), NookError> {
        identity_record::clear_identity_directory_for_test().await?;
        let store_id = nook_core::StoreId::generate().map_err(identity_record::map_domain_error)?;
        let marker = format!("pending_identity_reconciliation_v2:{store_id}");
        indexed_db::idb_put_string(IDENTITY_DIRECTORY_KEY, "{corrupt").await?;
        indexed_db::idb_put_string("vault_registry", "{corrupt").await?;
        indexed_db::idb_put_string(RETIRED_APP_IDS_KEY, "{corrupt").await?;
        indexed_db::idb_put_string(&marker, "inaccessible-plan").await?;
        indexed_db::idb_put_string(indexed_db::APP_KEY_WRAPPED_KEY, "inaccessible").await?;
        indexed_db::idb_put_string(event_db::SIGNING_SEED_KEY, &"11".repeat(32)).await?;
        let recovery = LocalIdentityRecoveryRequest {
            expected_app_id: None,
        }
        .execute()
        .await?;
        assert!(
            indexed_db::idb_get_string(indexed_db::APP_KEY_WRAPPED_KEY)
                .await?
                .is_none()
        );
        assert!(
            indexed_db::idb_get_string(event_db::SIGNING_SEED_KEY)
                .await?
                .is_none()
        );
        assert!(indexed_db::idb_get_string(&marker).await?.is_none());
        let recovered = identity_record::load_identity_directory().await?;
        assert!(recovered.retired_app_ids().is_empty());
        recovery.complete().await?;
        indexed_db::idb_delete_key("vault_registry").await?;
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
    async fn recovery_targets_the_initiating_identity_not_the_shared_selection()
    -> Result<(), NookError> {
        identity_record::clear_identity_directory_for_test().await?;
        keyring::clear_keyring_for_test().await?;
        let first_key = AppKey::generate().map_err(identity_record::map_domain_error)?;
        let second_key = AppKey::generate().map_err(identity_record::map_domain_error)?;
        let first_wrapped =
            DeviceIdentityProtection::new(&first_key.secret_string()).with_pin("first-secret")?;
        let second_wrapped =
            DeviceIdentityProtection::new(&second_key.secret_string()).with_pin("second-secret")?;
        let first = identity_record::save_new_protected_local_identity(
            &first_key,
            &first_wrapped,
            None,
            "Personal",
        )
        .await?;
        let second = identity_record::save_new_protected_local_identity(
            &second_key,
            &second_wrapped,
            None,
            "Work",
        )
        .await?;
        let unrelated_store_id =
            nook_core::StoreId::generate().map_err(identity_record::map_domain_error)?;
        let unrelated_marker = format!("pending_identity_reconciliation_v2:{unrelated_store_id}");
        indexed_db::idb_put_string(&unrelated_marker, "remaining-identity-plan").await?;
        indexed_db::idb_put_string(
            device_access::DEVICE_ACCESS_PROFILE_KEY,
            "companion-access-evidence",
        )
        .await?;
        assert_eq!(
            identity_record::load_identity_directory()
                .await?
                .selection(),
            &IdentitySelection::Selected(second.identity.identity_id.clone())
        );

        let recovery = LocalIdentityRecoveryRequest {
            expected_app_id: Some(first_key.app_id().clone()),
        }
        .execute()
        .await?;
        let retried_recovery = LocalIdentityRecoveryRequest {
            expected_app_id: Some(first_key.app_id().clone()),
        }
        .execute()
        .await?;
        assert_eq!(retried_recovery, recovery);

        let resumed_after_reload = LocalIdentityRecoveryRequest {
            expected_app_id: Some(second_key.app_id().clone()),
        }
        .execute()
        .await?;
        assert_eq!(resumed_after_reload, recovery);

        let directory = identity_record::load_identity_directory().await?;
        assert_eq!(directory.identities().len(), 1);
        assert_eq!(
            directory.identities()[0].identity_id,
            second.identity.identity_id
        );
        assert!(directory.retired_app_ids().contains(first_key.app_id()));
        let remaining_keyring = keyring::load_keyring().await?;
        assert_eq!(remaining_keyring.entries().len(), 1);
        assert_eq!(remaining_keyring.entries()[0].app_id(), second_key.app_id());
        assert_ne!(first.identity.identity_id, second.identity.identity_id);
        assert_eq!(
            indexed_db::idb_get_string(&unrelated_marker).await?,
            Some("remaining-identity-plan".to_owned())
        );
        assert_eq!(
            indexed_db::idb_get_string(device_access::DEVICE_ACCESS_PROFILE_KEY).await?,
            Some("companion-access-evidence".to_owned())
        );

        recovery.complete().await?;
        indexed_db::idb_delete_key(&unrelated_marker).await?;
        indexed_db::idb_delete_key(device_access::DEVICE_ACCESS_PROFILE_KEY).await?;
        keyring::clear_keyring_for_test().await?;
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
    async fn scoped_recovery_preserves_a_different_surviving_selection() -> Result<(), NookError> {
        identity_record::clear_identity_directory_for_test().await?;
        keyring::clear_keyring_for_test().await?;
        let first_key = AppKey::generate().map_err(identity_record::map_domain_error)?;
        let second_key = AppKey::generate().map_err(identity_record::map_domain_error)?;
        let third_key = AppKey::generate().map_err(identity_record::map_domain_error)?;
        let first_wrapped =
            DeviceIdentityProtection::new(&first_key.secret_string()).with_pin("first-secret")?;
        let second_wrapped =
            DeviceIdentityProtection::new(&second_key.secret_string()).with_pin("second-secret")?;
        let third_wrapped =
            DeviceIdentityProtection::new(&third_key.secret_string()).with_pin("third-secret")?;
        let first = identity_record::save_new_protected_local_identity(
            &first_key,
            &first_wrapped,
            None,
            "Personal",
        )
        .await?;
        identity_record::save_new_protected_local_identity(
            &second_key,
            &second_wrapped,
            None,
            "Work",
        )
        .await?;
        let third = identity_record::save_new_protected_local_identity(
            &third_key,
            &third_wrapped,
            None,
            "Family",
        )
        .await?;

        let recovery = LocalIdentityRecoveryRequest {
            expected_app_id: Some(first_key.app_id().clone()),
        }
        .execute()
        .await?;

        let directory = identity_record::load_identity_directory().await?;
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
        keyring::clear_keyring_for_test().await?;
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
    async fn corrupt_directory_with_valid_keyring_uses_safe_full_reset() -> Result<(), NookError> {
        identity_record::clear_identity_directory_for_test().await?;
        keyring::clear_keyring_for_test().await?;
        let first_key = AppKey::generate().map_err(identity_record::map_domain_error)?;
        let second_key = AppKey::generate().map_err(identity_record::map_domain_error)?;
        let first_wrapped =
            DeviceIdentityProtection::new(&first_key.secret_string()).with_pin("first-secret")?;
        let second_wrapped =
            DeviceIdentityProtection::new(&second_key.secret_string()).with_pin("second-secret")?;
        identity_record::save_new_protected_local_identity(
            &first_key,
            &first_wrapped,
            None,
            "Personal",
        )
        .await?;
        identity_record::save_new_protected_local_identity(
            &second_key,
            &second_wrapped,
            None,
            "Work",
        )
        .await?;
        indexed_db::idb_put_string(IDENTITY_DIRECTORY_KEY, "{future-or-corrupt").await?;

        let recovery = LocalIdentityRecoveryRequest {
            expected_app_id: Some(first_key.app_id().clone()),
        }
        .execute()
        .await?;

        assert!(!recovery.has_remaining_local_identities);
        assert!(keyring::load_keyring().await?.entries().is_empty());
        let directory = identity_record::load_identity_directory().await?;
        assert!(directory.identities().is_empty());
        assert!(directory.retired_app_ids().contains(first_key.app_id()));
        assert!(directory.retired_app_ids().contains(second_key.app_id()));
        recovery.complete().await?;
        keyring::clear_keyring_for_test().await?;
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
    async fn missing_directory_with_valid_keyring_uses_safe_full_reset() -> Result<(), NookError> {
        identity_record::clear_identity_directory_for_test().await?;
        keyring::clear_keyring_for_test().await?;
        let first_key = AppKey::generate().map_err(identity_record::map_domain_error)?;
        let second_key = AppKey::generate().map_err(identity_record::map_domain_error)?;
        let first_wrapped =
            DeviceIdentityProtection::new(&first_key.secret_string()).with_pin("first-secret")?;
        let second_wrapped =
            DeviceIdentityProtection::new(&second_key.secret_string()).with_pin("second-secret")?;
        identity_record::save_new_protected_local_identity(
            &first_key,
            &first_wrapped,
            None,
            "Personal",
        )
        .await?;
        identity_record::save_new_protected_local_identity(
            &second_key,
            &second_wrapped,
            None,
            "Work",
        )
        .await?;
        indexed_db::idb_delete_key(IDENTITY_DIRECTORY_KEY).await?;

        let recovery = LocalIdentityRecoveryRequest {
            expected_app_id: Some(first_key.app_id().clone()),
        }
        .execute()
        .await?;

        assert!(!recovery.has_remaining_local_identities);
        assert!(keyring::load_keyring().await?.entries().is_empty());
        let directory = identity_record::load_identity_directory().await?;
        assert!(directory.identities().is_empty());
        assert!(directory.retired_app_ids().contains(first_key.app_id()));
        assert!(directory.retired_app_ids().contains(second_key.app_id()));
        recovery.complete().await?;
        keyring::clear_keyring_for_test().await?;
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
    async fn recovery_rejects_a_corrupt_keyring_without_replacing_the_directory()
    -> Result<(), NookError> {
        identity_record::clear_identity_directory_for_test().await?;
        keyring::clear_keyring_for_test().await?;
        let first_key = AppKey::generate().map_err(identity_record::map_domain_error)?;
        let second_key = AppKey::generate().map_err(identity_record::map_domain_error)?;
        let first_wrapped =
            DeviceIdentityProtection::new(&first_key.secret_string()).with_pin("first-secret")?;
        let second_wrapped =
            DeviceIdentityProtection::new(&second_key.secret_string()).with_pin("second-secret")?;
        identity_record::save_new_protected_local_identity(
            &first_key,
            &first_wrapped,
            None,
            "Personal",
        )
        .await?;
        identity_record::save_new_protected_local_identity(
            &second_key,
            &second_wrapped,
            None,
            "Work",
        )
        .await?;
        let directory_before = indexed_db::idb_get_string(IDENTITY_DIRECTORY_KEY)
            .await?
            .ok_or_else(|| NookError::IndexedDb("Identity directory is missing".to_owned()))?;
        indexed_db::idb_put_string(keyring::LOCAL_IDENTITY_KEYRING_KEY, "{future-or-corrupt")
            .await?;

        let result = LocalIdentityRecoveryRequest {
            expected_app_id: Some(second_key.app_id().clone()),
        }
        .execute()
        .await;

        assert!(matches!(
            result,
            Err(NookError::IndexedDb(message)) if message.contains("keyring decode")
        ));
        assert_eq!(
            indexed_db::idb_get_string(IDENTITY_DIRECTORY_KEY).await?,
            Some(directory_before)
        );
        assert_eq!(
            indexed_db::idb_get_string(keyring::LOCAL_IDENTITY_KEYRING_KEY).await?,
            Some("{future-or-corrupt".to_owned())
        );
        keyring::clear_keyring_for_test().await?;
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
    async fn scoped_recovery_preserves_simple_genesis_owned_by_a_remaining_identity()
    -> Result<(), NookError> {
        identity_record::clear_identity_directory_for_test().await?;
        keyring::clear_keyring_for_test().await?;
        let first_key = AppKey::generate().map_err(identity_record::map_domain_error)?;
        let second_key = AppKey::generate().map_err(identity_record::map_domain_error)?;
        let first_wrapped =
            DeviceIdentityProtection::new(&first_key.secret_string()).with_pin("first-secret")?;
        let second_wrapped =
            DeviceIdentityProtection::new(&second_key.secret_string()).with_pin("second-secret")?;
        let first = identity_record::save_new_protected_local_identity(
            &first_key,
            &first_wrapped,
            None,
            "Personal",
        )
        .await?;
        identity_record::save_new_protected_local_identity(
            &second_key,
            &second_wrapped,
            None,
            "Work",
        )
        .await?;
        let pending = identity_record::OrdinarySimpleGenesisRequest {
            app_key: &first_key,
            label: "Personal",
        }
        .begin_or_resume()
        .await?;
        assert_eq!(pending.identity_id, first.identity.identity_id);

        let recovery = LocalIdentityRecoveryRequest {
            expected_app_id: Some(second_key.app_id().clone()),
        }
        .execute()
        .await?;

        let preserved = PendingSimpleGenesis::load_for_store(pending.store_id.as_str())
            .await?
            .ok_or_else(|| NookError::IndexedDb("Pending Simple genesis was erased".to_owned()))?;
        assert_eq!(preserved.identity_id, first.identity.identity_id);
        recovery.complete().await?;
        keyring::clear_keyring_for_test().await?;
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
    async fn peer_only_identity_does_not_block_replacement_local_protection()
    -> Result<(), NookError> {
        identity_record::clear_identity_directory_for_test().await?;
        keyring::clear_keyring_for_test().await?;
        let local_key = AppKey::generate().map_err(identity_record::map_domain_error)?;
        let wrapped =
            DeviceIdentityProtection::new(&local_key.secret_string()).with_pin("local-secret")?;
        let saved = identity_record::save_new_protected_local_identity(
            &local_key, &wrapped, None, "Personal",
        )
        .await?;
        let peer_key = AppKey::generate().map_err(identity_record::map_domain_error)?;
        let identity_id = saved.identity.identity_id.clone();
        identity_record::update_identity_directory(move |directory| {
            directory
                .selected_mut()
                .map_err(identity_record::map_domain_error)?
                .add_member(nook_core::IdentityMember {
                    app_id: peer_key.app_id().clone(),
                    auth_id: peer_key.auth_id(),
                    public_key: peer_key.public_key(),
                    signing_public_key: DeviceSigningPublicKey::Unavailable,
                    label: None,
                })
                .map_err(identity_record::map_domain_error)
        })
        .await?;

        let recovery = LocalIdentityRecoveryRequest {
            expected_app_id: Some(local_key.app_id().clone()),
        }
        .execute()
        .await?;

        let recovered_directory = identity_record::load_identity_directory().await?;
        assert_eq!(recovered_directory.selection(), &IdentitySelection::Empty);
        assert_eq!(recovered_directory.identities().len(), 1);
        assert_eq!(recovered_directory.identities()[0].identity_id, identity_id);
        recovery.complete().await?;
        let replacement_key = AppKey::generate().map_err(identity_record::map_domain_error)?;
        let replacement_wrapped = DeviceIdentityProtection::new(&replacement_key.secret_string())
            .with_pin("replacement-secret")?;
        let replacement = identity_record::save_protected_local_identity(
            &replacement_key,
            &replacement_wrapped,
            "Recovered",
        )
        .await?;
        assert_ne!(replacement.identity.identity_id, identity_id);
        keyring::clear_keyring_for_test().await?;
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
    async fn scoped_recovery_rejects_an_unattributed_sentinel_marker() -> Result<(), NookError> {
        identity_record::clear_identity_directory_for_test().await?;
        keyring::clear_keyring_for_test().await?;
        let first_key = AppKey::generate().map_err(identity_record::map_domain_error)?;
        let second_key = AppKey::generate().map_err(identity_record::map_domain_error)?;
        let first_wrapped =
            DeviceIdentityProtection::new(&first_key.secret_string()).with_pin("first-secret")?;
        let second_wrapped =
            DeviceIdentityProtection::new(&second_key.secret_string()).with_pin("second-secret")?;
        identity_record::save_new_protected_local_identity(
            &first_key,
            &first_wrapped,
            None,
            "Personal",
        )
        .await?;
        identity_record::save_new_protected_local_identity(
            &second_key,
            &second_wrapped,
            None,
            "Work",
        )
        .await?;
        indexed_db::idb_put_string(indexed_db::SENTINEL_GENESIS_FINALIZATION_PENDING_KEY, "{}")
            .await?;

        let result = LocalIdentityRecoveryRequest {
            expected_app_id: Some(second_key.app_id().clone()),
        }
        .execute()
        .await;

        assert!(matches!(
            result,
            Err(NookError::Database(message)) if message.contains("Sentinel")
        ));
        assert_eq!(keyring::load_keyring().await?.entries().len(), 2);
        assert_eq!(
            indexed_db::idb_get_string(indexed_db::SENTINEL_GENESIS_FINALIZATION_PENDING_KEY)
                .await?,
            Some("{}".to_owned())
        );
        indexed_db::idb_delete_key(indexed_db::SENTINEL_GENESIS_FINALIZATION_PENDING_KEY).await?;
        keyring::clear_keyring_for_test().await?;
        identity_record::clear_identity_directory_for_test().await
    }
}

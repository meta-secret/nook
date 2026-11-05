use super::{NookVaultManager, wasm_bindgen};
use crate::AuthProviderDatabase;
#[cfg(all(test, target_arch = "wasm32"))]
use crate::ConfiguredVaultApplication;
use crate::ExtensionPairingDatabase;
use crate::ExtensionPairingReconciliation;
use crate::NookDatabase;
#[cfg(all(test, target_arch = "wasm32"))]
use crate::SetLocalVaultLabelRequest;
#[cfg(all(test, target_arch = "wasm32"))]
use crate::VaultSnapshotLookup;
use crate::storage::auth_providers::{
    PresealedProviderMerge, PresealedProviderSnapshotPublication, ProviderSnapshotPublication,
};
use crate::storage::identity_record::StoredIdentityProtection;
#[cfg(all(test, target_arch = "wasm32"))]
use crate::storage::indexed_db::VaultUnlockHistory;
use crate::vault_api_local::has_local_vault;
use crate::{TypedInput, TypedOutput};
use js_sys::Date;
use nook_core::ActiveVaultScope;
use nook_core::CompactToken;
use nook_core::LocalProviderRowChange;
use nook_core::LocalVaultPresence;
use nook_core::ProviderCredentialRejection;
use nook_core::VaultFormatDocument;
use nook_core::VaultSyncComparison;
use nook_core::{
    ActiveProviderLoginSetup, AppId, DevicePublicKey, ProviderSaveOutcome, ProviderSaveSetup,
    VaultSyncAction,
};
use nook_core::{DuplicateCandidatePolicy, DuplicateProviderSelection, LocalProviderRowRequest};
use wasm_bindgen::JsError;

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookProviderSaveOutcomeState {
    Saved,
    Duplicate,
    Incomplete,
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn existing_provider_save_setup()
-> Result<tsify::Ts<nook_core::ProviderSaveSetup>, wasm_bindgen::JsError> {
    let result = { ProviderSaveSetup::Existing };
    Ok(result.encode()?)
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn new_provider_save_setup()
-> Result<tsify::Ts<nook_core::ProviderSaveSetup>, wasm_bindgen::JsError> {
    let result = { ProviderSaveSetup::New };
    Ok(result.encode()?)
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn inactive_provider_login_setup()
-> Result<tsify::Ts<nook_core::ActiveProviderLoginSetup>, wasm_bindgen::JsError> {
    let result = { ActiveProviderLoginSetup::Inactive };
    Ok(result.encode()?)
}

#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn active_provider_login_setup(
    kind: &tsify::Ts<nook_core::ProviderKind>,
) -> Result<tsify::Ts<nook_core::ActiveProviderLoginSetup>, wasm_bindgen::JsError> {
    let kind = kind.decode()?;
    let result = { ActiveProviderLoginSetup::Active(kind) };
    Ok(result.encode()?)
}

#[wasm_bindgen]
pub struct NookProviderSaveOutcome(nook_core::ProviderSaveOutcome);

#[wasm_bindgen]
impl NookProviderSaveOutcome {
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn state(&self) -> NookProviderSaveOutcomeState {
        match self.0 {
            ProviderSaveOutcome::Saved { .. } => NookProviderSaveOutcomeState::Saved,
            ProviderSaveOutcome::Duplicate => NookProviderSaveOutcomeState::Duplicate,
            ProviderSaveOutcome::Incomplete { .. } => NookProviderSaveOutcomeState::Incomplete,
        }
    }

    #[wasm_bindgen(getter)]
    pub fn snapshot(
        &self,
    ) -> Result<tsify::Ts<nook_core::AuthProvidersSnapshot>, wasm_bindgen::JsError> {
        let result = match &self.0 {
            ProviderSaveOutcome::Saved { snapshot, .. } => Ok(snapshot.clone()),
            _ => Err(JsError::new(
                "provider save outcome does not contain a snapshot",
            )),
        }?;
        Ok(result.encode()?)
    }

    /// The draft the setup continues with: the merged row's, or the one saved.
    #[wasm_bindgen(getter)]
    pub fn draft(&self) -> Result<tsify::Ts<nook_core::ProviderDraft>, wasm_bindgen::JsError> {
        let result = match &self.0 {
            ProviderSaveOutcome::Saved { draft, .. } => Ok(draft.as_ref().clone()),
            ProviderSaveOutcome::Duplicate | ProviderSaveOutcome::Incomplete { .. } => Err(
                JsError::new("provider save outcome does not contain a draft"),
            ),
        }?;
        Ok(result.encode()?)
    }

    /// What an incomplete draft still lacks.
    #[wasm_bindgen(getter)]
    pub fn gap(&self) -> Result<tsify::Ts<nook_core::ProviderDraftGap>, wasm_bindgen::JsError> {
        let result = match &self.0 {
            ProviderSaveOutcome::Incomplete { gap } => Ok(*gap),
            ProviderSaveOutcome::Saved { .. } | ProviderSaveOutcome::Duplicate => {
                Err(JsError::new("provider save outcome is not incomplete"))
            }
        }?;
        Ok(result.encode()?)
    }
}

/// Apply the portable provider-save transition. Browser storage and reactive
/// state updates remain in the web adapter.
#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn apply_provider_save_policy(
    request: &tsify::Ts<nook_core::ProviderSaveRequest>,
) -> Result<NookProviderSaveOutcome, wasm_bindgen::JsError> {
    let request = request.decode()?;
    let result = { NookProviderSaveOutcome(request.apply()) };
    Ok(result)
}

/// Project the active provider into a portable credential draft. Browser and
/// reactive state updates remain in the web adapter.
#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn active_provider_credentials_projection(
    request: &tsify::Ts<nook_core::ActiveProviderCredentialsRequest>,
) -> Result<tsify::Ts<nook_core::ProviderDraft>, wasm_bindgen::JsError> {
    let request = request.decode()?;
    let result = { request.project() };
    Ok(result.encode()?)
}

#[wasm_bindgen]
impl NookVaultManager {
    /// Load the persisted sync-provider snapshot from `nook_auth`, including
    /// current-schema normalization and device-key credential unsealing.
    /// Migration bookkeeping stays inside Rust; callers receive only the
    /// snapshot they actually use.
    #[wasm_bindgen]
    pub async fn load_auth_providers_snapshot(
        &self,
    ) -> Result<tsify::Ts<nook_core::AuthProvidersSnapshot>, wasm_bindgen::JsError> {
        let identity = self.device_identity()?;
        let result = AuthProviderDatabase::load_auth_providers(&identity).await?;
        Ok(result.encode()?)
    }

    /// Load providers and ensure this browser's local vault has a provider row.
    /// The read-modify-save lifecycle is one Rust operation rather than a web
    /// DTO round trip.
    #[wasm_bindgen]
    pub async fn load_auth_providers_with_local_row(
        &self,
    ) -> Result<tsify::Ts<nook_core::AuthProvidersSnapshot>, wasm_bindgen::JsError> {
        let identity = self.device_identity()?;
        let snapshot = AuthProviderDatabase::load_auth_providers(&identity).await?;
        match LocalVaultPresence::from(has_local_vault().await?) {
            LocalVaultPresence::Absent => {
                return Ok(snapshot.encode()?);
            }
            LocalVaultPresence::Present => {}
        }
        let new_id = CompactToken::generate()?.to_string();
        let created_at: String = Date::new_0().to_iso_string().into();
        let nook_core::LocalProviderRowOutcome { snapshot, change } =
            snapshot.ensure_local_row(LocalProviderRowRequest {
                active_store_id: &ActiveVaultScope::Unselected,
                new_id: &new_id,
                created_at: &created_at,
            });
        match change {
            LocalProviderRowChange::Inserted => {
                ProviderSnapshotPublication {
                    identity: &identity,
                    snapshot: &snapshot,
                }
                .save()
                .await?;
            }
            LocalProviderRowChange::Present => {}
        }
        let result = snapshot;
        Ok(result.encode()?)
    }

    /// Ensure a caller's current provider snapshot contains this browser's
    /// local-vault row and persist it when Rust adds the row.
    #[wasm_bindgen]
    pub async fn ensure_local_auth_provider_snapshot(
        &self,
        snapshot: &tsify::Ts<nook_core::AuthProvidersSnapshot>,
    ) -> Result<tsify::Ts<nook_core::AuthProvidersSnapshot>, wasm_bindgen::JsError> {
        let snapshot = snapshot.decode()?;

        match LocalVaultPresence::from(has_local_vault().await?) {
            LocalVaultPresence::Absent => {
                return Ok(snapshot.encode()?);
            }
            LocalVaultPresence::Present => {}
        }
        let identity = self.device_identity()?;
        let new_id = CompactToken::generate()?.to_string();
        let created_at: String = Date::new_0().to_iso_string().into();
        let nook_core::LocalProviderRowOutcome { snapshot, change } =
            snapshot.ensure_local_row(LocalProviderRowRequest {
                active_store_id: &ActiveVaultScope::Unselected,
                new_id: &new_id,
                created_at: &created_at,
            });
        match change {
            LocalProviderRowChange::Inserted => {
                ProviderSnapshotPublication {
                    identity: &identity,
                    snapshot: &snapshot,
                }
                .save()
                .await?;
            }
            LocalProviderRowChange::Present => {}
        }
        let result = snapshot;
        Ok(result.encode()?)
    }

    /// Seal credential fields with the device key and persist the snapshot to
    /// the `nook_auth` `IndexedDB` database.
    #[wasm_bindgen]
    pub async fn save_auth_providers_snapshot(
        &self,
        snapshot: &tsify::Ts<nook_core::AuthProvidersSnapshot>,
    ) -> Result<(), wasm_bindgen::JsError> {
        let snapshot = snapshot.decode()?;

        let identity = self.device_identity()?;
        ProviderSnapshotPublication {
            identity: &identity,
            snapshot: &snapshot,
        }
        .save()
        .await?;
        Ok::<_, wasm_bindgen::JsError>(())
    }

    /// Replace the complete sync-provider grant set for the incoming active
    /// vault while preserving grants owned by other paired vaults.
    #[wasm_bindgen]
    pub async fn replace_auth_providers_for_vault(
        &self,
        snapshot: &tsify::Ts<nook_core::AuthProvidersSnapshot>,
    ) -> Result<(), wasm_bindgen::JsError> {
        let snapshot = snapshot.decode()?;

        let identity = self.device_identity()?;
        let existing = AuthProviderDatabase::load_auth_providers(&identity).await?;
        let replaced = existing.replace_active_vault_grants(&snapshot);
        ProviderSnapshotPublication {
            identity: &identity,
            snapshot: &replaced,
        }
        .save()
        .await?;
        Ok::<_, wasm_bindgen::JsError>(())
    }

    /// Persist already-sealed provider credentials without unlocking the device.
    ///
    /// Used by extension pairing when the offscreen session was closed/locked
    /// between pairing approval and grant import.
    #[wasm_bindgen]
    pub async fn save_presealed_auth_providers_snapshot(
        &self,
        app_id: &str,
        snapshot: &tsify::Ts<nook_core::AuthProvidersSnapshot>,
    ) -> Result<(), wasm_bindgen::JsError> {
        let snapshot = snapshot.decode()?;

        let app_id = AppId::parse(app_id)?;
        if matches!(
            NookDatabase::load_entry_for_app_id(&app_id).await?,
            StoredIdentityProtection::Unprotected
        ) {
            return Err(JsError::new(
                "Presealed provider snapshot has no protected local app key",
            ));
        }
        PresealedProviderSnapshotPublication {
            app_id: &app_id,
            snapshot: &snapshot,
            merge: PresealedProviderMerge::VaultGrants,
        }
        .save()
        .await?;
        Ok::<_, wasm_bindgen::JsError>(())
    }
}

/// Seal credential fields in a snapshot for another device's public key without
/// persisting. Used by extension pairing before handing granted provider rows
/// to the extension's own storage.
#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn seal_auth_providers_for_device_public_key(device_public_key: &str,
snapshot: &tsify::Ts<nook_core::AuthProvidersSnapshot>) -> Result<tsify::Ts<nook_core::AuthProvidersSnapshot>, wasm_bindgen::JsError> {
let mut snapshot = snapshot.decode()?;

    let public_key = DevicePublicKey::parse(device_public_key)?;
    snapshot = snapshot
        .seal_credentials_for(&public_key)
        .map_err(ProviderCredentialRejection::into_cause)?;
let result = Ok::<_, wasm_bindgen::JsError>(snapshot)?;
Ok(result.encode()?)
}

/// Delete the `nook_auth` `IndexedDB` database (used on full sign-out / reset).
#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub async fn delete_auth_providers_db() -> Result<(), wasm_bindgen::JsError> {
    AuthProviderDatabase::delete_auth_providers_db().await?;
    Ok(())
}

/// Read all extension pairing metadata from extension-origin Rexie storage.
#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub async fn read_extension_pairing_state()
-> Result<tsify::Ts<nook_companion_core::ExtensionPairingState>, wasm_bindgen::JsError> {
    let result = Ok::<_, wasm_bindgen::JsError>(ExtensionPairingDatabase::read_all().await?)?;
    Ok(result.encode()?)
}

/// Persist extension pairing metadata in extension-origin Rexie storage.
#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub async fn write_extension_pairing_state(
    state: &tsify::Ts<nook_companion_core::ExtensionPairingState>,
) -> Result<(), wasm_bindgen::JsError> {
    let state = state.decode()?;

    ExtensionPairingDatabase::write_all(&state).await?;
    Ok::<_, wasm_bindgen::JsError>(())
}

/// Remove extension pairing metadata from extension-origin Rexie storage.
#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub async fn remove_extension_pairing_state(
    keys: Vec<String>,
) -> Result<(), wasm_bindgen::JsError> {
    ExtensionPairingDatabase::remove(&keys).await?;
    Ok(())
}

/// Atomically remove and persist extension pairing metadata in Rexie storage.
#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub async fn reconcile_extension_pairing_state(
    state: &tsify::Ts<nook_companion_core::ExtensionPairingState>,
    removed_keys: Vec<String>,
) -> Result<(), wasm_bindgen::JsError> {
    let state = state.decode()?;

    ExtensionPairingDatabase::reconcile(ExtensionPairingReconciliation {
        state: &state,
        removed_keys: &removed_keys,
    })
    .await?;
    Ok::<_, wasm_bindgen::JsError>(())
}

/// Find an existing provider whose sync target matches `candidate`.
#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn find_duplicate_sync_provider(
    snapshot: &tsify::Ts<nook_core::AuthProvidersSnapshot>,
    candidate: &tsify::Ts<nook_core::StorageProvider>,
) -> Result<tsify::Ts<nook_core::DuplicateSyncProvider>, wasm_bindgen::JsError> {
    let snapshot = snapshot.decode()?;
    let candidate = candidate.decode()?;

    let result = {
        DuplicateProviderSelection {
            providers: &snapshot.providers,
            candidate: &candidate,
            policy: DuplicateCandidatePolicy::IncludeAll,
        }
        .find()
    };
    Ok(result.encode()?)
}

/// Find a duplicate while editing an existing provider.
#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn find_duplicate_sync_provider_excluding(
    snapshot: &tsify::Ts<nook_core::AuthProvidersSnapshot>,
    candidate: &tsify::Ts<nook_core::StorageProvider>,

    exclude_id: &str,
) -> Result<tsify::Ts<nook_core::DuplicateSyncProvider>, wasm_bindgen::JsError> {
    let snapshot = snapshot.decode()?;
    let candidate = candidate.decode()?;

    let result = {
        DuplicateProviderSelection {
            providers: &snapshot.providers,
            candidate: &candidate,
            policy: DuplicateCandidatePolicy::Exclude(exclude_id.into()),
        }
        .find()
    };
    Ok(result.encode()?)
}

/// Ensure a `local` provider row exists for the active vault, prepending one
/// (with a fresh id/timestamp) when missing. Returns the updated snapshot.
#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn ensure_local_provider_row(
    snapshot: &tsify::Ts<nook_core::AuthProvidersSnapshot>,
    active_store_id: &str,
) -> Result<tsify::Ts<nook_core::AuthProvidersSnapshot>, wasm_bindgen::JsError> {
    let snapshot = snapshot.decode()?;

    let new_id = CompactToken::generate()?.to_string();
    let created_at: String = Date::new_0().to_iso_string().into();
    let nook_core::LocalProviderRowOutcome { snapshot: next, .. } =
        snapshot.ensure_local_row(LocalProviderRowRequest {
            active_store_id: &ActiveVaultScope::StoreId(active_store_id.to_owned()),
            new_id: &new_id,
            created_at: &created_at,
        });
    let result = Ok::<_, wasm_bindgen::JsError>(next)?;
    Ok(result.encode()?)
}

/// Compare local vs remote vault YAML and return a sync action label:
/// `unchanged`, `adopt_remote`, `push_local`, or `conflict`.
#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn compare_vault_sync(local: &str, remote: &str) -> Result<String, wasm_bindgen::JsError> {
    match VaultSyncComparison::new(local, remote).decide() {
        Ok(action) => Ok(match action {
            VaultSyncAction::Unchanged => "unchanged".to_owned(),
            VaultSyncAction::AdoptRemote => "adopt_remote".to_owned(),
            VaultSyncAction::PushLocal => "push_local".to_owned(),
            VaultSyncAction::Conflict => "conflict".to_owned(),
        }),
        Err(e) => Err(JsError::new(&e.to_string())),
    }
}

#[wasm_bindgen]
#[must_use]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(
        raw_numeric_public_api,
        reason = "FFI boundary: projects the parsed vault version to JavaScript as a bigint"
    )
)]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn read_vault_version(yaml: &str) -> u64 {
    VaultFormatDocument::new(yaml)
        .version()
        .map_or(0, Into::into)
}

#[wasm_bindgen]
impl NookVaultManager {
    /// Persist one provider draft using Rust-owned reconciliation and identity sealing.
    pub async fn persist_auth_providers_snapshot(
        &self,
        request: &tsify::Ts<nook_core::AuthProviderPersistenceRequest>,
    ) -> Result<tsify::Ts<nook_core::AuthProvidersSnapshot>, wasm_bindgen::JsError> {
        let request = request.decode()?;

        use nook_core::AuthProviderPersistenceMode;
        let identity = self.device_identity()?;
        let snapshot = match request.mode {
            AuthProviderPersistenceMode::Replace => request.snapshot,
            AuthProviderPersistenceMode::PreserveUnlistedSyncProviders => {
                if has_local_vault().await? {
                    let stored = AuthProviderDatabase::load_auth_providers(&identity).await?;
                    request.snapshot.preserve_unlisted_sync_providers(&stored)
                } else {
                    request.snapshot
                }
            }
        };
        ProviderSnapshotPublication {
            identity: &identity,
            snapshot: &snapshot,
        }
        .save()
        .await?;
        let result = Ok::<_, wasm_bindgen::JsError>(snapshot)?;
        Ok(result.encode()?)
    }
}

#[cfg(test)]
#[allow(unused_imports)]
mod projection_tests {
    use super::*;
    use crate::NookVaultSyncResult;
    use crate::types::NookVaultSyncAccessState;
    use crate::vault_api_local::*;
    use nook_core::ActiveProviderLoginSetup;
    use nook_core::ActiveVaultScope;
    #[cfg(test)]
    #[cfg(test)]
    use nook_core::AuthProvidersSnapshot;
    #[cfg(test)]
    #[cfg(test)]
    use nook_core::DeviceIdentity;
    #[cfg(test)]
    #[cfg(test)]
    use nook_core::DuplicateSyncProvider;
    #[cfg(test)]
    #[cfg(test)]
    use nook_core::IsoTimestamp;
    use nook_core::ProviderSaveOutcome;
    use nook_core::ProviderSaveSetup;
    #[cfg(test)]
    #[cfg(test)]
    use nook_core::StorageProvider;
    #[cfg(test)]
    #[cfg(test)]
    use nook_core::VaultAccessStatus;
    #[cfg(test)]
    #[cfg(test)]
    use nook_core::VaultApplication;
    #[cfg(test)]
    #[cfg(test)]
    use nook_core::VaultRecordSet;
    #[cfg(test)]
    #[cfg(test)]
    use nook_core::VaultStoreIdentityRef;
    #[cfg(test)]
    #[cfg(test)]
    use nook_core::VaultUnlock;
    #[cfg(test)]
    #[cfg(test)]
    use nook_core::VaultVersionWrite;
    #[cfg(test)]
    use nook_core::{
        GithubProvider, ProviderDraft, ProviderDraftGap, ProviderKind, ProviderSecretText,
        ProviderVaultScope, StoredGithubRepository, StoredProvider,
    };
    use tsify::Tsify;
    use wasm_bindgen::JsError;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[cfg(target_arch = "wasm32")]
    #[wasm_bindgen_test]
    fn vault_policy_helpers_project_intents_and_reject_invalid_content() -> Result<(), JsError> {
        assert!(vault_connect_intent_permits_empty_remote_genesis(
            "create-new"
        )?);
        assert!(vault_connect_intent_permits_empty_remote_genesis(
            "add-sync-provider"
        )?);
        assert!(!vault_connect_intent_permits_empty_remote_genesis(
            "open-existing"
        )?);
        assert!(vault_connect_intent_permits_empty_remote_genesis("unknown").is_err());

        assert_eq!(read_vault_version("not yaml"), 0);
        assert!(validate_vault_content_for_application("not yaml").is_err());
        assert!(validate_extension_pairing_vault_type("unknown").is_err());
        assert!(compare_vault_sync("not yaml", "also not yaml").is_err());
        assert_eq!(configured_vault_application_name(), "unified-development");
        assert!(!configured_vault_application_is_simple());
        assert!(!configured_vault_application_is_sentinel());
        assert!(configured_vault_application_supports_extension());
        Ok(())
    }

    #[cfg(target_arch = "wasm32")]
    #[wasm_bindgen_test]
    fn vault_sync_result_wrappers_project_empty_and_assessed_states() {
        let unchanged = NookVaultSyncResult::unchanged();
        assert!(!unchanged.changed());
        assert_eq!(
            unchanged.access_state(),
            NookVaultSyncAccessState::NotAssessed
        );
        assert!(unchanged.access_status().is_err());
        assert!(unchanged.secrets().is_empty());
        assert!(unchanged.pending_joins().is_empty());
        assert!(unchanged.vault_members().is_empty());

        let assessed = NookVaultSyncResult::with_access_status(VaultAccessStatus::Ready);
        assert!(assessed.changed());
        assert_eq!(assessed.access_state(), NookVaultSyncAccessState::Assessed);
        assert!(assessed.access_status().is_ok());
    }

    #[cfg(target_arch = "wasm32")]
    #[wasm_bindgen_test]
    fn provider_setup_and_outcome_wrappers_project_all_states() -> Result<(), JsError> {
        assert_eq!(
            existing_provider_save_setup()?.to_rust()?,
            ProviderSaveSetup::Existing
        );
        assert_eq!(
            new_provider_save_setup()?.to_rust()?,
            ProviderSaveSetup::New
        );
        assert_eq!(
            inactive_provider_login_setup()?.to_rust()?,
            ActiveProviderLoginSetup::Inactive
        );
        assert_eq!(
            active_provider_login_setup(&Tsify::into_ts(&ProviderKind::S3)?)?.to_rust()?,
            ActiveProviderLoginSetup::Active(ProviderKind::S3)
        );

        let duplicate = NookProviderSaveOutcome(ProviderSaveOutcome::Duplicate);
        assert_eq!(duplicate.state(), NookProviderSaveOutcomeState::Duplicate);
        assert!(duplicate.snapshot().is_err());
        assert!(duplicate.draft().is_err());
        assert!(duplicate.gap().is_err());

        let incomplete = NookProviderSaveOutcome(ProviderSaveOutcome::Incomplete {
            gap: ProviderDraftGap::LocalFolder,
        });
        assert_eq!(incomplete.state(), NookProviderSaveOutcomeState::Incomplete);
        assert!(incomplete.snapshot().is_err());
        assert_eq!(incomplete.gap()?.to_rust()?, ProviderDraftGap::LocalFolder);

        let saved_snapshot = AuthProvidersSnapshot::default();
        let saved = NookProviderSaveOutcome(ProviderSaveOutcome::Saved {
            snapshot: saved_snapshot.clone(),
            draft: Box::new(ProviderDraft::Local {}),
        });
        assert_eq!(saved.state(), NookProviderSaveOutcomeState::Saved);
        assert_eq!(saved.snapshot()?.to_rust()?, saved_snapshot);
        assert_eq!(saved.draft()?.to_rust()?, ProviderDraft::Local {});
        Ok(())
    }

    #[cfg(target_arch = "wasm32")]
    #[wasm_bindgen_test]
    fn duplicate_provider_and_local_vault_wrappers_project_empty_and_present_states()
    -> Result<(), JsError> {
        let provider = StorageProvider::never_synced(
            "provider-1".to_owned(),
            ProviderVaultScope::Unscoped,
            "2026-01-01T00:00:00Z".to_owned(),
            StoredProvider::Github(GithubProvider {
                repository: StoredGithubRepository::Repository("repo".to_owned()),
                token: ProviderSecretText::try_from("pat".to_owned())?,
            }),
        );
        let snapshot = nook_core::AuthProvidersSnapshot {
            providers: vec![provider.clone()],
            ..Default::default()
        };

        let duplicate = find_duplicate_sync_provider(&snapshot.into_ts()?, &provider.into_ts()?)?;
        // DuplicateSyncProvider deliberately exposes a Serialize-only outcome.
        assert_eq!(
            serde_wasm_bindgen::from_value::<serde_json::Value>(duplicate.js_value())?,
            serde_json::to_value(DuplicateSyncProvider::Duplicate {
                provider: Box::new(provider.clone())
            })?,
        );
        let unique = find_duplicate_sync_provider_excluding(
            &snapshot.into_ts()?,
            &provider.into_ts()?,
            "provider-1",
        )?;
        assert_eq!(
            serde_wasm_bindgen::from_value::<serde_json::Value>(unique.js_value())?,
            serde_json::to_value(DuplicateSyncProvider::Unique)?,
        );

        let empty = NookActiveVaultSelection(ActiveVaultScope::Unselected);
        assert_eq!(empty.state(), NookActiveVaultSelectionState::NotSelected);
        assert!(empty.store_id().is_err());
        let selected = NookActiveVaultSelection(ActiveVaultScope::StoreId("store-1".into()));
        assert_eq!(selected.state(), NookActiveVaultSelectionState::Selected);
        assert_eq!(selected.store_id()?, "store-1");

        let never = NookLocalVaultEntry {
            store_id: "store-1".into(),
            label: "  ".into(),
            last_unlocked_at: VaultUnlockHistory::NeverUnlocked,
        };
        assert_eq!(never.store_id(), "store-1");
        assert_eq!(never.label(), "  ");
        assert_eq!(never.display_label("Fallback"), "Fallback");
        assert_eq!(
            never.unlock_state(),
            NookLocalVaultUnlockState::NeverUnlocked
        );
        assert!(never.last_unlocked_at().is_err());

        let unlocked = NookLocalVaultEntry {
            store_id: "store-2".into(),
            label: " Vault ".into(),
            last_unlocked_at: VaultUnlockHistory::Unlocked(IsoTimestamp::from_trusted(
                "2026-01-01T00:00:00Z".into(),
            )),
        };
        assert_eq!(unlocked.display_label("Fallback"), "Vault");
        assert_eq!(unlocked.unlock_state(), NookLocalVaultUnlockState::Unlocked);
        assert_eq!(unlocked.last_unlocked_at()?, "2026-01-01T00:00:00Z");
        Ok(())
    }

    #[cfg(target_arch = "wasm32")]
    #[wasm_bindgen_test]
    fn vault_projection_helpers_cover_sync_actions_and_invalid_inputs() -> Result<(), JsError> {
        assert_eq!(simple_vault_app_url(""), "https://simple.nokey.sh/");
        assert_eq!(
            simple_vault_app_url(" https://example.test/// "),
            "https://example.test/"
        );
        assert!(vault_connect_intent_permits_empty_remote_genesis(
            "create-new"
        )?);
        assert!(!vault_connect_intent_permits_empty_remote_genesis(
            "open-existing"
        )?);
        assert!(vault_connect_intent_permits_empty_remote_genesis("bad").is_err());
        assert_eq!(read_vault_version("not yaml"), 0);
        assert!(compare_vault_sync("not yaml", "also not yaml").is_err());
        assert!(
            seal_auth_providers_for_device_public_key(
                "not a public key",
                &Tsify::into_ts(&(AuthProvidersSnapshot::default()))?
            )
            .is_err()
        );
        assert!(validate_vault_content_for_application("not yaml").is_err());
        assert!(validate_extension_pairing_vault_type("not-a-vault").is_err());

        assert_eq!(configured_vault_application_name(), "unified-development");
        assert_eq!(
            ConfiguredVaultApplication::configured_vault_application(),
            VaultApplication::UnifiedDevelopment
        );
        assert!(!configured_vault_application_is_simple());
        assert!(!configured_vault_application_is_sentinel());
        assert!(configured_vault_application_supports_extension());
        Ok(())
    }

    #[cfg(target_arch = "wasm32")]
    #[wasm_bindgen_test]
    fn provider_and_version_helpers_cover_valid_inputs() -> Result<(), JsError> {
        let identity = DeviceIdentity::generate()?;
        let snapshot = AuthProvidersSnapshot::default();
        let sealed = seal_auth_providers_for_device_public_key(
            identity.public_key().as_str(),
            &Tsify::into_ts(&(snapshot.clone()))?,
        )?
        .to_rust()?;
        assert_eq!(sealed, snapshot);

        let with_local =
            ensure_local_provider_row(&Tsify::into_ts(&(snapshot))?, "store_valid_fixture")?
                .to_rust()?;
        assert_eq!(
            with_local
                .providers
                .iter()
                .map(StorageProvider::kind)
                .collect::<Vec<_>>(),
            vec![ProviderKind::Local]
        );

        let yaml = VaultRecordSet::serialize_yaml_with_store(&[], VaultStoreIdentityRef::Unassigned, VaultVersionWrite::Version(1.into()))?;
        assert_eq!(read_vault_version(yaml.as_str()), 1);
        Ok(())
    }

    #[cfg(target_arch = "wasm32")]
    #[wasm_bindgen_test]
    async fn async_storage_adapters_fail_closed_without_a_local_identity() -> Result<(), JsError> {
        let manager = NookVaultManager::new();
        let empty_snapshot = AuthProvidersSnapshot::default();

        assert!(manager.load_auth_providers_snapshot().await.is_err());
        assert!(manager.load_auth_providers_with_local_row().await.is_err());
        assert!(
            manager
                .save_auth_providers_snapshot(&empty_snapshot.into_ts()?)
                .await
                .is_err()
        );
        assert!(
            manager
                .replace_auth_providers_for_vault(&empty_snapshot.into_ts()?)
                .await
                .is_err()
        );
        assert!(
            manager
                .save_presealed_auth_providers_snapshot("not-an-app-id", &empty_snapshot.into_ts()?)
                .await
                .is_err()
        );
        Ok(())
    }

    #[cfg(target_arch = "wasm32")]
    #[wasm_bindgen_test]
    async fn local_vault_lifecycle_wrappers_project_browser_storage() -> Result<(), JsError> {
        let mut manager = NookVaultManager::new();
        manager.delete_local_browser_data().await?;

        let identity = DeviceIdentity::generate()?;
        manager.set_test_device_identity(&identity);
        manager
            .connect_fresh(&tsify::Tsify::into_ts(
                &nook_core::StorageConnection::Local,
            )?)
            .await?;
        let store_id = manager.vault_store_id();
        let content = match NookDatabase::load_vault_blob(&store_id)
            .await
            .map_err(|error| JsError::new(&error.to_string()))?
        {
            VaultSnapshotLookup::Stored(content) => content,
            VaultSnapshotLookup::NotStored => {
                return Err(JsError::new("connected local vault blob was not persisted").into());
            }
        };
        assert!(!store_id.is_empty());
        assert!(!content.is_empty());

        assert!(has_local_vault().await?);
        assert!(has_active_local_vault().await?);
        let selected = get_active_vault_selection().await?;
        assert_eq!(selected.state(), NookActiveVaultSelectionState::Selected);
        assert_eq!(selected.store_id()?, store_id);

        let entries = list_local_vaults().await?;
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].store_id(), store_id);
        assert_eq!(
            entries[0].unlock_state(),
            NookLocalVaultUnlockState::Unlocked
        );

        NookDatabase::set_local_vault_label(SetLocalVaultLabelRequest {
            store_id: &store_id,
            label: "  Browser vault  ",
        })
        .await?;
        let renamed = list_local_vaults().await?;
        assert_eq!(renamed[0].label(), "Browser vault");
        assert_eq!(renamed[0].display_label("Fallback"), "Browser vault");

        NookDatabase::prepare_new_local_vault_slot().await?;
        let imported = import_named_local_vault_blob(content, "Imported vault".to_owned()).await?;
        assert_eq!(imported, store_id);
        set_active_vault(imported.clone()).await?;
        let selected_again = get_active_vault_selection().await?;
        assert_eq!(selected_again.store_id()?, imported);

        manager.delete_local_browser_data().await?;
        assert!(!has_local_vault().await?);
        assert!(!has_active_local_vault().await?);
        assert_eq!(list_local_vaults().await?.len(), 0);
        assert_eq!(
            get_active_vault_selection().await?.state(),
            NookActiveVaultSelectionState::NotSelected
        );
        Ok(())
    }
}

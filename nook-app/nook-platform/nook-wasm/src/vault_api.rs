use super::{NookSecretRecord, NookVaultManager, wasm_bindgen};
use crate::AuthProviderDatabase;
use crate::ConfiguredVaultApplication;
use crate::ExtensionPairingDatabase;
use crate::ExtensionPairingReconciliation;
use crate::VaultSnapshotLookup;
use crate::storage::auth_providers::{
    PresealedProviderSnapshotPublication, ProviderSnapshotPublication,
};
use crate::storage::{auth_providers, extension_state, identity_record};
use crate::vault_api_local::has_local_vault;
use crate::{NookDatabase, SetLocalVaultLabelRequest};
use js_sys::Date;
use nook_core::ActiveVaultScope;
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
    LocalFolderRequired,
}

#[wasm_bindgen]
#[must_use]
pub fn existing_provider_save_setup() -> nook_core::ProviderSaveSetup {
    ProviderSaveSetup::Existing
}

#[wasm_bindgen]
#[must_use]
pub fn new_provider_save_setup(
    provider_type: nook_core::StorageProviderType,
) -> nook_core::ProviderSaveSetup {
    ProviderSaveSetup::New(provider_type)
}

#[wasm_bindgen]
#[must_use]
pub fn inactive_provider_login_setup() -> nook_core::ActiveProviderLoginSetup {
    ActiveProviderLoginSetup::Inactive
}

#[wasm_bindgen]
#[must_use]
pub fn active_provider_login_setup(
    provider_type: nook_core::StorageProviderType,
) -> nook_core::ActiveProviderLoginSetup {
    ActiveProviderLoginSetup::Active(provider_type)
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
            ProviderSaveOutcome::LocalFolderRequired => {
                NookProviderSaveOutcomeState::LocalFolderRequired
            }
        }
    }

    #[wasm_bindgen(getter)]
    pub fn snapshot(&self) -> Result<nook_core::AuthProvidersSnapshotData, wasm_bindgen::JsError> {
        match &self.0 {
            ProviderSaveOutcome::Saved { snapshot, .. } => Ok(snapshot.clone()),
            _ => Err(JsError::new(
                "provider save outcome does not contain a snapshot",
            )),
        }
    }

    #[wasm_bindgen(getter, js_name = oauthFile)]
    pub fn oauth_file(
        &self,
    ) -> Result<nook_core::StoredOAuthFileConfiguration, wasm_bindgen::JsError> {
        match &self.0 {
            ProviderSaveOutcome::Saved { oauth_file, .. } => Ok((**oauth_file).clone()),
            _ => Err(JsError::new(
                "provider save outcome does not contain an OAuth configuration",
            )),
        }
    }
}

/// Apply the portable provider-save transition. Browser storage and reactive
/// state updates remain in the web adapter.
#[wasm_bindgen]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
pub fn apply_provider_save_policy(
    request: nook_core::ProviderSaveRequest,
) -> NookProviderSaveOutcome {
    NookProviderSaveOutcome(request.apply())
}

/// Project the active provider into a portable credential draft. Browser and
/// reactive state updates remain in the web adapter.
#[wasm_bindgen]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
pub fn active_provider_credentials_projection(
    request: nook_core::ActiveProviderCredentialsRequest,
) -> nook_core::ActiveProviderCredentialsProjection {
    request.project()
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
    ) -> Result<nook_core::AuthProvidersSnapshotData, wasm_bindgen::JsError> {
        let identity = self.device_identity()?;
        let loaded = AuthProviderDatabase::load_auth_providers(&identity).await?;
        Ok(loaded.snapshot)
    }

    /// Load providers and ensure this browser's local vault has a provider row.
    /// The read-modify-save lifecycle is one Rust operation rather than a web
    /// DTO round trip.
    #[wasm_bindgen]
    pub async fn load_auth_providers_with_local_row(
        &self,
    ) -> Result<nook_core::AuthProvidersSnapshotData, wasm_bindgen::JsError> {
        let identity = self.device_identity()?;
        let loaded = AuthProviderDatabase::load_auth_providers(&identity).await?;
        let snapshot = loaded.snapshot;
        if !has_local_vault().await? {
            return Ok(snapshot);
        }
        let new_id = nook_core::CompactToken::generate()?.to_string();
        let created_at: String = Date::new_0().to_iso_string().into();
        let nook_core::LocalProviderRowOutcome { snapshot, change } =
            snapshot.ensure_local_row(LocalProviderRowRequest {
                active_store_id: &nook_core::ActiveVaultScope::Unselected,
                new_id: &new_id,
                created_at: &created_at,
            });
        if change == nook_core::LocalProviderRowChange::Inserted {
            ProviderSnapshotPublication {
                identity: &identity,
                snapshot: &snapshot,
            }
            .save()
            .await?;
        }
        Ok(snapshot)
    }

    /// Ensure a caller's current provider snapshot contains this browser's
    /// local-vault row and persist it when Rust adds the row.
    #[wasm_bindgen]
    pub async fn ensure_local_auth_provider_snapshot(
        &self,
        snapshot: nook_core::AuthProvidersSnapshotData,
    ) -> Result<nook_core::AuthProvidersSnapshotData, wasm_bindgen::JsError> {
        if !has_local_vault().await? {
            return Ok(snapshot);
        }
        let identity = self.device_identity()?;
        let new_id = nook_core::CompactToken::generate()?.to_string();
        let created_at: String = Date::new_0().to_iso_string().into();
        let nook_core::LocalProviderRowOutcome { snapshot, change } =
            snapshot.ensure_local_row(LocalProviderRowRequest {
                active_store_id: &nook_core::ActiveVaultScope::Unselected,
                new_id: &new_id,
                created_at: &created_at,
            });
        if change == nook_core::LocalProviderRowChange::Inserted {
            ProviderSnapshotPublication {
                identity: &identity,
                snapshot: &snapshot,
            }
            .save()
            .await?;
        }
        Ok(snapshot)
    }

    /// Seal credential fields with the device key and persist the snapshot to
    /// the `nook_auth` `IndexedDB` database.
    #[wasm_bindgen]
    pub async fn save_auth_providers_snapshot(
        &self,
        snapshot: nook_core::AuthProvidersSnapshotData,
    ) -> Result<(), wasm_bindgen::JsError> {
        let identity = self.device_identity()?;
        ProviderSnapshotPublication {
            identity: &identity,
            snapshot: &snapshot,
        }
        .save()
        .await?;
        Ok(())
    }

    /// Replace the complete sync-provider grant set for the incoming active
    /// vault while preserving grants owned by other paired vaults.
    #[wasm_bindgen]
    pub async fn replace_auth_providers_for_vault(
        &self,
        snapshot: nook_core::AuthProvidersSnapshotData,
    ) -> Result<(), wasm_bindgen::JsError> {
        let identity = self.device_identity()?;
        let existing = AuthProviderDatabase::load_auth_providers(&identity)
            .await?
            .snapshot;
        let replaced = existing.replace_active_vault_grants(&snapshot);
        ProviderSnapshotPublication {
            identity: &identity,
            snapshot: &replaced,
        }
        .save()
        .await?;
        Ok(())
    }

    /// Persist already-sealed provider credentials without unlocking the device.
    ///
    /// Used by extension pairing when the offscreen session was closed/locked
    /// between identity handoff and grant import.
    #[wasm_bindgen]
    pub async fn save_presealed_auth_providers_snapshot(
        &self,
        app_id: &str,
        snapshot: nook_core::AuthProvidersSnapshotData,
    ) -> Result<(), wasm_bindgen::JsError> {
        let app_id = AppId::parse(app_id)?;
        if NookDatabase::load_entry_for_app_id(&app_id)
            .await?
            .is_none()
        {
            return Err(JsError::new(
                "Presealed provider snapshot has no protected local app key",
            ));
        }
        PresealedProviderSnapshotPublication {
            app_id: &app_id,
            snapshot: &snapshot,
        }
        .save()
        .await?;
        Ok(())
    }
}

/// Seal credential fields in a snapshot for another device's public key without
/// persisting. Used by extension pairing before handing granted provider rows
/// to the extension's own storage.
#[wasm_bindgen]
pub fn seal_auth_providers_for_device_public_key(
    device_public_key: &str,
    mut snapshot: nook_core::AuthProvidersSnapshotData,
) -> Result<nook_core::AuthProvidersSnapshotData, wasm_bindgen::JsError> {
    let public_key = DevicePublicKey::parse(device_public_key)?;
    snapshot = snapshot
        .seal_credentials_for(&public_key)
        .map_err(|rejection| rejection.into_cause())?;
    Ok(snapshot)
}

/// Delete the `nook_auth` `IndexedDB` database (used on full sign-out / reset).
#[wasm_bindgen]
pub async fn delete_auth_providers_db() -> Result<(), wasm_bindgen::JsError> {
    AuthProviderDatabase::delete_auth_providers_db().await?;
    Ok(())
}

/// Read all extension pairing metadata from extension-origin Rexie storage.
#[wasm_bindgen]
pub async fn read_extension_pairing_state()
-> Result<nook_companion_core::ExtensionPairingState, wasm_bindgen::JsError> {
    Ok(ExtensionPairingDatabase::read_all().await?)
}

/// Persist extension pairing metadata in extension-origin Rexie storage.
#[wasm_bindgen]
pub async fn write_extension_pairing_state(
    state: nook_companion_core::ExtensionPairingState,
) -> Result<(), wasm_bindgen::JsError> {
    ExtensionPairingDatabase::write_all(&state).await?;
    Ok(())
}

/// Remove extension pairing metadata from extension-origin Rexie storage.
#[wasm_bindgen]
pub async fn remove_extension_pairing_state(
    keys: Vec<String>,
) -> Result<(), wasm_bindgen::JsError> {
    ExtensionPairingDatabase::remove(&keys).await?;
    Ok(())
}

/// Atomically remove and persist extension pairing metadata in Rexie storage.
#[wasm_bindgen]
pub async fn reconcile_extension_pairing_state(
    state: nook_companion_core::ExtensionPairingState,
    removed_keys: Vec<String>,
) -> Result<(), wasm_bindgen::JsError> {
    ExtensionPairingDatabase::reconcile(ExtensionPairingReconciliation {
        state: &state,
        removed_keys: &removed_keys,
    })
    .await?;
    Ok(())
}

/// Find an existing provider whose sync target matches `candidate`.
#[wasm_bindgen]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
pub fn find_duplicate_sync_provider(
    snapshot: nook_core::AuthProvidersSnapshotData,
    candidate: nook_core::StorageProviderData,
) -> nook_core::DuplicateSyncProvider {
    DuplicateProviderSelection {
        providers: &snapshot.providers,
        candidate: &candidate,
        policy: DuplicateCandidatePolicy::IncludeAll,
    }
    .find()
}

/// Find a duplicate while editing an existing provider.
#[wasm_bindgen]
#[must_use]
#[allow(clippy::needless_pass_by_value)]
pub fn find_duplicate_sync_provider_excluding(
    snapshot: nook_core::AuthProvidersSnapshotData,
    candidate: nook_core::StorageProviderData,
    exclude_id: &str,
) -> nook_core::DuplicateSyncProvider {
    DuplicateProviderSelection {
        providers: &snapshot.providers,
        candidate: &candidate,
        policy: DuplicateCandidatePolicy::Exclude(exclude_id.into()),
    }
    .find()
}

/// Ensure a `local` provider row exists for the active vault, prepending one
/// (with a fresh id/timestamp) when missing. Returns the updated snapshot.
#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
pub fn ensure_local_provider_row(
    snapshot: nook_core::AuthProvidersSnapshotData,
    active_store_id: &str,
) -> Result<nook_core::AuthProvidersSnapshotData, wasm_bindgen::JsError> {
    let new_id = nook_core::CompactToken::generate()?.to_string();
    let created_at: String = Date::new_0().to_iso_string().into();
    let nook_core::LocalProviderRowOutcome { snapshot: next, .. } =
        snapshot.ensure_local_row(LocalProviderRowRequest {
            active_store_id: &nook_core::ActiveVaultScope::StoreId(active_store_id.to_owned()),
            new_id: &new_id,
            created_at: &created_at,
        });
    Ok(next)
}

/// Approve an extension join through a manager whose Rust-owned application
/// capability permits extension approval.
#[wasm_bindgen]
pub async fn approve_extension_device(
    manager: &mut NookVaultManager,
    join_device_id: String,
    join_public_key: String,
    join_signing_public_key: String,
    label: String,
) -> Result<Vec<NookSecretRecord>, wasm_bindgen::JsError> {
    manager
        .approve_extension_device(
            join_device_id,
            join_public_key,
            join_signing_public_key,
            label,
        )
        .await
}

/// Compare local vs remote vault YAML and return a sync action label:
/// `unchanged`, `adopt_remote`, `push_local`, or `conflict`.
#[wasm_bindgen]
pub fn compare_vault_sync(local: &str, remote: &str) -> Result<String, wasm_bindgen::JsError> {
    match nook_core::VaultSyncComparison::new(local, remote).decide() {
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
pub fn read_vault_version(yaml: &str) -> u64 {
    nook_core::VaultFormatDocument::new(yaml)
        .version()
        .map_or(0, Into::into)
}

#[cfg(test)]
#[allow(unused_imports)]
mod projection_tests {
    use super::*;
    use crate::NookVaultSyncResult;
    use crate::types::NookVaultSyncAccessState;
    use crate::vault_api_local::*;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[cfg(target_arch = "wasm32")]
    #[wasm_bindgen_test]
    fn vault_policy_helpers_project_intents_and_reject_invalid_content() {
        assert!(vault_connect_intent_permits_empty_remote_genesis("create-new").unwrap());
        assert!(vault_connect_intent_permits_empty_remote_genesis("add-sync-provider").unwrap());
        assert!(!vault_connect_intent_permits_empty_remote_genesis("open-existing").unwrap());
        assert!(vault_connect_intent_permits_empty_remote_genesis("unknown").is_err());

        assert_eq!(read_vault_version("not yaml"), 0);
        assert!(validate_vault_content_for_application("not yaml").is_err());
        assert!(validate_extension_pairing_vault_type("unknown").is_err());
        assert!(compare_vault_sync("not yaml", "also not yaml").is_err());
        assert_eq!(configured_vault_application_name(), "unified-development");
        assert!(!configured_vault_application_is_simple());
        assert!(!configured_vault_application_is_sentinel());
        assert!(configured_vault_application_supports_extension());
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

        let assessed = NookVaultSyncResult::with_access_status(nook_core::VaultAccessStatus::Ready);
        assert!(assessed.changed());
        assert_eq!(assessed.access_state(), NookVaultSyncAccessState::Assessed);
        assert!(assessed.access_status().is_ok());
    }

    #[cfg(target_arch = "wasm32")]
    #[wasm_bindgen_test]
    fn provider_setup_and_outcome_wrappers_project_all_states() {
        assert_eq!(
            existing_provider_save_setup(),
            nook_core::ProviderSaveSetup::Existing
        );
        assert_eq!(
            new_provider_save_setup(nook_core::StorageProviderType::Github),
            nook_core::ProviderSaveSetup::New(nook_core::StorageProviderType::Github)
        );
        assert_eq!(
            inactive_provider_login_setup(),
            nook_core::ActiveProviderLoginSetup::Inactive
        );
        assert_eq!(
            active_provider_login_setup(nook_core::StorageProviderType::OauthFile),
            nook_core::ActiveProviderLoginSetup::Active(nook_core::StorageProviderType::OauthFile)
        );

        let duplicate = NookProviderSaveOutcome(nook_core::ProviderSaveOutcome::Duplicate);
        assert_eq!(duplicate.state(), NookProviderSaveOutcomeState::Duplicate);
        assert!(duplicate.snapshot().is_err());
        assert!(duplicate.oauth_file().is_err());

        let local_required =
            NookProviderSaveOutcome(nook_core::ProviderSaveOutcome::LocalFolderRequired);
        assert_eq!(
            local_required.state(),
            NookProviderSaveOutcomeState::LocalFolderRequired
        );
        assert!(local_required.snapshot().is_err());
        assert!(local_required.oauth_file().is_err());

        let saved_snapshot = nook_core::AuthProvidersSnapshotData::default();
        let saved_oauth = nook_core::StoredOAuthFileConfiguration::NotApplicable;
        let saved = NookProviderSaveOutcome(nook_core::ProviderSaveOutcome::Saved {
            snapshot: saved_snapshot.clone(),
            oauth_file: Box::new(saved_oauth.clone()),
        });
        assert_eq!(saved.state(), NookProviderSaveOutcomeState::Saved);
        assert_eq!(saved.snapshot().unwrap(), saved_snapshot);
        assert_eq!(saved.oauth_file().unwrap(), saved_oauth);
    }

    #[cfg(target_arch = "wasm32")]
    #[wasm_bindgen_test]
    fn duplicate_provider_and_local_vault_wrappers_project_empty_and_present_states() {
        let provider = nook_core::StorageProviderData::github(
            "provider-1",
            "GitHub",
            "pat",
            "owner/repo",
            "2026-01-01T00:00:00Z",
        );
        let snapshot = nook_core::AuthProvidersSnapshotData {
            providers: vec![provider.clone()],
            ..Default::default()
        };

        let duplicate = find_duplicate_sync_provider(snapshot.clone(), provider.clone());
        assert!(
            matches!(duplicate, nook_core::DuplicateSyncProvider::Duplicate { provider } if provider.id == "provider-1")
        );

        let unique =
            find_duplicate_sync_provider_excluding(snapshot, provider.clone(), "provider-1");
        assert_eq!(unique, nook_core::DuplicateSyncProvider::Unique);

        let empty = NookActiveVaultSelection(ActiveVaultScope::Unselected);
        assert_eq!(empty.state(), NookActiveVaultSelectionState::NotSelected);
        assert!(empty.store_id().is_err());
        let selected = NookActiveVaultSelection(ActiveVaultScope::StoreId("store-1".into()));
        assert_eq!(selected.state(), NookActiveVaultSelectionState::Selected);
        assert_eq!(selected.store_id().unwrap(), "store-1");

        let never = NookLocalVaultEntry {
            store_id: "store-1".into(),
            label: "  ".into(),
            last_unlocked_at: None,
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
            last_unlocked_at: Some(nook_core::IsoTimestamp::from_trusted(
                "2026-01-01T00:00:00Z".into(),
            )),
        };
        assert_eq!(unlocked.display_label("Fallback"), "Vault");
        assert_eq!(unlocked.unlock_state(), NookLocalVaultUnlockState::Unlocked);
        assert_eq!(unlocked.last_unlocked_at().unwrap(), "2026-01-01T00:00:00Z");
    }

    #[cfg(target_arch = "wasm32")]
    #[wasm_bindgen_test]
    fn vault_projection_helpers_cover_sync_actions_and_invalid_inputs() {
        assert_eq!(simple_vault_app_url(""), "https://simple.nokey.sh/");
        assert_eq!(
            simple_vault_app_url(" https://example.test/// "),
            "https://example.test/"
        );
        assert!(vault_connect_intent_permits_empty_remote_genesis("create-new").unwrap());
        assert!(!vault_connect_intent_permits_empty_remote_genesis("open-existing").unwrap());
        assert!(vault_connect_intent_permits_empty_remote_genesis("bad").is_err());
        assert_eq!(read_vault_version("not yaml"), 0);
        assert!(compare_vault_sync("not yaml", "also not yaml").is_err());
        assert!(
            seal_auth_providers_for_device_public_key(
                "not a public key",
                nook_core::AuthProvidersSnapshotData::default()
            )
            .is_err()
        );
        assert!(validate_vault_content_for_application("not yaml").is_err());
        assert!(validate_extension_pairing_vault_type("not-a-vault").is_err());

        assert_eq!(configured_vault_application_name(), "unified-development");
        assert_eq!(
            ConfiguredVaultApplication::configured_vault_application(),
            nook_core::VaultApplication::UnifiedDevelopment
        );
        assert!(!configured_vault_application_is_simple());
        assert!(!configured_vault_application_is_sentinel());
        assert!(configured_vault_application_supports_extension());
    }

    #[cfg(target_arch = "wasm32")]
    #[wasm_bindgen_test]
    fn provider_and_version_helpers_cover_valid_inputs() -> Result<(), JsError> {
        let identity = nook_core::DeviceIdentity::generate()?;
        let snapshot = nook_core::AuthProvidersSnapshotData::default();
        let sealed = seal_auth_providers_for_device_public_key(
            identity.public_key().as_str(),
            snapshot.clone(),
        )?;
        assert_eq!(sealed, snapshot);

        let with_local = ensure_local_provider_row(snapshot, "store_valid_fixture")?;
        assert_eq!(with_local.providers.len(), 1);
        assert_eq!(
            with_local.providers[0].provider_type,
            nook_core::StorageProviderType::Local
        );

        let yaml = nook_core::VaultRecordSet::serialize_yaml_with_unlock(
            &[],
            &nook_core::VaultUnlock::Keys,
            &[],
            nook_core::VaultStoreIdentityRef::Unassigned,
            nook_core::VaultVersionWrite::Version(1.into()),
        )?;
        assert_eq!(read_vault_version(yaml.as_str()), 1);
        Ok(())
    }

    #[cfg(target_arch = "wasm32")]
    #[wasm_bindgen_test]
    async fn async_storage_adapters_fail_closed_without_a_local_identity() -> Result<(), JsError> {
        let manager = NookVaultManager::new();
        let empty_snapshot = nook_core::AuthProvidersSnapshotData::default();

        assert!(manager.load_auth_providers_snapshot().await.is_err());
        assert!(manager.load_auth_providers_with_local_row().await.is_err());
        assert!(
            manager
                .save_auth_providers_snapshot(empty_snapshot.clone())
                .await
                .is_err()
        );
        assert!(
            manager
                .replace_auth_providers_for_vault(empty_snapshot.clone())
                .await
                .is_err()
        );
        assert!(
            manager
                .save_presealed_auth_providers_snapshot("not-an-app-id", empty_snapshot.clone())
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

        let identity = nook_core::DeviceIdentity::generate()?;
        manager.set_test_device_identity(&identity);
        manager
            .connect_fresh("local".to_owned(), String::new(), String::new())
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
            store_id: store_id.clone(),
            label: "  Browser vault  ".to_owned(),
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

#[wasm_bindgen]
impl NookVaultManager {
    /// Persist one provider draft using Rust-owned reconciliation and identity sealing.
    pub async fn persist_auth_providers_snapshot(
        &self,
        request: nook_core::AuthProviderPersistenceRequest,
    ) -> Result<nook_core::AuthProvidersSnapshotData, JsError> {
        use nook_core::AuthProviderPersistenceMode;
        let identity = self.device_identity()?;
        let snapshot = match request.mode {
            AuthProviderPersistenceMode::Replace => request.snapshot,
            AuthProviderPersistenceMode::PreserveUnlistedSyncProviders => {
                if has_local_vault().await? {
                    let stored = AuthProviderDatabase::load_auth_providers(&identity).await?;
                    request
                        .snapshot
                        .preserve_unlisted_sync_providers(&stored.snapshot)
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
        Ok(snapshot)
    }
}

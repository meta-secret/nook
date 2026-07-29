use super::{NookError, NookSecretRecord, NookVaultManager, application, wasm_bindgen};

#[wasm_bindgen]
impl NookVaultManager {
    /// Load the persisted sync-provider snapshot from `nook_auth`, including
    /// current-schema normalization and device-key credential unsealing.
    /// Migration bookkeeping stays inside Rust; callers receive only the
    /// snapshot they actually use.
    #[wasm_bindgen(js_name = loadAuthProviders)]
    pub async fn load_auth_providers_snapshot(
        &self,
    ) -> Result<nook_core::AuthProvidersSnapshotData, wasm_bindgen::JsError> {
        let identity = self.device_identity()?;
        let loaded = crate::storage::auth_providers::load_auth_providers(&identity).await?;
        Ok(loaded.snapshot)
    }

    /// Load providers and ensure this browser's local vault has a provider row.
    /// The read-modify-save lifecycle is one Rust operation rather than a web
    /// DTO round trip.
    #[wasm_bindgen(js_name = loadAuthProvidersWithLocalRow)]
    pub async fn load_auth_providers_with_local_row(
        &self,
    ) -> Result<nook_core::AuthProvidersSnapshotData, wasm_bindgen::JsError> {
        let identity = self.device_identity()?;
        let loaded = crate::storage::auth_providers::load_auth_providers(&identity).await?;
        let snapshot = loaded.snapshot;
        if !has_local_vault().await? {
            return Ok(snapshot);
        }
        let new_id = nook_core::generate_id()?.to_string();
        let created_at: String = js_sys::Date::new_0().to_iso_string().into();
        let (snapshot, changed) =
            nook_core::ensure_local_provider_row(&snapshot, None, &new_id, &created_at);
        if changed {
            crate::storage::auth_providers::save_auth_providers(&identity, &snapshot).await?;
        }
        Ok(snapshot)
    }

    /// Ensure a caller's current provider snapshot contains this browser's
    /// local-vault row and persist it when Rust adds the row.
    #[wasm_bindgen(js_name = ensureLocalAuthProviderSnapshot)]
    pub async fn ensure_local_auth_provider_snapshot(
        &self,
        snapshot: nook_core::AuthProvidersSnapshotData,
    ) -> Result<nook_core::AuthProvidersSnapshotData, wasm_bindgen::JsError> {
        if !has_local_vault().await? {
            return Ok(snapshot);
        }
        let identity = self.device_identity()?;
        let new_id = nook_core::generate_id()?.to_string();
        let created_at: String = js_sys::Date::new_0().to_iso_string().into();
        let (snapshot, changed) =
            nook_core::ensure_local_provider_row(&snapshot, None, &new_id, &created_at);
        if changed {
            crate::storage::auth_providers::save_auth_providers(&identity, &snapshot).await?;
        }
        Ok(snapshot)
    }

    /// Seal credential fields with the device key and persist the snapshot to
    /// the `nook_auth` `IndexedDB` database.
    #[wasm_bindgen(js_name = saveAuthProviders)]
    pub async fn save_auth_providers_snapshot(
        &self,
        snapshot: nook_core::AuthProvidersSnapshotData,
    ) -> Result<(), wasm_bindgen::JsError> {
        let identity = self.device_identity()?;
        crate::storage::auth_providers::save_auth_providers(&identity, &snapshot).await?;
        Ok(())
    }

    /// Replace the complete sync-provider grant set for the incoming active
    /// vault while preserving grants owned by other paired vaults.
    #[wasm_bindgen(js_name = replaceAuthProvidersForVault)]
    pub async fn replace_auth_providers_for_vault(
        &self,
        snapshot: nook_core::AuthProvidersSnapshotData,
    ) -> Result<(), wasm_bindgen::JsError> {
        let identity = self.device_identity()?;
        let existing = crate::storage::auth_providers::load_auth_providers(&identity)
            .await?
            .snapshot;
        let replaced = nook_core::replace_active_vault_provider_grants(&existing, &snapshot);
        crate::storage::auth_providers::save_auth_providers(&identity, &replaced).await?;
        Ok(())
    }

    /// Persist already-sealed provider credentials without unlocking the device.
    ///
    /// Used by extension pairing when the offscreen session was closed/locked
    /// between identity handoff and grant import.
    #[wasm_bindgen(js_name = savePresealedAuthProviders)]
    pub async fn save_presealed_auth_providers_snapshot(
        &self,
        snapshot: nook_core::AuthProvidersSnapshotData,
    ) -> Result<(), wasm_bindgen::JsError> {
        crate::storage::auth_providers::save_presealed_auth_providers(&snapshot).await?;
        Ok(())
    }
}

/// Seal credential fields in a snapshot for another device's public key without
/// persisting. Used by extension pairing before handing granted provider rows
/// to the extension's own storage.
#[wasm_bindgen(js_name = sealAuthProvidersForDevicePublicKey)]
pub fn seal_auth_providers_for_device_public_key(
    device_public_key: &str,
    mut snapshot: nook_core::AuthProvidersSnapshotData,
) -> Result<nook_core::AuthProvidersSnapshotData, wasm_bindgen::JsError> {
    let public_key = nook_core::DevicePublicKey::parse(device_public_key)?;
    nook_core::seal_provider_credentials_for_public_key(&public_key, &mut snapshot)?;
    Ok(snapshot)
}

/// Delete the `nook_auth` `IndexedDB` database (used on full sign-out / reset).
#[wasm_bindgen(js_name = deleteAuthProvidersDb)]
pub async fn delete_auth_providers_db() -> Result<(), wasm_bindgen::JsError> {
    crate::storage::auth_providers::delete_auth_providers_db().await?;
    Ok(())
}

/// Read all extension pairing metadata from extension-origin Rexie storage.
#[wasm_bindgen]
pub struct NookExtensionPairingState(
    std::collections::HashMap<String, crate::storage::extension_state::ExtensionPairingRecord>,
);

#[wasm_bindgen]
impl NookExtensionPairingState {
    #[wasm_bindgen(js_name = fromObject)]
    pub fn from_object(entries: &js_sys::Object) -> Result<Self, wasm_bindgen::JsError> {
        serde_wasm_bindgen::from_value(entries.clone().into())
            .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
            .and_then(|entries| {
                crate::storage::extension_state::validate_entries(&entries)?;
                Ok(Self(entries))
            })
    }

    #[wasm_bindgen(js_name = toObject)]
    pub fn to_object(&self) -> Result<js_sys::Object, wasm_bindgen::JsError> {
        serde::Serialize::serialize(
            &self.0,
            &serde_wasm_bindgen::Serializer::new().serialize_maps_as_objects(true),
        )
        .map(wasm_bindgen::JsCast::unchecked_into)
        .map_err(|error| wasm_bindgen::JsError::new(&error.to_string()))
    }
}

impl NookExtensionPairingState {
    fn entries(
        &self,
    ) -> &std::collections::HashMap<String, crate::storage::extension_state::ExtensionPairingRecord>
    {
        &self.0
    }
}

/// Read all extension pairing metadata from extension-origin Rexie storage.
#[wasm_bindgen(js_name = readExtensionPairingState)]
pub async fn read_extension_pairing_state()
-> Result<NookExtensionPairingState, wasm_bindgen::JsError> {
    let entries = crate::storage::extension_state::read_all().await?;
    Ok(NookExtensionPairingState(entries))
}

/// Persist extension pairing metadata in extension-origin Rexie storage.
#[wasm_bindgen(js_name = writeExtensionPairingState)]
pub async fn write_extension_pairing_state(
    state: &NookExtensionPairingState,
) -> Result<(), wasm_bindgen::JsError> {
    crate::storage::extension_state::write_all(state.entries()).await?;
    Ok(())
}

/// Remove extension pairing metadata from extension-origin Rexie storage.
#[wasm_bindgen(js_name = removeExtensionPairingState)]
pub async fn remove_extension_pairing_state(
    keys: Vec<String>,
) -> Result<(), wasm_bindgen::JsError> {
    crate::storage::extension_state::remove(&keys).await?;
    Ok(())
}

/// Atomically remove and persist extension pairing metadata in Rexie storage.
#[wasm_bindgen(js_name = reconcileExtensionPairingState)]
pub async fn reconcile_extension_pairing_state(
    state: &NookExtensionPairingState,
    removed_keys: Vec<String>,
) -> Result<(), wasm_bindgen::JsError> {
    crate::storage::extension_state::reconcile(state.entries(), &removed_keys).await?;
    Ok(())
}

/// Find an existing provider whose sync target matches `candidate`, optionally
/// excluding one provider id. Returns the matching provider or `undefined`.
#[wasm_bindgen(js_name = findDuplicateSyncProvider)]
#[allow(clippy::needless_pass_by_value)]
pub fn find_duplicate_sync_provider(
    snapshot: nook_core::AuthProvidersSnapshotData,
    candidate: nook_core::StorageProviderData,
    exclude_id: Option<String>,
) -> Result<Option<nook_core::StorageProviderData>, wasm_bindgen::JsError> {
    Ok(nook_core::find_duplicate_sync_provider(
        &snapshot.providers,
        &candidate,
        exclude_id.as_deref(),
    ))
}

/// Ensure a `local` provider row exists for the active vault, prepending one
/// (with a fresh id/timestamp) when missing. Returns the updated snapshot.
#[wasm_bindgen(js_name = ensureLocalProviderRow)]
#[allow(clippy::needless_pass_by_value)]
pub fn ensure_local_provider_row(
    snapshot: nook_core::AuthProvidersSnapshotData,
    active_store_id: Option<String>,
) -> Result<nook_core::AuthProvidersSnapshotData, wasm_bindgen::JsError> {
    let new_id = nook_core::generate_id()?.to_string();
    let created_at: String = js_sys::Date::new_0().to_iso_string().into();
    let (next, _changed) = nook_core::ensure_local_provider_row(
        &snapshot,
        active_store_id.as_deref(),
        &new_id,
        &created_at,
    );
    Ok(next)
}

fn validate_configured_application_for_content(content: &str) -> Result<(), NookError> {
    let architecture = nook_core::read_vault_architecture(content)?;
    application::configured_vault_application().validate_session_access(architecture.vault_type)?;
    Ok(())
}

/// Configure the immutable application capability for this browser realm.
#[wasm_bindgen(js_name = configureVaultApplication)]
pub fn configure_vault_application(application: nook_core::VaultApplication) {
    application::configure_vault_application(application);
}

/// Return the immutable capability configured by the current web app.
#[wasm_bindgen(js_name = configuredVaultApplication)]
pub fn configured_vault_application() -> nook_core::VaultApplication {
    application::configured_vault_application()
}

/// Return the stable semantic application name used by browser debug hooks.
#[wasm_bindgen(js_name = configuredVaultApplicationName)]
pub fn configured_vault_application_name() -> String {
    application::configured_vault_application()
        .as_str()
        .to_owned()
}

/// Return the Rust-owned empty-provider policy for a first-connect intent.
#[wasm_bindgen(js_name = vaultConnectIntentPermitsEmptyRemoteGenesis)]
pub fn vault_connect_intent_permits_empty_remote_genesis(
    intent_name: &str,
) -> Result<bool, wasm_bindgen::JsError> {
    let intent = nook_core::VaultConnectIntent::parse(intent_name)
        .map_err(|error| wasm_bindgen::JsError::new(&error))?;
    Ok(intent.permits_empty_remote_genesis())
}

/// Fail before persistence/session creation when encrypted vault content does
/// not belong to this artifact's compile-time application capability.
#[wasm_bindgen(js_name = validateVaultContentForApplication)]
pub fn validate_vault_content_for_application(content: &str) -> Result<(), wasm_bindgen::JsError> {
    validate_configured_application_for_content(content).map_err(Into::into)
}

/// Approve an extension join through a manager whose Rust-owned application
/// capability permits extension approval.
#[wasm_bindgen(js_name = approveExtensionDevice)]
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

/// Validate extension pairing metadata through the Rust capability matrix.
#[wasm_bindgen(js_name = validateExtensionPairingVaultType)]
pub fn validate_extension_pairing_vault_type(
    vault_type: &str,
) -> Result<(), wasm_bindgen::JsError> {
    let vault_type = nook_core::VaultType::parse(vault_type)?;
    let application = application::configured_vault_application();
    if application == nook_core::VaultApplication::Extension {
        application.validate_session_access(vault_type)?;
    } else {
        application.validate_extension_approval(vault_type)?;
    }
    Ok(())
}

async fn local_vault_matches_compiled_application(store_id: &str) -> Result<bool, NookError> {
    let Some(content) = crate::storage::indexed_db::load_vault_blob(store_id).await? else {
        return Ok(false);
    };
    let architecture = nook_core::read_vault_architecture(&content)?;
    Ok(application::configured_vault_application().permits_vault_type(architecture.vault_type))
}

#[wasm_bindgen(js_name = hasLocalVault)]
pub async fn has_local_vault() -> Result<bool, wasm_bindgen::JsError> {
    for entry in crate::storage::indexed_db::list_vault_registry_entries().await? {
        if local_vault_matches_compiled_application(&entry.store_id).await? {
            return Ok(true);
        }
    }
    Ok(false)
}

#[wasm_bindgen(js_name = hasActiveLocalVault)]
pub async fn has_active_local_vault() -> Result<bool, wasm_bindgen::JsError> {
    let Some(store_id) = crate::storage::indexed_db::get_active_vault_id().await? else {
        return Ok(false);
    };
    Ok(local_vault_matches_compiled_application(&store_id).await?)
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookLocalVaultEntry {
    store_id: String,
    label: String,
    last_unlocked_at: Option<nook_core::IsoTimestamp>,
}

#[wasm_bindgen]
impl NookLocalVaultEntry {
    #[wasm_bindgen(getter, js_name = storeId)]
    pub fn store_id(&self) -> String {
        self.store_id.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn label(&self) -> String {
        self.label.clone()
    }

    #[wasm_bindgen(js_name = displayLabel)]
    pub fn display_label(&self, fallback_label: &str) -> String {
        let label = self.label.trim();
        if label.is_empty() {
            fallback_label.to_owned()
        } else {
            label.to_owned()
        }
    }

    #[wasm_bindgen(getter, js_name = lastUnlockedAt)]
    pub fn last_unlocked_at(&self) -> Option<String> {
        self.last_unlocked_at
            .as_ref()
            .map(nook_core::IsoTimestamp::to_string)
    }
}

#[wasm_bindgen(js_name = listLocalVaults)]
pub async fn list_local_vaults() -> Result<Vec<NookLocalVaultEntry>, wasm_bindgen::JsError> {
    let mut matching = Vec::new();
    for entry in crate::storage::indexed_db::list_vault_registry_entries().await? {
        if local_vault_matches_compiled_application(&entry.store_id).await? {
            matching.push(NookLocalVaultEntry {
                store_id: entry.store_id,
                label: entry.label,
                last_unlocked_at: entry.last_unlocked_at,
            });
        }
    }
    Ok(matching)
}

#[wasm_bindgen(js_name = getActiveVaultId)]
pub async fn get_active_vault_id() -> Result<Option<String>, wasm_bindgen::JsError> {
    let Some(store_id) = crate::storage::indexed_db::get_active_vault_id().await? else {
        return Ok(None);
    };
    if local_vault_matches_compiled_application(&store_id).await? {
        Ok(Some(store_id))
    } else {
        Ok(None)
    }
}

#[wasm_bindgen(js_name = setActiveVault)]
pub async fn set_active_vault(store_id: String) -> Result<(), wasm_bindgen::JsError> {
    let content = crate::storage::indexed_db::load_vault_blob(&store_id)
        .await?
        .ok_or_else(|| NookError::Database("Local vault was not found.".to_owned()))?;
    validate_configured_application_for_content(&content)?;
    crate::storage::indexed_db::switch_active_vault(&store_id)
        .await
        .map_err(Into::into)
}

#[wasm_bindgen(js_name = setLocalVaultLabel)]
pub async fn set_local_vault_label(
    store_id: String,
    label: String,
) -> Result<(), wasm_bindgen::JsError> {
    crate::storage::indexed_db::set_local_vault_label(&store_id, &label)
        .await
        .map_err(Into::into)
}

#[wasm_bindgen(js_name = prepareNewLocalVaultSlot)]
pub async fn prepare_new_local_vault_slot() -> Result<(), wasm_bindgen::JsError> {
    crate::storage::indexed_db::prepare_new_local_vault_slot()
        .await
        .map_err(Into::into)
}

#[wasm_bindgen(js_name = importLocalVaultBlob)]
pub async fn import_local_vault_blob(
    content: String,
    label: Option<String>,
) -> Result<String, wasm_bindgen::JsError> {
    validate_configured_application_for_content(&content)?;
    crate::storage::indexed_db::import_vault_blob(&content, label.as_deref())
        .await
        .map_err(Into::into)
}

/// Compare local vs remote vault YAML and return a sync action label:
/// `unchanged`, `adopt_remote`, `push_local`, or `conflict`.
#[wasm_bindgen(js_name = compareVaultSync)]
pub fn compare_vault_sync(local: &str, remote: &str) -> Result<String, wasm_bindgen::JsError> {
    match nook_core::compare_vault_sync(local, remote) {
        Ok(action) => Ok(match action {
            nook_core::VaultSyncAction::Unchanged => "unchanged".to_owned(),
            nook_core::VaultSyncAction::AdoptRemote => "adopt_remote".to_owned(),
            nook_core::VaultSyncAction::PushLocal => "push_local".to_owned(),
            nook_core::VaultSyncAction::Conflict => "conflict".to_owned(),
        }),
        Err(e) => Err(wasm_bindgen::JsError::new(&e.to_string())),
    }
}

#[wasm_bindgen(js_name = readVaultVersion)]
#[must_use]
pub fn read_vault_version(yaml: &str) -> u64 {
    nook_core::read_vault_version(yaml).unwrap_or(0)
}

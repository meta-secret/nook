use super::{NookPendingSyncConflict, NookProviderSyncRevision, wasm_bindgen};

const MAX_SAFE_JAVASCRIPT_INTEGER: f64 = 9_007_199_254_740_991.0;

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookVaultLastSyncState {
    NeverSynced,
    Synced,
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookVaultLastSync(nook_core::VaultLastSync);

#[wasm_bindgen]
impl NookVaultLastSync {
    #[wasm_bindgen(js_name = neverSynced)]
    pub fn never_synced() -> Self {
        Self(nook_core::VaultLastSync::NeverSynced)
    }

    #[wasm_bindgen(js_name = synced)]
    pub fn synced(at_unix_milliseconds: f64) -> Result<Self, wasm_bindgen::JsError> {
        let at_unix_milliseconds = valid_javascript_milliseconds(at_unix_milliseconds)
            .map_err(wasm_bindgen::JsError::new)?;
        Ok(Self(nook_core::VaultLastSync::Synced {
            at_unix_milliseconds,
        }))
    }

    #[wasm_bindgen(getter)]
    pub fn state(&self) -> NookVaultLastSyncState {
        match &self.0 {
            nook_core::VaultLastSync::NeverSynced => NookVaultLastSyncState::NeverSynced,
            nook_core::VaultLastSync::Synced { .. } => NookVaultLastSyncState::Synced,
        }
    }

    #[wasm_bindgen(getter, js_name = syncedAtUnixMilliseconds)]
    #[allow(clippy::cast_precision_loss)]
    pub fn synced_at_unix_milliseconds(&self) -> Result<f64, wasm_bindgen::JsError> {
        match &self.0 {
            nook_core::VaultLastSync::Synced {
                at_unix_milliseconds,
            } => Ok(*at_unix_milliseconds as f64),
            nook_core::VaultLastSync::NeverSynced => Err(wasm_bindgen::JsError::new(
                "vault has not completed a synchronization",
            )),
        }
    }
}

#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
fn valid_javascript_milliseconds(value: f64) -> Result<u64, &'static str> {
    if !value.is_finite()
        || value < 0.0
        || value.fract() != 0.0
        || value > MAX_SAFE_JAVASCRIPT_INTEGER
    {
        return Err("sync timestamp must be a non-negative safe integer");
    }
    Ok(value as u64)
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookManualProviderSyncState {
    Idle,
    Running,
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookManualProviderSync(nook_core::ManualProviderSync);

#[wasm_bindgen]
impl NookManualProviderSync {
    #[wasm_bindgen(js_name = idle)]
    pub fn idle() -> Self {
        Self(nook_core::ManualProviderSync::Idle)
    }

    #[wasm_bindgen(js_name = running)]
    pub fn running(provider_id: String) -> Self {
        Self(nook_core::ManualProviderSync::Running { provider_id })
    }

    #[wasm_bindgen(getter)]
    pub fn state(&self) -> NookManualProviderSyncState {
        match &self.0 {
            nook_core::ManualProviderSync::Idle => NookManualProviderSyncState::Idle,
            nook_core::ManualProviderSync::Running { .. } => NookManualProviderSyncState::Running,
        }
    }

    #[wasm_bindgen(getter, js_name = providerId)]
    pub fn provider_id(&self) -> Result<String, wasm_bindgen::JsError> {
        match &self.0 {
            nook_core::ManualProviderSync::Running { provider_id } => Ok(provider_id.clone()),
            nook_core::ManualProviderSync::Idle => {
                Err(wasm_bindgen::JsError::new("manual provider sync is idle"))
            }
        }
    }
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookSyncConflictReviewState {
    Clear,
    RequiresDecision,
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookSyncConflictReview(nook_core::SyncConflictReview<NookPendingSyncConflict>);

#[wasm_bindgen]
impl NookSyncConflictReview {
    #[wasm_bindgen(js_name = clear)]
    pub fn clear() -> Self {
        Self(nook_core::SyncConflictReview::Clear)
    }

    #[wasm_bindgen(js_name = requiresDecision)]
    pub fn requires_decision(conflict: NookPendingSyncConflict) -> Self {
        Self(nook_core::SyncConflictReview::RequiresDecision(conflict))
    }

    #[wasm_bindgen(getter)]
    pub fn state(&self) -> NookSyncConflictReviewState {
        match &self.0 {
            nook_core::SyncConflictReview::Clear => NookSyncConflictReviewState::Clear,
            nook_core::SyncConflictReview::RequiresDecision(_) => {
                NookSyncConflictReviewState::RequiresDecision
            }
        }
    }

    #[wasm_bindgen(getter, js_name = providerId)]
    pub fn provider_id(&self) -> Result<String, wasm_bindgen::JsError> {
        Ok(self.conflict()?.provider_id())
    }

    #[wasm_bindgen(getter, js_name = isPendingProvider)]
    pub fn is_pending_provider(&self) -> Result<bool, wasm_bindgen::JsError> {
        Ok(self.conflict()?.is_pending_provider())
    }

    #[wasm_bindgen(getter, js_name = providerLabel)]
    pub fn provider_label(&self) -> Result<String, wasm_bindgen::JsError> {
        Ok(self.conflict()?.provider_label())
    }

    #[wasm_bindgen(getter, js_name = localYaml)]
    pub fn local_yaml(&self) -> Result<String, wasm_bindgen::JsError> {
        Ok(self.conflict()?.local_yaml())
    }

    #[wasm_bindgen(getter, js_name = remoteYaml)]
    pub fn remote_yaml(&self) -> Result<String, wasm_bindgen::JsError> {
        Ok(self.conflict()?.remote_yaml())
    }

    #[wasm_bindgen(getter)]
    pub fn mode(&self) -> Result<String, wasm_bindgen::JsError> {
        Ok(self.conflict()?.mode())
    }

    #[wasm_bindgen(getter)]
    pub fn pat(&self) -> Result<String, wasm_bindgen::JsError> {
        Ok(self.conflict()?.pat())
    }

    #[wasm_bindgen(getter)]
    pub fn repo(&self) -> Result<String, wasm_bindgen::JsError> {
        Ok(self.conflict()?.repo())
    }

    #[wasm_bindgen(getter, js_name = remoteRevision)]
    pub fn remote_revision(&self) -> Result<NookProviderSyncRevision, wasm_bindgen::JsError> {
        Ok(self.conflict()?.remote_revision())
    }

    #[wasm_bindgen(getter, js_name = conflictKind)]
    pub fn conflict_kind(&self) -> Result<nook_core::VaultSyncConflictKind, wasm_bindgen::JsError> {
        Ok(self.conflict()?.kind())
    }

    #[wasm_bindgen(js_name = contentLocalVersion)]
    pub fn content_local_version(&self) -> Result<u32, wasm_bindgen::JsError> {
        self.conflict()?.content_local_version()
    }

    #[wasm_bindgen(js_name = contentRemoteVersion)]
    pub fn content_remote_version(&self) -> Result<u32, wasm_bindgen::JsError> {
        self.conflict()?.content_remote_version()
    }

    #[wasm_bindgen(js_name = localStoreId)]
    pub fn local_store_id(&self) -> Result<String, wasm_bindgen::JsError> {
        self.conflict()?.local_store_id()
    }

    #[wasm_bindgen(js_name = remoteStoreId)]
    pub fn remote_store_id(&self) -> Result<String, wasm_bindgen::JsError> {
        self.conflict()?.remote_store_id()
    }
}

impl NookSyncConflictReview {
    fn conflict(&self) -> Result<&NookPendingSyncConflict, wasm_bindgen::JsError> {
        match &self.0 {
            nook_core::SyncConflictReview::RequiresDecision(conflict) => Ok(conflict),
            nook_core::SyncConflictReview::Clear => Err(wasm_bindgen::JsError::new(
                "sync conflict review does not contain a conflict",
            )),
        }
    }
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookLocalFolderHealthState {
    Healthy,
    MultipleVaults,
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookLocalFolderHealth(nook_core::LocalFolderHealth);

#[wasm_bindgen]
impl NookLocalFolderHealth {
    #[wasm_bindgen(js_name = healthy)]
    pub fn healthy() -> Self {
        Self(nook_core::LocalFolderHealth::Healthy)
    }

    #[wasm_bindgen(js_name = multipleVaults)]
    pub fn multiple_vaults(
        provider_id: String,
        provider_label: String,
        store_ids: Vec<String>,
        message: String,
    ) -> Self {
        Self(nook_core::LocalFolderHealth::MultipleVaults(
            nook_core::LocalFolderMultipleVaultsIssue {
                provider_id,
                provider_label,
                store_ids,
                message,
            },
        ))
    }

    #[wasm_bindgen(getter)]
    pub fn state(&self) -> NookLocalFolderHealthState {
        match &self.0 {
            nook_core::LocalFolderHealth::Healthy => NookLocalFolderHealthState::Healthy,
            nook_core::LocalFolderHealth::MultipleVaults(_) => {
                NookLocalFolderHealthState::MultipleVaults
            }
        }
    }

    #[wasm_bindgen(getter, js_name = providerId)]
    pub fn provider_id(&self) -> Result<String, wasm_bindgen::JsError> {
        Ok(self.issue()?.provider_id.clone())
    }

    #[wasm_bindgen(getter, js_name = providerLabel)]
    pub fn provider_label(&self) -> Result<String, wasm_bindgen::JsError> {
        Ok(self.issue()?.provider_label.clone())
    }

    #[wasm_bindgen(getter, js_name = storeIds)]
    pub fn store_ids(&self) -> Result<Vec<String>, wasm_bindgen::JsError> {
        Ok(self.issue()?.store_ids.clone())
    }

    #[wasm_bindgen(getter)]
    pub fn message(&self) -> Result<String, wasm_bindgen::JsError> {
        Ok(self.issue()?.message.clone())
    }
}

impl NookLocalFolderHealth {
    fn issue(&self) -> Result<&nook_core::LocalFolderMultipleVaultsIssue, wasm_bindgen::JsError> {
        match &self.0 {
            nook_core::LocalFolderHealth::MultipleVaults(issue) => Ok(issue),
            nook_core::LocalFolderHealth::Healthy => Err(wasm_bindgen::JsError::new(
                "local folder does not contain multiple vaults",
            )),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn javascript_timestamp_validation_rejects_lossy_values() {
        assert_eq!(valid_javascript_milliseconds(42.0), Ok(42));
        assert!(valid_javascript_milliseconds(-1.0).is_err());
        assert!(valid_javascript_milliseconds(1.5).is_err());
        assert!(valid_javascript_milliseconds(f64::NAN).is_err());
        assert!(valid_javascript_milliseconds(MAX_SAFE_JAVASCRIPT_INTEGER + 1.0).is_err());
    }

    #[test]
    fn wasm_states_expose_portable_variant_kinds() {
        assert_eq!(
            NookVaultLastSync::never_synced().state(),
            NookVaultLastSyncState::NeverSynced
        );
        assert_eq!(
            NookManualProviderSync::running("provider-1".to_owned()).state(),
            NookManualProviderSyncState::Running
        );
        assert_eq!(
            NookSyncConflictReview::clear().state(),
            NookSyncConflictReviewState::Clear
        );
        assert_eq!(
            NookLocalFolderHealth::healthy().state(),
            NookLocalFolderHealthState::Healthy
        );
    }
}

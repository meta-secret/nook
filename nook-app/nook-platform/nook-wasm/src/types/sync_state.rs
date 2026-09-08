use super::{NookPendingSyncConflict, NookProviderSyncRevision, wasm_bindgen};
use nook_core::{LocalFolderHealth, ManualProviderSync, SyncConflictReview, VaultLastSync};
use wasm_bindgen::JsError;

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
    #[wasm_bindgen]
    pub fn never_synced() -> Self {
        Self(VaultLastSync::NeverSynced)
    }

    #[wasm_bindgen]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the `synced` timestamp or duration through a JavaScript Number scalar"
        )
    )]
    pub fn synced(at_unix_milliseconds: f64) -> Result<Self, wasm_bindgen::JsError> {
        let at_unix_milliseconds =
            valid_javascript_milliseconds(at_unix_milliseconds).map_err(JsError::new)?;
        Ok(Self(VaultLastSync::Synced {
            at_unix_milliseconds: at_unix_milliseconds.into(),
        }))
    }

    #[wasm_bindgen(getter)]
    pub fn state(&self) -> NookVaultLastSyncState {
        match &self.0 {
            VaultLastSync::NeverSynced => NookVaultLastSyncState::NeverSynced,
            VaultLastSync::Synced { .. } => NookVaultLastSyncState::Synced,
        }
    }

    #[wasm_bindgen(getter, js_name = syncedAtUnixMilliseconds)]
    #[allow(clippy::cast_precision_loss)]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the `synced_at_unix_milliseconds` timestamp or duration through a JavaScript Number scalar"
        )
    )]
    pub fn synced_at_unix_milliseconds(&self) -> Result<f64, wasm_bindgen::JsError> {
        match &self.0 {
            VaultLastSync::Synced {
                at_unix_milliseconds,
            } => Ok(u64::from(*at_unix_milliseconds) as f64),
            VaultLastSync::NeverSynced => {
                Err(JsError::new("vault has not completed a synchronization"))
            }
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
    #[wasm_bindgen]
    pub fn idle() -> Self {
        Self(ManualProviderSync::Idle)
    }

    #[wasm_bindgen]
    pub fn running(provider_id: String) -> Self {
        Self(ManualProviderSync::Running { provider_id })
    }

    #[wasm_bindgen(getter)]
    pub fn state(&self) -> NookManualProviderSyncState {
        match &self.0 {
            ManualProviderSync::Idle => NookManualProviderSyncState::Idle,
            ManualProviderSync::Running { .. } => NookManualProviderSyncState::Running,
        }
    }

    #[wasm_bindgen(getter, js_name = providerId)]
    pub fn provider_id(&self) -> Result<String, wasm_bindgen::JsError> {
        match &self.0 {
            ManualProviderSync::Running { provider_id } => Ok(provider_id.clone()),
            ManualProviderSync::Idle => Err(JsError::new("manual provider sync is idle")),
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
    #[wasm_bindgen]
    pub fn clear() -> Self {
        Self(SyncConflictReview::Clear)
    }

    #[wasm_bindgen]
    pub fn requires_decision(conflict: NookPendingSyncConflict) -> Self {
        Self(SyncConflictReview::RequiresDecision(conflict))
    }

    #[wasm_bindgen(getter)]
    pub fn state(&self) -> NookSyncConflictReviewState {
        match &self.0 {
            SyncConflictReview::Clear => NookSyncConflictReviewState::Clear,
            SyncConflictReview::RequiresDecision(_) => {
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

    #[wasm_bindgen]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the `content_local_version` version or epoch through a JavaScript Number scalar"
        )
    )]
    pub fn content_local_version(&self) -> Result<u32, wasm_bindgen::JsError> {
        self.conflict()?.content_local_version()
    }

    #[wasm_bindgen]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the `content_remote_version` version or epoch through a JavaScript Number scalar"
        )
    )]
    pub fn content_remote_version(&self) -> Result<u32, wasm_bindgen::JsError> {
        self.conflict()?.content_remote_version()
    }

    #[wasm_bindgen]
    pub fn local_store_id(&self) -> Result<String, wasm_bindgen::JsError> {
        self.conflict()?.local_store_id()
    }

    #[wasm_bindgen]
    pub fn remote_store_id(&self) -> Result<String, wasm_bindgen::JsError> {
        self.conflict()?.remote_store_id()
    }
}

impl NookSyncConflictReview {
    fn conflict(&self) -> Result<&NookPendingSyncConflict, wasm_bindgen::JsError> {
        match &self.0 {
            SyncConflictReview::RequiresDecision(conflict) => Ok(conflict),
            SyncConflictReview::Clear => Err(JsError::new(
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
    #[wasm_bindgen]
    pub fn healthy() -> Self {
        Self(LocalFolderHealth::Healthy)
    }

    #[wasm_bindgen]
    pub fn multiple_vaults(
        provider_id: String,
        provider_label: String,
        store_ids: Vec<String>,
        message: String,
    ) -> Self {
        Self(LocalFolderHealth::MultipleVaults(
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
            LocalFolderHealth::Healthy => NookLocalFolderHealthState::Healthy,
            LocalFolderHealth::MultipleVaults(_) => NookLocalFolderHealthState::MultipleVaults,
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
            LocalFolderHealth::MultipleVaults(issue) => Ok(issue),
            LocalFolderHealth::Healthy => Err(JsError::new(
                "local folder does not contain multiple vaults",
            )),
        }
    }
}

#[cfg(test)]
#[allow(unused_imports)]
mod tests {
    use super::*;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    fn javascript_timestamp_validation_rejects_lossy_values() {
        assert_eq!(valid_javascript_milliseconds(42.0), Ok(42));
        assert!(valid_javascript_milliseconds(-1.0).is_err());
        assert!(valid_javascript_milliseconds(1.5).is_err());
        assert!(valid_javascript_milliseconds(f64::NAN).is_err());
        assert!(valid_javascript_milliseconds(MAX_SAFE_JAVASCRIPT_INTEGER + 1.0).is_err());
    }

    #[wasm_bindgen_test]
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

    #[cfg(target_arch = "wasm32")]
    #[wasm_bindgen_test]
    fn sync_state_wrappers_project_values_and_reject_missing_data() {
        let never = NookVaultLastSync::never_synced();
        assert!(never.synced_at_unix_milliseconds().is_err());
        let synced = NookVaultLastSync::synced(42.0).unwrap();
        assert_eq!(synced.state(), NookVaultLastSyncState::Synced);
        assert_eq!(synced.synced_at_unix_milliseconds().unwrap(), 42.0);

        let idle = NookManualProviderSync::idle();
        assert_eq!(idle.state(), NookManualProviderSyncState::Idle);
        assert!(idle.provider_id().is_err());
        let running = NookManualProviderSync::running("provider-1".into());
        assert_eq!(running.provider_id().unwrap(), "provider-1");

        let clear = NookSyncConflictReview::clear();
        assert_eq!(clear.state(), NookSyncConflictReviewState::Clear);
        assert!(clear.provider_id().is_err());
        let conflict = NookPendingSyncConflict::for_testing_content("GitHub".into(), 2, 3);
        let review = NookSyncConflictReview::requires_decision(conflict);
        assert_eq!(
            review.state(),
            NookSyncConflictReviewState::RequiresDecision
        );
        assert_eq!(review.provider_id().unwrap(), "__test_provider__");
        assert!(!review.is_pending_provider().unwrap());
        assert_eq!(review.provider_label().unwrap(), "GitHub");
        assert_eq!(review.local_yaml().unwrap(), "");
        assert_eq!(review.remote_yaml().unwrap(), "remote-vault");
        assert_eq!(review.mode().unwrap(), "");
        assert_eq!(review.pat().unwrap(), "");
        assert_eq!(review.repo().unwrap(), "");
        assert_eq!(review.content_local_version().unwrap(), 2);
        assert_eq!(review.content_remote_version().unwrap(), 3);
        assert!(review.local_store_id().is_err());
        assert!(review.remote_store_id().is_err());

        let healthy = NookLocalFolderHealth::healthy();
        assert!(healthy.provider_id().is_err());
        let multiple = NookLocalFolderHealth::multiple_vaults(
            "provider-1".into(),
            "Folder".into(),
            vec!["store-a".into(), "store-b".into()],
            "Choose a vault".into(),
        );
        assert_eq!(multiple.state(), NookLocalFolderHealthState::MultipleVaults);
        assert_eq!(multiple.provider_id().unwrap(), "provider-1");
        assert_eq!(multiple.provider_label().unwrap(), "Folder");
        assert_eq!(multiple.store_ids().unwrap(), vec!["store-a", "store-b"]);
        assert_eq!(multiple.message().unwrap(), "Choose a vault");
    }
}

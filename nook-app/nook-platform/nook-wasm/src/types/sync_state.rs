use super::wasm_bindgen;
use nook_core::{ManualProviderSync, VaultLastSync};
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
            NookVaultLastSync::valid_javascript_milliseconds(at_unix_milliseconds)
                .map_err(JsError::new)?;
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
impl NookVaultLastSync {
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

#[cfg(test)]
#[allow(unused_imports)]
mod tests {
    use super::*;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    fn javascript_timestamp_validation_rejects_lossy_values() {
        assert_eq!(
            NookVaultLastSync::valid_javascript_milliseconds(42.0),
            Ok(42)
        );
        assert!(NookVaultLastSync::valid_javascript_milliseconds(-1.0).is_err());
        assert!(NookVaultLastSync::valid_javascript_milliseconds(1.5).is_err());
        assert!(NookVaultLastSync::valid_javascript_milliseconds(f64::NAN).is_err());
        assert!(
            NookVaultLastSync::valid_javascript_milliseconds(MAX_SAFE_JAVASCRIPT_INTEGER + 1.0)
                .is_err()
        );
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
    }
}

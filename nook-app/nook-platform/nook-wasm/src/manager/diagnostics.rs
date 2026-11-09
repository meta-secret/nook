//! Vault access diagnostics bridge.

use super::NookVaultManager;
use crate::NookDatabase;
use nook_core::LocalEventBytes;
use nook_core::VaultProjection;

use crate::types::NookVaultAccessReport;
use nook_core::VaultEvent;
use nook_core::{ProjectionDiagnosticInput, VaultAccessDiagnosticRequest};
use wasm_bindgen::JsError;
use wasm_bindgen::prelude::wasm_bindgen;

enum DiagnosticProjection {
    Unavailable,
    Loaded(nook_core::VaultProjection),
}

#[wasm_bindgen]
impl NookVaultManager {
    #[wasm_bindgen]
    pub async fn vault_access_diagnostics(&mut self) -> Result<NookVaultAccessReport, JsError> {
        let identity = self.ensure_device_identity()?;
        let records = self.stored_records_snapshot();
        let mut events = Vec::new();
        let mut projection = DiagnosticProjection::Unavailable;
        let mut warnings = Vec::new();

        if !self.vault.store_id.trim().is_empty() {
            let store = NookDatabase::load_local_event_store(&self.vault.store_id).await?;
            let graph = store.load_graph(&self.vault.store_id)?;
            projection = DiagnosticProjection::Loaded(VaultProjection::from_graph(
                &graph,
                &self.vault.store_id,
            )?);
            for event_id in store.event_ids() {
                let LocalEventBytes::Stored(bytes) = store.get_bytes(&event_id) else {
                    warnings.push(format!(
                        "Local event {event_id} is listed but its bytes are missing."
                    ));
                    continue;
                };
                match VaultEvent::parse_event_storage_bytes(&bytes) {
                    Ok(event) => events.push(event),
                    Err(_) => warnings.push(format!(
                        "Local event {event_id} is unreadable and was skipped."
                    )),
                }
            }
        }

        let projection = match &projection {
            DiagnosticProjection::Unavailable => ProjectionDiagnosticInput::Unavailable,
            DiagnosticProjection::Loaded(projection) => {
                ProjectionDiagnosticInput::Available(projection)
            }
        };
        let mut report = VaultAccessDiagnosticRequest {
            records: &records,
            identity: &identity,
            projection,
            events: &events,
        }
        .diagnose()?;
        report.warnings.extend(warnings);
        Ok(NookVaultAccessReport::from_core(report)?)
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use super::*;
    #[cfg(all(test, target_arch = "wasm32"))]
    #[cfg(all(test, target_arch = "wasm32"))]
    use nook_core::DeviceIdentity;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    async fn diagnostics_reject_missing_staged_vault_and_device_authorization() {
        let mut manager = NookVaultManager::new();
        assert!(manager.vault_access_diagnostics().await.is_err());
    }

    #[wasm_bindgen_test]
    async fn diagnostics_reject_malformed_staged_store_ids() -> Result<(), JsError> {
        let identity = DeviceIdentity::generate()?;
        let mut manager = NookVaultManager::new();
        manager.device.identity_private_key = identity.secret_string().into_inner();
        manager.vault.store_id = "not-a-store!".to_owned();
        assert!(manager.vault_access_diagnostics().await.is_err());
        Ok(())
    }
}

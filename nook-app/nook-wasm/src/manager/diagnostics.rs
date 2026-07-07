//! Vault access diagnostics bridge.

use super::NookVaultManager;
use crate::storage::event_db::load_local_event_store;
use crate::types::NookVaultAccessReport;
use wasm_bindgen::JsError;
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
impl NookVaultManager {
    #[wasm_bindgen(js_name = vaultAccessDiagnostics)]
    pub async fn vault_access_diagnostics(&mut self) -> Result<NookVaultAccessReport, JsError> {
        let identity = self.ensure_device_identity()?;
        let records = self.stored_records_snapshot();
        let mut events = Vec::new();
        let mut projection = None;
        let mut warnings = Vec::new();

        if !self.vault.store_id.trim().is_empty() {
            let store = load_local_event_store(&self.vault.store_id).await?;
            let graph = store.load_graph(&self.vault.store_id)?;
            projection = Some(nook_core::project_vault(&graph, &self.vault.store_id)?);
            for event_id in store.event_ids() {
                let Some(bytes) = store.get_bytes(&event_id) else {
                    warnings.push(format!(
                        "Local event {event_id} is listed but its bytes are missing."
                    ));
                    continue;
                };
                match nook_core::parse_event_storage_bytes(bytes) {
                    Ok(event) => events.push(event),
                    Err(_) => warnings.push(format!(
                        "Local event {event_id} is unreadable and was skipped."
                    )),
                }
            }
        }

        let mut report =
            nook_core::diagnose_vault_access(&records, &identity, projection.as_ref(), &events)?;
        report.warnings.extend(warnings);
        Ok(NookVaultAccessReport::from_core(report)?)
    }
}

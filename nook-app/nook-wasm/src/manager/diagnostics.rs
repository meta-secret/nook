//! Vault access diagnostics bridge.

use super::NookVaultManager;
use crate::storage::event_db::load_local_event_store;
use crate::types::{NookVaultAccessReport, NookVaultRecoveryOptions};
use wasm_bindgen::JsError;
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
impl NookVaultManager {
    /// Return only the safe, signed metadata needed to choose a vault recovery path.
    ///
    /// This intentionally works before device authorization and never returns
    /// password envelopes, passkey credential ids, or encrypted secret payloads.
    #[wasm_bindgen(js_name = vaultRecoveryOptions)]
    pub async fn vault_recovery_options(&mut self) -> Result<NookVaultRecoveryOptions, JsError> {
        let store_id = self.vault.store_id.trim().to_owned();
        if store_id.is_empty() {
            return Err(JsError::new("No staged vault is available."));
        }
        let store = load_local_event_store(&store_id).await?;
        let graph = store.load_graph(&store_id)?;
        let options = nook_core::vault_recovery_options(&graph, &store_id)?;
        let vault_name = self
            .vault
            .vault_name
            .clone()
            .unwrap_or_else(|| nook_core::default_vault_name_for_store_id(&store_id));
        Ok(NookVaultRecoveryOptions::from_core(
            store_id, vault_name, options,
        ))
    }

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

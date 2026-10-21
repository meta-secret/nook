//! Item history (created, modified, device) derived from the local vault event log.

use super::NookVaultManager;
use crate::{NookDatabase, NookError, NookSecretHistory};
use nook_core::{
    EventLookup, ResolveMemberRosterRequest, SecretHistoryLocalSigner, SecretHistoryRequest,
    SecretId, SigningIdentity, SymmetricKey, VaultMember, VaultProjection,
};
use wasm_bindgen::JsError;
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
impl NookVaultManager {
    /// Derive when and on which device one vault item was created and last
    /// modified. Reads only signed event metadata and the member roster; the
    /// item's encrypted payload is never decrypted.
    #[wasm_bindgen]
    pub async fn secret_history_js(&self, id: &str) -> Result<NookSecretHistory, JsError> {
        if self.vault.store_id.is_empty() {
            return Err(
                NookError::Database("Vault store id is not initialized.".to_owned()).into(),
            );
        }
        let store_id = self.vault.store_id.clone();
        let store = NookDatabase::load_local_event_store_strict(&store_id).await?;
        let graph = store.load_graph(&store_id)?;
        let projection = VaultProjection::from_graph(&graph, &store_id)?;
        let order = graph.topological_order()?;
        let mut events = Vec::with_capacity(order.len());
        for event_id in &order {
            let EventLookup::Recorded(event) = graph.get(event_id) else {
                return Err(NookError::Database(
                    "A vault event in the causal order is missing.".to_owned(),
                )
                .into());
            };
            events.push((event_id, event));
        }
        let members_key = SymmetricKey::parse(&self.vault.members_key)?;
        let roster = VaultMember::resolve_member_roster(ResolveMemberRosterRequest {
            records: &self.stored_records_snapshot(),
            members_key: &members_key,
        })?;
        let local_key = if self.event_log.signing_seed.is_empty() {
            None
        } else {
            Some(SigningIdentity::from_seed_hex_stored(&self.event_log.signing_seed)?.public_key())
        };
        let local_signer = match &local_key {
            Some(key) => SecretHistoryLocalSigner::Known(key),
            None => SecretHistoryLocalSigner::Unavailable,
        };
        let history = SecretHistoryRequest {
            secrets: &projection.secrets,
            events: &events,
            roster: &roster,
            local_signer,
            secret_id: &SecretId::from_vault_record(id),
        }
        .derive()?;
        Ok(NookSecretHistory::from_core(&history))
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use super::*;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    async fn history_requires_an_initialized_vault() {
        let manager = NookVaultManager::new();
        assert!(manager.secret_history_js("secret_missing").await.is_err());
    }
}

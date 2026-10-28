//! Merge another identity into the identity in use, proven by its passkey.
//!
//! Every vault the other identity keeps becomes a vault of the identity in
//! use: its events are stored here, it is listed in the vault registry, and
//! the identity in use's log records `vault-registered` for it, wrapped to
//! that identity's members and signed by this device. The identity log then
//! reaches the identity's mounts through the existing identity sync. The
//! other identity's log is never written, so its devices keep their access.

use nook_core::{
    IdentityId, IdentityMergeDestination, IdentityMergeProof, ProviderVaultName, StoreId,
};
use serde::{Deserialize, Serialize};
use tsify::Tsify;
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

use super::{INVALID_TYPED_INPUT, UNENCODABLE_TYPED_OUTPUT};
use crate::NookDatabase;
use crate::manager::NookVaultManager;
use crate::manager::access_check::NookProviderSource;
use crate::public_api::CheckedPasskey;
use crate::storage::event_db::{RemoteEventUnion, VaultEventPersistence};
use crate::storage::indexed_db::{RegisterLocalVaultRequest, RegistryLabelUpdate};

/// What a merge did to the identity in use.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct NookIdentityMerged {
    /// Vaults now registered with the identity in use.
    pub registered: Vec<StoreId>,
    /// Vaults the identity in use already kept; nothing was written for them.
    pub already_kept: Vec<StoreId>,
}

#[wasm_bindgen]
impl NookVaultManager {
    /// Merge identity `identity_id`, as `source` holds it, into the identity
    /// in use. One passkey of that identity proves the merge. Nothing is
    /// written unless the session is unlocked, the identity is another one,
    /// the passkey's key is its member, and every vault it keeps opens.
    #[wasm_bindgen]
    pub async fn merge_identity_with_passkey(
        &mut self,
        source: &tsify::Ts<NookProviderSource>,
        identity_id: String,
        rp_id: &str,
    ) -> Result<tsify::Ts<NookIdentityMerged>, JsError> {
        let source = source
            .to_rust()
            .map_err(|_| JsError::new(INVALID_TYPED_INPUT))?;
        let other = IdentityId::parse(&identity_id)?;
        let app_key = self.unlocked_app_key()?;
        let current =
            NookDatabase::load_identity_log(&Self::current_identity_id(&app_key).await?).await?;
        let directory = NookDatabase::load_identity_directory().await?;
        let merge = IdentityMergeDestination {
            log: &current,
            signer: app_key.app_id(),
            directory: &directory,
        }
        .merging(&other)?;
        let contents = self.provider_source_contents(&source).await?;
        let passkey = CheckedPasskey { rp_id }.derive().await?;
        let plan = merge.plan(IdentityMergeProof {
            app_key: &passkey.app_key,
            identity_logs: contents.identity_logs,
            vaults: contents.vaults,
        })?;
        drop(passkey);
        let mut registered = Vec::with_capacity(plan.vaults.len());
        for vault in plan.vaults {
            let events = vault
                .events
                .into_iter()
                .map(|event| (event.event_id, Vec::<u8>::from(event.bytes)))
                .collect::<Vec<_>>();
            VaultEventPersistence::new(vault.store_id.as_str())
                .union_remote(RemoteEventUnion { events: &events })
                .await?;
            let label = match &vault.name {
                ProviderVaultName::Named { name } => RegistryLabelUpdate::Set(name),
                ProviderVaultName::Unknown => RegistryLabelUpdate::PreserveOrDefault,
            };
            NookDatabase::register_local_vault(RegisterLocalVaultRequest {
                store_id: vault.store_id.as_str(),
                label,
            })
            .await?;
            registered.push(vault.store_id);
        }
        if !plan.operations.is_empty() {
            self.append_identity_operations(plan.operations).await?;
        }
        Tsify::into_ts(&NookIdentityMerged {
            registered,
            already_kept: plan.already_kept,
        })
        .map_err(|_| JsError::new(UNENCODABLE_TYPED_OUTPUT))
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use super::*;
    use crate::storage::indexed_db::VaultRegistryEntry;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    /// This browser's identity log and vault registry, to tell whether a
    /// refused merge wrote anything.
    #[derive(Debug, PartialEq, Eq)]
    struct StoredState {
        identity_events: Vec<nook_core::EventId>,
        registry: Vec<VaultRegistryEntry>,
    }

    impl StoredState {
        async fn read(identity_id: &IdentityId) -> anyhow::Result<Self> {
            Ok(Self {
                identity_events: NookDatabase::load_identity_log(identity_id)
                    .await?
                    .event_ids(),
                registry: NookDatabase::list_vault_registry_entries().await?,
            })
        }

        fn js<T>(result: Result<T, JsError>) -> anyhow::Result<T> {
            result.map_err(|error| anyhow::anyhow!("{error:?}"))
        }
    }

    #[wasm_bindgen_test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    async fn a_locked_session_or_the_identity_in_use_itself_merges_nothing() -> anyhow::Result<()> {
        let mut manager = NookVaultManager::new();
        StoredState::js(manager.delete_local_browser_data().await)?;
        let source = Tsify::into_ts(&NookProviderSource::CurrentProvider)
            .map_err(|_| anyhow::anyhow!("encode the merge source"))?;
        let elsewhere = IdentityId::generate()?.to_string();
        assert!(
            manager
                .merge_identity_with_passkey(&source, elsewhere, "localhost")
                .await
                .is_err()
        );

        StoredState::js(
            manager
                .finish_pin_device_protection("identity merge pin".to_owned())
                .await,
        )?;
        StoredState::js(
            manager
                .connect_fresh("local".to_owned(), String::new(), String::new())
                .await,
        )?;
        StoredState::js(manager.ensure_identity_control_log().await)?;
        let app_key = manager.unlocked_app_key()?;
        let identity_id = NookVaultManager::current_identity_id(&app_key).await?;
        let before = StoredState::read(&identity_id).await?;

        assert!(
            manager
                .merge_identity_with_passkey(&source, identity_id.to_string(), "localhost")
                .await
                .is_err()
        );
        assert_eq!(StoredState::read(&identity_id).await?, before);

        StoredState::js(manager.delete_local_browser_data().await)?;
        Ok(())
    }
}

//! An installation's membership across identities, as the browser extension
//! keeps it: which vaults of its identity it still has to pair, and which
//! app key connects it to one more identity.

use nook_core::{
    AppKeyIdentityMembership, AuthProvidersSnapshotData, IdentityConnectionKey,
    IdentityConnectionKeyRequest, IdentityVaultPairingPlan, IdentityVaultPairingRequest,
    LocalIdentityLog,
};
use serde::{Deserialize, Serialize};
use tsify::Tsify;
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

use super::{INVALID_TYPED_INPUT, UNENCODABLE_TYPED_OUTPUT};
use crate::manager::NookVaultManager;
use crate::{NookDatabase, NookError};

/// Store ids of the vaults this installation already holds pairing grants for.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct NookPairedVaults {
    pub store_ids: Vec<String>,
}

/// How connecting one more identity starts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
pub enum NookIdentityConnectionStart {
    /// The unlocked app key joins the next identity itself.
    CurrentKey,
    /// The unlocked app key belongs to a replicated identity: a new local identity is
    /// staged, and protecting it creates the app key that joins.
    NewKeyStaged,
}

impl NookVaultManager {
    async fn connection_key(&self) -> Result<IdentityConnectionKey, NookError> {
        let app_key = self.unlocked_app_key()?;
        let directory = NookDatabase::load_identity_directory().await?;
        let local_log = match directory
            .identity_for_app_key(&app_key)
            .map_err(NookDatabase::map_domain_error)?
        {
            AppKeyIdentityMembership::Unenrolled => LocalIdentityLog::Empty,
            AppKeyIdentityMembership::Enrolled(_) => Self::local_identity_log(&app_key).await?,
        };
        directory
            .connection_key(&IdentityConnectionKeyRequest {
                app_key: &app_key,
                local_log,
            })
            .map_err(NookDatabase::map_domain_error)
    }
}

#[wasm_bindgen]
impl NookVaultManager {
    /// The vaults of the current identity this installation still has to
    /// pair, from the identity log it holds now. Sync the log first.
    #[wasm_bindgen]
    pub async fn identity_vault_pairing_plan(
        &self,
        snapshot: &tsify::Ts<AuthProvidersSnapshotData>,
        paired: &tsify::Ts<NookPairedVaults>,
    ) -> Result<tsify::Ts<IdentityVaultPairingPlan>, JsError> {
        let providers = snapshot
            .to_rust()
            .map_err(|_| JsError::new(INVALID_TYPED_INPUT))?
            .providers;
        let paired = paired
            .to_rust()
            .map_err(|_| JsError::new(INVALID_TYPED_INPUT))?;
        let identity = self.current_identity_snapshot(&providers).await?;
        let plan = IdentityVaultPairingRequest {
            snapshot: &identity,
            paired_store_ids: &paired.store_ids,
        }
        .plan();
        Tsify::into_ts(&plan).map_err(|_| JsError::new(UNENCODABLE_TYPED_OUTPUT))
    }

    /// Start connecting one more identity. While the unlocked app key is
    /// in no replicated identity it joins itself; once it is, the next
    /// identity gets its own app key, as on the web app, so a new local
    /// identity named `label` is staged for its protection ceremony.
    #[wasm_bindgen]
    pub async fn begin_identity_connection(
        &mut self,
        label: &str,
    ) -> Result<tsify::Ts<NookIdentityConnectionStart>, JsError> {
        let start = match self.connection_key().await? {
            IdentityConnectionKey::CurrentAppKey => NookIdentityConnectionStart::CurrentKey,
            IdentityConnectionKey::NewAppKey => {
                self.begin_local_identity_creation(label).await?;
                NookIdentityConnectionStart::NewKeyStaged
            }
        };
        Tsify::into_ts(&start).map_err(|_| JsError::new(UNENCODABLE_TYPED_OUTPUT))
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use super::*;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    async fn begin(
        manager: &mut NookVaultManager,
        label: &str,
    ) -> anyhow::Result<NookIdentityConnectionStart> {
        manager
            .begin_identity_connection(label)
            .await
            .map_err(|error| anyhow::anyhow!("{error:?}"))?
            .to_rust()
            .map_err(|error| anyhow::anyhow!("{error:?}"))
    }

    #[wasm_bindgen_test]
    async fn a_fresh_key_connects_itself_and_a_key_in_use_stages_another() -> anyhow::Result<()> {
        let mut manager = NookVaultManager::new();
        manager
            .delete_local_browser_data()
            .await
            .map_err(|error| anyhow::anyhow!("{error:?}"))?;
        manager
            .finish_pin_device_protection("extension pin".to_owned())
            .await
            .map_err(|error| anyhow::anyhow!("{error:?}"))?;

        // Nothing ties the key to a keyring yet: it connects the first one.
        assert_eq!(
            begin(&mut manager, "Personal").await?,
            NookIdentityConnectionStart::CurrentKey
        );
        // Its keyring has a log now, so the next keyring gets its own key.
        manager
            .ensure_identity_control_log()
            .await
            .map_err(|error| anyhow::anyhow!("{error:?}"))?;
        assert_eq!(
            begin(&mut manager, "Work").await?,
            NookIdentityConnectionStart::NewKeyStaged
        );
        manager
            .delete_local_browser_data()
            .await
            .map_err(|error| anyhow::anyhow!("{error:?}"))?;
        Ok(())
    }
}

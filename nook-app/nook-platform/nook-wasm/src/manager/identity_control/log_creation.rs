//! Create the replicated identity control log, or bind a new installation to
//! the identity an enrollment code invites it into.

use nook_core::{
    IdentityControlLog, IdentityControlState, IdentityEvent, IdentityEventSigning,
    IdentityGenesisRequest, IdentityId,
};
use serde::{Deserialize, Serialize};
use tsify::Tsify;
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

use super::UNENCODABLE_TYPED_OUTPUT;
use crate::manager::NookVaultManager;
use crate::storage::identity_log::IdentityLogWrite;
use crate::storage::identity_record::KeyringDbRebindLocalIdentity;
use crate::{NookDatabase, NookError};

/// Result of making sure the current identity has a control log.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum NookIdentityLogEnsureOutcome {
    Existing,
    Created,
}

impl NookVaultManager {
    /// Sign the founder genesis for an identity that has no log yet. Vaults
    /// join the log as they are opened here; other apps join by request.
    async fn create_identity_log(&mut self, identity_id: &IdentityId) -> Result<(), NookError> {
        let app_key = self.unlocked_app_key()?;
        let founder = self.own_identity_member_keys(&app_key).await?;
        let signing = self.ensure_signing_identity().await?;
        let created_at = Self::identity_event_time()?;
        let genesis = IdentityEvent::genesis(IdentityGenesisRequest {
            identity_id,
            founder,
            signing: IdentityEventSigning {
                signing_key: signing.signing_key(),
                created_at: &created_at,
            },
        })?;
        let stored = [(genesis.id()?, genesis.serialize_storage_yaml()?)];
        let log = IdentityControlLog::new(identity_id.clone())
            .insert(genesis)
            .map_err(|rejection| rejection.cause)?
            .log;
        NookDatabase::save_identity_events(IdentityLogWrite {
            identity_id,
            events: &stored,
        })
        .await?;
        Self::apply_identity_state_locally(&app_key, &IdentityControlState::project(&log)?).await
    }
}

#[wasm_bindgen]
impl NookVaultManager {
    /// Create the identity's control log when this identity has none yet.
    #[wasm_bindgen]
    pub async fn ensure_identity_control_log(
        &mut self,
    ) -> Result<tsify::Ts<NookIdentityLogEnsureOutcome>, JsError> {
        let app_key = self.unlocked_app_key()?;
        let identity_id = Self::current_identity_id(&app_key).await?;
        let outcome = if NookDatabase::load_identity_log(&identity_id)
            .await?
            .is_empty()
        {
            self.create_identity_log(&identity_id).await?;
            NookIdentityLogEnsureOutcome::Created
        } else {
            NookIdentityLogEnsureOutcome::Existing
        };
        Tsify::into_ts(&outcome).map_err(|_| JsError::new(UNENCODABLE_TYPED_OUTPUT))
    }

    /// Bind a freshly protected local identity to the identity an enrollment
    /// code invites it into. The local identity must not own vaults yet.
    #[wasm_bindgen]
    pub async fn bind_local_identity_to_invitation(
        &mut self,
        identity_id: String,
    ) -> Result<(), JsError> {
        let invited = IdentityId::parse(&identity_id)?;
        let app_key = self.unlocked_app_key()?;
        let local = Self::current_identity_id(&app_key).await?;
        if local == invited {
            return Ok(());
        }
        let directory = NookDatabase::load_identity_directory().await?;
        let record = directory
            .identities()
            .iter()
            .find(|record| record.identity_id == local)
            .ok_or_else(|| JsError::new("The current identity is missing."))?;
        if !record.vault_deks.is_empty() || record.members.len() != 1 {
            return Err(JsError::new(
                "Join with a new identity: this identity already has vaults or apps.",
            ));
        }
        if !NookDatabase::load_identity_log(&local).await?.is_empty() {
            return Err(JsError::new(
                "Join with a new identity: this identity is already replicated.",
            ));
        }
        NookDatabase::rebind_local_identity(KeyringDbRebindLocalIdentity {
            local_identity_id: &local,
            replicated_identity_id: &invited,
        })
        .await?;
        Ok(())
    }
}

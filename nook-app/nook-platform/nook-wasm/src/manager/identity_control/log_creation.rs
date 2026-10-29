//! Create the replicated identity control log, or bind a new installation to
//! the identity an enrollment code invites it into.

use nook_core::{
    AppKeyIdentityMembership, FreshIdentityNamed, FreshIdentityNaming, IdentityControlLog,
    IdentityControlState, IdentityEvent, IdentityEventSigning, IdentityGenesisRequest, IdentityId,
    IdentityInvitationBinding, IdentityInvitationBindingRequest, LocalIdentityLog,
};
use serde::{Deserialize, Serialize};
use tsify::Tsify;
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

use super::UNENCODABLE_TYPED_OUTPUT;
use crate::manager::NookVaultManager;
use crate::manager::session::FirstVaultIdentityName;
use crate::storage::identity_log::IdentityLogWrite;
use crate::storage::identity_record::{IdentityDirectoryWrite, KeyringDbRebindLocalIdentity};
use crate::{NookDatabase, NookError};

/// Result of making sure the current identity has a control log.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum NookIdentityLogEnsureOutcome {
    Existing,
    Created,
}

impl NookVaultManager {
    /// Whether the app key's local identity already has a control log.
    pub(in crate::manager) async fn local_identity_log(
        app_key: &nook_core::AppKey,
    ) -> Result<LocalIdentityLog, NookError> {
        let local = Self::current_identity_id(app_key).await?;
        Ok(
            if NookDatabase::load_identity_log(&local).await?.is_empty() {
                LocalIdentityLog::Empty
            } else {
                LocalIdentityLog::Replicated
            },
        )
    }

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

/// Where a fresh identity's name went.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum NookFreshIdentityNaming {
    /// The identity exists on this browser and carries the name: setup may
    /// leave it without a vault.
    Named,
    /// The key has no identity here yet: the first vault's genesis creates
    /// it under the name, so setup creates that vault next.
    AtFirstVault,
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
    /// code invites it into. A local identity that already belongs to an
    /// identity refuses: another identity joins with its own app key.
    #[wasm_bindgen]
    pub async fn bind_local_identity_to_invitation(
        &mut self,
        identity_id: String,
    ) -> Result<(), JsError> {
        let invited = IdentityId::parse(&identity_id)?;
        let app_key = self.unlocked_app_key()?;
        let local_log = Self::local_identity_log(&app_key).await?;
        let binding = NookDatabase::load_identity_directory()
            .await?
            .invitation_binding(&IdentityInvitationBindingRequest {
                app_key: &app_key,
                invited: &invited,
                local_log,
            })
            .map_err(NookDatabase::map_domain_error)?;
        let IdentityInvitationBinding::Adopt { local_identity_id } = binding else {
            return Ok(());
        };
        NookDatabase::rebind_local_identity(KeyringDbRebindLocalIdentity {
            local_identity_id: &local_identity_id,
            replicated_identity_id: &invited,
        })
        .await?;
        Ok(())
    }

    /// Name this browser's identity while it is still fresh. Setup asks for
    /// the name only when it creates a new identity, after the passkey made
    /// its key; the control log, created later, seals that name. A key the
    /// browser extension lends has no local identity yet: the name waits on
    /// this session for the first vault's genesis, which creates it.
    #[wasm_bindgen]
    pub async fn name_fresh_identity(
        &mut self,
        label: String,
    ) -> Result<tsify::Ts<NookFreshIdentityNaming>, JsError> {
        let label = Self::local_identity_label(&label).map_err(JsError::new)?;
        let app_key = self.unlocked_app_key()?;
        let membership = NookDatabase::load_identity_directory()
            .await?
            .identity_for_app_key(&app_key)
            .map_err(NookDatabase::map_domain_error)?;
        let local_log = match membership {
            AppKeyIdentityMembership::Enrolled(_) => Self::local_identity_log(&app_key).await?,
            AppKeyIdentityMembership::Unenrolled => LocalIdentityLog::Empty,
        };
        let name = label.clone();
        let at_first_vault = NookDatabase::update_identity_directory(move |directory| {
            let named = directory
                .name_fresh_identity(&FreshIdentityNaming {
                    app_key: &app_key,
                    label: &label,
                    local_log,
                })
                .map_err(NookDatabase::map_domain_error)?;
            Ok(match named {
                FreshIdentityNamed::Renamed(directory) => IdentityDirectoryWrite {
                    directory,
                    value: false,
                },
                FreshIdentityNamed::AtFirstVault(directory) => IdentityDirectoryWrite {
                    directory,
                    value: true,
                },
            })
        })
        .await?;
        let (staged, naming) = if at_first_vault {
            (
                FirstVaultIdentityName::Named(name),
                NookFreshIdentityNaming::AtFirstVault,
            )
        } else {
            (
                FirstVaultIdentityName::Unnamed,
                NookFreshIdentityNaming::Named,
            )
        };
        self.device.first_vault_identity_name = staged;
        Tsify::into_ts(&naming).map_err(|_| JsError::new(UNENCODABLE_TYPED_OUTPUT))
    }
}

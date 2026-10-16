//! Identity-level membership: revocation, renaming, and mounts.

use nook_core::{
    AppId, AuthProvidersSnapshotData, IdentityControlOperation, IdentityControlState,
    IdentityMountCapability, IdentityVaultDekLookup, MemberLabel, ProviderRows,
    StorageProviderData, VaultKeys,
};
use tsify::Tsify;
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

use super::{INVALID_TYPED_INPUT, UNENCODABLE_TYPED_OUTPUT};
use crate::manager::NookVaultManager;
use crate::{NookDatabase, NookError};

impl NookVaultManager {
    /// Open every owned vault's current DEK through this member's own
    /// identity envelope.
    pub(super) fn opened_identity_vault_keys(
        &self,
        state: &IdentityControlState,
    ) -> Result<Vec<(nook_core::StoreId, nook_core::EventId, VaultKeys)>, NookError> {
        let app_key = self.unlocked_app_key()?;
        state
            .vaults
            .iter()
            .map(|vault| match vault.current_dek_for(app_key.app_id()) {
                IdentityVaultDekLookup::Granted(dek) => Ok((
                    vault.store_id.clone(),
                    vault.current_key_epoch.clone(),
                    VaultKeys {
                        secrets_key: app_key.decrypt_envelope(&dek.secrets_key_ciphertext)?,
                        members_key: app_key.decrypt_envelope(&dek.members_key_ciphertext)?,
                    },
                )),
                IdentityVaultDekLookup::NotGranted => Err(NookError::Database(format!(
                    "This installation cannot open vault {} to share it.",
                    vault.store_id
                ))),
            })
            .collect()
    }

    pub(super) async fn current_identity_state(&self) -> Result<IdentityControlState, NookError> {
        let app_key = self.unlocked_app_key()?;
        let identity_id = Self::current_identity_id(&app_key).await?;
        let log = NookDatabase::load_identity_log(&identity_id).await?;
        if log.is_empty() {
            return Err(NookError::Database(
                "This identity has no replicated control log yet.".to_owned(),
            ));
        }
        IdentityControlState::project(&log).map_err(Into::into)
    }
}

#[wasm_bindgen]
impl NookVaultManager {
    /// Revoke an app key from the identity. The open vault rotates now; every
    /// other owned vault rotates before its next write.
    #[wasm_bindgen]
    pub async fn revoke_identity_member(&mut self, app_id: String) -> Result<(), JsError> {
        let app_id = AppId::parse(&app_id)?;
        let revocation = self
            .current_identity_state()
            .await?
            .revocation_operation(&app_id)?;
        self.append_identity_operations(vec![revocation]).await?;
        if !self.vault.store_id.trim().is_empty() && self.vault.crypto.is_unlocked() {
            self.reconcile_open_vault_with_identity_log().await?;
        }
        Ok(())
    }

    #[wasm_bindgen]
    pub async fn rename_identity_member(
        &mut self,
        app_id: String,
        label: String,
    ) -> Result<(), JsError> {
        let app_id = AppId::parse(&app_id)?;
        let state = self.current_identity_state().await?;
        if state.member(&app_id).is_none() {
            return Err(JsError::new("App key is not an active identity member."));
        }
        self.append_identity_operations(vec![IdentityControlOperation::MemberRenamed {
            app_id,
            label: MemberLabel::from_trusted(label.trim().to_owned()),
        }])
        .await?;
        Ok(())
    }

    /// Record credential-free mount targets for remote provider rows the
    /// identity log does not list yet.
    #[wasm_bindgen]
    pub async fn record_identity_provider_mounts(
        &mut self,
        snapshot: &tsify::Ts<AuthProvidersSnapshotData>,
    ) -> Result<bool, JsError> {
        let providers = snapshot
            .to_rust()
            .map_err(|_| JsError::new(INVALID_TYPED_INPUT))?
            .providers;
        let state = self.current_identity_state().await?;
        let mounts = ProviderRows {
            providers: &providers,
        }
        .unrecorded_mounts(&state.mounts)?;
        if mounts.is_empty() {
            return Ok(false);
        }
        self.append_identity_operations(
            mounts
                .into_iter()
                .map(|mount| IdentityControlOperation::ProviderMounted { mount })
                .collect(),
        )
        .await?;
        Ok(true)
    }

    /// Remove the mount record whose target matches a removed provider row.
    #[wasm_bindgen]
    pub async fn remove_identity_provider_mount(
        &mut self,
        provider: &tsify::Ts<StorageProviderData>,
    ) -> Result<bool, JsError> {
        let provider = provider
            .to_rust()
            .map_err(|_| JsError::new(INVALID_TYPED_INPUT))?;
        let IdentityMountCapability::Mountable(target) = provider.identity_mount_capability()
        else {
            return Ok(false);
        };
        let state = self.current_identity_state().await?;
        let removals = state
            .mounts
            .iter()
            .filter(|mount| mount.target == target)
            .map(|mount| IdentityControlOperation::ProviderUnmounted {
                mount_id: mount.mount_id.clone(),
            })
            .collect::<Vec<_>>();
        if removals.is_empty() {
            return Ok(false);
        }
        self.append_identity_operations(removals).await?;
        Ok(true)
    }

    /// Remote provider rows that carry this identity's control log.
    #[wasm_bindgen]
    pub async fn identity_replication_providers(
        &self,
        snapshot: &tsify::Ts<AuthProvidersSnapshotData>,
    ) -> Result<tsify::Ts<AuthProvidersSnapshotData>, JsError> {
        let providers = snapshot
            .to_rust()
            .map_err(|_| JsError::new(INVALID_TYPED_INPUT))?
            .providers;
        let app_key = self.unlocked_app_key()?;
        let identity_id = Self::current_identity_id(&app_key).await?;
        let rows = AuthProvidersSnapshotData {
            providers: ProviderRows {
                providers: &providers,
            }
            .identity_replication(&identity_id)
            .into_iter()
            .map(|target| target.provider)
            .collect(),
            active_vault_store_id: nook_core::ActiveVaultScope::Unselected,
        };
        Tsify::into_ts(&rows).map_err(|_| JsError::new(UNENCODABLE_TYPED_OUTPUT))
    }
}

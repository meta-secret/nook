//! Identity-level join, approval, denial, revocation, renaming, and mounts.

use nook_core::{
    AppId, AuthProvidersSnapshotData, IdentityApprovalRequest, IdentityControlOperation,
    IdentityControlState, IdentityEventInsertStatus, IdentityEventSigning, IdentityMountCapability,
    IdentityVaultDekLookup, MemberLabel, OpenedVaultDek, ProviderRows, ReplicatedIdentityStanding,
    StorageMode, StorageProviderData, VaultKeys,
};
use tsify::Tsify;
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

use super::{INVALID_TYPED_INPUT, UNENCODABLE_TYPED_OUTPUT};
use crate::manager::NookVaultManager;
use crate::storage::identity_log::IdentityLogWrite;
use crate::{NookDatabase, NookError};

impl NookVaultManager {
    /// Open every owned vault's current DEK through this member's own
    /// identity envelope.
    fn opened_identity_vault_keys(
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

    async fn request_join_at_current_provider(&mut self) -> Result<(), NookError> {
        let app_key = self.unlocked_app_key()?;
        let identity_id = Self::current_identity_id(&app_key).await?;
        let (log, _) = self
            .union_identity_log_with_current_provider(&identity_id)
            .await?;
        if log.is_empty() {
            return Err(NookError::Database(
                "No identity was found at this provider. Ask for a new code.".to_owned(),
            ));
        }
        let state = IdentityControlState::project(&log)?;
        match ReplicatedIdentityStanding::of(&state, app_key.app_id()) {
            ReplicatedIdentityStanding::ActiveMember | ReplicatedIdentityStanding::PendingJoin => {
                return Ok(());
            }
            ReplicatedIdentityStanding::Revoked => {
                return Err(NookError::Database(
                    "This installation was removed from the identity.".to_owned(),
                ));
            }
            ReplicatedIdentityStanding::NotListed => {}
        }
        let member = self.own_identity_member_keys(&app_key).await?;
        let signing = self.ensure_signing_identity().await?;
        let created_at = Self::identity_event_time()?;
        let event = log.build_append(
            vec![IdentityControlOperation::MemberJoinRequested { member }],
            &IdentityEventSigning {
                signing_key: signing.signing_key(),
                created_at: &created_at,
            },
        )?;
        let event_id = event.id()?;
        let bytes = event.serialize_storage_yaml()?;
        let inserted = log.insert(event).map_err(|rejection| rejection.cause)?;
        if inserted.status != IdentityEventInsertStatus::Applied {
            return Err(NookError::Database(format!(
                "Join request did not apply: {:?}",
                inserted.status
            )));
        }
        NookDatabase::save_identity_events(IdentityLogWrite {
            identity_id: &identity_id,
            events: &[(event_id, bytes)],
        })
        .await?;
        self.union_identity_log_with_current_provider(&identity_id)
            .await?;
        Ok(())
    }
}

#[wasm_bindgen]
impl NookVaultManager {
    /// The joining installation asks the invited identity to approve its app
    /// key through the mount named by the enrollment code.
    #[wasm_bindgen]
    pub async fn request_identity_join(
        &mut self,
        storage_mode: String,
        github_pat: String,
        github_repo: String,
    ) -> Result<(), JsError> {
        let restore_local = self.storage.mode == StorageMode::Local;
        let result = async {
            self.prepare_storage_preserving_vault_metadata(
                &storage_mode,
                &github_pat,
                &github_repo,
            )
            .await?;
            self.request_join_at_current_provider().await
        }
        .await;
        if restore_local {
            self.prepare_storage_preserving_vault_metadata("local", "", "")
                .await?;
        }
        result.map_err(Into::into)
    }

    /// Approve a pending join and wrap every owned vault's DEK to it.
    #[wasm_bindgen]
    pub async fn approve_identity_join(&mut self, app_id: String) -> Result<(), JsError> {
        let app_id = AppId::parse(&app_id)?;
        let state = self.current_identity_state().await?;
        let opened = self.opened_identity_vault_keys(&state)?;
        let vaults = opened
            .iter()
            .map(|(store_id, key_epoch, keys)| OpenedVaultDek {
                store_id,
                key_epoch,
                keys,
            })
            .collect::<Vec<_>>();
        let approval = state.approval_operation(&IdentityApprovalRequest {
            app_id: &app_id,
            vaults: &vaults,
        })?;
        self.append_identity_operations(vec![approval]).await?;
        Ok(())
    }

    #[wasm_bindgen]
    pub async fn deny_identity_join(&mut self, app_id: String) -> Result<(), JsError> {
        let app_id = AppId::parse(&app_id)?;
        let denial = self
            .current_identity_state()
            .await?
            .denial_operation(&app_id)?;
        self.append_identity_operations(vec![denial]).await?;
        Ok(())
    }

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

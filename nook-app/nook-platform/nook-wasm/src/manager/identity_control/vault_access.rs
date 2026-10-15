//! Vault access that flows from identity membership.
//!
//! An identity-approved installation opens a Simple vault with the DEK its
//! identity envelope carries and self-enrolls into that vault's log. Opening
//! a vault also brings it in line with the identity log: identity
//! revocations rotate the vault first, then the identity records the vault's
//! current key epoch for every active member.

use nook_core::{
    AuthProvidersSnapshotData, EventId, IdentityControlState, IdentityVaultEpochAction,
    IdentityVaultEpochStatus, IdentityVaultKeyOpening, IdentityVaultRegistration, MultiDeviceError,
    OpenedVaultDek, ProviderRows, SecretTypeFilter, StorageProviderData, StoreId, SymmetricKey,
    VaultKeys, VaultMetaState, VaultRevocationDue, VaultType, VaultUnlock,
};
use tsify::Tsify;
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

use super::{INVALID_TYPED_INPUT, UNENCODABLE_TYPED_OUTPUT};

use crate::manager::NookVaultManager;
use crate::manager::verified_access::VerifiedVaultAccessFlow;
use crate::{NookDatabase, NookError, NookSecretPage};

impl NookVaultManager {
    async fn identity_owns_open_vault(&self, store_id: &StoreId) -> Result<bool, NookError> {
        let app_key = self.unlocked_app_key()?;
        let identity_id = Self::current_identity_id(&app_key).await?;
        Ok(NookDatabase::load_identity_directory()
            .await?
            .identities()
            .iter()
            .any(|record| record.identity_id == identity_id && record.owns_vault(store_id)))
    }

    fn open_vault_keys(&self) -> Result<VaultKeys, NookError> {
        Ok(VaultKeys {
            secrets_key: SymmetricKey::parse(&self.vault.secrets_key)?,
            members_key: SymmetricKey::parse(&self.vault.members_key)?,
        })
    }
}

#[wasm_bindgen]
impl NookVaultManager {
    /// The saved row that replicates one identity vault.
    #[wasm_bindgen]
    pub fn identity_vault_provider(
        &self,
        snapshot: &tsify::Ts<AuthProvidersSnapshotData>,
        store_id: &str,
    ) -> Result<tsify::Ts<StorageProviderData>, JsError> {
        let providers = snapshot
            .to_rust()
            .map_err(|_| JsError::new(INVALID_TYPED_INPUT))?
            .providers;
        let store_id = StoreId::parse(store_id)?;
        let rows = ProviderRows {
            providers: &providers,
        };
        let row = rows.vault_row(&store_id).ok_or_else(|| {
            NookError::Database("No saved provider replicates this vault.".to_owned())
        })?;
        Tsify::into_ts(row).map_err(|_| JsError::new(UNENCODABLE_TYPED_OUTPUT))
    }

    /// Open a vault of the current identity from one of its mounts with the
    /// DEK the identity granted this installation, then self-enroll.
    #[wasm_bindgen]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects `connect_identity_vault` paging values through JavaScript Number scalars"
        )
    )]
    pub async fn connect_identity_vault(
        &mut self,
        storage_mode: String,
        github_pat: String,
        github_repo: String,
        store_id: String,
        page_limit: u32,
    ) -> Result<NookSecretPage, JsError> {
        drop(self.status.tx.send("CONNECT_START".to_owned()));
        let store_id = StoreId::parse(&store_id)?;
        self.prepare_storage(&storage_mode, &github_pat, &github_repo)
            .await?;
        let app_key = self.unlocked_app_key()?;
        let keys = NookDatabase::load_identity_directory()
            .await?
            .open_vault_dek(IdentityVaultKeyOpening {
                app_key: &app_key,
                store_id: store_id.clone(),
            })
            .map_err(NookDatabase::map_domain_error)?;
        self.vault.store_id = store_id.as_str().to_owned();
        let (event_log_remote, records) = self.load_password_unlock_records("", true).await?;
        if self.vault.architecture.vault_type == VaultType::Sentinel {
            return Err(MultiDeviceError::SentinelCeremonyRequired.into());
        }
        if records.is_empty() {
            return Err(
                NookError::Database("No vault records found at this provider.".to_owned()).into(),
            );
        }
        self.apply_vault_keys(keys.secrets_key.as_str(), keys.members_key.as_str())?;
        self.vault.unlock = VaultUnlock::Keys;
        self.vault.meta = VaultMetaState::from_stored_records(&records)?;
        self.ensure_event_log_ready().await?;
        if !self.vault.meta.auth.contains_key(&app_key.auth_id()) {
            self.persist_password_unlock_membership(&records, &app_key, &keys)
                .await?;
        }
        if let Err(error) = self.ensure_identity_after_connect(&app_key).await {
            self.reset_vault_session();
            return Err(error.into());
        }
        if event_log_remote {
            let yaml = self.serialize_current_projection_yaml()?;
            NookDatabase::save_to_indexed_db(&yaml).await?;
        }
        self.purge_legacy_plaintext_search_catalog().await?;
        self.reconcile_open_vault_with_identity_log().await?;
        let page = VerifiedVaultAccessFlow::Connect
            .complete(
                self.query_secret_page("", SecretTypeFilter::All, 0, page_limit),
                app_key.device_id(),
                &self.vault.store_id,
            )
            .await?;
        drop(self.status.tx.send("READY".to_owned()));
        NookSecretPage::from_core(page).map_err(Into::into)
    }

    /// Bring the open vault in line with the identity log. Returns whether the
    /// identity log changed and must be pushed to its mounts.
    #[wasm_bindgen]
    pub async fn reconcile_open_vault_with_identity_log(&mut self) -> Result<bool, JsError> {
        if self.vault.architecture.vault_type == VaultType::Sentinel
            || !self.vault.crypto.is_unlocked()
        {
            return Ok(false);
        }
        let Ok(store_id) = StoreId::parse(self.vault.store_id.trim()) else {
            return Ok(false);
        };
        let app_key = self.unlocked_app_key()?;
        let identity_id = Self::current_identity_id(&app_key).await?;
        let log = NookDatabase::load_identity_log(&identity_id).await?;
        if log.is_empty() || !self.identity_owns_open_vault(&store_id).await? {
            return Ok(false);
        }
        let state = IdentityControlState::project(&log)?;
        // Only an active member signs identity operations for the vault.
        if state.member(app_key.app_id()).is_none() {
            return Ok(false);
        }
        let graph = NookDatabase::load_local_event_store(store_id.as_str())
            .await?
            .load_graph(store_id.as_str())?;
        let roster = graph.authorized_roster()?;
        let due = VaultRevocationDue {
            state: &state,
            vault_roster: &roster,
        }
        .auth_ids()?;
        for auth_id in due {
            self.revoke_vault_member(auth_id.as_str().to_owned())
                .await?;
        }
        let key_epoch = EventId::parse(&self.ensure_key_epoch().await?)?;
        let keys = self.open_vault_keys()?;
        let dek = OpenedVaultDek {
            store_id: &store_id,
            key_epoch: &key_epoch,
            keys: &keys,
        };
        let operation = match (IdentityVaultEpochStatus {
            state: &state,
            store_id: &store_id,
            key_epoch: &key_epoch,
        })
        .action()
        {
            IdentityVaultEpochAction::Current => return Ok(false),
            IdentityVaultEpochAction::Register => {
                state.vault_registration_operation(IdentityVaultRegistration { dek })?
            }
            IdentityVaultEpochAction::Rewrap => state.vault_rewrap_operation(&dek)?,
        };
        self.append_identity_operations(vec![operation]).await?;
        Ok(true)
    }
}

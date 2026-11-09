//! The name of a keyring's vault this browser does not hold yet.
//!
//! A vault's name lives inside it, sealed with its secrets key. The keyring
//! grants this browser that key, so the name reads from the vault's events
//! at the provider that replicates it, without opening the vault: the vault
//! open in this session, and this browser's storage, stay as they are.

use crate::{TypedInput, TypedOutput};
use nook_core::{
    AuthProvidersSnapshot, GrantedVaultEvents, GrantedVaultNameRead, IdentityVaultKeyOpening,
    IdentityVaultReach, LocalEventWrite, ProviderRowLookup, ProviderRows, StorageConnection,
    StoreId,
};
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

use crate::NookRemoteSource;
use crate::manager::NookVaultManager;
use crate::manager::prepared_provider::{PreparedProvider, ProviderPreparation};
use crate::{NookDatabase, NookError};

#[wasm_bindgen]
impl NookVaultManager {
    /// The name of one vault of the current identity, read from the saved
    /// row that replicates it with the key the identity granted this
    /// browser. A vault its own log never named has none; one no saved row
    /// replicates yet is said to be so.
    #[wasm_bindgen]
    pub async fn identity_vault_name(
        &self,
        snapshot: &tsify::Ts<AuthProvidersSnapshot>,
        store_id: &str,
    ) -> Result<tsify::Ts<GrantedVaultNameRead>, JsError> {
        let providers = snapshot.decode()?.providers;
        let store_id = StoreId::parse(store_id)?;
        let rows = ProviderRows {
            providers: &providers,
        };
        let ProviderRowLookup::Found(row) = rows.vault_row(&store_id) else {
            return Ok(GrantedVaultNameRead::NotReplicatedHereYet.encode()?);
        };
        let app_key = self.unlocked_app_key()?;
        let keys = NookDatabase::load_identity_directory()
            .await?
            .open_vault_dek(IdentityVaultKeyOpening {
                app_key: &app_key,
                store_id: store_id.clone(),
            })
            .map_err(NookDatabase::map_domain_error)?;
        let events = match row.identity_vault_reach() {
            IdentityVaultReach::Connection(connection) => {
                Self::vault_events_through(&connection, &store_id).await?
            }
            IdentityVaultReach::FolderRecords(handle_id) => {
                NookRemoteSource::LocalFolder { handle_id }
                    .open()
                    .await?
                    .listed_vault_events(&store_id)
                    .await?
            }
        };
        let name = GrantedVaultEvents { store_id, events }.name(&keys.secrets_key)?;
        Ok(GrantedVaultNameRead::Read { name }.encode()?)
    }
}

impl NookVaultManager {
    /// One vault's events through a row's connection, prepared on its own:
    /// the session's provider and its progress reports stay untouched.
    async fn vault_events_through(
        connection: &StorageConnection,
        store_id: &StoreId,
    ) -> Result<Vec<LocalEventWrite>, NookError> {
        let (progress, _unread) = flume::unbounded();
        let prepared = PreparedProvider::prepare(ProviderPreparation {
            connection,
            status: &progress,
        })
        .await?;
        match &prepared {
            PreparedProvider::Remote(remote) => {
                remote.location().listed_vault_events(store_id).await
            }
            PreparedProvider::ThisBrowser => Err(NookError::Database(
                "This browser's own store holds no vault it does not hold.".to_owned(),
            )),
        }
    }
}

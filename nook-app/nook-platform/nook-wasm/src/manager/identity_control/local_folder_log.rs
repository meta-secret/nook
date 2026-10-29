//! A local folder carries the identity's control log beside the vaults it
//! files, as a sync provider does. Prepared storage reaches only network
//! providers, so a local-folder mount is unioned through its own handle.

use nook_core::{EventStorageBytes, IdentityControlState, PlacedNamespace};
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

use super::{NookIdentityLogSyncOutcome, UNENCODABLE_TYPED_OUTPUT};
use crate::manager::NookVaultManager;
use crate::storage::identity_log::IdentityLogWrite;
use crate::storage::local_folder::{LocalFolderEventWrite, LocalFolderHandles};
use crate::{NookDatabase, NookError};

#[wasm_bindgen]
impl NookVaultManager {
    /// Union the current identity's control log with a local-folder mount:
    /// events the folder holds are verified and kept here, and events only
    /// this browser holds are written to the folder.
    #[wasm_bindgen]
    pub async fn sync_identity_log_with_local_folder(
        &mut self,
        handle_id: String,
    ) -> Result<tsify::Ts<NookIdentityLogSyncOutcome>, JsError> {
        let app_key = self.unlocked_app_key()?;
        let identity_id = Self::current_identity_id(&app_key).await?;
        let folder = LocalFolderHandles::current()
            .open_folder(&handle_id)
            .await?;
        let placed = PlacedNamespace::identity_log(identity_id.clone());
        let mut log = NookDatabase::load_identity_log(&identity_id).await?;
        let mut in_folder = Vec::new();
        let mut pulled = Vec::new();
        for file in folder.read_events(&placed).await? {
            let bytes = EventStorageBytes::from(file.content.into_bytes());
            let event = nook_core::IdentityEvent::parse_storage_bytes(&bytes)?;
            let event_id = event.id()?;
            in_folder.push(event_id.clone());
            if log.contains(&event_id) {
                continue;
            }
            log = log.insert(event).map_err(|rejection| rejection.cause)?.log;
            pulled.push((event_id, bytes));
        }
        NookDatabase::save_identity_events(IdentityLogWrite {
            identity_id: &identity_id,
            events: &pulled,
        })
        .await?;
        let mut writes = Vec::new();
        for (event_id, bytes) in log.storage_bytes()? {
            if in_folder.contains(&event_id) {
                continue;
            }
            writes.push(LocalFolderEventWrite {
                event_id: event_id.as_str().to_owned(),
                content: String::from_utf8(Vec::from(bytes))
                    .map_err(|error| NookError::Serialization(error.to_string()))?,
            });
        }
        if !writes.is_empty() {
            folder.write_events(&placed, &writes).await?;
        }
        if !log.is_empty() {
            let state = IdentityControlState::project(&log)?;
            Self::apply_identity_state_locally(&app_key, &state).await?;
        }
        let outcome = NookIdentityLogSyncOutcome {
            pulled_new_events: !pulled.is_empty(),
            pushed_new_events: !writes.is_empty(),
        };
        tsify::Tsify::into_ts(&outcome).map_err(|_| JsError::new(UNENCODABLE_TYPED_OUTPUT))
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use super::*;
    use nook_core::IdentityId;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    fn js<T>(result: Result<T, JsError>) -> anyhow::Result<T> {
        result.map_err(|error| anyhow::anyhow!("{error:?}"))
    }

    async fn sync(
        manager: &mut NookVaultManager,
        handle_id: &str,
    ) -> anyhow::Result<NookIdentityLogSyncOutcome> {
        js(manager
            .sync_identity_log_with_local_folder(handle_id.to_owned())
            .await)?
        .to_rust()
        .map_err(|error| anyhow::anyhow!("{error:?}"))
    }

    #[wasm_bindgen_test]
    async fn the_identity_log_reaches_a_local_folder_mount_once() -> anyhow::Result<()> {
        let mut manager = NookVaultManager::new();
        js(manager.delete_local_browser_data().await)?;
        js(manager
            .finish_pin_device_protection("folder pin".to_owned())
            .await)?;
        js(manager.ensure_identity_control_log().await)?;
        let handle_id = format!("identity-log-{}", IdentityId::generate()?.as_str());
        LocalFolderHandles::current()
            .register_private_folder(&handle_id)
            .await?;

        let first = sync(&mut manager, &handle_id).await?;
        assert!(first.pushed_new_events);
        assert!(!first.pulled_new_events);
        let identity_id =
            NookVaultManager::current_identity_id(&manager.unlocked_app_key()?).await?;
        let in_folder = LocalFolderHandles::current()
            .open_folder(&handle_id)
            .await?
            .read_events(&PlacedNamespace::identity_log(identity_id.clone()))
            .await?;
        assert_eq!(
            in_folder.len(),
            NookDatabase::load_identity_log(&identity_id)
                .await?
                .storage_bytes()?
                .len()
        );

        // The folder and this browser hold the same log now.
        let second = sync(&mut manager, &handle_id).await?;
        assert!(!second.pushed_new_events);
        assert!(!second.pulled_new_events);
        js(manager.delete_local_browser_data().await)?;
        Ok(())
    }
}

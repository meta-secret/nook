//! Access checks against the sync provider this manager is connected to or
//! has staged for a recovery: iCloud, GitHub, Google Drive, or a local
//! folder. The provider's identity logs and vault logs are read with the
//! credentials already in the session; nothing is written.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use nook_core::{
    CheckedVaultEvents, CredentialCheckReport, EventLogLocation, IdentityId, LocalEventWrite,
    ProviderIdentityLogEvents, VaultPlacement,
};
use wasm_bindgen::{JsError, prelude::wasm_bindgen};
use zeroize::Zeroizing;

use super::NookVaultManager;
use crate::NookError;
use crate::public_api::SourceContents;
use crate::storage::remote_event::RemoteEventRead;

impl NookVaultManager {
    /// Every vault the current provider files, with the identity filing it,
    /// and those identities' control logs.
    async fn current_provider_contents(&self) -> Result<SourceContents, NookError> {
        let mut vaults = Vec::new();
        let mut identities: Vec<IdentityId> = Vec::new();
        for store_id in self.list_vault_ids_at_current_provider().await? {
            let location = EventLogLocation::Vault(store_id.clone());
            let VaultPlacement::Filed(placed) = self.placed_at_current_provider(&location).await?
            else {
                return Err(NookError::Database(format!(
                    "Vault {store_id} disappeared from the provider during the check."
                )));
            };
            let mut events = Vec::new();
            for event_id in self.list_provider_event_ids_at(&location).await? {
                if let RemoteEventRead::Retrieved(bytes) =
                    self.read_provider_event_at(&location, &event_id).await?
                {
                    events.push(LocalEventWrite { event_id, bytes });
                }
            }
            if !identities.contains(placed.identity()) {
                identities.push(placed.identity().clone());
            }
            vaults.push(CheckedVaultEvents {
                store_id,
                filed_under: placed.identity().clone(),
                events,
            });
        }
        let mut identity_logs = Vec::new();
        for identity_id in identities {
            let location = EventLogLocation::Identity(identity_id.clone());
            let mut events = Vec::new();
            for event_id in self.list_provider_event_ids_at(&location).await? {
                if let RemoteEventRead::Retrieved(bytes) =
                    self.read_provider_event_at(&location, &event_id).await?
                {
                    events.push(bytes);
                }
            }
            identity_logs.push(ProviderIdentityLogEvents {
                identity_id,
                events,
            });
        }
        Ok(SourceContents {
            identity_logs,
            vaults,
        })
    }
}

#[wasm_bindgen]
impl NookVaultManager {
    /// Ask for one passkey and report which of the current provider's vaults
    /// it opens, each proven by decrypting its key and name.
    pub async fn check_passkey_access_at_current_provider(
        &self,
        rp_id: &str,
    ) -> Result<tsify::Ts<CredentialCheckReport>, JsError> {
        self.current_provider_contents()
            .await?
            .check_passkey(rp_id)
            .await
    }

    /// Report which of the current provider's vaults a backup password opens.
    pub async fn check_backup_password_access_at_current_provider(
        &self,
        password: String,
    ) -> Result<tsify::Ts<CredentialCheckReport>, JsError> {
        let password = Zeroizing::new(password);
        self.current_provider_contents()
            .await?
            .check_backup_password(&password)
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use super::*;
    use crate::public_api::{NookAccessCheckSource, check_backup_password_access};
    use crate::storage::fetch_stub::{FetchRoute, FetchStub};
    use nook_core::{
        CheckedCredential, DriveVaultFolderLookup, IdentityCheckOutcome, StorageMode,
        VaultCheckOutcome,
    };
    use tsify::Tsify;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    /// This browser's identities and vaults, checked as one source.
    struct ThisBrowserCheck;

    impl ThisBrowserCheck {
        /// Check them with one backup password.
        async fn with_password(password: &str) -> anyhow::Result<CredentialCheckReport> {
            let source = Tsify::into_ts(&NookAccessCheckSource::ThisBrowser)
                .map_err(|_| anyhow::anyhow!("encode the check source"))?;
            check_backup_password_access(&source, password.to_owned())
                .await
                .map_err(|error| anyhow::anyhow!("check backup password: {error:?}"))?
                .to_rust()
                .map_err(|_| anyhow::anyhow!("decode the check report"))
        }
    }

    #[wasm_bindgen_test]
    async fn a_backup_password_opens_its_vault_here_but_never_the_identity() -> anyhow::Result<()> {
        let mut manager = NookVaultManager::new();
        manager
            .delete_local_browser_data()
            .await
            .map_err(|error| anyhow::anyhow!("clear browser data: {error:?}"))?;
        manager
            .finish_pin_device_protection("access check pin".to_owned())
            .await
            .map_err(|error| anyhow::anyhow!("protect identity: {error:?}"))?;
        let identity = manager.device_identity()?;
        let pending = manager
            .initialize_genesis_vault_with_identity(&identity)
            .await?;
        manager.bootstrap_simple_event_log_genesis(&pending).await?;
        manager
            .add_vault_password_for_e2e("Recovery".to_owned(), "access-check-password".to_owned())
            .await
            .map_err(|error| anyhow::anyhow!("add backup password: {error:?}"))?;
        let store_id = manager.vault.store_id.clone();

        let right = ThisBrowserCheck::with_password("access-check-password").await?;
        assert_eq!(right.credential, CheckedCredential::BackupPassword);
        let identity_check = right
            .identities
            .iter()
            .find(|checked| {
                checked
                    .vaults
                    .iter()
                    .any(|vault| vault.store_id.as_str() == store_id)
            })
            .ok_or_else(|| anyhow::anyhow!("the vault's identity is not in the report"))?;
        assert_eq!(identity_check.outcome, IdentityCheckOutcome::VaultsOnly);
        assert!(identity_check.vaults.iter().any(|vault| {
            vault.store_id.as_str() == store_id
                && matches!(vault.outcome, VaultCheckOutcome::Opens { .. })
        }));

        let wrong = ThisBrowserCheck::with_password("not-the-password").await?;
        assert!(
            wrong
                .identities
                .iter()
                .all(|checked| checked.outcome == IdentityCheckOutcome::DoesNotOpen)
        );

        manager
            .delete_local_browser_data()
            .await
            .map_err(|error| anyhow::anyhow!("clear browser data: {error:?}"))?;
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn a_drive_root_without_identities_opens_nothing_and_writes_nothing() -> anyhow::Result<()>
    {
        const LIST: &str = "drive/v3/files?";
        let root = format!(
            r#"{{"files":[{{"id":"nook-root","name":"{}","mimeType":"application/vnd.google-apps.folder"}}]}}"#,
            DriveVaultFolderLookup::root_name()
        );
        let empty = r#"{"files":[]}"#;
        let stub = FetchStub::install(vec![
            FetchRoute::ok("GET", LIST, &root),
            FetchRoute::ok("GET", LIST, empty),
            FetchRoute::ok("GET", LIST, empty),
            FetchRoute::ok("GET", LIST, empty),
        ])?;
        let source = Tsify::into_ts(&NookAccessCheckSource::GoogleDrive {
            access_token: "drive-access-token".to_owned(),
        })
        .map_err(|_| anyhow::anyhow!("encode the check source"))?;

        let report: CredentialCheckReport = check_backup_password_access(&source, "any".to_owned())
            .await
            .map_err(|error| anyhow::anyhow!("check backup password: {error:?}"))?
            .to_rust()
            .map_err(|_| anyhow::anyhow!("decode the check report"))?;

        assert_eq!(report.credential, CheckedCredential::BackupPassword);
        assert!(report.identities.is_empty());
        let calls = stub.calls();
        assert!(!calls.is_empty());
        assert!(calls.iter().all(|call| call.starts_with("GET ")));
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn a_session_without_a_sync_provider_has_nothing_to_check() -> anyhow::Result<()> {
        let mut manager = NookVaultManager::new();
        manager.storage.mode = StorageMode::Local;

        let report: CredentialCheckReport = manager
            .check_backup_password_access_at_current_provider("any".to_owned())
            .await
            .map_err(|error| anyhow::anyhow!("check backup password: {error:?}"))?
            .to_rust()
            .map_err(|_| anyhow::anyhow!("decode the check report"))?;

        assert!(report.identities.is_empty());
        Ok(())
    }
}

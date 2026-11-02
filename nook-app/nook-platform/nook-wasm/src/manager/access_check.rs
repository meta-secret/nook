//! Where the manager reads a provider's identities and vaults from, and the
//! access checks against them. The current provider (iCloud, GitHub, Google
//! Drive, S3, or a local folder this session is connected to or has staged for
//! a recovery) is read with the session's credentials; a Drive account, a
//! folder, or an S3 location can also be read on its own. Checks write nothing.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use crate::TypedInput;
use nook_core::{
    CheckedVaultEvents, CredentialCheckReport, EventLogLocation, EventLogNamespaceKind,
    LocalEventWrite, ProviderIdentityLogEvents, VaultPlacement,
};
use wasm_bindgen::{JsError, prelude::wasm_bindgen};
use zeroize::Zeroizing;

use serde::{Deserialize, Serialize};
use tsify::Tsify;

use super::NookVaultManager;
use crate::NookError;
use crate::public_api::{NookRemoteSource, SourceContents};
use crate::storage::remote_event::RemoteEventRead;

/// Where an identity operation or a check reads identities and vaults from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "kind", content = "source", rename_all = "camelCase")]
pub enum NookProviderSource {
    /// The provider this session is connected to or has staged for a
    /// recovery, read with the credentials the session already holds.
    CurrentProvider,
    /// One provider location the page names.
    Remote(NookRemoteSource),
}

impl NookVaultManager {
    /// A source's identity logs and vaults, read without any key.
    pub(crate) async fn provider_source_contents(
        &self,
        source: &NookProviderSource,
    ) -> Result<SourceContents, NookError> {
        match source {
            NookProviderSource::CurrentProvider => self.current_provider_contents().await,
            NookProviderSource::Remote(source) => source.contents().await,
        }
    }

    /// Every vault the current provider files, with the identity filing it,
    /// and the control log of every identity the provider holds, whether or
    /// not it files a vault there.
    async fn current_provider_contents(&self) -> Result<SourceContents, NookError> {
        let mut vaults = Vec::new();
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
            vaults.push(CheckedVaultEvents {
                store_id,
                filed_under: placed.identity().clone(),
                events,
            });
        }
        let mut identity_logs = Vec::new();
        for log in self
            .list_namespaces_at_current_provider(EventLogNamespaceKind::Identity)
            .await?
        {
            let identity_id = log.identity().clone();
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
    /// Ask for one passkey and report which of the source's identities and
    /// vaults it opens, each proven by decrypting its key and name.
    pub async fn check_passkey_access_from(
        &self,
        source: &tsify::Ts<NookProviderSource>,
        rp_id: &str,
    ) -> Result<tsify::Ts<CredentialCheckReport>, JsError> {
        let source = source.decode()?;
        self.provider_source_contents(&source)
            .await?
            .check_passkey(rp_id)
            .await
    }

    /// Report which of the source's vaults a backup password opens.
    pub async fn check_backup_password_access_from(
        &self,
        source: &tsify::Ts<NookProviderSource>,
        password: String,
    ) -> Result<tsify::Ts<CredentialCheckReport>, JsError> {
        let source = source.decode()?;
        let password = Zeroizing::new(password);
        self.provider_source_contents(&source)
            .await?
            .check_backup_password(&password)
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use super::*;
    use crate::TypedOutput;
    use crate::manager::PreparedProvider;
    use crate::public_api::{
        NookAccessCheckSource, NookRemoteSource, check_backup_password_access,
    };
    use crate::storage::fetch_stub::{FetchRoute, FetchStub};
    use crate::test_fixtures::WasmFixture;
    use nook_core::{
        CheckedCredential, DriveVaultFolderLookup, IdentityCheckOutcome, VaultCheckOutcome,
    };
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    /// This browser's identities and vaults, checked as one source.
    struct ThisBrowserCheck;

    impl ThisBrowserCheck {
        /// Check them with one backup password.
        async fn with_password(password: &str) -> anyhow::Result<CredentialCheckReport> {
            let source = NookAccessCheckSource::ThisBrowser.encode()?;
            Ok(check_backup_password_access(&source, password.to_owned())
                .await
                .map_err(|error| anyhow::anyhow!("check backup password: {error:?}"))?
                .decode()?)
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
        let source = NookAccessCheckSource::Remote(NookRemoteSource::GoogleDrive {
            access_token: WasmFixture::secret("drive-access-token")?,
        })
        .encode()?;

        let report: CredentialCheckReport = check_backup_password_access(&source, "any".to_owned())
            .await
            .map_err(|error| anyhow::anyhow!("check backup password: {error:?}"))?
            .decode()?;

        assert_eq!(report.credential, CheckedCredential::BackupPassword);
        assert!(report.identities.is_empty());
        let calls = stub.calls();
        assert!(!calls.is_empty());
        assert!(calls.iter().all(|call| call.starts_with("GET ")));
        Ok(())
    }

    /// Decision 3: Check access lists every identity the provider holds,
    /// one that keeps no vault there included.
    #[wasm_bindgen_test]
    async fn the_current_provider_reports_an_identity_that_files_no_vault() -> anyhow::Result<()> {
        let root = "<ListBucketResult><IsTruncated>false</IsTruncated>\
             <CommonPrefixes><Prefix>e2e/meta-secret-nook/idn_abcdefghijk/</Prefix></CommonPrefixes>\
             </ListBucketResult>";
        let identity_folder = "<ListBucketResult><IsTruncated>false</IsTruncated>\
             <CommonPrefixes><Prefix>e2e/meta-secret-nook/idn_abcdefghijk/log/</Prefix></CommonPrefixes>\
             </ListBucketResult>";
        let empty = "<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>";
        let listing = |contains: &str, body: &str| FetchRoute {
            method: "GET",
            url_contains: contains.to_owned(),
            status: 200,
            body: body.to_owned(),
        };
        // The vault namespaces, then the identity namespaces, each read from
        // the root and the identity folder; then the identity log's events.
        let _stub = FetchStub::install(vec![
            listing("prefix=e2e%2Fmeta-secret-nook%2F", root),
            listing(
                "prefix=e2e%2Fmeta-secret-nook%2Fidn_abcdefghijk%2F",
                identity_folder,
            ),
            listing("prefix=e2e%2Fmeta-secret-nook%2F", root),
            listing(
                "prefix=e2e%2Fmeta-secret-nook%2Fidn_abcdefghijk%2F",
                identity_folder,
            ),
            listing("idn_abcdefghijk%2Flog%2F", empty),
        ])?;
        let mut manager = NookVaultManager::new();
        manager.storage.provider = PreparedProvider::s3_fixture(WasmFixture::s3_connection()?);
        let contents = manager
            .provider_source_contents(&NookProviderSource::CurrentProvider)
            .await?;
        assert!(contents.vaults.is_empty());
        let identities: Vec<&str> = contents
            .identity_logs
            .iter()
            .map(|log| log.identity_id.as_str())
            .collect();
        assert_eq!(identities, ["idn_abcdefghijk"]);
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn a_session_without_a_sync_provider_has_nothing_to_check() -> anyhow::Result<()> {
        let manager = NookVaultManager::new();

        let source = NookProviderSource::CurrentProvider.encode()?;
        let report: CredentialCheckReport = manager
            .check_backup_password_access_from(&source, "any".to_owned())
            .await
            .map_err(|error| anyhow::anyhow!("check backup password: {error:?}"))?
            .decode()?;

        assert!(report.identities.is_empty());
        Ok(())
    }
}

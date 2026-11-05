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
use nook_core::CredentialCheckReport;
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

use serde::{Deserialize, Serialize};
use tsify::Tsify;

use super::{NookVaultManager, PreparedProvider};
use crate::NookError;
use crate::public_api::NookRemoteSource;
use crate::storage::provider_vault_listing::SourceContents;

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
        match (source, &self.storage.provider) {
            // This browser's own store is no provider: nothing to check.
            (NookProviderSource::CurrentProvider, PreparedProvider::ThisBrowser) => {
                Ok(SourceContents::empty())
            }
            (NookProviderSource::CurrentProvider, PreparedProvider::Remote(remote)) => {
                remote.location().contents().await
            }
            (NookProviderSource::Remote(source), _) => source.open().await?.contents().await,
        }
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
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use super::*;
    use crate::manager::PreparedProvider;
    use crate::public_api::{NookAccessCheckSource, NookRemoteSource};
    use crate::storage::fetch_stub::{FetchRoute, FetchStub};
    use crate::test_fixtures::WasmFixture;
    use nook_core::DriveVaultFolderLookup;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    async fn a_drive_root_without_identities_holds_nothing_and_writes_nothing() -> anyhow::Result<()>
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
        let contents = NookAccessCheckSource::Remote(NookRemoteSource::GoogleDrive {
            access_token: WasmFixture::secret("drive-access-token")?,
        })
        .contents()
        .await?;

        assert!(contents.identity_logs.is_empty());
        assert!(contents.vaults.is_empty());
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

        let contents = manager
            .provider_source_contents(&NookProviderSource::CurrentProvider)
            .await?;

        assert!(contents.identity_logs.is_empty());
        assert!(contents.vaults.is_empty());
        Ok(())
    }
}

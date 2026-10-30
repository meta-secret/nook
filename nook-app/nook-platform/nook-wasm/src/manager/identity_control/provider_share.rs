//! The keyring's sync providers, handed from the web app to its other apps.
//!
//! After its providers change, the web app seals its remote providers to each
//! other app of the keyring (`keyring_provider_shares`), with each member's
//! key from the keyring's log, and posts them to the browser extension. The
//! extension takes the copy sealed to a key it holds
//! (`take_keyring_provider_shares`), locked or not: those providers replace
//! its remote ones, so an added provider arrives and a removed one goes.

use std::mem;

use nook_core::{
    ActiveVaultScope, AppId, AppKeyIdentityMembership, AuthProvidersSnapshotData,
    IdentityControlState, ProviderCredentialRejection, StorageProvider,
};
use serde::{Deserialize, Serialize};
use tsify::Tsify;
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

use super::{INVALID_TYPED_INPUT, UNENCODABLE_TYPED_OUTPUT};
use crate::manager::NookVaultManager;
use crate::storage::auth_providers::{
    PresealedProviderMerge, PresealedProviderSnapshotPublication,
};
use crate::storage::identity_record::StoredIdentityProtection;
use crate::{AuthProviderDatabase, NookDatabase};

/// The keyring's remote providers sealed to one of its apps.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct NookAppProviderShare {
    pub app_id: String,
    pub providers: Vec<StorageProvider>,
}

/// One copy of the keyring's remote providers per other app of the keyring.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct NookKeyringProviderShares {
    pub apps: Vec<NookAppProviderShare>,
}

/// Shares as the extension receives them over the website bridge, decoded
/// here; whatever is left of them is wiped once they are taken.
#[derive(Serialize, Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "unknown")]
pub struct NookKeyringProviderSharesAdmission(pub NookKeyringProviderShares);

impl Drop for NookKeyringProviderSharesAdmission {
    fn drop(&mut self) {
        for share in &mut self.0.apps {
            share
                .providers
                .iter_mut()
                .for_each(StorageProvider::zeroize_credentials);
        }
    }
}

#[wasm_bindgen]
impl NookVaultManager {
    /// This app's remote providers sealed to each other app of the keyring
    /// in use. A key with no keyring, or a keyring with no log yet, has no
    /// other apps to hand them to.
    #[wasm_bindgen]
    pub async fn keyring_provider_shares(
        &self,
    ) -> Result<tsify::Ts<NookKeyringProviderShares>, JsError> {
        let app_key = self.unlocked_app_key()?;
        let membership = NookDatabase::load_identity_directory()
            .await?
            .identity_for_app_key(&app_key)
            .map_err(NookDatabase::map_domain_error)?;
        let mut apps = Vec::new();
        if let AppKeyIdentityMembership::Enrolled(identity_id) = membership {
            let log = NookDatabase::load_identity_log(&identity_id).await?;
            if !log.is_empty() {
                let state = IdentityControlState::project(&log).map_err(crate::NookError::from)?;
                let shares = AuthProviderDatabase::load_auth_providers(&app_key)
                    .await?
                    .shares_for_keyring_apps(&state, app_key.app_id())
                    .map_err(ProviderCredentialRejection::into_cause)?;
                apps = shares
                    .into_iter()
                    .map(|share| NookAppProviderShare {
                        app_id: share.app_id.as_str().to_owned(),
                        providers: share.providers,
                    })
                    .collect();
            }
        }
        Tsify::into_ts(&NookKeyringProviderShares { apps })
            .map_err(|_| JsError::new(UNENCODABLE_TYPED_OUTPUT))
    }

    /// Take the copies sealed to an app key this installation holds; the
    /// keyring's other apps' copies are not for it. Returns how many
    /// providers it took: none when no copy was for it, or when the keyring
    /// has no remote provider left.
    #[wasm_bindgen]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the count of providers taken as a JavaScript Number scalar"
        )
    )]
    pub async fn take_keyring_provider_shares(
        &self,
        shares: &tsify::Ts<NookKeyringProviderSharesAdmission>,
    ) -> Result<u32, JsError> {
        let mut shares = shares
            .to_rust()
            .map_err(|_| JsError::new(INVALID_TYPED_INPUT))?;
        let mut taken = 0_usize;
        for share in &mut shares.0.apps {
            let app_id = AppId::parse(&share.app_id)?;
            if matches!(
                NookDatabase::load_entry_for_app_id(&app_id).await?,
                StoredIdentityProtection::Unprotected
            ) {
                continue;
            }
            let mut snapshot = AuthProvidersSnapshotData {
                providers: mem::take(&mut share.providers),
                active_vault_store_id: ActiveVaultScope::Unselected,
            };
            let saved = PresealedProviderSnapshotPublication {
                app_id: &app_id,
                snapshot: &snapshot,
                merge: PresealedProviderMerge::KeyringProviders,
            }
            .save()
            .await;
            snapshot
                .providers
                .iter_mut()
                .for_each(StorageProvider::zeroize_credentials);
            saved?;
            taken += snapshot.providers.len();
        }
        u32::try_from(taken).map_err(|_| JsError::new(UNENCODABLE_TYPED_OUTPUT))
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use super::*;
    use crate::storage::auth_providers::ProviderSnapshotPublication;
    use nook_core::{AppKey, SigningIdentity, StoredGithubPat};
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    fn js<T>(result: Result<T, JsError>) -> anyhow::Result<T> {
        result.map_err(|error| anyhow::anyhow!("{error:?}"))
    }

    fn github(id: &str, pat: &str) -> StorageProvider {
        StorageProvider::github(id, "GitHub", pat, "owner/nook", "2026-10-29T00:00:00Z")
    }

    fn local_row() -> StorageProvider {
        let mut row = github("local", "");
        row.provider_type = nook_core::StorageProviderType::Local;
        row
    }

    async fn unlocked_web_app() -> anyhow::Result<NookVaultManager> {
        let mut manager = NookVaultManager::new();
        js(manager.delete_local_browser_data().await)?;
        js(manager
            .finish_pin_device_protection("web app pin".to_owned())
            .await)?;
        Ok(manager)
    }

    async fn save(
        manager: &NookVaultManager,
        providers: Vec<StorageProvider>,
    ) -> anyhow::Result<()> {
        ProviderSnapshotPublication {
            identity: &manager.device_identity()?,
            snapshot: &AuthProvidersSnapshotData {
                providers,
                active_vault_store_id: ActiveVaultScope::Unselected,
            },
        }
        .save()
        .await?;
        Ok(())
    }

    async fn shares(manager: &NookVaultManager) -> anyhow::Result<NookKeyringProviderShares> {
        js(manager.keyring_provider_shares().await)?
            .to_rust()
            .map_err(|error| anyhow::anyhow!("{error:?}"))
    }

    #[wasm_bindgen_test]
    async fn the_web_app_seals_its_remote_providers_to_the_extension_it_added() -> anyhow::Result<()>
    {
        let mut manager = unlocked_web_app().await?;
        save(
            &manager,
            vec![local_row(), github("github", "github_pat_11SHARE")],
        )
        .await?;
        // A key with no keyring log yet has no other apps.
        assert!(shares(&manager).await?.apps.is_empty());

        js(manager.ensure_identity_control_log().await)?;
        let extension = AppKey::generate()?;
        js(manager
            .add_identity_member(
                extension.app_id().to_string(),
                extension.public_key().to_string(),
                SigningIdentity::generate()?.0.public_key().to_string(),
                "Nook Extension".to_owned(),
            )
            .await)?;

        let shared = shares(&manager).await?;
        assert_eq!(shared.apps.len(), 1);
        let share = &shared.apps[0];
        assert_eq!(share.app_id, extension.app_id().as_str());
        assert_eq!(share.providers.len(), 1);
        assert_ne!(
            share.providers[0].github_pat,
            StoredGithubPat::Token("github_pat_11SHARE".to_owned())
        );
        let opened = AuthProvidersSnapshotData {
            providers: share.providers.clone(),
            active_vault_store_id: ActiveVaultScope::Unselected,
        }
        .open_credentials(&extension)
        .map_err(ProviderCredentialRejection::into_cause)?;
        assert_eq!(
            opened.providers[0].github_pat,
            StoredGithubPat::Token("github_pat_11SHARE".to_owned())
        );
        js(manager.delete_local_browser_data().await)?;
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn the_extension_takes_only_its_own_copy_and_a_removal_reaches_it() -> anyhow::Result<()>
    {
        let mut manager = unlocked_web_app().await?;
        let held = manager.device_identity()?;
        save(&manager, vec![local_row(), github("old", "github_pat_old")]).await?;
        let other = AppKey::generate()?;
        let sealed_to = |key: &AppKey, providers: Vec<StorageProvider>| {
            AuthProvidersSnapshotData {
                providers,
                active_vault_store_id: ActiveVaultScope::Unselected,
            }
            .seal_credentials_for(&key.public_key())
            .map(|sealed| sealed.providers)
            .map_err(ProviderCredentialRejection::into_cause)
        };
        let handed = NookKeyringProviderShares {
            apps: vec![
                NookAppProviderShare {
                    app_id: other.app_id().as_str().to_owned(),
                    providers: sealed_to(&other, vec![github("drive", "for-the-other-app")])?,
                },
                NookAppProviderShare {
                    app_id: held.app_id().as_str().to_owned(),
                    providers: sealed_to(&held, vec![github("added", "github_pat_added")])?,
                },
            ],
        };

        assert_eq!(
            js(manager
                .take_keyring_provider_shares(&Tsify::into_ts(
                    &NookKeyringProviderSharesAdmission(handed)
                )?)
                .await)?,
            1
        );

        let stored = AuthProviderDatabase::load_auth_providers(&held).await?;
        let ids: Vec<&str> = stored.providers.iter().map(|row| row.id.as_str()).collect();
        assert_eq!(ids, vec!["local", "added"]);
        assert_eq!(
            stored.providers[1].github_pat,
            StoredGithubPat::Token("github_pat_added".to_owned())
        );
        assert!(
            AuthProviderDatabase::load_auth_providers(&other)
                .await?
                .providers
                .is_empty()
        );

        // The web app removed its last remote provider.
        let removed = NookKeyringProviderShares {
            apps: vec![NookAppProviderShare {
                app_id: held.app_id().as_str().to_owned(),
                providers: Vec::new(),
            }],
        };
        assert_eq!(
            js(manager
                .take_keyring_provider_shares(&Tsify::into_ts(
                    &NookKeyringProviderSharesAdmission(removed)
                )?)
                .await)?,
            0
        );
        let stored = AuthProviderDatabase::load_auth_providers(&held).await?;
        let ids: Vec<&str> = stored.providers.iter().map(|row| row.id.as_str()).collect();
        assert_eq!(ids, vec!["local"]);
        js(manager.delete_local_browser_data().await)?;
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn plaintext_providers_are_refused() -> anyhow::Result<()> {
        let mut manager = unlocked_web_app().await?;
        let held = manager.device_identity()?;
        let plaintext = NookKeyringProviderShares {
            apps: vec![NookAppProviderShare {
                app_id: held.app_id().as_str().to_owned(),
                providers: vec![github("github", "github_pat_plaintext")],
            }],
        };

        assert!(
            manager
                .take_keyring_provider_shares(&Tsify::into_ts(
                    &NookKeyringProviderSharesAdmission(plaintext)
                )?)
                .await
                .is_err()
        );
        assert!(
            AuthProviderDatabase::load_auth_providers(&held)
                .await?
                .providers
                .is_empty()
        );
        js(manager.delete_local_browser_data().await)?;
        Ok(())
    }
}

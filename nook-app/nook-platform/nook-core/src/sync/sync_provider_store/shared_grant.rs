//! Full provider selection avoids a second host lookup after Rust grants eligibility.
use super::{AuthProvidersSnapshotData, SharedGrantProviderSelection, StorageProviderData};
use crate::{OauthFilePreset, SharedStorageTargetSelection};
use serde::{Deserialize, Serialize};
use tsify::Tsify;

#[derive(Debug, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct SharedGrantProviderRequest {
    pub snapshot: AuthProvidersSnapshotData,
    pub preset: OauthFilePreset,
    pub target: SharedStorageTargetSelection,
}
#[derive(Debug, Serialize, Deserialize, Tsify)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
#[expect(
    clippy::large_enum_variant,
    reason = "the typed WASM result preserves the provider's existing wire shape"
)]
pub enum SharedGrantProviderOutcome {
    AuthorizationRequired,
    Existing { provider: StorageProviderData },
}
impl SharedGrantProviderRequest {
    #[must_use]
    pub fn select(self) -> SharedGrantProviderOutcome {
        SharedGrantProviderSelection {
            providers: &self.snapshot.providers,
            preset: self.preset,
            target: &self.target,
        }
        .resolve()
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn empty_catalog_requires_authorization_without_fake_selected_identifier() {
        let request = SharedGrantProviderRequest {
            snapshot: AuthProvidersSnapshotData::default(),
            preset: OauthFilePreset::GoogleDrive,
            target: SharedStorageTargetSelection::Create,
        };
        assert!(matches!(
            request.select(),
            SharedGrantProviderOutcome::AuthorizationRequired
        ));
    }
}

#[cfg(test)]
mod selection_tests {
    use super::*;
    use crate::{
        OAuthFileConfigData, StorageProviderType, StoredOAuthAccessCredential,
        StoredOAuthFileConfiguration,
    };
    #[test]
    fn returns_the_exact_selected_row_with_credentials_and_scope() -> anyhow::Result<()> {
        let mut row = StorageProviderData::github("selected", "Shared provider", "", "", "now");
        row.provider_type = StorageProviderType::OauthFile;
        row.oauth_file = StoredOAuthFileConfiguration::Configured(OAuthFileConfigData {
            preset: OauthFilePreset::GoogleDrive,
            access_token: StoredOAuthAccessCredential::AccessToken("credential".into()),
            ..Default::default()
        });
        let outcome = SharedGrantProviderRequest {
            snapshot: AuthProvidersSnapshotData {
                providers: vec![row.clone()],
                ..Default::default()
            },
            preset: OauthFilePreset::GoogleDrive,
            target: SharedStorageTargetSelection::Create,
        }
        .select();
        match outcome {
            SharedGrantProviderOutcome::Existing { provider } => assert_eq!(provider, row),
            SharedGrantProviderOutcome::AuthorizationRequired => {
                anyhow::bail!("eligible saved provider should be selected")
            }
        }
        Ok(())
    }
}

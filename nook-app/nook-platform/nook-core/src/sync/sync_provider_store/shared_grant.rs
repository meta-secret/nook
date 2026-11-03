//! Full provider selection avoids a second host lookup after Rust grants eligibility.
use crate::{
    AuthProvidersSnapshot, OAuthFilePreset, SharedGrantProviderSelection, StorageProvider,
};
use serde::{Deserialize, Serialize};
use tsify::Tsify;

/// A shared target a saved provider credential may reach: any target of the
/// preset, or one exact Drive folder or `CloudKit` share.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", content = "storageTargetId", rename_all = "camelCase")]
pub enum SharedStorageTargetSelection {
    Create,
    Existing(String),
}

#[derive(Debug, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct SharedGrantProviderRequest {
    pub snapshot: AuthProvidersSnapshot,
    pub preset: OAuthFilePreset,
    pub target: SharedStorageTargetSelection,
}
#[derive(Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SharedGrantProviderOutcome {
    AuthorizationRequired,
    Existing { provider: Box<StorageProvider> },
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
            snapshot: AuthProvidersSnapshot::default(),
            preset: OAuthFilePreset::GoogleDrive,
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
    use crate::StoredProvider;
    #[test]
    fn returns_the_exact_selected_row_with_credentials_and_scope() -> anyhow::Result<()> {
        let row = StorageProvider::fixture("selected", StoredProvider::google_drive_fixture()?);
        let outcome = SharedGrantProviderRequest {
            snapshot: AuthProvidersSnapshot {
                providers: vec![row.clone()],
                ..Default::default()
            },
            preset: OAuthFilePreset::GoogleDrive,
            target: SharedStorageTargetSelection::Create,
        }
        .select();
        match outcome {
            SharedGrantProviderOutcome::Existing { provider } => {
                assert_eq!(provider.as_ref(), &row);
            }
            SharedGrantProviderOutcome::AuthorizationRequired => {
                anyhow::bail!("eligible saved provider should be selected")
            }
        }
        Ok(())
    }
}

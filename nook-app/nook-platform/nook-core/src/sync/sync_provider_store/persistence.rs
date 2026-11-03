//! Pure draft-versus-persisted provider reconciliation, independent of browser storage.
use crate::{AuthProvidersSnapshot, StoredProvider};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use tsify::Tsify;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub enum AuthProviderPersistenceMode {
    Replace,
    PreserveUnlistedSyncProviders,
}
#[derive(Debug, Clone, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct AuthProviderPersistenceRequest {
    pub snapshot: AuthProvidersSnapshot,
    pub mode: AuthProviderPersistenceMode,
}
impl AuthProvidersSnapshot {
    #[must_use]
    pub fn preserve_unlisted_sync_providers(mut self, stored: &Self) -> Self {
        let draft_ids: HashSet<_> = self
            .providers
            .iter()
            .map(|provider| provider.id.clone())
            .collect();
        self.providers.extend(
            stored
                .providers
                .iter()
                .filter(|provider| {
                    !matches!(provider.provider, StoredProvider::Local {})
                        && !draft_ids.contains(&provider.id)
                })
                .cloned(),
        );
        self
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::{ProviderKind, StorageProvider};

    #[test]
    fn draft_order_and_replacements_win_without_reviving_local_rows() -> anyhow::Result<()> {
        let draft = AuthProvidersSnapshot {
            providers: vec![StorageProvider::fixture(
                "draft",
                StoredProvider::github_fixture()?,
            )],
            ..Default::default()
        };
        let stored = AuthProvidersSnapshot {
            providers: vec![
                StorageProvider::fixture("local", StoredProvider::Local {}),
                StorageProvider::fixture("draft", StoredProvider::google_drive_fixture()?),
                StorageProvider::fixture("remote", StoredProvider::github_fixture()?),
            ],
            ..Default::default()
        };
        let merged = draft.preserve_unlisted_sync_providers(&stored);
        assert_eq!(
            merged
                .providers
                .iter()
                .map(|row| row.id.as_str())
                .collect::<Vec<_>>(),
            vec!["draft", "remote"]
        );
        assert_eq!(
            merged.providers.first().map(StorageProvider::kind),
            Some(ProviderKind::Github)
        );
        Ok(())
    }
}

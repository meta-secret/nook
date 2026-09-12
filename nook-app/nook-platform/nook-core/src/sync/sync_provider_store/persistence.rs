//! Pure draft-versus-persisted provider reconciliation, independent of browser storage.
use super::{AuthProvidersSnapshotData, StorageProviderType};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use tsify::Tsify;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum AuthProviderPersistenceMode {
    Replace,
    PreserveUnlistedSyncProviders,
}
#[derive(Debug, Clone, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct AuthProviderPersistenceRequest {
    pub snapshot: AuthProvidersSnapshotData,
    pub mode: AuthProviderPersistenceMode,
}
impl AuthProvidersSnapshotData {
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
                    provider.provider_type != StorageProviderType::Local
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
    use crate::StorageProviderData;
    struct Fixture;
    impl Fixture {
        fn row(id: &str, provider_type: StorageProviderType) -> StorageProviderData {
            let mut row = StorageProviderData::github(id, "Provider", "token", "owner/repo", "now");
            row.provider_type = provider_type;
            row
        }
    }
    #[test]
    fn draft_order_and_replacements_win_without_reviving_local_rows() {
        let draft = AuthProvidersSnapshotData {
            providers: vec![Fixture::row("draft", StorageProviderType::Github)],
            ..Default::default()
        };
        let stored = AuthProvidersSnapshotData {
            providers: vec![
                Fixture::row("local", StorageProviderType::Local),
                Fixture::row("draft", StorageProviderType::OauthFile),
                Fixture::row("remote", StorageProviderType::Github),
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
            merged
                .providers
                .first()
                .map(|provider| provider.provider_type),
            Some(StorageProviderType::Github)
        );
    }
}

//! Decoding of the persisted provider snapshot.
use crate::AuthProvidersSnapshot;
use serde_json::Value;

impl AuthProvidersSnapshot {
    /// Decode a stored snapshot. Nothing stored yet is an empty snapshot;
    /// anything else must be the current tagged wire shape.
    pub fn from_storage(raw: Value) -> serde_json::Result<Self> {
        match raw {
            Value::Null => Ok(Self::default()),
            raw => serde_json::from_value(raw),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{ActiveVaultScope, StorageProvider, StoredProvider};
    use serde_json::json;

    #[test]
    fn nothing_stored_is_an_empty_snapshot() -> anyhow::Result<()> {
        assert_eq!(
            AuthProvidersSnapshot::from_storage(Value::Null)?,
            AuthProvidersSnapshot::default()
        );
        Ok(())
    }

    #[test]
    fn stored_snapshots_round_trip_and_other_shapes_are_rejected() -> anyhow::Result<()> {
        let snapshot = AuthProvidersSnapshot {
            providers: vec![StorageProvider::fixture(
                "first",
                StoredProvider::github_fixture()?,
            )],
            active_vault_store_id: ActiveVaultScope::StoreId(" vault ".to_owned()),
        };
        assert_eq!(
            AuthProvidersSnapshot::from_storage(serde_json::to_value(&snapshot)?)?,
            snapshot
        );
        for raw in [
            json!({"providers": [], "activeVaultStoreId": "vault-1"}),
            json!({"providers": [{"id": "x", "type": "github", "githubPat": "pat"}]}),
            json!({"providers": false}),
            json!(17),
        ] {
            assert!(AuthProvidersSnapshot::from_storage(raw).is_err());
        }
        Ok(())
    }
}

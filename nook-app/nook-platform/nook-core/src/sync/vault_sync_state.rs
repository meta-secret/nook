//! Portable state contracts for vault synchronization workflows.

use serde::{Deserialize, Serialize};

/// Unix timestamp in milliseconds for a completed vault synchronization.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct VaultSyncUnixMilliseconds(u64);

impl From<u64> for VaultSyncUnixMilliseconds {
    fn from(value: u64) -> Self {
        Self(value)
    }
}

impl From<VaultSyncUnixMilliseconds> for u64 {
    fn from(value: VaultSyncUnixMilliseconds) -> Self {
        value.0
    }
}

/// Most recent successful vault synchronization observed by the host.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum VaultLastSync {
    #[default]
    NeverSynced,
    Synced {
        at_unix_milliseconds: VaultSyncUnixMilliseconds,
    },
}

/// Foreground provider synchronization selected by the user.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum ManualProviderSync {
    #[default]
    Idle,
    Running {
        provider_id: String,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sync_states_keep_variant_owned_data() {
        let last_sync = VaultLastSync::Synced {
            at_unix_milliseconds: 1_754_041_200_000.into(),
        };
        assert!(matches!(
            last_sync,
            VaultLastSync::Synced {
                at_unix_milliseconds
            } if u64::from(at_unix_milliseconds) == 1_754_041_200_000
        ));

        let manual_sync = ManualProviderSync::Running {
            provider_id: "provider-1".to_owned(),
        };
        assert!(matches!(
            manual_sync,
            ManualProviderSync::Running { provider_id } if provider_id == "provider-1"
        ));
    }

    #[test]
    fn sync_timestamp_preserves_scalar_serialization() -> serde_json::Result<()> {
        let timestamp = VaultSyncUnixMilliseconds::from(1_754_041_200_000);
        let encoded = serde_json::to_string(&timestamp)?;
        assert_eq!(encoded, "1754041200000");
        assert_eq!(
            serde_json::from_str::<VaultSyncUnixMilliseconds>(&encoded)?,
            timestamp
        );
        Ok(())
    }

    #[test]
    fn sync_states_have_explicit_initial_variants() {
        assert_eq!(VaultLastSync::default(), VaultLastSync::NeverSynced);
        assert_eq!(ManualProviderSync::default(), ManualProviderSync::Idle);
    }
}

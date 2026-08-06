//! Portable state contracts for vault synchronization workflows.

/// Most recent successful vault synchronization observed by the host.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum VaultLastSync {
    #[default]
    NeverSynced,
    Synced {
        at_unix_milliseconds: u64,
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

/// Whether a staged synchronization conflict still needs a user decision.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum SyncConflictReview<T> {
    #[default]
    Clear,
    RequiresDecision(T),
}

/// Details of a local-folder provider that contains more than one vault log.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalFolderMultipleVaultsIssue {
    pub provider_id: String,
    pub provider_label: String,
    pub store_ids: Vec<String>,
    pub message: String,
}

/// Health of the currently staged local-folder provider.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum LocalFolderHealth {
    #[default]
    Healthy,
    MultipleVaults(LocalFolderMultipleVaultsIssue),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sync_states_keep_variant_owned_data() {
        let last_sync = VaultLastSync::Synced {
            at_unix_milliseconds: 1_754_041_200_000,
        };
        assert!(matches!(
            last_sync,
            VaultLastSync::Synced {
                at_unix_milliseconds: 1_754_041_200_000
            }
        ));

        let manual_sync = ManualProviderSync::Running {
            provider_id: "provider-1".to_owned(),
        };
        assert!(matches!(
            manual_sync,
            ManualProviderSync::Running { provider_id } if provider_id == "provider-1"
        ));

        let review = SyncConflictReview::RequiresDecision("conflict-1".to_owned());
        assert!(matches!(
            review,
            SyncConflictReview::RequiresDecision(conflict) if conflict == "conflict-1"
        ));

        let health = LocalFolderHealth::MultipleVaults(LocalFolderMultipleVaultsIssue {
            provider_id: "folder-1".to_owned(),
            provider_label: "Backups".to_owned(),
            store_ids: vec!["store-a".to_owned(), "store-b".to_owned()],
            message: "Choose a dedicated folder".to_owned(),
        });
        assert!(matches!(
            health,
            LocalFolderHealth::MultipleVaults(LocalFolderMultipleVaultsIssue {
                provider_id,
                store_ids,
                ..
            }) if provider_id == "folder-1" && store_ids.len() == 2
        ));
    }

    #[test]
    fn sync_states_have_explicit_initial_variants() {
        assert_eq!(VaultLastSync::default(), VaultLastSync::NeverSynced);
        assert_eq!(ManualProviderSync::default(), ManualProviderSync::Idle);
        assert_eq!(
            SyncConflictReview::<String>::default(),
            SyncConflictReview::Clear
        );
        assert_eq!(LocalFolderHealth::default(), LocalFolderHealth::Healthy);
    }
}

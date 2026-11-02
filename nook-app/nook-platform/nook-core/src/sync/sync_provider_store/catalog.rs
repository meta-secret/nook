#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]

use crate::{
    ActiveVaultScope, AuthProvidersSnapshot, DuplicateSyncProvider, ProviderId,
    ProviderLabelLabels, ProviderStorageDetailLabels, ProviderTargetKey, ProviderVaultScope,
    StorageProvider, StoredProvider,
};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DuplicateCandidatePolicy {
    IncludeAll,
    Exclude(ProviderId),
}

pub struct DuplicateProviderSelection<'a> {
    pub providers: &'a [StorageProvider],
    pub candidate: &'a StorageProvider,
    pub policy: DuplicateCandidatePolicy,
}

#[derive(Clone, Copy)]
pub struct LocalProviderRowRequest<'a> {
    pub active_store_id: &'a ActiveVaultScope,
    pub new_id: &'a str,
    pub created_at: &'a str,
}

impl StorageProvider {
    #[must_use]
    pub fn storage_detail(&self, labels: &ProviderStorageDetailLabels) -> String {
        self.provider.storage_detail(labels)
    }

    #[must_use]
    pub fn target_key(&self) -> ProviderTargetKey {
        self.provider.target_key()
    }
}

impl ProviderLabelLabels {
    #[must_use]
    pub fn localize(&self, label: &str) -> String {
        let labels = self;
        if label == "This device" {
            return labels.this_device.clone();
        }
        if label == "GitHub" {
            return labels.github.clone();
        }
        if label == "Local backup" {
            return labels.local_folder.clone();
        }
        if let Some(directory) = label.strip_prefix("Local backup · ") {
            return format!("{} · {directory}", labels.local_folder);
        }
        if let Some(file) = label.strip_prefix("Google Drive · ") {
            return format!("{} · {file}", labels.google_drive);
        }
        if label == "Google Drive" {
            return labels.google_drive.clone();
        }
        if let Some(file) = label.strip_prefix("iCloud · ") {
            return format!("{} · {file}", labels.icloud);
        }
        if label == "iCloud" {
            return labels.icloud.clone();
        }
        if let Some(repo) = label.strip_prefix("GitHub · ") {
            return format!("{} · {repo}", labels.github);
        }
        label.to_owned()
    }
}

impl DuplicateProviderSelection<'_> {
    /// The first row, outside the excluded one, with the candidate's target.
    #[must_use]
    pub fn find(self) -> DuplicateSyncProvider {
        let Self {
            providers,
            candidate,
            policy,
        } = self;
        let candidate_key = candidate.target_key();
        match providers.iter().find(|provider| {
            if let DuplicateCandidatePolicy::Exclude(excluded) = &policy
                && provider.id == excluded.as_str()
            {
                return false;
            }
            provider.target_key() == candidate_key
        }) {
            Some(provider) => DuplicateSyncProvider::Duplicate {
                provider: Box::new(provider.clone()),
            },
            None => DuplicateSyncProvider::Unique,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LocalProviderRowChange {
    Present,
    Inserted,
}

pub struct LocalProviderRowOutcome {
    pub snapshot: AuthProvidersSnapshot,
    pub change: LocalProviderRowChange,
}

impl AuthProvidersSnapshot {
    /// Seed this browser's row for the active vault unless one is there.
    #[must_use]
    pub fn ensure_local_row(
        mut self,
        request: LocalProviderRowRequest<'_>,
    ) -> LocalProviderRowOutcome {
        let LocalProviderRowRequest {
            active_store_id,
            new_id,
            created_at,
        } = request;
        let store_id = match active_store_id {
            ActiveVaultScope::StoreId(id) if !id.trim().is_empty() => {
                ProviderVaultScope::StoreId(id.trim().to_owned())
            }
            ActiveVaultScope::StoreId(_) | ActiveVaultScope::Unselected => {
                match &self.active_vault_store_id {
                    ActiveVaultScope::StoreId(id) if !id.trim().is_empty() => {
                        ProviderVaultScope::StoreId(id.trim().to_owned())
                    }
                    ActiveVaultScope::StoreId(_) | ActiveVaultScope::Unselected => {
                        ProviderVaultScope::Unscoped
                    }
                }
            }
        };
        let has_local_for_vault = self.providers.iter().any(|provider| {
            matches!(provider.provider, StoredProvider::Local {})
                && match (&store_id, &provider.store_id) {
                    (ProviderVaultScope::Unscoped, _) | (_, ProviderVaultScope::Unscoped) => true,
                    (
                        ProviderVaultScope::StoreId(active),
                        ProviderVaultScope::StoreId(existing),
                    ) => existing.trim().is_empty() || active == existing.trim(),
                }
        });
        if has_local_for_vault {
            return LocalProviderRowOutcome {
                snapshot: self,
                change: LocalProviderRowChange::Present,
            };
        }
        self.providers.insert(
            0,
            StorageProvider::never_synced(
                new_id.to_owned(),
                store_id,
                created_at.to_owned(),
                StoredProvider::Local {},
            ),
        );
        LocalProviderRowOutcome {
            snapshot: self,
            change: LocalProviderRowChange::Inserted,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::slice;

    use super::{
        DuplicateCandidatePolicy, DuplicateProviderSelection, LocalProviderRowChange,
        LocalProviderRowOutcome, LocalProviderRowRequest,
    };
    use crate::{
        ActiveVaultScope, AuthProvidersSnapshot, DuplicateSyncProvider, GithubProvider,
        OAuthAccountIdentity, OAuthFileProvider, ProviderLabelLabels, ProviderStorageDetailLabels,
        ProviderVaultScope, S3Connection, S3ConnectionDraft, StorageProvider, StoredProvider,
    };

    impl ProviderLabelLabels {
        fn catalog_fixture() -> Self {
            Self {
                this_device: "This device localized".to_owned(),
                github: "GitHub localized".to_owned(),
                local_folder: "Local folder localized".to_owned(),
                google_drive: "Google Drive localized".to_owned(),
                icloud: "iCloud localized".to_owned(),
            }
        }
    }

    fn github(id: &str, repository: &str, token: &str) -> anyhow::Result<StorageProvider> {
        Ok(StorageProvider::fixture(
            id,
            StoredProvider::Github(GithubProvider::fixture(repository, token)?),
        ))
    }

    fn s3(
        id: &str,
        key_prefix: &str,
        access_key_id: &str,
        region: &str,
    ) -> anyhow::Result<StorageProvider> {
        let mut draft = S3ConnectionDraft::fixture();
        draft.key_prefix = key_prefix.to_owned();
        draft.access_key_id = access_key_id.to_owned();
        draft.region = region.to_owned();
        Ok(StorageProvider::fixture(
            id,
            StoredProvider::S3(S3Connection::try_from(draft)?),
        ))
    }

    fn duplicate_of(
        providers: &[StorageProvider],
        candidate: &StorageProvider,
    ) -> DuplicateSyncProvider {
        DuplicateProviderSelection {
            providers,
            candidate,
            policy: DuplicateCandidatePolicy::IncludeAll,
        }
        .find()
    }

    #[test]
    fn duplicate_selection_returns_the_first_row_outside_the_excluded_one() -> anyhow::Result<()> {
        let first = github("gh-1", "Team-Vault", "token")?;
        let second = github("gh-2", "team-vault", "token")?;
        let providers = vec![first.clone(), second.clone()];
        assert_eq!(
            duplicate_of(&providers, &second),
            DuplicateSyncProvider::Duplicate {
                provider: Box::new(first)
            }
        );
        assert_eq!(
            DuplicateProviderSelection {
                providers: &providers,
                candidate: &second,
                policy: DuplicateCandidatePolicy::Exclude("gh-1".into()),
            }
            .find(),
            DuplicateSyncProvider::Duplicate {
                provider: Box::new(second.clone())
            }
        );
        assert_eq!(
            duplicate_of(&providers, &github("gh-3", "team-vault", "other-token")?),
            DuplicateSyncProvider::Unique
        );
        Ok(())
    }

    #[test]
    fn oauth_rows_match_by_target_and_account_and_folders_by_handle() -> anyhow::Result<()> {
        let drive = |folder: &str, account: &str| -> anyhow::Result<StorageProvider> {
            Ok(StorageProvider::fixture(
                "drive",
                StoredProvider::OauthFile(OAuthFileProvider::google_drive_fixture(
                    folder,
                    OAuthAccountIdentity::Email(account.to_owned()),
                )?),
            ))
        };
        let saved = drive("folder-1", "a@b.c")?;
        let rows = slice::from_ref(&saved);
        assert!(matches!(
            duplicate_of(rows, &drive("folder-1", "a@b.c")?),
            DuplicateSyncProvider::Duplicate { .. }
        ));
        for other in [drive("folder-2", "a@b.c")?, drive("folder-1", "b@b.c")?] {
            assert_eq!(duplicate_of(rows, &other), DuplicateSyncProvider::Unique);
        }
        let folder = StorageProvider::fixture("folder", StoredProvider::local_folder_fixture()?);
        assert!(matches!(
            duplicate_of(slice::from_ref(&folder), &folder),
            DuplicateSyncProvider::Duplicate { .. }
        ));
        Ok(())
    }

    #[test]
    fn s3_rows_are_one_target_per_location_whatever_key_or_region() -> anyhow::Result<()> {
        let existing = s3("s3-a", "team", "device-a", "us-east-1")?;
        let same_location = s3("s3-b", "team/", "device-b", "eu-west-1")?;
        assert!(matches!(
            duplicate_of(slice::from_ref(&existing), &same_location),
            DuplicateSyncProvider::Duplicate { provider } if provider.id == "s3-a"
        ));
        let bucket_root = s3("s3-c", "", "device-a", "us-east-1")?;
        assert_eq!(
            duplicate_of(slice::from_ref(&existing), &bucket_root),
            DuplicateSyncProvider::Unique
        );
        let labels = ProviderStorageDetailLabels::catalog_fixture();
        assert_eq!(
            existing.storage_detail(&labels),
            "127.0.0.1:8333 · device-a"
        );
        Ok(())
    }

    #[test]
    fn provider_label_localization_preserves_detail_suffixes() {
        let labels = ProviderLabelLabels::catalog_fixture();
        assert_eq!(labels.localize("This device"), "This device localized");
        assert_eq!(
            labels.localize("GitHub · team-vault"),
            "GitHub localized · team-vault"
        );
        assert_eq!(
            labels.localize("Local backup · Nook Backup"),
            "Local folder localized · Nook Backup"
        );
        assert_eq!(
            labels.localize("Google Drive · work.yaml"),
            "Google Drive localized · work.yaml"
        );
        assert_eq!(labels.localize("iCloud"), "iCloud localized");
        assert_eq!(labels.localize("Custom provider"), "Custom provider");
    }

    #[test]
    fn local_row_is_seeded_once_per_vault() -> anyhow::Result<()> {
        let snapshot = AuthProvidersSnapshot {
            providers: vec![github("gh", "nook", "pat")?],
            active_vault_store_id: ActiveVaultScope::Unselected,
        };
        let LocalProviderRowOutcome {
            snapshot: next,
            change,
        } = snapshot.ensure_local_row(LocalProviderRowRequest {
            active_store_id: &ActiveVaultScope::Unselected,
            new_id: "local-1",
            created_at: "2026-06-24T00:00:00.000Z",
        });
        assert_eq!(change, LocalProviderRowChange::Inserted);
        assert_eq!(next.providers.len(), 2);
        let Some(first) = next.providers.first() else {
            anyhow::bail!("the seeded row comes first");
        };
        assert_eq!(first.provider, StoredProvider::Local {});
        assert_eq!(first.label, "This device");

        let existing = AuthProvidersSnapshot {
            providers: vec![StorageProvider {
                store_id: ProviderVaultScope::StoreId("vault-1".to_owned()),
                ..first.clone()
            }],
            active_vault_store_id: ActiveVaultScope::StoreId("vault-1".to_owned()),
        };
        for (active_store_id, change) in [
            (
                ActiveVaultScope::Unselected,
                LocalProviderRowChange::Present,
            ),
            (
                ActiveVaultScope::StoreId(" ".to_owned()),
                LocalProviderRowChange::Present,
            ),
            (
                ActiveVaultScope::StoreId(" vault-1 ".to_owned()),
                LocalProviderRowChange::Present,
            ),
            (
                ActiveVaultScope::StoreId("vault-2".to_owned()),
                LocalProviderRowChange::Inserted,
            ),
        ] {
            let outcome = existing.clone().ensure_local_row(LocalProviderRowRequest {
                active_store_id: &active_store_id,
                new_id: "new",
                created_at: "time",
            });
            assert_eq!(outcome.change, change);
            assert_eq!(
                outcome.snapshot.active_vault_store_id,
                existing.active_vault_store_id
            );
            match change {
                LocalProviderRowChange::Inserted => {
                    assert_eq!(
                        outcome.snapshot.providers.first().map(|row| &row.store_id),
                        Some(&ProviderVaultScope::StoreId("vault-2".to_owned()))
                    );
                }
                LocalProviderRowChange::Present => assert_eq!(outcome.snapshot, existing),
            }
        }
        Ok(())
    }
}

//! Identity-scoped provider mounts: which local provider rows replicate the
//! identity control log and each owned vault, and at which remote namespace.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use nook_auth2::{IdentityId, StoreId};
use nook_event_log::{
    DriveMountTarget, EventLogLocation, ICloudMountTarget, IdentityMountTarget,
    IdentityProviderMount, ProviderMountId, ProviderMountLayout,
};

use super::{
    ProviderRowLayout, ProviderRows, ProviderVaultScope, StorageProviderData,
    StoredGithubRepository, StoredGoogleDriveFolder, StoredICloudShareTarget,
    StoredLocalFolderConfiguration, StoredLocalFolderDirectory, StoredOAuthFileConfiguration,
    StoredOAuthRemoteFileName,
};
use crate::{
    DEFAULT_DRIVE_BACKUP_NAME, DEFAULT_GITHUB_REPO_NAME, GoogleDriveMode, ICloudMode,
    OAuthFilePreset, StorageProviderType,
};

/// Prefix marking an identity namespaced row in the connect `repo` slot.
pub const IDENTITY_NAMESPACED_REF_PREFIX: &str = "identity-namespaced:";

/// A provider remote reference paired with the row layout it was built from.
///
/// The prefix keeps the WASM connect arguments a 3-tuple, as the Drive target
/// prefixes do. Rust produces and parses it; the web layer only forwards it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LayoutRemoteRef<'a> {
    pub layout: ProviderRowLayout,
    pub inner: &'a str,
}

impl<'a> LayoutRemoteRef<'a> {
    #[must_use]
    pub fn parse(raw: &'a str) -> Self {
        match raw.strip_prefix(IDENTITY_NAMESPACED_REF_PREFIX) {
            Some(inner) => Self {
                layout: ProviderRowLayout::IdentityNamespaced,
                inner,
            },
            None => Self {
                layout: ProviderRowLayout::LegacyVaultRoot,
                inner: raw,
            },
        }
    }

    #[must_use]
    pub fn format(self) -> String {
        match self.layout {
            ProviderRowLayout::IdentityNamespaced => {
                format!("{IDENTITY_NAMESPACED_REF_PREFIX}{}", self.inner)
            }
            ProviderRowLayout::LegacyVaultRoot => self.inner.to_owned(),
        }
    }
}

/// Whether a provider row can carry an identity's control log.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IdentityMountCapability {
    /// The row can replicate the identity log at its namespace.
    Mountable(IdentityMountTarget),
    /// Browser-local cache rows never leave this installation.
    LocalOnly,
    /// `CloudKit` cannot list a namespace until a record type for identity
    /// events is deployed to production. The row keeps replicating its vault.
    ICloudNamespaceUnavailable,
    /// A row without a resolvable remote target.
    Unconfigured,
}

/// One provider row and the namespace one event log uses there.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderReplicationTarget {
    pub provider: StorageProviderData,
    pub location: EventLogLocation,
}

impl StorageProviderData {
    /// Credential-free mount target of this row.
    #[must_use]
    pub fn identity_mount_capability(&self) -> IdentityMountCapability {
        match self.provider_type {
            StorageProviderType::Local => IdentityMountCapability::LocalOnly,
            StorageProviderType::Github => {
                IdentityMountCapability::Mountable(IdentityMountTarget::Github {
                    repository: match &self.github_repo {
                        StoredGithubRepository::Repository(repo) if !repo.trim().is_empty() => {
                            repo.trim().to_owned()
                        }
                        StoredGithubRepository::Repository(_)
                        | StoredGithubRepository::DefaultRepository => {
                            DEFAULT_GITHUB_REPO_NAME.to_owned()
                        }
                    },
                })
            }
            StorageProviderType::LocalFolder => match &self.local_folder {
                StoredLocalFolderConfiguration::Configured(config) => {
                    IdentityMountCapability::Mountable(IdentityMountTarget::LocalFolder {
                        directory_name: match &config.directory_name {
                            StoredLocalFolderDirectory::DirectoryName(name) => name.clone(),
                            StoredLocalFolderDirectory::Unnamed => String::new(),
                        },
                    })
                }
                StoredLocalFolderConfiguration::NotApplicable => {
                    IdentityMountCapability::Unconfigured
                }
            },
            StorageProviderType::OauthFile => match &self.oauth_file {
                StoredOAuthFileConfiguration::Configured(config) => match config.preset {
                    OAuthFilePreset::GoogleDrive => {
                        IdentityMountCapability::Mountable(IdentityMountTarget::GoogleDrive {
                            drive: match (config.resolved_google_drive_mode(), &config.folder_id) {
                                (
                                    GoogleDriveMode::Shared,
                                    StoredGoogleDriveFolder::FolderId(id),
                                ) => DriveMountTarget::Shared {
                                    folder_id: id.clone(),
                                },
                                (GoogleDriveMode::Shared, StoredGoogleDriveFolder::Root) => {
                                    return IdentityMountCapability::Unconfigured;
                                }
                                (GoogleDriveMode::Private, _) => DriveMountTarget::Private {
                                    folder_name: match &config.file_name {
                                        StoredOAuthRemoteFileName::FileName(name) => name.clone(),
                                        StoredOAuthRemoteFileName::Unresolved => {
                                            DEFAULT_DRIVE_BACKUP_NAME.to_owned()
                                        }
                                    },
                                },
                            },
                        })
                    }
                    OAuthFilePreset::ICloud => IdentityMountCapability::ICloudNamespaceUnavailable,
                },
                StoredOAuthFileConfiguration::NotApplicable => {
                    IdentityMountCapability::Unconfigured
                }
            },
        }
    }

    /// The iCloud routing a mount record would carry, for display only.
    #[must_use]
    pub fn icloud_mount_target(&self) -> Option<ICloudMountTarget> {
        let StoredOAuthFileConfiguration::Configured(config) = &self.oauth_file else {
            return None;
        };
        match (
            config.preset,
            config.resolved_icloud_mode(),
            &config.icloud_share_target,
        ) {
            (
                OAuthFilePreset::ICloud,
                ICloudMode::Shared,
                StoredICloudShareTarget::SharedTarget(target),
            ) => Some(ICloudMountTarget::Shared {
                share_target: target.clone(),
            }),
            (OAuthFilePreset::ICloud, _, _) => Some(ICloudMountTarget::Private),
            (OAuthFilePreset::GoogleDrive, _, _) => None,
        }
    }

    /// Where this row stores one vault's events, if it replicates that vault.
    #[must_use]
    pub fn vault_location(&self, store_id: &StoreId) -> Option<EventLogLocation> {
        if self.provider_type == StorageProviderType::Local {
            return None;
        }
        match (self.layout, &self.store_id) {
            (ProviderRowLayout::IdentityNamespaced, _) => {
                Some(EventLogLocation::Vault(store_id.clone()))
            }
            (ProviderRowLayout::LegacyVaultRoot, ProviderVaultScope::StoreId(bound))
                if bound.trim() == store_id.as_str() =>
            {
                Some(EventLogLocation::LegacyVaultRoot)
            }
            (ProviderRowLayout::LegacyVaultRoot, _) => None,
        }
    }

    /// The mount layout this row contributes to an identity log, if any.
    #[must_use]
    pub fn mount_layout(&self) -> Option<ProviderMountLayout> {
        match (self.layout, &self.store_id) {
            (ProviderRowLayout::IdentityNamespaced, _) => Some(ProviderMountLayout::Namespaced),
            (ProviderRowLayout::LegacyVaultRoot, ProviderVaultScope::StoreId(bound)) => {
                StoreId::parse(bound)
                    .ok()
                    .map(|store_id| ProviderMountLayout::LegacySingleVault { store_id })
            }
            (ProviderRowLayout::LegacyVaultRoot, ProviderVaultScope::Unscoped) => None,
        }
    }
}

impl ProviderRows<'_> {
    /// Rows that replicate one vault, each with the namespace it uses there.
    #[must_use]
    pub fn vault_replication(&self, store_id: &StoreId) -> Vec<ProviderReplicationTarget> {
        self.providers
            .iter()
            .filter_map(|provider| {
                provider
                    .vault_location(store_id)
                    .map(|location| ProviderReplicationTarget {
                        provider: provider.clone(),
                        location,
                    })
            })
            .collect()
    }

    /// Rows that replicate the identity control log. Every remote row that can
    /// list a namespace carries it, whatever vault its legacy root holds.
    #[must_use]
    pub fn identity_replication(&self, identity_id: &IdentityId) -> Vec<ProviderReplicationTarget> {
        self.providers
            .iter()
            .filter(|provider| {
                matches!(
                    provider.identity_mount_capability(),
                    IdentityMountCapability::Mountable(_)
                ) && provider.mount_layout().is_some()
            })
            .map(|provider| ProviderReplicationTarget {
                provider: provider.clone(),
                location: EventLogLocation::Identity(identity_id.clone()),
            })
            .collect()
    }

    /// Mount records for rows the identity log does not list yet. A row maps
    /// to an existing mount when their credential-free targets are equal.
    pub fn unrecorded_mounts(
        &self,
        recorded: &[IdentityProviderMount],
    ) -> nook_event_log::EventResult<Vec<IdentityProviderMount>> {
        let mut mounts: Vec<IdentityProviderMount> = Vec::new();
        for provider in self.providers {
            let (IdentityMountCapability::Mountable(target), Some(layout)) = (
                provider.identity_mount_capability(),
                provider.mount_layout(),
            ) else {
                continue;
            };
            let known = recorded
                .iter()
                .chain(mounts.iter())
                .any(|mount| mount.target == target && mount.layout == layout);
            if known {
                continue;
            }
            mounts.push(IdentityProviderMount {
                mount_id: ProviderMountId::generate()?,
                label: provider.label.clone(),
                target,
                layout,
            });
        }
        Ok(mounts)
    }

    /// Recorded mounts this installation has no credentials for yet.
    #[must_use]
    pub fn unconnected_mounts<'m>(
        &self,
        recorded: &'m [IdentityProviderMount],
    ) -> Vec<&'m IdentityProviderMount> {
        recorded
            .iter()
            .filter(|mount| {
                !self.providers.iter().any(|provider| {
                    provider.identity_mount_capability()
                        == IdentityMountCapability::Mountable(mount.target.clone())
                })
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::super::OAuthFileConfig;
    use super::*;
    use crate::{
        ActiveVaultScope, AuthProvidersSnapshotData, ProviderSyncCheckpoint, StoredGithubPat,
        StoredLocalFolderConfiguration, StoredOAuthFileConfiguration,
    };

    struct Row(StorageProviderData);

    impl Row {
        fn github(id: &str, repo: &str) -> Self {
            Self(StorageProviderData {
                id: id.to_owned(),
                provider_type: StorageProviderType::Github,
                label: format!("GitHub {repo}"),
                github_pat: StoredGithubPat::Token("pat".to_owned()),
                github_repo: StoredGithubRepository::Repository(repo.to_owned()),
                oauth_file: StoredOAuthFileConfiguration::NotApplicable,
                local_folder: StoredLocalFolderConfiguration::NotApplicable,
                store_id: ProviderVaultScope::Unscoped,
                layout: ProviderRowLayout::LegacyVaultRoot,
                sync_checkpoint: ProviderSyncCheckpoint::NeverSynced,
                created_at: "2026-10-12T00:00:00Z".to_owned(),
            })
        }

        fn icloud(id: &str) -> Self {
            let mut row = Self::github(id, "unused").0;
            row.provider_type = StorageProviderType::OauthFile;
            row.github_pat = StoredGithubPat::Missing;
            row.oauth_file = StoredOAuthFileConfiguration::configured(OAuthFileConfig {
                preset: OAuthFilePreset::ICloud,
                ..OAuthFileConfig::default()
            });
            Self(row)
        }

        fn local(id: &str) -> Self {
            let mut row = Self::github(id, "unused").0;
            row.provider_type = StorageProviderType::Local;
            Self(row)
        }

        fn bound_to(mut self, store_id: &StoreId) -> Self {
            self.0.store_id = ProviderVaultScope::StoreId(store_id.as_str().to_owned());
            self
        }

        fn namespaced(mut self) -> Self {
            self.0.layout = ProviderRowLayout::IdentityNamespaced;
            self
        }
    }

    fn ids(targets: &[ProviderReplicationTarget]) -> Vec<(&str, EventLogLocation)> {
        targets
            .iter()
            .map(|target| (target.provider.id.as_str(), target.location.clone()))
            .collect()
    }

    #[test]
    fn identity_mounts_replicate_every_vault_while_legacy_rows_keep_their_one_vault()
    -> anyhow::Result<()> {
        let personal = StoreId::generate()?;
        let work = StoreId::generate()?;
        let identity = IdentityId::generate()?;
        let providers = vec![
            Row::local("local").bound_to(&personal).0,
            Row::github("legacy", "owner/personal")
                .bound_to(&personal)
                .0,
            Row::github("mount", "owner/identity").namespaced().0,
            Row::github("unbound", "owner/unknown").0,
            Row::icloud("icloud").bound_to(&work).0,
        ];
        let rows = ProviderRows {
            providers: &providers,
        };

        assert_eq!(
            ids(&rows.vault_replication(&personal)),
            vec![
                ("legacy", EventLogLocation::LegacyVaultRoot),
                ("mount", EventLogLocation::Vault(personal.clone())),
            ]
        );
        assert_eq!(
            ids(&rows.vault_replication(&work)),
            vec![
                ("mount", EventLogLocation::Vault(work.clone())),
                ("icloud", EventLogLocation::LegacyVaultRoot),
            ]
        );
        // iCloud cannot list a namespace and an unbound legacy row has no
        // known vault, so neither carries the identity log.
        assert_eq!(
            ids(&rows.identity_replication(&identity)),
            vec![
                ("legacy", EventLogLocation::Identity(identity.clone())),
                ("mount", EventLogLocation::Identity(identity.clone())),
            ]
        );
        assert_eq!(
            Row::icloud("icloud").0.identity_mount_capability(),
            IdentityMountCapability::ICloudNamespaceUnavailable
        );
        assert_eq!(
            Row::local("local").0.identity_mount_capability(),
            IdentityMountCapability::LocalOnly
        );

        // The vault-scoped view used by the open vault includes identity mounts.
        let active = ProviderRows {
            providers: &providers,
        }
        .for_vault(&ActiveVaultScope::StoreId(work.as_str().to_owned()))
        .active();
        assert_eq!(
            active.iter().map(|row| row.id.as_str()).collect::<Vec<_>>(),
            vec!["mount", "icloud"]
        );
        Ok(())
    }

    #[test]
    fn migrated_rows_become_mount_records_once_and_joiners_see_unconnected_mounts()
    -> anyhow::Result<()> {
        let personal = StoreId::generate()?;
        let providers = vec![
            Row::local("local").0,
            Row::github("legacy", "owner/personal")
                .bound_to(&personal)
                .0,
            Row::github("mount", "owner/identity").namespaced().0,
            Row::icloud("icloud").bound_to(&personal).0,
        ];
        let rows = ProviderRows {
            providers: &providers,
        };
        let recorded = rows.unrecorded_mounts(&[])?;
        assert_eq!(recorded.len(), 2);
        assert_eq!(
            recorded
                .iter()
                .map(|mount| (&mount.target, &mount.layout))
                .collect::<Vec<_>>(),
            vec![
                (
                    &IdentityMountTarget::Github {
                        repository: "owner/personal".to_owned()
                    },
                    &ProviderMountLayout::LegacySingleVault {
                        store_id: personal.clone()
                    }
                ),
                (
                    &IdentityMountTarget::Github {
                        repository: "owner/identity".to_owned()
                    },
                    &ProviderMountLayout::Namespaced
                ),
            ]
        );
        assert!(rows.unrecorded_mounts(&recorded)?.is_empty());

        let joiner_rows = vec![Row::github("joined", "owner/identity").namespaced().0];
        let unconnected = ProviderRows {
            providers: &joiner_rows,
        }
        .unconnected_mounts(&recorded);
        assert_eq!(unconnected.len(), 1);
        assert_eq!(
            unconnected.first().map(|mount| &mount.target),
            Some(&IdentityMountTarget::Github {
                repository: "owner/personal".to_owned()
            })
        );
        Ok(())
    }

    #[test]
    fn namespaced_rows_are_withheld_from_the_rollback_projection() -> anyhow::Result<()> {
        let personal = StoreId::generate()?;
        let snapshot = AuthProvidersSnapshotData {
            providers: vec![
                Row::github("legacy", "owner/personal")
                    .bound_to(&personal)
                    .0,
                Row::github("mount", "owner/identity").namespaced().0,
            ],
            active_vault_store_id: ActiveVaultScope::Unselected,
        };
        let projected = serde_json::to_value(snapshot.legacy_storage_snapshot())?;
        let ids = projected
            .get("providers")
            .and_then(serde_json::Value::as_array)
            .ok_or_else(|| anyhow::anyhow!("rollback projection lists providers"))?
            .iter()
            .filter_map(|row| row.get("id").and_then(serde_json::Value::as_str))
            .collect::<Vec<_>>();
        assert_eq!(ids, vec!["legacy"]);
        Ok(())
    }
}

#[cfg(test)]
mod remote_ref_tests {
    use super::*;
    use crate::{ProviderSyncCheckpoint, StoredGithubPat, StoredOAuthFileConfiguration};

    #[test]
    fn namespaced_rows_mark_their_connect_ref_and_legacy_rows_stay_unchanged() -> anyhow::Result<()>
    {
        let mut row = StorageProviderData {
            id: "github".to_owned(),
            provider_type: StorageProviderType::Github,
            label: "GitHub".to_owned(),
            github_pat: StoredGithubPat::Token("pat".to_owned()),
            github_repo: StoredGithubRepository::Repository("owner/repo".to_owned()),
            oauth_file: StoredOAuthFileConfiguration::NotApplicable,
            local_folder: StoredLocalFolderConfiguration::NotApplicable,
            store_id: ProviderVaultScope::Unscoped,
            layout: ProviderRowLayout::LegacyVaultRoot,
            sync_checkpoint: ProviderSyncCheckpoint::NeverSynced,
            created_at: String::new(),
        };
        assert_eq!(row.connection_args()?.repo, "owner/repo");
        row.layout = ProviderRowLayout::IdentityNamespaced;
        let args = row.connection_args()?;
        assert_eq!(args.repo, "identity-namespaced:owner/repo");
        assert_eq!(
            LayoutRemoteRef::parse(&args.repo),
            LayoutRemoteRef {
                layout: ProviderRowLayout::IdentityNamespaced,
                inner: "owner/repo",
            }
        );
        assert_eq!(
            LayoutRemoteRef::parse("private-folder-v2:abc").layout,
            ProviderRowLayout::LegacyVaultRoot
        );
        Ok(())
    }
}

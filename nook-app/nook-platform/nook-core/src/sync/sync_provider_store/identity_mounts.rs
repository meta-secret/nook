//! Identity-scoped provider mounts: which local provider rows replicate the
//! identity control log and each owned vault, and at which remote namespace.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use nook_auth2::{IdentityId, StoreId};
use nook_event_log::{
    EventLogLocation, IdentityMountTarget, IdentityProviderMount, ProviderMountId,
};

use super::{
    ProviderRows, StorageProviderData, StoredGithubRepository, StoredGoogleDriveFolder,
    StoredICloudShareTarget, StoredLocalFolderConfiguration, StoredLocalFolderDirectory,
    StoredOAuthFileConfiguration,
};
use crate::{DEFAULT_GITHUB_REPO_NAME, OAuthFilePreset, StorageProviderType};

/// Whether a provider row can carry an identity's control log.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IdentityMountCapability {
    /// The row replicates the identity log and every vault at their
    /// namespaces.
    Mountable(IdentityMountTarget),
    /// Browser-local cache rows never leave this installation.
    LocalOnly,
    /// A row without a resolvable remote target.
    Unconfigured,
}

/// Whether another device can reach a provider row to join the identity.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeviceJoinReach {
    /// A cloud mount every app of the identity can reach.
    OtherDevices,
    /// The row lives on this device only.
    ThisDeviceOnly,
}

impl StorageProviderData {
    /// A joining app reads the identity log through a mount it can reach, so
    /// only cloud mounts carry joins. A local folder is chosen per
    /// installation.
    #[must_use]
    pub fn device_join_reach(&self) -> DeviceJoinReach {
        match self.identity_mount_capability() {
            IdentityMountCapability::Mountable(IdentityMountTarget::LocalFolder { .. })
            | IdentityMountCapability::LocalOnly
            | IdentityMountCapability::Unconfigured => DeviceJoinReach::ThisDeviceOnly,
            IdentityMountCapability::Mountable(_) => DeviceJoinReach::OtherDevices,
        }
    }
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
                    OAuthFilePreset::GoogleDrive => match &config.folder_id {
                        StoredGoogleDriveFolder::FolderId(id) if !id.trim().is_empty() => {
                            IdentityMountCapability::Mountable(IdentityMountTarget::GoogleDrive {
                                folder_id: id.trim().to_owned(),
                            })
                        }
                        StoredGoogleDriveFolder::FolderId(_) | StoredGoogleDriveFolder::Root => {
                            IdentityMountCapability::Unconfigured
                        }
                    },
                    OAuthFilePreset::ICloud => match &config.icloud_share_target {
                        StoredICloudShareTarget::SharedTarget(target)
                            if !target.trim().is_empty() =>
                        {
                            IdentityMountCapability::Mountable(IdentityMountTarget::ICloud {
                                share_target: target.trim().to_owned(),
                            })
                        }
                        StoredICloudShareTarget::SharedTarget(_)
                        | StoredICloudShareTarget::Unbound => IdentityMountCapability::Unconfigured,
                    },
                },
                StoredOAuthFileConfiguration::NotApplicable => {
                    IdentityMountCapability::Unconfigured
                }
            },
        }
    }

    /// Where this row stores one vault's events. Browser-local rows hold the
    /// vault in this browser's own store instead.
    #[must_use]
    pub fn vault_location(&self, store_id: &StoreId) -> Option<EventLogLocation> {
        match self.identity_mount_capability() {
            IdentityMountCapability::Mountable(_) => {
                Some(EventLogLocation::Vault(store_id.clone()))
            }
            IdentityMountCapability::LocalOnly | IdentityMountCapability::Unconfigured => None,
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

    /// Rows that replicate the identity control log: every remote mount.
    #[must_use]
    pub fn identity_replication(&self, identity_id: &IdentityId) -> Vec<ProviderReplicationTarget> {
        self.providers
            .iter()
            .filter(|provider| {
                matches!(
                    provider.identity_mount_capability(),
                    IdentityMountCapability::Mountable(_)
                )
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
            let IdentityMountCapability::Mountable(target) = provider.identity_mount_capability()
            else {
                continue;
            };
            let known = recorded
                .iter()
                .chain(mounts.iter())
                .any(|mount| mount.target == target);
            if known {
                continue;
            }
            mounts.push(IdentityProviderMount {
                mount_id: ProviderMountId::generate()?,
                label: provider.label.clone(),
                target,
            });
        }
        Ok(mounts)
    }

    /// The first row that replicates one vault.
    #[must_use]
    pub fn vault_row(&self, store_id: &StoreId) -> Option<&StorageProviderData> {
        self.providers
            .iter()
            .find(|provider| provider.vault_location(store_id).is_some())
    }
}

#[cfg(test)]
mod tests {
    use super::super::OAuthFileConfig;
    use super::*;
    use crate::{
        ActiveVaultScope, LocalFolderConfigData, ProviderSyncCheckpoint, ProviderVaultScope,
        StoredGithubPat, StoredLocalFolderHandle,
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
                sync_checkpoint: ProviderSyncCheckpoint::NeverSynced,
                created_at: "2026-10-12T00:00:00Z".to_owned(),
            })
        }

        fn oauth(id: &str, config: OAuthFileConfig) -> Self {
            let mut row = Self::github(id, "unused").0;
            row.provider_type = StorageProviderType::OauthFile;
            row.github_pat = StoredGithubPat::Missing;
            row.oauth_file = StoredOAuthFileConfiguration::configured(config);
            Self(row)
        }

        fn icloud(id: &str) -> Self {
            Self::oauth(
                id,
                OAuthFileConfig {
                    preset: OAuthFilePreset::ICloud,
                    icloud_share_target: StoredICloudShareTarget::SharedTarget("share".to_owned()),
                    ..OAuthFileConfig::default()
                },
            )
        }

        fn local(id: &str, store_id: &StoreId) -> Self {
            let mut row = Self::github(id, "unused").0;
            row.provider_type = StorageProviderType::Local;
            row.store_id = ProviderVaultScope::StoreId(store_id.as_str().to_owned());
            Self(row)
        }

        fn folder(id: &str) -> Self {
            let mut row = Self::github(id, "unused").0;
            row.provider_type = StorageProviderType::LocalFolder;
            row.github_pat = StoredGithubPat::Missing;
            row.local_folder = StoredLocalFolderConfiguration::Configured(LocalFolderConfigData {
                directory_name: StoredLocalFolderDirectory::DirectoryName("Nook".to_owned()),
                handle_id: StoredLocalFolderHandle::HandleId("handle".to_owned()),
            });
            Self(row)
        }
    }

    fn ids(targets: &[ProviderReplicationTarget]) -> Vec<(&str, EventLogLocation)> {
        targets
            .iter()
            .map(|target| (target.provider.id.as_str(), target.location.clone()))
            .collect()
    }

    #[test]
    fn only_cloud_mounts_let_another_device_join() -> anyhow::Result<()> {
        let drive = Row::oauth(
            "drive",
            OAuthFileConfig {
                preset: OAuthFilePreset::GoogleDrive,
                folder_id: StoredGoogleDriveFolder::FolderId("vault-folder".to_owned()),
                ..OAuthFileConfig::default()
            },
        )
        .0;

        assert_eq!(
            Row::github("github", "owner/repo").0.device_join_reach(),
            DeviceJoinReach::OtherDevices
        );
        assert_eq!(drive.device_join_reach(), DeviceJoinReach::OtherDevices);
        assert_eq!(
            Row::icloud("icloud").0.device_join_reach(),
            DeviceJoinReach::OtherDevices
        );
        assert_eq!(
            Row::folder("folder").0.device_join_reach(),
            DeviceJoinReach::ThisDeviceOnly
        );
        assert_eq!(
            Row::local("local", &StoreId::generate()?)
                .0
                .device_join_reach(),
            DeviceJoinReach::ThisDeviceOnly
        );
        Ok(())
    }

    #[test]
    fn every_remote_mount_replicates_the_identity_and_each_vault_in_its_namespace()
    -> anyhow::Result<()> {
        let personal = StoreId::generate()?;
        let work = StoreId::generate()?;
        let identity = IdentityId::generate()?;
        let providers = vec![
            Row::local("local", &personal).0,
            Row::github("github", "owner/identity").0,
            Row::icloud("icloud").0,
            Row::folder("folder").0,
        ];
        let rows = ProviderRows {
            providers: &providers,
        };

        for store_id in [&personal, &work] {
            assert_eq!(
                ids(&rows.vault_replication(store_id)),
                vec![
                    ("github", EventLogLocation::Vault(store_id.clone())),
                    ("icloud", EventLogLocation::Vault(store_id.clone())),
                    ("folder", EventLogLocation::Vault(store_id.clone())),
                ]
            );
        }
        assert_eq!(
            ids(&rows.identity_replication(&identity)),
            vec![
                ("github", EventLogLocation::Identity(identity.clone())),
                ("icloud", EventLogLocation::Identity(identity.clone())),
                ("folder", EventLogLocation::Identity(identity.clone())),
            ]
        );
        assert_eq!(
            rows.vault_row(&work).map(|row| row.id.as_str()),
            Some("github")
        );
        assert_eq!(
            Row::local("local", &personal).0.identity_mount_capability(),
            IdentityMountCapability::LocalOnly
        );

        // The open vault sees its own browser row and every identity mount.
        let active = ProviderRows {
            providers: &providers,
        }
        .for_vault(&ActiveVaultScope::StoreId(work.as_str().to_owned()))
        .active();
        assert_eq!(
            active.iter().map(|row| row.id.as_str()).collect::<Vec<_>>(),
            vec!["github", "icloud", "folder"]
        );
        Ok(())
    }

    #[test]
    fn oauth_mounts_carry_their_shared_target_and_need_one() {
        assert_eq!(
            Row::icloud("icloud").0.identity_mount_capability(),
            IdentityMountCapability::Mountable(IdentityMountTarget::ICloud {
                share_target: "share".to_owned()
            })
        );
        let unshared = Row::oauth(
            "icloud",
            OAuthFileConfig {
                preset: OAuthFilePreset::ICloud,
                ..OAuthFileConfig::default()
            },
        );
        assert_eq!(
            unshared.0.identity_mount_capability(),
            IdentityMountCapability::Unconfigured
        );
        let unbound_drive = Row::oauth(
            "drive",
            OAuthFileConfig {
                preset: OAuthFilePreset::GoogleDrive,
                ..OAuthFileConfig::default()
            },
        );
        assert_eq!(
            unbound_drive.0.identity_mount_capability(),
            IdentityMountCapability::Unconfigured
        );
        let drive = Row::oauth(
            "drive",
            OAuthFileConfig {
                preset: OAuthFilePreset::GoogleDrive,
                folder_id: StoredGoogleDriveFolder::FolderId(" vault-folder ".to_owned()),
                ..OAuthFileConfig::default()
            },
        );
        assert_eq!(
            drive.0.identity_mount_capability(),
            IdentityMountCapability::Mountable(IdentityMountTarget::GoogleDrive {
                folder_id: "vault-folder".to_owned()
            })
        );
    }

    #[test]
    fn remote_rows_become_mount_records_once() -> anyhow::Result<()> {
        let providers = vec![
            Row::local("local", &StoreId::generate()?).0,
            Row::github("first", "owner/identity").0,
            Row::github("again", "owner/identity").0,
            Row::icloud("icloud").0,
        ];
        let rows = ProviderRows {
            providers: &providers,
        };
        let recorded = rows.unrecorded_mounts(&[])?;
        assert_eq!(
            recorded
                .iter()
                .map(|mount| &mount.target)
                .collect::<Vec<_>>(),
            vec![
                &IdentityMountTarget::Github {
                    repository: "owner/identity".to_owned()
                },
                &IdentityMountTarget::ICloud {
                    share_target: "share".to_owned()
                },
            ]
        );
        assert!(rows.unrecorded_mounts(&recorded)?.is_empty());
        Ok(())
    }
}

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

use crate::{ProviderRows, StorageProvider};

/// Whether a provider row can carry an identity's control log.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IdentityMountCapability {
    /// The row replicates the identity log and every vault at their
    /// namespaces.
    Mountable(IdentityMountTarget),
    /// This browser's store never leaves this installation.
    LocalOnly,
}

/// Whether another device can reach a provider row to join the identity.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeviceJoinReach {
    /// A cloud mount every app of the identity can reach.
    OtherDevices,
    /// The row lives on this device only.
    ThisDeviceOnly,
}

/// Where a row keeps one vault's events.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProviderVaultPlacement {
    /// The vault's namespace on the row's mount.
    Mounted(EventLogLocation),
    /// This browser's own store holds the vault.
    ThisBrowser,
}

/// The first row that replicates a vault, if a row does.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderRowLookup<'a> {
    Found(&'a StorageProvider),
    NotFound,
}

/// One provider row and the namespace one event log uses there.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderReplicationTarget {
    pub provider: StorageProvider,
    pub location: EventLogLocation,
}

impl StorageProvider {
    /// Credential-free mount target of this row.
    #[must_use]
    pub fn identity_mount_capability(&self) -> IdentityMountCapability {
        self.provider.identity_mount_capability()
    }

    /// A joining app reads the identity log through a mount it can reach, so
    /// only cloud mounts carry joins. A local folder is chosen per
    /// installation.
    #[must_use]
    pub fn device_join_reach(&self) -> DeviceJoinReach {
        match self.identity_mount_capability() {
            IdentityMountCapability::Mountable(IdentityMountTarget::LocalFolder { .. })
            | IdentityMountCapability::LocalOnly => DeviceJoinReach::ThisDeviceOnly,
            IdentityMountCapability::Mountable(
                IdentityMountTarget::Github { .. }
                | IdentityMountTarget::GoogleDrive { .. }
                | IdentityMountTarget::ICloud { .. }
                | IdentityMountTarget::S3(_),
            ) => DeviceJoinReach::OtherDevices,
        }
    }

    /// Where this row stores one vault's events.
    #[must_use]
    pub fn vault_placement(&self, store_id: &StoreId) -> ProviderVaultPlacement {
        match self.identity_mount_capability() {
            IdentityMountCapability::Mountable(_) => {
                ProviderVaultPlacement::Mounted(EventLogLocation::Vault(store_id.clone()))
            }
            IdentityMountCapability::LocalOnly => ProviderVaultPlacement::ThisBrowser,
        }
    }
}

impl ProviderRows<'_> {
    /// Rows that replicate one vault, each with the namespace it uses there.
    #[must_use]
    pub fn vault_replication(&self, store_id: &StoreId) -> Vec<ProviderReplicationTarget> {
        self.providers
            .iter()
            .filter_map(|provider| match provider.vault_placement(store_id) {
                ProviderVaultPlacement::Mounted(location) => Some(ProviderReplicationTarget {
                    provider: provider.clone(),
                    location,
                }),
                ProviderVaultPlacement::ThisBrowser => None,
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
    pub fn vault_row(&self, store_id: &StoreId) -> ProviderRowLookup<'_> {
        match self.providers.iter().find(|provider| {
            matches!(
                provider.vault_placement(store_id),
                ProviderVaultPlacement::Mounted(_)
            )
        }) {
            Some(provider) => ProviderRowLookup::Found(provider),
            None => ProviderRowLookup::NotFound,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::slice;

    use nook_auth2::{IdentityId, StoreId};
    use nook_event_log::{EventLogLocation, IdentityMountTarget, S3MountTarget};

    use super::{
        DeviceJoinReach, IdentityMountCapability, ProviderRowLookup, ProviderVaultPlacement,
    };
    use crate::{
        ProviderRows, ProviderVaultScope, S3Connection, S3ConnectionDraft, S3KeyPrefix,
        StorageProvider, StoredProvider,
    };

    fn local(id: &str, store_id: &StoreId) -> StorageProvider {
        StorageProvider {
            store_id: ProviderVaultScope::StoreId(store_id.as_str().to_owned()),
            ..StorageProvider::fixture(id, StoredProvider::Local {})
        }
    }

    fn s3(id: &str, access_key_id: &str, region: &str) -> anyhow::Result<StorageProvider> {
        let mut draft = S3ConnectionDraft::fixture();
        draft.access_key_id = access_key_id.to_owned();
        draft.region = region.to_owned();
        Ok(StorageProvider::fixture(
            id,
            StoredProvider::S3(S3Connection::try_from(draft)?),
        ))
    }

    fn ids(targets: &[super::ProviderReplicationTarget]) -> Vec<(&str, EventLogLocation)> {
        targets
            .iter()
            .map(|target| (target.provider.id.as_str(), target.location.clone()))
            .collect()
    }

    #[test]
    fn only_cloud_mounts_let_another_device_join() -> anyhow::Result<()> {
        let store_id = StoreId::generate()?;
        assert_eq!(
            local("local", &store_id).device_join_reach(),
            DeviceJoinReach::ThisDeviceOnly
        );
        let folder = StorageProvider::fixture("folder", StoredProvider::local_folder_fixture()?);
        assert_eq!(folder.device_join_reach(), DeviceJoinReach::ThisDeviceOnly);
        for provider in [
            StoredProvider::github_fixture()?,
            StoredProvider::google_drive_fixture()?,
            StoredProvider::icloud_fixture()?,
            StoredProvider::s3_fixture()?,
        ] {
            assert_eq!(
                StorageProvider::fixture("cloud", provider).device_join_reach(),
                DeviceJoinReach::OtherDevices
            );
        }
        Ok(())
    }

    #[test]
    fn every_remote_mount_replicates_the_identity_and_each_vault_in_its_namespace()
    -> anyhow::Result<()> {
        let store_id = StoreId::generate()?;
        let identity = IdentityId::generate()?;
        let this_browser = local("local", &store_id);
        let github = StorageProvider::fixture("github", StoredProvider::github_fixture()?);
        let providers = vec![this_browser.clone(), github.clone()];
        let rows = ProviderRows {
            providers: &providers,
        };
        assert_eq!(
            ids(&rows.vault_replication(&store_id)),
            vec![("github", EventLogLocation::Vault(store_id.clone()))]
        );
        assert_eq!(
            ids(&rows.identity_replication(&identity)),
            vec![("github", EventLogLocation::Identity(identity.clone()))]
        );
        assert_eq!(
            this_browser.vault_placement(&store_id),
            ProviderVaultPlacement::ThisBrowser
        );
        assert_eq!(rows.vault_row(&store_id), ProviderRowLookup::Found(&github));
        let only_local = vec![this_browser];
        assert_eq!(
            ProviderRows {
                providers: &only_local
            }
            .vault_row(&store_id),
            ProviderRowLookup::NotFound
        );
        Ok(())
    }

    #[test]
    fn an_s3_row_is_one_mount_whatever_key_or_region_reaches_it() -> anyhow::Result<()> {
        let device_a = s3("s3-a", "device-a", "us-east-1")?;
        assert_eq!(
            device_a.identity_mount_capability(),
            IdentityMountCapability::Mountable(IdentityMountTarget::S3(S3MountTarget {
                endpoint: "http://127.0.0.1:8333".to_owned(),
                bucket: "nook-dev".to_owned(),
                key_prefix: S3KeyPrefix::parse("e2e/run-1")?,
            }))
        );
        let recorded = ProviderRows {
            providers: slice::from_ref(&device_a),
        }
        .unrecorded_mounts(&[])?;
        assert_eq!(recorded.len(), 1);
        let device_b = vec![s3("s3-b", "device-b", "eu-central-1")?];
        assert!(
            ProviderRows {
                providers: &device_b
            }
            .unrecorded_mounts(&recorded)?
            .is_empty()
        );
        Ok(())
    }

    #[test]
    fn remote_rows_become_mount_records_once() -> anyhow::Result<()> {
        let github = StorageProvider::fixture("first", StoredProvider::github_fixture()?);
        let providers = vec![
            local("local", &StoreId::generate()?),
            github.clone(),
            StorageProvider {
                id: "again".to_owned(),
                ..github
            },
            StorageProvider::fixture("drive", StoredProvider::google_drive_fixture()?),
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
                    repository: "team-vault".to_owned()
                },
                &IdentityMountTarget::GoogleDrive {
                    folder_id: "folder-1".to_owned()
                },
            ]
        );
        assert_eq!(
            recorded.first().map(|mount| mount.label.as_str()),
            Some("GitHub · team-vault")
        );
        assert!(rows.unrecorded_mounts(&recorded)?.is_empty());
        Ok(())
    }
}

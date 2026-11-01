//! Presentation snapshot of a replicated identity for the Devices and Sync pages.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use nook_auth2::{AppId, IdentityId};
use nook_event_log::{
    IdentityControlState, IdentityMountTarget, IdentityProviderMount, IdentityVaultDekLookup,
};
use serde::{Deserialize, Serialize};
use tsify::Tsify;

use super::identity_control::ReplicatedIdentityStanding;
use crate::{IdentityMountCapability, StorageProviderData};

/// This installation's standing in its identity.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub enum IdentityControlStanding {
    /// The identity has no replicated control log yet.
    NotReplicated,
    Member,
    PendingJoin,
    Revoked,
    /// The log exists but does not list this installation.
    NotListed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct IdentityMemberView {
    pub app_id: String,
    pub label: String,
    pub is_current_installation: bool,
    /// It runs on this installation's device: this app, or one sharing its
    /// device, as the browser extension in the web app's browser.
    pub on_current_device: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct IdentityJoinRequestView {
    pub app_id: String,
    pub label: String,
    /// When the asking device wrote its request; audit time only.
    pub requested_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct IdentityVaultView {
    pub store_id: String,
    /// Whether this installation holds the vault's current DEK envelope.
    pub granted_to_current_installation: bool,
    /// Active members that hold no envelope for the current key epoch.
    pub members_missing_dek: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub enum IdentityMountProvider {
    Github,
    GoogleDrive,
    #[serde(rename = "icloud")]
    ICloud,
    LocalFolder,
    S3,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct IdentityMountView {
    pub mount_id: String,
    pub label: String,
    pub provider: IdentityMountProvider,
    /// Credential-free routing shown to the user (repository, folder, share).
    pub target: String,
    /// Whether this installation saved credentials for this mount.
    pub connected_here: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct IdentityControlSnapshot {
    pub identity_id: String,
    /// The local name of the identity. Names never enter the replicated log.
    pub identity_label: String,
    pub standing: IdentityControlStanding,
    pub members: Vec<IdentityMemberView>,
    /// Devices the members run on: apps sharing one device count once.
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "serialization boundary: carries the device count to JavaScript as a Number"
        )
    )]
    pub device_count: usize,
    /// Devices asking to join, which this installation can answer as a member.
    pub join_requests: Vec<IdentityJoinRequestView>,
    pub vaults: Vec<IdentityVaultView>,
    pub mounts: Vec<IdentityMountView>,
}

/// Named values required to project a snapshot for one installation.
pub struct IdentityControlSnapshotRequest<'a> {
    pub state: &'a IdentityControlState,
    pub identity_label: &'a str,
    pub current_app_id: &'a AppId,
    pub providers: &'a [StorageProviderData],
}

impl IdentityMountView {
    fn from_mount(mount: &IdentityProviderMount, providers: &[StorageProviderData]) -> Self {
        let (provider, target) = match &mount.target {
            IdentityMountTarget::Github { repository } => {
                (IdentityMountProvider::Github, repository.clone())
            }
            IdentityMountTarget::GoogleDrive { folder_id } => {
                (IdentityMountProvider::GoogleDrive, folder_id.clone())
            }
            IdentityMountTarget::ICloud { share_target } => {
                (IdentityMountProvider::ICloud, share_target.clone())
            }
            IdentityMountTarget::LocalFolder { directory_name } => {
                (IdentityMountProvider::LocalFolder, directory_name.clone())
            }
            IdentityMountTarget::S3(location) => {
                (IdentityMountProvider::S3, location.location_identity())
            }
        };
        Self {
            mount_id: mount.mount_id.as_str().to_owned(),
            label: mount.label.clone(),
            provider,
            target,
            connected_here: providers.iter().any(|provider| {
                provider.identity_mount_capability()
                    == IdentityMountCapability::Mountable(mount.target.clone())
            }),
        }
    }
}

impl IdentityControlSnapshot {
    /// A local identity whose control log has not been created or adopted.
    #[must_use]
    pub fn not_replicated(identity_id: &IdentityId, identity_label: &str) -> Self {
        Self {
            identity_id: identity_id.as_str().to_owned(),
            identity_label: identity_label.to_owned(),
            standing: IdentityControlStanding::NotReplicated,
            members: Vec::new(),
            device_count: 0,
            join_requests: Vec::new(),
            vaults: Vec::new(),
            mounts: Vec::new(),
        }
    }

    #[must_use]
    pub fn project(request: &IdentityControlSnapshotRequest<'_>) -> Self {
        let IdentityControlSnapshotRequest {
            state,
            identity_label,
            current_app_id,
            providers,
        } = request;
        let standing = match ReplicatedIdentityStanding::of(state, current_app_id) {
            ReplicatedIdentityStanding::ActiveMember => IdentityControlStanding::Member,
            ReplicatedIdentityStanding::Revoked => IdentityControlStanding::Revoked,
            ReplicatedIdentityStanding::PendingJoin => IdentityControlStanding::PendingJoin,
            ReplicatedIdentityStanding::NotListed => IdentityControlStanding::NotListed,
        };
        Self {
            identity_id: state.identity_id.as_str().to_owned(),
            identity_label: (*identity_label).to_owned(),
            standing,
            members: state
                .members
                .iter()
                .map(|member| IdentityMemberView {
                    app_id: member.keys.app_id.as_str().to_owned(),
                    label: member.keys.label.as_str().to_owned(),
                    is_current_installation: &member.keys.app_id == *current_app_id,
                    on_current_device: &member.keys.app_id == *current_app_id
                        || state.share_a_device(&member.keys.app_id, current_app_id),
                })
                .collect(),
            device_count: state.device_members().count(),
            // Only a member answers join requests.
            join_requests: match standing {
                IdentityControlStanding::Member => state
                    .pending_joins
                    .iter()
                    .map(|request| IdentityJoinRequestView {
                        app_id: request.member.app_id.as_str().to_owned(),
                        label: request.member.label.as_str().to_owned(),
                        requested_at: request.requested_at.as_str().to_owned(),
                    })
                    .collect(),
                IdentityControlStanding::NotReplicated
                | IdentityControlStanding::PendingJoin
                | IdentityControlStanding::Revoked
                | IdentityControlStanding::NotListed => Vec::new(),
            },
            vaults: state
                .vaults
                .iter()
                .map(|vault| IdentityVaultView {
                    store_id: vault.store_id.as_str().to_owned(),
                    granted_to_current_installation: matches!(
                        vault.current_dek_for(current_app_id),
                        IdentityVaultDekLookup::Granted(_)
                    ),
                    members_missing_dek: state
                        .members_missing_current_dek(&vault.store_id)
                        .iter()
                        .map(|member| member.keys.app_id.as_str().to_owned())
                        .collect(),
                })
                .collect(),
            mounts: state
                .mounts
                .iter()
                .map(|mount| IdentityMountView::from_mount(mount, providers))
                .collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::slice;

    use super::{IdentityMountProvider, IdentityMountView};
    use crate::{
        IdentityProviderMount, ProviderMountId, S3Connection, StorageProviderData,
        StorageProviderType, StoredGithubPat, StoredS3Configuration,
    };

    #[test]
    fn an_s3_mount_shows_its_location_and_whether_this_app_connects_it() -> anyhow::Result<()> {
        let config = S3Connection::fixture()?;
        let mount = IdentityProviderMount {
            mount_id: ProviderMountId::generate()?,
            label: "S3 · nook-dev/e2e/run-1".to_owned(),
            target: config.mount_target(),
        };
        let mut row = StorageProviderData::github("s3", "S3", "", "", "now");
        row.provider_type = StorageProviderType::S3;
        row.github_pat = StoredGithubPat::Missing;
        row.s3 = StoredS3Configuration::Configured(config);
        let view = IdentityMountView::from_mount(&mount, slice::from_ref(&row));
        assert_eq!(view.provider, IdentityMountProvider::S3);
        assert_eq!(view.target, "http://127.0.0.1:8333/nook-dev/e2e/run-1");
        assert!(view.connected_here);
        assert!(!IdentityMountView::from_mount(&mount, &[]).connected_here);
        // A row that signs for the same location in another region connects it.
        let StoredS3Configuration::Configured(config) = &mut row.s3 else {
            anyhow::bail!("an S3 row carries its block");
        };
        config.region = "eu-central-1".to_owned();
        assert!(IdentityMountView::from_mount(&mount, slice::from_ref(&row)).connected_here);
        Ok(())
    }
}

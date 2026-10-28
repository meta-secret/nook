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
                })
                .collect(),
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

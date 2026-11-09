//! Presentation snapshot of a replicated identity for the Devices and Sync pages.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use std::iter;

use nook_auth2::{AppId, IdentityId, RecoveryStrength};
use nook_event_log::{
    IdentityControlMember, IdentityControlState, IdentityMemberApprover, IdentityMountTarget,
    IdentityProviderMount, IdentityVaultDekLookup, MemberDevice,
};
use serde::{Deserialize, Serialize};
use tsify::Tsify;

use super::identity_control::ReplicatedIdentityStanding;
use crate::{BrowserExtensionMembership, IdentityMountCapability, StorageProvider};

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
    /// Who let this app in.
    pub approved_by: IdentityMemberApprovalView,
}

/// Who let an app into the identity.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum IdentityMemberApprovalView {
    /// It founded the identity.
    Founder,
    /// It joined with a one-time invite.
    Invite,
    /// Another app of the identity approved or added it.
    #[serde(rename_all = "camelCase")]
    App { app_id: String },
    /// A recovery passphrase approved it on a new device; the label stays
    /// known after the passphrase is removed.
    #[serde(rename_all = "camelCase")]
    RecoveryPassphrase { app_id: String, label: String },
}

impl From<&IdentityMemberApprover> for IdentityMemberApprovalView {
    fn from(approver: &IdentityMemberApprover) -> Self {
        match approver {
            IdentityMemberApprover::Founder => Self::Founder,
            IdentityMemberApprover::Invite => Self::Invite,
            IdentityMemberApprover::App { app_id } => Self::App {
                app_id: app_id.as_str().to_owned(),
            },
            IdentityMemberApprover::RecoveryPassphrase { app_id, label } => {
                Self::RecoveryPassphrase {
                    app_id: app_id.as_str().to_owned(),
                    label: label.as_str().to_owned(),
                }
            }
        }
    }
}

/// One recovery passphrase on the keyring: its label and how many words it
/// has. Its words and keys never leave Rust.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct IdentityRecoveryPassphraseView {
    /// The recovery member's id, which removing it names.
    pub id: String,
    pub label: String,
    pub strength: RecoveryStrength,
}

impl IdentityRecoveryPassphraseView {
    /// Every recovery passphrase on the keyring.
    #[must_use]
    pub fn list(state: &IdentityControlState) -> Vec<Self> {
        state
            .recovery_members()
            .map(|(member, recovery)| Self {
                id: member.keys.app_id.as_str().to_owned(),
                label: member.keys.label.as_str().to_owned(),
                strength: recovery.strength,
            })
            .collect()
    }
}

/// One device the identity's apps run on, with every app on it. Each app
/// holds its own key; apps in one browser, as the web app and the extension
/// it added, are one device.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct IdentityDeviceView {
    /// The app that brought the device first, then the apps added beside it.
    pub apps: Vec<IdentityMemberView>,
    /// This installation runs on it.
    pub current: bool,
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
    /// The members grouped by the device they run on.
    pub devices: Vec<IdentityDeviceView>,
    /// Devices the members run on: apps sharing one device count once.
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "serialization boundary: carries the device count to JavaScript as a Number"
        )
    )]
    pub device_count: usize,
    /// Whether a browser extension beside this installation, on its device,
    /// is a member: the extension joins as an app on the web app's device.
    pub extension_on_this_device: BrowserExtensionMembership,
    /// Devices asking to join, which this installation can answer as a member.
    pub join_requests: Vec<IdentityJoinRequestView>,
    pub vaults: Vec<IdentityVaultView>,
    pub mounts: Vec<IdentityMountView>,
    /// The recovery passphrases on the keyring. They are members on no
    /// device, so `members` and `devices` leave them out.
    pub recovery_passphrases: Vec<IdentityRecoveryPassphraseView>,
}

/// Named values required to project a snapshot for one installation.
pub struct IdentityControlSnapshotRequest<'a> {
    pub state: &'a IdentityControlState,
    pub identity_label: &'a str,
    pub current_app_id: &'a AppId,
    pub providers: &'a [StorageProvider],
}

impl IdentityMountView {
    fn from_mount(mount: &IdentityProviderMount, providers: &[StorageProvider]) -> Self {
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
            devices: Vec::new(),
            device_count: 0,
            extension_on_this_device: BrowserExtensionMembership::NotJoined,
            join_requests: Vec::new(),
            vaults: Vec::new(),
            mounts: Vec::new(),
            recovery_passphrases: Vec::new(),
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
        let view = |member: &IdentityControlMember| IdentityMemberView {
            app_id: member.keys.app_id.as_str().to_owned(),
            label: member.keys.label.as_str().to_owned(),
            is_current_installation: &member.keys.app_id == *current_app_id,
            on_current_device: &member.keys.app_id == *current_app_id
                || state.share_a_device(&member.keys.app_id, current_app_id),
            approved_by: IdentityMemberApprovalView::from(&member.approved_by),
        };
        let devices = state
            .device_members()
            .map(|device| {
                let beside = state
                    .app_members()
                    .filter(|(_, beside)| {
                        matches!(beside, MemberDevice::SameAs { app_id } if app_id == &device.keys.app_id)
                    })
                    .map(|(member, _)| member);
                let apps = iter::once(device)
                    .chain(beside)
                    .map(view)
                    .collect::<Vec<_>>();
                IdentityDeviceView {
                    current: apps.iter().any(|app| app.on_current_device),
                    apps,
                }
            })
            .collect::<Vec<_>>();
        let extension_on_this_device = if state.app_members().any(|(member, device)| {
            matches!(
                device,
                MemberDevice::SameAs { app_id }
                    if app_id == *current_app_id || &member.keys.app_id == *current_app_id
            )
        }) {
            BrowserExtensionMembership::Joined
        } else {
            BrowserExtensionMembership::NotJoined
        };
        Self {
            identity_id: state.identity_id.as_str().to_owned(),
            identity_label: (*identity_label).to_owned(),
            standing,
            members: state
                .app_members()
                .map(|(member, _)| view(member))
                .collect(),
            device_count: devices.len(),
            devices,
            extension_on_this_device,
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
            recovery_passphrases: IdentityRecoveryPassphraseView::list(state),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::slice;

    use super::{IdentityMountProvider, IdentityMountView};
    use crate::{
        IdentityProviderMount, ProviderMountId, S3Connection, StorageProvider, StoredProvider,
    };

    #[test]
    fn an_s3_mount_shows_its_location_and_whether_this_app_connects_it() -> anyhow::Result<()> {
        let config = S3Connection::fixture()?;
        let mount = IdentityProviderMount {
            mount_id: ProviderMountId::generate()?,
            label: "S3 · nook-dev/e2e/run-1".to_owned(),
            target: config.mount_target(),
        };
        let mut row = StorageProvider::fixture("s3", StoredProvider::S3(config));
        let view = IdentityMountView::from_mount(&mount, slice::from_ref(&row));
        assert_eq!(view.provider, IdentityMountProvider::S3);
        assert_eq!(view.target, "http://127.0.0.1:8333/nook-dev/e2e/run-1");
        assert!(view.connected_here);
        assert!(!IdentityMountView::from_mount(&mount, &[]).connected_here);
        // A row that signs for the same location in another region connects it.
        let StoredProvider::S3(config) = &mut row.provider else {
            anyhow::bail!("an S3 row carries its connection");
        };
        config.region = "eu-central-1".to_owned();
        assert!(IdentityMountView::from_mount(&mount, slice::from_ref(&row)).connected_here);
        Ok(())
    }
}

//! Identity recovery targeting and the identity retired by a committed reset.
use nook_core::{AppId, IdentityId};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug)]
pub(crate) enum RecoveryTarget {
    Unspecified,
    App(AppId),
}

/// The cleanup wire keeps its original nullable app-id scalar.
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(untagged)]
pub(crate) enum RetiredInstallation {
    #[default]
    Unattributed,
    App(AppId),
}

pub(super) enum RecoveryScope {
    Installation(RetiredInstallation),
    LocalIdentity(RetiredLocalIdentity),
}
pub(super) struct RetiredLocalIdentity {
    pub(super) identity_id: IdentityId,
    pub(super) app_id: AppId,
}
impl RecoveryScope {
    pub(super) fn retired_installation(&self) -> RetiredInstallation {
        match self {
            Self::Installation(retired) => retired.clone(),
            Self::LocalIdentity(retired) => RetiredInstallation::App(retired.app_id.clone()),
        }
    }
    pub(super) fn retires_identity(&self, identity_id: &IdentityId) -> bool {
        matches!(self, Self::LocalIdentity(retired) if &retired.identity_id == identity_id)
    }
}

//! Day-2 health of an identity, shared by every host application.
//!
//! An identity is safe once it survives two losses, built in this order: a
//! copy outside this browser (any sync provider), then a second app that can
//! open it (which joins through a cloud provider). The assessment names the
//! stage reached, the single next step, and how firmly to ask for it.

/// How far an identity is protected against loss.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdentityHealthStage {
    /// Only this browser holds the identity and its vaults.
    LocalOnly,
    /// A sync provider keeps a copy; only this app can open it.
    CopyKept,
    /// A sync provider keeps a copy and another app can open it.
    MultiDevice,
}

/// The one thing that protects the identity most right now.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdentityNextStep {
    /// Keep a copy outside this browser.
    AddSyncProvider,
    /// The copy is local; devices join only through a cloud provider.
    AddCloudProvider,
    /// Let a second app open the identity.
    AddDevice,
    /// Nothing is missing.
    Done,
}

/// How firmly the next step is asked for outside identity management.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdentityNudge {
    /// Nothing at risk yet, or nothing missing.
    Quiet,
    /// Worth doing soon.
    Suggest,
    /// Many items live only in this browser.
    Urge,
}

/// Stored items at which a browser-only identity is urged to keep a copy.
const URGE_AT_STORED_ITEMS: usize = 10;

/// Named values required by `IdentityHealth::assess`.
#[derive(Debug, Clone, Copy)]
pub struct IdentityHealthAssessment {
    /// Sync providers that keep a copy of the identity and its vaults.
    pub copy_provider_count: crate::VaultSyncProviderCount,
    /// Of those, providers another device can reach to join.
    pub device_join_provider_count: crate::VaultSyncProviderCount,
    /// Apps that can open the identity, this one included.
    pub app_count: crate::EnrolledDeviceCount,
    /// Items stored in the open vault.
    pub stored_item_count: crate::SecretRecordCount,
}

/// Where an identity stands and what to ask for next.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IdentityHealth {
    pub stage: IdentityHealthStage,
    pub next_step: IdentityNextStep,
    pub nudge: IdentityNudge,
}

impl IdentityHealth {
    #[must_use]
    pub const fn assess(request: IdentityHealthAssessment) -> Self {
        let IdentityHealthAssessment {
            copy_provider_count,
            device_join_provider_count,
            app_count,
            stored_item_count,
        } = request;
        let stage = if copy_provider_count.is_zero() {
            IdentityHealthStage::LocalOnly
        } else if app_count.is_at_most_one() {
            IdentityHealthStage::CopyKept
        } else {
            IdentityHealthStage::MultiDevice
        };
        let next_step = match stage {
            IdentityHealthStage::LocalOnly => IdentityNextStep::AddSyncProvider,
            IdentityHealthStage::CopyKept if device_join_provider_count.is_zero() => {
                IdentityNextStep::AddCloudProvider
            }
            IdentityHealthStage::CopyKept => IdentityNextStep::AddDevice,
            IdentityHealthStage::MultiDevice => IdentityNextStep::Done,
        };
        let nudge = match (next_step, stage) {
            (IdentityNextStep::Done, _) => IdentityNudge::Quiet,
            _ if stored_item_count.is_zero() => IdentityNudge::Quiet,
            (_, IdentityHealthStage::LocalOnly)
                if stored_item_count.is_at_least(URGE_AT_STORED_ITEMS) =>
            {
                IdentityNudge::Urge
            }
            _ => IdentityNudge::Suggest,
        };
        Self {
            stage,
            next_step,
            nudge,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assess(copies: usize, joinable: usize, apps: usize, items: usize) -> IdentityHealth {
        IdentityHealth::assess(IdentityHealthAssessment {
            copy_provider_count: copies.into(),
            device_join_provider_count: joinable.into(),
            app_count: apps.into(),
            stored_item_count: items.into(),
        })
    }

    #[test]
    fn a_browser_only_identity_asks_for_a_copy_first() {
        let health = assess(0, 0, 1, 3);

        assert_eq!(health.stage, IdentityHealthStage::LocalOnly);
        assert_eq!(health.next_step, IdentityNextStep::AddSyncProvider);
        assert_eq!(health.nudge, IdentityNudge::Suggest);
    }

    #[test]
    fn stays_quiet_while_nothing_is_stored() {
        let health = assess(0, 0, 1, 0);

        assert_eq!(health.next_step, IdentityNextStep::AddSyncProvider);
        assert_eq!(health.nudge, IdentityNudge::Quiet);
    }

    #[test]
    fn urges_a_copy_once_many_items_live_only_here() {
        assert_eq!(assess(0, 0, 1, 9).nudge, IdentityNudge::Suggest);
        assert_eq!(assess(0, 0, 1, 10).nudge, IdentityNudge::Urge);
    }

    #[test]
    fn a_local_copy_still_needs_a_cloud_provider_before_devices_can_join() {
        let health = assess(1, 0, 1, 25);

        assert_eq!(health.stage, IdentityHealthStage::CopyKept);
        assert_eq!(health.next_step, IdentityNextStep::AddCloudProvider);
        assert_eq!(health.nudge, IdentityNudge::Suggest);
    }

    #[test]
    fn a_cloud_copy_asks_for_a_second_device() {
        let health = assess(1, 1, 1, 25);

        assert_eq!(health.stage, IdentityHealthStage::CopyKept);
        assert_eq!(health.next_step, IdentityNextStep::AddDevice);
    }

    #[test]
    fn two_apps_and_a_copy_need_nothing_more() {
        let health = assess(2, 1, 2, 40);

        assert_eq!(health.stage, IdentityHealthStage::MultiDevice);
        assert_eq!(health.next_step, IdentityNextStep::Done);
        assert_eq!(health.nudge, IdentityNudge::Quiet);
    }

    #[test]
    fn losing_every_provider_falls_back_to_keeping_a_copy() {
        let health = assess(0, 0, 2, 40);

        assert_eq!(health.stage, IdentityHealthStage::LocalOnly);
        assert_eq!(health.next_step, IdentityNextStep::AddSyncProvider);
        assert_eq!(health.nudge, IdentityNudge::Urge);
    }
}

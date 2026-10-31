//! Day-2 health of an identity, shared by every host application.
//!
//! An identity is safe once it survives two losses, built in this order: a
//! copy outside this browser (any sync provider), then a second device that
//! can open it (which joins through a cloud provider). Apps on one device,
//! as the web app and the browser extension in its browser, are one device.
//! The assessment names the stage reached, the single next step, how firmly
//! to ask for it, and the checklist of both protections with what each still
//! needs.

/// How far an identity is protected against loss.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdentityHealthStage {
    /// Only this browser holds the identity and its vaults.
    LocalOnly,
    /// A sync provider keeps a copy; only this device can open it.
    CopyKept,
    /// A sync provider keeps a copy and another device can open it.
    MultiDevice,
}

/// The one thing that protects the identity most right now.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdentityNextStep {
    /// Keep a copy outside this browser.
    AddSyncProvider,
    /// The copy is local; devices join only through a cloud provider.
    AddCloudProvider,
    /// Let a second device open the identity.
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

/// One loss an identity is protected against, in the order they are built.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdentityProtectionTask {
    /// A sync provider keeps a copy: clearing this browser loses nothing.
    CopyOutsideBrowser,
    /// Another device opens the identity: losing this one loses nothing.
    SecondDevice,
}

/// Where one protection task stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdentityProtectionTaskState {
    Done,
    /// Can be done now, through the task's action.
    Open,
    /// Waits for an earlier task: a device joins through the copy.
    Blocked,
}

/// One row of the protection checklist: the task, where it stands, and the
/// step that completes it (`Done` once it is done).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IdentityProtectionStep {
    pub task: IdentityProtectionTask,
    pub state: IdentityProtectionTaskState,
    pub action: IdentityNextStep,
}

/// Every protection task, in order, finished ones included.
pub type IdentityProtectionChecklist = [IdentityProtectionStep; 2];

/// Stored items at which a browser-only identity is urged to keep a copy.
const URGE_AT_STORED_ITEMS: usize = 10;

/// Named values required by `IdentityHealth::assess`.
#[derive(Debug, Clone, Copy)]
pub struct IdentityHealthAssessment {
    /// Sync providers that keep a copy of the identity and its vaults.
    pub copy_provider_count: crate::VaultSyncProviderCount,
    /// Of those, providers another device can reach to join.
    pub device_join_provider_count: crate::VaultSyncProviderCount,
    /// Devices whose apps can open the identity, this one included. Apps on
    /// one device count once: losing it loses them all.
    pub device_count: crate::EnrolledDeviceCount,
    /// Items stored in the open vault.
    pub stored_item_count: crate::SecretRecordCount,
}

/// Where an identity stands and what to ask for next.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IdentityHealth {
    pub stage: IdentityHealthStage,
    pub next_step: IdentityNextStep,
    pub nudge: IdentityNudge,
    pub checklist: IdentityProtectionChecklist,
}

impl IdentityHealth {
    #[must_use]
    pub const fn assess(request: IdentityHealthAssessment) -> Self {
        let IdentityHealthAssessment {
            copy_provider_count,
            device_join_provider_count,
            device_count,
            stored_item_count,
        } = request;
        let stage = if copy_provider_count.is_zero() {
            IdentityHealthStage::LocalOnly
        } else if device_count.is_at_most_one() {
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
        let copy = if copy_provider_count.is_zero() {
            IdentityProtectionStep {
                task: IdentityProtectionTask::CopyOutsideBrowser,
                state: IdentityProtectionTaskState::Open,
                action: IdentityNextStep::AddSyncProvider,
            }
        } else {
            IdentityProtectionStep {
                task: IdentityProtectionTask::CopyOutsideBrowser,
                state: IdentityProtectionTaskState::Done,
                action: IdentityNextStep::Done,
            }
        };
        let second_device = if !device_count.is_at_most_one() {
            IdentityProtectionStep {
                task: IdentityProtectionTask::SecondDevice,
                state: IdentityProtectionTaskState::Done,
                action: IdentityNextStep::Done,
            }
        } else if copy_provider_count.is_zero() {
            IdentityProtectionStep {
                task: IdentityProtectionTask::SecondDevice,
                state: IdentityProtectionTaskState::Blocked,
                action: IdentityNextStep::AddSyncProvider,
            }
        } else if device_join_provider_count.is_zero() {
            IdentityProtectionStep {
                task: IdentityProtectionTask::SecondDevice,
                state: IdentityProtectionTaskState::Open,
                action: IdentityNextStep::AddCloudProvider,
            }
        } else {
            IdentityProtectionStep {
                task: IdentityProtectionTask::SecondDevice,
                state: IdentityProtectionTaskState::Open,
                action: IdentityNextStep::AddDevice,
            }
        };
        Self {
            stage,
            next_step,
            nudge,
            checklist: [copy, second_device],
        }
    }

    /// Every task is done: the identity survives both losses.
    #[must_use]
    pub fn is_protected(&self) -> bool {
        self.checklist
            .iter()
            .all(|step| step.state == IdentityProtectionTaskState::Done)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assess(copies: usize, joinable: usize, apps: usize, items: usize) -> IdentityHealth {
        IdentityHealth::assess(IdentityHealthAssessment {
            copy_provider_count: copies.into(),
            device_join_provider_count: joinable.into(),
            device_count: apps.into(),
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

    fn step(
        task: IdentityProtectionTask,
        state: IdentityProtectionTaskState,
        action: IdentityNextStep,
    ) -> IdentityProtectionStep {
        IdentityProtectionStep {
            task,
            state,
            action,
        }
    }

    #[test]
    fn a_new_identity_lists_both_protections_with_the_device_waiting_on_the_copy() {
        let health = assess(0, 0, 1, 0);

        assert_eq!(
            health.checklist,
            [
                step(
                    IdentityProtectionTask::CopyOutsideBrowser,
                    IdentityProtectionTaskState::Open,
                    IdentityNextStep::AddSyncProvider,
                ),
                step(
                    IdentityProtectionTask::SecondDevice,
                    IdentityProtectionTaskState::Blocked,
                    IdentityNextStep::AddSyncProvider,
                ),
            ]
        );
        assert!(!health.is_protected());
    }

    #[test]
    fn a_local_copy_checks_off_the_copy_and_asks_for_a_cloud_provider_to_add_a_device() {
        let health = assess(1, 0, 1, 5);

        assert_eq!(
            health.checklist,
            [
                step(
                    IdentityProtectionTask::CopyOutsideBrowser,
                    IdentityProtectionTaskState::Done,
                    IdentityNextStep::Done,
                ),
                step(
                    IdentityProtectionTask::SecondDevice,
                    IdentityProtectionTaskState::Open,
                    IdentityNextStep::AddCloudProvider,
                ),
            ]
        );
    }

    #[test]
    fn a_cloud_copy_leaves_only_the_second_device_open() {
        let health = assess(1, 1, 1, 5);

        assert_eq!(
            health.checklist[1],
            step(
                IdentityProtectionTask::SecondDevice,
                IdentityProtectionTaskState::Open,
                IdentityNextStep::AddDevice,
            )
        );
        assert!(!health.is_protected());
    }

    #[test]
    fn a_copy_and_a_second_device_complete_the_checklist() {
        let health = assess(1, 1, 2, 5);

        assert!(health.is_protected());
        assert_eq!(health.next_step, IdentityNextStep::Done);
    }

    #[test]
    fn removing_the_last_provider_reopens_only_the_copy() {
        let health = assess(0, 0, 2, 5);

        assert_eq!(health.checklist[0].state, IdentityProtectionTaskState::Open);
        assert_eq!(health.checklist[1].state, IdentityProtectionTaskState::Done);
        assert!(!health.is_protected());
    }
}

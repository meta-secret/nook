//! Day-2 health of an identity, shared by every host application.
//!
//! An identity is safe once it survives two losses, built in this order: a
//! copy outside this browser (any sync provider), then a second device that
//! can open it (which joins through a cloud provider). Apps on one device,
//! as the web app and the browser extension in its browser, are one device.
//! The assessment names the stage reached, the single next step, how firmly
//! to ask for it, and the checklist of both protections with what each still
//! needs.
//!
//! After the protections, the checklist offers the browser extension where
//! the host app can run it: it fills passwords from the identity's vaults on
//! websites. It protects nothing, so it never changes the stage, the next
//! step, or the nudge.

use serde::{Deserialize, Serialize};
use tsify::Tsify;

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
    /// Install the browser extension in this browser.
    InstallExtension,
    /// Let the installed browser extension join the identity.
    ConnectExtension,
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

/// One task of the identity's checklist, in the order they are offered: the
/// two losses it is protected against, then the browser extension.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdentityProtectionTask {
    /// A sync provider keeps a copy: clearing this browser loses nothing.
    CopyOutsideBrowser,
    /// Another device opens the identity: losing this one loses nothing.
    SecondDevice,
    /// The browser extension joins the identity: Nook fills passwords from
    /// its vaults on websites.
    BrowserExtension,
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
/// step it offers. An open or blocked task offers the step that completes it.
/// A kept copy offers another sync provider while the second device is still
/// to be added through a cloud one, so a second copy can be added before the
/// first device is lost; otherwise a done task offers `Done`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IdentityProtectionStep {
    pub task: IdentityProtectionTask,
    pub state: IdentityProtectionTaskState,
    pub action: IdentityNextStep,
}

/// Whether the host app offers the browser extension in this browser, and
/// whether it is installed there.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BrowserExtensionInstallation {
    /// The app has no extension, or this browser cannot run it.
    NotOffered,
    NotInstalled,
    Installed,
}

/// Whether a browser extension on this device is a member of the identity.
/// The extension joins as an app beside the web app, on the same device.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub enum BrowserExtensionMembership {
    Joined,
    NotJoined,
}

/// The browser extension's place in the checklist.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdentityExtensionStep {
    /// The app does not offer the extension here: no row.
    NotOffered,
    Offered(IdentityProtectionStep),
}

/// Every checklist task, in order, finished ones included: both protections,
/// then the browser extension where it is offered.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IdentityProtectionChecklist {
    pub protections: [IdentityProtectionStep; 2],
    pub extension: IdentityExtensionStep,
}

impl IdentityProtectionChecklist {
    /// The rows in order, the extension's last where it is offered.
    pub fn steps(&self) -> impl Iterator<Item = IdentityProtectionStep> + '_ {
        let extension: &[IdentityProtectionStep] = match &self.extension {
            IdentityExtensionStep::NotOffered => &[],
            IdentityExtensionStep::Offered(step) => std::slice::from_ref(step),
        };
        self.protections.iter().chain(extension).copied()
    }
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
    /// Devices whose apps can open the identity, this one included. Apps on
    /// one device count once: losing it loses them all.
    pub device_count: crate::EnrolledDeviceCount,
    /// Items stored in the open vault.
    pub stored_item_count: crate::SecretRecordCount,
    /// Whether this browser has the extension the app offers.
    pub extension_installation: BrowserExtensionInstallation,
    /// Whether an extension on this device has joined the identity.
    pub extension_membership: BrowserExtensionMembership,
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
            extension_installation,
            extension_membership,
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
        } else if device_count.is_at_most_one() && !device_join_provider_count.is_zero() {
            IdentityProtectionStep {
                task: IdentityProtectionTask::CopyOutsideBrowser,
                state: IdentityProtectionTaskState::Done,
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
        let extension = match (extension_installation, extension_membership) {
            (BrowserExtensionInstallation::NotOffered, _) => IdentityExtensionStep::NotOffered,
            (BrowserExtensionInstallation::NotInstalled, _) => {
                IdentityExtensionStep::Offered(IdentityProtectionStep {
                    task: IdentityProtectionTask::BrowserExtension,
                    state: IdentityProtectionTaskState::Open,
                    action: IdentityNextStep::InstallExtension,
                })
            }
            (BrowserExtensionInstallation::Installed, BrowserExtensionMembership::NotJoined) => {
                IdentityExtensionStep::Offered(IdentityProtectionStep {
                    task: IdentityProtectionTask::BrowserExtension,
                    state: IdentityProtectionTaskState::Open,
                    action: IdentityNextStep::ConnectExtension,
                })
            }
            (BrowserExtensionInstallation::Installed, BrowserExtensionMembership::Joined) => {
                IdentityExtensionStep::Offered(IdentityProtectionStep {
                    task: IdentityProtectionTask::BrowserExtension,
                    state: IdentityProtectionTaskState::Done,
                    action: IdentityNextStep::Done,
                })
            }
        };
        Self {
            stage,
            next_step,
            nudge,
            checklist: IdentityProtectionChecklist {
                protections: [copy, second_device],
                extension,
            },
        }
    }

    /// Both protections are done: the identity survives both losses.
    #[must_use]
    pub fn is_protected(&self) -> bool {
        self.checklist
            .protections
            .iter()
            .all(|step| step.state == IdentityProtectionTaskState::Done)
    }

    /// Every row of the checklist is done, the extension's included.
    #[must_use]
    pub fn is_complete(&self) -> bool {
        self.checklist
            .steps()
            .all(|step| step.state == IdentityProtectionTaskState::Done)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assess(copies: usize, joinable: usize, apps: usize, items: usize) -> IdentityHealth {
        with_extension(
            [copies, joinable, apps, items],
            BrowserExtensionInstallation::NotOffered,
            BrowserExtensionMembership::NotJoined,
        )
    }

    fn with_extension(
        counts: [usize; 4],
        installation: BrowserExtensionInstallation,
        membership: BrowserExtensionMembership,
    ) -> IdentityHealth {
        let [copies, joinable, apps, items] = counts;
        IdentityHealth::assess(IdentityHealthAssessment {
            copy_provider_count: copies.into(),
            device_join_provider_count: joinable.into(),
            device_count: apps.into(),
            stored_item_count: items.into(),
            extension_installation: installation,
            extension_membership: membership,
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
            health.checklist.protections,
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
            health.checklist.protections,
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
            health.checklist.protections[0],
            step(
                IdentityProtectionTask::CopyOutsideBrowser,
                IdentityProtectionTaskState::Done,
                IdentityNextStep::AddSyncProvider,
            ),
            "until a second device joins, the kept copy offers another provider"
        );
        assert_eq!(
            health.checklist.protections[1],
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
        assert_eq!(
            health.checklist.protections[0].action,
            IdentityNextStep::Done,
            "a second device ends the offer of another provider"
        );
    }

    #[test]
    fn removing_the_last_provider_reopens_only_the_copy() {
        let health = assess(0, 0, 2, 5);

        assert_eq!(health.checklist.protections[0].state, IdentityProtectionTaskState::Open);
        assert_eq!(health.checklist.protections[1].state, IdentityProtectionTaskState::Done);
        assert!(!health.is_protected());
    }

    #[test]
    fn an_app_without_the_extension_lists_only_the_protections() {
        let health = assess(1, 1, 2, 5);

        assert_eq!(health.checklist.extension, IdentityExtensionStep::NotOffered);
        assert_eq!(health.checklist.steps().count(), 2);
        assert!(health.is_complete());
    }

    #[test]
    fn a_browser_without_the_extension_is_asked_to_install_it_last() {
        let health = with_extension(
            [0, 0, 1, 0],
            BrowserExtensionInstallation::NotInstalled,
            BrowserExtensionMembership::NotJoined,
        );

        let tasks: Vec<_> = health.checklist.steps().map(|step| step.task).collect();
        assert_eq!(
            tasks,
            [
                IdentityProtectionTask::CopyOutsideBrowser,
                IdentityProtectionTask::SecondDevice,
                IdentityProtectionTask::BrowserExtension,
            ]
        );
        assert_eq!(
            health.checklist.extension,
            IdentityExtensionStep::Offered(step(
                IdentityProtectionTask::BrowserExtension,
                IdentityProtectionTaskState::Open,
                IdentityNextStep::InstallExtension,
            ))
        );
    }

    #[test]
    fn an_installed_extension_that_has_not_joined_is_asked_to_connect() {
        let health = with_extension(
            [0, 0, 1, 0],
            BrowserExtensionInstallation::Installed,
            BrowserExtensionMembership::NotJoined,
        );

        assert_eq!(
            health.checklist.extension,
            IdentityExtensionStep::Offered(step(
                IdentityProtectionTask::BrowserExtension,
                IdentityProtectionTaskState::Open,
                IdentityNextStep::ConnectExtension,
            ))
        );
    }

    #[test]
    fn the_extension_never_changes_how_the_identity_is_protected() {
        let without = assess(0, 0, 1, 12);
        let with = with_extension(
            [0, 0, 1, 12],
            BrowserExtensionInstallation::NotInstalled,
            BrowserExtensionMembership::NotJoined,
        );

        assert_eq!(with.stage, without.stage);
        assert_eq!(with.next_step, IdentityNextStep::AddSyncProvider);
        assert_eq!(with.nudge, without.nudge);
        assert_eq!(with.checklist.protections, without.checklist.protections);
    }

    #[test]
    fn a_protected_identity_is_complete_only_once_the_extension_has_joined() {
        let waiting = with_extension(
            [1, 1, 2, 5],
            BrowserExtensionInstallation::Installed,
            BrowserExtensionMembership::NotJoined,
        );
        assert!(waiting.is_protected());
        assert!(!waiting.is_complete());

        let joined = with_extension(
            [1, 1, 2, 5],
            BrowserExtensionInstallation::Installed,
            BrowserExtensionMembership::Joined,
        );
        assert!(joined.is_complete());
    }

    #[test]
    fn a_joined_extension_that_was_removed_from_this_browser_asks_to_install_again() {
        let health = with_extension(
            [1, 1, 2, 5],
            BrowserExtensionInstallation::NotInstalled,
            BrowserExtensionMembership::Joined,
        );

        assert_eq!(
            health.checklist.extension,
            IdentityExtensionStep::Offered(step(
                IdentityProtectionTask::BrowserExtension,
                IdentityProtectionTaskState::Open,
                IdentityNextStep::InstallExtension,
            ))
        );
    }
}

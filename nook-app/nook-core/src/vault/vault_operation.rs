//! Portable vocabulary for vault operations deferred behind device protection.

use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::wasm_bindgen;

/// Whether a browser-held vault operation can run now or must wait until the
/// device identity has been unlocked.
#[wasm_bindgen]
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DeviceProtectedOperationState {
    #[default]
    Idle,
    WaitingForDevice,
}

impl DeviceProtectedOperationState {
    #[must_use]
    pub const fn is_waiting_for_device(self) -> bool {
        matches!(self, Self::WaitingForDevice)
    }
}

/// Vault creation operation whose browser-owned arguments may be retained
/// while device protection is unlocked.
#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PendingVaultCreationKind {
    Simple,
    Sentinel,
    SentinelParticipantKey,
    SentinelParticipantResponse,
    SentinelOnboarding,
}

impl PendingVaultCreationKind {
    /// Operations with a void-style completion can safely resume from a
    /// reactive browser effect. Participant operations return payloads to the
    /// initiating UI and therefore require an explicit retry by that caller.
    #[must_use]
    pub const fn resumes_automatically(self) -> bool {
        matches!(
            self,
            Self::Simple | Self::Sentinel | Self::SentinelOnboarding
        )
    }
}

#[cfg(test)]
mod tests {
    use super::{DeviceProtectedOperationState, PendingVaultCreationKind};

    #[test]
    fn only_waiting_state_requires_device_protection() {
        assert!(!DeviceProtectedOperationState::Idle.is_waiting_for_device());
        assert!(DeviceProtectedOperationState::WaitingForDevice.is_waiting_for_device());
    }

    #[test]
    fn automatic_resume_excludes_payload_returning_participant_operations() {
        for kind in [
            PendingVaultCreationKind::Simple,
            PendingVaultCreationKind::Sentinel,
            PendingVaultCreationKind::SentinelOnboarding,
        ] {
            assert!(kind.resumes_automatically());
        }
        for kind in [
            PendingVaultCreationKind::SentinelParticipantKey,
            PendingVaultCreationKind::SentinelParticipantResponse,
        ] {
            assert!(!kind.resumes_automatically());
        }
    }
}

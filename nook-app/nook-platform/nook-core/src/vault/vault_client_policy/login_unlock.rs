//! Portable unlock-method availability after successful vault access assessment.
use crate::VaultAccessStatus;
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LoginDeviceKeyAvailability {
    Enabled,
    Unavailable,
}
#[wasm_bindgen]
pub struct LoginUnlockDecision {
    pub device_keys: LoginDeviceKeyAvailability,
}
pub struct LoginUnlockAssessment {
    pub access: VaultAccessStatus,
}
impl LoginUnlockAssessment {
    #[must_use]
    pub fn decide(self) -> LoginUnlockDecision {
        LoginUnlockDecision {
            device_keys: match self.access {
                VaultAccessStatus::NeedsEnrollment | VaultAccessStatus::JoinPending => {
                    LoginDeviceKeyAvailability::Unavailable
                }
                VaultAccessStatus::NewVault
                | VaultAccessStatus::Ready
                | VaultAccessStatus::RemoteMissing
                | VaultAccessStatus::RemoteMissingLocalCache => LoginDeviceKeyAvailability::Enabled,
            },
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn membership_failures_make_device_keys_unavailable() {
        for access in [
            VaultAccessStatus::NeedsEnrollment,
            VaultAccessStatus::JoinPending,
        ] {
            assert_eq!(
                LoginUnlockAssessment { access }.decide().device_keys,
                LoginDeviceKeyAvailability::Unavailable
            );
        }
        assert_eq!(
            LoginUnlockAssessment {
                access: VaultAccessStatus::Ready
            }
            .decide()
            .device_keys,
            LoginDeviceKeyAvailability::Enabled
        );
    }
}

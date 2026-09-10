//! Portable unlock-method availability after successful vault access assessment.
use crate::VaultAccessStatus;
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PasswordEntryPresence {
    Absent,
    Present,
}
#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LoginDeviceKeyAvailability {
    Enabled,
    Unavailable,
}
#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LoginPasswordPromptUpdate {
    Preserve,
    Offer,
}
#[wasm_bindgen]
pub struct LoginUnlockDecision {
    pub device_keys: LoginDeviceKeyAvailability,
    pub password_prompt: LoginPasswordPromptUpdate,
}
pub struct LoginUnlockAssessment {
    pub access: VaultAccessStatus,
    pub passwords: PasswordEntryPresence,
}
impl LoginUnlockAssessment {
    #[must_use]
    pub fn decide(self) -> LoginUnlockDecision {
        let unavailable = match self.access {
            VaultAccessStatus::NeedsEnrollment | VaultAccessStatus::JoinPending => true,
            VaultAccessStatus::NewVault
            | VaultAccessStatus::Ready
            | VaultAccessStatus::RemoteMissing
            | VaultAccessStatus::RemoteMissingLocalCache => false,
        };
        LoginUnlockDecision {
            device_keys: if unavailable {
                LoginDeviceKeyAvailability::Unavailable
            } else {
                LoginDeviceKeyAvailability::Enabled
            },
            password_prompt: if unavailable && self.passwords == PasswordEntryPresence::Present {
                LoginPasswordPromptUpdate::Offer
            } else {
                LoginPasswordPromptUpdate::Preserve
            },
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn membership_failures_offer_available_passwords_without_resetting_other_prompts() {
        for access in [
            VaultAccessStatus::NeedsEnrollment,
            VaultAccessStatus::JoinPending,
        ] {
            let without = LoginUnlockAssessment {
                access,
                passwords: PasswordEntryPresence::Absent,
            }
            .decide();
            assert_eq!(without.device_keys, LoginDeviceKeyAvailability::Unavailable);
            assert_eq!(without.password_prompt, LoginPasswordPromptUpdate::Preserve);
            let with = LoginUnlockAssessment {
                access,
                passwords: PasswordEntryPresence::Present,
            }
            .decide();
            assert_eq!(with.password_prompt, LoginPasswordPromptUpdate::Offer);
        }
    }
}

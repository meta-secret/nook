//! Passkey attachment and backup-state browser projections.
use super::*;
#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookPasskeyAttachmentState {
    Unknown,
    Platform,
    CrossPlatform,
}
impl NookPasskeyAttachmentState {
    pub(super) fn attachment_state(
        value: nook_core::PasskeyAuthenticatorAttachment,
    ) -> NookPasskeyAttachmentState {
        match value {
            PasskeyAuthenticatorAttachment::Unknown => NookPasskeyAttachmentState::Unknown,
            PasskeyAuthenticatorAttachment::Platform => NookPasskeyAttachmentState::Platform,
            PasskeyAuthenticatorAttachment::CrossPlatform => {
                NookPasskeyAttachmentState::CrossPlatform
            }
        }
    }
}
#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookPasskeyBackupState {
    Unknown,
    NotEligible,
    Eligible,
    BackedUp,
}
impl NookPasskeyBackupState {
    pub(super) fn backup_state(value: nook_core::PasskeyBackupState) -> NookPasskeyBackupState {
        match value {
            PasskeyBackupState::Unknown => NookPasskeyBackupState::Unknown,
            PasskeyBackupState::NotEligible => NookPasskeyBackupState::NotEligible,
            PasskeyBackupState::Eligible => NookPasskeyBackupState::Eligible,
            PasskeyBackupState::BackedUp => NookPasskeyBackupState::BackedUp,
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use wasm_bindgen_test::wasm_bindgen_test;
    #[wasm_bindgen_test]
    fn attachment_and_backup_observations_cover_every_core_state() {
        for attachment in [
            PasskeyAuthenticatorAttachment::Unknown,
            PasskeyAuthenticatorAttachment::Platform,
            PasskeyAuthenticatorAttachment::CrossPlatform,
        ] {
            let _ = NookPasskeyAttachmentState::attachment_state(attachment);
        }
        for backup in [
            PasskeyBackupState::Unknown,
            PasskeyBackupState::NotEligible,
            PasskeyBackupState::Eligible,
            PasskeyBackupState::BackedUp,
        ] {
            let _ = NookPasskeyBackupState::backup_state(backup);
        }
    }
}

//! Semantic workflow evidence admitted from the fixed browser observation contract.
use super::*;

#[derive(Debug, Clone, Copy, Default)]
pub(super) struct AuthenticationWorkflowEvidence {
    pub username_field_count: AuthenticationFieldCount,
    pub current_password_field_count: AuthenticationFieldCount,
    pub new_password_field_count: AuthenticationFieldCount,
    pub generic_password_field_count: AuthenticationFieldCount,
    pub one_time_code_field_count: AuthenticationFieldCount,
    pub manual_checkpoint_present: AuthenticationManualCheckpoint,
    pub authenticator_setup_hint: AuthenticationAuthenticatorSetupObservation,
    pub backup_codes_hint: AuthenticationBackupCodesObservation,
    pub passkey_control_present: AuthenticationPasskeyControlObservation,
    pub matching_passkey_account_count: AuthenticationPasskeyAccountCount,
}
impl From<AuthenticationPageObservation> for AuthenticationWorkflowEvidence {
    fn from(wire: AuthenticationPageObservation) -> Self {
        Self {
            username_field_count: wire.username_field_count,
            current_password_field_count: wire.current_password_field_count,
            new_password_field_count: wire.new_password_field_count,
            generic_password_field_count: wire.generic_password_field_count,
            one_time_code_field_count: wire.one_time_code_field_count,
            manual_checkpoint_present: wire.manual_checkpoint_present.into(),
            authenticator_setup_hint: wire.authenticator_setup_hint.into(),
            backup_codes_hint: wire.backup_codes_hint.into(),
            passkey_control_present: wire.passkey_control_present.into(),
            matching_passkey_account_count: wire.matching_passkey_account_count,
        }
    }
}
impl From<bool> for AuthenticationManualCheckpoint {
    fn from(present: bool) -> Self {
        if present { Self::Present } else { Self::Absent }
    }
}
impl From<bool> for AuthenticationAuthenticatorSetupObservation {
    fn from(present: bool) -> Self {
        if present { Self::Present } else { Self::Absent }
    }
}
impl From<bool> for AuthenticationBackupCodesObservation {
    fn from(present: bool) -> Self {
        if present { Self::Present } else { Self::Absent }
    }
}
impl From<bool> for AuthenticationPasskeyControlObservation {
    fn from(present: bool) -> Self {
        if present { Self::Present } else { Self::Absent }
    }
}
impl AuthenticationWorkflowEvidence {
    #[must_use]
    pub(super) const fn password_field_count(self) -> AuthenticationFieldCount {
        AuthenticationFieldCount(
            self.current_password_field_count
                .raw()
                .saturating_add(self.new_password_field_count.raw())
                .saturating_add(self.generic_password_field_count.raw()),
        )
    }

    #[must_use]
    pub(super) const fn has_authentication_fields(self) -> bool {
        self.username_field_count.raw() > 0
            || self.password_field_count().raw() > 0
            || self.one_time_code_field_count.raw() > 0
            || matches!(
                self.authenticator_setup_hint,
                AuthenticationAuthenticatorSetupObservation::Present
            )
            || matches!(
                self.backup_codes_hint,
                AuthenticationBackupCodesObservation::Present
            )
            || matches!(
                self.passkey_control_present,
                AuthenticationPasskeyControlObservation::Present
            )
            || self.matching_passkey_account_count.raw() > 0
    }
}

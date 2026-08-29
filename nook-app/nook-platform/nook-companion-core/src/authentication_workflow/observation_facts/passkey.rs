use crate::authentication_workflow::AuthenticationPasskeyEvidence;
use crate::page_field_classification::{
    AuthenticationAdvanceControlObservation, authentication_passkey_control_is_safe,
};
use serde::{Deserialize, Serialize};
use tsify::Tsify;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum AuthenticationPasskeyControlObservation {
    #[default]
    Absent,
    Present,
}

/// Detailed browser evidence for the passkey control selected by the host.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, Tsify)]
#[serde(tag = "kind", content = "observation", rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum AuthenticationDetailedPasskeyControlObservation {
    #[default]
    Absent,
    Observed(AuthenticationAdvanceControlObservation),
}

impl AuthenticationDetailedPasskeyControlObservation {
    fn is_safe(&self) -> bool {
        matches!(self, Self::Observed(observation) if authentication_passkey_control_is_safe(observation))
    }

    pub(super) fn is_bounded(&self) -> bool {
        matches!(self, Self::Absent)
            || matches!(self, Self::Observed(observation) if observation.is_bounded())
    }

    pub(super) fn evidence(&self, matching_account_count: u32) -> AuthenticationPasskeyEvidence {
        match (self.is_safe(), matching_account_count) {
            (true, account_count) if account_count > 0 => {
                AuthenticationPasskeyEvidence::ControlAndVaultAccounts { account_count }
            }
            (true, _) => AuthenticationPasskeyEvidence::Control,
            (false, account_count) if account_count > 0 => {
                AuthenticationPasskeyEvidence::VaultAccounts { account_count }
            }
            (false, _) => AuthenticationPasskeyEvidence::Absent,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        AuthenticationUsernameEvidence, PageControlActionability, PageControlOwnership,
        PageControlSemantics,
    };

    fn control(label: &str, destination_identity: &str) -> AuthenticationAdvanceControlObservation {
        AuthenticationAdvanceControlObservation {
            actionability: PageControlActionability::Actionable,
            ownership: PageControlOwnership::OwnedForm,
            semantics: PageControlSemantics::Activation,
            authentication_username: AuthenticationUsernameEvidence::Absent,
            password_field_count: 0,
            new_password_field_count: 0,
            one_time_code_field_count: 0,
            semantic_submit_control_count: 0,
            source_origin: "https://example.test".to_owned(),
            form_identity: "passkey login".to_owned(),
            destination_identity: destination_identity.to_owned(),
            label: label.to_owned(),
        }
    }

    #[test]
    fn destructive_passkey_controls_never_become_proposal_evidence() {
        for (label, destination) in [
            ("Delete passkey", "/login"),
            ("Revoke passkey", "/login"),
            ("Use passkey", "/auth/delete-passkey"),
        ] {
            let detailed = AuthenticationDetailedPasskeyControlObservation::Observed(control(
                label,
                destination,
            ));
            assert_eq!(detailed.evidence(0), AuthenticationPasskeyEvidence::Absent);
            assert_eq!(
                detailed.evidence(2),
                AuthenticationPasskeyEvidence::VaultAccounts { account_count: 2 }
            );
        }

        let safe = AuthenticationDetailedPasskeyControlObservation::Observed(control(
            "Use passkey",
            "/login",
        ));
        assert_eq!(safe.evidence(0), AuthenticationPasskeyEvidence::Control);
    }
}

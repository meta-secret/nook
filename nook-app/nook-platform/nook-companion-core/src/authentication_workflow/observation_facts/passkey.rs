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
    pub(super) fn is_bounded(&self) -> bool {
        matches!(self, Self::Absent)
            || matches!(self, Self::Observed(observation) if observation.is_bounded())
    }

    pub(super) fn evidence(&self, matching_account_count: u32) -> AuthenticationPasskeyEvidence {
        match (self, matching_account_count) {
            (Self::Observed(observation), account_count)
                if authentication_passkey_control_is_safe(observation) && account_count > 0 =>
            {
                AuthenticationPasskeyEvidence::ControlAndVaultAccounts { account_count }
            }
            (Self::Observed(observation), _)
                if authentication_passkey_control_is_safe(observation) =>
            {
                AuthenticationPasskeyEvidence::Control
            }
            (Self::Absent, account_count) if account_count > 0 => {
                AuthenticationPasskeyEvidence::VaultAccounts { account_count }
            }
            (Self::Absent | Self::Observed(_), _) => AuthenticationPasskeyEvidence::Absent,
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
            destination_identity: if destination_identity.contains("://") {
                destination_identity.to_owned()
            } else {
                let separator = if destination_identity.starts_with('/') {
                    ""
                } else {
                    "/"
                };
                format!("https://example.test{separator}{destination_identity}")
            },
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
            assert_eq!(detailed.evidence(2), AuthenticationPasskeyEvidence::Absent);
        }

        let safe = AuthenticationDetailedPasskeyControlObservation::Observed(control(
            "Use passkey",
            "/login",
        ));
        assert_eq!(safe.evidence(0), AuthenticationPasskeyEvidence::Control);
        assert_eq!(
            AuthenticationDetailedPasskeyControlObservation::Absent.evidence(2),
            AuthenticationPasskeyEvidence::VaultAccounts { account_count: 2 }
        );
    }
}

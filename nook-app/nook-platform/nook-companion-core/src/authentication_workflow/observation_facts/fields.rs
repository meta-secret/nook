use crate::AuthenticationFieldCount;
use crate::page_field_classification::{
    AuthenticationAdvanceControlObservation, AuthenticationUsernameEvidence, PageControlOwnership,
    PageControlSubmissionMethod,
};
use serde::{Deserialize, Serialize};
use tsify::Tsify;

/// Raw, non-secret field facts observed inside one authentication scope.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct AuthenticationFieldObservationFacts {
    pub username_field_count: AuthenticationFieldCount,
    pub current_password_field_count: AuthenticationFieldCount,
    pub new_password_field_count: AuthenticationFieldCount,
    pub generic_password_field_count: AuthenticationFieldCount,
    pub one_time_code_field_count: AuthenticationFieldCount,
    /// Password fields that remain writable and eligible for credential disclosure.
    pub actionable_password_field_count: AuthenticationFieldCount,
    /// Password fields whose current `readonly` state prevents credential disclosure.
    pub readonly_password_field_count: AuthenticationFieldCount,
}

impl AuthenticationFieldObservationFacts {
    fn username_fields_match(self, observation: &AuthenticationAdvanceControlObservation) -> bool {
        if matches!(
            observation.submission_method,
            PageControlSubmissionMethod::Get
        ) || observation.is_microsoft_consumer_root_identifier_advance()
        {
            return self.username_field_count.raw() == 1
                && matches!(
                    observation.authentication_username,
                    AuthenticationUsernameEvidence::Strong
                        | AuthenticationUsernameEvidence::MixedPhoneOrEmail
                        | AuthenticationUsernameEvidence::WebAuthnEmail
                        | AuthenticationUsernameEvidence::Explicit
                );
        }
        (self.username_field_count.raw() > 0)
            != matches!(
                observation.authentication_username,
                AuthenticationUsernameEvidence::Absent
            )
    }

    pub(super) fn is_bounded(self) -> bool {
        let password_field_count = self
            .current_password_field_count
            .raw()
            .saturating_add(self.new_password_field_count.raw())
            .saturating_add(self.generic_password_field_count.raw());
        let counts_are_bounded = [
            self.username_field_count.raw(),
            self.current_password_field_count.raw(),
            self.new_password_field_count.raw(),
            self.generic_password_field_count.raw(),
            self.one_time_code_field_count.raw(),
            password_field_count,
            self.actionable_password_field_count.raw(),
            self.readonly_password_field_count.raw(),
        ]
        .into_iter()
        .all(|count| count <= crate::MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT);
        counts_are_bounded
            && self
                .actionable_password_field_count
                .raw()
                .saturating_add(self.readonly_password_field_count.raw())
                == password_field_count
    }

    /// Validate that detailed control evidence describes these same fields and scope.
    #[must_use]
    pub fn is_compatible_with_detailed_control(
        self,
        observation: &AuthenticationAdvanceControlObservation,
    ) -> bool {
        self.current_password_field_count
            .raw()
            .saturating_add(self.generic_password_field_count.raw())
            .saturating_add(self.new_password_field_count.raw())
            == observation.password_field_count.raw()
            && self.new_password_field_count == observation.new_password_field_count
            && self.one_time_code_field_count == observation.one_time_code_field_count
            && self.username_fields_match(observation)
            && matches!(
                observation.ownership,
                PageControlOwnership::OwnedForm | PageControlOwnership::LocallyScoped
            )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        AuthenticationDetailedAdvanceControlObservation, AuthenticationPageObservationFacts,
        AuthenticationPageObservationFactsBatch, AuthenticationWorkflowKind,
        AuthenticationWorkflowMatch, PageControlActionability, PageControlSemantics,
        PageControlSubmissionDestinationSource,
    };

    #[test]
    fn mixed_phone_or_email_get_matches_login_without_admitting_weak_evidence() {
        let facts_for = |authentication_username| AuthenticationPageObservationFacts {
            fields: AuthenticationFieldObservationFacts {
                username_field_count: 1.into(),
                ..Default::default()
            },
            detailed_advance_control: AuthenticationDetailedAdvanceControlObservation::observed(
                AuthenticationAdvanceControlObservation {
                    actionability: PageControlActionability::Actionable,
                    ownership: PageControlOwnership::OwnedForm,
                    semantics: PageControlSemantics::SemanticSubmit,
                    authentication_username,
                    password_field_count: 0.into(),
                    new_password_field_count: 0.into(),
                    one_time_code_field_count: 0.into(),
                    semantic_submit_control_count: 1.into(),
                    source_origin: "https://www.airbnb.com".to_owned(),
                    form_identity: String::new(),
                    destination_identity: "https://www.airbnb.com/login".to_owned(),
                    label: "Continue".to_owned(),
                    machine_identity: String::new(),
                    submission_method: PageControlSubmissionMethod::Get,
                    submission_destination_source: PageControlSubmissionDestinationSource::Omitted,
                },
            ),
            ..Default::default()
        };
        assert!(matches!(
            AuthenticationPageObservationFactsBatch {
                observations: vec![facts_for(AuthenticationUsernameEvidence::MixedPhoneOrEmail)],
            }
            .classify(),
            AuthenticationWorkflowMatch::Matched(snapshot)
                if snapshot.kind == AuthenticationWorkflowKind::Login
        ));
        for evidence in [
            AuthenticationUsernameEvidence::Absent,
            AuthenticationUsernameEvidence::Generic,
            AuthenticationUsernameEvidence::StandardsBasedEmail,
        ] {
            assert_eq!(
                AuthenticationPageObservationFactsBatch {
                    observations: vec![facts_for(evidence)],
                }
                .classify(),
                AuthenticationWorkflowMatch::NoMatch
            );
        }
    }
}

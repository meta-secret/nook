use super::{
    AuthenticationAdvanceControlObservation, AuthenticationUsernameEvidence,
    PageControlSubmissionDestinationSource, PageControlSubmissionMethod,
};
use crate::AuthenticationFieldCount;
use url::Url;

impl AuthenticationAdvanceControlObservation {
    /// UTF-8 byte limit matching the browser's complete machine-identity sensor envelope.
    const MAX_MACHINE_IDENTITY_BYTES: usize = 1024;
    /// Whether DOM-controlled text and bounded field counts fit the observation envelope.
    #[must_use]
    pub fn is_bounded(&self) -> bool {
        self.source_origin.len() <= super::super::MAX_AUTHENTICATION_CONTROL_TEXT_BYTES
            && self.form_identity.len() <= super::super::MAX_AUTHENTICATION_CONTROL_TEXT_BYTES
            && self.destination_identity.len()
                <= super::super::MAX_AUTHENTICATION_DESTINATION_TEXT_BYTES
            && self.label.len() <= super::super::MAX_AUTHENTICATION_CONTROL_TEXT_BYTES
            && (self.machine_identity.len() <= Self::MAX_MACHINE_IDENTITY_BYTES
                || match self.microsoft_authorization_admission() {
                    super::microsoft::MicrosoftAuthorizationAdmission::IdentifierAdvance => true,
                    super::microsoft::MicrosoftAuthorizationAdmission::Unrelated => false,
                })
            && [
                self.password_field_count,
                self.new_password_field_count,
                self.one_time_code_field_count,
            ]
            .into_iter()
            .all(AuthenticationFieldCount::is_within_observation_limit)
            && self
                .semantic_submit_control_count
                .is_within_observation_limit()
    }

    pub(super) fn is_extended_identifier_only_get_advance(&self) -> bool {
        let Ok(destination) = Url::parse(&self.destination_identity) else {
            return false;
        };
        let mut query = destination.query_pairs();
        let has_exact_booking_token = query
            .next()
            .is_some_and(|(key, value)| key == "op_token" && !value.is_empty())
            && query.next().is_none();
        matches!(self.submission_method, PageControlSubmissionMethod::Get)
            && matches!(
                self.submission_destination_source,
                PageControlSubmissionDestinationSource::Omitted
            )
            && matches!(
                self.authentication_username,
                AuthenticationUsernameEvidence::Explicit
            )
            && self.source_origin == "https://account.booking.com"
            && destination.scheme() == "https"
            && destination.host_str() == Some("account.booking.com")
            && destination.path() == "/sign-in"
            && destination.fragment().is_none()
            && has_exact_booking_token
            && self.has_booking_identifier_form_identity()
            && self.is_identifier_only_get_advance()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        AuthenticationAdvanceControlDecision, AuthenticationDetailedAdvanceControlObservation,
        AuthenticationFieldObservationFacts, AuthenticationPageObservationFacts,
        AuthenticationPageObservationFactsBatch, AuthenticationWorkflowKind,
        AuthenticationWorkflowMatch, PageControlActionability, PageControlOwnership,
        PageControlSemantics,
    };

    #[derive(Clone, Copy)]
    struct IdentifierShell {
        form_identity: &'static str,
        machine_identity: &'static str,
    }

    impl IdentifierShell {
        const CAPTURED: Self = Self {
            form_identity: "reset_base__1e6d9s10 sprinkles_gap_medium_xs__omrdfn1zo sprinkles_minWidth_0_xs__omrdfn21u sprinkles_display_flex_xs__omrdfn6 sprinkles_flexDirection_column_xs__omrdfn9c sprinkles_flexWrap_wrap_xs__omrdfnco knox-reset",
            machine_identity: "reset_base__1e6d9s10 reset_button__1e6d9s16 sprinkles_position_relative_xs__omrdfn14o sprinkles_focusable_on__omrdfn2b1 button_button__wk7g87 sprinkles_display_inline-flex_xs__omrdfnu sprinkles_alignItems_center_xs__omrdfn7o sprinkles_justifyContent_flex-start_xs__omrdfn1i button_button_active_false__wk7g8i button_button_color_default__wk7g88 button_button_hover_false__wk7g8m button_button_size_large__wk7g8u sprinkles_paddingInlineStart_medium_xs__omrdfn11c sprinkles_paddingInlineEnd_medium_xs__omrdfn13i button_button_variant_primary__wk7g8c button_button_disabled_false__wk7g8o button_button_fullWidth_false__wk7g8q button_button_isIconOnly_false__wk7g8s button_button_isLink_false__wk7g8k button_button_compound_1__wk7g8w knox-reset",
        };
    }
    impl From<IdentifierShell> for AuthenticationAdvanceControlObservation {
        fn from(shell: IdentifierShell) -> Self {
            AuthenticationAdvanceControlObservation {
                actionability: PageControlActionability::Actionable,
                ownership: PageControlOwnership::LocallyScoped,
                semantics: PageControlSemantics::Activation,
                authentication_username: AuthenticationUsernameEvidence::Explicit,
                password_field_count: 0.into(),
                new_password_field_count: 0.into(),
                one_time_code_field_count: 0.into(),
                semantic_submit_control_count: 0.into(),
                source_origin: "https://my.1password.com".to_owned(),
                form_identity: shell.form_identity.to_owned(),
                destination_identity: "https://my.1password.com/signin".to_owned(),
                label: "Continue".to_owned(),
                machine_identity: shell.machine_identity.to_owned(),
                submission_method: PageControlSubmissionMethod::Absent,
                submission_destination_source: PageControlSubmissionDestinationSource::Omitted,
            }
        }
    }

    #[test]
    fn identifier_continue_preserves_full_bounded_machine_metadata() {
        let mut control = AuthenticationAdvanceControlObservation::from(IdentifierShell::CAPTURED);
        assert_eq!(control.machine_identity.len(), 740);
        assert!(control.is_bounded());
        assert_eq!(
            control.classify(),
            AuthenticationAdvanceControlDecision::AdvancesAuthentication
        );
        control.machine_identity = "é".repeat(512);
        assert!(control.is_bounded());
        assert_eq!(
            control.classify(),
            AuthenticationAdvanceControlDecision::AdvancesAuthentication
        );
        control.machine_identity.push('é');
        assert!(!control.is_bounded());
        control.machine_identity = "a".repeat(1025);
        assert!(!control.is_bounded());
    }

    #[test]
    fn identifier_shell_cannot_advance_password_recovery_routes_or_surfaces() {
        let mut control = AuthenticationAdvanceControlObservation::from(IdentifierShell::CAPTURED);
        control.destination_identity = "https://my.1password.com/reset".to_owned();
        assert_eq!(
            control.classify(),
            AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication
        );
        control = AuthenticationAdvanceControlObservation::from(IdentifierShell::CAPTURED);
        control.form_identity = "reset-password-form".to_owned();
        assert_eq!(
            control.classify(),
            AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication
        );
    }

    #[test]
    fn full_machine_metadata_retains_vetoes_and_independent_envelope_limits() {
        for veto in [
            "delete-account",
            "provider=google",
            "reset-password",
            "signup",
        ] {
            let mut control =
                AuthenticationAdvanceControlObservation::from(IdentifierShell::CAPTURED);
            control.machine_identity = format!("{} {veto}", "a".repeat(900));
            assert!(control.is_bounded());
            assert_eq!(
                control.classify(),
                AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication,
                "{veto}"
            );
        }
        let mut control = AuthenticationAdvanceControlObservation::from(IdentifierShell::CAPTURED);
        control.machine_identity = "a".repeat(1024);
        assert!(control.is_bounded());
        control.label = "a".repeat(crate::MAX_AUTHENTICATION_CONTROL_TEXT_BYTES + 1);
        assert!(!control.is_bounded());
        control = AuthenticationAdvanceControlObservation::from(IdentifierShell::CAPTURED);
        control.password_field_count = (crate::MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT + 1).into();
        assert!(!control.is_bounded());
    }

    #[test]
    fn longer_machine_identity_does_not_expand_workflow_aggregate_limits() {
        let facts = AuthenticationPageObservationFacts {
            fields: AuthenticationFieldObservationFacts {
                username_field_count: 1.into(),
                ..Default::default()
            },
            detailed_advance_control: AuthenticationDetailedAdvanceControlObservation::observed(
                AuthenticationAdvanceControlObservation::from(IdentifierShell::CAPTURED),
            ),
            ..Default::default()
        };
        assert!(facts.authentication_page_observation_facts_is_admissible());
        assert!(
            matches!(AuthenticationPageObservationFactsBatch { observations: vec![facts.clone()] }.classify(), AuthenticationWorkflowMatch::Matched(snapshot) if snapshot.kind == AuthenticationWorkflowKind::Login)
        );
        let too_many_controls = AuthenticationPageObservationFacts {
            detailed_advance_control: AuthenticationDetailedAdvanceControlObservation::Observed(
                vec![
                    AuthenticationAdvanceControlObservation::from(IdentifierShell::CAPTURED);
                    crate::MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT as usize + 1
                ],
            ),
            ..Default::default()
        };
        assert!(!too_many_controls.authentication_page_observation_facts_is_admissible());
        let batch = AuthenticationPageObservationFactsBatch {
            observations: vec![facts; crate::MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS + 1],
        };
        assert_eq!(batch.classify(), AuthenticationWorkflowMatch::Rejected);
    }
}

use std::cmp::Ordering;

use super::{
    AuthenticationAdvanceControlObservation, AuthenticationUsernameEvidence,
    PageControlActionability, PageControlOwnership, PageControlSemantics,
    PageControlSubmissionDestinationSource, PageControlSubmissionMethod,
};
use crate::page_field_classification::{
    control_identity::AuthenticationControlIdentity,
    destination_identity::{CanonicalControlDestination, MicrosoftConsumerLoginDestination},
};
use crate::{AuthenticationControlText, ControlDestinationEvidence};

struct MicrosoftObservationByteLimit(usize);

impl MicrosoftObservationByteLimit {
    const DESTINATION: Self = Self(4096);
    const MACHINE_IDENTITY: Self = Self(1024);

    fn classify(&self, text: &str) -> MicrosoftTextBound {
        match text.len().cmp(&self.0) {
            Ordering::Less | Ordering::Equal => MicrosoftTextBound::WithinLimit,
            Ordering::Greater => MicrosoftTextBound::ExceedsLimit,
        }
    }
}

enum MicrosoftTextBound {
    WithinLimit,
    ExceedsLimit,
}
enum MicrosoftIdentifierSubmitShape {
    IdentifierSubmit,
    Unrelated,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum MicrosoftAuthorizationAdmission {
    IdentifierAdvance,
    Unrelated,
}

/// Provider interpretation of a form identity on the verified Microsoft route.
/// Numeric x hash segments are not the whole semantic X provider token.
struct MicrosoftFormProviderIdentity<'a>(&'a str);

impl MicrosoftFormProviderIdentity<'_> {
    fn semantic_identity(&self) -> String {
        let characters = self.0.chars().collect::<Vec<_>>();
        let semantic = characters
            .iter()
            .enumerate()
            .map(|(index, character)| match character {
                'x' if matches!(characters.get(index.wrapping_sub(1)), Some('0'..='9'))
                    && matches!(characters.get(index + 1), Some('0'..='9')) =>
                {
                    '0'
                }
                _ => *character,
            })
            .collect::<String>();
        semantic
            .split_whitespace()
            .map(|token| match token {
                "xcom" => "x com",
                _ => token,
            })
            .collect::<Vec<_>>()
            .join(" ")
    }
}

impl AuthenticationAdvanceControlObservation {
    pub(super) fn authentication_policy_form_provider_identity(&self) -> String {
        match self.microsoft_authorization_admission() {
            MicrosoftAuthorizationAdmission::IdentifierAdvance => {
                MicrosoftFormProviderIdentity(&self.form_identity).semantic_identity()
            }
            MicrosoftAuthorizationAdmission::Unrelated => self.form_identity.clone(),
        }
    }

    pub(super) fn microsoft_authorization_admission(&self) -> MicrosoftAuthorizationAdmission {
        let Ok(destination) = CanonicalControlDestination::canonicalize_control_destination(
            ControlDestinationEvidence {
                source_origin: &self.source_origin,
                destination_identity: &self.destination_identity,
            },
        ) else {
            return MicrosoftAuthorizationAdmission::Unrelated;
        };
        let label = AuthenticationControlText::new(&self.label).expand_identity_text();
        match (
            destination.microsoft_authorization_destination(),
            MicrosoftObservationByteLimit::DESTINATION.classify(&self.destination_identity),
            MicrosoftObservationByteLimit::MACHINE_IDENTITY.classify(&self.machine_identity),
            self.submission_destination_source,
            label.as_str(),
            self.microsoft_identifier_submit_shape(),
        ) {
            (
                MicrosoftConsumerLoginDestination::IdentifierEntry,
                MicrosoftTextBound::WithinLimit,
                MicrosoftTextBound::WithinLimit,
                PageControlSubmissionDestinationSource::Omitted,
                "next",
                MicrosoftIdentifierSubmitShape::IdentifierSubmit,
            ) => MicrosoftAuthorizationAdmission::IdentifierAdvance,
            (MicrosoftConsumerLoginDestination::Unrelated, _, _, _, _, _)
            | (_, MicrosoftTextBound::ExceedsLimit, _, _, _, _)
            | (_, _, MicrosoftTextBound::ExceedsLimit, _, _, _)
            | (_, _, _, PageControlSubmissionDestinationSource::Authored, _, _)
            | (_, _, _, _, _, MicrosoftIdentifierSubmitShape::Unrelated)
            | (
                MicrosoftConsumerLoginDestination::IdentifierEntry,
                MicrosoftTextBound::WithinLimit,
                MicrosoftTextBound::WithinLimit,
                PageControlSubmissionDestinationSource::Omitted,
                _,
                MicrosoftIdentifierSubmitShape::IdentifierSubmit,
            ) => MicrosoftAuthorizationAdmission::Unrelated,
        }
    }

    fn microsoft_identifier_submit_shape(&self) -> MicrosoftIdentifierSubmitShape {
        match (
            self.actionability,
            self.ownership,
            self.semantics,
            self.submission_method,
            self.authentication_username,
            self.password_field_count.is_zero(),
            self.new_password_field_count.is_zero(),
            self.one_time_code_field_count.is_zero(),
            self.semantic_submit_control_count.is_single(),
        ) {
            (
                PageControlActionability::Actionable,
                PageControlOwnership::OwnedForm | PageControlOwnership::LocallyScoped,
                PageControlSemantics::SemanticSubmit,
                PageControlSubmissionMethod::Post,
                AuthenticationUsernameEvidence::Strong | AuthenticationUsernameEvidence::Explicit,
                true,
                true,
                true,
                true,
            ) => MicrosoftIdentifierSubmitShape::IdentifierSubmit,
            (PageControlActionability::Inert, _, _, _, _, _, _, _, _)
            | (_, PageControlOwnership::Unowned, _, _, _, _, _, _, _)
            | (_, _, PageControlSemantics::Activation, _, _, _, _, _, _)
            | (
                _,
                _,
                _,
                PageControlSubmissionMethod::Absent
                | PageControlSubmissionMethod::Get
                | PageControlSubmissionMethod::Dialog,
                _,
                _,
                _,
                _,
                _,
            )
            | (
                _,
                _,
                _,
                _,
                AuthenticationUsernameEvidence::Absent
                | AuthenticationUsernameEvidence::Generic
                | AuthenticationUsernameEvidence::StandardsBasedEmail
                | AuthenticationUsernameEvidence::MixedPhoneOrEmail
                | AuthenticationUsernameEvidence::WebAuthnEmail,
                _,
                _,
                _,
                _,
            )
            | (
                PageControlActionability::Actionable,
                PageControlOwnership::OwnedForm | PageControlOwnership::LocallyScoped,
                PageControlSemantics::SemanticSubmit,
                PageControlSubmissionMethod::Post,
                AuthenticationUsernameEvidence::Strong | AuthenticationUsernameEvidence::Explicit,
                _,
                _,
                _,
                _,
            ) => MicrosoftIdentifierSubmitShape::Unrelated,
        }
    }

    pub(crate) fn has_microsoft_consumer_identifier_context(&self) -> bool {
        match self.microsoft_authorization_admission() {
            MicrosoftAuthorizationAdmission::IdentifierAdvance => return true,
            MicrosoftAuthorizationAdmission::Unrelated => {}
        }
        self.form_identity.is_empty()
            && CanonicalControlDestination::canonicalize_control_destination(
                ControlDestinationEvidence {
                    source_origin: &self.source_origin,
                    destination_identity: &self.destination_identity,
                },
            )
            .is_ok_and(|destination| {
                destination.is_microsoft_consumer_login_root
                    || matches!(
                        destination.microsoft_consumer_login_destination(),
                        MicrosoftConsumerLoginDestination::IdentifierEntry
                    )
            })
    }

    pub(crate) fn is_microsoft_consumer_root_identifier_advance(&self) -> bool {
        match self.microsoft_authorization_admission() {
            MicrosoftAuthorizationAdmission::IdentifierAdvance => return true,
            MicrosoftAuthorizationAdmission::Unrelated => {}
        }
        let Ok(destination) = CanonicalControlDestination::canonicalize_control_destination(
            ControlDestinationEvidence {
                source_origin: &self.source_origin,
                destination_identity: &self.destination_identity,
            },
        ) else {
            return false;
        };
        matches!(
            destination.microsoft_consumer_login_destination(),
            MicrosoftConsumerLoginDestination::IdentifierEntry
        ) && self.form_identity.is_empty()
            && matches!(self.actionability, PageControlActionability::Actionable)
            && matches!(
                self.ownership,
                PageControlOwnership::OwnedForm | PageControlOwnership::LocallyScoped
            )
            && matches!(self.semantics, PageControlSemantics::SemanticSubmit)
            && matches!(self.submission_method, PageControlSubmissionMethod::Post)
            && matches!(
                self.authentication_username,
                AuthenticationUsernameEvidence::Strong | AuthenticationUsernameEvidence::Explicit
            )
            && self.password_field_count.is_zero()
            && self.new_password_field_count.is_zero()
            && self.one_time_code_field_count.is_zero()
            && self.semantic_submit_control_count.is_single()
            && (AuthenticationControlText::new(&self.label).expand_identity_text() == "next"
                || AuthenticationControlIdentity::new(&self.label).is_explicit_advance())
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use crate::{
        AuthenticationAdvanceControlDecision, AuthenticationDetailedAdvanceControlObservation,
        AuthenticationFieldObservationFacts, AuthenticationPageObservationFacts,
        AuthenticationPageObservationFactsBatch, AuthenticationWorkflowKind,
        AuthenticationWorkflowMatch, PageControlSubmissionDestinationSource,
    };

    struct LiveMicrosoftScenario;

    impl LiveMicrosoftScenario {
        fn observation() -> anyhow::Result<AuthenticationAdvanceControlObservation> {
            // Captured public structure and protocol metadata; opaque query values are
            // replaced without changing encoded lengths. No session value is retained.
            Ok(serde_json::from_str(include_str!(
                "microsoft/live-observation.json"
            ))?)
        }

        fn facts(
            control: AuthenticationAdvanceControlObservation,
        ) -> AuthenticationPageObservationFacts {
            AuthenticationPageObservationFacts {
                fields: AuthenticationFieldObservationFacts {
                    username_field_count: 1.into(),
                    ..Default::default()
                },
                detailed_advance_control: AuthenticationDetailedAdvanceControlObservation::observed(
                    control,
                ),
                ..Default::default()
            }
        }
    }

    #[test]
    fn captured_microsoft_shape_advances_with_joint_and_independent_live_evidence()
    -> anyhow::Result<()> {
        let live = LiveMicrosoftScenario::observation()?;
        assert_eq!(live.destination_identity.len(), 2141);
        assert_eq!(live.machine_identity.len(), 581);
        let short = "https://login.live.com/oauth20_authorize.srf?scope=openid+profile";
        for (destination, form, machine) in [
            (
                live.destination_identity.as_str(),
                live.form_identity.as_str(),
                live.machine_identity.as_str(),
            ),
            (
                short,
                live.form_identity.as_str(),
                live.machine_identity.as_str(),
            ),
            (
                live.destination_identity.as_str(),
                "",
                live.machine_identity.as_str(),
            ),
            (
                live.destination_identity.as_str(),
                live.form_identity.as_str(),
                "",
            ),
            (short, "", live.machine_identity.as_str()),
            (short, live.form_identity.as_str(), ""),
            (live.destination_identity.as_str(), "", ""),
            (short, "", ""),
        ] {
            let mut control = live.clone();
            control.destination_identity = destination.to_owned();
            control.form_identity = form.to_owned();
            control.machine_identity = machine.to_owned();
            assert_eq!(
                control.classify(),
                AuthenticationAdvanceControlDecision::AdvancesAuthentication
            );
        }
        assert!(
            matches!(AuthenticationPageObservationFactsBatch { observations: vec![LiveMicrosoftScenario::facts(live)] }.classify(), AuthenticationWorkflowMatch::Matched(snapshot) if snapshot.kind == AuthenticationWorkflowKind::Login)
        );
        Ok(())
    }

    #[test]
    fn live_microsoft_vetoes_survive_long_generated_identities() -> anyhow::Result<()> {
        let live = LiveMicrosoftScenario::observation()?;
        for suffix in [
            "&action=profile",
            "&other=profile",
            "&action=form_post",
            "&other=form_post",
            "&response_mode=%ZZ",
            "&response_mode=delete-account",
            "&provider=google",
            "&scope=passkey",
            "&action=%ZZ",
            "#login",
        ] {
            let mut rejected = live.clone();
            rejected.destination_identity.pop();
            rejected.destination_identity.push_str(suffix);
            assert_eq!(
                rejected.classify(),
                AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication,
                "{suffix}"
            );
        }
        for form in [
            "newsletter",
            "signup",
            "account-settings",
            "delete-account",
            "google-login",
            "continue-with-passkey",
            "x",
            "x-com",
            "xcom",
            "facebook1",
            "f1facebook1",
            "f1delete1",
            "form_delete1",
            "fly5x3f google-login",
            "fly5x3f delete-account",
            "fly5x3f passkey",
        ] {
            let mut rejected = live.clone();
            rejected.form_identity = form.to_owned();
            assert_eq!(
                rejected.classify(),
                AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication,
                "{form}"
            );
        }
        for machine in [
            "google-login",
            "delete-account",
            "continue-with-passkey",
            "cancel",
        ] {
            let mut rejected = live.clone();
            rejected.machine_identity.push(' ');
            rejected.machine_identity.push_str(machine);
            assert_eq!(
                rejected.classify(),
                AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication
            );
        }
        for identity in [
            "facebook1",
            "fpassword1",
            "fdelete1",
            "form_delete1",
            "x",
            "passkey",
        ] {
            assert_eq!(
                MicrosoftFormProviderIdentity(identity).semantic_identity(),
                identity
            );
        }
        for destination in [
            "https://example.test/oauth20_authorize.srf",
            "https://login.live.com/unrelated",
            "https://login.live.com:8443/oauth20_authorize.srf",
            "http://login.live.com/oauth20_authorize.srf",
            "https://nested.login.live.com/oauth20_authorize.srf",
        ] {
            let mut rejected = live.clone();
            rejected.destination_identity = destination.to_owned();
            assert_eq!(
                rejected.classify(),
                AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication
            );
        }
        Ok(())
    }

    #[test]
    fn live_microsoft_preserves_native_method_control_and_field_requirements() -> anyhow::Result<()>
    {
        let live = LiveMicrosoftScenario::observation()?;
        for mutate in [
            |c: &mut AuthenticationAdvanceControlObservation| {
                c.submission_method = PageControlSubmissionMethod::Get;
            },
            |c: &mut AuthenticationAdvanceControlObservation| {
                c.submission_destination_source = PageControlSubmissionDestinationSource::Authored;
            },
            |c: &mut AuthenticationAdvanceControlObservation| {
                c.semantics = PageControlSemantics::Activation;
            },
            |c: &mut AuthenticationAdvanceControlObservation| {
                c.actionability = PageControlActionability::Inert;
            },
            |c: &mut AuthenticationAdvanceControlObservation| {
                c.ownership = PageControlOwnership::Unowned;
            },
            |c: &mut AuthenticationAdvanceControlObservation| {
                c.authentication_username = AuthenticationUsernameEvidence::Generic;
            },
            |c: &mut AuthenticationAdvanceControlObservation| c.password_field_count = 1.into(),
            |c: &mut AuthenticationAdvanceControlObservation| c.new_password_field_count = 1.into(),
            |c: &mut AuthenticationAdvanceControlObservation| {
                c.one_time_code_field_count = 1.into();
            },
            |c: &mut AuthenticationAdvanceControlObservation| {
                c.semantic_submit_control_count = 2.into();
            },
            |c: &mut AuthenticationAdvanceControlObservation| c.label = "Continue".to_owned(),
        ] {
            let mut rejected = live.clone();
            mutate(&mut rejected);
            assert_eq!(
                rejected.classify(),
                AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication
            );
        }
        for count in [0, 2] {
            let mut facts = LiveMicrosoftScenario::facts(live.clone());
            facts.fields.username_field_count = count.into();
            assert!(!matches!(
                AuthenticationPageObservationFactsBatch {
                    observations: vec![facts]
                }
                .classify(),
                AuthenticationWorkflowMatch::Matched(_)
            ));
        }
        Ok(())
    }

    #[test]
    fn live_microsoft_limits_are_exact_and_do_not_expand_generic_policy() -> anyhow::Result<()> {
        let mut bounded = LiveMicrosoftScenario::observation()?;
        bounded.destination_identity.pop();
        bounded.destination_identity.push_str("&opaque=");
        bounded
            .destination_identity
            .push_str(&"a".repeat(4096 - bounded.destination_identity.len()));
        bounded.machine_identity = "a".repeat(1024);
        assert_eq!(
            bounded.classify(),
            AuthenticationAdvanceControlDecision::AdvancesAuthentication
        );
        let mut oversized = bounded.clone();
        oversized.destination_identity.push('a');
        assert_eq!(
            oversized.classify(),
            AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication
        );
        oversized = bounded.clone();
        oversized.machine_identity.push('a');
        assert_eq!(
            oversized.classify(),
            AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication
        );
        oversized = bounded.clone();
        oversized.form_identity = "a".repeat(513);
        assert_eq!(
            oversized.classify(),
            AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication
        );
        bounded.source_origin = "https://example.test".to_owned();
        bounded.destination_identity = "https://example.test/login".to_owned();
        assert_eq!(
            bounded.classify(),
            AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication
        );
        Ok(())
    }
}

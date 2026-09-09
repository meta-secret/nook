#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

//! Authentication advance-control classification from browser-observed facts.

use super::AuthenticationUsernameEvidence;
use super::control_identity::AuthenticationControlIdentity;
use super::destination_identity::CanonicalControlDestination;
use super::form_identity::AuthenticationRouteIdentity;
use crate::AuthenticationControlText;
use crate::ControlDestinationEvidence;
use crate::{AuthenticationFieldCount, AuthenticationSemanticSubmitControlCount};
use serde::{Deserialize, Serialize};
use tsify::Tsify;

mod policy;
mod submission_destination_source;

pub use submission_destination_source::PageControlSubmissionDestinationSource;

/// Whether a browser-observed control can currently receive user activation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum PageControlActionability {
    Inert,
    Actionable,
}

/// The authentication scope that owns a browser-observed control.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum PageControlOwnership {
    Unowned,
    OwnedForm,
    LocallyScoped,
}

/// The browser activation semantics exposed by a control.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum PageControlSemantics {
    Activation,
    SemanticSubmit,
}

/// The effective HTML submission method for one observed activation control.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum PageControlSubmissionMethod {
    #[default]
    Absent,
    Post,
    Get,
    Dialog,
}

/// Browser-collected structure for one possible authentication advance control.
///
/// Classification keeps the report reusable; checked policy entry remains internal.
///
/// ```
/// use nook_companion_core::{AuthenticationAdvanceControlObservation,
///     AuthenticationAdvanceControlDecision};
/// let classify = |report: &AuthenticationAdvanceControlObservation| {
///     let first = report.classify();
///     assert_eq!(first, report.classify());
///     first
/// };
/// let _: fn(&AuthenticationAdvanceControlObservation) -> AuthenticationAdvanceControlDecision = classify;
/// ```
///
/// External callers cannot obtain the checked policy input.
///
/// ```compile_fail,E0624
/// use nook_companion_core::AuthenticationAdvanceControlObservation;
/// let bypass = |report: &AuthenticationAdvanceControlObservation| report.check();
/// ```
///
/// A raw report cannot run policy with a caller-selected canonical path.
///
/// ```compile_fail,E0599
/// use nook_companion_core::AuthenticationAdvanceControlObservation;
/// let bypass = |report: &AuthenticationAdvanceControlObservation| {
///     report.classify_canonical("/auth/login")
/// };
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct AuthenticationAdvanceControlObservation {
    pub actionability: PageControlActionability,
    pub ownership: PageControlOwnership,
    pub semantics: PageControlSemantics,
    pub authentication_username: AuthenticationUsernameEvidence,
    pub password_field_count: AuthenticationFieldCount,
    pub new_password_field_count: AuthenticationFieldCount,
    pub one_time_code_field_count: AuthenticationFieldCount,
    pub semantic_submit_control_count: AuthenticationSemanticSubmitControlCount,
    pub source_origin: String,
    pub form_identity: String,
    pub destination_identity: String,
    pub label: String,
    /// `id` and `name=value` machine identity used by the legacy activation veto.
    #[serde(default)]
    pub machine_identity: String,
    /// Native form submission method; GET is limited to identifier-only advancement.
    #[serde(default)]
    pub submission_method: PageControlSubmissionMethod,
    pub submission_destination_source: PageControlSubmissionDestinationSource,
}

/// Portable outcome for one observed authentication advance control.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum AuthenticationAdvanceControlDecision {
    AdvancesAuthentication,
    DoesNotAdvanceAuthentication,
}

impl AuthenticationAdvanceControlObservation {
    pub(crate) fn has_empty_microsoft_consumer_login_root(&self) -> bool {
        self.form_identity.is_empty()
            && CanonicalControlDestination::canonicalize_control_destination(
                ControlDestinationEvidence {
                    source_origin: &self.source_origin,
                    destination_identity: &self.destination_identity,
                },
            )
            .is_some_and(|destination| destination.is_microsoft_consumer_login_root)
    }

    pub(crate) fn is_microsoft_consumer_root_identifier_advance(&self) -> bool {
        let Some(destination) = CanonicalControlDestination::canonicalize_control_destination(
            ControlDestinationEvidence {
                source_origin: &self.source_origin,
                destination_identity: &self.destination_identity,
            },
        ) else {
            return false;
        };
        destination.is_microsoft_consumer_login_root
            && destination.path_identity == "/"
            && destination.route_identity == "/"
            && self.form_identity.is_empty()
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

    /// Whether DOM-controlled text and bounded field counts fit the observation envelope.
    #[must_use]
    pub fn is_bounded(&self) -> bool {
        self.source_origin.len() <= super::MAX_AUTHENTICATION_CONTROL_TEXT_BYTES
            && self.form_identity.len() <= super::MAX_AUTHENTICATION_CONTROL_TEXT_BYTES
            && self.destination_identity.len() <= super::MAX_AUTHENTICATION_CONTROL_TEXT_BYTES
            && self.label.len() <= super::MAX_AUTHENTICATION_CONTROL_TEXT_BYTES
            && self.machine_identity.len() <= super::MAX_AUTHENTICATION_CONTROL_TEXT_BYTES
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

    /// Decide whether this DOM-extracted control can advance the observed ceremony.
    #[must_use]
    pub fn classify(&self) -> AuthenticationAdvanceControlDecision {
        match self.check() {
            Some(checked) => checked.classify(),
            None => AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication,
        }
    }

    fn check(&self) -> Option<CheckedAuthenticationControl<'_>> {
        if !self.is_bounded()
            || matches!(self.submission_method, PageControlSubmissionMethod::Dialog)
            || self.has_ambiguous_identifier_only_submit()
            || (matches!(self.submission_method, PageControlSubmissionMethod::Get)
                && !self.is_identifier_only_get_advance())
        {
            return None;
        }
        let destination = CanonicalControlDestination::canonicalize_control_destination(
            ControlDestinationEvidence {
                source_origin: &self.source_origin,
                destination_identity: &self.destination_identity,
            },
        )?;
        if destination.has_provider_authority
            && matches!(
                self.authentication_username,
                AuthenticationUsernameEvidence::Generic
                    | AuthenticationUsernameEvidence::StandardsBasedEmail
                    | AuthenticationUsernameEvidence::MixedPhoneOrEmail
                    | AuthenticationUsernameEvidence::WebAuthnEmail
            )
        {
            return None;
        }
        Some(CheckedAuthenticationControl {
            observation: self,
            destination,
        })
    }
}

/// Classification admission binds canonical evidence to the unchanged browser report.
/// It deliberately carries no browser-freshness or actuation authority.
struct CheckedAuthenticationControl<'a> {
    observation: &'a AuthenticationAdvanceControlObservation,
    destination: CanonicalControlDestination,
}

impl CheckedAuthenticationControl<'_> {
    fn credential_update_destination(&self) -> bool {
        self.observation.new_password_field_count.is_nonzero()
            && (AuthenticationRouteIdentity::new(&self.destination.route_identity)
                .indicates_registration()
                || AuthenticationRouteIdentity::new(&self.destination.route_identity)
                    .indicates_password_recovery()
                || AuthenticationRouteIdentity::new(&self.destination.route_identity)
                    .indicates_password_update())
    }

    fn classify(self) -> AuthenticationAdvanceControlDecision {
        if matches!(
            self.observation.actionability,
            PageControlActionability::Inert
        ) {
            return AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication;
        }
        let non_authentication_label =
            AuthenticationAdvanceControlObservation::looks_like_non_authentication_submit_control_label(&self.observation.label);
        let contextual_password_update = self.observation.new_password_field_count.is_nonzero()
            && AuthenticationAdvanceControlObservation::looks_like_password_update_submit_control_label(&self.observation.label);
        let credential_update_destination = self.credential_update_destination();
        if self.has_unconditional_veto_identity() {
            return AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication;
        }
        if self.one_time_code_control_lacks_authentication_context() {
            return AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication;
        }
        if self.observation.new_password_field_count.is_zero()
            && self.observation.one_time_code_field_count.is_zero()
            && AuthenticationRouteIdentity::new(&self.observation.form_identity)
                .indicates_account_management()
            && !AuthenticationRouteIdentity::new(&self.observation.form_identity)
                .indicates_authentication()
        {
            return AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication;
        }
        if non_authentication_label && !contextual_password_update {
            return AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication;
        }
        let current_password_only = self.observation.password_field_count.is_nonzero()
            && self.observation.new_password_field_count.is_zero()
            && self.observation.one_time_code_field_count.is_zero();
        if current_password_only && !self.has_positive_login_identity() {
            return AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication;
        }
        if AuthenticationControlIdentity::new(&self.observation.label)
            .is_alternate_authentication_route()
        {
            return AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication;
        }
        if self.observation.new_password_field_count.is_zero()
            && (AuthenticationControlIdentity::new(&self.observation.label).is_registration()
                || AuthenticationControlText::new(
                    &AuthenticationControlText::new(&self.observation.label).expand_identity_text(),
                )
                .contains_any_word(&["join"]))
        {
            return AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication;
        }
        if AuthenticationControlIdentity::new(&self.observation.label).is_auxiliary() {
            return AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication;
        }
        if self.observation.one_time_code_field_count.is_nonzero()
            && AuthenticationControlIdentity::new(&self.observation.label).is_one_time_code_resend()
        {
            return AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication;
        }
        if self.observation.new_password_field_count.is_zero()
            && AuthenticationControlIdentity::new(&self.observation.label).is_password_recovery()
        {
            return AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication;
        }
        if AuthenticationRouteIdentity::new(&self.destination.route_identity)
            .indicates_non_authentication()
            && !credential_update_destination
        {
            return AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication;
        }
        if self.observation.new_password_field_count.is_zero()
            && AuthenticationRouteIdentity::new(&self.observation.form_identity)
                .indicates_non_authentication()
        {
            return AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication;
        }
        if self.accepts_authentication_advance() {
            AuthenticationAdvanceControlDecision::AdvancesAuthentication
        } else {
            AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::MAX_AUTHENTICATION_CONTROL_TEXT_BYTES;

    #[test]
    fn checked_classification_keeps_canonical_evidence_bound_to_the_report() -> anyhow::Result<()> {
        for (next, expected) in [
            (
                "home",
                AuthenticationAdvanceControlDecision::AdvancesAuthentication,
            ),
            (
                "checkout",
                AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication,
            ),
        ] {
            let mut report = AuthenticationAdvanceControlObservation::login_control();
            report.destination_identity =
                format!("https://login.example.test/auth/%6cogin?next=%2F{next}");
            let original = report.clone();
            let checked = report.check().ok_or_else(|| {
                anyhow::anyhow!("same-origin login must enter checked classification")
            })?;
            assert_eq!(checked.destination.path_identity, "/auth/login");
            assert_eq!(
                checked.destination.route_identity,
                format!("/auth/login?next=/{next}")
            );
            assert_eq!(checked.observation, &original);
            assert_eq!(checked.classify(), expected);
            assert_eq!(report, original);
            assert_eq!(report.classify(), expected);
            assert_eq!(report.classify(), original.classify());
        }
        Ok(())
    }

    #[test]
    fn invalid_destination_evidence_never_enters_checked_policy() {
        for destination in [
            "https://other.example.test/auth/login",
            "https://login.example.test/auth/%zz",
            "https://login.example.test/auth/%256cogin",
            "https://login.example.test/auth/%00login",
            "/auth/login",
        ] {
            let mut report = AuthenticationAdvanceControlObservation::login_control();
            report.destination_identity = destination.to_owned();
            assert!(report.check().is_none(), "{destination}");
            assert_eq!(
                report.classify(),
                AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication
            );
        }
        let mut report = AuthenticationAdvanceControlObservation::login_control();
        report.label = "a".repeat(MAX_AUTHENTICATION_CONTROL_TEXT_BYTES + 1);
        assert!(report.check().is_none());
    }

    #[test]
    fn provider_authority_requires_strong_username_evidence_before_policy() {
        for evidence in [
            AuthenticationUsernameEvidence::Generic,
            AuthenticationUsernameEvidence::StandardsBasedEmail,
            AuthenticationUsernameEvidence::MixedPhoneOrEmail,
            AuthenticationUsernameEvidence::WebAuthnEmail,
        ] {
            let mut report = AuthenticationAdvanceControlObservation::login_control();
            report.source_origin = "https://accounts.google.com".to_owned();
            report.destination_identity = "https://accounts.google.com/auth/login".to_owned();
            report.authentication_username = evidence;
            assert!(report.check().is_none());
            report.authentication_username = AuthenticationUsernameEvidence::Explicit;
            assert!(report.check().is_some());
        }
    }

    #[test]
    fn checked_policy_still_rejects_inert_and_destructive_controls() -> anyhow::Result<()> {
        for destination in ["/auth/login", "/auth/delete-account"] {
            let mut report = AuthenticationAdvanceControlObservation::login_control();
            report.destination_identity = format!("https://login.example.test{destination}");
            if destination == "/auth/login" {
                report.actionability = PageControlActionability::Inert;
            }
            let checked = report.check().ok_or_else(|| {
                anyhow::anyhow!("canonical route must be admitted before action policy")
            })?;
            assert_eq!(
                checked.classify(),
                AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication
            );
        }
        Ok(())
    }

    impl AuthenticationAdvanceControlObservation {
        fn login_control() -> Self {
            AuthenticationAdvanceControlObservation {
                actionability: PageControlActionability::Actionable,
                ownership: PageControlOwnership::OwnedForm,
                semantics: PageControlSemantics::SemanticSubmit,
                authentication_username: AuthenticationUsernameEvidence::Explicit,
                password_field_count: 1.into(),
                new_password_field_count: 0.into(),
                one_time_code_field_count: 0.into(),
                semantic_submit_control_count: 1.into(),
                source_origin: "https://login.example.test".to_owned(),
                form_identity: "login-form".to_owned(),
                destination_identity: "https://login.example.test/auth/login".to_owned(),
                label: "Sign in".to_owned(),
                machine_identity: String::new(),
                submission_method: PageControlSubmissionMethod::Absent,
                submission_destination_source: PageControlSubmissionDestinationSource::Authored,
            }
        }

        fn microsoft_consumer_identifier_advance() -> Self {
            let mut observation = Self::login_control();
            observation.authentication_username = AuthenticationUsernameEvidence::Explicit;
            observation.password_field_count = 0.into();
            observation.source_origin = "https://login.live.com".to_owned();
            observation.form_identity.clear();
            observation.destination_identity = "https://login.live.com/".to_owned();
            observation.label = "Next".to_owned();
            observation.submission_method = PageControlSubmissionMethod::Post;
            observation
        }

        fn amazon_identifier_advance() -> Self {
            let mut observation = Self::login_control();
            observation.authentication_username = AuthenticationUsernameEvidence::Generic;
            observation.password_field_count = 0.into();
            observation.source_origin = "https://www.amazon.com".to_owned();
            observation.form_identity = "ap_login_form signIn".to_owned();
            observation.destination_identity = "https://www.amazon.com/ax/claim".to_owned();
            observation.label = "Continue".to_owned();
            observation.submission_method = PageControlSubmissionMethod::Post;
            observation
        }
    }

    #[test]
    fn exact_owned_login_submit_is_safe_but_inert_or_registration_controls_are_not() {
        let control = AuthenticationAdvanceControlObservation::login_control();
        assert!((&control).authentication_advance_control_is_safe());

        let mut inert = control.clone();
        inert.actionability = PageControlActionability::Inert;
        assert!(!(&inert).authentication_advance_control_is_safe());

        let mut registration = control;
        registration.destination_identity = "https://login.example.test/register".to_owned();
        assert!(!(&registration).authentication_advance_control_is_safe());

        let mut account_settings = AuthenticationAdvanceControlObservation::login_control();
        account_settings.destination_identity =
            "https://login.example.test/settings/profile".to_owned();
        assert!(!(&account_settings).authentication_advance_control_is_safe());
    }

    #[test]
    fn username_only_submits_require_positive_authentication_identity() {
        let mut control = AuthenticationAdvanceControlObservation::login_control();
        control.password_field_count = 0.into();
        control.form_identity = "security-form".to_owned();
        control.destination_identity = "https://login.example.test/account/security".to_owned();
        control.label = "Continue".to_owned();
        assert!(!(&control).authentication_advance_control_is_safe());

        control.form_identity = "login-form".to_owned();
        control.destination_identity = "https://login.example.test/auth/login".to_owned();
        assert!((&control).authentication_advance_control_is_safe());
    }

    #[test]
    fn sso_management_and_unlabeled_activations_do_not_advance_authentication() {
        for label in [
            "Configure SSO",
            "Manage SSO",
            "Enroll SSO",
            "Sign in with SSO",
        ] {
            let mut control = AuthenticationAdvanceControlObservation::login_control();
            control.label = label.to_owned();
            assert!(!(&control).authentication_advance_control_is_safe());
        }

        for label in ["Open settings", "Enable MFA"] {
            let mut control = AuthenticationAdvanceControlObservation::login_control();
            control.semantics = PageControlSemantics::Activation;
            control.semantic_submit_control_count = 0.into();
            control.label = label.to_owned();
            assert!(!(&control).authentication_advance_control_is_safe());
        }

        let mut continue_control = AuthenticationAdvanceControlObservation::login_control();
        continue_control.semantics = PageControlSemantics::Activation;
        continue_control.semantic_submit_control_count = 0.into();
        continue_control.label = "Continue".to_owned();
        assert!((&continue_control).authentication_advance_control_is_safe());

        let mut destructive_machine = AuthenticationAdvanceControlObservation::login_control();
        destructive_machine.label = "Continue".to_owned();
        destructive_machine.machine_identity = "delete-account =".to_owned();
        assert!(!(&destructive_machine).authentication_advance_control_is_safe());
    }

    #[test]
    fn credential_update_destinations_require_new_password_evidence() {
        for (destination, label) in [
            ("https://login.example.test/register", "Create account"),
            ("https://login.example.test/auth/recover", "Reset password"),
            (
                "https://login.example.test/account/update-password",
                "Update password",
            ),
        ] {
            let mut control = AuthenticationAdvanceControlObservation::login_control();
            control.new_password_field_count = 1.into();
            control.destination_identity = destination.to_owned();
            control.label = label.to_owned();
            assert!(
                (&control).authentication_advance_control_is_safe(),
                "{destination}"
            );
        }

        let mut destructive = AuthenticationAdvanceControlObservation::login_control();
        destructive.new_password_field_count = 1.into();
        destructive.destination_identity =
            "https://login.example.test/register/delete-account".to_owned();
        destructive.label = "Create account".to_owned();
        assert!(!(&destructive).authentication_advance_control_is_safe());

        let mut provider = AuthenticationAdvanceControlObservation::login_control();
        provider.new_password_field_count = 1.into();
        provider.destination_identity =
            "https://login.example.test/register?provider=google".to_owned();
        provider.label = "Create account".to_owned();
        assert!(!(&provider).authentication_advance_control_is_safe());
    }

    #[test]
    fn nested_local_login_routes_are_accepted() {
        let mut control = AuthenticationAdvanceControlObservation::login_control();
        control.source_origin = "https://gitlab.com".to_owned();
        control.destination_identity = "https://gitlab.com/users/sign_in".to_owned();
        assert!((&control).authentication_advance_control_is_safe());
    }

    #[test]
    fn linkedin_button_login_uses_existing_combined_credential_policy() {
        let mut linkedin = AuthenticationAdvanceControlObservation::login_control();
        linkedin.source_origin = "https://www.linkedin.com".to_owned();
        linkedin.form_identity.clear();
        linkedin.destination_identity = "https://www.linkedin.com/login/".to_owned();
        linkedin.ownership = PageControlOwnership::LocallyScoped;
        linkedin.semantics = PageControlSemantics::Activation;
        linkedin.semantic_submit_control_count = 0.into();
        assert!((&linkedin).authentication_advance_control_is_safe());

        let mut owned_form = linkedin.clone();
        owned_form.ownership = PageControlOwnership::OwnedForm;
        assert!(!(&owned_form).authentication_advance_control_is_safe());
        owned_form.form_identity = "login-form".to_owned();
        assert!((&owned_form).authentication_advance_control_is_safe());

        let mut retention = linkedin.clone();
        retention.label = "Keep me signed in".to_owned();
        assert!(!(&retention).authentication_advance_control_is_safe());

        let mut cross_origin = linkedin.clone();
        cross_origin.destination_identity = "https://attacker.example/login/".to_owned();
        assert!(!(&cross_origin).authentication_advance_control_is_safe());

        let mut unowned = linkedin.clone();
        unowned.ownership = PageControlOwnership::Unowned;
        assert!(!(&unowned).authentication_advance_control_is_safe());

        linkedin.actionability = PageControlActionability::Inert;
        assert!(!(&linkedin).authentication_advance_control_is_safe());
    }

    #[test]
    fn apple_identity_authorization_signin_requires_the_exact_same_origin_route() {
        let mut control = AuthenticationAdvanceControlObservation::login_control();
        control.source_origin = "https://idmsa.apple.com".to_owned();
        control.password_field_count = 0.into();
        control.label = "Continue".to_owned();
        control.destination_identity =
            "https://idmsa.apple.com/appleauth/auth/authorize/signin".to_owned();
        assert!((&control).authentication_advance_control_is_safe());

        for destination in [
            "https://idmsa.apple.com/x/appleauth/auth/authorize/signin",
            "https://idmsa.apple.com/appleauth/auth/authorize/signin/continue",
            "https://idmsa.apple.com/appleauth/auth/authorize/signin-now",
            "https://idmsa.apple.com/unrelated/auth/authorize/signin",
            "https://idmsa.apple.com/appleauth/auth/authorize/login",
            "https://apple.attacker.test/appleauth/auth/authorize/signin",
        ] {
            control.destination_identity = destination.to_owned();
            assert!(
                !(&control).authentication_advance_control_is_safe(),
                "{destination}"
            );
        }
    }

    #[test]
    fn ambiguous_semantic_submits_require_advance_label_evidence() {
        let mut verify = AuthenticationAdvanceControlObservation::login_control();
        verify.password_field_count = 0.into();
        verify.one_time_code_field_count = 1.into();
        verify.form_identity = "otp-challenge-form".to_owned();
        verify.destination_identity = "https://login.example.test/auth/mfa/verify".to_owned();
        verify.semantic_submit_control_count = 2.into();
        verify.label = "Verify".to_owned();
        assert!((&verify).authentication_advance_control_is_safe());

        for label in ["Use recovery code", "Trust this device"] {
            let mut alternate = verify.clone();
            alternate.label = label.to_owned();
            assert!(
                !(&alternate).authentication_advance_control_is_safe(),
                "{label}"
            );
        }

        let mut unique_continue = verify;
        unique_continue.semantic_submit_control_count = 1.into();
        unique_continue.label = "Continue".to_owned();
        assert!((&unique_continue).authentication_advance_control_is_safe());
    }

    #[test]
    fn get_submitters_advance_only_single_identifier_authentication() {
        let mut identifier = AuthenticationAdvanceControlObservation::login_control();
        identifier.password_field_count = 0.into();
        identifier.label = "Continue".to_owned();
        identifier.submission_method = PageControlSubmissionMethod::Get;
        identifier.submission_destination_source = PageControlSubmissionDestinationSource::Authored;
        assert!((&identifier).authentication_advance_control_is_safe());

        let mut omitted_destination = identifier.clone();
        omitted_destination.submission_destination_source =
            PageControlSubmissionDestinationSource::Omitted;
        assert!(!(&omitted_destination).authentication_advance_control_is_safe());
        omitted_destination.form_identity.clear();
        assert!((&omitted_destination).authentication_advance_control_is_safe());

        let mut locally_scoped = identifier.clone();
        locally_scoped.ownership = PageControlOwnership::LocallyScoped;
        assert!((&locally_scoped).authentication_advance_control_is_safe());

        for evidence in [
            AuthenticationUsernameEvidence::Absent,
            AuthenticationUsernameEvidence::Generic,
            AuthenticationUsernameEvidence::StandardsBasedEmail,
            AuthenticationUsernameEvidence::MixedPhoneOrEmail,
            AuthenticationUsernameEvidence::WebAuthnEmail,
        ] {
            let mut rejected = identifier.clone();
            rejected.authentication_username = evidence;
            assert!(!(&rejected).authentication_advance_control_is_safe());
        }

        for mutation in [
            |control: &mut AuthenticationAdvanceControlObservation| {
                control.password_field_count = 1.into();
            },
            |control: &mut AuthenticationAdvanceControlObservation| {
                control.new_password_field_count = 1.into();
            },
            |control: &mut AuthenticationAdvanceControlObservation| {
                control.one_time_code_field_count = 1.into();
            },
            |control: &mut AuthenticationAdvanceControlObservation| {
                control.semantic_submit_control_count = 2.into();
            },
        ] {
            let mut rejected = identifier.clone();
            mutation(&mut rejected);
            assert!(!(&rejected).authentication_advance_control_is_safe());
        }

        let mut unowned = identifier.clone();
        unowned.ownership = PageControlOwnership::Unowned;
        assert!(!(&unowned).authentication_advance_control_is_safe());
        let mut inert = identifier.clone();
        inert.actionability = PageControlActionability::Inert;
        assert!(!(&inert).authentication_advance_control_is_safe());
        let mut activation = identifier.clone();
        activation.semantics = PageControlSemantics::Activation;
        assert!(!(&activation).authentication_advance_control_is_safe());

        for destination in [
            "https://login.example.test/search",
            "https://login.example.test/auth/delete-account",
            "https://login.example.test/auth/login?provider=google",
            "https://other.example.test/auth/login",
        ] {
            let mut rejected = identifier.clone();
            rejected.destination_identity = destination.to_owned();
            assert!(!(&rejected).authentication_advance_control_is_safe());
        }

        identifier.submission_method = PageControlSubmissionMethod::Dialog;
        assert!(!(&identifier).authentication_advance_control_is_safe());
    }

    #[test]
    fn exact_microsoft_consumer_root_identifier_advance_is_safe() {
        let observation =
            AuthenticationAdvanceControlObservation::microsoft_consumer_identifier_advance();
        assert!((&observation).authentication_advance_control_is_safe());

        let mut locally_scoped = observation;
        locally_scoped.ownership = PageControlOwnership::LocallyScoped;
        assert!((&locally_scoped).authentication_advance_control_is_safe());

        locally_scoped.label = "Sign in".to_owned();
        assert!((&locally_scoped).authentication_advance_control_is_safe());
    }

    #[test]
    fn microsoft_consumer_root_requires_exact_https_authority_and_route() {
        for (source, destination) in [
            ("http://login.live.com", "http://login.live.com/"),
            (
                "https://login.live.com:8443",
                "https://login.live.com:8443/",
            ),
            ("https://login.live.com", "https://other.example/"),
            (
                "https://login.live.com.evil.example",
                "https://login.live.com.evil.example/",
            ),
            (
                "https://nested.login.live.com",
                "https://nested.login.live.com/",
            ),
            ("https://account.live.com", "https://account.live.com/"),
            ("https://live.com", "https://live.com/"),
            ("https://microsoft.com", "https://microsoft.com/"),
            (
                "https://login.microsoftonline.com",
                "https://login.microsoftonline.com/",
            ),
            (
                "https://login.live.com",
                "https://login.live.com/?mode=login",
            ),
            ("https://login.live.com", "https://login.live.com/#login"),
        ] {
            let mut rejected =
                AuthenticationAdvanceControlObservation::microsoft_consumer_identifier_advance();
            rejected.source_origin = source.to_owned();
            rejected.destination_identity = destination.to_owned();
            assert!(!(&rejected).authentication_advance_control_is_safe());
        }

        let mut authenticated_microsoft =
            AuthenticationAdvanceControlObservation::microsoft_consumer_identifier_advance();
        authenticated_microsoft.source_origin = "https://login.microsoftonline.com".to_owned();
        authenticated_microsoft.destination_identity =
            "https://login.microsoftonline.com/common/login".to_owned();
        assert!((&authenticated_microsoft).authentication_advance_control_is_safe());
    }

    #[test]
    fn microsoft_consumer_root_preserves_form_and_control_vetoes() {
        for form_identity in [
            "signup",
            "reset-password",
            "delete-account",
            "account-settings",
        ] {
            let mut rejected =
                AuthenticationAdvanceControlObservation::microsoft_consumer_identifier_advance();
            rejected.form_identity = form_identity.to_owned();
            assert!(!(&rejected).authentication_advance_control_is_safe());
        }

        let mut provider_form =
            AuthenticationAdvanceControlObservation::microsoft_consumer_identifier_advance();
        provider_form.form_identity = "google-login".to_owned();
        assert!(!(&provider_form).authentication_advance_control_is_safe());

        let mut passkey_form =
            AuthenticationAdvanceControlObservation::microsoft_consumer_identifier_advance();
        passkey_form.form_identity = "continue-with-passkey".to_owned();
        assert!(!(&passkey_form).authentication_advance_control_is_safe());

        let mut saml_form =
            AuthenticationAdvanceControlObservation::microsoft_consumer_identifier_advance();
        saml_form.form_identity = "saml-login".to_owned();
        assert!(!(&saml_form).authentication_advance_control_is_safe());

        let mut sso_form =
            AuthenticationAdvanceControlObservation::microsoft_consumer_identifier_advance();
        sso_form.form_identity = "enterprise-sso".to_owned();
        assert!(!(&sso_form).authentication_advance_control_is_safe());

        let mut microsoft_primary =
            AuthenticationAdvanceControlObservation::microsoft_consumer_identifier_advance();
        microsoft_primary.form_identity = "Sign in to Microsoft".to_owned();
        assert!((&microsoft_primary).authentication_advance_control_is_safe());

        for label in [
            "Continue with Google",
            "Cancel",
            "Delete account",
            "Reset password",
        ] {
            let mut rejected =
                AuthenticationAdvanceControlObservation::microsoft_consumer_identifier_advance();
            rejected.label = label.to_owned();
            assert!(!(&rejected).authentication_advance_control_is_safe());
        }

        for machine_identity in ["provider=google", "delete-account", "reset-password"] {
            let mut rejected =
                AuthenticationAdvanceControlObservation::microsoft_consumer_identifier_advance();
            rejected.machine_identity = machine_identity.to_owned();
            assert!(!(&rejected).authentication_advance_control_is_safe());
        }
    }

    #[test]
    fn microsoft_consumer_root_requires_exact_identifier_submit_shape() {
        for evidence in [
            AuthenticationUsernameEvidence::Absent,
            AuthenticationUsernameEvidence::Generic,
            AuthenticationUsernameEvidence::StandardsBasedEmail,
            AuthenticationUsernameEvidence::MixedPhoneOrEmail,
            AuthenticationUsernameEvidence::WebAuthnEmail,
        ] {
            let mut rejected =
                AuthenticationAdvanceControlObservation::microsoft_consumer_identifier_advance();
            rejected.authentication_username = evidence;
            assert!(!(&rejected).authentication_advance_control_is_safe());
        }

        for mutation in [
            |control: &mut AuthenticationAdvanceControlObservation| {
                control.password_field_count = 1.into();
            },
            |control: &mut AuthenticationAdvanceControlObservation| {
                control.new_password_field_count = 1.into();
            },
            |control: &mut AuthenticationAdvanceControlObservation| {
                control.one_time_code_field_count = 1.into();
            },
            |control: &mut AuthenticationAdvanceControlObservation| {
                control.semantic_submit_control_count = 2.into();
            },
        ] {
            let mut rejected =
                AuthenticationAdvanceControlObservation::microsoft_consumer_identifier_advance();
            mutation(&mut rejected);
            assert!(!(&rejected).authentication_advance_control_is_safe());
        }

        for method in [
            PageControlSubmissionMethod::Absent,
            PageControlSubmissionMethod::Get,
            PageControlSubmissionMethod::Dialog,
        ] {
            let mut rejected =
                AuthenticationAdvanceControlObservation::microsoft_consumer_identifier_advance();
            rejected.submission_method = method;
            assert!(!(&rejected).authentication_advance_control_is_safe());
        }

        let mut unowned =
            AuthenticationAdvanceControlObservation::microsoft_consumer_identifier_advance();
        unowned.ownership = PageControlOwnership::Unowned;
        assert!(!(&unowned).authentication_advance_control_is_safe());

        let mut activation =
            AuthenticationAdvanceControlObservation::microsoft_consumer_identifier_advance();
        activation.semantics = PageControlSemantics::Activation;
        assert!(!(&activation).authentication_advance_control_is_safe());

        let mut inert =
            AuthenticationAdvanceControlObservation::microsoft_consumer_identifier_advance();
        inert.actionability = PageControlActionability::Inert;
        assert!(!(&inert).authentication_advance_control_is_safe());
    }

    #[test]
    fn amazon_owned_identifier_advance_uses_existing_authentication_policy() {
        let amazon = AuthenticationAdvanceControlObservation::amazon_identifier_advance();
        assert!((&amazon).authentication_advance_control_is_safe());

        for form_identity in [
            "",
            "checkout",
            "google-login",
            "continue-with-passkey",
            "saml-login",
            "enterprise-sso",
            "reset-password",
            "delete-account",
            "account-settings",
        ] {
            let mut rejected = amazon.clone();
            rejected.form_identity = form_identity.to_owned();
            assert!(
                !(&rejected).authentication_advance_control_is_safe(),
                "{form_identity}"
            );
        }

        let mut cross_origin = amazon.clone();
        cross_origin.destination_identity = "https://attacker.example/ax/claim".to_owned();
        assert!(!(&cross_origin).authentication_advance_control_is_safe());

        for method in [
            PageControlSubmissionMethod::Get,
            PageControlSubmissionMethod::Dialog,
        ] {
            let mut rejected = amazon.clone();
            rejected.submission_method = method;
            assert!(!(&rejected).authentication_advance_control_is_safe());
        }

        for mutation in [
            |control: &mut AuthenticationAdvanceControlObservation| {
                control.ownership = PageControlOwnership::Unowned;
            },
            |control: &mut AuthenticationAdvanceControlObservation| {
                control.actionability = PageControlActionability::Inert;
            },
        ] {
            let mut rejected = amazon.clone();
            mutation(&mut rejected);
            assert!(!(&rejected).authentication_advance_control_is_safe());
        }
    }

    #[test]
    fn primary_oauth_authorization_routes_are_accepted() {
        for destination in [
            "https://login.example.test/oauth2/authorize",
            "https://login.example.test/oauth/authorize",
        ] {
            let mut control = AuthenticationAdvanceControlObservation::login_control();
            control.destination_identity = destination.to_owned();
            assert!(
                (&control).authentication_advance_control_is_safe(),
                "{destination}"
            );
        }
    }
}

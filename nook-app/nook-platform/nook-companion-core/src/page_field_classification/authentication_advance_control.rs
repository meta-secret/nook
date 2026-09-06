#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

//! Authentication advance-control classification from browser-observed facts.

use super::control_identity::AuthenticationControlIdentity;
use super::destination_identity::{CanonicalControlDestination, canonicalize_control_destination};
use super::form_identity::AuthenticationRouteIdentity;
use super::{
    AuthenticationUsernameEvidence, contains_any_word, expand_identity_text,
    looks_like_non_authentication_submit_control_label,
    looks_like_password_update_submit_control_label,
};
use crate::{AuthenticationFieldCount, AuthenticationSemanticSubmitControlCount};
use serde::{Deserialize, Serialize};
use tsify::Tsify;

mod policy;

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
            && canonicalize_control_destination(&self.source_origin, &self.destination_identity)
                .is_some_and(|destination| destination.is_microsoft_consumer_login_root)
    }

    pub(crate) fn is_microsoft_consumer_root_identifier_advance(&self) -> bool {
        let Some(destination) =
            canonicalize_control_destination(&self.source_origin, &self.destination_identity)
        else {
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
            && self.password_field_count.raw() == 0
            && self.new_password_field_count.raw() == 0
            && self.one_time_code_field_count.raw() == 0
            && self.semantic_submit_control_count.raw() == 1
            && (expand_identity_text(&self.label) == "next"
                || AuthenticationControlIdentity::new(&self.label).is_explicit_advance())
    }

    fn is_identifier_only_get_advance(&self) -> bool {
        matches!(self.actionability, PageControlActionability::Actionable)
            && matches!(
                self.ownership,
                PageControlOwnership::OwnedForm | PageControlOwnership::LocallyScoped
            )
            && matches!(self.semantics, PageControlSemantics::SemanticSubmit)
            && matches!(
                self.authentication_username,
                AuthenticationUsernameEvidence::Strong | AuthenticationUsernameEvidence::Explicit
            )
            && self.password_field_count.raw() == 0
            && self.new_password_field_count.raw() == 0
            && self.one_time_code_field_count.raw() == 0
            && self.semantic_submit_control_count.raw() == 1
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
                self.password_field_count.raw(),
                self.new_password_field_count.raw(),
                self.one_time_code_field_count.raw(),
                self.semantic_submit_control_count.raw(),
            ]
            .into_iter()
            .all(|count| count <= crate::MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT)
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
            || (matches!(self.submission_method, PageControlSubmissionMethod::Get)
                && !self.is_identifier_only_get_advance())
        {
            return None;
        }
        let destination =
            canonicalize_control_destination(&self.source_origin, &self.destination_identity)?;
        if destination.has_provider_authority
            && matches!(
                self.authentication_username,
                AuthenticationUsernameEvidence::Generic
                    | AuthenticationUsernameEvidence::StandardsBasedEmail
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
        self.observation.new_password_field_count.raw() > 0
            && (AuthenticationRouteIdentity::new(&self.destination.route_identity)
                .indicates_registration()
                || AuthenticationRouteIdentity::new(&self.destination.route_identity)
                    .indicates_password_recovery()
                || AuthenticationRouteIdentity::new(&self.destination.route_identity)
                    .indicates_password_update())
    }

    fn is_primary_sso_submit(&self) -> bool {
        let authentication_scope_owns_control = matches!(
            self.observation.ownership,
            PageControlOwnership::OwnedForm | PageControlOwnership::LocallyScoped
        );
        let expanded_control_label = expand_identity_text(&self.observation.label);
        authentication_scope_owns_control
            && matches!(
                self.observation.semantics,
                PageControlSemantics::SemanticSubmit
            )
            && matches!(
                self.observation.authentication_username,
                AuthenticationUsernameEvidence::Strong | AuthenticationUsernameEvidence::Explicit
            )
            && contains_any_word(&expanded_control_label, &["sso"])
            && contains_any_word(
                &expanded_control_label,
                &["sign in", "signin", "continue", "next"],
            )
    }

    fn classify(self) -> AuthenticationAdvanceControlDecision {
        if matches!(
            self.observation.actionability,
            PageControlActionability::Inert
        ) {
            return AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication;
        }
        let non_authentication_label =
            looks_like_non_authentication_submit_control_label(&self.observation.label);
        let contextual_password_update = self.observation.new_password_field_count.raw() > 0
            && looks_like_password_update_submit_control_label(&self.observation.label);
        let credential_update_destination = self.credential_update_destination();
        if self.has_unconditional_veto_identity() {
            return AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication;
        }
        if self.one_time_code_control_lacks_authentication_context() {
            return AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication;
        }
        if self.observation.new_password_field_count.raw() == 0
            && self.observation.one_time_code_field_count.raw() == 0
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
        let current_password_only = self.observation.password_field_count.raw() > 0
            && self.observation.new_password_field_count.raw() == 0
            && self.observation.one_time_code_field_count.raw() == 0;
        if current_password_only && !self.has_positive_login_identity() {
            return AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication;
        }
        let primary_sso_submit = self.is_primary_sso_submit();
        if AuthenticationControlIdentity::new(&self.observation.label)
            .is_alternate_authentication_route()
            && !primary_sso_submit
        {
            return AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication;
        }
        if self.observation.new_password_field_count.raw() == 0
            && (AuthenticationControlIdentity::new(&self.observation.label).is_registration()
                || contains_any_word(&expand_identity_text(&self.observation.label), &["join"]))
        {
            return AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication;
        }
        if AuthenticationControlIdentity::new(&self.observation.label).is_auxiliary() {
            return AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication;
        }
        if self.observation.one_time_code_field_count.raw() > 0
            && AuthenticationControlIdentity::new(&self.observation.label).is_one_time_code_resend()
        {
            return AuthenticationAdvanceControlDecision::DoesNotAdvanceAuthentication;
        }
        if self.observation.new_password_field_count.raw() == 0
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
        if self.observation.new_password_field_count.raw() == 0
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
    use crate::authentication_advance_control_is_safe;

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
    }

    #[test]
    fn exact_owned_login_submit_is_safe_but_inert_or_registration_controls_are_not() {
        let control = AuthenticationAdvanceControlObservation::login_control();
        assert!(authentication_advance_control_is_safe(&control));

        let mut inert = control.clone();
        inert.actionability = PageControlActionability::Inert;
        assert!(!authentication_advance_control_is_safe(&inert));

        let mut registration = control;
        registration.destination_identity = "https://login.example.test/register".to_owned();
        assert!(!authentication_advance_control_is_safe(&registration));

        let mut account_settings = AuthenticationAdvanceControlObservation::login_control();
        account_settings.destination_identity =
            "https://login.example.test/settings/profile".to_owned();
        assert!(!authentication_advance_control_is_safe(&account_settings));
    }

    #[test]
    fn username_only_submits_require_positive_authentication_identity() {
        let mut control = AuthenticationAdvanceControlObservation::login_control();
        control.password_field_count = 0.into();
        control.form_identity = "security-form".to_owned();
        control.destination_identity = "https://login.example.test/account/security".to_owned();
        control.label = "Continue".to_owned();
        assert!(!authentication_advance_control_is_safe(&control));

        control.form_identity = "login-form".to_owned();
        control.destination_identity = "https://login.example.test/auth/login".to_owned();
        assert!(authentication_advance_control_is_safe(&control));
    }

    #[test]
    fn sso_management_and_unlabeled_activations_do_not_advance_authentication() {
        for label in ["Configure SSO", "Manage SSO", "Enroll SSO"] {
            let mut control = AuthenticationAdvanceControlObservation::login_control();
            control.label = label.to_owned();
            assert!(!authentication_advance_control_is_safe(&control));
        }

        for label in ["Open settings", "Enable MFA"] {
            let mut control = AuthenticationAdvanceControlObservation::login_control();
            control.semantics = PageControlSemantics::Activation;
            control.semantic_submit_control_count = 0.into();
            control.label = label.to_owned();
            assert!(!authentication_advance_control_is_safe(&control));
        }

        let mut continue_control = AuthenticationAdvanceControlObservation::login_control();
        continue_control.semantics = PageControlSemantics::Activation;
        continue_control.semantic_submit_control_count = 0.into();
        continue_control.label = "Continue".to_owned();
        assert!(authentication_advance_control_is_safe(&continue_control));

        let mut destructive_machine = AuthenticationAdvanceControlObservation::login_control();
        destructive_machine.label = "Continue".to_owned();
        destructive_machine.machine_identity = "delete-account =".to_owned();
        assert!(!authentication_advance_control_is_safe(
            &destructive_machine
        ));
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
                authentication_advance_control_is_safe(&control),
                "{destination}"
            );
        }

        let mut destructive = AuthenticationAdvanceControlObservation::login_control();
        destructive.new_password_field_count = 1.into();
        destructive.destination_identity =
            "https://login.example.test/register/delete-account".to_owned();
        destructive.label = "Create account".to_owned();
        assert!(!authentication_advance_control_is_safe(&destructive));

        let mut provider = AuthenticationAdvanceControlObservation::login_control();
        provider.new_password_field_count = 1.into();
        provider.destination_identity =
            "https://login.example.test/register?provider=google".to_owned();
        provider.label = "Create account".to_owned();
        assert!(!authentication_advance_control_is_safe(&provider));
    }

    #[test]
    fn nested_local_login_routes_are_accepted() {
        let mut control = AuthenticationAdvanceControlObservation::login_control();
        control.source_origin = "https://gitlab.com".to_owned();
        control.destination_identity = "https://gitlab.com/users/sign_in".to_owned();
        assert!(authentication_advance_control_is_safe(&control));
    }

    #[test]
    fn apple_identity_authorization_signin_requires_the_exact_same_origin_route() {
        let mut control = AuthenticationAdvanceControlObservation::login_control();
        control.source_origin = "https://idmsa.apple.com".to_owned();
        control.password_field_count = 0.into();
        control.label = "Continue".to_owned();
        control.destination_identity =
            "https://idmsa.apple.com/appleauth/auth/authorize/signin".to_owned();
        assert!(authentication_advance_control_is_safe(&control));

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
                !authentication_advance_control_is_safe(&control),
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
        assert!(authentication_advance_control_is_safe(&verify));

        for label in ["Use recovery code", "Trust this device"] {
            let mut alternate = verify.clone();
            alternate.label = label.to_owned();
            assert!(
                !authentication_advance_control_is_safe(&alternate),
                "{label}"
            );
        }

        let mut unique_continue = verify;
        unique_continue.semantic_submit_control_count = 1.into();
        unique_continue.label = "Continue".to_owned();
        assert!(authentication_advance_control_is_safe(&unique_continue));
    }

    #[test]
    fn get_submitters_advance_only_single_identifier_authentication() {
        let mut identifier = AuthenticationAdvanceControlObservation::login_control();
        identifier.password_field_count = 0.into();
        identifier.label = "Continue".to_owned();
        identifier.submission_method = PageControlSubmissionMethod::Get;
        assert!(authentication_advance_control_is_safe(&identifier));

        let mut locally_scoped = identifier.clone();
        locally_scoped.ownership = PageControlOwnership::LocallyScoped;
        assert!(authentication_advance_control_is_safe(&locally_scoped));

        for evidence in [
            AuthenticationUsernameEvidence::Absent,
            AuthenticationUsernameEvidence::Generic,
            AuthenticationUsernameEvidence::StandardsBasedEmail,
        ] {
            let mut rejected = identifier.clone();
            rejected.authentication_username = evidence;
            assert!(!authentication_advance_control_is_safe(&rejected));
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
            assert!(!authentication_advance_control_is_safe(&rejected));
        }

        let mut unowned = identifier.clone();
        unowned.ownership = PageControlOwnership::Unowned;
        assert!(!authentication_advance_control_is_safe(&unowned));
        let mut inert = identifier.clone();
        inert.actionability = PageControlActionability::Inert;
        assert!(!authentication_advance_control_is_safe(&inert));
        let mut activation = identifier.clone();
        activation.semantics = PageControlSemantics::Activation;
        assert!(!authentication_advance_control_is_safe(&activation));

        for destination in [
            "https://login.example.test/search",
            "https://login.example.test/auth/delete-account",
            "https://login.example.test/auth/login?provider=google",
            "https://other.example.test/auth/login",
        ] {
            let mut rejected = identifier.clone();
            rejected.destination_identity = destination.to_owned();
            assert!(!authentication_advance_control_is_safe(&rejected));
        }

        identifier.submission_method = PageControlSubmissionMethod::Dialog;
        assert!(!authentication_advance_control_is_safe(&identifier));
    }

    #[test]
    fn exact_microsoft_consumer_root_identifier_advance_is_safe() {
        let observation =
            AuthenticationAdvanceControlObservation::microsoft_consumer_identifier_advance();
        assert!(authentication_advance_control_is_safe(&observation));

        let mut locally_scoped = observation;
        locally_scoped.ownership = PageControlOwnership::LocallyScoped;
        assert!(authentication_advance_control_is_safe(&locally_scoped));

        locally_scoped.label = "Sign in".to_owned();
        assert!(authentication_advance_control_is_safe(&locally_scoped));
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
            assert!(!authentication_advance_control_is_safe(&rejected));
        }

        let mut authenticated_microsoft =
            AuthenticationAdvanceControlObservation::microsoft_consumer_identifier_advance();
        authenticated_microsoft.source_origin = "https://login.microsoftonline.com".to_owned();
        authenticated_microsoft.destination_identity =
            "https://login.microsoftonline.com/common/login".to_owned();
        assert!(authentication_advance_control_is_safe(
            &authenticated_microsoft
        ));
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
            assert!(!authentication_advance_control_is_safe(&rejected));
        }

        let mut provider_form =
            AuthenticationAdvanceControlObservation::microsoft_consumer_identifier_advance();
        provider_form.form_identity = "google-login".to_owned();
        assert!(!authentication_advance_control_is_safe(&provider_form));

        let mut passkey_form =
            AuthenticationAdvanceControlObservation::microsoft_consumer_identifier_advance();
        passkey_form.form_identity = "continue-with-passkey".to_owned();
        assert!(!authentication_advance_control_is_safe(&passkey_form));

        let mut saml_form =
            AuthenticationAdvanceControlObservation::microsoft_consumer_identifier_advance();
        saml_form.form_identity = "saml-login".to_owned();
        assert!(!authentication_advance_control_is_safe(&saml_form));

        let mut sso_form =
            AuthenticationAdvanceControlObservation::microsoft_consumer_identifier_advance();
        sso_form.form_identity = "enterprise-sso".to_owned();
        assert!(!authentication_advance_control_is_safe(&sso_form));

        let mut microsoft_primary =
            AuthenticationAdvanceControlObservation::microsoft_consumer_identifier_advance();
        microsoft_primary.form_identity = "Sign in to Microsoft".to_owned();
        assert!(authentication_advance_control_is_safe(&microsoft_primary));

        for label in [
            "Continue with Google",
            "Cancel",
            "Delete account",
            "Reset password",
        ] {
            let mut rejected =
                AuthenticationAdvanceControlObservation::microsoft_consumer_identifier_advance();
            rejected.label = label.to_owned();
            assert!(!authentication_advance_control_is_safe(&rejected));
        }

        for machine_identity in ["provider=google", "delete-account", "reset-password"] {
            let mut rejected =
                AuthenticationAdvanceControlObservation::microsoft_consumer_identifier_advance();
            rejected.machine_identity = machine_identity.to_owned();
            assert!(!authentication_advance_control_is_safe(&rejected));
        }
    }

    #[test]
    fn microsoft_consumer_root_requires_exact_identifier_submit_shape() {
        for evidence in [
            AuthenticationUsernameEvidence::Absent,
            AuthenticationUsernameEvidence::Generic,
            AuthenticationUsernameEvidence::StandardsBasedEmail,
        ] {
            let mut rejected =
                AuthenticationAdvanceControlObservation::microsoft_consumer_identifier_advance();
            rejected.authentication_username = evidence;
            assert!(!authentication_advance_control_is_safe(&rejected));
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
            assert!(!authentication_advance_control_is_safe(&rejected));
        }

        for method in [
            PageControlSubmissionMethod::Absent,
            PageControlSubmissionMethod::Get,
            PageControlSubmissionMethod::Dialog,
        ] {
            let mut rejected =
                AuthenticationAdvanceControlObservation::microsoft_consumer_identifier_advance();
            rejected.submission_method = method;
            assert!(!authentication_advance_control_is_safe(&rejected));
        }

        let mut unowned =
            AuthenticationAdvanceControlObservation::microsoft_consumer_identifier_advance();
        unowned.ownership = PageControlOwnership::Unowned;
        assert!(!authentication_advance_control_is_safe(&unowned));

        let mut activation =
            AuthenticationAdvanceControlObservation::microsoft_consumer_identifier_advance();
        activation.semantics = PageControlSemantics::Activation;
        assert!(!authentication_advance_control_is_safe(&activation));

        let mut inert =
            AuthenticationAdvanceControlObservation::microsoft_consumer_identifier_advance();
        inert.actionability = PageControlActionability::Inert;
        assert!(!authentication_advance_control_is_safe(&inert));
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
                authentication_advance_control_is_safe(&control),
                "{destination}"
            );
        }
    }
}

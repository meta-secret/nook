//! Portable auth-field role classification from browser-collected identity text.
//!
//! DOM query, visibility, and fill stay in the host adapter. This module owns
//! which identity strings count as username, OTP, passkey, or manual-checkpoint
//! signals used to build authentication workflow observations in the host.

use crate::ControlDestinationEvidence;
use control_identity::AuthenticationControlIdentity as ControlIdentity;
use form_identity::{
    AuthenticationRouteIdentity as RouteIdentity, CredentialDestination, DestinationPolicy,
    OAuthAuthorization,
};
mod authentication_advance_control;
mod control_identity;
mod control_labels;
mod control_text;
pub use control_text::AuthenticationControlText;
mod destination_identity;
mod form_identity;
mod input_role;
mod one_time_code_progression;
mod passkey;

pub(crate) use input_role::AuthenticationInputRole;

/// Maximum byte length for each DOM-controlled authentication identity string.
pub const MAX_AUTHENTICATION_CONTROL_TEXT_BYTES: usize = 512;

pub use authentication_advance_control::{
    AuthenticationAdvanceControlDecision, AuthenticationAdvanceControlObservation,
    PageControlActionability, PageControlOwnership, PageControlSemantics,
    PageControlSubmissionDestinationSource, PageControlSubmissionMethod,
};
pub use destination_identity::CanonicalControlDestination;

pub(super) use passkey::PASSKEY_OR_PLATFORM_AUTHENTICATOR_WORDS;

/// Validate one bounded advance-control observation for exact browser actuation.
/// Named values required by AuthenticationAdvanceControlObservation::one_time_code_ceremony_context_is_authenticated.
pub struct OneTimeCodeRouteEvidence<'a> {
    pub _authentication_username: AuthenticationUsernameEvidence,
    pub source_origin: &'a str,
    pub form_identity: &'a str,
    pub destination_identity: &'a str,
}

/// Named values required by AuthenticationAdvanceControlObservation::has_safe_authentication_route_identity.
pub struct AuthenticationRouteEvidence<'a> {
    pub source_origin: &'a str,
    pub form_identity: &'a str,
    pub destination_identity: &'a str,
}

/// Named values required by AuthenticationAdvanceControlObservation::has_safe_credential_update_route_identity.
pub struct CredentialUpdateRouteEvidence<'a> {
    pub source_origin: &'a str,
    pub form_identity: &'a str,
    pub destination_identity: &'a str,
}

/// Named values required by AuthenticationAdvanceControlObservation::can_activate_authentication_route_control.
pub struct AuthenticationRouteActuation<'a> {
    pub source_origin: &'a str,
    pub form_identity: &'a str,
    pub destination_identity: &'a str,
    pub control_label: &'a str,
    pub control_machine_identity: &'a str,
    pub has_concrete_control: AuthenticationRouteControlPresence,
    pub has_authentication_username: AuthenticationRouteUsernamePresence,
    pub has_local_authentication_scope: AuthenticationRouteScope,
    pub has_authentication_password: AuthenticationRoutePasswordPresence,
}

impl AuthenticationAdvanceControlObservation {
    #[must_use]
    pub fn authentication_advance_control_is_safe(&self) -> bool {
        let observation = self;
        matches!(
            observation.classify(),
            AuthenticationAdvanceControlDecision::AdvancesAuthentication
        )
    }
}

use serde::{Deserialize, Serialize};
use tsify::Tsify;
use wasm_bindgen::prelude::wasm_bindgen;

/// Portable HTML input type bucket for auth classification.
#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PageInputType {
    Text,
    Email,
    Tel,
    Number,
    Password,
    Other,
}

impl PageInputType {
    #[must_use]
    pub fn parse(value: &str) -> Self {
        match value.trim().to_ascii_lowercase().as_str() {
            "" | "text" => Self::Text,
            "email" => Self::Email,
            "tel" => Self::Tel,
            "number" => Self::Number,
            "password" => Self::Password,
            _ => Self::Other,
        }
    }
}

/// Browser-collected attributes for one input, without DOM handles.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageInputFieldObservation {
    pub input_type: PageInputType,
    pub disabled: bool,
    pub read_only: bool,
    pub autocomplete_tokens: Vec<String>,
    pub identity_text: String,
    pub login_context: PageLoginContext,
}

/// Expand camelCase / separators into lowercase identity tokens for matching.

/// Browser-collected login-surface identity text without DOM handles.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginContextObservation {
    pub form_identity: String,
    pub ancestor_identities: Vec<String>,
    pub advance_control_label: String,
    pub path_context: String,
}

const LOGIN_SURFACE_WORDS: &[&str] = &[
    "login", "log in", "sign-in", "sign in", "signin", "auth", "account", "sso",
];

const LOGIN_ADVANCE_WORDS: &[&str] = &[
    "next", "continue", "proceed", "signin", "sign-in", "sign in", "login", "log-in", "log in",
    "verify", "entrar",
];

const LOGIN_PATH_WORDS: &[&str] = &[
    "login",
    "signin",
    "sign-in",
    "account",
    "oauth",
    "sso",
    "microsoftonline",
    "live.com",
];

/// True when form/path/ancestor context looks like a login surface.
impl LoginContextObservation {
    #[must_use]
    pub fn has_login_context(&self) -> bool {
        let observation = self;
        let form =
            AuthenticationControlText::new(&observation.form_identity).expand_identity_text();
        if AuthenticationControlText::new(&form).contains_any_word(LOGIN_SURFACE_WORDS) {
            return true;
        }
        for ancestor in &observation.ancestor_identities {
            let identity = AuthenticationControlText::new(ancestor).expand_identity_text();
            if AuthenticationControlText::new(&identity).contains_any_word(LOGIN_SURFACE_WORDS) {
                return true;
            }
        }
        let advance = AuthenticationControlText::new(&observation.advance_control_label)
            .expand_identity_text();
        if advance != "submit"
            && AuthenticationAdvanceControlObservation::looks_like_login_advance_control_label(
                &observation.advance_control_label,
            )
        {
            return true;
        }
        let path = observation.path_context.to_ascii_lowercase();
        AuthenticationControlText::new(&path).contains_any_word(LOGIN_PATH_WORDS)
    }
}

/// Classify whether an input should count as a username/email identity field.
/// Named values required by PageInputFieldObservation::has_autocomplete_token.
pub struct AutocompleteTokenQuery<'a> {
    pub tokens: &'a [String],
    pub expected: &'a str,
}

impl PageInputFieldObservation {
    #[must_use]
    pub fn looks_like_username_field(&self) -> bool {
        let field = self;
        if field.disabled || field.read_only {
            return false;
        }
        matches!(
            (field).classify_authentication_input_role(),
            AuthenticationInputRole::Username(_)
        )
    }
}

/// Classify whether an input should count as a one-time-code field.
impl PageInputFieldObservation {
    #[must_use]
    pub fn looks_like_one_time_code_field(&self) -> bool {
        let field = self;
        if field.disabled || field.read_only {
            return false;
        }
        matches!(
            (field).classify_authentication_input_role(),
            AuthenticationInputRole::OneTimeCode(_)
        )
    }
}

impl AuthenticationAdvanceControlObservation {
    pub(crate) fn one_time_code_ceremony_context_is_authenticated(
        request: OneTimeCodeRouteEvidence<'_>,
    ) -> bool {
        let OneTimeCodeRouteEvidence {
            _authentication_username,
            source_origin,
            form_identity,
            destination_identity,
        } = request;
        if [source_origin, form_identity, destination_identity]
            .into_iter()
            .any(|value| value.len() > MAX_AUTHENTICATION_CONTROL_TEXT_BYTES)
        {
            return false;
        }
        let Some(destination) = CanonicalControlDestination::canonicalize_control_destination(
            ControlDestinationEvidence {
                source_origin: source_origin,
                destination_identity: destination_identity,
            },
        ) else {
            return false;
        };
        if RouteIdentity::new(form_identity).indicates_destructive_action()
            || RouteIdentity::new(form_identity).indicates_account_management()
            || RouteIdentity::new(&destination.route_identity).indicates_destructive_action()
            || RouteIdentity::new(&destination.route_identity).indicates_non_authentication()
            || RouteIdentity::new(&destination.route_identity).has_disallowed_action_or_provider(
                DestinationPolicy {
                    credential: CredentialDestination::Authentication,
                    provider: OAuthAuthorization::Disallowed,
                },
            )
        {
            return false;
        }
        [form_identity, destination.path_identity.as_str()]
            .into_iter()
            .any(|identity| RouteIdentity::new(identity).indicates_one_time_code_authentication())
    }
}

impl AuthenticationAdvanceControlObservation {
    pub(crate) fn authentication_passkey_control_is_safe(
        &self,
        explicitly_marked: PasskeyControlMarking,
    ) -> bool {
        let observation = self;
        let explicitly_marked = matches!(explicitly_marked, PasskeyControlMarking::Explicit);
        let label_identity =
            AuthenticationControlText::new(&observation.label).expand_identity_text();
        let label_names_passkey_credential = AuthenticationControlText::new(&label_identity)
            .contains_any_word(&[
                "passkey",
                "passkeys",
                "pass key",
                "pass keys",
                "security key",
                "security keys",
                "hardware key",
                "webauthn",
                "fido",
                "touch id",
                "face id",
                "windows hello",
            ]);
        let label_names_enrollment_or_management = AuthenticationControlText::new(&label_identity)
            .contains_any_word(&[
                "add",
                "create",
                "enable",
                "enroll",
                "enrollment",
                "register",
                "registration",
                "manage",
                "management",
                "settings",
                "set up",
                "setup",
                "configure",
            ]);
        let label_names_passkey_enrollment_or_management =
            label_names_passkey_credential && label_names_enrollment_or_management;
        let label_names_device_management = label_names_enrollment_or_management
            && AuthenticationControlText::new(&label_identity)
                .contains_any_word(&["device", "devices"]);
        if !observation.is_bounded()
            || !matches!(
                observation.actionability,
                PageControlActionability::Actionable
            )
            || !matches!(
                observation.ownership,
                PageControlOwnership::OwnedForm | PageControlOwnership::LocallyScoped
            )
            || (!explicitly_marked
                && !AuthenticationAdvanceControlObservation::looks_like_passkey_control_label(
                    &observation.label,
                ))
            || RouteIdentity::new(&observation.label).indicates_destructive_action()
            || RouteIdentity::new(&observation.machine_identity).has_control_veto()
            || matches!(
                observation.submission_method,
                PageControlSubmissionMethod::Get | PageControlSubmissionMethod::Dialog
            )
            || label_names_passkey_enrollment_or_management
            || label_names_device_management
            || RouteIdentity::new(&observation.form_identity).indicates_destructive_action()
            || RouteIdentity::new(&observation.form_identity).indicates_account_management()
        {
            return false;
        }
        let Some(destination) = CanonicalControlDestination::canonicalize_control_destination(
            ControlDestinationEvidence {
                source_origin: &observation.source_origin,
                destination_identity: &observation.destination_identity,
            },
        ) else {
            return false;
        };
        let has_authentication_context = observation.password_field_count.is_nonzero()
            || observation.one_time_code_field_count.is_nonzero()
            || matches!(
                observation.authentication_username,
                AuthenticationUsernameEvidence::Strong | AuthenticationUsernameEvidence::Explicit
            )
            || RouteIdentity::new(&observation.form_identity).indicates_authentication()
            || RouteIdentity::new(&destination.path_identity).indicates_authentication();
        if !has_authentication_context {
            return false;
        }
        if (observation).passkey_new_password_ceremony_lacks_assertion_state(&destination) {
            return false;
        }
        !RouteIdentity::new(&destination.route_identity).indicates_destructive_action()
            && !RouteIdentity::new(&destination.route_identity).indicates_non_authentication()
            && !RouteIdentity::new(&destination.route_identity)
                .has_disallowed_passkey_action_or_provider()
    }
}

impl AuthenticationAdvanceControlObservation {
    fn passkey_new_password_ceremony_lacks_assertion_state(
        &self,
        destination: &CanonicalControlDestination,
    ) -> bool {
        let observation = self;
        observation.new_password_field_count.is_nonzero()
            && !RouteIdentity::new(&destination.path_identity).indicates_login()
            && !RouteIdentity::new(&destination.route_identity).indicates_login()
    }
}

/// Decide whether bounded form and destination identities describe a safe authentication route.
impl AuthenticationAdvanceControlObservation {
    #[must_use]
    pub fn has_safe_authentication_route_identity(
        request: AuthenticationRouteEvidence<'_>,
    ) -> bool {
        let AuthenticationRouteEvidence {
            source_origin,
            form_identity,
            destination_identity,
        } = request;
        if [source_origin, form_identity, destination_identity]
            .into_iter()
            .any(|value| value.len() > MAX_AUTHENTICATION_CONTROL_TEXT_BYTES)
        {
            return false;
        }
        if RouteIdentity::new(form_identity).has_control_veto() {
            return false;
        }
        let Some(destination) = CanonicalControlDestination::canonicalize_control_destination(
            ControlDestinationEvidence {
                source_origin: source_origin,
                destination_identity: destination_identity,
            },
        ) else {
            return false;
        };
        if RouteIdentity::new(&destination.route_identity).indicates_non_authentication()
            || RouteIdentity::new(&destination.route_identity).has_disallowed_action_or_provider(
                DestinationPolicy {
                    credential: CredentialDestination::Authentication,
                    provider: OAuthAuthorization::Disallowed,
                },
            )
        {
            return false;
        }
        RouteIdentity::new(form_identity).indicates_authentication()
            || RouteIdentity::new(&destination.path_identity).has_safe_login_identity()
    }
}

/// Admit implicit credential-creation on register, recovery, or password-update routes.
impl AuthenticationAdvanceControlObservation {
    #[must_use]
    pub fn has_safe_credential_update_route_identity(
        request: CredentialUpdateRouteEvidence<'_>,
    ) -> bool {
        let CredentialUpdateRouteEvidence {
            source_origin,
            form_identity,
            destination_identity,
        } = request;
        if [source_origin, form_identity, destination_identity]
            .into_iter()
            .any(|value| value.len() > MAX_AUTHENTICATION_CONTROL_TEXT_BYTES)
        {
            return false;
        }
        if RouteIdentity::new(form_identity).indicates_destructive_action()
            || RouteIdentity::new(form_identity).has_disallowed_action_or_provider(
                DestinationPolicy {
                    credential: CredentialDestination::PasswordUpdate,
                    provider: OAuthAuthorization::Disallowed,
                },
            )
            || ControlIdentity::new(form_identity).is_auxiliary()
        {
            return false;
        }
        let Some(destination) = CanonicalControlDestination::canonicalize_control_destination(
            ControlDestinationEvidence {
                source_origin: source_origin,
                destination_identity: destination_identity,
            },
        ) else {
            return false;
        };
        if RouteIdentity::new(&destination.route_identity).indicates_destructive_action()
            || RouteIdentity::new(&destination.route_identity).has_disallowed_action_or_provider(
                DestinationPolicy {
                    credential: CredentialDestination::PasswordUpdate,
                    provider: OAuthAuthorization::Disallowed,
                },
            )
        {
            return false;
        }
        let credential_update_route = RouteIdentity::new(&destination.route_identity)
            .indicates_registration()
            || RouteIdentity::new(&destination.route_identity).indicates_password_recovery()
            || RouteIdentity::new(&destination.route_identity).indicates_password_update();
        if RouteIdentity::new(&destination.route_identity).indicates_non_authentication()
            && !credential_update_route
        {
            return false;
        }
        RouteIdentity::new(form_identity).indicates_authentication()
            || RouteIdentity::new(&destination.path_identity).has_safe_login_identity()
            || credential_update_route
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum AuthenticationUsernameEvidence {
    Absent,
    Generic,
    StandardsBasedEmail,
    MixedPhoneOrEmail,
    WebAuthnEmail,
    Strong,
    Explicit,
}

impl PageInputFieldObservation {
    #[must_use]
    pub fn authentication_username_evidence(&self) -> AuthenticationUsernameEvidence {
        let field = self;
        if !(field).looks_like_username_field() {
            return AuthenticationUsernameEvidence::Absent;
        }
        if PageInputFieldObservation::has_autocomplete_token(AutocompleteTokenQuery {
            tokens: &field.autocomplete_tokens,
            expected: "username",
        }) {
            return AuthenticationUsernameEvidence::Explicit;
        }
        let identity = AuthenticationControlText::new(&field.identity_text).expand_identity_text();
        if field.input_type == PageInputType::Text
            && matches!(field.login_context, PageLoginContext::Authentication)
            && field.identity_text.len() <= MAX_AUTHENTICATION_CONTROL_TEXT_BYTES
            && field.autocomplete_tokens.len() == 1
            && PageInputFieldObservation::has_autocomplete_token(AutocompleteTokenQuery {
                tokens: &field.autocomplete_tokens,
                expected: "tel-national",
            })
            && identity == "tel national phone number or email"
        {
            return AuthenticationUsernameEvidence::MixedPhoneOrEmail;
        }
        if PageInputFieldObservation::has_autocomplete_token(AutocompleteTokenQuery {
            tokens: &field.autocomplete_tokens,
            expected: "email",
        }) {
            return if PageInputFieldObservation::username_negative(&identity) {
                AuthenticationUsernameEvidence::Generic
            } else if PageInputFieldObservation::has_autocomplete_token(AutocompleteTokenQuery {
                tokens: &field.autocomplete_tokens,
                expected: "webauthn",
            }) {
                AuthenticationUsernameEvidence::WebAuthnEmail
            } else if matches!(field.login_context, PageLoginContext::Authentication) {
                AuthenticationUsernameEvidence::Strong
            } else {
                AuthenticationUsernameEvidence::StandardsBasedEmail
            };
        }
        if AuthenticationControlText::new(&identity).contains_any_word(&[
            "loginfmt",
            "login fmt",
            "login email",
            "login e mail",
            "login e-mail",
        ]) {
            AuthenticationUsernameEvidence::Strong
        } else {
            AuthenticationUsernameEvidence::Generic
        }
    }
}

/// Select the strongest username evidence without duplicating its ordering in hosts.
impl AuthenticationUsernameEvidence {
    #[must_use]
    pub fn strongest_authentication_username_evidence(
        evidence: &[AuthenticationUsernameEvidence],
    ) -> AuthenticationUsernameEvidence {
        if evidence.contains(&AuthenticationUsernameEvidence::Explicit) {
            AuthenticationUsernameEvidence::Explicit
        } else if evidence.contains(&AuthenticationUsernameEvidence::WebAuthnEmail) {
            AuthenticationUsernameEvidence::WebAuthnEmail
        } else if evidence.contains(&AuthenticationUsernameEvidence::MixedPhoneOrEmail) {
            AuthenticationUsernameEvidence::MixedPhoneOrEmail
        } else if evidence.contains(&AuthenticationUsernameEvidence::Strong) {
            AuthenticationUsernameEvidence::Strong
        } else if evidence.contains(&AuthenticationUsernameEvidence::StandardsBasedEmail) {
            AuthenticationUsernameEvidence::StandardsBasedEmail
        } else if evidence.contains(&AuthenticationUsernameEvidence::Generic) {
            AuthenticationUsernameEvidence::Generic
        } else {
            AuthenticationUsernameEvidence::Absent
        }
    }
}

/// Decide whether a locally scoped control may advance a safe authentication route.
impl AuthenticationAdvanceControlObservation {
    #[must_use]
    pub fn can_activate_authentication_route_control(
        request: AuthenticationRouteActuation<'_>,
    ) -> bool {
        let AuthenticationRouteActuation {
            source_origin,
            form_identity,
            destination_identity,
            control_label,
            control_machine_identity,
            has_concrete_control,
            has_authentication_username,
            has_local_authentication_scope,
            has_authentication_password,
        } = request;
        if !AuthenticationAdvanceControlObservation::has_safe_authentication_route_identity(
            AuthenticationRouteEvidence {
                source_origin: source_origin,
                form_identity: form_identity,
                destination_identity: destination_identity,
            },
        ) || control_label.len() > MAX_AUTHENTICATION_CONTROL_TEXT_BYTES
            || control_machine_identity.len() > MAX_AUTHENTICATION_CONTROL_TEXT_BYTES
            || RouteIdentity::new(control_machine_identity).has_control_veto()
        {
            return false;
        }
        let has_matching_microsoft_authority =
            CanonicalControlDestination::canonicalize_control_destination(
                ControlDestinationEvidence {
                    source_origin: source_origin,
                    destination_identity: destination_identity,
                },
            )
            .is_some_and(|destination| destination.has_microsoft_provider_authority)
                && ControlIdentity::new(control_label).is_microsoft_primary_sign_in();
        if ControlIdentity::new(control_label).label_names_provider()
            && !has_matching_microsoft_authority
        {
            return false;
        }
        if AuthenticationAdvanceControlObservation::looks_like_login_advance_control_label(
            control_label,
        ) {
            return matches!(
                has_authentication_username,
                AuthenticationRouteUsernamePresence::Present
            ) && matches!(
                has_local_authentication_scope,
                AuthenticationRouteScope::LocalAuthentication
            );
        }
        control_label.is_empty()
            && !matches!(
                has_concrete_control,
                AuthenticationRouteControlPresence::Present
            )
            && (matches!(
                has_authentication_username,
                AuthenticationRouteUsernamePresence::Present
            ) || matches!(
                has_authentication_password,
                AuthenticationRoutePasswordPresence::Present
            ))
            && matches!(
                has_local_authentication_scope,
                AuthenticationRouteScope::LocalAuthentication
            )
    }
}

impl PageInputFieldObservation {
    pub(crate) fn has_autocomplete_token(request: AutocompleteTokenQuery<'_>) -> bool {
        let AutocompleteTokenQuery { tokens, expected } = request;
        tokens
            .iter()
            .any(|token| token.eq_ignore_ascii_case(expected))
    }
}

impl PageInputFieldObservation {
    fn username_positive(identity: &str) -> bool {
        AuthenticationControlText::new(identity).contains_any_word(&[
            "user",
            "user name",
            "username",
            "email",
            "e mail",
            "e-mail",
            "login",
            "login fmt",
            "loginfmt",
            "log in",
            "sign-in",
            "sign in",
            "account",
            "identifier",
            "phone",
            "phone number",
            "skype",
        ])
    }
}

impl PageInputFieldObservation {
    fn username_negative(identity: &str) -> bool {
        AuthenticationControlText::new(identity).contains_any_word(&[
            "newsletter",
            "subscribe",
            "marketing",
            "promo",
            "search",
            "filter",
            "recipient",
            "contact us",
            "feedback",
            "support email",
        ])
    }
}

impl PageInputFieldObservation {
    fn one_time_code_positive(identity: &str) -> bool {
        AuthenticationControlText::new(identity).contains_any_word(&[
            "otp",
            "totp",
            "2 fa",
            "2fa",
            "mfa",
            "two fa",
            "two factor",
            "one time",
            "one time code",
            "auth code",
            "authentication code",
            "verification code",
            "authenticator",
            "authenticator code",
        ])
    }
}

impl PageInputFieldObservation {
    fn one_time_code_negative(identity: &str) -> bool {
        AuthenticationControlText::new(identity).contains_any_word(&[
            "card",
            "credit",
            "debit",
            "cvv",
            "cvc",
            "csc",
            "security code",
            "pin code",
            "postal",
            "zip",
            "search",
            "coupon",
        ])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn field(
        input_type: PageInputType,
        identity: &str,
        autocomplete: &[&str],
        login_context: bool,
    ) -> PageInputFieldObservation {
        PageInputFieldObservation {
            input_type,
            disabled: false,
            read_only: false,
            autocomplete_tokens: autocomplete
                .iter()
                .map(|token| (*token).to_owned())
                .collect(),
            identity_text: identity.to_owned(),
            login_context: login_context.into(),
        }
    }

    #[test]
    fn expands_camel_case_and_separators() {
        assert_eq!(
            AuthenticationControlText::new("VerificationCode").expand_identity_text(),
            "verification code"
        );
        assert_eq!(
            AuthenticationControlText::new("login_email").expand_identity_text(),
            "login email"
        );
    }

    #[test]
    fn detects_otp_identity_without_hotpot_false_positive() {
        assert!(
            (&field(PageInputType::Text, "Enter OTP Code", &[], false,))
                .looks_like_one_time_code_field()
        );
        assert!(
            (&field(PageInputType::Tel, "VerificationCode", &[], false,))
                .looks_like_one_time_code_field()
        );
        assert!(
            !(&field(
                PageInputType::Text,
                "hotpot-special Favorite dish",
                &[],
                false,
            ))
                .looks_like_one_time_code_field()
        );
        assert!(
            !(&field(PageInputType::Text, "card-security-code", &[], false,))
                .looks_like_one_time_code_field()
        );
    }

    #[test]
    fn detects_username_with_login_context_for_bare_email() {
        let context = |label: &str| {
            (&LoginContextObservation {
                form_identity: String::new(),
                ancestor_identities: Vec::new(),
                advance_control_label: label.to_owned(),
                path_context: String::new(),
            })
                .has_login_context()
        };
        assert!(context("Entrar"));
        for label in "Submit|Entrar en el sorteo|Entrar con Amazon".split('|') {
            assert!(!context(label));
        }
        assert!(
            !(&field(PageInputType::Email, "newsletter-email", &[], true,))
                .looks_like_username_field()
        );
        assert!(
            !(&field(PageInputType::Email, "primary", &[], false,)).looks_like_username_field()
        );
        assert!((&field(PageInputType::Email, "primary", &[], true,)).looks_like_username_field());
        assert!((&field(PageInputType::Text, "loginfmt", &[], false,)).looks_like_username_field());
    }

    #[test]
    fn email_webauthn_is_distinct_from_generic_standards_email() {
        assert_eq!(
            (&field(
                PageInputType::Text,
                "identity",
                &["email", "webauthn"],
                false,
            ))
                .authentication_username_evidence(),
            AuthenticationUsernameEvidence::WebAuthnEmail
        );
        assert_eq!(
            (&field(PageInputType::Text, "identity", &["email"], false,))
                .authentication_username_evidence(),
            AuthenticationUsernameEvidence::StandardsBasedEmail
        );
        assert_eq!(
            (&field(
                PageInputType::Text,
                "newsletter-email",
                &["email", "webauthn"],
                false,
            ))
                .authentication_username_evidence(),
            AuthenticationUsernameEvidence::Absent
        );
        assert_eq!(
            (&field(
                PageInputType::Text,
                "identity",
                &["username", "webauthn"],
                false,
            ))
                .authentication_username_evidence(),
            AuthenticationUsernameEvidence::Explicit
        );
        assert_eq!(
            AuthenticationUsernameEvidence::strongest_authentication_username_evidence(&[
                AuthenticationUsernameEvidence::StandardsBasedEmail,
                AuthenticationUsernameEvidence::Strong,
                AuthenticationUsernameEvidence::WebAuthnEmail,
            ]),
            AuthenticationUsernameEvidence::WebAuthnEmail
        );
    }

    #[test]
    fn passkey_and_manual_checkpoint_labels() {
        assert!(
            AuthenticationAdvanceControlObservation::looks_like_manual_checkpoint_label(
                "I agree to the Terms"
            )
        );
        assert!(
            AuthenticationAdvanceControlObservation::looks_like_email_verification_body(
                "Please verify your email to continue"
            )
        );
    }

    #[test]
    fn login_advance_labels_require_authentication_words() {
        for label in "Next|Proceed|SignIn|signin|Sign   In|Login|Log\tin|Submit|Entrar|Entrar Entrar Entrar|Anmelden Anmelden Anmelden|Se connecter Se connecter Se connecter".split('|') {
            assert!(AuthenticationAdvanceControlObservation::looks_like_login_advance_control_label(label));
        }
        for label in "Learn more|Subscribe|Submit order|Continue to reset password|Entrar con Amazon|Entrar con Foo|Anmelden Anmelden Foo|Se connecter Se connecter Amazon|Continue with X".split('|') {
            assert!(!AuthenticationAdvanceControlObservation::looks_like_login_advance_control_label(label));
        }
        let oversized = "x".repeat(MAX_AUTHENTICATION_CONTROL_TEXT_BYTES + 1);
        assert!(
            !AuthenticationAdvanceControlObservation::looks_like_login_advance_control_label(
                &oversized
            )
        );
    }

    #[test]
    fn activation_accepts_only_bounded_semantic_username_scope_evidence() {
        let decide = |form: &str, label: &str, concrete, username, local, password| {
            let (machine, visible_label) = label
                .strip_prefix("machine:")
                .map_or(("", label), |machine| (machine, "Continue"));
            AuthenticationAdvanceControlObservation::can_activate_authentication_route_control(
                AuthenticationRouteActuation {
                    source_origin: "https://login.microsoftonline.com",
                    form_identity: form,
                    destination_identity: "https://login.microsoftonline.com/common/login",
                    control_label: visible_label,
                    control_machine_identity: machine,
                    has_concrete_control: concrete.into(),
                    has_authentication_username: username.into(),
                    has_local_authentication_scope: local.into(),
                    has_authentication_password: password.into(),
                },
            )
        };
        assert!(decide("", "", false, true, true, false));
        assert!(!decide("", "", true, true, true, false));
        for label in "Sign in to Microsoft 365|Continue with email address|Continue with your email|Continue with your email address|Use your password to sign in|Se connecter|Anmelden".split('|') {
            assert!(decide("f", label, true, true, true, false));
        }
        assert!(decide("login-form", "Sign in", true, true, true, false));
        for label in "Continue with Amazon|Sign in to Google|Sign in to Amazon|Amazon login|Discord login|machine:delete-account|machine:reset-password|machine:create-account|machine:google|machine:passkey|machine:provider=acme|Sign in to Microsoft and reset password|Sign in to Microsoft or Google".split('|') {
            assert!(!decide("login-form", label, true, true, true, false));
        }
        assert!(!decide("f", "Entrar", true, true, false, false));
        assert!(!decide("f", "Supprimer le compte", true, true, true, false));
        assert!(decide("", "", false, false, true, true));
        assert!(!decide("", "", false, false, true, false));
    }

    #[test]
    fn route_identity_requires_positive_same_origin_authentication_evidence() {
        let safe = |form, destination| {
            AuthenticationAdvanceControlObservation::has_safe_authentication_route_identity(
                AuthenticationRouteEvidence {
                    source_origin: "https://example.test",
                    form_identity: form,
                    destination_identity: destination,
                },
            )
        };
        for destination in "https://example.test/login?notprovider=x&notconnection=enterprise&continue=https://mail.google.com|https://example.test/auth/login?x=1|https://example.test/v3/signin/identifier|https://example.test/auth/sign-in/identifier|https://example.test/account/sign-in|https://example.test/authentication/login|https://example.test/v2/auth/signin|https://example.test/signin/callback|https://example.test/login/v2".split('|') {
            assert!(safe("login-form", destination), "{destination}");
        }
        for form in "reset-password|signup-form|google-login|passkey-login".split('|') {
            assert!(!safe(form, "https://example.test/auth/login"));
        }
        for destination in "https://example.test/login?provider|https://example.test/login?providerId=custom|https://example.test/login?provider_name=custom|https://example.test/login?idp_id=custom|https://example.test/login?idp_name=custom|https://example.test/login?identityProviderName=custom|https://example.test/login?connection=enterprise|https://example.test/login?connection_id=enterprise|https://example.test/login?connectionName=enterprise|https://example.test/login#idpId=custom|https://example.test/login#providerName=custom|https://example.test/login#provider_id=custom|https://example.test/login?next=/home#google|https://example.test/login#provider=acme|https://example.test/login?next=/home#provider=acme|https://example.test/login?identity_provider=amazon|https://example.test/signin/x|https://example.test/signin/auth0|https://example.test/sign-in/auth0|https://example.test/sign_in/auth0|https://example.test/sign.in/auth0|https://example.test/log-in/auth0|https://example.test/log_in/auth0|https://example.test/auth/auth0/login|https://example.test/auth/acme/signin|https://example.test/signin/callback/acme|https://example.test/account/close|https://example.test/login/amazon|https://example.test/orders/123/submit|https://example.test/auth/login?action=close+account|https://example.test/auth/provider/acme|https://example.test/auth/idp/acme|https://example.test/login/provider/acme|https://example.test/login/discord".split('|') {
            assert!(!safe("login-form", destination), "{destination}");
        }
        let oversized = "x".repeat(MAX_AUTHENTICATION_CONTROL_TEXT_BYTES + 1);
        assert!(!safe(&oversized, "/auth/login"));
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PasskeyControlMarking {
    Explicit,
    Implicit,
}

mod route_evidence;
pub use route_evidence::*;

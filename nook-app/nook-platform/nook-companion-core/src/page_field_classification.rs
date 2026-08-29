//! Portable auth-field role classification from browser-collected identity text.
//!
//! DOM query, visibility, and fill stay in the host adapter. This module owns
//! which identity strings count as username, OTP, passkey, or manual-checkpoint
//! signals used to build authentication workflow observations in the host.

mod authentication_advance_control;
mod control_identity;
mod destination_identity;
mod form_identity;
mod one_time_code_progression;

/// Maximum byte length for each DOM-controlled authentication identity string.
pub const MAX_AUTHENTICATION_CONTROL_TEXT_BYTES: usize = 512;

pub use authentication_advance_control::{
    AuthenticationAdvanceControlDecision, AuthenticationAdvanceControlObservation,
    PageControlActionability, PageControlOwnership, PageControlSemantics,
};
pub use destination_identity::{CanonicalControlDestination, canonicalize_control_destination};
pub use one_time_code_progression::looks_like_one_time_code_auto_submit_signal;

/// Validate one bounded advance-control observation for exact browser actuation.
#[must_use]
pub fn authentication_advance_control_is_safe(
    observation: &AuthenticationAdvanceControlObservation,
) -> bool {
    matches!(
        observation.classify(),
        AuthenticationAdvanceControlDecision::AdvancesAuthentication
    )
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
    pub login_context: bool,
}

/// Expand camelCase / separators into lowercase identity tokens for matching.
#[must_use]
pub fn expand_identity_text(value: &str) -> String {
    let mut with_breaks = String::with_capacity(value.len() * 2);
    let chars: Vec<char> = value.chars().collect();
    for (index, c) in chars.iter().enumerate() {
        if index > 0 {
            let prev = chars[index - 1];
            let needs_break = (prev.is_ascii_lowercase() && c.is_ascii_uppercase())
                || (prev.is_ascii_alphabetic() && c.is_ascii_digit())
                || (prev.is_ascii_digit() && c.is_ascii_alphabetic());
            if needs_break {
                with_breaks.push(' ');
            }
        }
        if matches!(*c, '_' | '-' | '.' | '/' | '#') {
            with_breaks.push(' ');
        } else {
            with_breaks.push(*c);
        }
    }
    with_breaks
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase()
}

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
    "next", "continue", "signin", "sign-in", "sign in", "login", "log-in", "log in", "verify",
    "entrar",
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

pub(super) const PASSKEY_OR_PLATFORM_AUTHENTICATOR_WORDS: &[&str] = &[
    "pass key",
    "passkey",
    "webauthn",
    "security key",
    "hardware key",
    "fido",
    "touch id",
    "face id",
    "windows hello",
];

/// True when form/path/ancestor context looks like a login surface.
#[must_use]
pub fn has_login_context(observation: &LoginContextObservation) -> bool {
    let form = expand_identity_text(&observation.form_identity);
    if contains_any_word(&form, LOGIN_SURFACE_WORDS) {
        return true;
    }
    for ancestor in &observation.ancestor_identities {
        let identity = expand_identity_text(ancestor);
        if contains_any_word(&identity, LOGIN_SURFACE_WORDS) {
            return true;
        }
    }
    let advance = expand_identity_text(&observation.advance_control_label);
    if advance != "submit"
        && looks_like_login_advance_control_label(&observation.advance_control_label)
    {
        return true;
    }
    let path = observation.path_context.to_ascii_lowercase();
    contains_any_word(&path, LOGIN_PATH_WORDS)
}

/// Classify whether an input should count as a username/email identity field.
#[must_use]
pub fn looks_like_username_field(field: &PageInputFieldObservation) -> bool {
    if field.disabled
        || field.read_only
        || !matches!(
            field.input_type,
            PageInputType::Text | PageInputType::Email | PageInputType::Tel
        )
    {
        return false;
    }
    if has_autocomplete_token(&field.autocomplete_tokens, "username")
        || has_autocomplete_token(&field.autocomplete_tokens, "email")
    {
        return true;
    }
    let identity = expand_identity_text(&field.identity_text);
    if identity.is_empty() || username_negative(&identity) {
        return false;
    }
    if username_positive(&identity) {
        return true;
    }
    field.input_type == PageInputType::Email && field.login_context
}

/// Classify whether an input should count as a one-time-code field.
#[must_use]
pub fn looks_like_one_time_code_field(field: &PageInputFieldObservation) -> bool {
    if field.disabled
        || field.read_only
        || !matches!(
            field.input_type,
            PageInputType::Text
                | PageInputType::Tel
                | PageInputType::Number
                | PageInputType::Password
        )
    {
        return false;
    }
    // Identity text from the host includes autocomplete tokens. Prefer tokenized
    // identity over CSS substring selectors so names like "hotpot" are not OTP.
    let identity = expand_identity_text(&field.identity_text);
    if identity.is_empty() || one_time_code_negative(&identity) {
        return false;
    }
    one_time_code_positive(&identity)
        || has_autocomplete_token(&field.autocomplete_tokens, "one-time-code")
}

/// True when a labeled control advertises passkey / `WebAuthn` / platform authenticator.
#[must_use]
pub fn looks_like_passkey_control_label(label: &str) -> bool {
    let identity = expand_identity_text(label);
    !contains_any_word(
        &identity,
        &[
            "delete",
            "remove",
            "revoke",
            "unlink",
            "disconnect",
            "disable",
            "deactivate",
        ],
    ) && contains_any_word(&identity, PASSKEY_OR_PLATFORM_AUTHENTICATOR_WORDS)
}

/// True when a checkbox/control label looks like terms / privacy acceptance.
#[must_use]
pub fn looks_like_manual_checkpoint_label(label: &str) -> bool {
    let lower = label.to_ascii_lowercase();
    [
        "terms", "privacy", "agree", "accept", "policy", "consent", "eula",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

/// True when body copy looks like an email-verification gate.
#[must_use]
pub fn looks_like_email_verification_body(body: &str) -> bool {
    let lower = body.to_ascii_lowercase();
    [
        "verify your email",
        "check your email",
        "email verification",
        "confirm your email",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

/// True when an activatable control advances an authentication ceremony.
#[must_use]
pub fn looks_like_login_advance_control_label(label: &str) -> bool {
    if label.len() > MAX_AUTHENTICATION_CONTROL_TEXT_BYTES
        || form_identity::form_identity_indicates_destructive_action(label)
        || looks_like_non_authentication_submit_control_label(label)
        || control_identity::looks_like_password_recovery_route_control_label(label)
        || control_identity::looks_like_registration_route_control_label(label)
        || control_identity::looks_like_alternate_authentication_route_control_label(label)
    {
        return false;
    }
    looks_like_unrestricted_login_advance_control_label(label)
}

fn looks_like_unrestricted_login_advance_control_label(label: &str) -> bool {
    let identity = expand_identity_text(label);
    if contains_any_word(&identity, &["entrar"])
        && identity.split_whitespace().any(|token| token != "entrar")
    {
        return false;
    }
    repeated_localized_login_label(&identity)
        || contains_any_word(&identity, LOGIN_ADVANCE_WORDS)
        || contains_any_word(&identity, &["submit"])
}

fn repeated_localized_login_label(identity: &str) -> bool {
    let tokens = identity.split_whitespace().collect::<Vec<_>>();
    !tokens.is_empty()
        && (tokens.iter().all(|token| *token == "anmelden")
            || (tokens.len() % 2 == 0 && tokens.chunks(2).all(|pair| pair == ["se", "connecter"])))
}

pub(super) fn looks_like_supported_localized_login_control_label(label: &str) -> bool {
    repeated_localized_login_label(&expand_identity_text(label))
}

/// True when a semantic submit explicitly describes a non-authentication action.
#[must_use]
pub fn looks_like_non_authentication_submit_control_label(label: &str) -> bool {
    let identity = expand_identity_text(label);
    contains_any_word(
        &identity,
        &[
            "save",
            "update",
            "subscribe",
            "search",
            "publish",
            "post",
            "delete",
            "remove",
            "deactivate",
            "close account",
            "erase",
            "destroy",
            "cancel",
            "back",
            "help",
            "learn more",
        ],
    )
}

#[must_use]
pub fn looks_like_password_update_submit_control_label(label: &str) -> bool {
    let identity = expand_identity_text(label);
    matches!(
        identity.as_str(),
        "save" | "save changes" | "save and continue" | "update" | "update credentials" | "change"
    ) || (contains_any_word(&identity, &["password"])
        && contains_any_word(&identity, &["save", "update", "change", "set", "reset"]))
}

pub(crate) fn one_time_code_ceremony_context_is_authenticated(
    _authentication_username: AuthenticationUsernameEvidence,
    source_origin: &str,
    form_identity: &str,
    destination_identity: &str,
) -> bool {
    if [source_origin, form_identity, destination_identity]
        .into_iter()
        .any(|value| value.len() > MAX_AUTHENTICATION_CONTROL_TEXT_BYTES)
    {
        return false;
    }
    let Some(destination) =
        destination_identity::canonicalize_control_destination(source_origin, destination_identity)
    else {
        return false;
    };
    if form_identity::form_identity_indicates_destructive_action(form_identity)
        || form_identity::form_identity_indicates_non_authentication_account_management(
            form_identity,
        )
        || form_identity::form_identity_indicates_destructive_action(&destination.route_identity)
        || form_identity::control_destination_indicates_non_authentication_route(
            &destination.route_identity,
        )
        || form_identity::destination_has_disallowed_action_or_provider(
            &destination.route_identity,
            false,
            false,
        )
    {
        return false;
    }
    [form_identity, destination.path_identity.as_str()]
        .into_iter()
        .any(form_identity::identity_indicates_one_time_code_authentication_context)
}

pub(crate) fn authentication_passkey_control_is_safe(
    observation: &AuthenticationAdvanceControlObservation,
    explicitly_marked: bool,
) -> bool {
    let label_identity = expand_identity_text(&observation.label);
    let label_names_passkey_credential = contains_any_word(
        &label_identity,
        &[
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
        ],
    );
    let label_names_enrollment_or_management = contains_any_word(
        &label_identity,
        &[
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
        ],
    );
    let label_names_passkey_enrollment_or_management =
        label_names_passkey_credential && label_names_enrollment_or_management;
    let label_names_device_management = label_names_enrollment_or_management
        && contains_any_word(&label_identity, &["device", "devices"]);
    if !observation.is_bounded()
        || !matches!(
            observation.actionability,
            PageControlActionability::Actionable
        )
        || !matches!(
            observation.ownership,
            PageControlOwnership::OwnedForm | PageControlOwnership::LocallyScoped
        )
        || (!explicitly_marked && !looks_like_passkey_control_label(&observation.label))
        || form_identity::form_identity_indicates_destructive_action(&observation.label)
        || label_names_passkey_enrollment_or_management
        || label_names_device_management
        || form_identity::form_identity_indicates_destructive_action(&observation.form_identity)
        || form_identity::form_identity_indicates_non_authentication_account_management(
            &observation.form_identity,
        )
    {
        return false;
    }
    let Some(destination) = destination_identity::canonicalize_control_destination(
        &observation.source_origin,
        &observation.destination_identity,
    ) else {
        return false;
    };
    let has_authentication_context = observation.password_field_count > 0
        || observation.one_time_code_field_count > 0
        || matches!(
            observation.authentication_username,
            AuthenticationUsernameEvidence::Strong | AuthenticationUsernameEvidence::Explicit
        )
        || form_identity::identity_indicates_explicit_authentication_route(
            &observation.form_identity,
        )
        || form_identity::identity_indicates_explicit_authentication_route(
            &destination.path_identity,
        );
    if !has_authentication_context {
        return false;
    }
    if passkey_new_password_ceremony_lacks_assertion_state(observation, &destination) {
        return false;
    }
    !form_identity::form_identity_indicates_destructive_action(&destination.route_identity)
        && !form_identity::control_destination_indicates_non_authentication_route(
            &destination.route_identity,
        )
        && !form_identity::passkey_destination_has_disallowed_action_or_provider(
            &destination.route_identity,
        )
}

fn passkey_new_password_ceremony_lacks_assertion_state(
    observation: &AuthenticationAdvanceControlObservation,
    destination: &CanonicalControlDestination,
) -> bool {
    observation.new_password_field_count > 0
        && !form_identity::identity_indicates_explicit_login_route(&destination.path_identity)
        && !form_identity::identity_indicates_explicit_login_route(&destination.route_identity)
}

/// Decide whether bounded form and destination identities describe a safe authentication route.
#[must_use]
pub fn has_safe_authentication_route_identity(
    source_origin: &str,
    form_identity: &str,
    destination_identity: &str,
) -> bool {
    if [source_origin, form_identity, destination_identity]
        .into_iter()
        .any(|value| value.len() > MAX_AUTHENTICATION_CONTROL_TEXT_BYTES)
    {
        return false;
    }
    if form_identity::identity_has_authentication_control_veto(form_identity) {
        return false;
    }
    let Some(destination) =
        destination_identity::canonicalize_control_destination(source_origin, destination_identity)
    else {
        return false;
    };
    if form_identity::control_destination_indicates_non_authentication_route(
        &destination.route_identity,
    ) || form_identity::destination_has_disallowed_action_or_provider(
        &destination.route_identity,
        false,
        false,
    ) {
        return false;
    }
    form_identity::identity_indicates_explicit_authentication_route(form_identity)
        || form_identity::destination_has_safe_login_identity(&destination.path_identity)
}

/// Admit implicit credential-creation on register, recovery, or password-update routes.
#[must_use]
pub fn has_safe_credential_update_route_identity(
    source_origin: &str,
    form_identity: &str,
    destination_identity: &str,
) -> bool {
    if [source_origin, form_identity, destination_identity]
        .into_iter()
        .any(|value| value.len() > MAX_AUTHENTICATION_CONTROL_TEXT_BYTES)
    {
        return false;
    }
    if form_identity::destination_has_disallowed_action_or_provider(form_identity, true, false)
        || control_identity::looks_like_auxiliary_authentication_control_label(form_identity)
    {
        return false;
    }
    let Some(destination) =
        destination_identity::canonicalize_control_destination(source_origin, destination_identity)
    else {
        return false;
    };
    if form_identity::destination_has_disallowed_action_or_provider(
        &destination.route_identity,
        true,
        false,
    ) {
        return false;
    }
    let credential_update_route =
        form_identity::control_destination_indicates_registration_route(
            &destination.route_identity,
        ) || form_identity::control_destination_indicates_password_recovery_route(
            &destination.route_identity,
        ) || form_identity::control_destination_indicates_password_update_route(
            &destination.route_identity,
        );
    if form_identity::control_destination_indicates_non_authentication_route(
        &destination.route_identity,
    ) && !credential_update_route
    {
        return false;
    }
    form_identity::identity_indicates_explicit_authentication_route(form_identity)
        || form_identity::destination_has_safe_login_identity(&destination.path_identity)
        || credential_update_route
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum AuthenticationUsernameEvidence {
    Absent,
    Generic,
    StandardsBasedEmail,
    Strong,
    Explicit,
}

#[must_use]
pub fn authentication_username_evidence(
    field: &PageInputFieldObservation,
) -> AuthenticationUsernameEvidence {
    if !looks_like_username_field(field) {
        return AuthenticationUsernameEvidence::Absent;
    }
    if has_autocomplete_token(&field.autocomplete_tokens, "username") {
        return AuthenticationUsernameEvidence::Explicit;
    }
    let identity = expand_identity_text(&field.identity_text);
    if has_autocomplete_token(&field.autocomplete_tokens, "email") {
        return if username_negative(&identity) {
            AuthenticationUsernameEvidence::Generic
        } else if field.login_context {
            AuthenticationUsernameEvidence::Strong
        } else {
            AuthenticationUsernameEvidence::StandardsBasedEmail
        };
    }
    if contains_any_word(
        &identity,
        &[
            "loginfmt",
            "login fmt",
            "login email",
            "login e mail",
            "login e-mail",
        ],
    ) {
        AuthenticationUsernameEvidence::Strong
    } else {
        AuthenticationUsernameEvidence::Generic
    }
}

/// Select the strongest username evidence without duplicating its ordering in hosts.
#[must_use]
pub fn strongest_authentication_username_evidence(
    evidence: &[AuthenticationUsernameEvidence],
) -> AuthenticationUsernameEvidence {
    if evidence.contains(&AuthenticationUsernameEvidence::Explicit) {
        AuthenticationUsernameEvidence::Explicit
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

/// Decide whether a locally scoped control may advance a safe authentication route.
#[must_use]
#[expect(clippy::too_many_arguments, reason = "typed WASM policy boundary")]
pub fn can_activate_authentication_route_control(
    source_origin: &str,
    form_identity: &str,
    destination_identity: &str,
    control_label: &str,
    control_machine_identity: &str,
    has_concrete_control: bool,
    has_authentication_username: bool,
    has_local_authentication_scope: bool,
) -> bool {
    if !has_safe_authentication_route_identity(source_origin, form_identity, destination_identity)
        || control_label.len() > MAX_AUTHENTICATION_CONTROL_TEXT_BYTES
        || control_machine_identity.len() > MAX_AUTHENTICATION_CONTROL_TEXT_BYTES
        || form_identity::identity_has_authentication_control_veto(control_machine_identity)
    {
        return false;
    }
    let has_matching_microsoft_authority =
        destination_identity::canonicalize_control_destination(source_origin, destination_identity)
            .is_some_and(|destination| destination.has_microsoft_provider_authority)
            && control_identity::looks_like_microsoft_primary_sign_in_label(control_label);
    if control_identity::label_names_external_authentication_provider(control_label)
        && !has_matching_microsoft_authority
    {
        return false;
    }
    if looks_like_login_advance_control_label(control_label) {
        return has_authentication_username && has_local_authentication_scope;
    }
    control_label.is_empty()
        && !has_concrete_control
        && has_authentication_username
        && has_local_authentication_scope
}

fn has_autocomplete_token(tokens: &[String], expected: &str) -> bool {
    tokens
        .iter()
        .any(|token| token.eq_ignore_ascii_case(expected))
}

fn username_positive(identity: &str) -> bool {
    contains_any_word(
        identity,
        &[
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
        ],
    )
}

fn username_negative(identity: &str) -> bool {
    contains_any_word(
        identity,
        &[
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
        ],
    )
}

fn one_time_code_positive(identity: &str) -> bool {
    contains_any_word(
        identity,
        &[
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
        ],
    )
}

fn one_time_code_negative(identity: &str) -> bool {
    contains_any_word(
        identity,
        &[
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
        ],
    )
}

fn contains_any_word(haystack: &str, needles: &[&str]) -> bool {
    needles
        .iter()
        .any(|needle| contains_word_phrase(haystack, needle))
}

fn contains_word_phrase(haystack: &str, phrase: &str) -> bool {
    let Some(mut start) = haystack.find(phrase) else {
        return false;
    };
    loop {
        let end = start + phrase.len();
        let before_ok = start == 0
            || !haystack
                .as_bytes()
                .get(start - 1)
                .copied()
                .is_some_and(is_word_byte);
        let after_ok = end >= haystack.len()
            || !haystack
                .as_bytes()
                .get(end)
                .copied()
                .is_some_and(is_word_byte);
        if before_ok && after_ok {
            return true;
        }
        let next = haystack[start + 1..]
            .find(phrase)
            .map(|offset| start + 1 + offset);
        match next {
            Some(index) => start = index,
            None => return false,
        }
    }
}

const fn is_word_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
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
            login_context,
        }
    }

    #[test]
    fn expands_camel_case_and_separators() {
        assert_eq!(
            expand_identity_text("VerificationCode"),
            "verification code"
        );
        assert_eq!(expand_identity_text("login_email"), "login email");
    }

    #[test]
    fn detects_otp_identity_without_hotpot_false_positive() {
        assert!(looks_like_one_time_code_field(&field(
            PageInputType::Text,
            "Enter OTP Code",
            &[],
            false,
        )));
        assert!(looks_like_one_time_code_field(&field(
            PageInputType::Tel,
            "VerificationCode",
            &[],
            false,
        )));
        assert!(!looks_like_one_time_code_field(&field(
            PageInputType::Text,
            "hotpot-special Favorite dish",
            &[],
            false,
        )));
        assert!(!looks_like_one_time_code_field(&field(
            PageInputType::Text,
            "card-security-code",
            &[],
            false,
        )));
    }

    #[test]
    fn detects_username_with_login_context_for_bare_email() {
        let context = |label: &str| {
            has_login_context(&LoginContextObservation {
                form_identity: String::new(),
                ancestor_identities: Vec::new(),
                advance_control_label: label.to_owned(),
                path_context: String::new(),
            })
        };
        assert!(context("Entrar"));
        for label in "Submit|Entrar en el sorteo|Entrar con Amazon".split('|') {
            assert!(!context(label));
        }
        assert!(!looks_like_username_field(&field(
            PageInputType::Email,
            "newsletter-email",
            &[],
            true,
        )));
        assert!(!looks_like_username_field(&field(
            PageInputType::Email,
            "primary",
            &[],
            false,
        )));
        assert!(looks_like_username_field(&field(
            PageInputType::Email,
            "primary",
            &[],
            true,
        )));
        assert!(looks_like_username_field(&field(
            PageInputType::Text,
            "loginfmt",
            &[],
            false,
        )));
    }

    #[test]
    fn passkey_and_manual_checkpoint_labels() {
        assert!(looks_like_passkey_control_label("Sign in with passkey"));
        assert!(!looks_like_passkey_control_label("Continue"));
        assert!(looks_like_manual_checkpoint_label("I agree to the Terms"));
        assert!(looks_like_email_verification_body(
            "Please verify your email to continue"
        ));
    }

    #[test]
    fn login_advance_labels_require_authentication_words() {
        for label in "Next|SignIn|signin|Sign   In|Login|Log\tin|Submit|Entrar|Entrar Entrar Entrar|Anmelden Anmelden Anmelden|Se connecter Se connecter Se connecter".split('|') {
            assert!(looks_like_login_advance_control_label(label));
        }
        for label in "Learn more|Subscribe|Submit order|Continue to reset password|Entrar con Amazon|Entrar con Foo|Anmelden Anmelden Foo|Se connecter Se connecter Amazon|Continue with X".split('|') {
            assert!(!looks_like_login_advance_control_label(label));
        }
        let oversized = "x".repeat(MAX_AUTHENTICATION_CONTROL_TEXT_BYTES + 1);
        assert!(!looks_like_login_advance_control_label(&oversized));
    }

    #[test]
    fn activation_accepts_only_bounded_semantic_username_scope_evidence() {
        let decide = |form: &str, label: &str, concrete, username, local| {
            let (machine, visible_label) = label
                .strip_prefix("machine:")
                .map_or(("", label), |machine| (machine, "Continue"));
            can_activate_authentication_route_control(
                "https://login.microsoftonline.com",
                form,
                "https://login.microsoftonline.com/common/login",
                visible_label,
                machine,
                concrete,
                username,
                local,
            )
        };
        assert!(decide("", "", false, true, true));
        assert!(!decide("", "", true, true, true));
        for label in "Sign in to Microsoft 365|Continue with email address|Continue with your email|Continue with your email address|Use your password to sign in|Se connecter|Anmelden".split('|') {
            assert!(decide("f", label, true, true, true));
        }
        assert!(decide("login-form", "Sign in", true, true, true));
        for label in "Continue with Amazon|Sign in to Google|Sign in to Amazon|Amazon login|Discord login|machine:delete-account|machine:reset-password|machine:create-account|machine:google|machine:passkey|machine:provider=acme|Sign in to Microsoft and reset password|Sign in to Microsoft or Google".split('|') {
            assert!(!decide("login-form", label, true, true, true));
        }
        assert!(!decide("f", "Entrar", true, true, false));
        assert!(!decide("f", "Supprimer le compte", true, true, true));
    }

    #[test]
    fn route_identity_requires_positive_same_origin_authentication_evidence() {
        let safe = |form, destination| {
            has_safe_authentication_route_identity("https://example.test", form, destination)
        };
        for destination in "https://example.test/login?notprovider=x&notconnection=enterprise&continue=https://mail.google.com|https://example.test/auth/login?x=1|https://example.test/v3/signin/identifier|https://example.test/auth/sign-in/identifier|https://example.test/authentication/login|https://example.test/v2/auth/signin|https://example.test/signin/callback|https://example.test/login/v2".split('|') {
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

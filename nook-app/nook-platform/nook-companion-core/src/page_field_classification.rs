//! Portable auth-field role classification from browser-collected identity text.
//!
//! DOM query, visibility, and fill stay in the host adapter. This module owns
//! which identity strings count as username, OTP, passkey, or manual-checkpoint
//! signals used to build authentication workflow observations in the host.

mod destination_identity;

/// Maximum byte length for each DOM-controlled authentication identity string.
pub const MAX_AUTHENTICATION_CONTROL_TEXT_BYTES: usize = 512;

pub use destination_identity::{CanonicalControlDestination, canonicalize_control_destination};

use serde::{Deserialize, Serialize};
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
        if *c == '_' || *c == '-' || *c == '.' {
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
    if contains_any_word(&advance, LOGIN_ADVANCE_WORDS) {
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
    contains_any_word(
        &identity,
        &[
            "pass key",
            "passkey",
            "webauthn",
            "security key",
            "hardware key",
            "fido",
            "touch id",
            "face id",
            "windows hello",
        ],
    )
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
    let identity = expand_identity_text(label);
    contains_any_word(&identity, LOGIN_ADVANCE_WORDS) || contains_any_word(&identity, &["submit"])
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
        assert!(looks_like_login_advance_control_label("Next"));
        assert!(looks_like_login_advance_control_label("SignIn"));
        assert!(looks_like_login_advance_control_label("signin"));
        assert!(looks_like_login_advance_control_label("Sign   In"));
        assert!(looks_like_login_advance_control_label("Login"));
        assert!(looks_like_login_advance_control_label("Log\tin"));
        assert!(looks_like_login_advance_control_label("Submit"));
        assert!(!looks_like_login_advance_control_label("Learn more"));
        assert!(!looks_like_login_advance_control_label("Subscribe"));
    }
}

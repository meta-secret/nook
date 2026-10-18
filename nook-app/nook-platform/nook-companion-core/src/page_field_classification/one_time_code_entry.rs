//! Second-factor route and code-shaped entry evidence for one-time-code inputs.
//!
//! Hosts collect the login-context path and the raw `inputmode`, `maxLength`, and `pattern`
//! attributes. This module converts them once and owns every decision made from them.

use super::control_text::AuthenticationIdentityPhraseEvidence;
use super::form_identity::{AuthenticationRouteDecision, AuthenticationRouteIdentity};
use super::input_role::{AuthenticationInputRole, OneTimeCode, Unrelated};
use super::{
    AuthenticationControlText, LoginContextObservation, PageInputFieldObservation, PageInputType,
};
use serde::{Deserialize, Serialize};

/// Whether the login-context path names a second-factor challenge route.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PageSecondFactorRoute {
    Unrelated,
    SecondFactor,
}

impl PageSecondFactorRoute {
    /// Expanded path words naming a second-factor challenge.
    #[rustfmt::skip]
    const ROUTE_WORDS: &[&str] = &[
        "otp", "totp", "2 fa", "twofa", "two factor", "twofactor", "mfa", "2 sv", "two step",
        "twostep", "2 step", "one time code", "verification code", "authenticator",
    ];
}

/// The WASM constructor receives this Rust decision back as a boolean transport value.
impl From<bool> for PageSecondFactorRoute {
    #[expect(
        clippy::match_bool,
        reason = "Convert the boolean transport value immediately into the owned route state"
    )]
    fn from(second_factor: bool) -> Self {
        match second_factor {
            true => Self::SecondFactor,
            false => Self::Unrelated,
        }
    }
}

impl LoginContextObservation {
    /// Decide whether the path names a second-factor challenge rather than its setup or management.
    #[must_use]
    pub fn second_factor_route(&self) -> PageSecondFactorRoute {
        let route = AuthenticationRouteIdentity::new(&self.path_context);
        match route.form_admission() {
            AuthenticationRouteDecision::Eligible => {}
            AuthenticationRouteDecision::Destructive
            | AuthenticationRouteDecision::AccountManagement
            | AuthenticationRouteDecision::Unrelated
            | AuthenticationRouteDecision::DisallowedDestination => {
                return PageSecondFactorRoute::Unrelated;
            }
        }
        let path = AuthenticationControlText::new(&self.path_context).expand_identity_text();
        match (
            route.indicates_authenticator_enrollment(),
            AuthenticationControlText::new(&path)
                .contains_any_word(PageSecondFactorRoute::ROUTE_WORDS),
        ) {
            (false, true) => PageSecondFactorRoute::SecondFactor,
            (true, _) | (false, false) => PageSecondFactorRoute::Unrelated,
        }
    }
}

/// Raw `inputmode` attribute; `Other` includes an absent attribute.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PageInputMode {
    Numeric,
    Other,
}

impl From<&str> for PageInputMode {
    fn from(raw: &str) -> Self {
        match raw.trim().to_ascii_lowercase().as_str() {
            "numeric" => Self::Numeric,
            _ => Self::Other,
        }
    }
}

/// Non-negative character limit declared by an input's `maxlength` attribute.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PageInputCharacterLimit(u32);

impl PageInputCharacterLimit {
    const SHORTEST_CODE: u32 = 4;
    const LONGEST_CODE: u32 = 10;
}

/// DOM `HTMLInputElement.maxLength`, which reports -1 when the attribute is absent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PageInputMaxLength {
    Absent,
    Limited(PageInputCharacterLimit),
}

impl From<i32> for PageInputMaxLength {
    fn from(raw: i32) -> Self {
        match u32::try_from(raw) {
            Ok(limit) => Self::Limited(PageInputCharacterLimit(limit)),
            Err(_) => Self::Absent,
        }
    }
}

/// Raw `pattern` attribute; `Digits` is a digit class with only a repetition quantifier.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PageInputPattern {
    Digits,
    Other,
}

impl From<&str> for PageInputPattern {
    fn from(raw: &str) -> Self {
        let pattern = raw.trim().trim_start_matches('^').trim_end_matches('$');
        let Some(quantifier) = pattern
            .strip_prefix("\\d")
            .or_else(|| pattern.strip_prefix("[0-9]"))
        else {
            return Self::Other;
        };
        match quantifier
            .bytes()
            .find(|byte| !byte.is_ascii_digit() && !b"{},*+".contains(byte))
        {
            None => Self::Digits,
            Some(_) => Self::Other,
        }
    }
}

/// Entry signals a field-observation producer collected for one input.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OneTimeCodeEntrySignals {
    pub second_factor_route: PageSecondFactorRoute,
    pub input_mode: PageInputMode,
    pub max_length: PageInputMaxLength,
    pub pattern: PageInputPattern,
}

/// Whether the observation's producer collected one-time-code entry signals.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum OneTimeCodeEntryEvidence {
    /// Field-observation producers supply the route decision and raw entry attributes.
    Observed(OneTimeCodeEntrySignals),
    /// Login-save capture metadata collects no entry signals; words and autocomplete decide alone.
    Unobserved,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CodeEntryShape {
    CodeShaped,
    Unshaped,
}

impl OneTimeCodeEntrySignals {
    /// Identity words that admit a code-shaped input without second-factor route evidence.
    const CODE_IDENTITY_WORDS: &[&str] = &["code", "passcode"];

    fn code_entry_shape(self, input_type: PageInputType) -> CodeEntryShape {
        let digit_entry = match (input_type, self.input_mode, self.pattern) {
            (PageInputType::Tel | PageInputType::Number, _, _)
            | (_, PageInputMode::Numeric, _)
            | (_, _, PageInputPattern::Digits) => CodeEntryShape::CodeShaped,
            (
                PageInputType::Text
                | PageInputType::Email
                | PageInputType::Password
                | PageInputType::Other,
                PageInputMode::Other,
                PageInputPattern::Other,
            ) => CodeEntryShape::Unshaped,
        };
        match (digit_entry, self.max_length) {
            (
                CodeEntryShape::CodeShaped,
                PageInputMaxLength::Absent
                | PageInputMaxLength::Limited(PageInputCharacterLimit(
                    PageInputCharacterLimit::SHORTEST_CODE..=PageInputCharacterLimit::LONGEST_CODE,
                )),
            ) => CodeEntryShape::CodeShaped,
            (CodeEntryShape::CodeShaped, PageInputMaxLength::Limited(_))
            | (
                CodeEntryShape::Unshaped,
                PageInputMaxLength::Absent | PageInputMaxLength::Limited(_),
            ) => CodeEntryShape::Unshaped,
        }
    }
}

impl PageInputFieldObservation {
    /// Classify a field without one-time-code words from route and entry-shape evidence.
    pub(super) fn one_time_code_entry_role(&self, identity: &str) -> AuthenticationInputRole {
        let OneTimeCodeEntryEvidence::Observed(signals) = self.one_time_code_entry else {
            return AuthenticationInputRole::Unrelated(Unrelated);
        };
        match self.input_type {
            PageInputType::Text | PageInputType::Tel | PageInputType::Number => {}
            PageInputType::Email | PageInputType::Password | PageInputType::Other => {
                return AuthenticationInputRole::Unrelated(Unrelated);
            }
        }
        match (
            signals.second_factor_route,
            signals.code_entry_shape(self.input_type),
        ) {
            (PageSecondFactorRoute::SecondFactor, _) => {
                AuthenticationInputRole::OneTimeCode(OneTimeCode)
            }
            (PageSecondFactorRoute::Unrelated, CodeEntryShape::Unshaped) => {
                AuthenticationInputRole::Unrelated(Unrelated)
            }
            (PageSecondFactorRoute::Unrelated, CodeEntryShape::CodeShaped) => {
                match AuthenticationControlText::new(identity)
                    .identity_phrase_evidence(OneTimeCodeEntrySignals::CODE_IDENTITY_WORDS)
                {
                    AuthenticationIdentityPhraseEvidence::Found(_) => {
                        AuthenticationInputRole::OneTimeCode(OneTimeCode)
                    }
                    AuthenticationIdentityPhraseEvidence::Absent => {
                        AuthenticationInputRole::Unrelated(Unrelated)
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::PageLoginContext;
    use super::*;

    struct Fixture;

    impl Fixture {
        const UNSHAPED: OneTimeCodeEntrySignals = OneTimeCodeEntrySignals {
            second_factor_route: PageSecondFactorRoute::Unrelated,
            input_mode: PageInputMode::Other,
            max_length: PageInputMaxLength::Absent,
            pattern: PageInputPattern::Other,
        };

        fn route(path_context: &str) -> PageSecondFactorRoute {
            LoginContextObservation {
                form_identity: String::new(),
                ancestor_identities: Vec::new(),
                advance_control_label: String::new(),
                path_context: path_context.to_owned(),
            }
            .second_factor_route()
        }

        /// A text input without one-time-code or code words, outside any login context.
        fn wordless(signals: OneTimeCodeEntrySignals) -> PageInputFieldObservation {
            PageInputFieldObservation {
                input_type: PageInputType::Text,
                disabled: false,
                read_only: false,
                autocomplete_tokens: Vec::new(),
                identity_text: "ctl00$MainContent$txtValue".to_owned(),
                login_context: PageLoginContext::Unrelated,
                one_time_code_entry: OneTimeCodeEntryEvidence::Observed(signals),
            }
        }

        fn one_time_code<const N: usize>(fields: [PageInputFieldObservation; N]) -> [bool; N] {
            fields.map(|field| field.looks_like_one_time_code_field())
        }
    }

    #[test]
    fn second_factor_route_names_challenges_but_not_setup_or_unrelated_pages() {
        for path in "/twofa/totp/ www.namecheap.com|/sessions/two-factor github.com|/ap/mfa www.amazon.com|/signin/challenge/totp accounts.google.com|/login/2-step example.test".split('|') {
            assert_eq!(Fixture::route(path), PageSecondFactorRoute::SecondFactor, "{path}");
        }
        for path in "/settings/two-factor/setup github.com|/account/security/2fa/enable example.test|/search www.namecheap.com|/cart/ www.namecheap.com|/login example.test".split('|') {
            assert_eq!(Fixture::route(path), PageSecondFactorRoute::Unrelated, "{path}");
        }
    }

    #[test]
    fn raw_entry_attributes_convert_once_into_typed_values() {
        assert_eq!(PageInputMaxLength::from(-1), PageInputMaxLength::Absent);
        assert_eq!(
            PageInputMaxLength::from(6),
            PageInputMaxLength::Limited(PageInputCharacterLimit(6))
        );
        assert_eq!(PageInputMode::from(" Numeric "), PageInputMode::Numeric);
        assert_eq!(PageInputMode::from(""), PageInputMode::Other);
        for pattern in r"\d{6}|[0-9]{6}|\d*|[0-9]*|^\d{4,8}$|\d+".split('|') {
            assert_eq!(
                PageInputPattern::from(pattern),
                PageInputPattern::Digits,
                "{pattern}"
            );
        }
        for pattern in r"|[A-Z]{6}|\d{x}|\w+|\d{6}[a-z]".split('|') {
            assert_eq!(
                PageInputPattern::from(pattern),
                PageInputPattern::Other,
                "{pattern}"
            );
        }
    }

    #[test]
    fn wordless_code_input_is_one_time_code_only_on_a_second_factor_route() {
        let second_factor = OneTimeCodeEntrySignals {
            second_factor_route: PageSecondFactorRoute::SecondFactor,
            ..Fixture::UNSHAPED
        };
        let numeric_six = OneTimeCodeEntrySignals {
            input_mode: PageInputMode::Numeric,
            max_length: 6.into(),
            ..Fixture::UNSHAPED
        };
        let tel = PageInputFieldObservation {
            input_type: PageInputType::Tel,
            ..Fixture::wordless(second_factor)
        };
        let unobserved = PageInputFieldObservation {
            one_time_code_entry: OneTimeCodeEntryEvidence::Unobserved,
            ..Fixture::wordless(second_factor)
        };
        let search = PageInputFieldObservation {
            identity_text: "Search".to_owned(),
            ..Fixture::wordless(second_factor)
        };
        let fields = [Fixture::wordless(second_factor), tel];
        assert_eq!(Fixture::one_time_code(fields), [true; 2]);
        let fields = [Fixture::wordless(numeric_six), unobserved, search];
        assert_eq!(Fixture::one_time_code(fields), [false; 3]);
    }

    #[test]
    fn code_shape_with_a_code_identity_is_one_time_code_without_route_evidence() {
        let code_identity = |signals| PageInputFieldObservation {
            identity_text: "ctl00$Main$txtCode".to_owned(),
            ..Fixture::wordless(signals)
        };
        let numeric = |max_length: i32| OneTimeCodeEntrySignals {
            input_mode: PageInputMode::Numeric,
            max_length: max_length.into(),
            ..Fixture::UNSHAPED
        };
        let digit_pattern = OneTimeCodeEntrySignals {
            pattern: PageInputPattern::Digits,
            ..Fixture::UNSHAPED
        };
        let text_six = OneTimeCodeEntrySignals {
            max_length: 6.into(),
            ..Fixture::UNSHAPED
        };
        let tel = PageInputFieldObservation {
            input_type: PageInputType::Tel,
            ..code_identity(Fixture::UNSHAPED)
        };
        let fields = [code_identity(numeric(6)), code_identity(digit_pattern), tel];
        assert_eq!(Fixture::one_time_code(fields), [true; 3]);
        let wordless_login = PageInputFieldObservation {
            login_context: PageLoginContext::Authentication,
            ..Fixture::wordless(numeric(6))
        };
        let fields = [
            wordless_login,
            code_identity(text_six),
            code_identity(numeric(20)),
            code_identity(numeric(3)),
        ];
        assert_eq!(Fixture::one_time_code(fields), [false; 4]);
    }

    #[test]
    fn excluded_identities_stay_excluded_and_masked_or_worded_codes_stay_one_time_code() {
        let second_factor_tel = PageInputFieldObservation {
            input_type: PageInputType::Tel,
            login_context: PageLoginContext::Authentication,
            ..Fixture::wordless(OneTimeCodeEntrySignals {
                second_factor_route: PageSecondFactorRoute::SecondFactor,
                ..Fixture::UNSHAPED
            })
        };
        for identity in "zip code|postal code|coupon code|gift code|referral code|invite code|discount code|voucher code".split('|') {
            let field = PageInputFieldObservation {
                identity_text: identity.to_owned(),
                ..second_factor_tel.clone()
            };
            assert!(!field.looks_like_one_time_code_field(), "{identity}");
        }
        for identity in "Enter OTP Code|twofaCode|2-step code|2SV code|Passcode".split('|') {
            let masked = PageInputFieldObservation {
                input_type: PageInputType::Password,
                identity_text: identity.to_owned(),
                one_time_code_entry: OneTimeCodeEntryEvidence::Unobserved,
                ..Fixture::wordless(Fixture::UNSHAPED)
            };
            assert!(masked.looks_like_one_time_code_field(), "{identity}");
        }
    }
}

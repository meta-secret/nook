//! Typed browser observations shared by synchronous field discovery and offscreen page scans.

use super::{
    AuthenticationAdvanceControlObservation, AuthenticationContainerIdentity,
    AuthenticationControlText, AuthenticationUsernameEvidence, LoginContextObservation,
    OneTimeCodeEntryEvidence, OneTimeCodeEntrySignals, PageInputFieldObservation, PageInputType,
    PageSecondFactorRoute,
};
use serde::{Deserialize, Serialize};
use tsify::Tsify;

/// The existing numeric wasm-bindgen route used by the browser message contract.
/// The domain enum's ordinary Serde representation is used by other callers.
#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(try_from = "BrowserRouteCode", into = "BrowserRouteCode")]
struct BrowserSecondFactorRoute(PageSecondFactorRoute);

#[derive(Deserialize, Serialize)]
#[serde(transparent)]
struct BrowserRouteCode(u32);

impl TryFrom<BrowserRouteCode> for BrowserSecondFactorRoute {
    type Error = &'static str;

    fn try_from(code: BrowserRouteCode) -> Result<Self, Self::Error> {
        [
            PageSecondFactorRoute::Unrelated,
            PageSecondFactorRoute::SecondFactor,
        ]
        .into_iter()
        .find(|route| *route as u32 == code.0)
        .map(Self)
        .ok_or("Invalid page second-factor route")
    }
}

impl From<BrowserSecondFactorRoute> for BrowserRouteCode {
    fn from(route: BrowserSecondFactorRoute) -> Self {
        Self(route.0 as u32)
    }
}

#[derive(Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct PageInputContext {
    login_context: bool,
    #[tsify(type = "PageSecondFactorRoute")]
    second_factor_route: BrowserSecondFactorRoute,
}

impl From<&LoginContextObservation> for PageInputContext {
    fn from(observation: &LoginContextObservation) -> Self {
        Self {
            login_context: observation.has_login_context(),
            second_factor_route: BrowserSecondFactorRoute(observation.second_factor_route()),
        }
    }
}

/// Raw DOM attributes and caller-supplied context for a standalone field.
#[derive(Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct BrowserPageInput {
    input_type: String,
    disabled: bool,
    read_only: bool,
    #[tsify(type = "readonly string[]")]
    autocomplete_tokens: Vec<String>,
    identity_text: String,
    login_context: bool,
    #[tsify(type = "PageSecondFactorRoute")]
    second_factor_route: BrowserSecondFactorRoute,
    input_mode: String,
    max_length: i32,
    pattern: String,
}

impl BrowserPageInput {
    #[must_use]
    pub fn classify(self) -> PageInputClassification {
        let context = PageInputContext {
            login_context: self.login_context,
            second_factor_route: self.second_factor_route,
        };
        self.classify_in(&context)
    }

    fn classify_in(self, context: &PageInputContext) -> PageInputClassification {
        let field = PageInputFieldObservation {
            input_type: PageInputType::parse(&self.input_type),
            disabled: self.disabled,
            read_only: self.read_only,
            autocomplete_tokens: self.autocomplete_tokens,
            identity_text: self.identity_text,
            login_context: context.login_context.into(),
            one_time_code_entry: OneTimeCodeEntryEvidence::Observed(OneTimeCodeEntrySignals {
                second_factor_route: context.second_factor_route.0,
                input_mode: self.input_mode.as_str().into(),
                max_length: self.max_length.into(),
                pattern: self.pattern.as_str().into(),
            }),
        };
        let role = field.usable_authentication_role();
        PageInputClassification {
            authentication_username_evidence: field.username_evidence_for(&role),
            looks_like_username_field: role.is_username(),
            looks_like_one_time_code_field: role.is_one_time_code(),
        }
    }
}

#[derive(Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct PageInputClassification {
    authentication_username_evidence: AuthenticationUsernameEvidence,
    looks_like_username_field: bool,
    looks_like_one_time_code_field: bool,
}

/// Echo the host's numeric identity, independent of the field's batch position.
#[derive(Deserialize, Serialize)]
#[serde(transparent)]
struct PageInputRequestIndex(f64);

#[derive(Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct PageInputFieldRequest {
    #[tsify(type = "number")]
    index: PageInputRequestIndex,
    observation: BrowserPageInput,
    login_context_observation: LoginContextObservation,
}

impl PageInputFieldRequest {
    #[must_use]
    pub fn classify(self) -> IndexedPageInputClassification {
        let context = PageInputContext::from(&self.login_context_observation);
        IndexedPageInputClassification {
            index: self.index,
            login_context: context.login_context,
            field: self.observation.classify_in(&context),
        }
    }
}

#[derive(Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(hashmap_as_object)]
pub struct IndexedPageInputClassification {
    #[tsify(type = "number")]
    index: PageInputRequestIndex,
    login_context: bool,
    #[serde(flatten)]
    field: PageInputClassification,
}

#[derive(Deserialize, Serialize, Tsify)]
#[serde(rename_all = "kebab-case")]
enum PageInputLabelKind {
    AuthenticationContainerIdentity,
    LoginAdvance,
    ManualCheckpoint,
    PasskeyControl,
    EmailVerificationBody,
    OneTimeCodeAutoSubmitSignal,
}

#[derive(Deserialize, Serialize, Tsify)]
pub struct PageInputLabel {
    kind: PageInputLabelKind,
    value: String,
}

impl PageInputLabel {
    #[must_use]
    pub fn matches(&self) -> bool {
        match self.kind {
            PageInputLabelKind::AuthenticationContainerIdentity => matches!(
                AuthenticationControlText::new(&self.value).authentication_container_identity(),
                AuthenticationContainerIdentity::Authentication
            ),
            PageInputLabelKind::LoginAdvance => {
                AuthenticationAdvanceControlObservation::looks_like_login_advance_control_label(
                    &self.value,
                )
            }
            PageInputLabelKind::ManualCheckpoint => {
                AuthenticationAdvanceControlObservation::looks_like_manual_checkpoint_label(
                    &self.value,
                )
            }
            PageInputLabelKind::PasskeyControl => {
                AuthenticationAdvanceControlObservation::looks_like_passkey_control_label(
                    &self.value,
                )
            }
            PageInputLabelKind::EmailVerificationBody => {
                AuthenticationAdvanceControlObservation::looks_like_email_verification_body(
                    &self.value,
                )
            }
            PageInputLabelKind::OneTimeCodeAutoSubmitSignal => {
                AuthenticationControlText::new(&self.value)
                    .looks_like_one_time_code_auto_submit_signal()
            }
        }
    }
}

#[derive(Serialize, Tsify)]
struct ClassifiedPageInputLabel {
    #[serde(flatten)]
    label: PageInputLabel,
    matches: bool,
}

impl From<PageInputLabel> for ClassifiedPageInputLabel {
    fn from(label: PageInputLabel) -> Self {
        Self {
            matches: label.matches(),
            label,
        }
    }
}

#[derive(Deserialize, Tsify)]
pub struct PageInputsObservation {
    #[tsify(type = "readonly PageInputFieldRequest[]")]
    fields: Vec<PageInputFieldRequest>,
    #[tsify(type = "readonly PageInputLabel[]")]
    labels: Vec<PageInputLabel>,
}

#[derive(Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(hashmap_as_object)]
pub struct PageInputsClassification {
    fields: Vec<IndexedPageInputClassification>,
    strongest_authentication_username_evidence: AuthenticationUsernameEvidence,
    username_evidence_by_strength: Vec<AuthenticationUsernameEvidence>,
    labels: Vec<ClassifiedPageInputLabel>,
}

impl PageInputsObservation {
    #[must_use]
    pub fn classify(self) -> PageInputsClassification {
        let fields: Vec<_> = self
            .fields
            .into_iter()
            .map(PageInputFieldRequest::classify)
            .collect();
        let evidence: Vec<_> = fields
            .iter()
            .map(|result| result.field.authentication_username_evidence)
            .collect();
        PageInputsClassification {
            fields,
            strongest_authentication_username_evidence:
                AuthenticationUsernameEvidence::strongest_authentication_username_evidence(
                    &evidence,
                ),
            username_evidence_by_strength: AuthenticationUsernameEvidence::BY_STRENGTH.to_vec(),
            labels: self
                .labels
                .into_iter()
                .map(ClassifiedPageInputLabel::from)
                .collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    struct PageFixture;

    impl PageFixture {
        fn field() -> BrowserPageInput {
            BrowserPageInput {
                input_type: "text".into(),
                disabled: false,
                read_only: false,
                autocomplete_tokens: vec![],
                identity_text: String::new(),
                login_context: false,
                second_factor_route: BrowserSecondFactorRoute(PageSecondFactorRoute::Unrelated),
                input_mode: String::new(),
                max_length: -1,
                pattern: String::new(),
            }
        }

        fn email() -> BrowserPageInput {
            BrowserPageInput {
                input_type: "email".into(),
                autocomplete_tokens: vec!["email".into()],
                ..Self::field()
            }
        }

        fn otp() -> BrowserPageInput {
            BrowserPageInput {
                identity_text: "ctl00$MainContent$txtValue".into(),
                input_mode: " numeric ".into(),
                pattern: r"\d{6}".into(),
                ..Self::field()
            }
        }

        fn context() -> LoginContextObservation {
            LoginContextObservation {
                form_identity: String::new(),
                ancestor_identities: vec![],
                advance_control_label: "Submit".into(),
                path_context: "/ example.test".into(),
            }
        }

        fn challenge() -> LoginContextObservation {
            LoginContextObservation {
                path_context: "/twofa/totp/ example.test".into(),
                ..Self::context()
            }
        }
    }

    #[test]
    fn page_fields_override_standalone_context_and_preserve_host_identity_and_order()
    -> serde_json::Result<()> {
        assert_eq!(
            PageFixture::email()
                .classify()
                .authentication_username_evidence,
            AuthenticationUsernameEvidence::StandardsBasedEmail
        );
        assert!(!PageFixture::otp().classify().looks_like_one_time_code_field);

        let login = LoginContextObservation {
            ancestor_identities: vec!["panel".into(), "login-form".into()],
            ..PageFixture::context()
        };
        let page = PageInputsObservation {
            fields: vec![
                PageInputFieldRequest {
                    index: PageInputRequestIndex(29.0),
                    observation: PageFixture::email(),
                    login_context_observation: login.clone(),
                },
                PageInputFieldRequest {
                    index: PageInputRequestIndex(3.0),
                    observation: PageFixture::otp(),
                    login_context_observation: PageFixture::challenge(),
                },
                PageInputFieldRequest {
                    index: PageInputRequestIndex(29.0),
                    observation: BrowserPageInput {
                        read_only: true,
                        ..PageFixture::email()
                    },
                    login_context_observation: login,
                },
            ],
            labels: vec![],
        };
        let result = page.classify();
        assert_eq!(
            serde_json::to_value(result.fields)?,
            json!([
                {"index": 29.0, "loginContext": true, "authenticationUsernameEvidence": "strong",
                 "looksLikeUsernameField": true, "looksLikeOneTimeCodeField": false},
                {"index": 3.0, "loginContext": false, "authenticationUsernameEvidence": "absent",
                 "looksLikeUsernameField": false, "looksLikeOneTimeCodeField": true},
                {"index": 29.0, "loginContext": true, "authenticationUsernameEvidence": "absent",
                 "looksLikeUsernameField": false, "looksLikeOneTimeCodeField": false}
            ])
        );
        assert_eq!(
            result.strongest_authentication_username_evidence,
            AuthenticationUsernameEvidence::Strong
        );
        assert_eq!(
            result.username_evidence_by_strength,
            AuthenticationUsernameEvidence::BY_STRENGTH
        );
        Ok(())
    }

    #[test]
    fn page_preserves_empty_field_ranking_and_duplicate_ordered_label_results()
    -> serde_json::Result<()> {
        let cases = [
            ("login-advance", "next", true),
            ("manual-checkpoint", "accept terms", true),
            ("authentication-container-identity", "reset_base", false),
            ("passkey-control", "Sign in with a passkey", true),
            ("email-verification-body", "Check your email", true),
            (
                "one-time-code-auto-submit-signal",
                "oninput=this.form.requestSubmit()",
                true,
            ),
            ("login-advance", "delete account", false),
            ("login-advance", "next", true),
        ];
        let labels: Vec<_> = cases
            .iter()
            .map(|(kind, value, _)| json!({ "kind": kind, "value": value }))
            .collect();
        let page: PageInputsObservation =
            serde_json::from_value(json!({"fields": [], "labels": labels}))?;
        let result = page.classify();
        assert!(result.fields.is_empty());
        assert_eq!(
            result.strongest_authentication_username_evidence,
            AuthenticationUsernameEvidence::Absent
        );
        let expected: Vec<_> = cases
            .iter()
            .map(|(kind, value, matches)| json!({"kind": kind, "value": value, "matches": matches}))
            .collect();
        assert_eq!(serde_json::to_value(result.labels)?, json!(expected));
        Ok(())
    }

    #[test]
    fn standalone_observations_preserve_numeric_routes_and_reject_unknown_typed_values()
    -> serde_json::Result<()> {
        let context = PageInputContext::from(&PageFixture::challenge());
        assert_eq!(
            serde_json::to_value(context)?,
            json!({"loginContext":false,"secondFactorRoute":1})
        );

        let field = BrowserPageInput {
            second_factor_route: serde_json::from_value(json!(1))?,
            ..PageFixture::otp()
        };
        assert!(field.classify().looks_like_one_time_code_field);
        assert!(serde_json::from_value::<BrowserSecondFactorRoute>(json!(2)).is_err());
        assert!(
            serde_json::from_value::<PageInputLabel>(json!({"kind":"unknown","value":""})).is_err()
        );
        Ok(())
    }
}

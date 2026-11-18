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
#[serde(try_from = "u32", into = "u32")]
struct BrowserSecondFactorRoute(PageSecondFactorRoute);

impl TryFrom<u32> for BrowserSecondFactorRoute {
    type Error = &'static str;

    fn try_from(value: u32) -> Result<Self, Self::Error> {
        [
            PageSecondFactorRoute::Unrelated,
            PageSecondFactorRoute::SecondFactor,
        ]
        .into_iter()
        .find(|route| *route as u32 == value)
        .map(Self)
        .ok_or("Invalid page second-factor route")
    }
}

impl From<BrowserSecondFactorRoute> for u32 {
    fn from(value: BrowserSecondFactorRoute) -> Self {
        value.0 as Self
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
mod tests;

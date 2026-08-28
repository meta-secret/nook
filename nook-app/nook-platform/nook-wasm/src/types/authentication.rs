use super::wasm_bindgen;

#[wasm_bindgen(typescript_custom_section)]
const AUTHENTICATION_PAGE_OBSERVATION_TYPESCRIPT: &str = r"
export interface AuthenticationPageObservation {
    usernameFieldCount: number;
    currentPasswordFieldCount: number;
    newPasswordFieldCount: number;
    genericPasswordFieldCount: number;
    oneTimeCodeFieldCount: number;
    oneTimeCodeProgression: 'advance-control-required' | 'auto-submit-observed';
    manualCheckpoint: 'absent' | 'present';
    enrollmentEvidence: 'absent' | 'authenticator-setup' | 'backup-codes' | 'authenticator-setup-and-backup-codes';
    advanceControl: 'absent' | 'present';
    passkey:
        | { kind: 'absent' }
        | { kind: 'control' }
        | { kind: 'vault-accounts'; accountCount: number }
        | { kind: 'control-and-vault-accounts'; accountCount: number };
}
";

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookLoginAccount {
    secret_id: String,
    username: String,
    website_url: String,
    website_host: String,
}

#[wasm_bindgen]
pub struct NookAuthenticationPageObservation(nook_core::AuthenticationPageObservation);

#[wasm_bindgen]
impl NookAuthenticationPageObservation {
    #[wasm_bindgen(constructor)]
    #[allow(clippy::needless_pass_by_value)]
    pub fn new_from_js(
        #[wasm_bindgen(unchecked_param_type = "AuthenticationPageObservation")]
        observation: wasm_bindgen::JsValue,
    ) -> Result<Self, wasm_bindgen::JsError> {
        let observation = decode_authentication_page_observation(observation)?;
        Ok(Self::from_core_observation(observation))
    }

    /// Construct page evidence from a detailed, policy-checked control observation.
    #[wasm_bindgen(js_name = from_detailed_control_observation)]
    #[allow(clippy::needless_pass_by_value)]
    pub fn from_detailed_control_observation_from_js(
        #[wasm_bindgen(unchecked_param_type = "AuthenticationPageObservation")]
        observation: wasm_bindgen::JsValue,
        control: nook_companion_core::AuthenticationAdvanceControlObservation,
    ) -> Result<Self, wasm_bindgen::JsError> {
        let observation = decode_authentication_page_observation(observation)?;
        Ok(Self::from_core_observation_with_detailed_control(
            observation,
            control,
        ))
    }
}

fn decode_authentication_page_observation(
    observation: wasm_bindgen::JsValue,
) -> Result<nook_core::AuthenticationPageObservation, wasm_bindgen::JsError> {
    serde_wasm_bindgen::from_value(observation)
        .map_err(|_| wasm_bindgen::JsError::new("authentication page observation is malformed"))
}

impl NookAuthenticationPageObservation {
    #[cfg(test)]
    #[allow(clippy::needless_pass_by_value)]
    pub(crate) fn new(observation: nook_core::AuthenticationPageObservation) -> Self {
        Self::from_core_observation(observation)
    }
}

impl NookAuthenticationPageObservation {
    pub(crate) fn from_core_observation(
        mut observation: nook_core::AuthenticationPageObservation,
    ) -> Self {
        // The reduced page envelope cannot establish that a control belongs to
        // an authentication ceremony. Do not let callers forge continuation
        // evidence by setting this field directly.
        observation.advance_control = nook_core::AuthenticationAdvanceControlEvidence::Absent;
        observation.one_time_code_progression =
            nook_companion_core::AuthenticationOneTimeCodeProgressionEvidence::AdvanceControlRequired;
        Self(observation)
    }

    #[allow(clippy::needless_pass_by_value)]
    pub(crate) fn from_core_observation_with_detailed_control(
        observation: nook_core::AuthenticationPageObservation,
        control: nook_companion_core::AuthenticationAdvanceControlObservation,
    ) -> Self {
        Self::from_detailed_observation(observation, &control)
    }

    fn from_detailed_observation(
        mut observation: nook_core::AuthenticationPageObservation,
        control: &nook_companion_core::AuthenticationAdvanceControlObservation,
    ) -> Self {
        // The reduced page envelope cannot establish auto-submit progression.
        observation.one_time_code_progression =
            nook_companion_core::AuthenticationOneTimeCodeProgressionEvidence::AdvanceControlRequired;
        let fields = nook_companion_core::AuthenticationFieldObservationFacts {
            username_field_count: observation.username_field_count,
            current_password_field_count: observation.current_password_field_count,
            new_password_field_count: observation.new_password_field_count,
            generic_password_field_count: observation.generic_password_field_count,
            one_time_code_field_count: observation.one_time_code_field_count,
        };
        let control_advances = control.is_bounded()
            && fields.is_compatible_with_detailed_control(control)
            && matches!(
                control.classify(),
                nook_companion_core::AuthenticationAdvanceControlDecision::AdvancesAuthentication
            );
        observation.advance_control = if control_advances {
            nook_core::AuthenticationAdvanceControlEvidence::Present
        } else {
            nook_core::AuthenticationAdvanceControlEvidence::Absent
        };
        Self(observation)
    }
}

#[wasm_bindgen]
pub struct NookAuthenticationPageObservations(Vec<nook_core::AuthenticationPageObservation>);

#[wasm_bindgen]
impl NookAuthenticationPageObservations {
    #[wasm_bindgen(constructor)]
    #[must_use]
    pub fn new() -> Self {
        Self(Vec::new())
    }

    pub fn add(&mut self, observation: &NookAuthenticationPageObservation) {
        self.0.push(observation.to_core());
    }
}

impl NookAuthenticationPageObservations {
    pub(crate) fn as_core(&self) -> &[nook_core::AuthenticationPageObservation] {
        &self.0
    }

    pub(crate) fn classify(&self) -> nook_core::AuthenticationWorkflowMatch {
        nook_core::AuthenticationPageObservations {
            observations: self.0.clone(),
        }
        .classify()
    }
}

impl NookAuthenticationPageObservation {
    pub(crate) const fn to_core(&self) -> nook_core::AuthenticationPageObservation {
        self.0
    }
}

#[wasm_bindgen]
pub struct NookAuthenticationWorkflowSnapshot(nook_core::AuthenticationWorkflowSnapshot);

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NookAuthenticationWorkflowMatchState {
    NoMatch,
    Rejected,
    Matched,
}

#[wasm_bindgen]
pub struct NookAuthenticationWorkflowMatch(nook_core::AuthenticationWorkflowMatch);

impl NookAuthenticationWorkflowMatch {
    pub(crate) const fn from_core(value: nook_core::AuthenticationWorkflowMatch) -> Self {
        Self(value)
    }
}

#[wasm_bindgen]
impl NookAuthenticationWorkflowMatch {
    #[wasm_bindgen(getter)]
    pub fn state(&self) -> NookAuthenticationWorkflowMatchState {
        match self.0 {
            nook_core::AuthenticationWorkflowMatch::NoMatch => {
                NookAuthenticationWorkflowMatchState::NoMatch
            }
            nook_core::AuthenticationWorkflowMatch::Rejected => {
                NookAuthenticationWorkflowMatchState::Rejected
            }
            nook_core::AuthenticationWorkflowMatch::Matched(_) => {
                NookAuthenticationWorkflowMatchState::Matched
            }
        }
    }

    pub fn snapshot(&self) -> Result<NookAuthenticationWorkflowSnapshot, wasm_bindgen::JsError> {
        match self.0 {
            nook_core::AuthenticationWorkflowMatch::NoMatch => Err(wasm_bindgen::JsError::new(
                "authentication workflow was not detected",
            )),
            nook_core::AuthenticationWorkflowMatch::Rejected => Err(wasm_bindgen::JsError::new(
                "authentication workflow observations were rejected",
            )),
            nook_core::AuthenticationWorkflowMatch::Matched(snapshot) => {
                Ok(NookAuthenticationWorkflowSnapshot::from_core(snapshot))
            }
        }
    }
}

#[wasm_bindgen]
pub struct NookAuthenticationOutcomeObservation(nook_core::AuthenticationOutcomeObservation);

#[wasm_bindgen]
impl NookAuthenticationOutcomeObservation {
    #[wasm_bindgen(constructor)]
    #[allow(clippy::needless_pass_by_value, clippy::too_many_arguments)]
    pub fn new(
        navigated_away_from_auth_path: bool,
        auth_fields_present: bool,
        success_marker_present: bool,
        error_marker_present: bool,
        same_document_mutation: bool,
        in_iframe: bool,
        elapsed_ms: u32,
    ) -> Self {
        Self(nook_core::AuthenticationOutcomeObservation {
            navigated_away_from_auth_path,
            auth_fields_present,
            success_marker_present,
            error_marker_present,
            same_document_mutation,
            in_iframe,
            elapsed_ms,
        })
    }

    pub(crate) const fn to_core(&self) -> nook_core::AuthenticationOutcomeObservation {
        self.0
    }
}

#[wasm_bindgen]
pub struct NookAuthenticationOutcomeVerdict(nook_core::AuthenticationOutcomeVerdict);

#[wasm_bindgen]
impl NookAuthenticationOutcomeVerdict {
    pub(crate) const fn from_core(value: nook_core::AuthenticationOutcomeVerdict) -> Self {
        Self(value)
    }

    #[wasm_bindgen(getter)]
    pub fn verdict(&self) -> nook_core::AuthenticationOutcomeVerdict {
        self.0
    }

    #[wasm_bindgen(getter, js_name = allowsCredentialCommit)]
    pub fn allows_credential_commit(&self) -> bool {
        self.0.allows_credential_commit()
    }
}

#[wasm_bindgen]
impl NookAuthenticationWorkflowSnapshot {
    pub(crate) const fn from_core(value: nook_core::AuthenticationWorkflowSnapshot) -> Self {
        Self(value)
    }

    #[wasm_bindgen(getter)]
    pub fn kind(&self) -> nook_core::AuthenticationWorkflowKind {
        self.0.kind
    }

    #[wasm_bindgen(getter, js_name = kindName)]
    pub fn kind_name(&self) -> String {
        self.0.kind.as_str().to_owned()
    }

    #[wasm_bindgen(getter)]
    pub fn stage(&self) -> nook_core::AuthenticationWorkflowStage {
        self.0.stage
    }

    #[wasm_bindgen(getter, js_name = stageName)]
    pub fn stage_name(&self) -> String {
        self.0.stage.as_str().to_owned()
    }

    #[wasm_bindgen(getter)]
    pub fn action(&self) -> nook_core::AuthenticationWorkflowAction {
        self.0.action
    }

    #[wasm_bindgen(getter, js_name = actionName)]
    pub fn action_name(&self) -> String {
        self.0.action.as_str().to_owned()
    }

    #[wasm_bindgen(getter, js_name = approvalRequirement)]
    pub fn approval_requirement(&self) -> nook_core::AuthenticationApprovalRequirement {
        self.0.approval_requirement
    }

    #[wasm_bindgen(getter, js_name = currentStep)]
    pub fn current_step(&self) -> u8 {
        self.0.current_step
    }

    #[wasm_bindgen(getter, js_name = totalSteps)]
    pub fn total_steps(&self) -> u8 {
        self.0.total_steps
    }

    #[wasm_bindgen(getter, js_name = observationIndex)]
    pub fn observation_index(&self) -> u32 {
        self.0.observation_index
    }
}

#[wasm_bindgen]
impl NookLoginAccount {
    pub(crate) fn from_login(id: &nook_core::SecretId, login: &nook_core::LoginSecret) -> Self {
        Self {
            secret_id: id.to_string(),
            username: login.username.clone(),
            website_url: login.website_url.clone(),
            website_host: nook_core::hostname_from_url(&login.website_url),
        }
    }

    #[wasm_bindgen(getter, js_name = secretId)]
    pub fn secret_id(&self) -> String {
        self.secret_id.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn username(&self) -> String {
        self.username.clone()
    }

    #[wasm_bindgen(getter, js_name = websiteUrl)]
    pub fn website_url(&self) -> String {
        self.website_url.clone()
    }

    #[wasm_bindgen(getter, js_name = websiteHost)]
    pub fn website_host(&self) -> String {
        self.website_host.clone()
    }
}

#[wasm_bindgen]
pub struct NookLoginFillCredential {
    username: String,
    password: String,
}

#[wasm_bindgen]
impl NookLoginFillCredential {
    pub(crate) fn new(username: String, password: String) -> Self {
        Self { username, password }
    }

    #[wasm_bindgen(getter)]
    pub fn username(&self) -> String {
        self.username.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn password(&self) -> String {
        self.password.clone()
    }
}

impl Drop for NookLoginFillCredential {
    fn drop(&mut self) {
        use zeroize::Zeroize;
        self.username.zeroize();
        self.password.zeroize();
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NookWebsiteLoginSaveDecision {
    Create,
    Update,
    AlreadySaved,
    Invalid,
}

#[wasm_bindgen]
pub struct NookWebsiteLoginSavePlan {
    decision: NookWebsiteLoginSaveDecision,
    target: WebsiteLoginSaveTarget,
}

enum WebsiteLoginSaveTarget {
    NoExistingSecret,
    ExistingSecret(String),
}

#[wasm_bindgen]
impl NookWebsiteLoginSavePlan {
    pub(crate) fn from_decision(decision: nook_core::WebsiteLoginSaveDecision) -> Self {
        match decision {
            nook_core::WebsiteLoginSaveDecision::Create => Self {
                decision: NookWebsiteLoginSaveDecision::Create,
                target: WebsiteLoginSaveTarget::NoExistingSecret,
            },
            nook_core::WebsiteLoginSaveDecision::Invalid => Self {
                decision: NookWebsiteLoginSaveDecision::Invalid,
                target: WebsiteLoginSaveTarget::NoExistingSecret,
            },
            nook_core::WebsiteLoginSaveDecision::Update { secret_id } => Self {
                decision: NookWebsiteLoginSaveDecision::Update,
                target: WebsiteLoginSaveTarget::ExistingSecret(secret_id.to_string()),
            },
            nook_core::WebsiteLoginSaveDecision::AlreadySaved { secret_id } => Self {
                decision: NookWebsiteLoginSaveDecision::AlreadySaved,
                target: WebsiteLoginSaveTarget::ExistingSecret(secret_id.to_string()),
            },
        }
    }

    #[wasm_bindgen(getter)]
    pub fn decision(&self) -> NookWebsiteLoginSaveDecision {
        self.decision
    }

    #[wasm_bindgen(getter, js_name = secretId)]
    pub fn secret_id(&self) -> Result<String, wasm_bindgen::JsError> {
        match &self.target {
            WebsiteLoginSaveTarget::NoExistingSecret => Err(wasm_bindgen::JsError::new(
                "login save decision does not target an existing secret",
            )),
            WebsiteLoginSaveTarget::ExistingSecret(secret_id) => Ok(secret_id.clone()),
        }
    }
}

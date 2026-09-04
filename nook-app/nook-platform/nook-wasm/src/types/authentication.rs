use super::wasm_bindgen;
use nook_core::{AuthenticationWorkflowMatch, WebsiteLoginSaveDecision};
use wasm_bindgen::JsError;

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
    #[allow(clippy::needless_pass_by_value, clippy::too_many_arguments)]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: accepts browser-observed field and account counts as JavaScript Number scalars"
        )
    )]
    pub fn new(
        username_field_count: u32,
        current_password_field_count: u32,
        new_password_field_count: u32,
        generic_password_field_count: u32,
        one_time_code_field_count: u32,
        manual_checkpoint_present: bool,
        authenticator_setup_hint: bool,
        backup_codes_hint: bool,
        passkey_control_present: bool,
        matching_passkey_account_count: u32,
    ) -> Self {
        Self(nook_core::AuthenticationPageObservation {
            username_field_count,
            current_password_field_count,
            new_password_field_count,
            generic_password_field_count,
            one_time_code_field_count,
            manual_checkpoint_present,
            authenticator_setup_hint,
            backup_codes_hint,
            passkey_control_present,
            matching_passkey_account_count,
        })
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
            AuthenticationWorkflowMatch::NoMatch => NookAuthenticationWorkflowMatchState::NoMatch,
            AuthenticationWorkflowMatch::Rejected => NookAuthenticationWorkflowMatchState::Rejected,
            AuthenticationWorkflowMatch::Matched(_) => {
                NookAuthenticationWorkflowMatchState::Matched
            }
        }
    }

    pub fn snapshot(&self) -> Result<NookAuthenticationWorkflowSnapshot, wasm_bindgen::JsError> {
        match self.0 {
            AuthenticationWorkflowMatch::NoMatch => {
                Err(JsError::new("authentication workflow was not detected"))
            }
            AuthenticationWorkflowMatch::Rejected => Err(JsError::new(
                "authentication workflow observations were rejected",
            )),
            AuthenticationWorkflowMatch::Matched(snapshot) => {
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
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: accepts elapsed authentication milliseconds as a JavaScript Number scalar"
        )
    )]
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

    #[wasm_bindgen(getter, js_name = currentStep)]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the current workflow step as a JavaScript Number scalar"
        )
    )]
    pub fn current_step(&self) -> u8 {
        self.0.current_step
    }

    #[wasm_bindgen(getter, js_name = totalSteps)]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the total workflow steps as a JavaScript Number scalar"
        )
    )]
    pub fn total_steps(&self) -> u8 {
        self.0.total_steps
    }

    #[wasm_bindgen(getter, js_name = approvalRequirement)]
    pub fn approval_requirement(&self) -> nook_core::AuthenticationApprovalRequirement {
        self.0.approval_requirement
    }

    #[wasm_bindgen(getter, js_name = savedLoginCapability)]
    pub fn saved_login_capability(&self) -> nook_core::AuthenticationSavedLoginCapability {
        self.0.saved_login_capability()
    }

    #[wasm_bindgen(getter, js_name = observationIndex)]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the workflow observation index as a JavaScript Number scalar"
        )
    )]
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
            WebsiteLoginSaveDecision::Create => Self {
                decision: NookWebsiteLoginSaveDecision::Create,
                target: WebsiteLoginSaveTarget::NoExistingSecret,
            },
            WebsiteLoginSaveDecision::Invalid => Self {
                decision: NookWebsiteLoginSaveDecision::Invalid,
                target: WebsiteLoginSaveTarget::NoExistingSecret,
            },
            WebsiteLoginSaveDecision::Update { secret_id } => Self {
                decision: NookWebsiteLoginSaveDecision::Update,
                target: WebsiteLoginSaveTarget::ExistingSecret(secret_id.to_string()),
            },
            WebsiteLoginSaveDecision::AlreadySaved { secret_id } => Self {
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
            WebsiteLoginSaveTarget::NoExistingSecret => Err(JsError::new(
                "login save decision does not target an existing secret",
            )),
            WebsiteLoginSaveTarget::ExistingSecret(secret_id) => Ok(secret_id.clone()),
        }
    }
}

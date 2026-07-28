use super::wasm_bindgen;

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NookValueState {
    Unavailable,
    Value,
}

#[wasm_bindgen]
#[derive(Debug, Clone)]
pub struct NookStringValue {
    state: NookValueState,
    value: String,
}

#[wasm_bindgen]
impl NookStringValue {
    #[wasm_bindgen(js_name = unavailable)]
    #[must_use]
    pub fn unavailable() -> Self {
        Self {
            state: NookValueState::Unavailable,
            value: String::new(),
        }
    }

    #[wasm_bindgen(js_name = value)]
    pub fn available(value: String) -> Result<Self, wasm_bindgen::JsError> {
        if value.is_empty() {
            return Err(wasm_bindgen::JsError::new(
                "available string value must not be empty",
            ));
        }
        Ok(Self {
            state: NookValueState::Value,
            value,
        })
    }

    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn state(&self) -> NookValueState {
        self.state
    }

    #[wasm_bindgen(getter)]
    pub fn string(&self) -> Result<String, wasm_bindgen::JsError> {
        match self.state {
            NookValueState::Unavailable => {
                Err(wasm_bindgen::JsError::new("string value is unavailable"))
            }
            NookValueState::Value => Ok(self.value.clone()),
        }
    }
}

pub(crate) enum NookStringValueRef<'a> {
    Unavailable,
    Value(&'a str),
}

impl NookStringValue {
    pub(crate) fn from_value(value: impl Into<String>) -> Self {
        Self {
            state: NookValueState::Value,
            value: value.into(),
        }
    }

    pub(crate) fn as_ref(&self) -> NookStringValueRef<'_> {
        match self.state {
            NookValueState::Unavailable => NookStringValueRef::Unavailable,
            NookValueState::Value => NookStringValueRef::Value(&self.value),
        }
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookVaultArchitecture(nook_core::VaultArchitecture);

#[wasm_bindgen]
impl NookVaultArchitecture {
    #[wasm_bindgen(js_name = draft)]
    pub fn draft(
        device_mode: &str,
        vault_type: nook_core::VaultType,
        replication_type: &str,
    ) -> Result<Self, wasm_bindgen::JsError> {
        Ok(Self(nook_core::VaultArchitecture::draft(
            nook_core::DeviceMode::parse(device_mode)?,
            vault_type,
            nook_core::ReplicationType::parse(replication_type)?,
        )?))
    }

    #[wasm_bindgen(js_name = simple)]
    #[allow(clippy::needless_pass_by_value)]
    pub fn simple(
        device_mode: nook_core::DeviceMode,
        replication_type: nook_core::ReplicationType,
    ) -> Result<Self, wasm_bindgen::JsError> {
        let architecture = nook_core::VaultArchitecture {
            device_mode,
            vault_type: nook_core::VaultType::Simple,
            replication_type,
            sentinel: nook_core::SentinelConfiguration::Disabled,
        };
        architecture.validate()?;
        Ok(Self(architecture))
    }

    #[wasm_bindgen(js_name = sentinel)]
    #[allow(clippy::needless_pass_by_value)]
    pub fn sentinel(
        device_mode: nook_core::DeviceMode,
        replication_type: nook_core::ReplicationType,
        threshold: u8,
        required_participants: u8,
        ready_participants: u8,
    ) -> Result<Self, wasm_bindgen::JsError> {
        let architecture = nook_core::VaultArchitecture {
            device_mode,
            vault_type: nook_core::VaultType::Sentinel,
            replication_type,
            sentinel: nook_core::SentinelConfiguration::Enabled(nook_core::SentinelPolicy {
                threshold,
                required_participants,
                ready_participants,
            }),
        };
        architecture.validate()?;
        Ok(Self(architecture))
    }

    #[wasm_bindgen(getter, js_name = device_mode)]
    pub fn device_mode(&self) -> nook_core::DeviceMode {
        self.0.device_mode
    }

    #[wasm_bindgen(getter, js_name = vault_type)]
    pub fn vault_type(&self) -> nook_core::VaultType {
        self.0.vault_type
    }

    #[wasm_bindgen(getter, js_name = replication_type)]
    pub fn replication_type(&self) -> nook_core::ReplicationType {
        self.0.replication_type
    }

    #[wasm_bindgen(getter, js_name = sentinel_threshold)]
    pub fn sentinel_threshold(&self) -> Result<u8, wasm_bindgen::JsError> {
        Ok(self.0.sentinel.policy()?.threshold)
    }

    #[wasm_bindgen(getter, js_name = sentinel_required_participants)]
    pub fn sentinel_required_participants(&self) -> Result<u8, wasm_bindgen::JsError> {
        Ok(self.0.sentinel.policy()?.required_participants)
    }

    #[wasm_bindgen(getter, js_name = sentinel_ready_participants)]
    pub fn sentinel_ready_participants(&self) -> Result<u8, wasm_bindgen::JsError> {
        Ok(self.0.sentinel.policy()?.ready_participants)
    }
}

impl NookVaultArchitecture {
    pub(crate) fn from_core(value: nook_core::VaultArchitecture) -> Self {
        Self(value)
    }

    pub(crate) fn to_core(&self) -> nook_core::VaultArchitecture {
        self.0.clone()
    }
}

#[wasm_bindgen]
pub struct NookProviderReplicationCapability(nook_core::ProviderReplicationCapability);

#[wasm_bindgen]
impl NookProviderReplicationCapability {
    pub(crate) fn from_core(value: nook_core::ProviderReplicationCapability) -> Self {
        Self(value)
    }

    #[wasm_bindgen(getter, js_name = providerType)]
    pub fn provider_type(&self) -> String {
        self.0.provider_type.clone()
    }

    #[wasm_bindgen(getter, js_name = oauthPreset)]
    pub fn oauth_preset(&self) -> NookStringValue {
        match self.0.oauth_preset {
            nook_core::ProviderOauthPreset::NotApplicable => NookStringValue::unavailable(),
            nook_core::ProviderOauthPreset::Preset(preset) => {
                NookStringValue::from_value(preset.as_str())
            }
        }
    }

    #[wasm_bindgen(getter, js_name = supportsPersonal)]
    pub fn supports_personal(&self) -> bool {
        self.0.supports_personal
    }

    #[wasm_bindgen(getter, js_name = supportsShared)]
    pub fn supports_shared(&self) -> bool {
        self.0.supports_shared
    }

    #[wasm_bindgen(getter, js_name = sharedJoinerIdentity)]
    pub fn shared_joiner_identity(&self) -> NookStringValue {
        match self.0.shared_joiner_identity {
            nook_core::ProviderJoinerIdentity::NotRequired => NookStringValue::unavailable(),
            nook_core::ProviderJoinerIdentity::Required(kind) => {
                NookStringValue::from_value(kind.as_str())
            }
        }
    }
}

#[wasm_bindgen]
pub struct NookSentinelUnlockSessionStatus {
    active: bool,
    collected: u8,
    threshold: u8,
    ready: bool,
}

#[wasm_bindgen]
impl NookSentinelUnlockSessionStatus {
    #[wasm_bindgen(js_name = inactive)]
    pub fn inactive() -> Self {
        Self {
            active: false,
            collected: 0,
            threshold: 0,
            ready: false,
        }
    }

    pub(crate) const fn from_status(status: nook_core::SentinelUnlockStatus) -> Self {
        Self {
            active: true,
            collected: status.collected,
            threshold: status.threshold,
            ready: status.ready,
        }
    }

    #[wasm_bindgen(getter)]
    pub fn active(&self) -> bool {
        self.active
    }

    #[wasm_bindgen(getter)]
    pub fn collected(&self) -> u8 {
        self.collected
    }

    #[wasm_bindgen(getter)]
    pub fn threshold(&self) -> u8 {
        self.threshold
    }

    #[wasm_bindgen(getter)]
    pub fn ready(&self) -> bool {
        self.ready
    }
}

#[wasm_bindgen]
pub struct NookSentinelStoredDeliverySummary {
    store_id: String,
    session_id: String,
    participant_count: u8,
    threshold: u8,
}

#[wasm_bindgen]
impl NookSentinelStoredDeliverySummary {
    pub(crate) fn from_delivery(
        store_id: String,
        delivery: &nook_core::SentinelGenesisShareDelivery,
    ) -> Self {
        Self {
            store_id,
            session_id: delivery.session_id.as_str().to_owned(),
            participant_count: delivery.policy.participant_count,
            threshold: delivery.policy.threshold,
        }
    }

    #[wasm_bindgen(getter, js_name = storeId)]
    pub fn store_id(&self) -> String {
        self.store_id.clone()
    }

    #[wasm_bindgen(getter, js_name = sessionId)]
    pub fn session_id(&self) -> String {
        self.session_id.clone()
    }

    #[wasm_bindgen(getter, js_name = participantCount)]
    pub fn participant_count(&self) -> u8 {
        self.participant_count
    }

    #[wasm_bindgen(getter)]
    pub fn threshold(&self) -> u8 {
        self.threshold
    }
}

#[wasm_bindgen]
pub struct NookSentinelGenesisParticipantStatus {
    device_id: String,
    label: String,
    fingerprint: String,
}

#[wasm_bindgen]
impl NookSentinelGenesisParticipantStatus {
    fn from_core(participant: &nook_core::SentinelGenesisParticipant) -> Self {
        Self {
            device_id: participant.device_id.as_str().to_owned(),
            label: participant.label.clone(),
            fingerprint: participant.fingerprint.clone(),
        }
    }

    #[wasm_bindgen(getter, js_name = deviceId)]
    pub fn device_id(&self) -> String {
        self.device_id.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn label(&self) -> String {
        self.label.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn fingerprint(&self) -> String {
        self.fingerprint.clone()
    }
}

#[wasm_bindgen]
pub struct NookSentinelGenesisStatus {
    participants: Vec<NookSentinelGenesisParticipantStatus>,
    phase: nook_core::SentinelGenesisPhase,
}

#[wasm_bindgen]
impl NookSentinelGenesisStatus {
    pub(crate) const fn from_phase(phase: nook_core::SentinelGenesisPhase) -> Self {
        Self {
            participants: Vec::new(),
            phase,
        }
    }

    pub(crate) fn from_session(session: &nook_core::SentinelGenesisSession) -> Self {
        Self {
            participants: session
                .participants()
                .iter()
                .map(NookSentinelGenesisParticipantStatus::from_core)
                .collect(),
            phase: nook_core::SentinelGenesisPhase::from_session(session),
        }
    }

    #[wasm_bindgen(getter)]
    pub fn phase(&self) -> nook_core::SentinelGenesisPhase {
        self.phase
    }

    #[wasm_bindgen(getter)]
    pub fn participants(&mut self) -> Vec<NookSentinelGenesisParticipantStatus> {
        std::mem::take(&mut self.participants)
    }
}

#[wasm_bindgen]
pub struct NookSentinelGenesisDelivery {
    device_id: String,
    fingerprint: String,
    payload: String,
}

#[wasm_bindgen]
impl NookSentinelGenesisDelivery {
    pub(crate) fn from_core(
        delivery: &nook_core::SentinelGenesisShareDelivery,
        fingerprint: String,
    ) -> Result<Self, crate::NookError> {
        Ok(Self {
            device_id: delivery.device_id.as_str().to_owned(),
            fingerprint,
            payload: serde_json::to_string(delivery)
                .map_err(|error| crate::NookError::Serialization(error.to_string()))?,
        })
    }

    #[wasm_bindgen(getter, js_name = deviceId)]
    pub fn device_id(&self) -> String {
        self.device_id.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn fingerprint(&self) -> String {
        self.fingerprint.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn payload(&self) -> String {
        self.payload.clone()
    }
}

#[wasm_bindgen]
pub struct NookSentinelGenesisFinalizeResult {
    store_id: String,
    architecture: nook_core::VaultArchitecture,
    deliveries: Vec<NookSentinelGenesisDelivery>,
}

#[wasm_bindgen]
pub struct NookEventLogSyncIssue {
    provider_label: String,
    classification: nook_core::RemoteEventLogClassification,
}

#[wasm_bindgen]
impl NookEventLogSyncIssue {
    pub(crate) fn new(
        provider_label: String,
        classification: nook_core::RemoteEventLogClassification,
    ) -> Self {
        Self {
            provider_label,
            classification,
        }
    }

    #[wasm_bindgen(getter, js_name = providerLabel)]
    pub fn provider_label(&self) -> String {
        self.provider_label.clone()
    }

    #[wasm_bindgen(getter, js_name = isStoreMismatch)]
    pub fn is_store_mismatch(&self) -> bool {
        matches!(
            self.classification,
            nook_core::RemoteEventLogClassification::DifferentStore { .. }
        )
    }

    #[wasm_bindgen(getter, js_name = isMultipleStores)]
    pub fn is_multiple_stores(&self) -> bool {
        matches!(
            self.classification,
            nook_core::RemoteEventLogClassification::MultipleStores { .. }
        )
    }

    #[wasm_bindgen(getter, js_name = localStoreId)]
    pub fn local_store_id(&self) -> Option<String> {
        match &self.classification {
            nook_core::RemoteEventLogClassification::DifferentStore { local_store_id, .. } => {
                Some(local_store_id.clone())
            }
            _ => None,
        }
    }

    #[wasm_bindgen(getter, js_name = remoteStoreId)]
    pub fn remote_store_id(&self) -> Option<String> {
        match &self.classification {
            nook_core::RemoteEventLogClassification::DifferentStore {
                remote_store_id, ..
            } => Some(remote_store_id.clone()),
            _ => None,
        }
    }

    #[wasm_bindgen(getter, js_name = storeIds)]
    pub fn store_ids(&self) -> Vec<String> {
        match &self.classification {
            nook_core::RemoteEventLogClassification::MultipleStores { store_ids } => {
                store_ids.clone()
            }
            _ => Vec::new(),
        }
    }
}

#[wasm_bindgen]
impl NookSentinelGenesisFinalizeResult {
    pub(crate) fn from_core(
        store_id: String,
        architecture: nook_core::VaultArchitecture,
        participants: &[nook_core::SentinelGenesisParticipant],
        deliveries: &[nook_core::SentinelGenesisShareDelivery],
    ) -> Result<Self, crate::NookError> {
        let deliveries = deliveries
            .iter()
            .map(|delivery| {
                let fingerprint = participants
                    .iter()
                    .find(|participant| participant.device_id == delivery.device_id)
                    .map(|participant| participant.fingerprint.clone())
                    .ok_or(nook_core::MultiDeviceError::InvalidSentinelGenesisPayload)?;
                NookSentinelGenesisDelivery::from_core(delivery, fingerprint)
            })
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Self {
            store_id,
            architecture,
            deliveries,
        })
    }

    #[wasm_bindgen(getter, js_name = storeId)]
    pub fn store_id(&self) -> String {
        self.store_id.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn phase(&self) -> nook_core::SentinelGenesisPhase {
        nook_core::SentinelGenesisPhase::DeliveringShares
    }

    #[wasm_bindgen(getter)]
    pub fn architecture(&self) -> NookVaultArchitecture {
        NookVaultArchitecture::from_core(self.architecture.clone())
    }

    #[wasm_bindgen(getter, js_name = participantDeliveries)]
    pub fn participant_deliveries(&mut self) -> Vec<NookSentinelGenesisDelivery> {
        std::mem::take(&mut self.deliveries)
    }
}

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
    pub fn name(&self) -> String {
        self.0.as_str().to_owned()
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
    pub fn current_step(&self) -> u8 {
        self.0.current_step
    }

    #[wasm_bindgen(getter, js_name = totalSteps)]
    pub fn total_steps(&self) -> u8 {
        self.0.total_steps
    }

    #[wasm_bindgen(getter, js_name = requiresHumanApproval)]
    pub fn requires_human_approval(&self) -> bool {
        self.0.requires_human_approval
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
pub struct NookWebsiteLoginSavePlan {
    decision: String,
    secret_id: Option<String>,
}

#[wasm_bindgen]
impl NookWebsiteLoginSavePlan {
    pub(crate) fn from_decision(decision: nook_core::WebsiteLoginSaveDecision) -> Self {
        let label = decision.as_str().to_owned();
        match decision {
            nook_core::WebsiteLoginSaveDecision::Create
            | nook_core::WebsiteLoginSaveDecision::Invalid => Self {
                decision: label,
                secret_id: None,
            },
            nook_core::WebsiteLoginSaveDecision::Update { secret_id }
            | nook_core::WebsiteLoginSaveDecision::AlreadySaved { secret_id } => Self {
                decision: label,
                secret_id: Some(secret_id.to_string()),
            },
        }
    }

    #[wasm_bindgen(getter)]
    pub fn decision(&self) -> String {
        self.decision.clone()
    }

    #[wasm_bindgen(getter, js_name = secretId)]
    pub fn secret_id(&self) -> Option<String> {
        self.secret_id.clone()
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookAuthenticatorAccount {
    secret_id: String,
    issuer: String,
    account: String,
}

/// Non-secret preview of a validated authenticator enrollment URI.
#[wasm_bindgen]
#[derive(Clone)]
pub struct NookOtpauthPreview {
    issuer: String,
    account: String,
    website_url: String,
    algorithm: String,
    digits: u32,
    period: u32,
}

#[wasm_bindgen]
impl NookOtpauthPreview {
    pub(crate) fn from_core(preview: nook_core::OtpauthPreview) -> Self {
        Self {
            issuer: preview.issuer,
            account: preview.account,
            website_url: preview.website_url,
            algorithm: preview.algorithm.as_str().to_owned(),
            digits: preview.digits.get(),
            period: u32::try_from(preview.period.get()).unwrap_or(u32::MAX),
        }
    }

    #[wasm_bindgen(getter)]
    pub fn issuer(&self) -> String {
        self.issuer.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn account(&self) -> String {
        self.account.clone()
    }

    #[wasm_bindgen(getter, js_name = websiteUrl)]
    pub fn website_url(&self) -> String {
        self.website_url.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn algorithm(&self) -> String {
        self.algorithm.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn digits(&self) -> u32 {
        self.digits
    }

    #[wasm_bindgen(getter)]
    pub fn period(&self) -> u32 {
        self.period
    }
}

#[wasm_bindgen]
impl NookAuthenticatorAccount {
    pub(crate) fn from_authenticator(
        id: &nook_core::SecretId,
        authenticator: &nook_core::AuthenticatorSecret,
    ) -> Self {
        Self {
            secret_id: id.to_string(),
            issuer: authenticator.issuer.clone(),
            account: authenticator.account.clone(),
        }
    }

    #[wasm_bindgen(getter, js_name = secretId)]
    pub fn secret_id(&self) -> String {
        self.secret_id.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn issuer(&self) -> String {
        self.issuer.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn account(&self) -> String {
        self.account.clone()
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookPasskeyAccount {
    credential_id: String,
    user_name: String,
    user_display_name: String,
}

#[wasm_bindgen]
impl NookPasskeyAccount {
    pub(crate) fn from_core(value: &nook_core::PasskeySecret) -> Self {
        Self {
            credential_id: value.credential_id.clone(),
            user_name: value.user_name.clone(),
            user_display_name: value.user_display_name.clone(),
        }
    }

    #[wasm_bindgen(getter, js_name = credentialId)]
    pub fn credential_id(&self) -> String {
        self.credential_id.clone()
    }

    #[wasm_bindgen(getter, js_name = userName)]
    pub fn user_name(&self) -> String {
        self.user_name.clone()
    }

    #[wasm_bindgen(getter, js_name = userDisplayName)]
    pub fn user_display_name(&self) -> String {
        self.user_display_name.clone()
    }
}

#[wasm_bindgen]
pub struct NookPasskeyRegistration {
    credential_id: String,
    client_data_json: String,
    attestation_object: String,
}

#[wasm_bindgen]
impl NookPasskeyRegistration {
    pub(crate) fn new(
        credential_id: String,
        client_data_json: String,
        attestation_object: String,
    ) -> Self {
        Self {
            credential_id,
            client_data_json,
            attestation_object,
        }
    }

    #[wasm_bindgen(getter, js_name = credentialId)]
    pub fn credential_id(&self) -> String {
        self.credential_id.clone()
    }

    #[wasm_bindgen(getter, js_name = clientDataJSON)]
    pub fn client_data_json(&self) -> String {
        self.client_data_json.clone()
    }

    #[wasm_bindgen(getter, js_name = attestationObject)]
    pub fn attestation_object(&self) -> String {
        self.attestation_object.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn transports(&self) -> Vec<String> {
        vec!["internal".to_owned()]
    }
}

#[wasm_bindgen]
pub struct NookPasskeyAssertion {
    credential_id: String,
    client_data_json: String,
    authenticator_data: String,
    signature: String,
    user_handle: String,
}

#[wasm_bindgen]
impl NookPasskeyAssertion {
    pub(crate) fn new(
        credential_id: String,
        client_data_json: String,
        authenticator_data: String,
        signature: String,
        user_handle: String,
    ) -> Self {
        Self {
            credential_id,
            client_data_json,
            authenticator_data,
            signature,
            user_handle,
        }
    }

    #[wasm_bindgen(getter, js_name = credentialId)]
    pub fn credential_id(&self) -> String {
        self.credential_id.clone()
    }

    #[wasm_bindgen(getter, js_name = clientDataJSON)]
    pub fn client_data_json(&self) -> String {
        self.client_data_json.clone()
    }

    #[wasm_bindgen(getter, js_name = authenticatorData)]
    pub fn authenticator_data(&self) -> String {
        self.authenticator_data.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn signature(&self) -> String {
        self.signature.clone()
    }

    #[wasm_bindgen(getter, js_name = userHandle)]
    pub fn user_handle(&self) -> String {
        self.user_handle.clone()
    }
}

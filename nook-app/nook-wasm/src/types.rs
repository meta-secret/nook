//! Typed values exported across the wasm-bindgen boundary (no untyped JavaScript bags).

use crate::NookError;
use crate::NookSecretListItem;
use crate::NookSecretRecord;
use crate::NookVaultManager;
use gloo_utils::window;
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookVaultArchitecture(nook_core::VaultArchitecture);

#[wasm_bindgen]
impl NookVaultArchitecture {
    #[wasm_bindgen(js_name = draft)]
    pub fn draft(
        device_mode: &str,
        vault_type: &str,
        replication_type: &str,
    ) -> Result<Self, wasm_bindgen::JsError> {
        Ok(Self(nook_core::VaultArchitecture::draft(
            nook_core::DeviceMode::parse(device_mode)?,
            nook_core::VaultType::parse(vault_type)?,
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
            sentinel: None,
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
            sentinel: Some(nook_core::SentinelPolicy {
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
    pub fn sentinel_threshold(&self) -> Option<u8> {
        self.0.sentinel.map(|policy| policy.threshold)
    }

    #[wasm_bindgen(getter, js_name = sentinel_required_participants)]
    pub fn sentinel_required_participants(&self) -> Option<u8> {
        self.0.sentinel.map(|policy| policy.required_participants)
    }

    #[wasm_bindgen(getter, js_name = sentinel_ready_participants)]
    pub fn sentinel_ready_participants(&self) -> Option<u8> {
        self.0.sentinel.map(|policy| policy.ready_participants)
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
    pub fn oauth_preset(&self) -> Option<String> {
        self.0.oauth_preset.clone()
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
    pub fn shared_joiner_identity(&self) -> Option<String> {
        self.0
            .shared_joiner_identity
            .map(|kind| kind.as_str().to_owned())
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
    active: bool,
    participants: Vec<NookSentinelGenesisParticipantStatus>,
    complete: bool,
}

#[wasm_bindgen]
impl NookSentinelGenesisStatus {
    pub(crate) const fn inactive() -> Self {
        Self {
            active: false,
            participants: Vec::new(),
            complete: false,
        }
    }

    pub(crate) fn from_session(session: &nook_core::SentinelGenesisSession) -> Self {
        Self {
            active: true,
            participants: session
                .participants()
                .iter()
                .map(NookSentinelGenesisParticipantStatus::from_core)
                .collect(),
            complete: session.is_complete(),
        }
    }

    #[wasm_bindgen(getter)]
    pub fn active(&self) -> bool {
        self.active
    }

    #[wasm_bindgen(getter)]
    pub fn participants(&mut self) -> Vec<NookSentinelGenesisParticipantStatus> {
        std::mem::take(&mut self.participants)
    }

    #[wasm_bindgen(getter, js_name = isComplete)]
    pub fn is_complete(&self) -> bool {
        self.complete
    }
}

#[wasm_bindgen]
pub struct NookSentinelGenesisDelivery {
    device_id: String,
    fingerprint: Option<String>,
    payload: String,
}

#[wasm_bindgen]
impl NookSentinelGenesisDelivery {
    pub(crate) fn from_core(
        delivery: &nook_core::SentinelGenesisShareDelivery,
        fingerprint: Option<String>,
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
    pub fn fingerprint(&self) -> Option<String> {
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
                    .map(|participant| participant.fingerprint.clone());
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
    pub fn new(
        username_field_count: u32,
        current_password_field_count: u32,
        new_password_field_count: u32,
        generic_password_field_count: u32,
        one_time_code_field_count: u32,
        manual_checkpoint_present: bool,
    ) -> Self {
        Self(nook_core::AuthenticationPageObservation {
            username_field_count,
            current_password_field_count,
            new_password_field_count,
            generic_password_field_count,
            one_time_code_field_count,
            manual_checkpoint_present,
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
pub struct NookAuthenticationOutcomeObservation(nook_core::AuthenticationOutcomeObservation);

#[wasm_bindgen]
impl NookAuthenticationOutcomeObservation {
    #[wasm_bindgen(constructor)]
    #[allow(clippy::too_many_arguments)]
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

#[wasm_bindgen(typescript_custom_section)]
const WEB_TYPES: &'static str = r#"
export type NookAppLocale = 'en' | 'ru';
"#;

fn browser_language_tags() -> Vec<String> {
    let navigator = window().navigator();
    let mut tags = navigator
        .languages()
        .iter()
        .filter_map(|value| value.as_string())
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();

    if tags.is_empty()
        && let Some(language) = navigator.language()
    {
        let language = language.trim();
        if !language.is_empty() {
            tags.push(language.to_owned());
        }
    }

    tags
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookBrowserLocale {
    language_tags: Vec<String>,
}

#[wasm_bindgen]
impl NookBrowserLocale {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            language_tags: browser_language_tags(),
        }
    }

    #[wasm_bindgen(js_name = fromTags)]
    pub fn from_tags(tags: Vec<String>) -> Self {
        Self {
            language_tags: tags,
        }
    }

    #[wasm_bindgen(js_name = languageTags)]
    #[must_use]
    pub fn language_tags(&self) -> Vec<String> {
        self.language_tags.clone()
    }

    #[wasm_bindgen(js_name = appLocale)]
    #[must_use]
    pub fn app_locale(&self) -> String {
        nook_core::resolve_app_locale_from_tags(self.language_tags.iter().map(String::as_str))
            .to_owned()
    }
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookClientRunMode {
    Local,
    Dev,
    Prod,
}

impl From<NookClientRunMode> for nook_core::ClientRunMode {
    fn from(value: NookClientRunMode) -> Self {
        match value {
            NookClientRunMode::Local => Self::Local,
            NookClientRunMode::Dev => Self::Dev,
            NookClientRunMode::Prod => Self::Prod,
        }
    }
}

impl From<nook_core::ClientRunMode> for NookClientRunMode {
    fn from(value: nook_core::ClientRunMode) -> Self {
        match value {
            nook_core::ClientRunMode::Local => Self::Local,
            nook_core::ClientRunMode::Dev => Self::Dev,
            nook_core::ClientRunMode::Prod => Self::Prod,
        }
    }
}

#[wasm_bindgen]
pub struct NookClientRunModeUtil;

#[wasm_bindgen]
impl NookClientRunModeUtil {
    pub fn parse(mode: &str) -> Result<NookClientRunMode, wasm_bindgen::JsError> {
        nook_core::ClientRunMode::parse(mode)
            .map(Into::into)
            .ok_or_else(|| wasm_bindgen::JsError::new(&format!("Unknown client run mode: {mode}")))
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookStorageConnectArgs {
    mode: String,
    pat: String,
    repo: String,
}

impl From<nook_core::StorageConnectArgs> for NookStorageConnectArgs {
    fn from(args: nook_core::StorageConnectArgs) -> Self {
        Self {
            mode: args.mode,
            pat: args.pat,
            repo: args.repo,
        }
    }
}

#[wasm_bindgen]
impl NookStorageConnectArgs {
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn mode(&self) -> String {
        self.mode.clone()
    }

    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn pat(&self) -> String {
        self.pat.clone()
    }

    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn repo(&self) -> String {
        self.repo.clone()
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookGoogleDriveFolder {
    id: String,
    name: String,
}

impl NookGoogleDriveFolder {
    pub(crate) fn new(id: String, name: String) -> Self {
        Self { id, name }
    }
}

#[wasm_bindgen]
impl NookGoogleDriveFolder {
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn id(&self) -> String {
        self.id.clone()
    }

    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn name(&self) -> String {
        self.name.clone()
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookRuntimeConfig {
    policy: nook_core::VaultRuntimePolicy,
}

/// Thin wasm adapter over portable vault client/session policy. Svelte keeps
/// reactive values; this object owns no browser state and only evaluates core
/// transitions and predicates.
#[wasm_bindgen]
#[derive(Clone, Copy, Debug, Default)]
pub struct NookVaultClientPolicy;

#[wasm_bindgen]
impl NookVaultClientPolicy {
    #[wasm_bindgen(constructor)]
    #[must_use]
    pub fn new() -> Self {
        Self
    }

    #[wasm_bindgen(js_name = editBlockReason)]
    #[must_use]
    pub fn edit_block_reason(
        &self,
        security_conflict_count: u32,
        has_sync_conflict: bool,
        architecture_allows_secret_creation: bool,
    ) -> Option<nook_core::VaultEditBlockReason> {
        nook_core::VaultClientPolicy::edit_block_reason(
            security_conflict_count as usize,
            has_sync_conflict,
            architecture_allows_secret_creation,
        )
    }

    #[wasm_bindgen(js_name = isSyncActivityVisible)]
    #[must_use]
    pub fn is_sync_activity_visible(
        &self,
        fan_out_syncing: bool,
        provider_syncing: bool,
        syncing: bool,
        saving: bool,
    ) -> bool {
        nook_core::VaultClientPolicy::sync_activity_visible(
            fan_out_syncing,
            provider_syncing,
            syncing,
            saving,
        )
    }

    #[wasm_bindgen(js_name = hasPasswordEnvelope)]
    #[must_use]
    pub fn has_password_envelope(
        &self,
        password_entry_count: u32,
        password_unlock_mode: bool,
    ) -> bool {
        nook_core::VaultClientPolicy::has_password_envelope(
            password_entry_count as usize,
            password_unlock_mode,
        )
    }

    #[wasm_bindgen(js_name = shouldAutoUnlock)]
    #[must_use]
    #[allow(clippy::too_many_arguments)]
    pub fn should_auto_unlock(
        &self,
        session_explicitly_locked: bool,
        local_vault_present: bool,
        password_entry_count: u32,
        sync_provider_count: u32,
        provider_setup_active: bool,
        add_provider_open: bool,
    ) -> bool {
        nook_core::VaultClientPolicy::should_auto_unlock(
            session_explicitly_locked,
            local_vault_present,
            password_entry_count as usize,
            sync_provider_count as usize,
            provider_setup_active,
            add_provider_open,
        )
    }

    #[wasm_bindgen(js_name = shouldShowLoginVaultPicker)]
    #[must_use]
    #[allow(clippy::too_many_arguments)]
    pub fn should_show_login_vault_picker(
        &self,
        authenticated: bool,
        local_vault_count: u32,
        vault_selected: bool,
        provider_setup_active: bool,
        add_provider_open: bool,
        session_explicitly_locked: bool,
    ) -> bool {
        nook_core::VaultClientPolicy::should_show_login_vault_picker(
            authenticated,
            local_vault_count as usize,
            vault_selected,
            provider_setup_active,
            add_provider_open,
            session_explicitly_locked,
        )
    }

    #[wasm_bindgen(js_name = remoteVaultAssessDecision)]
    #[must_use]
    pub fn remote_vault_assess_decision(
        &self,
        access_status: nook_core::VaultAccessStatus,
        existing_vault_required: bool,
        provider_setup_active: bool,
    ) -> nook_core::RemoteVaultAssessDecision {
        nook_core::VaultClientPolicy::remote_vault_assess_decision(
            access_status,
            existing_vault_required,
            provider_setup_active,
        )
    }

    #[wasm_bindgen(js_name = unauthenticatedSyncDecision)]
    #[must_use]
    pub fn unauthenticated_sync_decision(
        &self,
        changed: bool,
        access_status: Option<nook_core::VaultAccessStatus>,
        join_state: nook_core::JoinEnrollmentState,
        awaiting_join_approval: bool,
    ) -> nook_core::UnauthenticatedSyncDecision {
        nook_core::VaultClientPolicy::unauthenticated_sync_decision(
            changed,
            access_status,
            join_state,
            awaiting_join_approval,
        )
    }

    #[wasm_bindgen(js_name = shouldAutoConnectAfterApproval)]
    #[must_use]
    #[allow(clippy::too_many_arguments)]
    pub fn should_auto_connect_after_approval(
        &self,
        authenticated: bool,
        verifying: bool,
        password_prompt_open: bool,
        session_expired_by_idle: bool,
        session_explicitly_locked: bool,
    ) -> bool {
        nook_core::VaultClientPolicy::should_auto_connect_after_approval(
            authenticated,
            verifying,
            password_prompt_open,
            session_expired_by_idle,
            session_explicitly_locked,
        )
    }

    #[wasm_bindgen(js_name = normalizedSecretPageOffset)]
    #[must_use]
    pub fn normalized_secret_page_offset(
        &self,
        total: u32,
        requested_offset: u32,
        page_size: u32,
    ) -> u32 {
        nook_core::VaultClientPolicy::normalized_secret_page_offset(
            total,
            requested_offset,
            page_size,
        )
    }

    #[wasm_bindgen(js_name = vaultSwitchTarget)]
    #[must_use]
    #[allow(clippy::needless_pass_by_value)]
    pub fn vault_switch_target(
        &self,
        requested_store_id: &str,
        active_store_id: Option<String>,
        verifying: bool,
    ) -> Option<String> {
        nook_core::VaultClientPolicy::vault_switch_target(
            requested_store_id,
            active_store_id.as_deref(),
            verifying,
        )
    }
}

#[wasm_bindgen]
impl NookRuntimeConfig {
    #[wasm_bindgen(constructor)]
    pub fn new(run_mode: NookClientRunMode, e2e_expose_vault: bool) -> Self {
        Self {
            policy: nook_core::VaultRuntimePolicy::new(run_mode.into(), e2e_expose_vault),
        }
    }

    #[wasm_bindgen(getter, js_name = runMode)]
    #[must_use]
    pub fn run_mode(&self) -> NookClientRunMode {
        self.policy.run_mode().into()
    }

    #[wasm_bindgen(getter, js_name = isLocal)]
    #[must_use]
    pub fn is_local(&self) -> bool {
        self.policy.run_mode() == nook_core::ClientRunMode::Local
    }

    #[wasm_bindgen(getter, js_name = isDev)]
    #[must_use]
    pub fn is_dev(&self) -> bool {
        self.policy.run_mode() == nook_core::ClientRunMode::Dev
    }

    #[wasm_bindgen(getter, js_name = isProd)]
    #[must_use]
    pub fn is_prod(&self) -> bool {
        self.policy.run_mode() == nook_core::ClientRunMode::Prod
    }

    #[wasm_bindgen(getter, js_name = e2eExposeVault)]
    #[must_use]
    pub fn e2e_expose_vault(&self) -> bool {
        self.policy.expose_test_capabilities()
    }

    #[must_use]
    pub fn allow_fast_idle(&self) -> bool {
        self.policy.allow_fast_idle()
    }

    #[wasm_bindgen(js_name = allowFastSync)]
    #[must_use]
    pub fn allow_fast_sync(&self) -> bool {
        self.policy.allow_fast_sync()
    }

    #[wasm_bindgen(js_name = exposeDebugHooks)]
    #[must_use]
    pub fn expose_debug_hooks(&self) -> bool {
        self.policy.expose_debug_hooks()
    }

    #[wasm_bindgen(js_name = resolveVaultIdleTimeoutMs)]
    #[must_use]
    #[allow(clippy::needless_pass_by_value)]
    pub fn resolve_vault_idle_timeout_ms(&self, raw_timeout_ms: Option<String>) -> u32 {
        self.policy
            .resolve_vault_idle_timeout_ms(raw_timeout_ms.as_deref())
    }

    #[wasm_bindgen(js_name = resolveVaultIdleWarningMs)]
    #[must_use]
    #[allow(clippy::needless_pass_by_value)]
    pub fn resolve_vault_idle_warning_ms(&self, raw_warning_ms: Option<String>) -> u32 {
        self.policy
            .resolve_vault_idle_warning_ms(raw_warning_ms.as_deref())
    }

    #[wasm_bindgen(js_name = resolveVaultSyncIntervalMs)]
    #[must_use]
    #[allow(clippy::needless_pass_by_value)]
    pub fn resolve_vault_sync_interval_ms(&self, raw_interval_ms: Option<String>) -> u32 {
        self.policy
            .resolve_vault_sync_interval_ms(raw_interval_ms.as_deref())
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookPasskeySetup {
    user_handle: Vec<u8>,
    prf_input: Vec<u8>,
}

impl NookPasskeySetup {
    pub(crate) fn from_core(setup: &nook_core::DeviceKeyProtectionSetup) -> Self {
        Self {
            user_handle: setup.user_handle().to_vec(),
            prf_input: setup.prf_input().to_vec(),
        }
    }
}

#[wasm_bindgen]
impl NookPasskeySetup {
    #[wasm_bindgen(getter, js_name = userHandle)]
    pub fn user_handle(&self) -> Vec<u8> {
        self.user_handle.clone()
    }

    #[wasm_bindgen(getter, js_name = prfInput)]
    pub fn prf_input(&self) -> Vec<u8> {
        self.prf_input.clone()
    }

    #[wasm_bindgen(js_name = creationOptions)]
    pub fn creation_options(
        &self,
        rp_id: &str,
        rp_name: &str,
    ) -> Result<web_sys::CredentialCreationOptions, wasm_bindgen::JsError> {
        crate::passkey_browser::creation_options(
            rp_id,
            rp_name,
            crate::passkey_browser::DEFAULT_PASSKEY_LABEL,
            &self.user_handle,
            &self.prf_input,
        )
    }

    /// Build browser registration options with the label chosen by the caller.
    /// The browser ceremony remains in the presentation layer; this only
    /// prepares the typed `WebAuthn` request from Rust-owned setup material.
    #[wasm_bindgen(js_name = creationOptionsWithLabel)]
    pub fn creation_options_with_label(
        &self,
        rp_id: &str,
        rp_name: &str,
        passkey_label: &str,
    ) -> Result<web_sys::CredentialCreationOptions, wasm_bindgen::JsError> {
        crate::passkey_browser::creation_options(
            rp_id,
            rp_name,
            passkey_label,
            &self.user_handle,
            &self.prf_input,
        )
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookPasskeyUnlockOptions {
    credential_id: Vec<u8>,
    prf_input: Vec<u8>,
}

impl NookPasskeyUnlockOptions {
    pub(crate) fn from_core(
        record: &nook_core::WrappedDeviceIdentity,
    ) -> Result<Self, nook_core::DeviceKeyProtectionError> {
        let request = nook_core::passkey_assertion_request(record)?;
        Ok(Self {
            credential_id: request.credential_id().to_vec(),
            prf_input: request.prf_input().to_vec(),
        })
    }
}

#[wasm_bindgen]
impl NookPasskeyUnlockOptions {
    #[wasm_bindgen(getter, js_name = credentialId)]
    pub fn credential_id(&self) -> Vec<u8> {
        self.credential_id.clone()
    }

    #[wasm_bindgen(getter, js_name = prfInput)]
    pub fn prf_input(&self) -> Vec<u8> {
        self.prf_input.clone()
    }

    #[wasm_bindgen(js_name = requestOptions)]
    pub fn request_options(
        &self,
        rp_id: &str,
    ) -> Result<web_sys::CredentialRequestOptions, wasm_bindgen::JsError> {
        crate::passkey_browser::request_options(rp_id, &self.credential_id, &self.prf_input)
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookJoinRequest {
    device_id: String,
    public_key: String,
    requested_at: String,
}

#[wasm_bindgen]
impl NookJoinRequest {
    pub(crate) fn from_core(join: nook_core::JoinRequest) -> Self {
        Self {
            device_id: join.device_id.to_string(),
            public_key: join.public_key.as_str().to_owned(),
            requested_at: join.requested_at,
        }
    }

    #[wasm_bindgen(getter, js_name = deviceId)]
    pub fn device_id(&self) -> String {
        self.device_id.clone()
    }

    #[wasm_bindgen(getter, js_name = publicKey)]
    pub fn public_key(&self) -> String {
        self.public_key.clone()
    }

    #[wasm_bindgen(getter, js_name = requestedAt)]
    pub fn requested_at(&self) -> String {
        self.requested_at.clone()
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookVaultMember {
    auth_id: String,
    device_id: String,
    public_key: String,
    enrolled_at: String,
    label: String,
}

#[wasm_bindgen]
impl NookVaultMember {
    pub(crate) fn from_core(member: nook_core::VaultMember) -> Self {
        Self {
            auth_id: member.auth_id.to_string(),
            device_id: member.device_id.to_string(),
            public_key: member.public_key.as_str().to_owned(),
            enrolled_at: member.enrolled_at,
            label: member.label.unwrap_or_default(),
        }
    }

    #[wasm_bindgen(getter, js_name = authId)]
    pub fn auth_id(&self) -> String {
        self.auth_id.clone()
    }

    #[wasm_bindgen(getter, js_name = deviceId)]
    pub fn device_id(&self) -> String {
        self.device_id.clone()
    }

    #[wasm_bindgen(getter, js_name = publicKey)]
    pub fn public_key(&self) -> String {
        self.public_key.clone()
    }

    #[wasm_bindgen(getter, js_name = enrolledAt)]
    pub fn enrolled_at(&self) -> String {
        self.enrolled_at.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn label(&self) -> String {
        self.label.clone()
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookPasswordEntrySummary {
    id: String,
    label: String,
    created_at: String,
}

#[wasm_bindgen]
impl NookPasswordEntrySummary {
    pub(crate) fn from_core(entry: &nook_core::PasswordUnlockEntry) -> Self {
        Self {
            id: entry.id.clone(),
            label: entry.label.clone(),
            created_at: entry.created_at.clone(),
        }
    }

    #[wasm_bindgen(getter)]
    pub fn id(&self) -> String {
        self.id.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn label(&self) -> String {
        self.label.clone()
    }

    #[wasm_bindgen(getter, js_name = createdAt)]
    pub fn created_at(&self) -> String {
        self.created_at.clone()
    }
}

pub(crate) fn password_entries_to_vec(
    entries: &[nook_core::PasswordUnlockEntry],
) -> Vec<NookPasswordEntrySummary> {
    entries
        .iter()
        .map(NookPasswordEntrySummary::from_core)
        .collect()
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookEnrollmentProvider(nook_core::EnrollmentProvider);

#[wasm_bindgen]
impl NookEnrollmentProvider {
    #[wasm_bindgen(js_name = local)]
    #[must_use]
    pub fn local() -> Self {
        Self(nook_core::EnrollmentProvider::personal(
            nook_core::PersonalEnrollmentProvider::local(),
        ))
    }

    #[wasm_bindgen(js_name = github)]
    #[must_use]
    pub fn github(repo: String, pat: String) -> Self {
        Self(nook_core::EnrollmentProvider::personal(
            nook_core::PersonalEnrollmentProvider::github(pat, repo),
        ))
    }

    #[wasm_bindgen(js_name = oauthFile)]
    #[must_use]
    #[allow(clippy::too_many_arguments)]
    pub fn oauth_file(
        preset: String,
        access_token: String,
        refresh_token: Option<String>,
        expires_at: Option<String>,
        file_id: Option<String>,
        file_name: Option<String>,
        account_email: Option<String>,
    ) -> Self {
        Self(nook_core::EnrollmentProvider::personal(
            nook_core::PersonalEnrollmentProvider::oauth_file(
                preset,
                access_token,
                refresh_token,
                expires_at,
                file_id,
                file_name,
                account_email,
            ),
        ))
    }

    #[wasm_bindgen(js_name = sharedProviderGrant)]
    #[must_use]
    pub fn shared_provider_grant(
        sync_provider_type: String,
        oauth_preset: Option<String>,
        joiner_identity_kind: String,
        joiner_identity: String,
        storage_target_id: Option<String>,
    ) -> Self {
        Self(nook_core::EnrollmentProvider::shared(
            nook_core::SharedEnrollmentProvider::legacy_google_drive(
                sync_provider_type,
                oauth_preset,
                joiner_identity_kind,
                joiner_identity,
                storage_target_id,
            ),
        ))
    }

    #[wasm_bindgen(js_name = iCloudShared)]
    #[must_use]
    pub fn icloud_shared(storage_target_id: String) -> Self {
        Self(nook_core::EnrollmentProvider::shared(
            nook_core::SharedEnrollmentProvider::icloud(storage_target_id),
        ))
    }

    pub(crate) fn from_core(provider: nook_core::EnrollmentProvider) -> Self {
        Self(provider)
    }

    pub(crate) fn to_core(&self) -> nook_core::EnrollmentProvider {
        self.0.clone()
    }

    #[wasm_bindgen(getter, js_name = "type")]
    #[must_use]
    pub fn provider_type(&self) -> nook_core::StorageProviderType {
        match &self.0 {
            nook_core::EnrollmentProvider::PersonalCredentialTransfer(provider) => {
                match provider.data() {
                    nook_core::PersonalEnrollmentProviderData::Local => {
                        nook_core::StorageProviderType::Local
                    }
                    nook_core::PersonalEnrollmentProviderData::Github { .. } => {
                        nook_core::StorageProviderType::Github
                    }
                    nook_core::PersonalEnrollmentProviderData::OauthFile { .. } => {
                        nook_core::StorageProviderType::OauthFile
                    }
                }
            }
            nook_core::EnrollmentProvider::SharedProviderGrant(_) => {
                nook_core::StorageProviderType::OauthFile
            }
        }
    }

    #[wasm_bindgen(getter, js_name = isSharedProviderGrant)]
    #[must_use]
    pub fn is_shared_provider_grant(&self) -> bool {
        matches!(
            self.0,
            nook_core::EnrollmentProvider::SharedProviderGrant(_)
        )
    }

    #[wasm_bindgen(getter, js_name = onboardingType)]
    #[must_use]
    pub fn onboarding_type(&self) -> nook_core::OnboardingType {
        nook_core::enrollment_provider_onboarding_type(&self.0)
    }

    #[wasm_bindgen(getter, js_name = githubPat)]
    pub fn github_pat(&self) -> Option<String> {
        match self.0.personal_data() {
            Some(nook_core::PersonalEnrollmentProviderData::Github { pat, .. }) => {
                Some(pat.clone())
            }
            _ => None,
        }
    }

    #[wasm_bindgen(getter, js_name = githubRepo)]
    pub fn github_repo(&self) -> Option<String> {
        match self.0.personal_data() {
            Some(nook_core::PersonalEnrollmentProviderData::Github { repo, .. }) => {
                Some(repo.clone())
            }
            _ => None,
        }
    }

    #[wasm_bindgen(getter, js_name = oauthPreset)]
    pub fn oauth_preset(&self) -> Option<String> {
        match (&self.0.personal_data(), &self.0.shared_data()) {
            (Some(nook_core::PersonalEnrollmentProviderData::OauthFile { preset, .. }), _) => {
                Some(preset.clone())
            }
            (
                _,
                Some(nook_core::SharedEnrollmentProviderData::GoogleDrive { oauth_preset, .. }),
            ) => oauth_preset.clone(),
            (_, Some(nook_core::SharedEnrollmentProviderData::ICloud { .. })) => {
                Some("icloud".to_owned())
            }
            _ => None,
        }
    }

    #[wasm_bindgen(getter, js_name = oauthAccessToken)]
    pub fn oauth_access_token(&self) -> Option<String> {
        match self.0.personal_data() {
            Some(nook_core::PersonalEnrollmentProviderData::OauthFile { access_token, .. }) => {
                Some(access_token.clone())
            }
            _ => None,
        }
    }

    #[wasm_bindgen(getter, js_name = oauthRefreshToken)]
    pub fn oauth_refresh_token(&self) -> Option<String> {
        match self.0.personal_data() {
            Some(nook_core::PersonalEnrollmentProviderData::OauthFile {
                refresh_token, ..
            }) => refresh_token.clone(),
            _ => None,
        }
    }

    #[wasm_bindgen(getter, js_name = oauthExpiresAt)]
    pub fn oauth_expires_at(&self) -> Option<String> {
        match self.0.personal_data() {
            Some(nook_core::PersonalEnrollmentProviderData::OauthFile { expires_at, .. }) => {
                expires_at.clone()
            }
            _ => None,
        }
    }

    #[wasm_bindgen(getter, js_name = oauthFileId)]
    pub fn oauth_file_id(&self) -> Option<String> {
        match self.0.personal_data() {
            Some(nook_core::PersonalEnrollmentProviderData::OauthFile { file_id, .. }) => {
                file_id.clone()
            }
            _ => None,
        }
    }

    #[wasm_bindgen(getter, js_name = oauthFileName)]
    pub fn oauth_file_name(&self) -> Option<String> {
        match self.0.personal_data() {
            Some(nook_core::PersonalEnrollmentProviderData::OauthFile { file_name, .. }) => {
                file_name.clone()
            }
            _ => None,
        }
    }

    #[wasm_bindgen(getter, js_name = oauthAccountEmail)]
    pub fn oauth_account_email(&self) -> Option<String> {
        match self.0.personal_data() {
            Some(nook_core::PersonalEnrollmentProviderData::OauthFile {
                account_email, ..
            }) => account_email.clone(),
            _ => None,
        }
    }

    #[wasm_bindgen(getter, js_name = sharedJoinerIdentityKind)]
    pub fn shared_joiner_identity_kind(&self) -> Option<String> {
        match self.0.shared_data() {
            Some(nook_core::SharedEnrollmentProviderData::GoogleDrive {
                joiner_identity_kind,
                ..
            }) => Some(joiner_identity_kind.clone()),
            _ => None,
        }
    }

    #[wasm_bindgen(getter, js_name = sharedJoinerIdentity)]
    pub fn shared_joiner_identity(&self) -> Option<String> {
        match self.0.shared_data() {
            Some(nook_core::SharedEnrollmentProviderData::GoogleDrive {
                joiner_identity, ..
            }) => Some(joiner_identity.clone()),
            _ => None,
        }
    }

    #[wasm_bindgen(getter, js_name = sharedStorageTargetId)]
    pub fn shared_storage_target_id(&self) -> Option<String> {
        match self.0.shared_data() {
            Some(nook_core::SharedEnrollmentProviderData::GoogleDrive {
                storage_target_id,
                ..
            }) => storage_target_id.clone(),
            Some(nook_core::SharedEnrollmentProviderData::ICloud { storage_target_id }) => {
                Some(storage_target_id.clone())
            }
            None => None,
        }
    }
}

/// Thin wasm newtype wrapper over the core `SyncProviderTarget` enum. Construct
/// via the variant constructors; read via `is_*` / `as_*` accessors.
#[wasm_bindgen]
#[derive(Clone)]
pub struct NookSyncProviderTarget(nook_core::SyncProviderTarget);

#[wasm_bindgen]
impl NookSyncProviderTarget {
    #[wasm_bindgen(js_name = local)]
    #[must_use]
    pub fn local() -> Self {
        Self(nook_core::SyncProviderTarget::Local)
    }

    #[wasm_bindgen(js_name = localFolder)]
    #[must_use]
    pub fn local_folder(directory_name: Option<String>, handle_id: Option<String>) -> Self {
        Self(nook_core::SyncProviderTarget::LocalFolder(
            nook_core::LocalFolderSyncTarget {
                directory_name,
                handle_id,
            },
        ))
    }

    #[wasm_bindgen(js_name = github)]
    #[must_use]
    pub fn github(repo: String, pat: String) -> Self {
        Self(nook_core::SyncProviderTarget::Github(
            nook_core::GithubSyncTarget { repo, pat },
        ))
    }

    #[wasm_bindgen(js_name = empty)]
    #[must_use]
    pub fn empty() -> Self {
        Self(nook_core::SyncProviderTarget::Empty)
    }

    #[wasm_bindgen(js_name = oauthFile)]
    #[allow(clippy::needless_pass_by_value)]
    pub fn oauth_file(
        preset: Option<String>,
        file_id: Option<String>,
        file_name: Option<String>,
        account_email: Option<String>,
        access_token: Option<String>,
        folder_id: Option<String>,
    ) -> Result<NookSyncProviderTarget, wasm_bindgen::JsError> {
        let preset = preset
            .as_deref()
            .map(nook_core::OauthFilePreset::parse)
            .transpose()?
            .unwrap_or(nook_core::OauthFilePreset::GoogleDrive);
        Ok(Self(nook_core::SyncProviderTarget::OauthFile(
            nook_core::OauthFileSyncTarget {
                preset,
                file_id,
                folder_id,
                file_name,
                account_email,
                access_token,
            },
        )))
    }

    #[wasm_bindgen(js_name = isLocal)]
    #[must_use]
    pub fn is_local(&self) -> bool {
        matches!(self.0, nook_core::SyncProviderTarget::Local)
    }

    #[wasm_bindgen(js_name = isLocalFolder)]
    #[must_use]
    pub fn is_local_folder(&self) -> bool {
        matches!(self.0, nook_core::SyncProviderTarget::LocalFolder(_))
    }

    #[wasm_bindgen(js_name = isGithub)]
    #[must_use]
    pub fn is_github(&self) -> bool {
        matches!(self.0, nook_core::SyncProviderTarget::Github(_))
    }

    #[wasm_bindgen(js_name = isEmpty)]
    #[must_use]
    pub fn is_empty(&self) -> bool {
        matches!(self.0, nook_core::SyncProviderTarget::Empty)
    }

    #[wasm_bindgen(js_name = isOauthFile)]
    #[must_use]
    pub fn is_oauth_file(&self) -> bool {
        matches!(self.0, nook_core::SyncProviderTarget::OauthFile(_))
    }
}

impl From<nook_core::SyncProviderTarget> for NookSyncProviderTarget {
    fn from(target: nook_core::SyncProviderTarget) -> Self {
        Self(target)
    }
}

#[wasm_bindgen]
pub struct NookEnrollmentIssueInput {
    provider: NookEnrollmentProvider,
    vault_name: String,
    entry_id: String,
    issued_at: String,
}

#[wasm_bindgen]
impl NookEnrollmentIssueInput {
    #[wasm_bindgen(constructor)]
    pub fn new(
        provider: NookEnrollmentProvider,
        vault_name: String,
        entry_id: String,
        issued_at: String,
    ) -> Self {
        Self {
            provider,
            vault_name,
            entry_id,
            issued_at,
        }
    }

    pub(crate) fn to_core(
        &self,
    ) -> Result<nook_core::EnrollmentIssueInput, nook_core::EnrollmentError> {
        Ok(nook_core::EnrollmentIssueInput {
            provider: self.provider.to_core(),
            vault_name: self.vault_name.clone(),
            entry_id: self.entry_id.clone(),
            issued_at: self.issued_at.clone(),
        })
    }

    #[wasm_bindgen(getter)]
    pub fn provider(&self) -> NookEnrollmentProvider {
        self.provider.clone()
    }

    #[wasm_bindgen(getter, js_name = entryId)]
    pub fn entry_id(&self) -> String {
        self.entry_id.clone()
    }

    #[wasm_bindgen(getter, js_name = issuedAt)]
    pub fn issued_at(&self) -> String {
        self.issued_at.clone()
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookDecryptedEnrollmentPayload {
    provider: NookEnrollmentProvider,
    vault_name: Option<String>,
    entry_id: String,
    issued_at: String,
}

#[wasm_bindgen]
impl NookDecryptedEnrollmentPayload {
    pub(crate) fn from_core(payload: nook_core::DecryptedEnrollmentPayload) -> Self {
        Self {
            provider: NookEnrollmentProvider::from_core(payload.provider),
            vault_name: payload.vault_name,
            entry_id: payload.entry_id,
            issued_at: payload.issued_at,
        }
    }

    #[wasm_bindgen(getter)]
    pub fn provider(&self) -> NookEnrollmentProvider {
        self.provider.clone()
    }

    #[wasm_bindgen(getter, js_name = vaultName)]
    pub fn vault_name(&self) -> Option<String> {
        self.vault_name.clone()
    }

    #[wasm_bindgen(getter, js_name = onboardingType)]
    #[must_use]
    pub fn onboarding_type(&self) -> nook_core::OnboardingType {
        self.provider.onboarding_type()
    }

    #[wasm_bindgen(getter, js_name = entryId)]
    pub fn entry_id(&self) -> String {
        self.entry_id.clone()
    }

    #[wasm_bindgen(getter, js_name = issuedAt)]
    pub fn issued_at(&self) -> String {
        self.issued_at.clone()
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookVaultSyncResult {
    changed: bool,
    access_status: Option<nook_core::VaultAccessStatus>,
    secrets: Vec<NookSecretRecord>,
    pending_joins: Vec<NookJoinRequest>,
    vault_members: Vec<NookVaultMember>,
}

#[wasm_bindgen]
impl NookVaultSyncResult {
    #[wasm_bindgen(getter)]
    pub fn changed(&self) -> bool {
        self.changed
    }

    #[wasm_bindgen(getter, js_name = accessStatus)]
    pub fn access_status(&self) -> Option<nook_core::VaultAccessStatus> {
        self.access_status
    }

    #[wasm_bindgen(getter)]
    pub fn secrets(&self) -> Vec<NookSecretRecord> {
        self.secrets.clone()
    }

    #[wasm_bindgen(getter, js_name = pendingJoins)]
    pub fn pending_joins(&self) -> Vec<NookJoinRequest> {
        self.pending_joins.clone()
    }

    #[wasm_bindgen(getter, js_name = vaultMembers)]
    pub fn vault_members(&self) -> Vec<NookVaultMember> {
        self.vault_members.clone()
    }

    pub(crate) fn unchanged() -> Self {
        Self {
            changed: false,
            access_status: None,
            secrets: Vec::new(),
            pending_joins: Vec::new(),
            vault_members: Vec::new(),
        }
    }

    pub(crate) fn with_access_status(status: nook_core::VaultAccessStatus) -> Self {
        Self {
            changed: true,
            access_status: Some(status),
            secrets: Vec::new(),
            pending_joins: Vec::new(),
            vault_members: Vec::new(),
        }
    }

    pub(crate) fn session(manager: &NookVaultManager, changed: bool) -> Result<Self, NookError> {
        Ok(Self {
            changed,
            access_status: None,
            secrets: Vec::new(),
            pending_joins: manager.pending_joins().unwrap_or_default(),
            vault_members: manager.vault_members().unwrap_or_default(),
        })
    }
}

#[wasm_bindgen]
pub struct NookSecretPage {
    items: Vec<NookSecretListItem>,
    total: u32,
    offset: u32,
    limit: u32,
}

impl NookSecretPage {
    pub(crate) fn from_core(page: nook_core::SecretPage) -> Result<Self, NookError> {
        Ok(Self {
            items: list_items_to_vec(page.records),
            total: u32::try_from(page.total).unwrap_or(u32::MAX),
            offset: u32::try_from(page.offset).unwrap_or(u32::MAX),
            limit: u32::try_from(page.limit).unwrap_or(u32::MAX),
        })
    }
}

#[wasm_bindgen]
impl NookSecretPage {
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn total(&self) -> u32 {
        self.total
    }

    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn offset(&self) -> u32 {
        self.offset
    }

    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn limit(&self) -> u32 {
        self.limit
    }

    /// Transfer page-owned metadata items to JavaScript without cloning them.
    #[wasm_bindgen(js_name = takeItems)]
    pub fn take_items(&mut self) -> Vec<NookSecretListItem> {
        std::mem::take(&mut self.items)
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookImportResult {
    imported: u32,
    skipped_unsupported: u32,
    skipped_duplicates: u32,
}

#[wasm_bindgen]
impl NookImportResult {
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn imported(&self) -> u32 {
        self.imported
    }

    #[wasm_bindgen(getter, js_name = skippedUnsupported)]
    #[must_use]
    pub fn skipped_unsupported(&self) -> u32 {
        self.skipped_unsupported
    }

    #[wasm_bindgen(getter, js_name = skippedDuplicates)]
    #[must_use]
    pub fn skipped_duplicates(&self) -> u32 {
        self.skipped_duplicates
    }

    pub(crate) fn new(
        imported: usize,
        skipped_unsupported: usize,
        skipped_duplicates: usize,
    ) -> Self {
        Self {
            imported: u32::try_from(imported).unwrap_or(u32::MAX),
            skipped_unsupported: u32::try_from(skipped_unsupported).unwrap_or(u32::MAX),
            skipped_duplicates: u32::try_from(skipped_duplicates).unwrap_or(u32::MAX),
        }
    }
}

/// Variant-specific form payload for `buildSecretYaml`.
#[wasm_bindgen]
pub struct NookSecretFormFields {
    pub(crate) inner: nook_core::SecretFormFields,
}

#[wasm_bindgen]
impl NookSecretFormFields {
    #[wasm_bindgen(js_name = login)]
    pub fn login(website_url: String, username: String, password: String, notes: String) -> Self {
        Self {
            inner: nook_core::SecretFormFields::Login(nook_core::LoginSecretForm {
                website_url,
                username,
                password,
                notes,
            }),
        }
    }

    #[wasm_bindgen(js_name = apiKey)]
    pub fn api_key(website_url: String, key: String, expires_at: String) -> Self {
        Self {
            inner: nook_core::SecretFormFields::ApiKey(nook_core::ApiKeySecretForm {
                website_url,
                key,
                expires_at,
            }),
        }
    }

    #[wasm_bindgen(js_name = seedPhrase)]
    pub fn seed_phrase(name: String, seed: String) -> Self {
        Self {
            inner: nook_core::SecretFormFields::SeedPhrase(nook_core::SeedPhraseSecretForm {
                name,
                seed,
            }),
        }
    }

    #[wasm_bindgen(js_name = secureNote)]
    pub fn secure_note(title: String, note: String) -> Self {
        Self {
            inner: nook_core::SecretFormFields::SecureNote(nook_core::SecureNoteSecretForm {
                title,
                note,
            }),
        }
    }

    #[wasm_bindgen(js_name = authenticator)]
    #[allow(clippy::too_many_arguments)]
    pub fn authenticator(
        issuer: String,
        account: String,
        website_url: String,
        totp_secret: String,
        algorithm: String,
        digits: String,
        period: String,
        backup_codes: String,
    ) -> Self {
        Self {
            inner: nook_core::SecretFormFields::Authenticator(nook_core::AuthenticatorSecretForm {
                issuer,
                account,
                website_url,
                totp_secret,
                algorithm,
                digits,
                period,
                backup_codes,
            }),
        }
    }

    #[wasm_bindgen(js_name = creditCard)]
    #[allow(clippy::too_many_arguments)]
    pub fn credit_card(
        title: String,
        cardholder_name: String,
        number: String,
        expiration_month: String,
        expiration_year: String,
        cvv: String,
        notes: String,
    ) -> Self {
        Self {
            inner: nook_core::SecretFormFields::CreditCard(nook_core::CreditCardSecretForm {
                title,
                cardholder_name,
                number,
                expiration_month,
                expiration_year,
                cvv,
                notes,
            }),
        }
    }

    #[wasm_bindgen(js_name = fileAttachment)]
    pub fn file_attachment(
        title: String,
        file_name: String,
        mime_type: String,
        size_bytes: u32,
        content_base64: String,
    ) -> Self {
        Self {
            inner: nook_core::SecretFormFields::FileAttachment(
                nook_core::FileAttachmentSecretForm {
                    title,
                    file_name,
                    mime_type,
                    size_bytes: u64::from(size_bytes),
                    content_base64,
                },
            ),
        }
    }
}

#[wasm_bindgen]
pub struct NookTotpCode {
    code: String,
    seconds_remaining: u32,
    period: u32,
}

#[wasm_bindgen]
impl NookTotpCode {
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn code(&self) -> String {
        self.code.clone()
    }

    #[wasm_bindgen(getter, js_name = secondsRemaining)]
    #[must_use]
    pub fn seconds_remaining(&self) -> u32 {
        self.seconds_remaining
    }

    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn period(&self) -> u32 {
        self.period
    }

    pub(crate) fn from_core(value: nook_core::TotpCode) -> Self {
        Self {
            code: value.code,
            seconds_remaining: u32::try_from(value.seconds_remaining).unwrap_or(u32::MAX),
            period: u32::try_from(value.period).unwrap_or(u32::MAX),
        }
    }
}

impl Drop for NookTotpCode {
    fn drop(&mut self) {
        use zeroize::Zeroize;
        self.code.zeroize();
    }
}

pub(crate) fn records_to_vec(
    records: Vec<nook_core::SecretRecord>,
) -> Result<Vec<NookSecretRecord>, NookError> {
    Ok(records
        .into_iter()
        .map(NookSecretRecord::from_record)
        .collect())
}

pub(crate) fn list_items_to_vec(items: Vec<nook_core::SecretListItem>) -> Vec<NookSecretListItem> {
    let group_keys = nook_core::resolve_entity_group_keys(&items);
    items
        .into_iter()
        .zip(group_keys)
        .map(|(item, group_key)| NookSecretListItem::from_core(item, group_key))
        .collect()
}

pub(crate) fn joins_to_vec(joins: Vec<nook_core::JoinRequest>) -> Vec<NookJoinRequest> {
    joins.into_iter().map(NookJoinRequest::from_core).collect()
}

pub(crate) fn members_to_vec(members: Vec<nook_core::VaultMember>) -> Vec<NookVaultMember> {
    members
        .into_iter()
        .map(NookVaultMember::from_core)
        .collect()
}

/// Pending browser sync resolution state.
///
/// Core owns the variant-specific conflict. This wrapper additionally carries
/// the browser provider handle needed to resume the paused storage operation.
#[wasm_bindgen]
#[derive(Clone)]
pub struct NookPendingSyncConflict {
    provider_id: String,
    provider_label: String,
    local_yaml: String,
    remote_yaml: String,
    mode: String,
    pat: String,
    repo: String,
    remote_revision: Option<String>,
    conflict: nook_core::VaultSyncConflict,
}

const PENDING_SYNC_PROVIDER_ID: &str = "__pending_provider__";

#[wasm_bindgen]
impl NookPendingSyncConflict {
    #[wasm_bindgen(js_name = content)]
    #[allow(clippy::too_many_arguments)]
    pub fn content(
        provider_id: String,
        provider_label: String,
        local_yaml: String,
        remote_yaml: String,
        local_version: u32,
        remote_version: u32,
        mode: String,
        pat: String,
        repo: String,
        remote_revision: Option<String>,
    ) -> Self {
        Self {
            provider_id,
            provider_label,
            local_yaml,
            remote_yaml,
            mode,
            pat,
            repo,
            remote_revision,
            conflict: nook_core::VaultSyncConflict::Content(nook_core::ContentSyncConflict {
                local_version: u64::from(local_version),
                remote_version: u64::from(remote_version),
            }),
        }
    }

    #[wasm_bindgen(js_name = contentFromVaults)]
    #[allow(clippy::too_many_arguments)]
    pub fn content_from_vaults(
        provider_id: String,
        provider_label: String,
        local_yaml: String,
        remote_yaml: String,
        mode: String,
        pat: String,
        repo: String,
        remote_revision: Option<String>,
    ) -> Self {
        let local_version = nook_core::read_vault_version(&local_yaml).unwrap_or(0);
        let remote_version = nook_core::read_vault_version(&remote_yaml).unwrap_or(0);
        Self {
            provider_id,
            provider_label,
            local_yaml,
            remote_yaml,
            mode,
            pat,
            repo,
            remote_revision,
            conflict: nook_core::VaultSyncConflict::Content(nook_core::ContentSyncConflict {
                local_version,
                remote_version,
            }),
        }
    }

    #[wasm_bindgen(js_name = storeId)]
    #[allow(clippy::too_many_arguments)]
    pub fn store_id(
        provider_id: String,
        provider_label: String,
        local_yaml: String,
        remote_yaml: String,
        mode: String,
        pat: String,
        repo: String,
        remote_revision: Option<String>,
        local_store_id: String,
        remote_store_id: String,
    ) -> Self {
        Self {
            provider_id,
            provider_label,
            local_yaml,
            remote_yaml,
            mode,
            pat,
            repo,
            remote_revision,
            conflict: nook_core::VaultSyncConflict::StoreId(nook_core::StoreIdSyncConflict {
                local_store_id,
                remote_store_id,
            }),
        }
    }

    /// Store-id conflict discovered while a provider is still being configured.
    ///
    /// Keep the pending-provider sentinel inside Rust so the web layer does not
    /// duplicate a value that controls whether provider setup resumes after the
    /// user chooses a recovery action.
    #[wasm_bindgen(js_name = pendingStoreId)]
    #[allow(clippy::too_many_arguments)]
    pub fn pending_store_id(
        provider_label: String,
        local_yaml: String,
        remote_yaml: String,
        mode: String,
        pat: String,
        repo: String,
        remote_revision: Option<String>,
        local_store_id: String,
        remote_store_id: String,
    ) -> Self {
        Self::store_id(
            PENDING_SYNC_PROVIDER_ID.to_owned(),
            provider_label,
            local_yaml,
            remote_yaml,
            mode,
            pat,
            repo,
            remote_revision,
            local_store_id,
            remote_store_id,
        )
    }

    #[wasm_bindgen(getter, js_name = providerId)]
    pub fn provider_id(&self) -> String {
        self.provider_id.clone()
    }

    #[wasm_bindgen(getter, js_name = isPendingProvider)]
    #[must_use]
    pub fn is_pending_provider(&self) -> bool {
        self.provider_id == PENDING_SYNC_PROVIDER_ID
    }

    #[wasm_bindgen(getter, js_name = providerLabel)]
    pub fn provider_label(&self) -> String {
        self.provider_label.clone()
    }

    #[wasm_bindgen(getter, js_name = localYaml)]
    pub fn local_yaml(&self) -> String {
        self.local_yaml.clone()
    }

    #[wasm_bindgen(getter, js_name = remoteYaml)]
    pub fn remote_yaml(&self) -> String {
        self.remote_yaml.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn mode(&self) -> String {
        self.mode.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn pat(&self) -> String {
        self.pat.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn repo(&self) -> String {
        self.repo.clone()
    }

    #[wasm_bindgen(getter, js_name = remoteRevision)]
    pub fn remote_revision(&self) -> Option<String> {
        self.remote_revision.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn kind(&self) -> nook_core::VaultSyncConflictKind {
        self.conflict.kind()
    }

    #[wasm_bindgen(js_name = contentLocalVersion)]
    pub fn content_local_version(&self) -> Result<u32, wasm_bindgen::JsError> {
        let version = self
            .conflict
            .content()
            .map(|details| details.local_version)
            .ok_or_else(|| {
                wasm_bindgen::JsError::new("Sync conflict is not a content conflict.")
            })?;
        u32::try_from(version)
            .map_err(|_| wasm_bindgen::JsError::new("Local vault version exceeds the web limit."))
    }

    #[wasm_bindgen(js_name = contentRemoteVersion)]
    pub fn content_remote_version(&self) -> Result<u32, wasm_bindgen::JsError> {
        let version = self
            .conflict
            .content()
            .map(|details| details.remote_version)
            .ok_or_else(|| {
                wasm_bindgen::JsError::new("Sync conflict is not a content conflict.")
            })?;
        u32::try_from(version)
            .map_err(|_| wasm_bindgen::JsError::new("Remote vault version exceeds the web limit."))
    }

    #[wasm_bindgen(js_name = localStoreId)]
    pub fn local_store_id(&self) -> Result<String, wasm_bindgen::JsError> {
        self.conflict
            .store_id()
            .map(|details| details.local_store_id.clone())
            .ok_or_else(|| wasm_bindgen::JsError::new("Sync conflict is not a store-id conflict."))
    }

    #[wasm_bindgen(js_name = remoteStoreId)]
    pub fn remote_store_id(&self) -> Result<String, wasm_bindgen::JsError> {
        self.conflict
            .store_id()
            .map(|details| details.remote_store_id.clone())
            .ok_or_else(|| wasm_bindgen::JsError::new("Sync conflict is not a store-id conflict."))
    }
}

#[cfg(test)]
mod pending_sync_conflict_tests {
    use super::*;

    #[test]
    fn pending_store_id_factory_marks_unsaved_provider() {
        let conflict = NookPendingSyncConflict::pending_store_id(
            "GitHub".to_owned(),
            "local".to_owned(),
            String::new(),
            "github".to_owned(),
            "token".to_owned(),
            "owner/repo".to_owned(),
            None,
            "store_local12345".to_owned(),
            "store_remote1234".to_owned(),
        );

        assert!(conflict.is_pending_provider());
        assert_eq!(conflict.provider_label(), "GitHub");
        assert_eq!(
            conflict.local_store_id().expect("local store id"),
            "store_local12345"
        );
        assert_eq!(
            conflict.remote_store_id().expect("remote store id"),
            "store_remote1234"
        );
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookReplacementCandidate {
    event_id: String,
    secret_id: String,
}

#[wasm_bindgen]
impl NookReplacementCandidate {
    #[wasm_bindgen(getter, js_name = eventId)]
    pub fn event_id(&self) -> String {
        self.event_id.clone()
    }

    #[wasm_bindgen(getter, js_name = secretId)]
    pub fn secret_id(&self) -> String {
        self.secret_id.clone()
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookReplacementConflict {
    old_secret_id: String,
    candidates: Vec<NookReplacementCandidate>,
}

#[wasm_bindgen]
impl NookReplacementConflict {
    #[wasm_bindgen(getter, js_name = oldSecretId)]
    pub fn old_secret_id(&self) -> String {
        self.old_secret_id.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn candidates(&self) -> Vec<NookReplacementCandidate> {
        self.candidates.clone()
    }
}

pub(crate) fn replacement_conflicts_to_vec(
    conflicts: std::collections::BTreeMap<
        nook_core::SecretId,
        nook_core::SecretReplacementConflict,
    >,
) -> Result<Vec<NookReplacementConflict>, NookError> {
    conflicts
        .into_values()
        .map(|conflict| {
            Ok(NookReplacementConflict {
                old_secret_id: conflict.old_secret_id.as_str().to_owned(),
                candidates: conflict
                    .candidates
                    .into_iter()
                    .map(|(event_id, secret_id)| NookReplacementCandidate {
                        event_id: event_id.as_str().to_owned(),
                        secret_id: secret_id.as_str().to_owned(),
                    })
                    .collect(),
            })
        })
        .collect()
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookSecurityConflict {
    events: Vec<String>,
    reasons: Vec<String>,
}

#[wasm_bindgen]
impl NookSecurityConflict {
    #[wasm_bindgen(getter)]
    pub fn events(&self) -> Vec<String> {
        self.events.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn reasons(&self) -> Vec<String> {
        self.reasons.clone()
    }
}

pub(crate) fn security_conflicts_to_vec(
    conflicts: Vec<nook_core::SecurityConflict>,
) -> Result<Vec<NookSecurityConflict>, NookError> {
    conflicts
        .into_iter()
        .map(|conflict| {
            Ok(NookSecurityConflict {
                events: conflict
                    .events
                    .into_iter()
                    .map(|event| event.as_str().to_owned())
                    .collect(),
                reasons: conflict
                    .reasons
                    .into_iter()
                    .map(|reason| reason.as_str().to_owned())
                    .collect(),
            })
        })
        .collect()
}

#[wasm_bindgen]
#[derive(Clone, Copy)]
pub struct NookVaultSecurityRecommendations {
    needs_sync_provider: bool,
    needs_another_device: bool,
    has_recommendations: bool,
}

#[wasm_bindgen]
impl NookVaultSecurityRecommendations {
    #[wasm_bindgen(getter, js_name = needsSyncProvider)]
    pub fn needs_sync_provider(&self) -> bool {
        self.needs_sync_provider
    }

    #[wasm_bindgen(getter, js_name = needsAnotherDevice)]
    pub fn needs_another_device(&self) -> bool {
        self.needs_another_device
    }

    #[wasm_bindgen(getter, js_name = hasRecommendations)]
    pub fn has_recommendations(&self) -> bool {
        self.has_recommendations
    }

    pub(crate) fn from_core(recommendations: nook_core::VaultSecurityRecommendations) -> Self {
        Self {
            needs_sync_provider: recommendations.needs_sync_provider,
            needs_another_device: recommendations.needs_another_device,
            has_recommendations: recommendations.has_recommendations(),
        }
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookVaultAccessReport {
    device_id: String,
    auth_id: String,
    key_status: String,
    key_explanation: String,
    current_epoch: Option<String>,
    auth_key_ids: Vec<String>,
    epoch_history: Vec<NookVaultEpochHistoryDiagnostic>,
    secrets: Vec<NookVaultSecretAccessDiagnostic>,
    events: Vec<NookVaultEventAccessDiagnostic>,
    warnings: Vec<String>,
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookVaultEpochHistoryDiagnostic {
    epoch_id: String,
    started_by: String,
    reason: String,
}

#[wasm_bindgen]
impl NookVaultEpochHistoryDiagnostic {
    #[wasm_bindgen(getter, js_name = epochId)]
    pub fn epoch_id(&self) -> String {
        self.epoch_id.clone()
    }

    #[wasm_bindgen(getter, js_name = startedBy)]
    pub fn started_by(&self) -> String {
        self.started_by.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn reason(&self) -> String {
        self.reason.clone()
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookVaultSecretAccessDiagnostic {
    secret_id: String,
    secret_type: String,
    status: String,
    epoch_status: String,
    epoch_id: Option<String>,
    explanation: String,
}

#[wasm_bindgen]
impl NookVaultSecretAccessDiagnostic {
    #[wasm_bindgen(getter, js_name = secretId)]
    pub fn secret_id(&self) -> String {
        self.secret_id.clone()
    }

    #[wasm_bindgen(getter, js_name = secretType)]
    pub fn secret_type(&self) -> String {
        self.secret_type.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn status(&self) -> String {
        self.status.clone()
    }

    #[wasm_bindgen(getter, js_name = epochStatus)]
    pub fn epoch_status(&self) -> String {
        self.epoch_status.clone()
    }

    #[wasm_bindgen(getter, js_name = epochId)]
    pub fn epoch_id(&self) -> Option<String> {
        self.epoch_id.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn explanation(&self) -> String {
        self.explanation.clone()
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct NookVaultEventAccessDiagnostic {
    event_id: String,
    key_epoch: String,
    epoch_status: String,
    encrypted_payloads: u32,
    explanation: String,
}

#[wasm_bindgen]
impl NookVaultEventAccessDiagnostic {
    #[wasm_bindgen(getter, js_name = eventId)]
    pub fn event_id(&self) -> String {
        self.event_id.clone()
    }

    #[wasm_bindgen(getter, js_name = keyEpoch)]
    pub fn key_epoch(&self) -> String {
        self.key_epoch.clone()
    }

    #[wasm_bindgen(getter, js_name = epochStatus)]
    pub fn epoch_status(&self) -> String {
        self.epoch_status.clone()
    }

    #[wasm_bindgen(getter, js_name = encryptedPayloads)]
    pub fn encrypted_payloads(&self) -> u32 {
        self.encrypted_payloads
    }

    #[wasm_bindgen(getter)]
    pub fn explanation(&self) -> String {
        self.explanation.clone()
    }
}

#[wasm_bindgen]
impl NookVaultAccessReport {
    #[wasm_bindgen(getter, js_name = deviceId)]
    pub fn device_id(&self) -> String {
        self.device_id.clone()
    }

    #[wasm_bindgen(getter, js_name = authId)]
    pub fn auth_id(&self) -> String {
        self.auth_id.clone()
    }

    #[wasm_bindgen(getter, js_name = keyStatus)]
    pub fn key_status(&self) -> String {
        self.key_status.clone()
    }

    #[wasm_bindgen(getter, js_name = keyExplanation)]
    pub fn key_explanation(&self) -> String {
        self.key_explanation.clone()
    }

    #[wasm_bindgen(getter, js_name = currentEpoch)]
    pub fn current_epoch(&self) -> Option<String> {
        self.current_epoch.clone()
    }

    #[wasm_bindgen(getter, js_name = authKeyIds)]
    pub fn auth_key_ids(&self) -> Vec<String> {
        self.auth_key_ids.clone()
    }

    #[wasm_bindgen(getter, js_name = epochHistory)]
    pub fn epoch_history(&self) -> Vec<NookVaultEpochHistoryDiagnostic> {
        self.epoch_history.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn secrets(&self) -> Vec<NookVaultSecretAccessDiagnostic> {
        self.secrets.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn events(&self) -> Vec<NookVaultEventAccessDiagnostic> {
        self.events.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn warnings(&self) -> Vec<String> {
        self.warnings.clone()
    }

    pub(crate) fn from_core(
        report: nook_core::VaultAccessDiagnosticsReport,
    ) -> Result<Self, NookError> {
        Ok(Self {
            device_id: report.key_access.device_id.as_str().to_owned(),
            auth_id: report.key_access.auth_id.as_str().to_owned(),
            key_status: report.key_access.status.as_str().to_owned(),
            key_explanation: report.key_access.explanation,
            current_epoch: report.current_epoch,
            auth_key_ids: report
                .auth_key_ids
                .into_iter()
                .map(|auth_id| auth_id.as_str().to_owned())
                .collect(),
            epoch_history: report
                .epoch_history
                .into_iter()
                .map(|entry| NookVaultEpochHistoryDiagnostic {
                    epoch_id: entry.epoch_id,
                    started_by: entry.started_by,
                    reason: entry.reason,
                })
                .collect(),
            secrets: report
                .secrets
                .into_iter()
                .map(|entry| NookVaultSecretAccessDiagnostic {
                    secret_id: entry.secret_id.as_str().to_owned(),
                    secret_type: entry.secret_type.as_str().to_owned(),
                    status: entry.status.as_str().to_owned(),
                    epoch_status: entry.epoch_status.as_str().to_owned(),
                    epoch_id: entry.epoch_id,
                    explanation: entry.explanation,
                })
                .collect(),
            events: report
                .events
                .into_iter()
                .map(|entry| NookVaultEventAccessDiagnostic {
                    event_id: entry.event_id,
                    key_epoch: entry.key_epoch,
                    epoch_status: entry.epoch_status.as_str().to_owned(),
                    encrypted_payloads: u32::try_from(entry.encrypted_payloads).unwrap_or(u32::MAX),
                    explanation: entry.explanation,
                })
                .collect(),
            warnings: report.warnings,
        })
    }
}

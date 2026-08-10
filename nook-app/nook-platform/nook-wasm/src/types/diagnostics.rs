use super::{NookError, wasm_bindgen};

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
    current_epoch: nook_core::DiagnosticEpoch,
    auth_key_ids: Vec<String>,
    epoch_history: Vec<NookVaultEpochHistoryDiagnostic>,
    secrets: Vec<NookVaultSecretAccessDiagnostic>,
    events: Vec<NookVaultEventAccessDiagnostic>,
    warnings: Vec<String>,
}

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NookDiagnosticEpochState {
    Unknown,
    Known,
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
    secret_type: nook_core::SecretType,
    status: String,
    epoch_status: String,
    epoch: nook_core::DiagnosticEpoch,
    explanation: String,
}

#[wasm_bindgen]
impl NookVaultSecretAccessDiagnostic {
    #[wasm_bindgen(getter, js_name = secretId)]
    pub fn secret_id(&self) -> String {
        self.secret_id.clone()
    }

    #[wasm_bindgen(getter, js_name = secretType)]
    pub fn secret_type(&self) -> nook_core::SecretType {
        self.secret_type
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
    pub fn epoch_id(&self) -> Result<String, wasm_bindgen::JsError> {
        diagnostic_epoch_id(&self.epoch)
    }

    #[wasm_bindgen(getter, js_name = epochState)]
    pub fn epoch_state(&self) -> NookDiagnosticEpochState {
        diagnostic_epoch_state(&self.epoch)
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
    pub fn current_epoch(&self) -> Result<String, wasm_bindgen::JsError> {
        diagnostic_epoch_id(&self.current_epoch)
    }

    #[wasm_bindgen(getter, js_name = currentEpochState)]
    pub fn current_epoch_state(&self) -> NookDiagnosticEpochState {
        diagnostic_epoch_state(&self.current_epoch)
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
                    secret_type: entry.secret_type,
                    status: entry.status.as_str().to_owned(),
                    epoch_status: entry.epoch_status.as_str().to_owned(),
                    epoch: entry.epoch,
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

fn diagnostic_epoch_state(epoch: &nook_core::DiagnosticEpoch) -> NookDiagnosticEpochState {
    match epoch {
        nook_core::DiagnosticEpoch::Unknown => NookDiagnosticEpochState::Unknown,
        nook_core::DiagnosticEpoch::Known(_) => NookDiagnosticEpochState::Known,
    }
}

fn diagnostic_epoch_id(
    epoch: &nook_core::DiagnosticEpoch,
) -> Result<String, wasm_bindgen::JsError> {
    match epoch {
        nook_core::DiagnosticEpoch::Unknown => {
            Err(wasm_bindgen::JsError::new("diagnostic epoch is unknown"))
        }
        nook_core::DiagnosticEpoch::Known(epoch_id) => Ok(epoch_id.clone()),
    }
}

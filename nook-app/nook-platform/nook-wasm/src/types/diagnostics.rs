use super::{NookError, wasm_bindgen};
use nook_core::DiagnosticEpoch;
use wasm_bindgen::JsError;

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
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the encrypted-payload count as a JavaScript Number scalar"
        )
    )]
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
                    encrypted_payloads: u32::try_from(usize::from(entry.encrypted_payloads))
                        .unwrap_or(u32::MAX),
                    explanation: entry.explanation,
                })
                .collect(),
            warnings: report.warnings,
        })
    }
}

fn diagnostic_epoch_state(epoch: &nook_core::DiagnosticEpoch) -> NookDiagnosticEpochState {
    match epoch {
        DiagnosticEpoch::Unknown => NookDiagnosticEpochState::Unknown,
        DiagnosticEpoch::Known(_) => NookDiagnosticEpochState::Known,
    }
}

fn diagnostic_epoch_id(
    epoch: &nook_core::DiagnosticEpoch,
) -> Result<String, wasm_bindgen::JsError> {
    match epoch {
        DiagnosticEpoch::Unknown => Err(JsError::new("diagnostic epoch is unknown")),
        DiagnosticEpoch::Known(epoch_id) => Ok(epoch_id.clone()),
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use super::*;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    fn diagnostic_projection_getters_cover_known_and_unknown_epochs() {
        let recommendations =
            NookVaultSecurityRecommendations::from_core(nook_core::VaultSecurityRecommendations {
                needs_sync_provider: true,
                needs_another_device: false,
            });
        assert!(recommendations.needs_sync_provider());
        assert!(!recommendations.needs_another_device());
        assert!(recommendations.has_recommendations());

        let history = NookVaultEpochHistoryDiagnostic {
            epoch_id: "epoch-1".into(),
            started_by: "device-1".into(),
            reason: "rotation".into(),
        };
        assert_eq!(history.epoch_id(), "epoch-1");
        assert_eq!(history.started_by(), "device-1");
        assert_eq!(history.reason(), "rotation");

        let secret_unknown = NookVaultSecretAccessDiagnostic {
            secret_id: "secret-1".into(),
            secret_type: nook_core::SecretType::Login,
            status: "blocked".into(),
            epoch_status: "unknown".into(),
            epoch: DiagnosticEpoch::Unknown,
            explanation: "missing epoch".into(),
        };
        assert_eq!(secret_unknown.secret_id(), "secret-1");
        assert_eq!(secret_unknown.secret_type(), nook_core::SecretType::Login);
        assert_eq!(secret_unknown.status(), "blocked");
        assert_eq!(secret_unknown.epoch_status(), "unknown");
        assert_eq!(
            secret_unknown.epoch_state(),
            NookDiagnosticEpochState::Unknown
        );
        assert!(secret_unknown.epoch_id().is_err());
        assert_eq!(secret_unknown.explanation(), "missing epoch");

        let secret_known = NookVaultSecretAccessDiagnostic {
            epoch: DiagnosticEpoch::Known("epoch-2".into()),
            ..secret_unknown
        };
        assert_eq!(secret_known.epoch_state(), NookDiagnosticEpochState::Known);
        assert_eq!(secret_known.epoch_id().unwrap(), "epoch-2");

        let event = NookVaultEventAccessDiagnostic {
            event_id: "event-1".into(),
            key_epoch: "epoch-2".into(),
            epoch_status: "current".into(),
            encrypted_payloads: 3,
            explanation: "available".into(),
        };
        assert_eq!(event.event_id(), "event-1");
        assert_eq!(event.key_epoch(), "epoch-2");
        assert_eq!(event.epoch_status(), "current");
        assert_eq!(event.encrypted_payloads(), 3);
        assert_eq!(event.explanation(), "available");

        let report = NookVaultAccessReport {
            device_id: "device-1".into(),
            auth_id: "auth-1".into(),
            key_status: "ready".into(),
            key_explanation: "authorized".into(),
            current_epoch: DiagnosticEpoch::Known("epoch-2".into()),
            auth_key_ids: vec!["auth-1".into()],
            epoch_history: vec![history],
            secrets: vec![secret_known],
            events: vec![event],
            warnings: vec!["warning".into()],
        };
        assert_eq!(report.device_id(), "device-1");
        assert_eq!(report.auth_id(), "auth-1");
        assert_eq!(report.key_status(), "ready");
        assert_eq!(report.key_explanation(), "authorized");
        assert_eq!(report.current_epoch().unwrap(), "epoch-2");
        assert_eq!(
            report.current_epoch_state(),
            NookDiagnosticEpochState::Known
        );
        assert_eq!(report.auth_key_ids(), vec!["auth-1"]);
        assert_eq!(report.epoch_history().len(), 1);
        assert_eq!(report.secrets().len(), 1);
        assert_eq!(report.events().len(), 1);
        assert_eq!(report.warnings(), vec!["warning"]);
    }
}

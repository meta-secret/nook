use super::{NookError, wasm_bindgen};

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
        let nook_core::VaultSyncConflict::Content(details) = &self.conflict else {
            return Err(wasm_bindgen::JsError::new(
                "Sync conflict is not a content conflict.",
            ));
        };
        let version = details.local_version;
        u32::try_from(version)
            .map_err(|_| wasm_bindgen::JsError::new("Local vault version exceeds the web limit."))
    }

    #[wasm_bindgen(js_name = contentRemoteVersion)]
    pub fn content_remote_version(&self) -> Result<u32, wasm_bindgen::JsError> {
        let nook_core::VaultSyncConflict::Content(details) = &self.conflict else {
            return Err(wasm_bindgen::JsError::new(
                "Sync conflict is not a content conflict.",
            ));
        };
        let version = details.remote_version;
        u32::try_from(version)
            .map_err(|_| wasm_bindgen::JsError::new("Remote vault version exceeds the web limit."))
    }

    #[wasm_bindgen(js_name = localStoreId)]
    pub fn local_store_id(&self) -> Result<String, wasm_bindgen::JsError> {
        match &self.conflict {
            nook_core::VaultSyncConflict::StoreId(details) => Ok(details.local_store_id.clone()),
            nook_core::VaultSyncConflict::Content(_) => Err(wasm_bindgen::JsError::new(
                "Sync conflict is not a store-id conflict.",
            )),
        }
    }

    #[wasm_bindgen(js_name = remoteStoreId)]
    pub fn remote_store_id(&self) -> Result<String, wasm_bindgen::JsError> {
        match &self.conflict {
            nook_core::VaultSyncConflict::StoreId(details) => Ok(details.remote_store_id.clone()),
            nook_core::VaultSyncConflict::Content(_) => Err(wasm_bindgen::JsError::new(
                "Sync conflict is not a store-id conflict.",
            )),
        }
    }
}

#[cfg(test)]
mod pending_sync_conflict_tests {
    use super::*;

    #[test]
    fn pending_store_id_factory_marks_unsaved_provider() -> Result<(), wasm_bindgen::JsError> {
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
        assert_eq!(conflict.local_store_id()?, "store_local12345");
        assert_eq!(conflict.remote_store_id()?, "store_remote1234");
        Ok(())
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
    secret_type: String,
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
                    secret_type: entry.secret_type.as_str().to_owned(),
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

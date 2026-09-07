use super::{NookEventLogRecords, NookExternalEventLogRecords, NookVaultManager, VaultNameState};
use nook_companion_core::{
    AuthorizedCompanionPairingApproval, CompanionExtensionPairingEndpoint,
    CompanionPairingAcknowledgement, CompanionPairingApproval, CompanionPairingApprovalAttempt,
    CompanionPairingFailure, CompanionPairingFinalization, CompanionPairingFinalizationEvidence,
    CompanionPairingFinalizationOutcome, CompanionPairingInstallation, CompanionPairingIssue,
    CompanionPairingProviderManifestDigest, CompanionPairingRequest,
    CompanionPairingRequestObservation, CompanionPairingWebsiteAuthorization,
    CompanionWebsitePairingEndpoint, ConsumedCompanionPairingAuthority, ExtensionConnectScope,
    ExtensionEventCount, ExtensionSyncProviderCount, ImportedExtensionEventLog,
};
use nook_core::{
    ActiveVaultScope, AuthProvidersSnapshotData, DeviceIdentity, DevicePublicKey, ProviderRows,
    SigningIdentity, VaultApplication,
};
use std::mem;
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

#[derive(Debug, thiserror::Error)]
enum CompanionPairingOperationError {
    #[error(transparent)]
    Protocol(#[from] nook_companion_core::CompanionPairingError),
    #[error("Companion pairing requires the extension application capability.")]
    ExtensionCapabilityRequired,
    #[error("Companion pairing authorization does not match the active vault.")]
    ActiveVaultMismatch,
    #[error("Companion pairing effect did not complete.")]
    EffectFailed,
}

impl CompanionPairingOperationError {
    fn js_error(&self) -> JsError {
        JsError::new(&self.to_string())
    }
}

#[wasm_bindgen]
pub struct NookCompanionPairingWebsiteEndpoint {
    inner: CompanionWebsitePairingEndpoint,
}

#[wasm_bindgen]
impl NookCompanionPairingWebsiteEndpoint {
    #[wasm_bindgen(constructor)]
    #[allow(clippy::needless_pass_by_value)]
    pub fn new(observation: CompanionPairingRequestObservation) -> Result<Self, JsError> {
        Ok(Self {
            inner: CompanionWebsitePairingEndpoint::admit(observation)
                .map_err(|error| JsError::new(&error.to_string()))?,
        })
    }

    pub fn request(&self) -> Result<CompanionPairingRequest, JsError> {
        self.inner
            .request()
            .map_err(|error| JsError::new(&error.to_string()))
    }

    #[allow(clippy::needless_pass_by_value)]
    pub async fn authorize_and_approve(
        &mut self,
        manager: &mut NookVaultManager,
        authorization: CompanionPairingWebsiteAuthorization,
    ) -> Result<NookCompanionPairingApprovalBundle, JsError> {
        let authorized = self
            .inner
            .authorize(authorization)
            .map_err(|error| JsError::new(&error.to_string()))?;
        NookCompanionPairingApprovalBundle::produce(WebsitePairingProduction {
            manager,
            authorized,
        })
        .await
        .map_err(|error| error.js_error())
    }
}

#[wasm_bindgen]
pub struct NookCompanionPairingApprovalBundle {
    approval: CompanionPairingApproval,
    providers: AuthProvidersSnapshotData,
    event_log_records: NookEventLogRecords,
}

impl NookCompanionPairingApprovalBundle {
    async fn produce(
        production: WebsitePairingProduction<'_>,
    ) -> Result<Self, CompanionPairingOperationError> {
        let WebsitePairingProduction {
            manager,
            authorized,
        } = production;
        let request = authorized.request().clone();
        manager
            .application
            .validate_extension_approval(manager.vault.architecture.vault_type)
            .map_err(|_| CompanionPairingOperationError::ActiveVaultMismatch)?;
        let vault_name = match &manager.vault.vault_name {
            VaultNameState::Named(name) => name,
            VaultNameState::Unnamed => {
                return Err(CompanionPairingOperationError::ActiveVaultMismatch);
            }
        };
        if manager.vault.store_id != authorized.vault_store_id()
            || vault_name != authorized.vault_name()
        {
            return Err(CompanionPairingOperationError::ActiveVaultMismatch);
        }
        manager
            .approve_extension_device(
                request.installation.app_id.clone(),
                request.installation.encryption_public_key.clone(),
                request.installation.signing_public_key.clone(),
                request.installation.installation_label.clone(),
            )
            .await
            .map_err(|_| CompanionPairingOperationError::ActiveVaultMismatch)?;
        let providers = Self::providers(WebsitePairingProviderRequest {
            manager,
            request: &request,
        })
        .await?;
        let provider_manifest_digest = CompanionPairingProviderManifestDigest::parse(
            providers
                .companion_pairing_manifest_digest()
                .map_err(|_| CompanionPairingOperationError::EffectFailed)?
                .as_str(),
        )?;
        let event_log_records = NookEventLogRecords(
            manager
                .export_event_log_records()
                .await
                .map_err(|_| CompanionPairingOperationError::EffectFailed)?,
        );
        Ok(Self {
            approval: authorized.approve(provider_manifest_digest),
            providers,
            event_log_records,
        })
    }

    async fn providers(
        request: WebsitePairingProviderRequest<'_>,
    ) -> Result<AuthProvidersSnapshotData, CompanionPairingOperationError> {
        let WebsitePairingProviderRequest { manager, request } = request;
        let store_id = manager.vault.store_id.clone();
        let mut snapshot = AuthProvidersSnapshotData {
            providers: Vec::new(),
            active_vault_store_id: ActiveVaultScope::StoreId(store_id.clone()),
        };
        if request
            .scopes
            .contains(&ExtensionConnectScope::SyncProviderCredentials)
        {
            let loaded = manager
                .load_auth_providers_snapshot()
                .await
                .map_err(|_| CompanionPairingOperationError::EffectFailed)?;
            snapshot.providers = ProviderRows {
                providers: &loaded.providers,
            }
            .for_vault(Some(&store_id))
            .active();
            let public_key = DevicePublicKey::parse(&request.installation.encryption_public_key)
                .map_err(|_| CompanionPairingOperationError::EffectFailed)?;
            snapshot
                .seal_credentials_for(&public_key)
                .map_err(|_| CompanionPairingOperationError::EffectFailed)?;
        }
        Ok(snapshot)
    }
}

struct WebsitePairingProduction<'a> {
    manager: &'a mut NookVaultManager,
    authorized: nook_companion_core::AuthorizedCompanionWebsitePairing,
}

struct WebsitePairingProviderRequest<'a> {
    manager: &'a NookVaultManager,
    request: &'a CompanionPairingRequest,
}

#[wasm_bindgen]
impl NookCompanionPairingApprovalBundle {
    pub fn approval(&self) -> CompanionPairingApproval {
        self.approval.clone()
    }

    pub fn take_providers(&mut self) -> AuthProvidersSnapshotData {
        mem::take(&mut self.providers)
    }

    pub fn take_event_log_records(&mut self) -> NookEventLogRecords {
        NookEventLogRecords(mem::take(&mut self.event_log_records.0))
    }
}

#[wasm_bindgen]
pub struct NookCompanionPairingExtensionEndpoint {
    inner: CompanionExtensionPairingEndpoint,
}

#[wasm_bindgen]
pub struct NookCompanionPairingApprovalAuthority {
    inner: ConsumedCompanionPairingAuthority,
}

impl NookCompanionPairingExtensionEndpoint {
    fn bind_issue(
        binding: CompanionPairingIssueBinding,
    ) -> Result<Self, CompanionPairingOperationError> {
        let CompanionPairingIssueBinding {
            issue,
            identity,
            signing,
        } = binding;
        let installation = CompanionPairingInstallation {
            extension_runtime_id: String::new(),
            app_id: identity.device_id().as_str().to_owned(),
            encryption_public_key: identity.public_key().as_str().to_owned(),
            signing_public_key: signing.public_key().as_str().to_owned(),
            installation_label: String::new(),
        };
        Self::from_request(issue.bind(installation))
    }

    fn from_request(
        request: CompanionPairingRequest,
    ) -> Result<Self, CompanionPairingOperationError> {
        Ok(Self {
            inner: CompanionExtensionPairingEndpoint::issue(request)?,
        })
    }

    async fn finalize_authorized(
        operation: ExtensionPairingFinalizationOperation<'_>,
    ) -> CompanionPairingFinalizationOutcome {
        match Self::apply_effects(operation).await {
            Ok(finalization) => CompanionPairingFinalizationOutcome::Accepted {
                finalization: Box::new(finalization),
            },
            Err(acknowledgement) => {
                CompanionPairingFinalizationOutcome::Rejected { acknowledgement }
            }
        }
    }

    async fn apply_effects(
        operation: ExtensionPairingFinalizationOperation<'_>,
    ) -> Result<CompanionPairingFinalization, CompanionPairingAcknowledgement> {
        let ExtensionPairingFinalizationOperation {
            manager,
            authorized,
            records,
            providers,
            observed_at,
        } = operation;
        let approval = authorized.approval().clone();
        if manager.application != VaultApplication::Extension {
            return Err(authorized.reject(CompanionPairingFailure::InstallationMismatch));
        }
        let identity = match manager.ensure_device_identity() {
            Ok(identity) => identity,
            Err(_) => {
                return Err(authorized.reject(CompanionPairingFailure::InstallationMismatch));
            }
        };
        let signing = match SigningIdentity::from_seed_hex_stored(&manager.event_log.signing_seed) {
            Ok(signing) => signing,
            Err(_) => {
                return Err(authorized.reject(CompanionPairingFailure::InstallationMismatch));
            }
        };
        if identity.device_id().as_str() != approval.request.installation.app_id
            || identity.public_key().as_str() != approval.request.installation.encryption_public_key
            || signing.public_key().as_str() != approval.request.installation.signing_public_key
        {
            return Err(authorized.reject(CompanionPairingFailure::InstallationMismatch));
        }
        if providers.active_vault_store_id.as_deref() != Some(approval.vault_store_id.as_str())
            || providers.providers.iter().any(|provider| {
                provider.store_id.as_deref() != Some(approval.vault_store_id.as_str())
            })
            || (!approval
                .request
                .scopes
                .contains(&ExtensionConnectScope::SyncProviderCredentials)
                && !providers.providers.is_empty())
        {
            return Err(authorized.reject(CompanionPairingFailure::ScopeMismatch));
        }
        let manifest = match providers.companion_pairing_manifest_digest() {
            Ok(manifest) => manifest,
            Err(_) => {
                return Err(authorized.reject(CompanionPairingFailure::ProviderManifestMismatch));
            }
        };
        if manifest.as_str() != approval.provider_manifest_digest.as_str() {
            return Err(authorized.reject(CompanionPairingFailure::ProviderManifestMismatch));
        }
        if providers.authenticate_credentials_for(&identity).is_err() {
            return Err(authorized.reject(CompanionPairingFailure::ProviderRecipientMismatch));
        }
        let provider_count = match u32::try_from(providers.providers.len()) {
            Ok(count) => ExtensionSyncProviderCount::from(count),
            Err(_) => return Err(authorized.reject(CompanionPairingFailure::EffectFailed)),
        };
        let imported = match manager
            .import_extension_event_log_records(
                &approval.vault_store_id,
                &approval.request.installation.app_id,
                &approval.request.installation.encryption_public_key,
                &approval.request.installation.signing_public_key,
                records.0,
            )
            .await
        {
            Ok(imported) => imported,
            Err(_) => return Err(authorized.reject(CompanionPairingFailure::EffectFailed)),
        };
        if !imported.access_granted {
            return Err(authorized.reject(CompanionPairingFailure::EventLogAccessDenied));
        }
        if manager
            .save_presealed_auth_providers_snapshot(
                &approval.request.installation.app_id,
                providers,
            )
            .await
            .is_err()
        {
            return Err(authorized.reject(CompanionPairingFailure::EffectFailed));
        }
        let event_count = match u32::try_from(imported.event_count) {
            Ok(count) => ExtensionEventCount::from(count),
            Err(_) => return Err(authorized.reject(CompanionPairingFailure::EffectFailed)),
        };
        let finalization = authorized.finalize(CompanionPairingFinalizationEvidence {
            imported: ImportedExtensionEventLog {
                vault_store_id: imported.vault_store_id,
                event_count,
                heads: imported.heads,
                access_granted: imported.access_granted,
            },
            sync_provider_count: provider_count,
            observed_at,
        })?;
        if crate::storage::extension_state::write_all(&finalization.pairing_state)
            .await
            .is_err()
        {
            return Err(finalization.effect_failed());
        }
        Ok(finalization)
    }
}

struct CompanionPairingIssueBinding {
    issue: CompanionPairingIssue,
    identity: DeviceIdentity,
    signing: SigningIdentity,
}

struct ExtensionPairingFinalizationOperation<'a> {
    manager: &'a mut NookVaultManager,
    authorized: AuthorizedCompanionPairingApproval,
    records: NookExternalEventLogRecords,
    providers: AuthProvidersSnapshotData,
    observed_at: String,
}

#[wasm_bindgen]
impl NookCompanionPairingExtensionEndpoint {
    pub fn request(&self) -> Result<CompanionPairingRequest, JsError> {
        self.inner
            .request()
            .map_err(|error| JsError::new(&error.to_string()))
    }

    pub fn take_authority(&mut self) -> Result<NookCompanionPairingApprovalAuthority, JsError> {
        Ok(NookCompanionPairingApprovalAuthority {
            inner: self
                .inner
                .take_authority()
                .map_err(|error| JsError::new(&error.to_string()))?,
        })
    }
}

#[wasm_bindgen]
impl NookCompanionPairingApprovalAuthority {
    #[allow(clippy::needless_pass_by_value)]
    pub async fn finalize(
        self,
        manager: &mut NookVaultManager,
        attempt: CompanionPairingApprovalAttempt,
        records: NookExternalEventLogRecords,
        providers: AuthProvidersSnapshotData,
        observed_at: String,
    ) -> CompanionPairingFinalizationOutcome {
        let authorized = match self.inner.authorize_approval(attempt) {
            Ok(authorized) => authorized,
            Err(acknowledgement) => {
                return CompanionPairingFinalizationOutcome::Rejected { acknowledgement };
            }
        };
        Self::finalize_authorized(ExtensionPairingFinalizationOperation {
            manager,
            authorized,
            records,
            providers,
            observed_at,
        })
        .await
    }
}

#[wasm_bindgen]
impl NookVaultManager {
    #[allow(clippy::needless_pass_by_value)]
    pub async fn issue_companion_pairing(
        &mut self,
        issue: CompanionPairingIssue,
    ) -> Result<NookCompanionPairingExtensionEndpoint, JsError> {
        if self.application != VaultApplication::Extension {
            return Err(CompanionPairingOperationError::ExtensionCapabilityRequired.js_error());
        }
        issue
            .validate()
            .map_err(|error| JsError::new(&error.to_string()))?;
        let identity = self
            .ensure_device_identity()
            .map_err(|error| JsError::new(&error.to_string()))?;
        let signing = self
            .ensure_signing_identity()
            .await
            .map_err(|error| JsError::new(&error.to_string()))?;
        NookCompanionPairingExtensionEndpoint::bind_issue(CompanionPairingIssueBinding {
            issue,
            identity,
            signing,
        })
        .map_err(|error| error.js_error())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nook_companion_core::{CompanionPairingEpochMilliseconds, ExtensionPairingVaultType};

    #[test]
    fn manager_binding_uses_real_installation_keys() -> anyhow::Result<()> {
        let identity = DeviceIdentity::generate()?;
        let (signing, _) = SigningIdentity::generate()?;
        let app_id = identity.device_id().as_str().to_owned();
        let signing_public_key = signing.public_key().as_str().to_owned();
        let issued_at: CompanionPairingEpochMilliseconds = serde_json::from_str("100")?;
        let expires_at: CompanionPairingEpochMilliseconds = serde_json::from_str("200")?;
        let endpoint =
            NookCompanionPairingExtensionEndpoint::bind_issue(CompanionPairingIssueBinding {
                issue: CompanionPairingIssue {
                    request_id: "request-1".to_owned(),
                    nonce: "nonce-1".to_owned(),
                    issued_at,
                    expires_at,
                    vault_type: ExtensionPairingVaultType::Simple,
                    extension_runtime_id: "runtime-1".to_owned(),
                    installation_label: "Nook Extension".to_owned(),
                    scopes: vec![ExtensionConnectScope::VaultAccess],
                },
                identity,
                signing,
            })?;
        let request = endpoint.inner.request()?;
        assert_eq!(request.installation.app_id, app_id);
        assert_eq!(request.installation.signing_public_key, signing_public_key);
        assert_eq!(request.installation.extension_runtime_id, "runtime-1");
        assert_eq!(request.installation.installation_label, "Nook Extension");
        Ok(())
    }
}

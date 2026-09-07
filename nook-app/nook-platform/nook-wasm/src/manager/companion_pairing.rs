use super::{NookVaultManager, VaultNameState};
use nook_companion_core::{
    AdmittedCompanionPairingApproval, CompanionExtensionPairingEndpoint,
    CompanionPairingApprovalAttempt, CompanionPairingFailure, CompanionPairingRequest,
    ConsumedCompanionPairingAuthority, ExtensionConnectScope,
};
use nook_core::{AuthProvidersSnapshotData, SigningIdentity, VaultApplication, VaultType};
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

#[wasm_bindgen]
pub struct NookCompanionPairingExtensionEndpoint {
    inner: CompanionExtensionPairingEndpoint,
}

#[wasm_bindgen]
impl NookCompanionPairingExtensionEndpoint {
    #[wasm_bindgen(constructor)]
    #[allow(clippy::needless_pass_by_value)]
    pub fn new(request: CompanionPairingRequest) -> Result<Self, JsError> {
        Ok(Self {
            inner: CompanionExtensionPairingEndpoint::issue(request)
                .map_err(|error| JsError::new(&error.to_string()))?,
        })
    }

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
pub struct NookCompanionPairingApprovalAuthority {
    inner: ConsumedCompanionPairingAuthority,
}

#[wasm_bindgen]
impl NookCompanionPairingApprovalAuthority {
    /// Side-effect-free admission against identities already present in memory.
    #[allow(clippy::needless_pass_by_value)]
    pub fn prevalidate(
        self,
        manager: &NookVaultManager,
        attempt: CompanionPairingApprovalAttempt,
        providers: AuthProvidersSnapshotData,
    ) -> Result<NookPrevalidatedCompanionPairingApproval, JsError> {
        let authorized = self
            .inner
            .authorize_approval(attempt)
            .map_err(failure_js_error)?;
        let approval = authorized.approval();
        let vault_name = match &manager.vault.vault_name {
            VaultNameState::Named(name) => name,
            VaultNameState::Unnamed => {
                return Err(failure_js_error(CompanionPairingFailure::VaultMismatch));
            }
        };
        if manager.application != VaultApplication::Extension
            || manager.vault.architecture.vault_type != VaultType::Simple
            || manager.vault.store_id != approval.vault_store_id
            || vault_name != &approval.vault_name
        {
            return Err(failure_js_error(CompanionPairingFailure::VaultMismatch));
        }
        let identity = manager
            .device_identity()
            .map_err(|_| failure_js_error(CompanionPairingFailure::InstallationMismatch))?;
        let signing = SigningIdentity::from_seed_hex_stored(&manager.event_log.signing_seed)
            .map_err(|_| failure_js_error(CompanionPairingFailure::InstallationMismatch))?;
        if identity.device_id().as_str() != approval.request.installation.app_id
            || identity.public_key().as_str() != approval.request.installation.encryption_public_key
            || signing.public_key().as_str() != approval.request.installation.signing_public_key
        {
            return Err(failure_js_error(
                CompanionPairingFailure::InstallationMismatch,
            ));
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
            return Err(failure_js_error(CompanionPairingFailure::ScopeMismatch));
        }
        let digest = providers
            .companion_pairing_manifest_digest()
            .map_err(|_| failure_js_error(CompanionPairingFailure::ProviderManifestMismatch))?;
        if digest.as_str() != approval.provider_manifest_digest.as_str() {
            return Err(failure_js_error(
                CompanionPairingFailure::ProviderManifestMismatch,
            ));
        }
        providers
            .authenticate_credentials_for(&identity)
            .map_err(|_| failure_js_error(CompanionPairingFailure::ProviderRecipientMismatch))?;
        Ok(NookPrevalidatedCompanionPairingApproval {
            approval: authorized.admit(),
            providers,
        })
    }
}

fn failure_js_error(failure: CompanionPairingFailure) -> JsError {
    JsError::new(&format!("{failure:?}"))
}

/// Opaque proof of a manager-bound approval and its sealed provider snapshot.
#[wasm_bindgen]
pub struct NookPrevalidatedCompanionPairingApproval {
    #[allow(dead_code)]
    approval: AdmittedCompanionPairingApproval,
    #[allow(dead_code)]
    providers: AuthProvidersSnapshotData,
}

#[cfg(test)]
mod tests {
    use super::*;
    use nook_companion_core::{CompanionPairingEpochMilliseconds, ExtensionPairingVaultType};

    #[test]
    fn endpoint_construction_is_side_effect_free_and_preserves_exact_request() -> anyhow::Result<()>
    {
        let issued_at: CompanionPairingEpochMilliseconds = serde_json::from_str("100")?;
        let expires_at: CompanionPairingEpochMilliseconds = serde_json::from_str("200")?;
        let request = CompanionPairingRequest {
            request_id: "request-1".to_owned(),
            nonce: "nonce-1".to_owned(),
            issued_at,
            expires_at,
            vault_type: ExtensionPairingVaultType::Simple,
            installation: nook_companion_core::CompanionPairingInstallation {
                extension_runtime_id: "runtime-1".to_owned(),
                app_id: "app-1".to_owned(),
                encryption_public_key: "age1extension".to_owned(),
                signing_public_key: "signing-1".to_owned(),
                installation_label: "Extension".to_owned(),
            },
            scopes: vec![ExtensionConnectScope::VaultAccess],
        };
        let endpoint = NookCompanionPairingExtensionEndpoint::new(request.clone())?;
        assert_eq!(endpoint.inner.request()?, request);
        Ok(())
    }
}

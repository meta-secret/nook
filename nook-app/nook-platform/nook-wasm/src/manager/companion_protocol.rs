use super::{NookExtensionIdentityHandoffContext, NookVaultManager};
use crate::NookError;
use nook_companion_core::{
    CompanionExtensionPresence, CompanionExtensionProtocol, CompanionIdentityHandoffContext,
    CompanionIdentityHandoffRequest, CompanionIdentityHandoffResponse,
    CompanionIdentityHandoffSealer, CompanionProtocolError, CompanionWebsiteHandoffBegin,
};
use nook_core::{
    DeviceId, DeviceIdentity, DevicePublicKey, DeviceSigningPublicKey, SigningIdentity,
    VaultApplication,
};
use serde::{Deserialize, Serialize};
use std::mem;
use wasm_bindgen::{JsError, prelude::wasm_bindgen};
use zeroize::{Zeroize, Zeroizing};

#[derive(Debug, thiserror::Error)]
enum CompanionOperationError {
    #[error(transparent)]
    Protocol(#[from] CompanionProtocolError),
    #[error(transparent)]
    Manager(#[from] NookError),
    #[error("{0}")]
    Serialization(#[from] serde_json::Error),
    #[error("Companion app-key handoff is not pending.")]
    HandoffNotPending,
    #[error("Companion handoff request does not match the active extension vault.")]
    ActiveExtensionVaultMismatch,
    #[error("Companion handoff request does not match the unlocked installation app key.")]
    InstallationAppKeyMismatch,
}

fn companion_js_error(error: &CompanionOperationError) -> JsError {
    JsError::new(&error.to_string())
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct PendingCompanionWebsiteHandoff {
    request: CompanionIdentityHandoffRequest,
    context: CompanionIdentityHandoffContext,
    recipient_secret: String,
}

impl PendingCompanionWebsiteHandoff {
    fn encode(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(self)
    }

    fn decode(serialized: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(serialized)
    }

    fn take_recipient_secret(&mut self) -> String {
        mem::take(&mut self.recipient_secret)
    }
}

impl Drop for PendingCompanionWebsiteHandoff {
    fn drop(&mut self) {
        self.recipient_secret.zeroize();
    }
}

#[wasm_bindgen]
pub struct NookCompanionExtensionEndpoint {
    protocol: CompanionExtensionProtocol,
}

impl NookCompanionExtensionEndpoint {
    fn from_presence(
        presence: CompanionExtensionPresence,
    ) -> Result<Self, CompanionOperationError> {
        Ok(Self {
            protocol: CompanionExtensionProtocol::new(presence)?,
        })
    }

    fn authorize_and_seal_loaded(
        &mut self,
        operation: CompanionExtensionSealOperation<'_>,
    ) -> Result<CompanionIdentityHandoffResponse, CompanionOperationError> {
        let authorized = self.protocol.authorize_handoff(operation.request)?;
        // A valid nonce is consumed even if sealing fails: callers must perform
        // fresh discovery rather than replay an authorization after ambiguity.
        authorized.seal(&mut CompanionManagerSealer(operation.manager))
    }
}

struct CompanionExtensionSealOperation<'a> {
    manager: &'a mut NookVaultManager,
    request: CompanionIdentityHandoffRequest,
}

#[wasm_bindgen]
impl NookCompanionExtensionEndpoint {
    #[wasm_bindgen(constructor)]
    #[allow(clippy::needless_pass_by_value)]
    pub fn new(presence: CompanionExtensionPresence) -> Result<Self, JsError> {
        Self::from_presence(presence).map_err(|error| companion_js_error(&error))
    }

    #[allow(clippy::needless_pass_by_value)]
    pub async fn authorize_and_seal(
        &mut self,
        manager: &mut NookVaultManager,
        request: CompanionIdentityHandoffRequest,
    ) -> Result<CompanionIdentityHandoffResponse, JsError> {
        manager
            .ensure_signing_identity()
            .await
            .map_err(|error| companion_js_error(&CompanionOperationError::Manager(error)))?;
        self.authorize_and_seal_loaded(CompanionExtensionSealOperation { manager, request })
            .map_err(|error| companion_js_error(&error))
    }
}

struct CompanionManagerSealer<'a>(&'a mut NookVaultManager);

impl CompanionIdentityHandoffSealer for CompanionManagerSealer<'_> {
    type Error = CompanionOperationError;

    fn seal_companion_handoff(
        &mut self,
        request: &CompanionIdentityHandoffRequest,
    ) -> Result<String, Self::Error> {
        request.validate()?;
        let manager = &mut *self.0;
        if manager.application != VaultApplication::Extension
            || manager.vault.store_id != request.vault_store_id
        {
            return Err(CompanionOperationError::ActiveExtensionVaultMismatch);
        }
        let identity = manager.ensure_device_identity()?;
        let signing = SigningIdentity::from_seed_hex_stored(&manager.event_log.signing_seed)
            .map_err(NookError::from)?;
        let expected = &request.expected_app_key;
        let expected_app_id = DeviceId::parse(&expected.app_id).map_err(NookError::from)?;
        let expected_encryption_key =
            DevicePublicKey::parse(&expected.encryption_public_key).map_err(NookError::from)?;
        let expected_signing_key =
            DeviceSigningPublicKey::parse(&expected.signing_public_key).map_err(NookError::from)?;
        if identity.device_id() != &expected_app_id
            || identity.public_key() != expected_encryption_key
            || signing.public_key() != expected_signing_key
        {
            return Err(CompanionOperationError::InstallationAppKeyMismatch);
        }
        let recipient =
            DevicePublicKey::parse(&request.recipient_public_key).map_err(NookError::from)?;
        Ok(nook_core::ExtensionIdentityHandoffSeal {
            identity: &identity,
            signing_seed: &manager.event_log.signing_seed,
            recipient_public_key: &recipient,
            nonce: &request.nonce,
        }
        .seal()
        .map_err(NookError::from)?
        .into_inner())
    }
}

impl NookVaultManager {
    fn consume_companion_website_handoff(
        &mut self,
        response: &CompanionIdentityHandoffResponse,
    ) -> Result<PendingCompanionWebsiteHandoff, CompanionOperationError> {
        let serialized = Zeroizing::new(mem::take(&mut self.device.extension_handoff_private_key));
        if serialized.is_empty() {
            return Err(CompanionOperationError::HandoffNotPending);
        }
        let pending = PendingCompanionWebsiteHandoff::decode(&serialized)?;
        response.validate()?;
        if pending.request != response.request {
            return Err(CompanionProtocolError::RequestMismatch.into());
        }
        pending
            .context
            .validate_for_store(&pending.request.vault_store_id)?;
        Ok(pending)
    }

    fn begin_companion_identity_handoff_inner(
        &mut self,
        begin: CompanionWebsiteHandoffBegin,
    ) -> Result<CompanionIdentityHandoffRequest, CompanionOperationError> {
        self.device.extension_handoff_private_key.zeroize();
        self.device.extension_handoff_private_key.clear();
        begin.validate()?;
        let recipient = DeviceIdentity::generate().map_err(NookError::from)?;
        let context = begin.context.clone();
        let request = begin.prepare(recipient.public_key().into_inner())?;
        let pending = PendingCompanionWebsiteHandoff {
            request: request.clone(),
            context,
            recipient_secret: recipient.secret_string().into_inner(),
        };
        self.device.extension_handoff_private_key = pending.encode()?;
        Ok(request)
    }
}

#[wasm_bindgen]
impl NookVaultManager {
    #[allow(clippy::needless_pass_by_value)]
    pub fn begin_companion_identity_handoff(
        &mut self,
        begin: CompanionWebsiteHandoffBegin,
    ) -> Result<CompanionIdentityHandoffRequest, JsError> {
        self.begin_companion_identity_handoff_inner(begin)
            .map_err(|error| companion_js_error(&error))
    }

    #[allow(clippy::needless_pass_by_value)]
    pub async fn finish_companion_identity_handoff(
        &mut self,
        response: CompanionIdentityHandoffResponse,
    ) -> Result<(), JsError> {
        let mut pending = self
            .consume_companion_website_handoff(&response)
            .map_err(|error| companion_js_error(&error))?;
        let context = NookExtensionIdentityHandoffContext::from_companion(pending.context.clone())?;
        self.device.extension_handoff_private_key = pending.take_recipient_secret();
        let expected = &pending.request.expected_app_key;
        self.finish_extension_identity_handoff(
            &response.encrypted_envelope,
            &pending.request.nonce,
            &expected.app_id,
            &expected.encryption_public_key,
            &expected.signing_public_key,
            &context,
        )
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nook_companion_core::{
        CompanionEpochMilliseconds, CompanionIdentityDiscoveryObservation,
        CompanionIdentityDiscoveryRequest, CompanionIdentityHandoffContext,
        CompanionIdentityStatus, CompanionInstallationAppKey, CompanionUnlockedAppKey,
        ExtensionConnectScope, ExtensionPairingVaultType,
    };

    fn epoch_milliseconds(
        serialized: &str,
    ) -> Result<CompanionEpochMilliseconds, CompanionOperationError> {
        Ok(serde_json::from_str(serialized)?)
    }

    struct DirectHandoffScenario {
        website: NookVaultManager,
        extension: NookVaultManager,
        endpoint: NookCompanionExtensionEndpoint,
        status: CompanionIdentityStatus,
    }

    impl DirectHandoffScenario {
        fn new() -> Result<Self, CompanionOperationError> {
            let identity = DeviceIdentity::generate().map_err(NookError::from)?;
            let (signing, signing_seed) = SigningIdentity::generate().map_err(NookError::from)?;
            let app_key = CompanionUnlockedAppKey {
                extension_runtime_id: "runtime-1".to_owned(),
                app_key: CompanionInstallationAppKey {
                    app_id: identity.device_id().as_str().to_owned(),
                    encryption_public_key: identity.public_key().as_str().to_owned(),
                    signing_public_key: signing.public_key().as_str().to_owned(),
                    installation_label: "Nook Extension".to_owned(),
                },
                nonce: "nonce-1".to_owned(),
                scopes: vec![ExtensionConnectScope::VaultAccess],
            };
            let mut extension = NookVaultManager::new();
            extension.application = VaultApplication::Extension;
            extension.vault.store_id = "store-1".to_owned();
            extension.device.id = identity.device_id().as_str().to_owned();
            extension.device.identity_private_key = identity.secret_string().into_inner();
            extension.event_log.signing_seed = signing_seed.into_inner();
            Ok(Self {
                website: NookVaultManager::new(),
                extension,
                endpoint: NookCompanionExtensionEndpoint::from_presence(
                    CompanionExtensionPresence::Unlocked {
                        vault_type: ExtensionPairingVaultType::Simple,
                        vault_store_id: "store-1".to_owned(),
                        vault_name: "Personal".to_owned(),
                        app_key: app_key.clone(),
                    },
                )?,
                status: CompanionIdentityStatus::Unlocked {
                    request_id: "request-1".to_owned(),
                    vault_store_id: "store-1".to_owned(),
                    app_key,
                },
            })
        }

        fn handoff_begin(&self) -> Result<CompanionWebsiteHandoffBegin, CompanionOperationError> {
            Ok(CompanionWebsiteHandoffBegin {
                discovery: CompanionIdentityDiscoveryObservation {
                    request: CompanionIdentityDiscoveryRequest {
                        request_id: "request-1".to_owned(),
                        vault_store_id: "store-1".to_owned(),
                        expires_at: epoch_milliseconds("200")?,
                    },
                    observed_at: epoch_milliseconds("100")?,
                },
                status: self.status.clone(),
                context: CompanionIdentityHandoffContext::PairedVault {
                    vault_store_id: "store-1".to_owned(),
                },
            })
        }

        fn begin(&mut self) -> Result<CompanionIdentityHandoffRequest, CompanionOperationError> {
            let begin = self.handoff_begin()?;
            self.website.begin_companion_identity_handoff_inner(begin)
        }
    }

    #[test]
    #[allow(
        unknown_lints,
        non_local_effect_before_unhandled_error,
        reason = "the test intentionally observes one-shot mutation and pending-state clearing before handling each rejection"
    )]
    fn production_endpoint_directly_authorizes_and_seals_real_managers()
    -> Result<(), CompanionOperationError> {
        let mut scenario = DirectHandoffScenario::new()?;
        let request = scenario.begin()?;
        let replay = request.clone();
        let response =
            scenario
                .endpoint
                .authorize_and_seal_loaded(CompanionExtensionSealOperation {
                    manager: &mut scenario.extension,
                    request,
                })?;
        assert!(!response.encrypted_envelope.is_empty());
        assert!(
            scenario
                .endpoint
                .authorize_and_seal_loaded(CompanionExtensionSealOperation {
                    manager: &mut scenario.extension,
                    request: replay,
                })
                .is_err()
        );

        let pending = scenario
            .website
            .consume_companion_website_handoff(&response)?;
        assert!(
            scenario
                .website
                .device
                .extension_handoff_private_key
                .is_empty()
        );
        assert!(!pending.recipient_secret.is_empty());
        let mut forged = scenario.begin()?;
        forged.request_id = "forged-request".to_owned();
        let forged_response = CompanionIdentityHandoffResponse {
            request: forged,
            encrypted_envelope: "not-used".to_owned(),
        };
        assert!(
            scenario
                .website
                .consume_companion_website_handoff(&forged_response)
                .is_err()
        );
        assert!(
            scenario
                .website
                .device
                .extension_handoff_private_key
                .is_empty()
        );
        Ok(())
    }

    #[test]
    #[allow(
        unknown_lints,
        non_local_effect_before_unhandled_error,
        reason = "the test intentionally observes that each mutating begin transaction clears state before rejecting invalid discovery"
    )]
    fn rejected_discovery_never_allocates_website_handoff_state()
    -> Result<(), CompanionOperationError> {
        let mut scenario = DirectHandoffScenario::new()?;
        let mut request_id = scenario.handoff_begin()?;
        request_id.discovery.request.request_id = "request-other".to_owned();
        let mut vault_store = scenario.handoff_begin()?;
        vault_store.discovery.request.vault_store_id = "store-other".to_owned();
        let mut expired = scenario.handoff_begin()?;
        expired.discovery.observed_at = epoch_milliseconds("200")?;

        for begin in [request_id, vault_store, expired] {
            assert!(
                scenario
                    .website
                    .begin_companion_identity_handoff_inner(begin)
                    .is_err()
            );
            assert!(
                scenario
                    .website
                    .device
                    .extension_handoff_private_key
                    .is_empty()
            );
        }
        Ok(())
    }
}

use super::{NookExtensionIdentityHandoffContext, NookVaultManager};
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

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct PendingCompanionWebsiteHandoff {
    request: CompanionIdentityHandoffRequest,
    context: CompanionIdentityHandoffContext,
    recipient_secret: String,
}

impl PendingCompanionWebsiteHandoff {
    fn encode(&self) -> Result<String, JsError> {
        serde_json::to_string(self).map_err(|error| JsError::new(&error.to_string()))
    }

    fn decode(serialized: &str) -> Result<Self, JsError> {
        serde_json::from_str(serialized).map_err(|error| JsError::new(&error.to_string()))
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
    fn authorize_and_seal_loaded(
        &mut self,
        operation: CompanionExtensionSealOperation<'_>,
    ) -> Result<CompanionIdentityHandoffResponse, JsError> {
        let authorized = self
            .protocol
            .authorize_handoff(operation.request)
            .map_err(|error| JsError::new(&error.to_string()))?;
        authorized.seal(operation.manager)
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
        Ok(Self {
            protocol: CompanionExtensionProtocol::new(presence)
                .map_err(|error| JsError::new(&error.to_string()))?,
        })
    }

    #[allow(clippy::needless_pass_by_value)]
    pub async fn authorize_and_seal(
        &mut self,
        manager: &mut NookVaultManager,
        request: CompanionIdentityHandoffRequest,
    ) -> Result<CompanionIdentityHandoffResponse, JsError> {
        manager.ensure_signing_identity().await?;
        self.authorize_and_seal_loaded(CompanionExtensionSealOperation { manager, request })
    }
}

impl CompanionIdentityHandoffSealer for NookVaultManager {
    type Error = JsError;

    fn seal_companion_handoff(
        &mut self,
        request: &CompanionIdentityHandoffRequest,
    ) -> Result<String, Self::Error> {
        request
            .validate()
            .map_err(|error| JsError::new(&error.to_string()))?;
        if self.application != VaultApplication::Extension
            || self.vault.store_id != request.vault_store_id
        {
            return Err(JsError::new(
                "Companion handoff request does not match the active extension vault.",
            ));
        }
        let identity = self.ensure_device_identity()?;
        let signing = SigningIdentity::from_seed_hex_stored(&self.event_log.signing_seed)?;
        let expected = &request.expected_app_key;
        if identity.device_id() != &DeviceId::parse(&expected.app_id)?
            || identity.public_key() != DevicePublicKey::parse(&expected.encryption_public_key)?
            || signing.public_key() != DeviceSigningPublicKey::parse(&expected.signing_public_key)?
        {
            return Err(JsError::new(
                "Companion handoff request does not match the unlocked installation app key.",
            ));
        }
        let recipient = DevicePublicKey::parse(&request.recipient_public_key)?;
        Ok(nook_core::ExtensionIdentityHandoffSeal {
            identity: &identity,
            signing_seed: &self.event_log.signing_seed,
            recipient_public_key: &recipient,
            nonce: &request.nonce,
        }
        .seal()?
        .into_inner())
    }
}

impl NookVaultManager {
    fn consume_companion_website_handoff(
        &mut self,
        response: &CompanionIdentityHandoffResponse,
    ) -> Result<PendingCompanionWebsiteHandoff, JsError> {
        let serialized = Zeroizing::new(mem::take(&mut self.device.extension_handoff_private_key));
        if serialized.is_empty() {
            return Err(JsError::new("Companion app-key handoff is not pending."));
        }
        let pending = PendingCompanionWebsiteHandoff::decode(&serialized)?;
        response
            .validate()
            .map_err(|error| JsError::new(&error.to_string()))?;
        if pending.request != response.request {
            return Err(JsError::new(
                &CompanionProtocolError::RequestMismatch.to_string(),
            ));
        }
        pending
            .context
            .validate_for_store(&pending.request.vault_store_id)
            .map_err(|error| JsError::new(&error.to_string()))?;
        Ok(pending)
    }
}

#[wasm_bindgen]
impl NookVaultManager {
    #[allow(clippy::needless_pass_by_value)]
    pub fn begin_companion_identity_handoff(
        &mut self,
        begin: CompanionWebsiteHandoffBegin,
    ) -> Result<CompanionIdentityHandoffRequest, JsError> {
        self.device.extension_handoff_private_key.zeroize();
        self.device.extension_handoff_private_key.clear();
        begin
            .validate()
            .map_err(|error| JsError::new(&error.to_string()))?;
        let recipient = DeviceIdentity::generate()?;
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

    #[allow(clippy::needless_pass_by_value)]
    pub async fn finish_companion_identity_handoff(
        &mut self,
        response: CompanionIdentityHandoffResponse,
    ) -> Result<(), JsError> {
        let mut pending = self.consume_companion_website_handoff(&response)?;
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
        CompanionIdentityHandoffContext, CompanionIdentityStatus, CompanionInstallationAppKey,
        CompanionUnlockedAppKey, ExtensionConnectScope, ExtensionPairingVaultType,
    };

    struct DirectHandoffScenario {
        website: NookVaultManager,
        extension: NookVaultManager,
        endpoint: NookCompanionExtensionEndpoint,
        status: CompanionIdentityStatus,
    }

    impl DirectHandoffScenario {
        fn new() -> Result<Self, JsError> {
            let identity = DeviceIdentity::generate()?;
            let (signing, signing_seed) = SigningIdentity::generate()?;
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
                endpoint: NookCompanionExtensionEndpoint::new(
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

        fn begin(&mut self) -> Result<CompanionIdentityHandoffRequest, JsError> {
            self.website
                .begin_companion_identity_handoff(CompanionWebsiteHandoffBegin {
                    status: self.status.clone(),
                    context: CompanionIdentityHandoffContext::PairedVault {
                        vault_store_id: "store-1".to_owned(),
                    },
                })
        }
    }

    #[test]
    fn production_endpoint_directly_authorizes_and_seals_real_managers() -> Result<(), JsError> {
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
}

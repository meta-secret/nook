//! Typed companion-protocol bridge over the real vault manager.

use super::{NookExtensionIdentityHandoffContext, NookVaultManager};
#[cfg(test)]
use nook_companion_core::AuthorizedCompanionIdentityHandoff;
use nook_companion_core::{
    CompanionIdentityHandoffFinishRequest, CompanionIdentityHandoffRequest,
    CompanionIdentityHandoffResponse, CompanionIdentityStatus,
};
use nook_core::{DeviceId, DevicePublicKey, DeviceSigningPublicKey, SigningIdentity};
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

impl NookVaultManager {
    fn seal_loaded_companion_identity(
        &mut self,
        request: CompanionIdentityHandoffRequest,
    ) -> Result<CompanionIdentityHandoffResponse, JsError> {
        request
            .validate()
            .map_err(|error| JsError::new(&error.to_string()))?;
        let identity = self.ensure_device_identity()?;
        let signing = SigningIdentity::from_seed_hex_stored(&self.event_log.signing_seed)?;
        let expected = &request.expected_identity;
        if identity.device_id() != &DeviceId::parse(&expected.device_id)?
            || identity.public_key() != DevicePublicKey::parse(&expected.device_public_key)?
            || signing.public_key()
                != DeviceSigningPublicKey::parse(&expected.device_signing_public_key)?
        {
            return Err(JsError::new(
                "Companion handoff request does not match the unlocked device.",
            ));
        }
        let recipient = DevicePublicKey::parse(&request.recipient_public_key)?;
        let envelope = nook_core::ExtensionIdentityHandoffSeal {
            identity: &identity,
            signing_seed: &self.event_log.signing_seed,
            recipient_public_key: &recipient,
            nonce: &request.nonce,
        }
        .seal()?;
        Ok(CompanionIdentityHandoffResponse {
            request,
            encrypted_envelope: envelope.into_inner(),
        })
    }

    #[cfg(test)]
    fn seal_authorized_companion_identity_handoff(
        &mut self,
        authorized: AuthorizedCompanionIdentityHandoff,
    ) -> Result<CompanionIdentityHandoffResponse, JsError> {
        self.seal_loaded_companion_identity(authorized.into_request())
    }
}

#[wasm_bindgen]
impl NookVaultManager {
    /// Start a typed website handoff while the recipient secret stays in Rust memory.
    #[allow(clippy::needless_pass_by_value)]
    pub fn begin_companion_identity_handoff(
        &mut self,
        status: CompanionIdentityStatus,
    ) -> Result<CompanionIdentityHandoffRequest, JsError> {
        status
            .validate()
            .map_err(|error| JsError::new(&error.to_string()))?;
        status
            .unlocked_identity()
            .map_err(|error| JsError::new(&error.to_string()))?;
        let recipient = self.begin_extension_identity_handoff()?;
        status
            .request_handoff(recipient)
            .map_err(|error| JsError::new(&error.to_string()))
    }

    /// Seal only after the typed request is bound to the live unlocked identity.
    #[allow(clippy::needless_pass_by_value)]
    pub async fn seal_companion_identity_handoff(
        &mut self,
        request: CompanionIdentityHandoffRequest,
    ) -> Result<CompanionIdentityHandoffResponse, JsError> {
        self.ensure_signing_identity().await?;
        self.seal_loaded_companion_identity(request)
    }

    /// Open a typed response and retain the existing staged/commit/rollback policy.
    #[allow(clippy::needless_pass_by_value)]
    pub async fn finish_companion_identity_handoff(
        &mut self,
        finish: CompanionIdentityHandoffFinishRequest,
    ) -> Result<(), JsError> {
        finish
            .validate()
            .map_err(|error| JsError::new(&error.to_string()))?;
        let CompanionIdentityHandoffFinishRequest { response, context } = finish;
        let request = response.request;
        let context = NookExtensionIdentityHandoffContext::from_companion(context)?;
        self.finish_extension_identity_handoff(
            &response.encrypted_envelope,
            &request.nonce,
            &request.expected_identity.device_id,
            &request.expected_identity.device_public_key,
            &request.expected_identity.device_signing_public_key,
            &context,
        )
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nook_companion_core::{
        CompanionDeviceIdentity, CompanionExtensionPresence, CompanionExtensionProtocol,
        CompanionProtocolError, CompanionUnlockedIdentity, ExtensionConnectScope,
        ExtensionPairingVaultType,
    };
    use nook_core::{
        AgeArmoredCiphertext, DeviceId, DeviceIdentity, DeviceIdentitySecret, DevicePublicKey,
        DeviceSigningPublicKey, ExtensionIdentityHandoffOpen, SigningIdentity,
    };
    use zeroize::Zeroizing;

    struct DirectHandoffScenario {
        website: NookVaultManager,
        extension: NookVaultManager,
        protocol: CompanionExtensionProtocol,
        unlocked: CompanionUnlockedIdentity,
    }

    impl DirectHandoffScenario {
        fn new() -> Result<Self, JsError> {
            let identity = DeviceIdentity::generate()?;
            let (signing, signing_seed) = SigningIdentity::generate()?;
            let descriptor = CompanionDeviceIdentity {
                device_id: identity.device_id().as_str().to_owned(),
                device_public_key: identity.public_key().as_str().to_owned(),
                device_signing_public_key: signing.public_key().as_str().to_owned(),
                device_label: "Nook Extension".to_owned(),
            };
            let unlocked = CompanionUnlockedIdentity {
                extension_runtime_id: "runtime-1".to_owned(),
                identity: descriptor,
                nonce: "nonce-1".to_owned(),
                scopes: vec![ExtensionConnectScope::VaultAccess],
            };
            let mut extension = NookVaultManager::new();
            extension.device.id = identity.device_id().as_str().to_owned();
            extension.device.identity_private_key = identity.secret_string().into_inner();
            extension.event_log.signing_seed = signing_seed.into_inner();
            Ok(Self {
                website: NookVaultManager::new(),
                extension,
                protocol: CompanionExtensionProtocol::new(CompanionExtensionPresence::Unlocked {
                    vault_type: ExtensionPairingVaultType::Simple,
                    vault_store_id: "store-1".to_owned(),
                    vault_name: "Personal".to_owned(),
                    identity: unlocked.clone(),
                })
                .map_err(|error| JsError::new(&error.to_string()))?,
                unlocked,
            })
        }

        fn status(&self) -> CompanionIdentityStatus {
            CompanionIdentityStatus::Unlocked {
                request_id: "request-1".to_owned(),
                vault_store_id: "store-1".to_owned(),
                unlocked: self.unlocked.clone(),
            }
        }
    }

    #[test]
    fn direct_real_managers_seal_only_a_protocol_authorized_handoff() -> Result<(), JsError> {
        let mut scenario = DirectHandoffScenario::new()?;
        let status = scenario.status();
        let request = scenario.website.begin_companion_identity_handoff(status)?;
        let authorized = scenario
            .protocol
            .authorize_handoff(request)
            .map_err(|error| JsError::new(&error.to_string()))?;
        let response = scenario
            .extension
            .seal_authorized_companion_identity_handoff(authorized)?;
        assert!(!response.encrypted_envelope.is_empty());
        let recipient = DeviceIdentity::from_secret_str(&DeviceIdentitySecret::parse(
            &scenario.website.device.extension_handoff_private_key,
        )?)?;
        let envelope = AgeArmoredCiphertext::parse(&response.encrypted_envelope)?;
        let expected = &response.request.expected_identity;
        let expected_device_id = DeviceId::parse(&expected.device_id)?;
        let expected_public_key = DevicePublicKey::parse(&expected.device_public_key)?;
        let expected_signing_key =
            DeviceSigningPublicKey::parse(&expected.device_signing_public_key)?;
        let material = ExtensionIdentityHandoffOpen {
            recipient_identity: &recipient,
            envelope: &envelope,
            expected_nonce: &response.request.nonce,
            expected_device_id: &expected_device_id,
            expected_device_public_key: &expected_public_key,
            expected_device_signing_public_key: &expected_signing_key,
        }
        .open()?;
        let (adopted, signing_seed) = material.into_parts();
        let signing_seed = Zeroizing::new(signing_seed);
        assert_eq!(adopted.device_id(), &expected_device_id);
        assert_eq!(
            SigningIdentity::from_seed_hex_stored(&signing_seed)?.public_key(),
            expected_signing_key
        );
        assert!(matches!(
            scenario
                .protocol
                .authorize_handoff(response.request.clone()),
            Err(CompanionProtocolError::NonceUnavailable)
        ));
        Ok(())
    }

    #[test]
    fn unavailable_identity_does_not_allocate_a_handoff_secret() {
        let mut website = NookVaultManager::new();
        let status = CompanionIdentityStatus::Locked {
            request_id: "request-1".to_owned(),
            vault_store_id: "store-1".to_owned(),
        };

        assert!(website.begin_companion_identity_handoff(status).is_err());
        assert!(website.device.extension_handoff_private_key.is_empty());
    }
}

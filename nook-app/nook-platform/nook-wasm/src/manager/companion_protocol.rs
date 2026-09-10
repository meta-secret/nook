use super::device_protection::handoff_stages::HandoffBinding;
use super::session::ExtensionHandoffState;
use super::{
    NookAdoptedExtensionIdentityHandoff, NookExtensionIdentityHandoffContext, NookVaultManager,
};
use crate::NookError;
use nook_companion_core::{
    AuthorizedCompanionIdentityHandoff, CompanionExtensionHandoffEndpoint,
    CompanionExtensionPresence, CompanionHandoffResponseAdmission,
    CompanionIdentityDiscoveryObservation, CompanionIdentityHandoffAuthorization,
    CompanionIdentityHandoffContext, CompanionIdentityHandoffRequest,
    CompanionIdentityHandoffResponse, CompanionIdentityHandoffSealer, CompanionIdentityStatus,
    CompanionIdentityStatusAdmission, CompanionIdentityStatusAdmissionRequest,
    CompanionProtocolError, CompanionWebsiteHandoffBegin, DiscoveredCompanionHandoffEndpoint,
};
use nook_core::{
    DeviceId, DeviceIdentity, DevicePublicKey, DeviceSigningPublicKey, SigningIdentity,
    VaultApplication,
};
use std::mem;
use wasm_bindgen::{JsError, prelude::wasm_bindgen};
use zeroize::Zeroize;

#[derive(Debug, thiserror::Error)]
enum CompanionOperationError {
    #[error(transparent)]
    Protocol(#[from] CompanionProtocolError),
    #[error(transparent)]
    Manager(#[from] NookError),
    #[error("Companion app-key handoff is not pending.")]
    HandoffNotPending,
    #[error("Companion handoff request does not match the active extension vault.")]
    ActiveExtensionVaultMismatch,
    #[error("Companion handoff request does not match the unlocked installation app key.")]
    InstallationAppKeyMismatch,
}

impl NookVaultManager {
    fn companion_js_error(error: &CompanionOperationError) -> JsError {
        JsError::new(&error.to_string())
    }
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
pub fn admit_companion_identity_status(
    request: CompanionIdentityStatusAdmissionRequest,
) -> CompanionIdentityStatusAdmission {
    CompanionIdentityStatusAdmission::admit(request)
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
pub fn admit_companion_handoff_response(
    response: CompanionIdentityHandoffResponse,
) -> CompanionHandoffResponseAdmission {
    CompanionHandoffResponseAdmission::admit(response)
}

pub(in crate::manager) struct PendingCompanionWebsiteHandoff {
    request: CompanionIdentityHandoffRequest,
    context: CompanionIdentityHandoffContext,
    recipient_secret: String,
}

impl PendingCompanionWebsiteHandoff {
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
    inner: CompanionExtensionHandoffEndpoint,
}

impl NookCompanionExtensionEndpoint {
    fn from_presence(
        presence: CompanionExtensionPresence,
    ) -> Result<Self, CompanionOperationError> {
        Ok(Self {
            inner: CompanionExtensionHandoffEndpoint::new(presence)?,
        })
    }

    fn seal_authorized_loaded(
        operation: CompanionAuthorizedSealOperation<'_>,
    ) -> Result<CompanionIdentityHandoffResponse, CompanionOperationError> {
        operation
            .authorized
            .seal(&mut CompanionManagerSealer(operation.manager))
    }
}

#[cfg(test)]
struct CompanionExtensionSealOperation<'a> {
    manager: &'a mut NookVaultManager,
    authorization: CompanionIdentityHandoffAuthorization,
}

struct CompanionAuthorizedSealOperation<'a> {
    manager: &'a mut NookVaultManager,
    authorized: AuthorizedCompanionIdentityHandoff,
}

#[wasm_bindgen]
impl NookCompanionExtensionEndpoint {
    #[wasm_bindgen(constructor)]
    #[allow(clippy::needless_pass_by_value)]
    pub fn new(presence: CompanionExtensionPresence) -> Result<Self, JsError> {
        Self::from_presence(presence).map_err(|error| NookVaultManager::companion_js_error(&error))
    }

    #[allow(clippy::needless_pass_by_value)]
    pub fn discover(
        self,
        discovery: CompanionIdentityDiscoveryObservation,
    ) -> Result<NookDiscoveredCompanionExtensionEndpoint, JsError> {
        let inner = self
            .inner
            .discover(discovery)
            .map_err(|error| JsError::new(&error.to_string()))?;
        Ok(NookDiscoveredCompanionExtensionEndpoint { inner })
    }
}

/// Private, non-cloneable state; external data is admitted through its predecessor.
///
/// ```compile_fail,E0277
/// use nook_wasm::NookDiscoveredCompanionExtensionEndpoint;
/// let decode = |json: &str| serde_json::from_str::<NookDiscoveredCompanionExtensionEndpoint>(json);
/// ```
///
/// ```compile_fail,E0599
/// use nook_wasm::NookDiscoveredCompanionExtensionEndpoint;
/// let clone = |phase: NookDiscoveredCompanionExtensionEndpoint| phase.clone();
/// ```
#[wasm_bindgen]
pub struct NookDiscoveredCompanionExtensionEndpoint {
    inner: DiscoveredCompanionHandoffEndpoint,
}

#[wasm_bindgen]
impl NookDiscoveredCompanionExtensionEndpoint {
    #[wasm_bindgen(getter)]
    pub fn status(&self) -> CompanionIdentityStatus {
        self.inner.status()
    }

    pub fn rediscover(
        self,
        discovery: CompanionIdentityDiscoveryObservation,
    ) -> Result<Self, JsError> {
        let inner = self
            .inner
            .observe(&discovery)
            .map_err(|error| JsError::new(&error.to_string()))?;
        Ok(Self { inner })
    }

    #[allow(clippy::needless_pass_by_value)]
    pub async fn authorize_and_seal(
        self,
        manager: &mut NookVaultManager,
        authorization: CompanionIdentityHandoffAuthorization,
    ) -> Result<CompanionIdentityHandoffResponse, JsError> {
        let authorized = self
            .inner
            .authorize_handoff(authorization)
            .map_err(|error| {
                NookVaultManager::companion_js_error(&CompanionOperationError::Protocol(error))
            })?;
        manager.ensure_signing_identity().await.map_err(|error| {
            NookVaultManager::companion_js_error(&CompanionOperationError::Manager(error))
        })?;
        NookCompanionExtensionEndpoint::seal_authorized_loaded(CompanionAuthorizedSealOperation {
            manager,
            authorized,
        })
        .map_err(|error| NookVaultManager::companion_js_error(&error))
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
        let CompanionIdentityStatus::Unlocked {
            vault_store_id,
            app_key,
            ..
        } = &request.transaction.status
        else {
            return Err(CompanionProtocolError::AppKeyUnavailable.into());
        };
        if manager.application != VaultApplication::Extension
            || manager.vault.store_id != vault_store_id.as_str()
        {
            return Err(CompanionOperationError::ActiveExtensionVaultMismatch);
        }
        let identity = manager.ensure_device_identity()?;
        let signing = SigningIdentity::from_seed_hex_stored(&manager.event_log.signing_seed)
            .map_err(NookError::from)?;
        let expected = &app_key.app_key;
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
            nonce: &app_key.nonce,
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
        let pending = match mem::take(&mut self.device.extension_handoff_private_key) {
            ExtensionHandoffState::Companion(pending) => pending,
            ExtensionHandoffState::Idle | ExtensionHandoffState::Recipient(_) => {
                return Err(CompanionOperationError::HandoffNotPending);
            }
        };
        response.validate()?;
        if pending.request != response.request {
            return Err(CompanionProtocolError::RequestMismatch.into());
        }
        pending
            .context
            .validate_for_store(&pending.request.transaction.discovery.request.vault_store_id)?;
        Ok(pending)
    }

    fn begin_companion_identity_handoff_inner(
        &mut self,
        begin: CompanionWebsiteHandoffBegin,
    ) -> Result<CompanionIdentityHandoffRequest, CompanionOperationError> {
        self.device.extension_handoff_private_key.zeroize();
        self.device.extension_handoff_private_key.clear();
        begin.validate()?;
        self.device.handoff_generation = Default::default();
        let recipient = DeviceIdentity::generate().map_err(NookError::from)?;
        let context = begin.context.clone();
        let request = begin.prepare(recipient.public_key().into_inner())?;
        let pending = PendingCompanionWebsiteHandoff {
            request: request.clone(),
            context,
            recipient_secret: recipient.secret_string().into_inner(),
        };
        self.device.extension_handoff_private_key = ExtensionHandoffState::Companion(pending);
        Ok(request)
    }
}

#[wasm_bindgen]
impl NookVaultManager {
    #[allow(clippy::needless_pass_by_value)]
    pub fn begin_companion_identity_handoff(
        &mut self,
        begin: CompanionWebsiteHandoffBegin,
    ) -> Result<NookPendingCompanionIdentityHandoff, JsError> {
        let request = self
            .begin_companion_identity_handoff_inner(begin)
            .map_err(|error| NookVaultManager::companion_js_error(&error))?;
        Ok(NookPendingCompanionIdentityHandoff {
            binding: HandoffBinding::new(self),
            request,
        })
    }
}

impl NookVaultManager {
    #[allow(clippy::needless_pass_by_value)]
    async fn finish_companion_identity_handoff(
        &mut self,
        response: CompanionIdentityHandoffResponse,
    ) -> Result<NookAdoptedExtensionIdentityHandoff, JsError> {
        let mut pending = self
            .consume_companion_website_handoff(&response)
            .map_err(|error| NookVaultManager::companion_js_error(&error))?;
        let context = NookExtensionIdentityHandoffContext::from_companion(pending.context.clone())?;
        let CompanionIdentityStatus::Unlocked { app_key, .. } = &pending.request.transaction.status
        else {
            return Err(NookVaultManager::companion_js_error(
                &CompanionOperationError::Protocol(CompanionProtocolError::AppKeyUnavailable),
            ));
        };
        let app_key = app_key.clone();
        self.device.extension_handoff_private_key =
            ExtensionHandoffState::Recipient(pending.take_recipient_secret().into());
        let expected = &app_key.app_key;
        self.finish_extension_identity_handoff(
            &response.encrypted_envelope,
            &app_key.nonce,
            &expected.app_id,
            &expected.encryption_public_key,
            &expected.signing_public_key,
            &context,
        )
        .await?;
        Ok(NookAdoptedExtensionIdentityHandoff::new(self))
    }
}

#[cfg(test)]
#[path = "companion_protocol_tests.rs"]
mod tests;

/// A one-use website transaction awaiting its correlated encrypted response.
/// Private, non-cloneable state; external data is admitted through its predecessor.
///
/// ```compile_fail,E0277
/// use nook_wasm::NookPendingCompanionIdentityHandoff;
/// let decode = |json: &str| serde_json::from_str::<NookPendingCompanionIdentityHandoff>(json);
/// ```
///
/// ```compile_fail,E0599
/// use nook_wasm::NookPendingCompanionIdentityHandoff;
/// let clone = |phase: NookPendingCompanionIdentityHandoff| phase.clone();
/// ```
#[wasm_bindgen]
pub struct NookPendingCompanionIdentityHandoff {
    binding: HandoffBinding,
    request: CompanionIdentityHandoffRequest,
}
#[wasm_bindgen]
impl NookPendingCompanionIdentityHandoff {
    #[wasm_bindgen(getter)]
    pub fn request(&self) -> CompanionIdentityHandoffRequest {
        self.request.clone()
    }
    pub async fn finish(
        self,
        manager: &mut NookVaultManager,
        response: CompanionIdentityHandoffResponse,
    ) -> Result<NookAdoptedExtensionIdentityHandoff, JsError> {
        self.binding.check(manager)?;
        match manager.finish_companion_identity_handoff(response).await {
            Ok(adopted) => Ok(adopted),
            Err(error) => {
                manager.rollback_extension_identity_handoff();
                Err(error)
            }
        }
    }
    pub fn cancel(self, manager: &mut NookVaultManager) -> Result<(), JsError> {
        self.binding.check(manager)?;
        manager.rollback_extension_identity_handoff();
        Ok(())
    }
}

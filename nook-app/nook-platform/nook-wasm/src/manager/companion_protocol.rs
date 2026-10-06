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
use serde::Deserialize;
use std::mem;
use std::rc::Rc;
use tsify::Tsify;
use wasm_bindgen::{JsError, prelude::wasm_bindgen};
use zeroize::Zeroize;

#[derive(Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "unknown")]
pub struct CompanionIdentityStatusRequestAdmission(CompanionIdentityStatusAdmissionRequest);

#[derive(Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "unknown")]
pub struct CompanionHandoffResponseValueAdmission(CompanionIdentityHandoffResponse);

#[derive(Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "unknown")]
pub struct CompanionExtensionPresenceAdmission(CompanionExtensionPresence);

#[derive(Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "unknown")]
pub struct CompanionHandoffAuthorizationAdmission(CompanionIdentityHandoffAuthorization);

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
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn admit_companion_identity_status(
    request: &tsify::Ts<CompanionIdentityStatusRequestAdmission>,
) -> Result<tsify::Ts<CompanionIdentityStatusAdmission>, wasm_bindgen::JsError> {
    let request = request
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;
    let result = {
        let CompanionIdentityStatusRequestAdmission(request) = request;
        CompanionIdentityStatusAdmission::admit(request)
    };
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}

#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn admit_companion_handoff_response(
    response: &tsify::Ts<CompanionHandoffResponseValueAdmission>,
) -> Result<tsify::Ts<CompanionHandoffResponseAdmission>, wasm_bindgen::JsError> {
    let response = response
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;
    let result = {
        let CompanionHandoffResponseValueAdmission(response) = response;
        CompanionHandoffResponseAdmission::admit(response)
    };
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
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
        operation.authorized.seal(&mut CompanionManagerSealer {
            manager: operation.manager,
            protection: operation.protection,
        })
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
    protection: nook_core::AppProtectionDescriptor,
}

#[wasm_bindgen]
impl NookCompanionExtensionEndpoint {
    #[wasm_bindgen(constructor)]
    #[allow(clippy::needless_pass_by_value)]
    pub fn new(
        presence: &tsify::Ts<CompanionExtensionPresenceAdmission>,
    ) -> Result<Self, wasm_bindgen::JsError> {
        let presence = presence
            .to_rust()
            .map_err(|_| JsError::new("Invalid typed WASM input."))?;

        let CompanionExtensionPresenceAdmission(presence) = presence;
        Self::from_presence(presence).map_err(|error| NookVaultManager::companion_js_error(&error))
    }

    #[wasm_bindgen(getter)]
    pub fn presence(&self) -> Result<tsify::Ts<CompanionExtensionPresence>, wasm_bindgen::JsError> {
        let result = { self.inner.presence() };
        Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM output could not be encoded."))
    }

    #[allow(clippy::needless_pass_by_value)]
    pub fn discover(
        self,
        discovery: &tsify::Ts<CompanionIdentityDiscoveryObservation>,
    ) -> Result<NookDiscoveredCompanionExtensionEndpoint, wasm_bindgen::JsError> {
        let discovery = discovery
            .to_rust()
            .map_err(|_| JsError::new("Invalid typed WASM input."))?;

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
    pub fn status(&self) -> Result<tsify::Ts<CompanionIdentityStatus>, wasm_bindgen::JsError> {
        let result = { self.inner.status() };
        Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM output could not be encoded."))
    }
    pub fn rediscover(
        self,
        discovery: &tsify::Ts<CompanionIdentityDiscoveryObservation>,
    ) -> Result<Self, wasm_bindgen::JsError> {
        let discovery = discovery
            .to_rust()
            .map_err(|_| JsError::new("Invalid typed WASM input."))?;

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
        authorization: &tsify::Ts<CompanionHandoffAuthorizationAdmission>,
    ) -> Result<tsify::Ts<CompanionIdentityHandoffResponse>, wasm_bindgen::JsError> {
        let authorization = authorization
            .to_rust()
            .map_err(|_| JsError::new("Invalid typed WASM input."))?;

        let CompanionHandoffAuthorizationAdmission(authorization) = authorization;
        let authorized = self
            .inner
            .authorize_handoff(authorization)
            .map_err(|error| {
                NookVaultManager::companion_js_error(&CompanionOperationError::Protocol(error))
            })?;
        manager.ensure_signing_identity().await.map_err(|error| {
            NookVaultManager::companion_js_error(&CompanionOperationError::Manager(error))
        })?;
        let protection = manager
            .extension_protection_descriptor()
            .await
            .map_err(|error| {
                NookVaultManager::companion_js_error(&CompanionOperationError::Manager(error))
            })?;
        let result = NookCompanionExtensionEndpoint::seal_authorized_loaded(
            CompanionAuthorizedSealOperation {
                manager,
                authorized,
                protection,
            },
        )
        .map_err(|error| NookVaultManager::companion_js_error(&error))?;
        Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM output could not be encoded."))
    }
}

struct CompanionManagerSealer<'a> {
    manager: &'a mut NookVaultManager,
    protection: nook_core::AppProtectionDescriptor,
}

impl CompanionIdentityHandoffSealer for CompanionManagerSealer<'_> {
    type Error = CompanionOperationError;

    fn seal_companion_handoff(
        &mut self,
        request: &CompanionIdentityHandoffRequest,
    ) -> Result<String, Self::Error> {
        request.validate()?;
        let manager = &mut *self.manager;
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
            protection: &self.protection,
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
            ExtensionHandoffState::Companion(pending) => *pending,
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
        self.device.handoff_generation = Rc::default();
        let recipient = DeviceIdentity::generate().map_err(NookError::from)?;
        let context = begin.context.clone();
        let request = begin.prepare(recipient.public_key().into_inner())?;
        let pending = PendingCompanionWebsiteHandoff {
            request: request.clone(),
            context,
            recipient_secret: recipient.secret_string().into_inner(),
        };
        self.device.extension_handoff_private_key = ExtensionHandoffState::companion(pending);
        Ok(request)
    }
}

#[wasm_bindgen]
impl NookVaultManager {
    #[allow(clippy::needless_pass_by_value)]
    pub fn begin_companion_identity_handoff(
        &mut self,
        begin: &tsify::Ts<CompanionWebsiteHandoffBegin>,
    ) -> Result<NookPendingCompanionIdentityHandoff, wasm_bindgen::JsError> {
        let begin = begin
            .to_rust()
            .map_err(|_| JsError::new("Invalid typed WASM input."))?;

        let request = self
            .begin_companion_identity_handoff_inner(begin)
            .map_err(|error| NookVaultManager::companion_js_error(&error))?;
        Ok::<_, wasm_bindgen::JsError>(NookPendingCompanionIdentityHandoff {
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
    pub fn request(
        &self,
    ) -> Result<tsify::Ts<CompanionIdentityHandoffRequest>, wasm_bindgen::JsError> {
        let result = { self.request.clone() };
        Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM output could not be encoded."))
    }
    pub async fn finish(
        self,
        manager: &mut NookVaultManager,
        response: &tsify::Ts<CompanionIdentityHandoffResponse>,
    ) -> Result<NookAdoptedExtensionIdentityHandoff, wasm_bindgen::JsError> {
        let response = response
            .to_rust()
            .map_err(|_| JsError::new("Invalid typed WASM input."))?;

        self.binding.check(manager)?;
        match manager.finish_companion_identity_handoff(response).await {
            Ok::<_, wasm_bindgen::JsError>(adopted) => Ok::<_, wasm_bindgen::JsError>(adopted),
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

#[cfg(all(test, target_arch = "wasm32"))]
mod typed_boundary_tests {
    use super::*;
    #[cfg(feature = "browser-wasm-tests")]
    use crate::storage::identity_record::PriorAppAuthorization;
    use nook_companion_core::{
        CompanionIdentityDiscoveryRequest, CompanionInstallationAppKey, CompanionUnlockedAppKey,
        ExtensionConnectScope, ExtensionPairingVaultType,
    };
    #[cfg(feature = "browser-wasm-tests")]
    use nook_core::{
        AppProtectionAssociation, DeviceIdentityProtection, DeviceKeyProtectionSetup,
        PasskeyAccessProfile, WebAuthnCredentialId, WebAuthnPrfOutput,
    };
    use serde::Serialize;
    use serde_wasm_bindgen::Serializer;
    use tsify::Ts;
    use wasm_bindgen_test::wasm_bindgen_test;
    use zeroize::Zeroizing;

    struct PublicHandoffScenario {
        website: NookVaultManager,
        extension: NookVaultManager,
        presence: CompanionExtensionPresence,
        discovery: CompanionIdentityDiscoveryObservation,
    }

    impl PublicHandoffScenario {
        fn new() -> Result<Self, JsError> {
            let identity = DeviceIdentity::generate()?;
            let (signing, signing_seed) = SigningIdentity::generate()?;
            let mut extension = NookVaultManager::new();
            extension.application = VaultApplication::Extension;
            extension.vault.store_id = "public-boundary-store".to_owned();
            extension.device.id = identity.device_id().as_str().to_owned();
            extension.device.identity_private_key = identity.secret_string().into_inner();
            extension.event_log.signing_seed = signing_seed.into_inner();
            let presence = CompanionExtensionPresence::Unlocked {
                vault_type: ExtensionPairingVaultType::Simple,
                vault_store_id: extension.vault.store_id.clone(),
                vault_name: "Personal".to_owned(),
                app_key: CompanionUnlockedAppKey {
                    extension_runtime_id: "public-boundary-runtime".to_owned(),
                    app_key: CompanionInstallationAppKey {
                        app_id: extension.device.id.clone(),
                        encryption_public_key: identity.public_key().as_str().to_owned(),
                        signing_public_key: signing.public_key().as_str().to_owned(),
                        installation_label: "Nook Extension".to_owned(),
                    },
                    nonce: "public-boundary-nonce".to_owned(),
                    scopes: vec![ExtensionConnectScope::VaultAccess],
                },
            };
            let discovery = CompanionIdentityDiscoveryObservation {
                request: CompanionIdentityDiscoveryRequest {
                    request_id: "public-boundary-request".to_owned(),
                    vault_store_id: extension.vault.store_id.clone(),
                    expires_at: serde_json::from_str("200")?,
                },
                observed_at: serde_json::from_str("100")?,
            };
            Ok(Self {
                website: NookVaultManager::new(),
                extension,
                presence,
                discovery,
            })
        }

        fn endpoint(&self) -> Result<NookDiscoveredCompanionExtensionEndpoint, JsError> {
            let presence = self.presence.into_ts()?;
            let endpoint =
                NookCompanionExtensionEndpoint::new(&Ts::new_unchecked(presence.js_value()))?;
            assert_eq!(endpoint.presence()?.to_rust()?, self.presence);
            endpoint.discover(&self.discovery.into_ts()?)
        }

        fn pending_secret(&self) -> Result<Zeroizing<String>, JsError> {
            match &self.website.device.extension_handoff_private_key {
                ExtensionHandoffState::Companion(pending) => {
                    Ok(Zeroizing::new(pending.recipient_secret.clone()))
                }
                ExtensionHandoffState::Idle | ExtensionHandoffState::Recipient(_) => {
                    Err(JsError::new("Public fixture has no pending transaction."))
                }
            }
        }

        fn begin(&mut self) -> Result<NookPendingCompanionIdentityHandoff, JsError> {
            let endpoint = self.endpoint()?.rediscover(&self.discovery.into_ts()?)?;
            let admission = CompanionIdentityStatusAdmissionRequest {
                discovery: self.discovery.clone(),
                status: endpoint.status()?.to_rust()?,
                observed_at: self.discovery.observed_at,
            }
            .into_ts()?;
            let admitted =
                admit_companion_identity_status(&Ts::new_unchecked(admission.js_value()))?
                    .to_rust()?;
            match admitted {
                CompanionIdentityStatusAdmission::Accepted { transaction } => {
                    self.website.begin_companion_identity_handoff(
                        &CompanionWebsiteHandoffBegin {
                            transaction: *transaction,
                            context: CompanionIdentityHandoffContext::PairedVault {
                                vault_store_id: self.extension.vault.store_id.clone(),
                            },
                        }
                        .into_ts()?,
                    )
                }
                CompanionIdentityStatusAdmission::Rejected { .. } => {
                    Err(JsError::new("Public fixture was not admitted."))
                }
            }
        }
    }

    #[cfg(feature = "browser-wasm-tests")]
    #[wasm_bindgen_test]
    async fn public_handoff_roundtrip_preserves_correlation_and_cancellation() -> Result<(), JsError>
    {
        let mut cleanup = NookVaultManager::new();
        cleanup.delete_local_browser_data().await?;
        let mut scenario = PublicHandoffScenario::new()?;
        let app = scenario.extension.device_identity()?;
        let setup = DeviceKeyProtectionSetup::generate()?;
        let credential_id = WebAuthnCredentialId::try_from(vec![8; 32])?;
        let prf_output = WebAuthnPrfOutput::try_from(vec![9; 32])?;
        let record = DeviceIdentityProtection::new(&app.secret_string()).with_passkey(
            &nook_core::PasskeyProtectionInput {
                credential_id: &credential_id,
                user_handle: setup.user_handle(),
                prf_input: setup.prf_input(),
                prf_output: &prf_output,
            },
        )?;
        crate::NookDatabase::save_new_protected_local_identity(
            crate::IdentityDbSaveNewProtectedLocalIdentity {
                app_key: &app,
                record: &record,
                prior_app_key: PriorAppAuthorization::Unavailable,
                label: "Extension",
            },
        )
        .await?;
        // Protection persistence establishes the durable app-scoped signer.
        // Advertise that actual installation rather than the transient fixture signer.
        let app = scenario.extension.device_identity()?;
        let signing = scenario.extension.ensure_signing_identity().await?;
        let CompanionExtensionPresence::Unlocked { app_key, .. } = &mut scenario.presence else {
            return Err(JsError::new(
                "Public fixture must advertise an unlocked app.",
            ));
        };
        app_key.app_key.app_id = app.app_id().as_str().to_owned();
        app_key.app_key.encryption_public_key = app.public_key().as_str().to_owned();
        app_key.app_key.signing_public_key = signing.public_key().as_str().to_owned();
        let pending = scenario.begin()?;
        let request = pending.request()?.to_rust()?;
        assert_eq!(request.transaction.discovery, scenario.discovery);
        let authorization = CompanionIdentityHandoffAuthorization {
            request: request.clone(),
            observed_at: scenario.discovery.observed_at,
            presence: scenario.presence.clone(),
        }
        .into_ts()?;
        let endpoint = scenario.endpoint()?;
        let response = endpoint
            .authorize_and_seal(
                &mut scenario.extension,
                &Ts::new_unchecked(authorization.js_value()),
            )
            .await?;
        let response_value = response.to_rust()?;
        assert_eq!(response_value.request, request);
        assert!(!response_value.encrypted_envelope.is_empty());
        let protection = scenario.extension.extension_protection_descriptor().await?;
        let AppProtectionAssociation::PasskeyAntiHacker(profile) = protection.association else {
            return Err(JsError::new("Expected extension passkey"));
        };
        assert_eq!(
            profile.credential_fingerprint,
            PasskeyAccessProfile::credential_identifier(&[8; 32])
        );
        assert!(profile.nook_name.is_empty());
        let admission =
            admit_companion_handoff_response(&Ts::new_unchecked(response.js_value()))?.to_rust()?;
        assert!(matches!(
            admission,
            CompanionHandoffResponseAdmission::Accepted { .. }
        ));
        pending.cancel(&mut scenario.website)?;
        assert!(
            scenario
                .website
                .device
                .extension_handoff_private_key
                .is_empty()
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn malformed_public_inputs_preserve_pending_manager_state() -> Result<(), JsError> {
        let mut scenario = PublicHandoffScenario::new()?;
        let pending = scenario.begin()?;
        let key = scenario.pending_secret()?;
        assert!(!key.is_empty());
        assert!(
            scenario
                .website
                .begin_companion_identity_handoff(&Ts::new_unchecked(
                    Option::<bool>::None.serialize(&Serializer::json_compatible())?
                ),)
                .is_err()
        );
        assert!(scenario.pending_secret()? == key);
        assert!(
            pending
                .finish(
                    &mut scenario.website,
                    &Ts::new_unchecked(serde_wasm_bindgen::to_value(&true)?)
                )
                .await
                .is_err()
        );
        assert!(scenario.pending_secret()? == key);
        let signing_seed = Zeroizing::new(scenario.extension.event_log.signing_seed.clone());
        assert!(
            scenario
                .endpoint()?
                .authorize_and_seal(
                    &mut scenario.extension,
                    &Ts::new_unchecked(
                        Option::<bool>::None.serialize(&Serializer::json_compatible())?
                    ),
                )
                .await
                .is_err()
        );
        assert!(scenario.extension.event_log.signing_seed == *signing_seed);
        assert!(
            NookCompanionExtensionEndpoint::new(&Ts::new_unchecked(serde_wasm_bindgen::to_value(
                &true
            )?))
            .is_err()
        );
        assert!(
            scenario
                .endpoint()?
                .rediscover(&Ts::new_unchecked(
                    Option::<bool>::None.serialize(&Serializer::json_compatible())?
                ))
                .is_err()
        );
        assert!(
            admit_companion_identity_status(&Ts::new_unchecked(serde_wasm_bindgen::to_value(
                &true
            )?))
            .is_err()
        );
        assert!(
            admit_companion_handoff_response(&Ts::new_unchecked(
                Option::<bool>::None.serialize(&Serializer::json_compatible())?
            ))
            .is_err()
        );
        Ok(())
    }
}

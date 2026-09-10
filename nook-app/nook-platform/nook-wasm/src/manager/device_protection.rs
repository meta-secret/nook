//! Passkey-PRF setup, unlock, and recovery orchestration.

use super::NookVaultManager;
use crate::BrowserPasskeyClient;
use crate::BrowserPasskeyCreationOptions;
use crate::BrowserPasskeyObservation;
use crate::BrowserPasskeyPasskeyLabelWithDeviceId;
use crate::BrowserPasskeyPrfOutput;
use crate::BrowserPasskeyRequestOptions;
use crate::BrowserPasskeySignalCurrentUserDetails;
use crate::NookDatabase;
use crate::manager::session::ExtensionHandoffState;
use crate::storage::identity_record::ProtectedIdentityLookup;
use crate::storage::identity_record::ProtectedLocalIdentity;
use nook_companion_core::CompanionIdentityHandoffContext;
#[path = "device_protection_recovery.rs"]
mod device_protection_recovery;
pub(in crate::manager) mod handoff_stages;
mod handoff_transition;
use crate::storage::device_access;
use crate::storage::device_access::PasskeyCreationCeremony;
use crate::storage::{event_db, identity_record};
use crate::{DeviceProtectionDeviceModeState, NookDeviceAccessSnapshotRequest};
use crate::{NookError, NookPasskeySetup, NookPasskeyUnlockOptions};
use crate::{passkey_browser, passkey_observation};
pub use handoff_stages::{
    NookAdoptedExtensionIdentityHandoff, NookCommittedExtensionIdentityHandoff,
    NookPendingExtensionIdentityHandoff,
};
use nook_core::{
    AgeArmoredCiphertext, AppId, DeviceId, DeviceIdentity, DeviceIdentityProtection,
    DeviceIdentitySecret, DeviceKeyProtectionSetup, DeviceMode, DeviceProtectionStatus,
    DevicePublicKey, DeviceSigningPublicKey, HandoffSigningSeedChoice, PasskeyDeviceProtectionMode,
    PasskeyRecoveryRequest, PasskeyRegistration, PasskeyRegistrationInput,
    PasskeyRegistrationOutcome, PasskeyRegistrationPrfOutput, StoreId, WebAuthnCredentialId,
    WebAuthnPrfInput, WebAuthnPrfOutput, WebAuthnUserHandle, WrappedDeviceIdentity, i18n_keys,
};
use std::mem;
use wasm_bindgen::JsError;
use wasm_bindgen::prelude::wasm_bindgen;
use zeroize::{Zeroize, Zeroizing};

enum ExtensionIdentityHandoffContextValue {
    VaultCreation,
    PairedVault { store_id: nook_core::StoreId },
    ExistingVaultImport { store_id: nook_core::StoreId },
}

pub(crate) enum PendingExtensionIdentityEnrollment {
    VaultCreation {
        authorizer: Option<nook_core::AppKey>,
    },
    PairedVault {
        authorizer: nook_core::AppKey,
        store_id: nook_core::StoreId,
    },
    PairedVaultSessionUnlock {
        store_id: nook_core::StoreId,
    },
    ExistingVaultImport {
        store_id: nook_core::StoreId,
    },
}

pub(in crate::manager) struct PendingExtensionIdentityHandoff {
    pub(in crate::manager) enrollment: PendingExtensionIdentityEnrollment,
    pub(in crate::manager) authorizer_signing:
        Option<(nook_core::AppId, nook_core::DeviceSigningPublicKey)>,
    pub(in crate::manager) signing_public_key: nook_core::DeviceSigningPublicKey,
    pub(in crate::manager) handoff_signing_seed: String,
    pub(in crate::manager) persist_signing_seed: bool,
    pub(in crate::manager) previous_session_signing_seed: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use nook_core::{AppKey, SigningIdentity};
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    fn retry_reset_preserves_the_staged_handoff_signer() -> Result<(), NookError> {
        let staged_store_id = nook_core::StoreId::generate()?;
        let authorizer = AppKey::generate()?;
        let (signing, signing_seed) = SigningIdentity::generate()?;
        let mut manager = NookVaultManager::new();
        manager.event_log.signing_seed = "session-signer".to_owned();
        manager.device.pending_extension_handoff = Some(PendingExtensionIdentityHandoff {
            enrollment: PendingExtensionIdentityEnrollment::PairedVault {
                authorizer,
                store_id: staged_store_id,
            },
            authorizer_signing: None,
            signing_public_key: signing.public_key(),
            handoff_signing_seed: signing_seed.as_str().to_owned(),
            persist_signing_seed: true,
            previous_session_signing_seed: String::new(),
        });

        manager.reset_vault_session_for_handoff_retry();

        assert_eq!(manager.event_log.signing_seed, signing_seed.as_str());
        assert!(manager.device.pending_extension_handoff.is_some());
        Ok(())
    }

    #[wasm_bindgen_test]
    fn lock_clears_session_keys_so_access_can_project_a_locked_identity() -> Result<(), NookError> {
        let identity = DeviceIdentity::generate()?;
        let mut manager = NookVaultManager::new();
        manager.device.identity_private_key = identity.secret_string().into_inner();

        manager.lock_device_identity();

        assert!(manager.device.identity_private_key.is_empty());
        assert!(manager.device_access_snapshot_request().is_ok());
        assert!(manager.identity_directory_snapshot_request().is_ok());
        Ok(())
    }

    #[wasm_bindgen_test]
    fn failed_handoff_clears_the_adopted_public_app_id() -> Result<(), NookError> {
        let identity = DeviceIdentity::generate()?;
        let mut manager = NookVaultManager::new();
        manager.device.id = identity.device_id().to_string();
        manager.device.identity_private_key = identity.secret_string().into_inner();

        manager.rollback_extension_identity_handoff();

        assert!(manager.device.id.is_empty());
        assert!(manager.device.identity_private_key.is_empty());
        Ok(())
    }

    #[wasm_bindgen_test]
    fn paired_vault_handoff_after_lock_adopts_the_extension_without_a_local_app_key()
    -> Result<(), NookError> {
        let context = NookExtensionIdentityHandoffContext {
            value: ExtensionIdentityHandoffContextValue::PairedVault {
                store_id: nook_core::StoreId::generate()?,
            },
        };

        let enrollment = (&context).pending_extension_enrollment(None)?;

        assert!(matches!(
            enrollment,
            PendingExtensionIdentityEnrollment::PairedVaultSessionUnlock { .. }
        ));
        Ok(())
    }

    #[wasm_bindgen_test]
    fn handoff_enrollment_variants_preserve_authorization_context() -> Result<(), NookError> {
        let vault_creation = NookExtensionIdentityHandoffContext {
            value: ExtensionIdentityHandoffContextValue::VaultCreation,
        };
        assert!(matches!(
            (&vault_creation).pending_extension_enrollment(None)?,
            PendingExtensionIdentityEnrollment::VaultCreation { authorizer: None }
        ));

        let authorizer = AppKey::generate()?;
        assert!(matches!(
            (&vault_creation).pending_extension_enrollment(Some(&authorizer))?,
            PendingExtensionIdentityEnrollment::VaultCreation {
                authorizer: Some(_)
            }
        ));

        let store_id = nook_core::StoreId::generate()?;
        let paired = NookExtensionIdentityHandoffContext {
            value: ExtensionIdentityHandoffContextValue::PairedVault {
                store_id: store_id.clone(),
            },
        };
        assert!(matches!(
            (&paired).pending_extension_enrollment(None)?,
            PendingExtensionIdentityEnrollment::PairedVaultSessionUnlock { store_id: id }
                if id == store_id
        ));
        assert!(matches!(
            (&paired).pending_extension_enrollment(Some(&authorizer))?,
            PendingExtensionIdentityEnrollment::PairedVault { store_id: id, .. }
                if id == store_id
        ));

        let imported = NookExtensionIdentityHandoffContext {
            value: ExtensionIdentityHandoffContextValue::ExistingVaultImport {
                store_id: store_id.clone(),
            },
        };
        assert!(matches!(
            (&imported).pending_extension_enrollment(None)?,
            PendingExtensionIdentityEnrollment::ExistingVaultImport { store_id: id }
                if id == store_id
        ));
        Ok(())
    }

    #[wasm_bindgen_test]
    fn passkey_device_modes_are_mapped_without_numeric_fallbacks() {
        assert_eq!(
            NookVaultManager::passkey_mode_from_device_mode(DeviceMode::Standard),
            PasskeyDeviceProtectionMode::Standard
        );
        assert_eq!(
            NookVaultManager::passkey_mode_from_device_mode(DeviceMode::AntiHacker),
            PasskeyDeviceProtectionMode::AntiHacker
        );
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
#[path = "device_protection_browser_tests.rs"]
mod browser_tests;

impl Drop for PendingExtensionIdentityHandoff {
    fn drop(&mut self) {
        self.previous_session_signing_seed.zeroize();
        self.handoff_signing_seed.zeroize();
    }
}

/// Security context for adopting an extension identity.
#[wasm_bindgen]
pub struct NookExtensionIdentityHandoffContext {
    value: ExtensionIdentityHandoffContextValue,
}

#[wasm_bindgen]
impl NookExtensionIdentityHandoffContext {
    #[must_use]
    pub fn vault_creation() -> Self {
        Self {
            value: ExtensionIdentityHandoffContextValue::VaultCreation,
        }
    }

    pub fn paired_vault(store_id: &str) -> Result<Self, JsError> {
        Ok(Self {
            value: ExtensionIdentityHandoffContextValue::PairedVault {
                store_id: StoreId::parse(store_id)?,
            },
        })
    }

    pub fn existing_vault_import(store_id: &str) -> Result<Self, JsError> {
        Ok(Self {
            value: ExtensionIdentityHandoffContextValue::ExistingVaultImport {
                store_id: StoreId::parse(store_id)?,
            },
        })
    }

    pub(in crate::manager) fn from_companion(
        context: CompanionIdentityHandoffContext,
    ) -> Result<Self, JsError> {
        match context {
            CompanionIdentityHandoffContext::VaultCreation { .. } => Ok(Self::vault_creation()),
            CompanionIdentityHandoffContext::PairedVault { vault_store_id } => {
                Self::paired_vault(&vault_store_id)
            }
            CompanionIdentityHandoffContext::ExistingVaultImport { vault_store_id } => {
                Self::existing_vault_import(&vault_store_id)
            }
        }
    }
}

impl NookExtensionIdentityHandoffContext {
    fn pending_extension_enrollment(
        &self,
        authorizer: Option<&nook_core::AppKey>,
    ) -> Result<PendingExtensionIdentityEnrollment, NookError> {
        let context = self;
        match &context.value {
            ExtensionIdentityHandoffContextValue::VaultCreation => {
                Ok(PendingExtensionIdentityEnrollment::VaultCreation {
                    authorizer: authorizer.cloned(),
                })
            }
            ExtensionIdentityHandoffContextValue::PairedVault { store_id } => match authorizer {
                Some(app_key) => Ok(PendingExtensionIdentityEnrollment::PairedVault {
                    authorizer: app_key.clone(),
                    store_id: store_id.clone(),
                }),
                None => Ok(
                    PendingExtensionIdentityEnrollment::PairedVaultSessionUnlock {
                        store_id: store_id.clone(),
                    },
                ),
            },
            ExtensionIdentityHandoffContextValue::ExistingVaultImport { store_id } => {
                Ok(PendingExtensionIdentityEnrollment::ExistingVaultImport {
                    store_id: store_id.clone(),
                })
            }
        }
    }
}

#[wasm_bindgen]
impl NookVaultManager {
    /// Require passkey authorization again before any device-key operation.
    #[wasm_bindgen]
    pub fn lock_device_identity(&mut self) {
        self.device.handoff_generation = Default::default();
        self.device.identity_private_key.zeroize();
        self.device.identity_private_key.clear();
        self.device.extension_handoff_private_key.zeroize();
        self.device.extension_handoff_private_key.clear();
        self.event_log.signing_seed.zeroize();
        self.event_log.signing_seed.clear();
    }

    /// Create a one-time age recipient for an extension identity handoff.
    /// The matching private key remains inside this manager's Rust state.
    #[wasm_bindgen]
    pub fn begin_extension_identity_handoff(
        &mut self,
    ) -> Result<NookPendingExtensionIdentityHandoff, JsError> {
        self.device.handoff_generation = Default::default();
        self.device.extension_handoff_private_key.zeroize();
        let recipient = DeviceIdentity::generate()?;
        self.device.extension_handoff_private_key =
            ExtensionHandoffState::Recipient((recipient.secret_string().into_inner()).into());
        Ok(NookPendingExtensionIdentityHandoff::new(
            self,
            recipient.public_key().into_inner(),
        ))
    }

    /// Seal the currently unlocked extension identity to a one-time website
    /// recipient. Plaintext private material never crosses the WASM boundary.
    #[wasm_bindgen]
    pub async fn seal_extension_identity_handoff(
        &mut self,
        request: nook_core::ExtensionIdentityHandoffSealRequest,
    ) -> Result<String, JsError> {
        // The caller's prior status observation cannot authorize a later seal.
        self.ensure_device_identity()?;
        let signing = self.ensure_signing_identity().await?;
        let identity = self.ensure_device_identity()?;
        let source = nook_core::ExtensionIdentityHandoffSource {
            identity: &identity,
            signing: &signing,
        };
        if matches!(
            source.binding(&request),
            nook_core::ExtensionIdentityHandoffSourceBinding::DifferentIdentity
        ) {
            return Err(JsError::new(
                "Extension identity request does not match this device.",
            ));
        }
        let recipient_public_key = DevicePublicKey::parse(&request.recipient_public_key)?;
        Ok(nook_core::ExtensionIdentityHandoffSeal {
            identity: &identity,
            signing_seed: &self.event_log.signing_seed,
            recipient_public_key: &recipient_public_key,
            nonce: &request.nonce,
        }
        .seal()?
        .into_inner())
    }

    #[wasm_bindgen]
    pub async fn device_protection_status(
        &self,
    ) -> Result<nook_core::DeviceProtectionStatus, JsError> {
        if !self.device.identity_private_key.is_empty() {
            return Ok(DeviceProtectionStatus::Unlocked);
        }
        Ok(self.persisted_device_protection_status().await?)
    }

    /// Project Devices & access from the live Rust session. Caller-owned web
    /// state is not authoritative because a failed handoff may have populated
    /// it before this manager rolls the identity back.
    #[wasm_bindgen]
    pub fn device_access_snapshot_request(
        &self,
    ) -> Result<crate::NookDeviceAccessSnapshotRequest, JsError> {
        // A locked or rolled-back session must still project persisted passkey
        // evidence. Do not fail the dashboard when in-memory keys cannot be
        // parsed after lock or a failed handoff.
        let session_device_id = self.device.public_app_id();
        Ok(NookDeviceAccessSnapshotRequest::new(
            session_device_id,
            (!self.device.identity_private_key.is_empty()).into(),
        ))
    }

    #[wasm_bindgen]
    pub async fn set_device_access_passkey_name(
        &self,
        app_id: String,
        credential_fingerprint: String,
        name: String,
    ) -> Result<(), JsError> {
        AppId::parse(&app_id)?;
        device_access::AppPasskeyNameUpdate {
            app_id: &app_id,
            credential_fingerprint: &credential_fingerprint,
            name: &name,
        }
        .apply()
        .await
        .map_err(Into::into)
    }

    /// Return the product device-protection mode persisted during device setup.
    #[wasm_bindgen]
    pub async fn device_protection_device_mode(
        &self,
    ) -> Result<crate::DeviceProtectionDeviceModeState, JsError> {
        let ProtectedIdentityLookup::Configured(ProtectedLocalIdentity {
            wrapped_identity: wrapped,
            ..
        }) = self.load_protected_local_identity().await?
        else {
            return Ok(DeviceProtectionDeviceModeState::Missing);
        };
        Ok(match wrapped {
            WrappedDeviceIdentity::Pin(_) => DeviceProtectionDeviceModeState::Pin,
            WrappedDeviceIdentity::PasskeyDerived(_) => DeviceProtectionDeviceModeState::Standard,
            WrappedDeviceIdentity::PasskeyWrappedLocal(_) => {
                DeviceProtectionDeviceModeState::AntiHacker
            }
        })
    }

    #[wasm_bindgen]
    pub async fn begin_device_protection(&mut self) -> Result<NookPasskeySetup, JsError> {
        if !self.is_creating_local_identity()
            && self.device.identity_private_key.is_empty()
            && matches!(
                self.persisted_device_protection_status().await?,
                DeviceProtectionStatus::Passkey | DeviceProtectionStatus::Pin
            )
        {
            return Err(NookError::Decryption(
                i18n_keys::ERRORS_DEVICE_PROTECTION_AUTHORIZATION_REQUIRED.to_owned(),
            )
            .into());
        }

        let setup = DeviceKeyProtectionSetup::generate()?;
        Ok(NookPasskeySetup::from_core(&setup))
    }

    #[wasm_bindgen]
    pub async fn setup_device_protection_with_passkey(
        &mut self,
        rp_id: &str,
        rp_name: &str,
        passkey_label: &str,
    ) -> Result<(), JsError> {
        self.setup_device_protection_with_passkey_mode(
            rp_id,
            rp_name,
            passkey_label,
            DeviceMode::Standard,
        )
        .await
    }

    #[wasm_bindgen]
    pub async fn setup_device_protection_with_passkey_mode(
        &mut self,
        rp_id: &str,
        rp_name: &str,
        passkey_label: &str,
        device_mode: nook_core::DeviceMode,
    ) -> Result<(), JsError> {
        let creating_local_identity = self.is_creating_local_identity();
        let result: Result<(), JsError> = async {
            let mode = NookVaultManager::passkey_mode_from_device_mode(device_mode);
            let passkey_label = BrowserPasskeyClient::normalized_passkey_label(passkey_label);
            let setup = self.begin_device_protection().await?;
            let user_handle = setup.user_handle();
            let prf_input = setup.prf_input();
            let creation_options =
                BrowserPasskeyClient::creation_options(BrowserPasskeyCreationOptions {
                    rp_id: rp_id,
                    rp_name: rp_name,
                    passkey_label: &passkey_label,
                    user_handle: &user_handle,
                    prf_input: &prf_input,
                })?;
            let credential = BrowserPasskeyClient::create_credential(&creation_options).await?;
            let mut observation =
                BrowserPasskeyObservation::new(&credential).observe_registration();
            let credential_id = BrowserPasskeyClient::credential_id(&credential)?;
            let credential_id = WebAuthnCredentialId::try_from(credential_id)?;
            let user_handle = WebAuthnUserHandle::try_from(user_handle)?;
            let prf_input = WebAuthnPrfInput::try_from(prf_input)?;
            let create_prf_output = BrowserPasskeyClient::prf_output(BrowserPasskeyPrfOutput {
                credential: &credential,
                requirement: crate::PasskeyPrfRequirement::Enabled,
            })?
            .map(Zeroizing::new);
            let create_prf_output = create_prf_output
                .as_deref()
                .map(|output| WebAuthnPrfOutput::try_from(output.clone()))
                .transpose()?;
            let resolution = PasskeyRegistration::new(PasskeyRegistrationInput {
                credential_id: &credential_id,
                user_handle: &user_handle,
                prf_input: &prf_input,
                mode,
            })
            .resolve(match create_prf_output {
                Some(output) => PasskeyRegistrationPrfOutput::Available(output),
                None => PasskeyRegistrationPrfOutput::Unavailable,
            })?;
            let (material, ceremony) = match resolution {
                PasskeyRegistrationOutcome::Complete(material) => {
                    (*material, PasskeyCreationCeremony::RegistrationOnly)
                }
                PasskeyRegistrationOutcome::NeedsAssertion(pending) => {
                    let request = pending.request();
                    let request_options =
                        BrowserPasskeyClient::request_options(BrowserPasskeyRequestOptions {
                            rp_id: rp_id,
                            credential_id: request.credential_id().as_ref(),
                            prf_input: request.prf_input().as_ref(),
                        })?;
                    let credential = BrowserPasskeyClient::get_credential(&request_options).await?;
                    observation = observation.merge_usage(
                        BrowserPasskeyObservation::new(&credential).observe_assertion(),
                    );
                    let prf_output =
                        Zeroizing::new(BrowserPasskeyClient::require_prf_output(&credential)?);
                    let prf_output = WebAuthnPrfOutput::try_from(prf_output.to_vec())?;
                    (
                        pending.complete(&prf_output)?,
                        PasskeyCreationCeremony::RegistrationAndAssertion,
                    )
                }
            };
            let device_id = self.save_passkey_material(&material).await?;
            let credential_fingerprint =
                nook_core::PasskeyAccessProfile::credential_identifier(credential_id.as_ref());
            let _ = device_access::AppPasskeyCreation {
                app_id: &device_id,
                credential_fingerprint: &credential_fingerprint,
                nook_name: &passkey_label,
                observation,
                ceremony,
            }
            .apply()
            .await;
            let updated_label = BrowserPasskeyClient::passkey_label_with_device_id(
                BrowserPasskeyPasskeyLabelWithDeviceId {
                    passkey_label: &passkey_label,
                    device_id: &device_id,
                },
            );
            BrowserPasskeyClient::signal_current_user_details(
                BrowserPasskeySignalCurrentUserDetails {
                    rp_id: rp_id,
                    user_handle: user_handle.as_ref(),
                    passkey_label: &updated_label,
                },
            )
            .await;
            Ok(())
        }
        .await;
        if result.is_err() && !creating_local_identity {
            self.clear_failed_device_protection();
        }
        result
    }

    #[wasm_bindgen]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: exchanges `finish_device_protection` bytes with JavaScript as a Uint8Array"
        )
    )]
    pub async fn finish_device_protection(
        &mut self,
        credential_id: Vec<u8>,
        user_handle: Vec<u8>,
        prf_input: Vec<u8>,
        prf_output: Vec<u8>,
    ) -> Result<(), JsError> {
        self.finish_device_protection_with_mode(
            credential_id,
            user_handle,
            prf_input,
            prf_output,
            DeviceMode::Standard,
        )
        .await
    }

    #[wasm_bindgen]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: exchanges `finish_device_protection_with_mode` bytes with JavaScript as a Uint8Array"
        )
    )]
    pub async fn finish_device_protection_with_mode(
        &mut self,
        credential_id: Vec<u8>,
        user_handle: Vec<u8>,
        prf_input: Vec<u8>,
        mut prf_output: Vec<u8>,
        device_mode: nook_core::DeviceMode,
    ) -> Result<(), JsError> {
        let creating_local_identity = self.is_creating_local_identity();
        let mode = NookVaultManager::passkey_mode_from_device_mode(device_mode);
        let result = async {
            let credential_id = WebAuthnCredentialId::try_from(credential_id)?;
            let user_handle = WebAuthnUserHandle::try_from(user_handle)?;
            let prf_input = WebAuthnPrfInput::try_from(prf_input)?;
            let typed_prf_output = WebAuthnPrfOutput::try_from(prf_output.clone())?;
            let material = PasskeyRegistration::new(PasskeyRegistrationInput {
                credential_id: &credential_id,
                user_handle: &user_handle,
                prf_input: &prf_input,
                mode,
            })
            .complete(&typed_prf_output)?;
            self.save_passkey_material(&material).await
        }
        .await;
        prf_output.zeroize();
        if result.is_err() && !creating_local_identity {
            self.clear_failed_device_protection();
        }
        result.map(|_| ()).map_err(Into::into)
    }

    #[wasm_bindgen]
    pub async fn recover_device_protection_with_passkey(
        &mut self,
        rp_id: &str,
    ) -> Result<(), JsError> {
        let request_options = BrowserPasskeyClient::recovery_options(rp_id)?;
        let credential = BrowserPasskeyClient::get_credential(&request_options).await?;
        let observation = BrowserPasskeyObservation::new(&credential).observe_assertion();
        let credential_id = BrowserPasskeyClient::credential_id(&credential)?;
        let credential_fingerprint =
            nook_core::PasskeyAccessProfile::credential_identifier(&credential_id);
        let user_handle = BrowserPasskeyClient::assertion_user_handle(&credential)?;
        let prf_output = BrowserPasskeyClient::require_prf_output(&credential)?;
        self.recover_device_protection_with_passkey_material(
            credential_id,
            user_handle,
            prf_output,
        )
        .await?;
        let app_id = self.device.public_app_id();
        let _ = device_access::AppPasskeyUse {
            app_id: &app_id,
            credential_fingerprint: &credential_fingerprint,
            observation,
        }
        .apply()
        .await;
        Ok(())
    }

    #[wasm_bindgen]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: exchanges `recover_device_protection_with_passkey_material` bytes with JavaScript as a Uint8Array"
        )
    )]
    pub async fn recover_device_protection_with_passkey_material(
        &mut self,
        credential_id: Vec<u8>,
        user_handle: Vec<u8>,
        mut prf_output: Vec<u8>,
    ) -> Result<(), JsError> {
        let result = async {
            let credential_id = WebAuthnCredentialId::try_from(credential_id)?;
            let user_handle = WebAuthnUserHandle::try_from(user_handle)?;
            let typed_prf_output = WebAuthnPrfOutput::try_from(prf_output.clone())?;
            let material = PasskeyRecoveryRequest::deterministic().recover(
                &nook_core::PasskeyRecoveryInput {
                    credential_id: &credential_id,
                    user_handle: &user_handle,
                    prf_output: &typed_prf_output,
                },
            )?;
            self.save_passkey_material(&material).await
        }
        .await;
        prf_output.zeroize();
        result.map(|_| ()).map_err(Into::into)
    }

    #[wasm_bindgen]
    pub async fn finish_pin_device_protection(&mut self, pin: String) -> Result<(), JsError> {
        let creating_local_identity = self.is_creating_local_identity();
        let pin = Zeroizing::new(pin);
        let result = async {
            let identity = if self.is_creating_local_identity() {
                DeviceIdentity::generate()?
            } else if self.device.identity_private_key.is_empty() {
                if matches!(
                    self.persisted_device_protection_status().await?,
                    DeviceProtectionStatus::Passkey | DeviceProtectionStatus::Pin
                ) {
                    return Err(NookError::Decryption(
                        i18n_keys::ERRORS_DEVICE_PROTECTION_AUTHORIZATION_REQUIRED.to_owned(),
                    ));
                }
                DeviceIdentity::generate()?
            } else {
                self.device_identity()?
            };
            let record = DeviceIdentityProtection::new(&identity.secret_string()).with_pin(&pin)?;
            self.persist_and_adopt_local_identity(identity, &record)
                .await?;
            Ok(())
        }
        .await;
        if result.is_err() && !creating_local_identity {
            self.clear_failed_device_protection();
        }
        result.map_err(Into::into)
    }

    #[wasm_bindgen]
    pub async fn passkey_unlock_options(&self) -> Result<NookPasskeyUnlockOptions, JsError> {
        let ProtectedLocalIdentity {
            wrapped_identity: record,
            ..
        } = match self.load_protected_local_identity().await? {
            ProtectedIdentityLookup::Configured(value) => Ok(value),
            ProtectedIdentityLookup::Unconfigured => Err({
                NookError::IndexedDb("No passkey-protected device identity found.".to_owned())
            }),
        }?;
        Ok(NookPasskeyUnlockOptions::from_core(&record)?)
    }

    #[wasm_bindgen]
    pub async fn unlock_device_protection_with_passkey(
        &mut self,
        rp_id: &str,
    ) -> Result<(), JsError> {
        let options = self.passkey_unlock_options().await?;
        let request_options = options.request_options(rp_id)?;
        let credential = BrowserPasskeyClient::get_credential(&request_options).await?;
        let observation = BrowserPasskeyObservation::new(&credential).observe_assertion();
        let credential_id = BrowserPasskeyClient::credential_id(&credential)?;
        let credential_fingerprint =
            nook_core::PasskeyAccessProfile::credential_identifier(&credential_id);
        let prf_output = BrowserPasskeyClient::require_prf_output(&credential)?;
        self.unlock_device_identity(prf_output).await?;
        let app_id = self.device.public_app_id();
        let _ = device_access::AppPasskeyUse {
            app_id: &app_id,
            credential_fingerprint: &credential_fingerprint,
            observation,
        }
        .apply()
        .await;
        Ok(())
    }

    #[wasm_bindgen]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: exchanges `unlock_device_identity` bytes with JavaScript as a Uint8Array"
        )
    )]
    pub async fn unlock_device_identity(&mut self, mut prf_output: Vec<u8>) -> Result<(), JsError> {
        let result: Result<(), NookError> = async {
            let ProtectedLocalIdentity {
                app_id: stored_device_id,
                wrapped_identity: record,
            } = match self.load_protected_local_identity().await? {
                ProtectedIdentityLookup::Configured(value) => Ok(value),
                ProtectedIdentityLookup::Unconfigured => Err({
                    NookError::IndexedDb("No passkey-protected device identity found.".to_owned())
                }),
            }?;
            let typed_prf_output = WebAuthnPrfOutput::try_from(prf_output.clone())?;
            let secret = record.unlock_passkey(&nook_core::PasskeyIdentityUnlock {
                stored_device_id: stored_device_id.as_str(),
                prf_output: &typed_prf_output,
            })?;
            let app_key = DeviceIdentity::from_secret_str(&secret)?;
            self.adopt_unlocked_local_identity(app_key, &record).await
        }
        .await;
        prf_output.zeroize();
        result.map_err(Into::into)
    }

    #[wasm_bindgen]
    pub async fn unlock_pin_device_identity(&mut self, pin: String) -> Result<(), JsError> {
        let pin = Zeroizing::new(pin);
        let result = async {
            let ProtectedLocalIdentity {
                app_id: stored_device_id,
                wrapped_identity: record,
            } = match self.load_protected_local_identity().await? {
                ProtectedIdentityLookup::Configured(value) => Ok(value),
                ProtectedIdentityLookup::Unconfigured => Err({
                    NookError::IndexedDb("No PIN-protected device identity found.".to_owned())
                }),
            }?;
            let secret = record.unwrap_pin(&pin)?;
            let identity = DeviceIdentity::from_secret_str(&secret)?;
            if identity.device_id().as_str() != stored_device_id.as_str() {
                return Err(NookError::Decryption(
                    "Protected device identity does not match device_id.".to_owned(),
                ));
            }
            self.adopt_unlocked_local_identity(identity, &record).await
        }
        .await;
        result.map_err(Into::into)
    }
}

impl NookVaultManager {
    fn passkey_mode_from_device_mode(
        device_mode: nook_core::DeviceMode,
    ) -> nook_core::PasskeyDeviceProtectionMode {
        match device_mode {
            DeviceMode::Standard => PasskeyDeviceProtectionMode::Standard,
            DeviceMode::AntiHacker => PasskeyDeviceProtectionMode::AntiHacker,
        }
    }
}

impl NookVaultManager {}

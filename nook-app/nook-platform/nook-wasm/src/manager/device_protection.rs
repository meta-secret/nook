//! Passkey-PRF setup, unlock, and recovery orchestration.

use super::NookVaultManager;
use crate::storage::{auth_providers, device_access, indexed_db};
use crate::{NookError, NookPasskeySetup, NookPasskeyUnlockOptions};
use crate::{passkey_browser, passkey_observation};
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

    #[test]
    fn retry_reset_preserves_the_staged_handoff_signer() -> Result<(), NookError> {
        let staged_store_id = nook_core::generate_store_id()?;
        let authorizer = nook_core::AppKey::generate()?;
        let (signing, signing_seed) = nook_core::SigningIdentity::generate()?;
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

    #[test]
    fn lock_clears_session_keys_so_access_can_project_a_locked_identity() -> Result<(), NookError> {
        let identity = nook_core::DeviceIdentity::generate()?;
        let mut manager = NookVaultManager::new();
        manager.device.identity_private_key = identity.secret_string().into_inner();

        manager.lock_device_identity();

        assert!(manager.device.identity_private_key.is_empty());
        assert!(manager.device_access_snapshot_request().is_ok());
        assert!(manager.identity_directory_snapshot_request().is_ok());
        Ok(())
    }

    #[test]
    fn paired_vault_handoff_after_lock_adopts_the_extension_without_a_local_app_key()
    -> Result<(), NookError> {
        let context = NookExtensionIdentityHandoffContext {
            value: ExtensionIdentityHandoffContextValue::PairedVault {
                store_id: nook_core::generate_store_id()?,
            },
        };

        let enrollment = pending_extension_enrollment(&context, None)?;

        assert!(matches!(
            enrollment,
            PendingExtensionIdentityEnrollment::PairedVaultSessionUnlock { .. }
        ));
        Ok(())
    }
}

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
                store_id: nook_core::StoreId::parse(store_id)?,
            },
        })
    }

    pub fn existing_vault_import(store_id: &str) -> Result<Self, JsError> {
        Ok(Self {
            value: ExtensionIdentityHandoffContextValue::ExistingVaultImport {
                store_id: nook_core::StoreId::parse(store_id)?,
            },
        })
    }
}

fn pending_extension_enrollment(
    context: &NookExtensionIdentityHandoffContext,
    authorizer: Option<&nook_core::AppKey>,
) -> Result<PendingExtensionIdentityEnrollment, NookError> {
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

#[wasm_bindgen]
impl NookVaultManager {
    /// Require passkey authorization again before any device-key operation.
    #[wasm_bindgen]
    pub fn lock_device_identity(&mut self) {
        self.device.identity_private_key.zeroize();
        self.device.identity_private_key.clear();
        self.device.extension_handoff_private_key.zeroize();
        self.device.extension_handoff_private_key.clear();
    }

    /// Create a one-time age recipient for an extension identity handoff.
    /// The matching private key remains inside this manager's Rust state.
    #[wasm_bindgen]
    pub fn begin_extension_identity_handoff(&mut self) -> Result<String, JsError> {
        self.device.extension_handoff_private_key.zeroize();
        let recipient = nook_core::DeviceIdentity::generate()?;
        self.device.extension_handoff_private_key = recipient.secret_string().into_inner();
        Ok(recipient.public_key().into_inner())
    }

    /// Seal the currently unlocked extension identity to a one-time website
    /// recipient. Plaintext private material never crosses the WASM boundary.
    #[wasm_bindgen]
    pub async fn seal_extension_identity_handoff(
        &mut self,
        recipient_public_key: &str,
        nonce: &str,
    ) -> Result<String, JsError> {
        let identity = self.ensure_device_identity()?;
        self.ensure_signing_identity().await?;
        let recipient_public_key = nook_core::DevicePublicKey::parse(recipient_public_key)?;
        Ok(nook_core::seal_extension_identity_handoff(
            &identity,
            &self.event_log.signing_seed,
            &recipient_public_key,
            nonce,
        )?
        .into_inner())
    }

    /// Open and validate an extension identity handoff, then adopt both the age
    /// identity and its matching event-signing seed for this in-memory session.
    #[wasm_bindgen]
    pub async fn finish_extension_identity_handoff(
        &mut self,
        envelope: &str,
        nonce: &str,
        expected_device_id: &str,
        expected_device_public_key: &str,
        expected_device_signing_public_key: &str,
        context: &NookExtensionIdentityHandoffContext,
    ) -> Result<(), JsError> {
        let private_key = Zeroizing::new(std::mem::take(
            &mut self.device.extension_handoff_private_key,
        ));
        if private_key.is_empty() {
            return Err(NookError::Decryption(
                "Extension identity handoff was not initialized.".to_owned(),
            )
            .into());
        }
        let recipient = nook_core::DeviceIdentity::from_secret_str(
            &nook_core::DeviceIdentitySecret::parse(&private_key)?,
        )?;
        let expected_signing_public_key =
            nook_core::DeviceSigningPublicKey::parse(expected_device_signing_public_key)?;
        let material = nook_core::open_extension_identity_handoff(
            &recipient,
            &nook_core::AgeArmoredCiphertext::parse(envelope)?,
            nonce,
            &nook_core::DeviceId::parse(expected_device_id)?,
            &nook_core::DevicePublicKey::parse(expected_device_public_key)?,
            &expected_signing_public_key,
        )?;
        let (identity, handoff_signing_seed) = material.into_parts();
        let authorizer = if self.device.identity_private_key.is_empty() {
            None
        } else {
            let app_key = self.device_identity()?;
            let signing_public_key = self.ensure_signing_identity().await?.public_key();
            Some((app_key, signing_public_key))
        };
        let enrollment =
            pending_extension_enrollment(context, authorizer.as_ref().map(|(app_key, _)| app_key))?;

        // Age identity may come from a reinstalled extension. Keep any durable
        // authorized signer when the vault already has events so Approve does
        // not append JoinApproved as an unauthorized actor.
        let stored_seed = crate::storage::event_db::load_signing_seed().await?;
        let has_events = self.event_log_has_events().await?;
        let pending_handoff_signing_seed = handoff_signing_seed.clone();
        let importing_existing_vault = matches!(
            &enrollment,
            PendingExtensionIdentityEnrollment::ExistingVaultImport { .. }
        );
        let choice = if importing_existing_vault {
            nook_core::HandoffSigningSeedChoice::AdoptHandoff {
                seed: handoff_signing_seed,
                persist: false,
            }
        } else {
            nook_core::choose_signing_seed_after_identity_handoff(
                handoff_signing_seed,
                stored_seed,
                has_events,
            )
        };
        let persist_signing_seed = importing_existing_vault
            || matches!(
                &choice,
                nook_core::HandoffSigningSeedChoice::AdoptHandoff { persist: true, .. }
            );

        let previous_session_signing_seed = std::mem::take(&mut self.event_log.signing_seed);
        self.device.identity_private_key.zeroize();
        self.device.id = identity.device_id().as_str().to_owned();
        self.device.identity_private_key = identity.secret_string().into_inner();
        self.event_log.signing_seed.zeroize();
        match choice {
            nook_core::HandoffSigningSeedChoice::KeepStored { seed } => {
                self.event_log.signing_seed = seed;
            }
            nook_core::HandoffSigningSeedChoice::AdoptHandoff { seed, persist } => {
                self.event_log.signing_seed = seed;
                debug_assert_eq!(persist, persist_signing_seed);
            }
        }
        self.device.pending_extension_handoff = Some(PendingExtensionIdentityHandoff {
            enrollment,
            authorizer_signing: authorizer.map(|(app_key, signing_public_key)| {
                (app_key.app_id().clone(), signing_public_key)
            }),
            signing_public_key: expected_signing_public_key,
            handoff_signing_seed: pending_handoff_signing_seed,
            persist_signing_seed,
            previous_session_signing_seed,
        });
        Ok(())
    }

    /// Whether durable identity publication must wait for a verified connect.
    #[wasm_bindgen]
    pub fn extension_identity_handoff_requires_connect(&self) -> bool {
        self.device
            .pending_extension_handoff
            .as_ref()
            .is_some_and(|pending| {
                matches!(
                    &pending.enrollment,
                    PendingExtensionIdentityEnrollment::VaultCreation { .. }
                        | PendingExtensionIdentityEnrollment::PairedVault { .. }
                        | PendingExtensionIdentityEnrollment::PairedVaultSessionUnlock { .. }
                        | PendingExtensionIdentityEnrollment::ExistingVaultImport { .. }
                )
            })
    }

    /// Reclassify a deferred handoff after staged provider discovery has bound
    /// the manager to the existing vault that must be verified before publish.
    #[wasm_bindgen]
    pub fn mark_extension_identity_handoff_existing_vault_import(&mut self) -> Result<(), JsError> {
        let store_id = nook_core::StoreId::parse(&self.vault.store_id)?;
        let pending = self
            .device
            .pending_extension_handoff
            .as_mut()
            .ok_or_else(|| JsError::new("Extension identity handoff is not pending."))?;
        pending.enrollment = PendingExtensionIdentityEnrollment::ExistingVaultImport { store_id };
        pending.authorizer_signing = None;
        pending.persist_signing_seed = true;
        self.event_log.signing_seed.zeroize();
        self.event_log
            .signing_seed
            .clone_from(&pending.handoff_signing_seed);
        Ok(())
    }

    /// Atomically persist identity membership and its matching signing seed
    /// after the caller's complete initialization flow succeeds.
    #[wasm_bindgen]
    pub async fn commit_extension_identity_handoff(&mut self) -> Result<(), JsError> {
        let pending = self
            .device
            .pending_extension_handoff
            .as_ref()
            .ok_or_else(|| JsError::new("Extension identity handoff is not pending."))?;
        if !matches!(
            &pending.enrollment,
            PendingExtensionIdentityEnrollment::PairedVault { .. }
        ) {
            return Err(JsError::new(
                "This extension identity handoff must be finalized by verified connect.",
            ));
        }
        let app_key = self.device_identity()?;
        let signing_seed = pending
            .persist_signing_seed
            .then_some(self.event_log.signing_seed.as_str());
        crate::storage::identity_record::commit_authenticated_identity_handoff(
            crate::storage::identity_record::IdentityHandoffCommit {
                app_key: &app_key,
                signing_public_key: &pending.signing_public_key,
                authorizer_signing: pending.authorizer_signing.as_ref(),
                enrollment: &pending.enrollment,
                signing_seed,
                existing_vault: None,
            },
        )
        .await?;
        Ok(())
    }

    /// Accept a committed handoff after the complete caller-owned operation,
    /// including fresh vault genesis, has succeeded.
    #[wasm_bindgen]
    pub fn confirm_extension_identity_handoff(&mut self) {
        self.device.pending_extension_handoff = None;
    }

    /// Clear every secret installed by a failed external identity
    /// authorization, including the event-log signing seed.
    #[wasm_bindgen]
    pub fn rollback_extension_identity_handoff(&mut self) {
        if let Some(mut pending) = self.device.pending_extension_handoff.take() {
            self.event_log.signing_seed.zeroize();
            self.event_log.signing_seed =
                std::mem::take(&mut pending.previous_session_signing_seed);
        }
        self.lock_device_identity();
        self.reset_vault_session();
    }

    #[wasm_bindgen]
    pub async fn device_protection_status(
        &self,
    ) -> Result<nook_core::DeviceProtectionStatus, JsError> {
        if !self.device.identity_private_key.is_empty() {
            return Ok(nook_core::DeviceProtectionStatus::Unlocked);
        }
        Ok(indexed_db::device_identity_protection_status().await?)
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
        Ok(crate::NookDeviceAccessSnapshotRequest::new(
            session_device_id,
        ))
    }

    /// Return the product device-protection mode persisted during device setup.
    #[wasm_bindgen]
    pub async fn device_protection_device_mode(
        &self,
    ) -> Result<crate::DeviceProtectionDeviceModeState, JsError> {
        Ok(indexed_db::device_identity_device_mode().await?)
    }

    #[wasm_bindgen]
    pub async fn begin_device_protection(&mut self) -> Result<NookPasskeySetup, JsError> {
        if self.device.identity_private_key.is_empty()
            && matches!(
                indexed_db::device_identity_protection_status().await?,
                nook_core::DeviceProtectionStatus::Passkey | nook_core::DeviceProtectionStatus::Pin
            )
        {
            return Err(NookError::Decryption(
                nook_core::i18n_keys::ERRORS_DEVICE_PROTECTION_AUTHORIZATION_REQUIRED.to_owned(),
            )
            .into());
        }

        let setup = nook_core::DeviceKeyProtectionSetup::generate()?;
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
            nook_core::DeviceMode::Standard,
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
        let mode = passkey_mode_from_device_mode(device_mode);
        let passkey_label = passkey_browser::normalized_passkey_label(passkey_label);
        let setup = self.begin_device_protection().await?;
        let user_handle = setup.user_handle();
        let prf_input = setup.prf_input();
        let creation_options = passkey_browser::creation_options(
            rp_id,
            rp_name,
            &passkey_label,
            &user_handle,
            &prf_input,
        )?;
        let credential = passkey_browser::create_credential(&creation_options).await?;
        let mut observation = passkey_observation::observe_registration(&credential);
        let credential_id = passkey_browser::credential_id(&credential)?;
        let create_prf_output = passkey_browser::prf_output(&credential, true)?.map(Zeroizing::new);
        let resolution = nook_core::resolve_passkey_registration_for_mode(
            &credential_id,
            &user_handle,
            &prf_input,
            match create_prf_output.as_deref() {
                Some(output) => nook_core::PasskeyRegistrationPrfOutput::Available(output),
                None => nook_core::PasskeyRegistrationPrfOutput::Unavailable,
            },
            mode,
        )?;
        let (material, ceremony) = match resolution {
            nook_core::PasskeyRegistrationResolution::Complete(material) => (
                *material,
                device_access::PasskeyCreationCeremony::RegistrationOnly,
            ),
            nook_core::PasskeyRegistrationResolution::NeedsAssertion(request) => {
                let request_options = passkey_browser::request_options(
                    rp_id,
                    request.credential_id(),
                    request.prf_input(),
                )?;
                let credential = passkey_browser::get_credential(&request_options).await?;
                observation.merge_usage(passkey_observation::observe_assertion(&credential));
                let prf_output = Zeroizing::new(passkey_browser::require_prf_output(&credential)?);
                (
                    nook_core::finish_passkey_device_identity_for_mode(
                        request.credential_id(),
                        &user_handle,
                        request.prf_input(),
                        prf_output.as_slice(),
                        mode,
                    )?,
                    device_access::PasskeyCreationCeremony::RegistrationAndAssertion,
                )
            }
        };
        let result = self.save_passkey_material(&material).await;
        let device_id = result?;
        let credential_fingerprint = nook_core::passkey_credential_identifier(&credential_id);
        let _ = device_access::record_passkey_created(
            &credential_fingerprint,
            &passkey_label,
            observation,
            ceremony,
        )
        .await;
        let updated_label =
            passkey_browser::passkey_label_with_device_id(&passkey_label, &device_id);
        passkey_browser::signal_current_user_details(rp_id, &user_handle, &updated_label).await;
        Ok(())
    }

    #[wasm_bindgen]
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
            nook_core::DeviceMode::Standard,
        )
        .await
    }

    #[wasm_bindgen]
    pub async fn finish_device_protection_with_mode(
        &mut self,
        credential_id: Vec<u8>,
        user_handle: Vec<u8>,
        prf_input: Vec<u8>,
        mut prf_output: Vec<u8>,
        device_mode: nook_core::DeviceMode,
    ) -> Result<(), JsError> {
        let mode = passkey_mode_from_device_mode(device_mode);
        let result = async {
            let material = nook_core::finish_passkey_device_identity_for_mode(
                &credential_id,
                &user_handle,
                &prf_input,
                &prf_output,
                mode,
            )?;
            self.save_passkey_material(&material).await
        }
        .await;
        prf_output.zeroize();
        result.map(|_| ()).map_err(Into::into)
    }

    #[wasm_bindgen]
    pub async fn recover_device_protection_with_passkey(
        &mut self,
        rp_id: &str,
    ) -> Result<(), JsError> {
        let request_options = passkey_browser::recovery_options(rp_id)?;
        let credential = passkey_browser::get_credential(&request_options).await?;
        let observation = passkey_observation::observe_assertion(&credential);
        let credential_id = passkey_browser::credential_id(&credential)?;
        let credential_fingerprint = nook_core::passkey_credential_identifier(&credential_id);
        let user_handle = passkey_browser::assertion_user_handle(&credential)?;
        let prf_output = passkey_browser::require_prf_output(&credential)?;
        self.recover_device_protection_with_passkey_material(
            credential_id,
            user_handle,
            prf_output,
        )
        .await?;
        let _ = device_access::record_passkey_used(&credential_fingerprint, observation).await;
        Ok(())
    }

    #[wasm_bindgen]
    pub async fn recover_device_protection_with_passkey_material(
        &mut self,
        credential_id: Vec<u8>,
        user_handle: Vec<u8>,
        mut prf_output: Vec<u8>,
    ) -> Result<(), JsError> {
        let result = async {
            let material = nook_core::recover_passkey_device_identity(
                &credential_id,
                &user_handle,
                &prf_output,
            )?;
            self.save_passkey_material(&material).await
        }
        .await;
        prf_output.zeroize();
        result.map(|_| ()).map_err(Into::into)
    }

    #[wasm_bindgen]
    pub async fn finish_pin_device_protection(&mut self, pin: String) -> Result<(), JsError> {
        let pin = Zeroizing::new(pin);
        let result = async {
            if self.device.identity_private_key.is_empty() {
                if matches!(
                    indexed_db::device_identity_protection_status().await?,
                    nook_core::DeviceProtectionStatus::Passkey
                        | nook_core::DeviceProtectionStatus::Pin
                ) {
                    return Err(NookError::Decryption(
                        nook_core::i18n_keys::ERRORS_DEVICE_PROTECTION_AUTHORIZATION_REQUIRED
                            .to_owned(),
                    ));
                }
                let identity = nook_core::DeviceIdentity::generate()?;
                self.device.id = identity.device_id().to_string();
                self.device.identity_private_key = identity.secret_string().into_inner();
            }

            let identity = self.device_identity()?;
            let record = nook_core::wrap_device_identity_with_pin(&identity.secret_string(), &pin)?;
            indexed_db::save_wrapped_device_identity(&self.device.id, &record).await?;
            crate::storage::identity_record::ensure_local_identity_for_app_key(
                &identity, "Personal",
            )
            .await?;
            Ok(())
        }
        .await;
        result.map_err(Into::into)
    }

    #[wasm_bindgen]
    pub async fn passkey_unlock_options(&self) -> Result<NookPasskeyUnlockOptions, JsError> {
        let (_, record) = indexed_db::load_wrapped_device_identity()
            .await?
            .ok_or_else(|| {
                NookError::IndexedDb("No passkey-protected device identity found.".to_owned())
            })?;
        Ok(NookPasskeyUnlockOptions::from_core(&record)?)
    }

    #[wasm_bindgen]
    pub async fn unlock_device_protection_with_passkey(
        &mut self,
        rp_id: &str,
    ) -> Result<(), JsError> {
        let options = self.passkey_unlock_options().await?;
        let request_options = options.request_options(rp_id)?;
        let credential = passkey_browser::get_credential(&request_options).await?;
        let observation = passkey_observation::observe_assertion(&credential);
        let credential_id = passkey_browser::credential_id(&credential)?;
        let credential_fingerprint = nook_core::passkey_credential_identifier(&credential_id);
        let prf_output = passkey_browser::require_prf_output(&credential)?;
        self.unlock_device_identity(prf_output).await?;
        let _ = device_access::record_passkey_used(&credential_fingerprint, observation).await;
        Ok(())
    }

    #[wasm_bindgen]
    pub async fn unlock_device_identity(&mut self, mut prf_output: Vec<u8>) -> Result<(), JsError> {
        let result: Result<(), NookError> = async {
            let (stored_device_id, record) = indexed_db::load_wrapped_device_identity()
                .await?
                .ok_or_else(|| {
                    NookError::IndexedDb("No passkey-protected device identity found.".to_owned())
                })?;
            let secret =
                nook_core::unlock_passkey_device_identity(&stored_device_id, &record, &prf_output)?;
            self.device.id = stored_device_id;
            self.device.identity_private_key = secret.into_inner();
            Ok(())
        }
        .await;
        prf_output.zeroize();
        result.map_err(Into::into)
    }

    #[wasm_bindgen]
    pub async fn unlock_pin_device_identity(&mut self, pin: String) -> Result<(), JsError> {
        let pin = Zeroizing::new(pin);
        let result = async {
            let (stored_device_id, record) = indexed_db::load_wrapped_device_identity()
                .await?
                .ok_or_else(|| {
                    NookError::IndexedDb("No PIN-protected device identity found.".to_owned())
                })?;
            let secret = nook_core::unwrap_device_identity_with_pin(&record, &pin)?;
            let identity = nook_core::DeviceIdentity::from_secret_str(&secret)?;
            if identity.device_id().as_str() != stored_device_id {
                return Err(NookError::Decryption(
                    "Protected device identity does not match device_id.".to_owned(),
                ));
            }
            self.device.id = stored_device_id;
            self.device.identity_private_key = secret.into_inner();
            Ok(())
        }
        .await;
        result.map_err(Into::into)
    }

    /// Zeroize this tab before another tab performs destructive local recovery.
    #[wasm_bindgen]
    pub fn quiesce_for_local_recovery(&mut self) {
        self.reset_vault_session();
        self.device.identity_private_key.zeroize();
        self.device.extension_handoff_private_key.zeroize();
        self.device.id.clear();
        self.storage.access_token.zeroize();
        self.storage.remote_ref.clear();
        self.storage.remote_path.clear();
        self.storage.drive_event_parent = nook_core::DriveEventParent::AppDataFolder;
        self.storage.mode = nook_core::StorageMode::Local;
    }

    /// Destructive local recovery: forget the inaccessible identity and its
    /// identity-sealed provider credentials, preserving local encrypted vaults.
    #[wasm_bindgen]
    pub async fn reset_device_protection_for_recovery(&mut self) -> Result<(), JsError> {
        self.quiesce_for_local_recovery();
        indexed_db::delete_device_identity_for_recovery().await?;
        auth_providers::delete_auth_providers_db().await?;
        Ok(())
    }
}

fn passkey_mode_from_device_mode(
    device_mode: nook_core::DeviceMode,
) -> nook_core::PasskeyDeviceProtectionMode {
    match device_mode {
        nook_core::DeviceMode::Standard => nook_core::PasskeyDeviceProtectionMode::Standard,
        nook_core::DeviceMode::AntiHacker => nook_core::PasskeyDeviceProtectionMode::AntiHacker,
    }
}

impl NookVaultManager {
    pub(in crate::manager) async fn save_passkey_material(
        &mut self,
        material: &nook_core::PasskeyDeviceIdentityMaterial,
    ) -> Result<String, NookError> {
        indexed_db::save_wrapped_device_identity(material.device_id(), material.record()).await?;
        self.device.id = material.device_id().to_owned();
        self.device.identity_private_key = material.identity_secret().clone().into_inner();
        let identity = self.device_identity()?;
        crate::storage::identity_record::ensure_local_identity_for_app_key(&identity, "Personal")
            .await?;
        Ok(self.device.id.clone())
    }
}

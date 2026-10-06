//! Local wrapper authority for descriptive extension protection metadata.
use crate::storage::device_access::{self, DeviceAccessProfileKey, PasskeyCreationCeremony};
use crate::storage::identity_record::ProtectedIdentityLookup;
use crate::{NookError, NookVaultManager};
use nook_core::{
    AppProtectionAppBinding, AppProtectionAppBindingRequest, AppProtectionDescriptor,
    AppProtectionDescriptorSource, PasskeyAccessProfile, PasskeyBrowserObservation,
};
use wasm_bindgen::{JsError, prelude::wasm_bindgen};
#[wasm_bindgen]
impl NookVaultManager {
    #[wasm_bindgen]
    pub async fn record_extension_passkey_creation(
        &self,
        passkey_label: String,
    ) -> Result<(), JsError> {
        let ProtectedIdentityLookup::Configured(protected) =
            self.load_protected_local_identity().await?
        else {
            return Err(NookError::AppProtectionUnavailable.into());
        };
        let app = self.device_identity()?;
        match (AppProtectionAppBindingRequest {
            observed: &protected.app_id,
            expected: app.app_id(),
        })
        .classify()
        {
            AppProtectionAppBinding::Matched => {}
            AppProtectionAppBinding::DifferentApp => {
                return Err(NookError::AppProtectionBindingMismatch.into());
            }
        }
        let credential = protected.wrapped_identity.credential_id()?;
        let fingerprint = PasskeyAccessProfile::credential_identifier(credential.as_ref());
        device_access::AppPasskeyCreation {
            app_id: protected.app_id.as_str(),
            credential_fingerprint: &fingerprint,
            nook_name: &passkey_label,
            observation: PasskeyBrowserObservation::default(),
            ceremony: PasskeyCreationCeremony::RegistrationAndAssertion,
        }
        .apply_required()
        .await?;
        Ok(())
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod tests {
    use super::*;
    use nook_core::{AgeArmoredCiphertext, AppKey, AppProtectionAssociation, DeviceMode};
    use tsify::Ts;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    async fn pre_vault_handoff_transfers_exact_protected_credential_without_registering_again()
    -> Result<(), JsError> {
        let mut manager = NookVaultManager::new();
        manager.delete_local_browser_data().await?;
        manager
            .finish_device_protection_with_mode(
                vec![7; 32],
                vec![8; 32],
                vec![9; 32],
                vec![10; 32],
                DeviceMode::AntiHacker,
            )
            .await?;
        manager
            .record_extension_passkey_creation("Extension passkey".to_owned())
            .await?;
        let app = manager.device_identity()?;
        let signer = manager.ensure_signing_identity().await?;
        let recipient = AppKey::generate()?;
        let request = nook_core::ExtensionIdentityHandoffSealRequest {
            recipient_public_key: recipient.public_key().as_str().to_owned(),
            nonce: "pre-vault-association".to_owned(),
            expected_device_id: app.app_id().as_str().to_owned(),
            expected_device_public_key: app.public_key().as_str().to_owned(),
            expected_device_signing_public_key: signer.public_key().as_str().to_owned(),
        };
        let envelope = manager
            .seal_extension_identity_handoff(&Ts::new_unchecked(serde_wasm_bindgen::to_value(
                &request,
            )?))
            .await?;
        let opened = nook_core::ExtensionIdentityHandoffOpen {
            recipient_identity: &recipient,
            envelope: &AgeArmoredCiphertext::parse(&envelope)?,
            expected_nonce: &request.nonce,
            expected_device_id: app.app_id(),
            expected_device_public_key: &app.public_key(),
            expected_device_signing_public_key: &signer.public_key(),
        }
        .open()?;
        assert_eq!(opened.protection().app_id, *app.app_id());
        let AppProtectionAssociation::PasskeyAntiHacker(profile) = &opened.protection().association
        else {
            return Err(JsError::new("Expected extension passkey"));
        };
        assert_eq!(
            profile.credential_fingerprint,
            PasskeyAccessProfile::credential_identifier(&[7; 32])
        );
        assert_eq!(profile.nook_name, "Extension passkey");
        assert_eq!(
            crate::NookDatabase::load_keyring().await?.entries().len(),
            1
        );
        manager.delete_local_browser_data().await?;
        Ok(())
    }
}
impl NookVaultManager {
    pub(in crate::manager) async fn extension_protection_descriptor(
        &self,
    ) -> Result<nook_core::AppProtectionDescriptor, NookError> {
        let identity = self.device_identity()?;
        let ProtectedIdentityLookup::Configured(protected) =
            self.load_protected_local_identity().await?
        else {
            return Err(NookError::AppProtectionUnavailable);
        };
        match (AppProtectionAppBindingRequest {
            observed: &protected.app_id,
            expected: identity.app_id(),
        })
        .classify()
        {
            AppProtectionAppBinding::Matched => {}
            AppProtectionAppBinding::DifferentApp => {
                return Err(NookError::AppProtectionBindingMismatch);
            }
        }
        let profile = DeviceAccessProfileKey::for_app_id(protected.app_id.as_str())
            .await?
            .load()
            .await?;
        Ok(AppProtectionDescriptor::from_protected(
            AppProtectionDescriptorSource {
                app_id: &protected.app_id,
                wrapped: &protected.wrapped_identity,
                credential: &profile.credential,
            },
        )?)
    }
}

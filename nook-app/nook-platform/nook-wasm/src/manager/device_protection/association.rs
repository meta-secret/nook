//! Records the extension's own passkey against its local protected app key.
use crate::storage::device_access::{self, PasskeyCreationCeremony};
use crate::storage::identity_record::ProtectedIdentityLookup;
use crate::{NookError, NookVaultManager};
use nook_core::{
    AppProtectionAppBinding, AppProtectionAppBindingRequest, PasskeyAccessProfile,
    PasskeyBrowserObservation,
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

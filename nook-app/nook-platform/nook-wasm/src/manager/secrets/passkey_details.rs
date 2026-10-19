//! On-demand public detail projection for one stored website passkey.

use super::NookVaultManager;
use crate::{NookError, NookPasskeyDetails};
use nook_core::{SecretId, SecretValue};
use wasm_bindgen::JsError;
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
impl NookVaultManager {
    /// Decrypt one passkey just long enough to project its public details.
    ///
    /// The full record, including the private key, is zeroized before return
    /// on every path. Non-passkey items are rejected.
    #[wasm_bindgen]
    pub fn passkey_details_js(&self, id: &str) -> Result<NookPasskeyDetails, JsError> {
        let crypto = self.vault.crypto.get()?;
        let id = SecretId::from_vault_record(id);
        let mut record =
            nook_core::VaultSecretSession::new(&self.vault.meta.secrets, crypto).decrypt(&id)?;
        let details = if let SecretValue::Passkey(value) = &record.data {
            value.details()
        } else {
            record.zeroize_plaintext();
            return Err(
                NookError::Database("Requested secret is not a passkey item.".to_owned()).into(),
            );
        };
        record.zeroize_plaintext();
        Ok(NookPasskeyDetails::from_core(details?))
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use super::*;
    use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
    use nook_core::{
        DeviceIdentity, LoginSecret, PasskeyRegistrationRequest, PasskeyRelyingParty, PasskeyUser,
        PasskeyUserVerification, SecretType,
    };
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    fn js<T>(result: Result<T, JsError>) -> anyhow::Result<T> {
        result.map_err(|error| anyhow::anyhow!("{error:?}"))
    }

    #[wasm_bindgen_test]
    fn empty_session_rejects_passkey_details() {
        let manager = NookVaultManager::new();
        assert!(manager.passkey_details_js("secret_missing").is_err());
    }

    #[wasm_bindgen_test]
    async fn stored_passkey_projects_details_and_other_items_are_rejected() -> anyhow::Result<()> {
        let mut manager = NookVaultManager::new();
        js(manager.delete_local_browser_data().await)?;
        let identity = DeviceIdentity::generate()?;
        manager.device.identity_private_key = identity.secret_string().into_inner();
        manager.initialize_genesis_vault(&identity)?;
        manager.vault.store_id = nook_core::StoreId::generate()?.to_string();
        manager.bootstrap_event_log_genesis().await?;

        let request = PasskeyRegistrationRequest {
            origin: "https://login.example.com".to_owned(),
            challenge: URL_SAFE_NO_PAD.encode([7_u8; 32]),
            relying_party: PasskeyRelyingParty {
                id: "example.com".to_owned(),
                name: "Example".to_owned(),
            },
            user: PasskeyUser {
                id: URL_SAFE_NO_PAD.encode(b"user-123"),
                name: "alice@example.com".to_owned(),
                display_name: "Alice".to_owned(),
            },
            algorithms: vec![-7],
            exclude_credentials: Vec::new(),
            resident_key_required: true,
            user_verification: PasskeyUserVerification::Required,
        };
        let credential = request.prepare(&[])?.generate()?.credential;
        let credential_id = credential.credential_id.clone();
        let passkey_id = js(manager.generate_secret_id())?;
        let passkey_data = SecretValue::Passkey(credential).to_yaml()?.into_inner();
        js(manager
            .add_secret(passkey_id.clone(), SecretType::Passkey, passkey_data)
            .await)?;

        let details = js(manager.passkey_details_js(&passkey_id))?;
        assert_eq!(details.credential_id(), credential_id);
        assert_eq!(details.relying_party_name().as_deref(), Some("Example"));
        assert_eq!(
            details.distinct_user_name().as_deref(),
            Some("alice@example.com")
        );
        assert!(details.public_key_fingerprint().starts_with("SHA256:"));
        assert_eq!(details.signature_count(), 0);

        let login_id = js(manager.generate_secret_id())?;
        let login_data = SecretValue::Login(LoginSecret {
            website_url: "https://example.com".to_owned(),
            username: "alice".to_owned(),
            password: "login-password".to_owned(),
            notes: String::new(),
        })
        .to_yaml()?
        .into_inner();
        js(manager
            .add_secret(login_id.clone(), SecretType::Login, login_data)
            .await)?;
        assert!(manager.passkey_details_js(&login_id).is_err());

        js(manager.delete_local_browser_data().await)?;
        Ok(())
    }
}

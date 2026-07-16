//! Website-passkey ceremonies for the unlocked extension vault session.

use super::NookVaultManager;
use crate::storage::event_db::load_local_event_store;
use crate::{NookError, NookPasskeyAccount, NookPasskeyAssertion, NookPasskeyRegistration};
use wasm_bindgen::{JsError, prelude::wasm_bindgen};
use zeroize::Zeroizing;

struct DecryptedPasskeys {
    rows: Vec<(nook_core::SecretId, nook_core::PasskeySecret)>,
}

impl Drop for DecryptedPasskeys {
    fn drop(&mut self) {
        for (_, passkey) in &mut self.rows {
            passkey.zeroize_plaintext();
        }
    }
}

fn passkey_error(error: &nook_core::PasskeyAuthenticatorError) -> JsError {
    let code = match error {
        nook_core::PasskeyAuthenticatorError::InvalidRequest(_) => "passkey-invalid-request",
        nook_core::PasskeyAuthenticatorError::RpOriginMismatch => "passkey-rp-origin-mismatch",
        nook_core::PasskeyAuthenticatorError::UnsupportedAlgorithm => {
            "passkey-unsupported-algorithm"
        }
        nook_core::PasskeyAuthenticatorError::CredentialExcluded => "passkey-credential-excluded",
        nook_core::PasskeyAuthenticatorError::CredentialNotFound => "passkey-not-found",
        nook_core::PasskeyAuthenticatorError::AmbiguousCredential => "passkey-selection-required",
        nook_core::PasskeyAuthenticatorError::InvalidKeyMaterial => "passkey-invalid-key-material",
        nook_core::PasskeyAuthenticatorError::SignatureCounterExhausted => {
            "passkey-counter-exhausted"
        }
        nook_core::PasskeyAuthenticatorError::Serialization => "passkey-serialization-failed",
    };
    JsError::new(code)
}

impl NookVaultManager {
    async fn open_extension_passkey_vault(
        &mut self,
        expected_store_id: &str,
        expected_device_id: &str,
        expected_device_public_key: &str,
        expected_device_signing_public_key: &str,
    ) -> Result<(), NookError> {
        self.ensure_passkey_extension_capability()?;
        let store_id = nook_core::StoreId::parse(expected_store_id)?;
        let expected_device_id = nook_core::DeviceId::parse(expected_device_id)?;
        let expected_public_key = nook_core::DevicePublicKey::parse(expected_device_public_key)?;
        let expected_signing_key =
            nook_core::DeviceSigningPublicKey::parse(expected_device_signing_public_key)?;
        let identity = self.device_identity()?;
        let signing = self.ensure_signing_identity().await?;
        if identity.device_id() != &expected_device_id
            || identity.public_key() != expected_public_key
            || signing.public_key() != expected_signing_key
        {
            return Err(NookError::Decryption(
                "Approved extension grant does not match the unlocked device.".to_owned(),
            ));
        }
        self.vault.store_id = store_id.as_str().to_owned();
        let store = load_local_event_store(store_id.as_str()).await?;
        let graph = store.load_graph(store_id.as_str())?;
        if !nook_core::event_graph_has_active_device_access(
            &graph,
            &expected_device_id,
            &expected_public_key,
            &expected_signing_key,
        )? {
            return Err(NookError::Decryption(
                "Extension vault grant is missing or revoked.".to_owned(),
            ));
        }
        nook_core::materialize_vault_meta_from_graph(&graph, &mut self.vault.meta)?;
        self.ensure_vault_crypto_from_cache().await?;
        self.apply_event_projection_to_session().await?;
        Ok(())
    }

    fn ensure_passkey_extension_capability(&self) -> Result<(), NookError> {
        if self.application != nook_core::VaultApplication::Extension
            && self.application != nook_core::VaultApplication::UnifiedDevelopment
        {
            return Err(NookError::Database(
                "Website passkeys require the extension application capability.".to_owned(),
            ));
        }
        self.application
            .validate_session_access(self.vault.architecture.vault_type)?;
        if self.vault.architecture.vault_type != nook_core::VaultType::Simple {
            return Err(NookError::Database(
                "Website passkeys are available only for Simple Vault.".to_owned(),
            ));
        }
        if self.device.identity_private_key.is_empty() {
            return Err(NookError::Decryption(
                "Extension device identity is locked.".to_owned(),
            ));
        }
        Ok(())
    }

    fn decrypt_passkeys(&self) -> Result<DecryptedPasskeys, NookError> {
        let crypto = self
            .vault
            .crypto
            .as_ref()
            .ok_or_else(|| NookError::Encryption("Vault crypto not initialized.".to_owned()))?;
        let mut passkeys = Vec::new();
        for (id, (secret_type, _)) in &self.vault.meta.secrets {
            if *secret_type != nook_core::SecretType::Passkey {
                continue;
            }
            let mut record =
                nook_core::decrypt_encrypted_secret(&self.vault.meta.secrets, crypto, id)?;
            if let nook_core::SecretValue::Passkey(passkey) = &record.data {
                passkeys.push((id.clone(), passkey.clone()));
            }
            record.zeroize_plaintext();
        }
        Ok(DecryptedPasskeys { rows: passkeys })
    }
}

#[wasm_bindgen]
impl NookVaultManager {
    #[wasm_bindgen(js_name = openExtensionPasskeyVault)]
    pub async fn open_extension_passkey_vault_js(
        &mut self,
        expected_store_id: &str,
        expected_device_id: &str,
        expected_device_public_key: &str,
        expected_device_signing_public_key: &str,
    ) -> Result<(), JsError> {
        self.open_extension_passkey_vault(
            expected_store_id,
            expected_device_id,
            expected_device_public_key,
            expected_device_signing_public_key,
        )
        .await
        .map_err(Into::into)
    }

    #[wasm_bindgen(js_name = listWebsitePasskeyAccounts)]
    pub async fn list_website_passkey_accounts(
        &mut self,
        rp_id: &str,
        origin: &str,
    ) -> Result<Vec<NookPasskeyAccount>, JsError> {
        self.ensure_passkey_extension_capability()?;
        self.ensure_vault_crypto_from_cache().await?;
        nook_core::validate_website_passkey_origin(rp_id, origin)
            .map_err(|error| passkey_error(&error))?;
        let passkeys = self.decrypt_passkeys()?;
        let accounts = passkeys
            .rows
            .iter()
            .filter(|(_, passkey)| passkey.rp_id.eq_ignore_ascii_case(rp_id))
            .map(|(_, passkey)| NookPasskeyAccount::from_core(passkey))
            .collect();
        Ok(accounts)
    }

    #[wasm_bindgen(js_name = registerWebsitePasskey)]
    pub async fn register_website_passkey(
        &mut self,
        request_json: &str,
    ) -> Result<NookPasskeyRegistration, JsError> {
        self.ensure_passkey_extension_capability()?;
        self.ensure_vault_crypto_from_cache().await?;
        let request: nook_core::PasskeyRegistrationRequest = serde_json::from_str(request_json)
            .map_err(|_| JsError::new("passkey-invalid-request"))?;
        let existing = self.decrypt_passkeys()?;
        let existing_values = Zeroizing::new(
            existing
                .rows
                .iter()
                .map(|(_, value)| value.clone())
                .collect::<Vec<_>>(),
        );
        let mut result = nook_core::create_website_passkey(&request, &existing_values)
            .map_err(|error| passkey_error(&error))?;
        let id = nook_core::generate_secret_id()?;
        let mut yaml = nook_core::SecretValue::Passkey(result.credential.clone()).to_yaml()?;
        let ciphertext = self
            .vault
            .crypto
            .as_ref()
            .ok_or_else(|| NookError::Encryption("Vault crypto not initialized.".to_owned()))?
            .encrypt_value(yaml.as_str())?;
        yaml.zeroize_plaintext();
        let response = NookPasskeyRegistration::new(
            result.credential.credential_id.clone(),
            result.client_data_json,
            result.attestation_object,
        );
        result.credential.zeroize_plaintext();
        self.append_vault_operations(vec![nook_core::VaultOperation::SecretCreated {
            secret: nook_core::encrypted_secret_from_armored(
                &id,
                nook_core::SecretType::Passkey,
                ciphertext.as_str(),
            ),
        }])
        .await?;
        Ok(response)
    }

    #[wasm_bindgen(js_name = assertWebsitePasskey)]
    pub async fn assert_website_passkey(
        &mut self,
        request_json: &str,
    ) -> Result<NookPasskeyAssertion, JsError> {
        self.ensure_passkey_extension_capability()?;
        self.ensure_vault_crypto_from_cache().await?;
        let request: nook_core::WebsitePasskeyAssertionRequest = serde_json::from_str(request_json)
            .map_err(|_| JsError::new("passkey-invalid-request"))?;
        let passkeys = self.decrypt_passkeys()?;
        let values = Zeroizing::new(
            passkeys
                .rows
                .iter()
                .map(|(_, value)| value.clone())
                .collect::<Vec<_>>(),
        );
        let mut result = nook_core::assert_website_passkey(&request, &values)
            .map_err(|error| passkey_error(&error))?;
        let old_id = passkeys
            .rows
            .iter()
            .filter(|(_, value)| value.credential_id == result.credential_id)
            .max_by_key(|(_, value)| value.signature_count)
            .map(|(id, _)| id.clone())
            .ok_or_else(|| JsError::new("passkey-not-found"))?;
        let duplicate_ids = passkeys
            .rows
            .iter()
            .filter(|(id, value)| id != &old_id && value.credential_id == result.credential_id)
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>();
        let new_id = nook_core::generate_secret_id()?;
        let mut yaml =
            nook_core::SecretValue::Passkey(result.updated_credential.clone()).to_yaml()?;
        let ciphertext = self
            .vault
            .crypto
            .as_ref()
            .ok_or_else(|| NookError::Encryption("Vault crypto not initialized.".to_owned()))?
            .encrypt_value(yaml.as_str())?;
        yaml.zeroize_plaintext();
        result.updated_credential.zeroize_plaintext();
        let response = NookPasskeyAssertion::new(
            result.credential_id,
            result.client_data_json,
            result.authenticator_data,
            result.signature,
            result.user_handle,
        );
        let mut operations = vec![nook_core::VaultOperation::SecretReplaced {
            old_id,
            new_secret: nook_core::encrypted_secret_from_armored(
                &new_id,
                nook_core::SecretType::Passkey,
                ciphertext.as_str(),
            ),
        }];
        operations.extend(
            duplicate_ids
                .into_iter()
                .map(|secret_id| nook_core::VaultOperation::SecretDeleted { secret_id }),
        );
        self.append_vault_operations(operations).await?;
        Ok(response)
    }
}

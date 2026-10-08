//! Website-passkey ceremonies for the unlocked extension vault session.

mod extension_vault;

use super::NookVaultManager;
use nook_core::CheckedPasskeyAssertion;
use nook_core::CheckedPasskeyRegistration;
use nook_core::EncryptedSecretPayload;
use nook_core::SecretId;
use nook_core::VaultSecretSession;
use tsify::Tsify;

use crate::{NookError, NookPasskeyAccount, NookPasskeyAssertion, NookPasskeyRegistration};
use js_sys::Object;
use nook_core::{PasskeyAuthenticatorError, SecretType, SecretValue, SymmetricKey, VaultOperation};
use wasm_bindgen::{JsError, prelude::wasm_bindgen};
use zeroize::Zeroizing;

struct DecryptedPasskeys {
    rows: Vec<(nook_core::SecretId, nook_core::PasskeySecret)>,
}

impl DecryptedPasskeys {
    fn into_accounts(mut self, rp_id: &str) -> Vec<NookPasskeyAccount> {
        let mut accounts = Vec::new();
        self.rows.reverse();
        while let Some((_, mut passkey)) = self.rows.pop() {
            if passkey.rp_id.eq_ignore_ascii_case(rp_id) {
                accounts.push(NookPasskeyAccount::from(passkey));
            } else {
                passkey.zeroize_plaintext();
            }
        }
        accounts
    }
}

impl Drop for DecryptedPasskeys {
    fn drop(&mut self) {
        for (_, passkey) in &mut self.rows {
            passkey.zeroize_plaintext();
        }
    }
}

impl NookVaultManager {
    fn passkey_error(error: &nook_core::PasskeyAuthenticatorError) -> JsError {
        JsError::new(NookVaultManager::passkey_error_code(error))
    }
}

impl NookVaultManager {
    fn passkey_error_code(error: &nook_core::PasskeyAuthenticatorError) -> &'static str {
        match error {
            PasskeyAuthenticatorError::InvalidRequest(_) => "passkey-invalid-request",
            PasskeyAuthenticatorError::RpOriginMismatch => "passkey-rp-origin-mismatch",
            PasskeyAuthenticatorError::UnsupportedAlgorithm => "passkey-unsupported-algorithm",
            PasskeyAuthenticatorError::CredentialExcluded => "passkey-credential-excluded",
            PasskeyAuthenticatorError::CredentialNotFound => "passkey-not-found",
            PasskeyAuthenticatorError::AmbiguousCredential => "passkey-selection-required",
            PasskeyAuthenticatorError::InvalidKeyMaterial => "passkey-invalid-key-material",
            PasskeyAuthenticatorError::SignatureCounterExhausted => "passkey-counter-exhausted",
            PasskeyAuthenticatorError::RandomnessUnavailable => "passkey-randomness-unavailable",
            PasskeyAuthenticatorError::Serialization => "passkey-serialization-failed",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::NookVaultManager;
    use crate::manager::VaultCryptoState;
    use nook_core::SecretId;
    #[cfg(test)]
    #[cfg(test)]
    use nook_core::VaultCrypto;
    #[cfg(test)]
    #[cfg(test)]
    use nook_core::VaultKeys;
    use nook_core::{PasskeyAuthenticatorError, SecretType, StoredRecordPayload};
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    fn randomness_failure_has_a_distinct_browser_error_code() {
        assert_eq!(
            NookVaultManager::passkey_error_code(&PasskeyAuthenticatorError::RandomnessUnavailable),
            "passkey-randomness-unavailable"
        );
    }

    #[wasm_bindgen_test]
    fn every_passkey_failure_maps_to_a_stable_browser_code() {
        let cases = [
            (
                PasskeyAuthenticatorError::InvalidRequest("fixture"),
                "passkey-invalid-request",
            ),
            (
                PasskeyAuthenticatorError::RpOriginMismatch,
                "passkey-rp-origin-mismatch",
            ),
            (
                PasskeyAuthenticatorError::UnsupportedAlgorithm,
                "passkey-unsupported-algorithm",
            ),
            (
                PasskeyAuthenticatorError::CredentialExcluded,
                "passkey-credential-excluded",
            ),
            (
                PasskeyAuthenticatorError::CredentialNotFound,
                "passkey-not-found",
            ),
            (
                PasskeyAuthenticatorError::AmbiguousCredential,
                "passkey-selection-required",
            ),
            (
                PasskeyAuthenticatorError::InvalidKeyMaterial,
                "passkey-invalid-key-material",
            ),
            (
                PasskeyAuthenticatorError::SignatureCounterExhausted,
                "passkey-counter-exhausted",
            ),
            (
                PasskeyAuthenticatorError::RandomnessUnavailable,
                "passkey-randomness-unavailable",
            ),
            (
                PasskeyAuthenticatorError::Serialization,
                "passkey-serialization-failed",
            ),
        ];
        for (error, expected) in cases {
            assert_eq!(NookVaultManager::passkey_error_code(&error), expected);
        }
    }

    #[wasm_bindgen_test]
    fn passkey_crypto_round_trip_decrypts_only_passkey_records() -> anyhow::Result<()> {
        let keys = VaultKeys::generate()?;
        let crypto = VaultCrypto::new(&keys.secrets_key)?;
        let mut manager = NookVaultManager::new();
        manager.vault.secrets_key = keys.secrets_key.as_str().to_owned();
        manager.vault.crypto = VaultCryptoState::Unlocked(crypto);

        let request: nook_core::PasskeyRegistrationRequest =
            serde_json::from_value(serde_json::json!({
                "origin": "https://login.example.com",
                "challenge": "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc",
                "relyingParty": {"id": "example.com", "name": "Example"},
                "user": {"id": "dXNlci0xMjM", "name": "alice@example.com", "displayName": "Alice"},
                "algorithms": [-257, -7],
                "excludeCredentials": [],
                "residentKeyRequired": true,
                "userVerificationRequired": true
            }))?;
        let registration = request
            .prepare(&[])
            .map_err(|error| anyhow::anyhow!("prepare failed: {error:?}"))?
            .generate()
            .map_err(|error| anyhow::anyhow!("generate failed: {error:?}"))?;
        let id = SecretId::generate()?;
        let encrypted = manager.encrypt_passkey_secret(&id, &registration.credential)?;
        manager.vault.meta.apply_record(&encrypted.to_stored())?;
        manager.vault.meta.secrets.insert(
            SecretId::generate()?,
            (
                SecretType::SecureNote,
                StoredRecordPayload::from_trusted("not decrypted".to_owned()),
            ),
        );

        let decrypted = manager.decrypt_passkeys()?;
        assert_eq!(decrypted.rows.len(), 1);
        assert_eq!(
            decrypted
                .rows
                .first()
                .ok_or_else(|| anyhow::anyhow!("decrypted passkey row must be present"))?
                .1
                .rp_id,
            "example.com"
        );
        Ok(())
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use super::*;
    use js_sys::Function;
    #[cfg(test)]
    #[cfg(test)]
    use nook_core::DeviceIdentity;
    #[cfg(test)]
    #[cfg(test)]
    use nook_core::VaultKeys;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    fn ceremony_activity_is_fail_closed() -> Result<(), JsError> {
        let active = Function::new_no_args("return true;");
        assert!(NookVaultManager::ensure_ceremony_active(&active).is_ok());

        let inactive = Function::new_no_args("return false;");
        assert!(NookVaultManager::ensure_ceremony_active(&inactive).is_err());
        let throwing = Function::new_no_args("throw new Error('boom');");
        assert!(NookVaultManager::ensure_ceremony_active(&throwing).is_err());
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn website_passkey_origin_validation_rejects_malformed_input() -> Result<(), JsError> {
        let identity = DeviceIdentity::generate()?;
        let mut manager = NookVaultManager::new();
        manager.device.identity_private_key = identity.secret_string().into_inner();
        assert!(
            manager
                .list_website_passkey_accounts("", "not-an-origin")
                .await
                .is_err()
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn website_passkey_accounts_return_empty_for_an_unmatched_rp() -> Result<(), JsError> {
        let identity = DeviceIdentity::generate()?;
        let keys = VaultKeys::generate()?;
        let mut manager = NookVaultManager::new();
        manager.device.identity_private_key = identity.secret_string().into_inner();
        manager.apply_vault_keys(
            &keys.secrets_key.as_str().to_owned(),
            &keys.members_key.as_str().to_owned(),
        )?;

        let accounts = manager
            .list_website_passkey_accounts("example.com", "https://example.com")
            .await?;
        assert!(accounts.is_empty());
        Ok(())
    }

    #[wasm_bindgen_test]
    fn website_passkey_decoders_reject_invalid_json() {
        assert!(super::decode_website_passkey_registration_request("not-json").is_err());
        assert!(super::decode_website_passkey_assertion_request("not-json").is_err());
    }

    #[wasm_bindgen_test]
    async fn website_passkey_mutations_fail_closed_when_ceremony_is_inactive() -> Result<(), JsError>
    {
        let mut manager = NookVaultManager::new();
        let inactive = Function::new_no_args("return false;");

        assert!(
            manager
                .register_website_passkey(&super::decode_website_passkey_registration_request(r#"{"origin":"https://example.com","challenge":"challenge","relyingParty":{"id":"example.com","name":"Example"},"user":{"id":"user","name":"User","displayName":"User"},"algorithms":[-7],"residentKeyRequired":true,"userVerificationRequired":true}"#)?, &inactive)
                .await
                .is_err()
        );
        assert!(
            manager
                .assert_website_passkey(&super::decode_website_passkey_assertion_request(r#"{"origin":"https://example.com","challenge":"challenge","rpId":"example.com","userVerificationRequired":true}"#)?, &inactive)
                .await
                .is_err()
        );
        Ok(())
    }
}

impl NookVaultManager {
    fn ensure_ceremony_active(ceremony_active: &js_sys::Function) -> Result<(), JsError> {
        let receiver = Object::new();
        let active = ceremony_active
            .call0(&receiver)
            .map_err(|_| JsError::new("passkey-ceremony-expired"))?;
        if active.as_bool() == Some(true) {
            Ok(())
        } else {
            Err(JsError::new("passkey-ceremony-expired"))
        }
    }
}

impl NookVaultManager {
    fn decrypt_passkeys(&self) -> Result<DecryptedPasskeys, NookError> {
        let crypto = self.vault.crypto.get()?;
        let mut passkeys = Vec::new();
        for (id, (secret_type, _)) in &self.vault.meta.secrets {
            if *secret_type != SecretType::Passkey {
                continue;
            }
            let mut record =
                VaultSecretSession::new(&self.vault.meta.secrets, crypto).decrypt(id)?;
            if let SecretValue::Passkey(passkey) = &record.data {
                passkeys.push((id.clone(), passkey.clone()));
            }
            record.zeroize_plaintext();
        }
        Ok(DecryptedPasskeys { rows: passkeys })
    }

    fn encrypt_passkey_secret(
        &self,
        id: &nook_core::SecretId,
        passkey: &nook_core::PasskeySecret,
    ) -> Result<nook_core::EncryptedSecretPayload, NookError> {
        let mut value = SecretValue::Passkey(passkey.clone());
        let secrets_key = SymmetricKey::parse(&self.vault.secrets_key)?;
        let identity_fingerprint = value.identity_fingerprint(&secrets_key)?;
        let fingerprint = value.fingerprint(&secrets_key)?;
        let mut yaml = value.to_yaml()?;
        let ciphertext = self.vault.crypto.get()?.encrypt_value(yaml.as_str())?;
        yaml.zeroize_plaintext();
        value.zeroize_plaintext();
        Ok(EncryptedSecretPayload::from_armored(
            id,
            SecretType::Passkey,
            ciphertext.as_str(),
            identity_fingerprint,
            fingerprint,
        ))
    }
}

#[wasm_bindgen]
impl NookVaultManager {
    #[wasm_bindgen]
    pub async fn list_website_passkey_accounts(
        &mut self,
        rp_id: &str,
        origin: &str,
    ) -> Result<Vec<NookPasskeyAccount>, JsError> {
        self.ensure_passkey_extension_capability()?;
        self.ensure_vault_crypto_from_cache().await?;
        (nook_core::PasskeyOrigin { rp_id, origin })
            .validate()
            .map_err(|error| NookVaultManager::passkey_error(&error))?;
        let passkeys = self.decrypt_passkeys()?;
        Ok(passkeys.into_accounts(rp_id))
    }

    #[wasm_bindgen]
    pub async fn register_website_passkey(
        &mut self,
        request: &tsify::Ts<nook_core::PasskeyRegistrationRequest>,
        ceremony_active: &js_sys::Function,
    ) -> Result<NookPasskeyRegistration, wasm_bindgen::JsError> {
        let request = request
            .to_rust()
            .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;

        NookVaultManager::ensure_ceremony_active(ceremony_active)?;
        self.ensure_passkey_extension_capability()?;
        self.ensure_vault_crypto_from_cache().await?;
        let existing = self.decrypt_passkeys()?;
        let existing_values = Zeroizing::new(
            existing
                .rows
                .iter()
                .map(|(_, value)| value.clone())
                .collect::<Vec<_>>(),
        );
        let mut result = request
            .prepare(&existing_values)
            .and_then(CheckedPasskeyRegistration::generate)
            .map_err(|error| NookVaultManager::passkey_error(&error))?;
        let id = SecretId::generate()?;
        let encrypted = self.encrypt_passkey_secret(&id, &result.credential)?;
        let response = NookPasskeyRegistration::new(
            result.credential.credential_id.clone(),
            result.client_data_json,
            result.attestation_object,
        );
        result.credential.zeroize_plaintext();
        NookVaultManager::ensure_ceremony_active(ceremony_active)?;
        self.append_vault_operations(vec![VaultOperation::SecretCreated { secret: encrypted }])
            .await?;
        Ok::<_, wasm_bindgen::JsError>(response)
    }

    #[wasm_bindgen]
    pub async fn assert_website_passkey(
        &mut self,
        request: &tsify::Ts<nook_core::WebsitePasskeyAssertionRequest>,
        ceremony_active: &js_sys::Function,
    ) -> Result<NookPasskeyAssertion, wasm_bindgen::JsError> {
        let request = request
            .to_rust()
            .map_err(|_| JsError::new("Invalid typed WASM input."))?;

        NookVaultManager::ensure_ceremony_active(ceremony_active)?;
        self.ensure_passkey_extension_capability()?;
        self.ensure_vault_crypto_from_cache().await?;
        let passkeys = self.decrypt_passkeys()?;
        let values = Zeroizing::new(
            passkeys
                .rows
                .iter()
                .map(|(_, value)| value.clone())
                .collect::<Vec<_>>(),
        );
        let mut result = request
            .prepare(&values)
            .and_then(CheckedPasskeyAssertion::sign)
            .map_err(|error| NookVaultManager::passkey_error(&error))?;
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
        let new_id = SecretId::generate()?;
        let encrypted = self.encrypt_passkey_secret(&new_id, &result.updated_credential)?;
        result.updated_credential.zeroize_plaintext();
        let response = NookPasskeyAssertion::new(
            result.credential_id,
            result.client_data_json,
            result.authenticator_data,
            result.signature,
            result.user_handle,
        );
        let mut operations = vec![VaultOperation::SecretReplaced {
            old_id,
            new_secret: encrypted,
        }];
        operations.extend(
            duplicate_ids
                .into_iter()
                .map(|secret_id| VaultOperation::SecretDeleted { secret_id }),
        );
        NookVaultManager::ensure_ceremony_active(ceremony_active)?;
        self.append_vault_operations(operations).await?;
        Ok::<_, wasm_bindgen::JsError>(response)
    }
}

/// Decode the external JSON message exactly once into the canonical registration request.
#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn decode_website_passkey_registration_request(
    json: &str,
) -> Result<tsify::Ts<nook_core::PasskeyRegistrationRequest>, wasm_bindgen::JsError> {
    let result = serde_json::from_str(json).map_err(|_| JsError::new("passkey-invalid-request"))?;
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM value could not be converted."))
}
/// Decode the external JSON message exactly once into the canonical assertion request.
#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn decode_website_passkey_assertion_request(
    json: &str,
) -> Result<tsify::Ts<nook_core::WebsitePasskeyAssertionRequest>, wasm_bindgen::JsError> {
    let result = serde_json::from_str(json).map_err(|_| JsError::new("passkey-invalid-request"))?;
    Tsify::into_ts(&result).map_err(|_| JsError::new("Typed WASM output could not be encoded."))
}

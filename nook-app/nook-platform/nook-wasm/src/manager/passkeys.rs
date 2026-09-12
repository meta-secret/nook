//! Website-passkey ceremonies for the unlocked extension vault session.

use super::NookVaultManager;
use crate::NookDatabase;

use crate::{NookError, NookPasskeyAccount, NookPasskeyAssertion, NookPasskeyRegistration};
use js_sys::Object;
use nook_core::{
    DeviceId, DevicePublicKey, DeviceSigningPublicKey, EventGraphDeviceAccess,
    EventGraphDeviceAccessRequest, PasskeyAuthenticatorError, SecretType, SecretValue, StoreId,
    SymmetricKey, VaultApplication, VaultMetaGraphProjection, VaultOperation, VaultType,
};
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
    use nook_core::{
        PasskeyAuthenticatorError, SecretType, StoredRecordPayload, VaultArchitecture,
    };
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
    fn passkey_capability_requires_unlock_and_simple_architecture() -> anyhow::Result<()> {
        let locked = NookVaultManager::new();
        assert!(locked.ensure_passkey_extension_capability().is_err());

        let identity = nook_core::DeviceIdentity::generate()?;
        let mut ready = NookVaultManager::new();
        ready.device.identity_private_key = identity.secret_string().into_inner();
        assert!(ready.ensure_passkey_extension_capability().is_ok());

        ready.vault.architecture = VaultArchitecture::sentinel_personal(
            nook_core::DeviceMode::Standard,
            nook_core::SentinelPolicy {
                threshold: 2.into(),
                required_participants: 2.into(),
                ready_participants: 0.into(),
            },
        );
        assert!(ready.ensure_passkey_extension_capability().is_err());
        ready.vault.architecture = VaultArchitecture::default();
        ready.application = nook_core::VaultApplication::Simple;
        assert!(ready.ensure_passkey_extension_capability().is_err());
        Ok(())
    }

    #[wasm_bindgen_test]
    fn passkey_crypto_round_trip_decrypts_only_passkey_records() -> anyhow::Result<()> {
        let keys = nook_core::VaultKeys::generate()?;
        let crypto = nook_core::VaultCrypto::new(&keys.secrets_key)?;
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
        let id = nook_core::SecretId::generate()?;
        let encrypted = manager.encrypt_passkey_secret(&id, &registration.credential)?;
        manager.vault.meta.apply_record(&encrypted.to_stored())?;
        manager.vault.meta.secrets.insert(
            nook_core::SecretId::generate()?,
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
        let identity = nook_core::DeviceIdentity::generate()?;
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
        let identity = nook_core::DeviceIdentity::generate()?;
        let keys = nook_core::VaultKeys::generate()?;
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
                .register_website_passkey(super::decode_website_passkey_registration_request(r#"{"origin":"https://example.com","challenge":"challenge","relyingParty":{"id":"example.com","name":"Example"},"user":{"id":"user","name":"User","displayName":"User"},"algorithms":[-7],"residentKeyRequired":true,"userVerificationRequired":true}"#)?, &inactive)
                .await
                .is_err()
        );
        assert!(
            manager
                .assert_website_passkey(super::decode_website_passkey_assertion_request(r#"{"origin":"https://example.com","challenge":"challenge","rpId":"example.com","userVerificationRequired":true}"#)?, &inactive)
                .await
                .is_err()
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn opening_passkey_vault_rejects_malformed_grants_before_storage() -> Result<(), JsError>
    {
        let identity = nook_core::DeviceIdentity::generate()?;
        let store_id = nook_core::StoreId::generate()?.to_string();
        let mut manager = NookVaultManager::new();
        manager.device.identity_private_key = identity.secret_string().into_inner();

        assert!(
            manager
                .open_extension_passkey_vault_js("", "", "", "")
                .await
                .is_err()
        );
        assert!(
            manager
                .open_extension_passkey_vault_js(&store_id, "", "", "")
                .await
                .is_err()
        );
        assert!(
            manager
                .open_extension_passkey_vault_js(
                    &store_id,
                    &identity.device_id().to_string(),
                    &identity.public_key().to_string(),
                    "",
                )
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
    async fn open_extension_passkey_vault(
        &mut self,
        expected_store_id: &str,
        expected_device_id: &str,
        expected_device_public_key: &str,
        expected_device_signing_public_key: &str,
    ) -> Result<(), NookError> {
        self.ensure_passkey_extension_capability()?;
        let store_id = StoreId::parse(expected_store_id)?;
        let expected_device_id = DeviceId::parse(expected_device_id)?;
        let expected_public_key = DevicePublicKey::parse(expected_device_public_key)?;
        let expected_signing_key =
            DeviceSigningPublicKey::parse(expected_device_signing_public_key)?;
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
        let store = NookDatabase::load_local_event_store(store_id.as_str()).await?;
        let graph = store.load_graph(store_id.as_str())?;
        if !EventGraphDeviceAccess::new(&graph).has_access(&EventGraphDeviceAccessRequest {
            expected_device_id: &expected_device_id,
            expected_public_key: &expected_public_key,
            expected_signing_public_key: &expected_signing_key,
        })? {
            return Err(NookError::Decryption(
                "Extension vault grant is missing or revoked.".to_owned(),
            ));
        }
        VaultMetaGraphProjection::new(&graph).materialize(&mut self.vault.meta)?;
        self.ensure_vault_crypto_from_cache().await?;
        self.apply_event_projection_to_session().await?;
        Ok(())
    }

    pub(super) fn ensure_passkey_extension_capability(&self) -> Result<(), NookError> {
        if self.application != VaultApplication::Extension
            && self.application != VaultApplication::UnifiedDevelopment
        {
            return Err(NookError::Database(
                "Website passkeys require the extension application capability.".to_owned(),
            ));
        }
        self.application
            .validate_session_access(self.vault.architecture.vault_type)?;
        if self.vault.architecture.vault_type != VaultType::Simple {
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
        let crypto = self.vault.crypto.get()?;
        let mut passkeys = Vec::new();
        for (id, (secret_type, _)) in &self.vault.meta.secrets {
            if *secret_type != SecretType::Passkey {
                continue;
            }
            let mut record =
                nook_core::VaultSecretSession::new(&self.vault.meta.secrets, crypto).decrypt(id)?;
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
        Ok(nook_core::EncryptedSecretPayload::from_armored(
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
        request: nook_core::PasskeyRegistrationRequest,
        ceremony_active: &js_sys::Function,
    ) -> Result<NookPasskeyRegistration, JsError> {
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
            .and_then(nook_core::CheckedPasskeyRegistration::generate)
            .map_err(|error| NookVaultManager::passkey_error(&error))?;
        let id = nook_core::SecretId::generate()?;
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
        Ok(response)
    }

    #[wasm_bindgen]
    pub async fn assert_website_passkey(
        &mut self,
        request: nook_core::WebsitePasskeyAssertionRequest,
        ceremony_active: &js_sys::Function,
    ) -> Result<NookPasskeyAssertion, JsError> {
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
            .and_then(nook_core::CheckedPasskeyAssertion::sign)
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
        let new_id = nook_core::SecretId::generate()?;
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
        Ok(response)
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
) -> Result<nook_core::PasskeyRegistrationRequest, JsError> {
    serde_json::from_str(json).map_err(|_| JsError::new("passkey-invalid-request"))
}
/// Decode the external JSON message exactly once into the canonical assertion request.
#[wasm_bindgen]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn decode_website_passkey_assertion_request(
    json: &str,
) -> Result<nook_core::WebsitePasskeyAssertionRequest, JsError> {
    serde_json::from_str(json).map_err(|_| JsError::new("passkey-invalid-request"))
}

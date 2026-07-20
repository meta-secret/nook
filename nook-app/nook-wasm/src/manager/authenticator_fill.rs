//! Authenticator metadata and one-time-code generation for the unlocked extension session.

use super::NookVaultManager;
use crate::NookError;
use crate::types::{NookAuthenticatorAccount, NookTotpCode};
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

impl NookVaultManager {
    fn list_authenticator_accounts(&self) -> Result<Vec<NookAuthenticatorAccount>, NookError> {
        let crypto = self
            .vault
            .crypto
            .as_ref()
            .ok_or_else(|| NookError::Encryption("Vault crypto not initialized.".to_owned()))?;
        let mut accounts = Vec::new();
        for (id, (secret_type, _)) in &self.vault.meta.secrets {
            if *secret_type != nook_core::SecretType::Authenticator {
                continue;
            }
            let mut record =
                nook_core::decrypt_encrypted_secret(&self.vault.meta.secrets, crypto, id)?;
            if let nook_core::SecretValue::Authenticator(authenticator) = &record.data {
                accounts.push(NookAuthenticatorAccount::from_authenticator(
                    id,
                    authenticator,
                ));
            }
            record.zeroize_plaintext();
        }
        Ok(accounts)
    }

    fn authenticator_code_for_fill(
        &self,
        secret_id: &str,
        unix_seconds: u32,
    ) -> Result<NookTotpCode, NookError> {
        let id = nook_core::SecretId::parse(secret_id)?;
        let crypto = self
            .vault
            .crypto
            .as_ref()
            .ok_or_else(|| NookError::Encryption("Vault crypto not initialized.".to_owned()))?;
        let mut record =
            nook_core::decrypt_encrypted_secret(&self.vault.meta.secrets, crypto, &id)?;
        let result = match &record.data {
            nook_core::SecretValue::Authenticator(authenticator) => authenticator
                .current_code(u64::from(unix_seconds))
                .map(NookTotpCode::from_core)
                .map_err(NookError::from),
            _ => Err(NookError::Decryption(
                "Selected secret is not an authenticator item.".to_owned(),
            )),
        };
        record.zeroize_plaintext();
        result
    }
}

#[wasm_bindgen]
impl NookVaultManager {
    #[wasm_bindgen(js_name = listAuthenticatorAccounts)]
    pub async fn list_authenticator_accounts_js(
        &mut self,
    ) -> Result<Vec<NookAuthenticatorAccount>, JsError> {
        self.ensure_passkey_extension_capability()?;
        self.ensure_vault_crypto_from_cache().await?;
        self.list_authenticator_accounts().map_err(Into::into)
    }

    #[wasm_bindgen(js_name = currentAuthenticatorCodeForFill)]
    pub async fn current_authenticator_code_for_fill(
        &mut self,
        secret_id: &str,
        unix_seconds: u32,
    ) -> Result<NookTotpCode, JsError> {
        self.ensure_passkey_extension_capability()?;
        self.ensure_vault_crypto_from_cache().await?;
        self.authenticator_code_for_fill(secret_id, unix_seconds)
            .map_err(Into::into)
    }
}

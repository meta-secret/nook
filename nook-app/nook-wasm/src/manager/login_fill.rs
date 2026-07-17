//! Website login list/reveal for the unlocked extension vault session.

use super::NookVaultManager;
use crate::NookError;
use crate::types::{NookLoginAccount, NookLoginFillCredential};
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

impl NookVaultManager {
    fn ensure_login_fill_extension_capability(&self) -> Result<(), NookError> {
        // Same extension Simple Vault boundary as website passkeys.
        self.ensure_passkey_extension_capability()
    }

    fn list_matching_login_accounts(
        &self,
        origin: &str,
    ) -> Result<Vec<NookLoginAccount>, NookError> {
        let crypto = self
            .vault
            .crypto
            .as_ref()
            .ok_or_else(|| NookError::Encryption("Vault crypto not initialized.".to_owned()))?;
        let mut accounts = Vec::new();
        for (id, (secret_type, _)) in &self.vault.meta.secrets {
            if *secret_type != nook_core::SecretType::Login {
                continue;
            }
            let mut record =
                nook_core::decrypt_encrypted_secret(&self.vault.meta.secrets, crypto, id)?;
            if let nook_core::SecretValue::Login(login) = &record.data
                && nook_core::login_host_matches_origin(&login.website_url, origin)
            {
                accounts.push(NookLoginAccount::from_login(id, login));
            }
            record.zeroize_plaintext();
        }
        Ok(accounts)
    }

    fn reveal_matching_login_for_fill(
        &self,
        secret_id: &str,
        origin: &str,
    ) -> Result<NookLoginFillCredential, NookError> {
        let id = nook_core::SecretId::parse(secret_id)?;
        let crypto = self
            .vault
            .crypto
            .as_ref()
            .ok_or_else(|| NookError::Encryption("Vault crypto not initialized.".to_owned()))?;
        let mut record =
            nook_core::decrypt_encrypted_secret(&self.vault.meta.secrets, crypto, &id)?;
        let credential = match &record.data {
            nook_core::SecretValue::Login(login)
                if nook_core::login_host_matches_origin(&login.website_url, origin) =>
            {
                Ok(NookLoginFillCredential::new(
                    login.username.clone(),
                    login.password.clone(),
                ))
            }
            nook_core::SecretValue::Login(_) => Err(NookError::Decryption(
                "Login does not match the requesting website origin.".to_owned(),
            )),
            _ => Err(NookError::Decryption(
                "Selected secret is not a login credential.".to_owned(),
            )),
        };
        record.zeroize_plaintext();
        credential
    }
}

#[wasm_bindgen]
impl NookVaultManager {
    #[wasm_bindgen(js_name = listWebsiteLoginAccounts)]
    pub async fn list_website_login_accounts(
        &mut self,
        origin: &str,
    ) -> Result<Vec<NookLoginAccount>, JsError> {
        self.ensure_login_fill_extension_capability()?;
        self.ensure_vault_crypto_from_cache().await?;
        self.list_matching_login_accounts(origin)
            .map_err(Into::into)
    }

    #[wasm_bindgen(js_name = revealWebsiteLoginForFill)]
    pub async fn reveal_website_login_for_fill(
        &mut self,
        secret_id: &str,
        origin: &str,
    ) -> Result<NookLoginFillCredential, JsError> {
        self.ensure_login_fill_extension_capability()?;
        self.ensure_vault_crypto_from_cache().await?;
        self.reveal_matching_login_for_fill(secret_id, origin)
            .map_err(Into::into)
    }
}

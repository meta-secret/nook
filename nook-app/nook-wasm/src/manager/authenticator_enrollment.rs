//! Consented authenticator enrollment writes for the unlocked extension session.

use super::NookVaultManager;
use crate::NookError;
use wasm_bindgen::{JsError, prelude::wasm_bindgen};
use zeroize::{Zeroize, Zeroizing};

impl NookVaultManager {
    async fn persist_authenticator_yaml(
        &mut self,
        id: String,
        yaml: String,
    ) -> Result<String, JsError> {
        let yaml = Zeroizing::new(yaml);
        self.add_secret(
            id.clone(),
            nook_core::SecretType::Authenticator.as_str().to_owned(),
            yaml.as_str().to_owned(),
        )
        .await?;
        Ok(id)
    }

    async fn attach_authenticator_backup_codes_inner(
        &mut self,
        secret_id: &str,
        codes: Vec<String>,
        mode: &str,
    ) -> Result<String, JsError> {
        let mode = nook_core::BackupCodeAttachMode::parse(mode).map_err(NookError::from)?;
        let id = nook_core::SecretId::parse(secret_id).map_err(NookError::from)?;
        let crypto = self
            .vault
            .crypto
            .as_ref()
            .ok_or_else(|| NookError::Encryption("Vault crypto not initialized.".to_owned()))?;
        let mut record = nook_core::decrypt_encrypted_secret(&self.vault.meta.secrets, crypto, &id)
            .map_err(NookError::from)?;
        let result = match &mut record.data {
            nook_core::SecretValue::Authenticator(authenticator) => {
                let attached =
                    nook_core::apply_backup_codes(&authenticator.backup_codes, &codes, mode)
                        .map_err(NookError::from)?;
                authenticator.backup_codes.zeroize();
                authenticator.backup_codes = attached;
                authenticator.normalize().map_err(NookError::from)?;
                let yaml = nook_core::SecretValue::Authenticator(authenticator.clone())
                    .to_yaml()
                    .map_err(NookError::from)?;
                Ok(yaml.as_str().to_owned())
            }
            _ => Err(NookError::Decryption(
                "Selected secret is not an authenticator item.".to_owned(),
            )),
        };
        record.zeroize_plaintext();
        let yaml = Zeroizing::new(result?);
        let new_id = nook_core::generate_secret_id()
            .map_err(NookError::from)?
            .to_string();
        self.replace_secret(
            secret_id.to_owned(),
            new_id.clone(),
            nook_core::SecretType::Authenticator.as_str().to_owned(),
            yaml.as_str().to_owned(),
        )
        .await?;
        Ok(new_id)
    }
}

#[wasm_bindgen]
impl NookVaultManager {
    /// Create an authenticator from a consented `otpauth://totp/...` URI.
    #[wasm_bindgen(js_name = addAuthenticatorFromOtpauth)]
    pub async fn add_authenticator_from_otpauth_js(
        &mut self,
        uri: &str,
        page_origin: &str,
    ) -> Result<String, JsError> {
        self.ensure_passkey_extension_capability()?;
        self.ensure_vault_crypto_from_cache().await?;
        let mut authenticator =
            nook_core::AuthenticatorSecret::from_otpauth_uri(uri).map_err(NookError::from)?;
        let origin = page_origin.trim();
        if !origin.is_empty() {
            authenticator.website_url = origin.to_owned();
        }
        authenticator.normalize().map_err(NookError::from)?;
        let yaml = Zeroizing::new(
            nook_core::SecretValue::Authenticator(authenticator)
                .to_yaml()
                .map_err(NookError::from)?
                .as_str()
                .to_owned(),
        );
        let id = nook_core::generate_secret_id()
            .map_err(NookError::from)?
            .to_string();
        self.persist_authenticator_yaml(id, yaml.as_str().to_owned())
            .await
    }

    /// Attach reviewed recovery codes to an authenticator via replace/merge.
    #[wasm_bindgen(js_name = attachAuthenticatorBackupCodes)]
    #[allow(clippy::needless_pass_by_value)]
    pub async fn attach_authenticator_backup_codes_js(
        &mut self,
        secret_id: &str,
        codes: Vec<String>,
        mode: &str,
    ) -> Result<String, JsError> {
        self.ensure_passkey_extension_capability()?;
        self.ensure_vault_crypto_from_cache().await?;
        self.attach_authenticator_backup_codes_inner(secret_id, codes, mode)
            .await
    }
}

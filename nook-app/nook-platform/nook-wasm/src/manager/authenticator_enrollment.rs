//! Consented authenticator enrollment writes for the unlocked extension session.

use super::NookVaultManager;
use super::secrets::{SecretProjectionVerification, SecretReplacementInput};
use crate::NookError;
use nook_core::{
    AuthenticatorSecret, BackupCodeAttachMode, SecretId, SecretType, SecretValue, ValidationError,
};
use wasm_bindgen::{JsError, prelude::wasm_bindgen};
use zeroize::{Zeroize, Zeroizing};

/// Proof that reviewed authenticator recovery codes were persisted exactly.
#[wasm_bindgen]
pub struct NookAuthenticatorBackupAttachResult {
    secret_id: String,
    backup_codes_verified: bool,
    reviewed_input_persisted: bool,
}

#[wasm_bindgen]
impl NookAuthenticatorBackupAttachResult {
    #[wasm_bindgen(getter, js_name = secretId)]
    pub fn secret_id(&self) -> String {
        self.secret_id.clone()
    }

    #[wasm_bindgen(getter, js_name = backupCodesVerified)]
    pub fn backup_codes_verified(&self) -> bool {
        self.backup_codes_verified
    }

    #[wasm_bindgen(getter)]
    pub fn reviewed_input_persisted(&self) -> bool {
        self.reviewed_input_persisted
    }
}

impl NookVaultManager {
    async fn persist_authenticator_yaml(
        &mut self,
        id: String,
        yaml: String,
    ) -> Result<String, JsError> {
        let yaml = Zeroizing::new(yaml);
        self.add_secret(
            id.clone(),
            SecretType::Authenticator,
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
    ) -> Result<NookAuthenticatorBackupAttachResult, JsError> {
        let mode = BackupCodeAttachMode::parse(mode)
            .map_err(|_| NookError::from(ValidationError::AuthenticatorBackupCodesInvalid))?;
        let reviewed_codes =
            Zeroizing::new(nook_core::normalize_backup_codes(&codes).map_err(NookError::from)?);
        let id = SecretId::parse(secret_id).map_err(NookError::from)?;
        let crypto = self.vault.crypto.get()?;
        let mut record = nook_core::decrypt_encrypted_secret(&self.vault.meta.secrets, crypto, &id)
            .map_err(NookError::from)?;
        let result = match &mut record.data {
            SecretValue::Authenticator(authenticator) => {
                let attached =
                    nook_core::apply_backup_codes(&authenticator.backup_codes, &codes, mode)
                        .map_err(NookError::from)?;
                authenticator.backup_codes.zeroize();
                authenticator.backup_codes = attached;
                authenticator.normalize().map_err(NookError::from)?;
                let expected_codes = Zeroizing::new(authenticator.backup_codes.clone());
                let yaml = SecretValue::Authenticator(authenticator.clone())
                    .to_yaml()
                    .map_err(NookError::from)?;
                Ok((yaml.as_str().to_owned(), expected_codes))
            }
            _ => Err(NookError::Decryption(
                "Selected secret is not an authenticator item.".to_owned(),
            )),
        };
        record.zeroize_plaintext();
        let (yaml, expected_codes) = result?;
        let yaml = Zeroizing::new(yaml);
        let new_id = nook_core::generate_secret_id()
            .map_err(NookError::from)?
            .to_string();
        self.replace_secret_with_projection_verification(SecretReplacementInput {
            old_id: secret_id.to_owned(),
            new_id: new_id.clone(),
            secret_type: SecretType::Authenticator,
            data: yaml.as_str().to_owned(),
            verification: SecretProjectionVerification::AuthenticatorBackupCodes {
                intended: expected_codes,
                reviewed: reviewed_codes,
                mode,
            },
        })
        .await?;
        Ok(NookAuthenticatorBackupAttachResult {
            secret_id: new_id,
            backup_codes_verified: true,
            reviewed_input_persisted: true,
        })
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod wasm_tests {
    use super::*;
    use nook_core::VaultApplication;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    async fn reviewed_backup_attach_rejects_invalid_input_and_commits_verified_projection()
    -> anyhow::Result<()> {
        let mut manager = NookVaultManager::new();
        manager.application = VaultApplication::Extension;
        manager
            .delete_local_browser_data()
            .await
            .map_err(|error| anyhow::anyhow!("clear browser data: {error:?}"))?;
        manager
            .finish_pin_device_protection("correct horse battery staple".to_owned())
            .await
            .map_err(|error| anyhow::anyhow!("protect extension identity: {error:?}"))?;
        let identity = manager.device_identity()?;
        manager.initialize_genesis_vault(&identity)?;
        manager.vault.store_id = nook_core::generate_store_id()?.to_string();
        manager.bootstrap_event_log_genesis().await?;

        let authenticator = AuthenticatorSecret::from_otpauth_uri(
            "otpauth://totp/Nook:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Nook",
        )?;
        let authenticator_yaml = SecretValue::Authenticator(authenticator).to_yaml()?;
        let original_id = nook_core::generate_secret_id()?.to_string();
        manager
            .persist_authenticator_yaml(original_id.clone(), authenticator_yaml.into_inner())
            .await
            .map_err(|error| anyhow::anyhow!("persist authenticator fixture: {error:?}"))?;
        let event_count_before_rejection = manager.export_event_log_records().await?.len();

        let invalid_codes = vec!["x".repeat(nook_core::MAX_AUTHENTICATOR_BACKUP_CODE_LEN + 1)];
        assert!(
            manager
                .attach_authenticator_backup_codes_inner(
                    original_id.as_str(),
                    invalid_codes,
                    "replace",
                )
                .await
                .is_err()
        );
        assert_eq!(
            manager.export_event_log_records().await?.len(),
            event_count_before_rejection
        );
        assert!(
            manager
                .vault
                .meta
                .secrets
                .contains_key(&SecretId::parse(&original_id)?)
        );

        let reviewed_codes = vec!["  alpha-code  ".to_owned(), "beta-code".to_owned()];
        let proof = manager
            .attach_authenticator_backup_codes_inner(
                original_id.as_str(),
                reviewed_codes,
                "replace",
            )
            .await
            .map_err(|error| anyhow::anyhow!("attach reviewed codes: {error:?}"))?;
        assert!(proof.backup_codes_verified());
        assert!(proof.reviewed_input_persisted());
        assert_eq!(
            manager.export_event_log_records().await?.len(),
            event_count_before_rejection + 1
        );

        let replacement_id = SecretId::parse(&proof.secret_id())?;
        assert!(
            !manager
                .vault
                .meta
                .secrets
                .contains_key(&SecretId::parse(&original_id)?)
        );
        let crypto = manager.vault.crypto.get()?;
        let mut projected = nook_core::decrypt_encrypted_secret(
            &manager.vault.meta.secrets,
            crypto,
            &replacement_id,
        )?;
        let persisted_codes = match &projected.data {
            SecretValue::Authenticator(authenticator) => authenticator.backup_codes.clone(),
            _ => anyhow::bail!("replacement projection is not an authenticator"),
        };
        projected.zeroize_plaintext();
        assert_eq!(persisted_codes, ["alpha-code", "beta-code"]);
        Ok(())
    }
}

#[wasm_bindgen]
impl NookVaultManager {
    /// Create an authenticator from a consented `otpauth://totp/...` URI.
    #[wasm_bindgen]
    pub async fn add_authenticator_from_otpauth_js(
        &mut self,
        uri: &str,
        page_origin: &str,
    ) -> Result<String, JsError> {
        self.ensure_passkey_extension_capability()?;
        self.ensure_vault_crypto_from_cache().await?;
        let mut authenticator =
            AuthenticatorSecret::from_otpauth_uri(uri).map_err(NookError::from)?;
        let origin = page_origin.trim();
        if !origin.is_empty() {
            authenticator.website_url = origin.to_owned();
        }
        authenticator.normalize().map_err(NookError::from)?;
        let yaml = Zeroizing::new(
            SecretValue::Authenticator(authenticator)
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
    #[wasm_bindgen]
    #[allow(clippy::needless_pass_by_value)]
    pub async fn attach_authenticator_backup_codes_js(
        &mut self,
        secret_id: &str,
        codes: Vec<String>,
        mode: &str,
    ) -> Result<NookAuthenticatorBackupAttachResult, JsError> {
        self.ensure_passkey_extension_capability()?;
        self.ensure_vault_crypto_from_cache().await?;
        self.attach_authenticator_backup_codes_inner(secret_id, codes, mode)
            .await
    }
}

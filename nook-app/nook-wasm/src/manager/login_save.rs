//! Consented website-login create/update for the unlocked extension session.

use super::NookVaultManager;
use crate::NookError;
use crate::types::NookWebsiteLoginSavePlan;
use wasm_bindgen::{JsError, prelude::wasm_bindgen};
use zeroize::Zeroize;

impl NookVaultManager {
    fn ensure_login_save_extension_capability(&self) -> Result<(), NookError> {
        self.ensure_passkey_extension_capability()
    }

    fn plan_matching_login_save(
        &self,
        origin: &str,
        username: &str,
        password: &str,
    ) -> Result<NookWebsiteLoginSavePlan, NookError> {
        let crypto = self
            .vault
            .crypto
            .as_ref()
            .ok_or_else(|| NookError::Encryption("Vault crypto not initialized.".to_owned()))?;
        let mut owned_logins = Vec::new();
        for (id, (secret_type, _)) in &self.vault.meta.secrets {
            if *secret_type != nook_core::SecretType::Login {
                continue;
            }
            let mut record =
                nook_core::decrypt_encrypted_secret(&self.vault.meta.secrets, crypto, id)?;
            if let nook_core::SecretValue::Login(login) = &record.data
                && nook_core::login_host_matches_origin(&login.website_url, origin)
            {
                owned_logins.push((id.clone(), login.clone()));
            }
            record.zeroize_plaintext();
        }
        let candidates: Vec<nook_core::WebsiteLoginSaveCandidate<'_>> = owned_logins
            .iter()
            .map(|(id, login)| nook_core::WebsiteLoginSaveCandidate {
                secret_id: id,
                login,
            })
            .collect();
        let decision =
            nook_core::decide_website_login_save(origin, username, password, &candidates);
        for (_, login) in &mut owned_logins {
            login.password.zeroize();
        }
        Ok(NookWebsiteLoginSavePlan::from_decision(decision))
    }

    async fn commit_matching_login_save(
        &mut self,
        origin: &str,
        username: &str,
        password: &str,
        replace_secret_id: Option<&str>,
    ) -> Result<(), NookError> {
        let mut username = username.trim().to_owned();
        let mut password = password.trim().to_owned();
        if username.is_empty() || password.is_empty() {
            username.zeroize();
            password.zeroize();
            return Err(NookError::Database(
                "Login username and password are required.".to_owned(),
            ));
        }
        let plan = self.plan_matching_login_save(origin, &username, &password)?;
        let decision = plan.decision();
        let planned_replace = plan.secret_id();
        match decision.as_str() {
            "already-saved" => {
                username.zeroize();
                password.zeroize();
                return Ok(());
            }
            "invalid" => {
                username.zeroize();
                password.zeroize();
                return Err(NookError::Database(
                    "Captured login is not valid to save.".to_owned(),
                ));
            }
            "update" => {
                let expected = planned_replace.ok_or_else(|| {
                    NookError::Database("Login update is missing the existing secret.".to_owned())
                })?;
                let provided = replace_secret_id.unwrap_or_default();
                if provided != expected {
                    username.zeroize();
                    password.zeroize();
                    return Err(NookError::Database(
                        "Login update target does not match the planned secret.".to_owned(),
                    ));
                }
            }
            "create" => {
                if replace_secret_id.is_some_and(|value| !value.is_empty()) {
                    username.zeroize();
                    password.zeroize();
                    return Err(NookError::Database(
                        "Login create must not target an existing secret.".to_owned(),
                    ));
                }
            }
            _ => {
                username.zeroize();
                password.zeroize();
                return Err(NookError::Database(
                    "Unsupported website login save decision.".to_owned(),
                ));
            }
        }

        let yaml = nook_core::build_secret_yaml_from_form(&nook_core::SecretFormFields::Login(
            nook_core::LoginSecretForm {
                website_url: origin.to_owned(),
                username: username.clone(),
                password: password.clone(),
                notes: String::new(),
            },
        ))
        .map_err(|error| NookError::Database(error.to_string()))?;
        username.zeroize();
        password.zeroize();
        let data = yaml.as_str().to_owned();
        let secret_type = nook_core::SecretType::Login.as_str().to_owned();

        if decision.as_str() == "update" {
            let old_id = replace_secret_id.unwrap_or_default().to_owned();
            let new_id = nook_core::generate_secret_id()?.to_string();
            let records = self
                .replace_secret(old_id, new_id, secret_type, data)
                .await
                .map_err(|_| {
                    NookError::Database("Failed to replace the website login.".to_owned())
                })?;
            drop(records);
        } else {
            let id = nook_core::generate_secret_id()?.to_string();
            let records = self.add_secret(id, secret_type, data).await.map_err(|_| {
                NookError::Database("Failed to create the website login.".to_owned())
            })?;
            drop(records);
        }
        Ok(())
    }
}

#[wasm_bindgen]
impl NookVaultManager {
    #[wasm_bindgen(js_name = planWebsiteLoginSave)]
    pub async fn plan_website_login_save(
        &mut self,
        origin: &str,
        username: &str,
        password: &str,
    ) -> Result<NookWebsiteLoginSavePlan, JsError> {
        self.ensure_login_save_extension_capability()?;
        self.ensure_vault_crypto_from_cache().await?;
        self.plan_matching_login_save(origin, username, password)
            .map_err(Into::into)
    }

    #[wasm_bindgen(js_name = commitWebsiteLoginSave)]
    pub async fn commit_website_login_save(
        &mut self,
        origin: &str,
        username: &str,
        password: &str,
        replace_secret_id: &str,
    ) -> Result<(), JsError> {
        self.ensure_login_save_extension_capability()?;
        self.ensure_vault_crypto_from_cache().await?;
        let replace = (!replace_secret_id.is_empty()).then_some(replace_secret_id);
        self.commit_matching_login_save(origin, username, password, replace)
            .await
            .map_err(Into::into)
    }
}

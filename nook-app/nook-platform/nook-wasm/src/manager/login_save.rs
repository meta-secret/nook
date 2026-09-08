//! Consented website-login create/update for the unlocked extension session.

use super::NookVaultManager;
use crate::NookError;
use crate::types::{NookWebsiteLoginSaveDecision, NookWebsiteLoginSavePlan};
use nook_core::{SecretFormFields, SecretId, SecretType, SecretValue};
use wasm_bindgen::{JsError, prelude::wasm_bindgen};
use zeroize::{Zeroize, Zeroizing};

struct LoginSavePlanRequest<'a> {
    origin: &'a str,
    username: &'a str,
    password: &'a str,
}

struct LoginSaveCommitRequest<'a> {
    origin: &'a str,
    username: &'a str,
    password: &'a str,
    target: LoginSaveTarget,
}

enum LoginSaveTarget {
    Create,
    Replace(SecretId),
}

impl LoginSaveTarget {
    fn from_external(raw: &str) -> Self {
        if raw.is_empty() {
            return Self::Create;
        }
        let id = SecretId::parse(raw).unwrap_or_else(|_| SecretId::from_vault_record(raw));
        Self::Replace(id)
    }
}

impl NookVaultManager {
    fn ensure_login_save_extension_capability(&self) -> Result<(), NookError> {
        self.ensure_passkey_extension_capability()
    }

    fn plan_matching_login_save(
        &self,
        request: &LoginSavePlanRequest<'_>,
    ) -> Result<NookWebsiteLoginSavePlan, NookError> {
        let crypto = self.vault.crypto.get()?;
        let mut owned_logins: Vec<(SecretId, nook_core::LoginSecret)> = Vec::new();
        for (id, (secret_type, _)) in &self.vault.meta.secrets {
            if *secret_type != SecretType::Login {
                continue;
            }
            let mut record =
                nook_core::VaultSecretSession::new(&self.vault.meta.secrets, crypto).decrypt(id)?;
            let match_result = match &record.data {
                SecretValue::Login(login) => (nook_core::LoginHostMatchRequest {
                    website_url: &login.website_url,
                    origin: request.origin,
                })
                .matches()
                .map_err(|error| NookError::Database(error.to_string())),
                _ => Ok(false),
            };
            let login = match (&record.data, &match_result) {
                (SecretValue::Login(login), Ok(true)) => Some(login.clone()),
                _ => None,
            };
            record.zeroize_plaintext();
            let did_match = match match_result {
                Ok(did_match) => did_match,
                Err(error) => {
                    for (_, login) in &mut owned_logins {
                        login.password.zeroize();
                    }
                    return Err(error);
                }
            };
            if did_match && let Some(login) = login {
                owned_logins.push((id.clone(), login));
            }
        }
        let candidates: Vec<nook_core::WebsiteLoginSaveCandidate<'_>> = owned_logins
            .iter()
            .map(|(id, login)| nook_core::WebsiteLoginSaveCandidate {
                secret_id: id,
                login,
            })
            .collect();
        let decision = nook_core::WebsiteLoginSaveRequest {
            origin: request.origin,
            username: request.username,
            password: request.password,
            candidates: &candidates,
        }
        .decide()
        .map_err(|error| NookError::Database(error.to_string()));
        for (_, login) in &mut owned_logins {
            login.password.zeroize();
        }
        let decision = decision?;
        Ok(NookWebsiteLoginSavePlan::from_decision(decision))
    }

    async fn commit_matching_login_save(
        &mut self,
        request: LoginSaveCommitRequest<'_>,
    ) -> Result<(), NookError> {
        let mut username = Zeroizing::new(request.username.trim().to_owned());
        let mut password = Zeroizing::new(request.password.trim().to_owned());
        if username.is_empty() || password.is_empty() {
            username.zeroize();
            password.zeroize();
            return Err(NookError::Database(
                "Login username and password are required.".to_owned(),
            ));
        }
        let plan = self.plan_matching_login_save(&LoginSavePlanRequest {
            origin: request.origin,
            username: &username,
            password: &password,
        })?;
        let decision = plan.decision();
        let planned_replace = plan.secret_id();
        match decision {
            NookWebsiteLoginSaveDecision::AlreadySaved => {
                username.zeroize();
                password.zeroize();
                return Ok(());
            }
            NookWebsiteLoginSaveDecision::Invalid => {
                username.zeroize();
                password.zeroize();
                return Err(NookError::Database(
                    "Captured login is not valid to save.".to_owned(),
                ));
            }
            NookWebsiteLoginSaveDecision::Update => {
                let expected = planned_replace.map_err(|_| {
                    NookError::Database("Login update is missing the existing secret.".to_owned())
                })?;
                let LoginSaveTarget::Replace(provided) = &request.target else {
                    username.zeroize();
                    password.zeroize();
                    return Err(NookError::Database(
                        "Login update target does not match the planned secret.".to_owned(),
                    ));
                };
                if provided.to_string() != expected {
                    username.zeroize();
                    password.zeroize();
                    return Err(NookError::Database(
                        "Login update target does not match the planned secret.".to_owned(),
                    ));
                }
            }
            NookWebsiteLoginSaveDecision::Create => {
                if !matches!(&request.target, LoginSaveTarget::Create) {
                    username.zeroize();
                    password.zeroize();
                    return Err(NookError::Database(
                        "Login create must not target an existing secret.".to_owned(),
                    ));
                }
            }
        }

        let yaml = nook_core::build_secret_yaml_from_form(&SecretFormFields::Login(
            nook_core::LoginSecretForm {
                website_url: request.origin.to_owned(),
                username: username.as_str().to_owned(),
                password: password.as_str().to_owned(),
                notes: String::new(),
            },
        ))
        .map_err(|error| NookError::Database(error.to_string()))?;
        username.zeroize();
        password.zeroize();
        let data = yaml.as_str().to_owned();
        let secret_type = SecretType::Login;

        if decision == NookWebsiteLoginSaveDecision::Update {
            let LoginSaveTarget::Replace(old_id) = request.target else {
                return Err(NookError::Database(
                    "Login update target does not match the planned secret.".to_owned(),
                ));
            };
            let new_id = nook_core::SecretId::generate()?.to_string();
            let records = self
                .replace_secret(old_id.to_string(), new_id, secret_type, data)
                .await
                .map_err(|_| {
                    NookError::Database("Failed to replace the website login.".to_owned())
                })?;
            drop(records);
        } else {
            let id = nook_core::SecretId::generate()?.to_string();
            let records = self.add_secret(id, secret_type, data).await.map_err(|_| {
                NookError::Database("Failed to create the website login.".to_owned())
            })?;
            drop(records);
        }
        Ok(())
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use super::*;
    use crate::manager::VaultCryptoState;
    use nook_core::{
        LoginSecret, SecretId, SecretType, SecretValue, StoredRecordPayload, VaultCrypto,
    };
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    fn insert_login(
        manager: &mut NookVaultManager,
        crypto: &VaultCrypto,
        id: &str,
        username: &str,
        password: &str,
    ) -> anyhow::Result<()> {
        let value = SecretValue::Login(LoginSecret {
            website_url: "https://example.com/login".to_owned(),
            username: username.to_owned(),
            password: password.to_owned(),
            notes: String::new(),
        });
        let ciphertext = crypto.encrypt_value(value.to_yaml()?.as_str())?;
        manager.vault.meta.secrets.insert(
            SecretId::from_vault_record(id),
            (
                SecretType::Login,
                StoredRecordPayload::from_age_armored(ciphertext),
            ),
        );
        Ok(())
    }

    fn manager_with_login(username: &str, password: &str) -> anyhow::Result<NookVaultManager> {
        let keys = nook_core::VaultKeys::generate()?;
        let crypto = VaultCrypto::new(&keys.secrets_key)?;
        let mut manager = NookVaultManager::new();
        insert_login(
            &mut manager,
            &crypto,
            "secret_existing_login",
            username,
            password,
        )?;
        manager.vault.crypto = VaultCryptoState::Unlocked(crypto);
        Ok(manager)
    }

    #[wasm_bindgen_test]
    fn save_plans_cover_create_update_already_saved_and_invalid() -> anyhow::Result<()> {
        let mut empty = NookVaultManager::new();
        let keys = nook_core::VaultKeys::generate()?;
        empty.vault.crypto = VaultCryptoState::Unlocked(VaultCrypto::new(&keys.secrets_key)?);
        assert_eq!(
            empty
                .plan_matching_login_save(&LoginSavePlanRequest {
                    origin: "https://example.com",
                    username: "alice",
                    password: "new",
                })?
                .decision(),
            NookWebsiteLoginSaveDecision::Create
        );
        assert_eq!(
            empty
                .plan_matching_login_save(&LoginSavePlanRequest {
                    origin: "",
                    username: "alice",
                    password: "new",
                })?
                .decision(),
            NookWebsiteLoginSaveDecision::Invalid
        );
        assert_eq!(
            empty
                .plan_matching_login_save(&LoginSavePlanRequest {
                    origin: "https://example.com",
                    username: "",
                    password: "new",
                })?
                .decision(),
            NookWebsiteLoginSaveDecision::Invalid
        );

        let mut existing = manager_with_login("alice", "old")?;
        let update = existing.plan_matching_login_save(&LoginSavePlanRequest {
            origin: "https://example.com",
            username: "alice",
            password: "new",
        })?;
        assert_eq!(update.decision(), NookWebsiteLoginSaveDecision::Update);
        assert_eq!(
            update.secret_id().ok().as_deref(),
            Some("secret_existing_login")
        );
        let already = existing.plan_matching_login_save(&LoginSavePlanRequest {
            origin: "https://example.com",
            username: "alice",
            password: "old",
        })?;
        assert_eq!(
            already.decision(),
            NookWebsiteLoginSaveDecision::AlreadySaved
        );
        assert_eq!(
            already.secret_id().ok().as_deref(),
            Some("secret_existing_login")
        );
        assert_eq!(
            existing
                .plan_matching_login_save(&LoginSavePlanRequest {
                    origin: "https://other.example",
                    username: "alice",
                    password: "new",
                })?
                .decision(),
            NookWebsiteLoginSaveDecision::Create
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn save_commit_rejects_invalid_targets_before_storage() -> anyhow::Result<()> {
        assert!(matches!(
            LoginSaveTarget::from_external("github.com"),
            LoginSaveTarget::Replace(id) if id.as_str() == "github.com"
        ));
        let mut manager = manager_with_login("alice", "old")?;
        assert!(
            manager
                .commit_matching_login_save(LoginSaveCommitRequest {
                    origin: "https://example.com",
                    username: "",
                    password: "new",
                    target: LoginSaveTarget::Create,
                })
                .await
                .is_err()
        );
        assert!(
            manager
                .commit_matching_login_save(LoginSaveCommitRequest {
                    origin: "https://example.com",
                    username: "alice",
                    password: "new",
                    target: LoginSaveTarget::Replace(SecretId::from_vault_record("wrong")),
                })
                .await
                .is_err()
        );

        let keys = nook_core::VaultKeys::generate()?;
        let crypto = VaultCrypto::new(&keys.secrets_key)?;
        let mut empty = NookVaultManager::new();
        empty.vault.crypto = VaultCryptoState::Unlocked(crypto);
        assert!(
            empty
                .commit_matching_login_save(LoginSaveCommitRequest {
                    origin: "https://example.com",
                    username: "alice",
                    password: "new",
                    target: LoginSaveTarget::Replace(SecretId::from_vault_record("unexpected")),
                })
                .await
                .is_err()
        );
        Ok(())
    }
}

#[wasm_bindgen]
impl NookVaultManager {
    #[wasm_bindgen]
    pub async fn plan_website_login_save(
        &mut self,
        origin: &str,
        username: &str,
        password: &str,
    ) -> Result<NookWebsiteLoginSavePlan, JsError> {
        self.ensure_login_save_extension_capability()?;
        self.ensure_vault_crypto_from_cache().await?;
        self.plan_matching_login_save(&LoginSavePlanRequest {
            origin,
            username,
            password,
        })
        .map_err(Into::into)
    }

    #[wasm_bindgen]
    pub async fn commit_website_login_save(
        &mut self,
        origin: &str,
        username: &str,
        password: &str,
        replace_secret_id: &str,
    ) -> Result<(), JsError> {
        self.ensure_login_save_extension_capability()?;
        self.ensure_vault_crypto_from_cache().await?;
        let target = LoginSaveTarget::from_external(replace_secret_id);
        self.commit_matching_login_save(LoginSaveCommitRequest {
            origin,
            username,
            password,
            target,
        })
        .await
        .map_err(Into::into)
    }
}

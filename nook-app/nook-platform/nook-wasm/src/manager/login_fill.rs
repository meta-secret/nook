//! Website login list/reveal for the unlocked extension vault session.

use super::NookVaultManager;
use crate::NookError;
use crate::types::{LoginAccountProjection, NookLoginAccount, NookLoginFillCredential};
use nook_core::{SecretId, SecretType, SecretValue};
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

struct RevealLoginRequest<'a> {
    secret_id: &'a str,
    origin: &'a str,
}

impl NookVaultManager {
    fn ensure_login_fill_extension_capability(&self) -> Result<(), NookError> {
        // Same extension Simple Vault boundary as website passkeys.
        self.ensure_passkey_extension_capability()
    }

    fn list_matching_login_accounts(
        &self,
        origin: &str,
    ) -> Result<Vec<NookLoginAccount>, NookError> {
        let crypto = self.vault.crypto.get()?;
        let mut accounts = Vec::new();
        for (id, (secret_type, _)) in &self.vault.meta.secrets {
            if *secret_type != SecretType::Login {
                continue;
            }
            let mut record =
                nook_core::VaultSecretSession::new(&self.vault.meta.secrets, crypto).decrypt(id)?;
            let matches = match &record.data {
                SecretValue::Login(login) => (nook_core::LoginHostMatchRequest {
                    website_url: &login.website_url,
                    origin,
                })
                .matches()
                .map_err(|error| NookError::Database(error.to_string())),
                _ => Ok(false),
            };
            let account = match (&record.data, &matches) {
                (SecretValue::Login(login), Ok(true)) => {
                    Some(NookLoginAccount::from_projection(&LoginAccountProjection {
                        secret_id: id,
                        login,
                    }))
                }
                _ => None,
            };
            record.zeroize_plaintext();
            if matches? {
                if let Some(account) = account {
                    accounts.push(account);
                }
            }
        }
        Ok(accounts)
    }

    fn reveal_matching_login_for_fill(
        &self,
        request: &RevealLoginRequest<'_>,
    ) -> Result<NookLoginFillCredential, NookError> {
        let id = SecretId::parse(request.secret_id)?;
        let crypto = self.vault.crypto.get()?;
        let mut record =
            nook_core::VaultSecretSession::new(&self.vault.meta.secrets, crypto).decrypt(&id)?;
        let match_result = match &record.data {
            SecretValue::Login(login) => nook_core::LoginHostMatchRequest {
                website_url: &login.website_url,
                origin: request.origin,
            }
            .matches()
            .map_err(|error| NookError::Database(error.to_string())),
            _ => Ok(false),
        };
        let is_login = matches!(&record.data, SecretValue::Login(_));
        let credential_parts = match (&record.data, &match_result) {
            (SecretValue::Login(login), Ok(true)) => {
                Some((login.username.clone(), login.password.clone()))
            }
            _ => None,
        };
        record.zeroize_plaintext();
        match match_result {
            Err(error) => Err(error),
            Ok(true) => credential_parts
                .map(|(username, password)| NookLoginFillCredential::new(username, password))
                .ok_or_else(|| {
                    NookError::Decryption("Selected secret is not a login credential.".to_owned())
                }),
            Ok(false) if is_login => Err(NookError::Decryption(
                "Login does not match the requesting website origin.".to_owned(),
            )),
            Ok(false) => Err(NookError::Decryption(
                "Selected secret is not a login credential.".to_owned(),
            )),
        }
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

    fn insert_secret(
        manager: &mut NookVaultManager,
        crypto: &VaultCrypto,
        id: &str,
        value: SecretValue,
    ) -> anyhow::Result<()> {
        let secret_type = match &value {
            SecretValue::Login(_) => SecretType::Login,
            SecretValue::SecureNote(_) => SecretType::SecureNote,
            _ => anyhow::bail!("unsupported fixture"),
        };
        let ciphertext = crypto.encrypt_value(value.to_yaml()?.as_str())?;
        manager.vault.meta.secrets.insert(
            SecretId::from_vault_record(id),
            (
                secret_type,
                StoredRecordPayload::from_age_armored(ciphertext),
            ),
        );
        Ok(())
    }

    fn login(url: &str, username: &str, password: &str) -> SecretValue {
        SecretValue::Login(LoginSecret {
            website_url: url.to_owned(),
            username: username.to_owned(),
            password: password.to_owned(),
            notes: "fixture".to_owned(),
        })
    }

    #[wasm_bindgen_test]
    fn listing_and_reveal_enforce_origin_and_secret_type() -> anyhow::Result<()> {
        let keys = nook_core::VaultKeys::generate()?;
        let crypto = VaultCrypto::new(&keys.secrets_key)?;
        let mut manager = NookVaultManager::new();
        insert_secret(
            &mut manager,
            &crypto,
            "secret_SMypl8K0w9a",
            login("https://www.example.com/login", "alice", "correct"),
        )?;
        insert_secret(
            &mut manager,
            &crypto,
            "secret_SMypl8K0w9b",
            login("https://other.example", "bob", "other"),
        )?;
        insert_secret(
            &mut manager,
            &crypto,
            "secret_SMypl8K0w9c",
            SecretValue::SecureNote(nook_core::SecureNoteSecret {
                title: "not a login".to_owned(),
                note: "fixture".to_owned(),
            }),
        )?;
        manager.vault.crypto = VaultCryptoState::Unlocked(crypto);

        let accounts = manager.list_matching_login_accounts("https://example.com/account")?;
        assert_eq!(accounts.len(), 1);
        assert_eq!(accounts[0].username(), "alice");
        assert_eq!(accounts[0].website_host(), "example.com");

        let credential = manager.reveal_matching_login_for_fill(&RevealLoginRequest {
            secret_id: "secret_SMypl8K0w9a",
            origin: "https://example.com/account",
        })?;
        assert_eq!(credential.username(), "alice");
        assert_eq!(credential.password(), "correct");
        assert!(
            manager
                .reveal_matching_login_for_fill(&RevealLoginRequest {
                    secret_id: "secret_SMypl8K0w9a",
                    origin: "https://other.example",
                })
                .is_err()
        );
        assert!(
            manager
                .reveal_matching_login_for_fill(&RevealLoginRequest {
                    secret_id: "secret_SMypl8K0w9c",
                    origin: "https://example.com",
                })
                .is_err()
        );
        assert!(
            manager
                .reveal_matching_login_for_fill(&RevealLoginRequest {
                    secret_id: "not-a-secret-id",
                    origin: "https://example.com",
                })
                .is_err()
        );
        Ok(())
    }

    #[wasm_bindgen_test]
    fn listing_requires_unlocked_crypto() {
        let manager = NookVaultManager::new();
        assert!(
            manager
                .list_matching_login_accounts("https://example.com")
                .is_err()
        );
    }
}

#[wasm_bindgen]
impl NookVaultManager {
    #[wasm_bindgen]
    pub async fn list_website_login_accounts(
        &mut self,
        origin: &str,
    ) -> Result<Vec<NookLoginAccount>, JsError> {
        self.ensure_login_fill_extension_capability()?;
        self.ensure_vault_crypto_from_cache().await?;
        self.list_matching_login_accounts(origin)
            .map_err(Into::into)
    }

    #[wasm_bindgen]
    pub async fn reveal_website_login_for_fill(
        &mut self,
        secret_id: &str,
        origin: &str,
    ) -> Result<NookLoginFillCredential, JsError> {
        self.ensure_login_fill_extension_capability()?;
        self.ensure_vault_crypto_from_cache().await?;
        self.reveal_matching_login_for_fill(&RevealLoginRequest { secret_id, origin })
            .map_err(Into::into)
    }
}

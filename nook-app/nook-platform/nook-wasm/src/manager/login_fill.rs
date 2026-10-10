//! Website login list/reveal for the unlocked extension vault session.

use super::NookVaultManager;
use crate::NookError;
use crate::types::{NookFocusedLoginFillCredential, NookFocusedLoginFillRequest};
use crate::types::{NookLoginAccount, NookLoginFillCredential};
use nook_core::{LoginHostMatch, LoginWebsiteHost, SecretId, SecretValue};
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

struct RevealLoginRequest<'a> {
    secret_id: &'a str,
    origin: &'a str,
}

impl NookVaultManager {
    fn reveal_matching_login_for_focused_fill(
        &self,
        request: NookFocusedLoginFillRequest,
    ) -> Result<NookFocusedLoginFillCredential, NookError> {
        let secret_id = request.secret_id.into_inner();
        let id = SecretId::parse(&secret_id)?;
        let crypto = self.vault.crypto.get()?;
        let record =
            nook_core::VaultSecretSession::new(&self.vault.meta.secrets, crypto).decrypt(&id)?;
        nook_core::FocusedLoginFillProjection {
            record,
            origin: &request.origin,
            credential: request.credential,
        }
        .reveal()
        .map(NookFocusedLoginFillCredential::from)
        .map_err(|error| NookError::Decryption(error.to_string()))
    }

    fn ensure_login_fill_extension_capability(&self) -> Result<(), NookError> {
        // Same extension Simple Vault boundary as website passkeys.
        self.ensure_passkey_extension_capability()
    }

    fn list_matching_login_accounts(
        &self,
        origin: &str,
    ) -> Result<Vec<NookLoginAccount>, NookError> {
        self.vault.crypto.get()?;
        let origin = LoginWebsiteHost::try_from(origin)?;
        let accounts = self
            .vault
            .search_catalog
            .get()?
            .matching_login_accounts(&origin);
        Ok(accounts.into_iter().map(NookLoginAccount::from).collect())
    }

    fn reveal_matching_login_for_fill(
        &self,
        request: &RevealLoginRequest<'_>,
    ) -> Result<NookLoginFillCredential, NookError> {
        let id = SecretId::parse(request.secret_id)?;
        let crypto = self.vault.crypto.get()?;
        let mut record =
            nook_core::VaultSecretSession::new(&self.vault.meta.secrets, crypto).decrypt(&id)?;
        let result = match &record.data {
            SecretValue::Login(login) => match (nook_core::LoginHostMatchRequest {
                website_url: &login.website_url,
                origin: request.origin,
            })
            .assess()
            {
                LoginHostMatch::Matched => Ok(NookLoginFillCredential::new(
                    login.username.clone(),
                    login.password.clone(),
                )),
                LoginHostMatch::Unmatched => Err(NookError::Decryption(
                    "Login does not match the requesting website origin.".to_owned(),
                )),
            },
            _ => Err(NookError::Decryption(
                "Selected secret is not a login credential.".to_owned(),
            )),
        };
        record.zeroize_plaintext();
        result
    }
}

#[cfg(test)]
mod tests {
    use super::{NookVaultManager, RevealLoginRequest};
    use crate::NookError;
    use crate::manager::{SearchCatalogState, VaultCryptoState};
    use crate::types::NookFocusedLoginFillRequest;
    use nook_core::{
        CredentialKind, FocusedLoginFillOrigin, LoginHostMatch, LoginSecret, SecretId,
        SecretSearchCatalog, SecretType, SecretValue, StoredRecordPayload, VaultCrypto, VaultKeys,
        WebsiteHost,
    };

    struct LoginFillSiteCase {
        saved: &'static str,
        origin: &'static str,
        expected: LoginHostMatch,
    }

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn general_domain_policy_reaches_full_and_focused_reveal() -> anyhow::Result<()> {
        for case in [
            LoginFillSiteCase {
                saved: "https://one.widget-tools.com/login",
                origin: "https://two.widget-tools.com",
                expected: LoginHostMatch::Matched,
            },
            LoginFillSiteCase {
                saved: "https://one.sample.co.uk/login",
                origin: "https://sample.co.uk",
                expected: LoginHostMatch::Matched,
            },
            LoginFillSiteCase {
                saved: "https://www.github.io/login",
                origin: "https://github.io",
                expected: LoginHostMatch::Unmatched,
            },
            LoginFillSiteCase {
                saved: "https://www.github.io/login",
                origin: "https://login.www.github.io",
                expected: LoginHostMatch::Matched,
            },
            LoginFillSiteCase {
                saved: "https://a.foo.ck/login",
                origin: "https://b.foo.ck",
                expected: LoginHostMatch::Unmatched,
            },
            LoginFillSiteCase {
                saved: "https://a.www.ck/login",
                origin: "https://b.www.ck",
                expected: LoginHostMatch::Matched,
            },
            LoginFillSiteCase {
                saved: "https://one.sample.nookunknown/login",
                origin: "https://two.sample.nookunknown",
                expected: LoginHostMatch::Matched,
            },
            LoginFillSiteCase {
                saved: "https://microsoft.com/login",
                origin: "https://login.microsoftonline.com",
                expected: LoginHostMatch::Unmatched,
            },
        ] {
            let keys = VaultKeys::generate()?;
            let crypto = VaultCrypto::new(&keys.secrets_key)?;
            let mut manager = NookVaultManager::new();
            let value = SecretValue::Login(LoginSecret {
                website_url: case.saved.to_owned(),
                username: "synthetic-account".to_owned(),
                password: "synthetic-password".to_owned(),
                notes: String::new(),
            });
            let ciphertext = crypto.encrypt_value(value.to_yaml()?.as_str())?;
            manager.vault.meta.secrets.insert(
                SecretId::parse("secret_SMypl8K0w9a")?,
                (
                    SecretType::Login,
                    StoredRecordPayload::from_age_armored(ciphertext),
                ),
            );
            let mut catalog = SecretSearchCatalog::default();
            catalog.reconcile(&manager.vault.meta.secrets, &crypto, &keys.secrets_key)?;
            manager.vault.search_catalog = SearchCatalogState::Ready(catalog);
            manager.vault.crypto = VaultCryptoState::Unlocked(crypto);
            let accounts = manager.list_matching_login_accounts(case.origin)?;
            let full = manager.reveal_matching_login_for_fill(&RevealLoginRequest {
                secret_id: "secret_SMypl8K0w9a",
                origin: case.origin,
            });
            let focused =
                manager.reveal_matching_login_for_focused_fill(NookFocusedLoginFillRequest {
                    secret_id: SecretId::parse("secret_SMypl8K0w9a")?,
                    origin: FocusedLoginFillOrigin::try_from(case.origin.to_owned())?,
                    credential: CredentialKind::CurrentPassword,
                });
            match case.expected {
                LoginHostMatch::Matched => {
                    assert_eq!(accounts.len(), 1);
                    assert_eq!(full?.password(), "synthetic-password");
                    assert_eq!(focused?.value(), "synthetic-password");
                }
                LoginHostMatch::Unmatched => {
                    assert!(accounts.is_empty());
                    assert!(full.is_err());
                    assert!(focused.is_err());
                }
            }
        }
        Ok(())
    }

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn chase_listing_and_selected_reveal_use_the_same_registrable_domain() -> anyhow::Result<()> {
        for website_url in [
            "https://chaseonline.chase.com/login",
            "https://secure.chase.com/login",
            "https://secure03ea.chase.com/login",
            "https://secure05c.chase.com/login",
            "https://SECURE06EA.CHASE.COM:443/login?next=account#signin",
        ] {
            let keys = VaultKeys::generate()?;
            let crypto = VaultCrypto::new(&keys.secrets_key)?;
            let mut manager = NookVaultManager::new();
            let value = SecretValue::Login(LoginSecret {
                website_url: website_url.to_owned(),
                username: "synthetic-chase-account".to_owned(),
                password: "synthetic-chase-password".to_owned(),
                notes: "never-projected".to_owned(),
            });
            let ciphertext = crypto.encrypt_value(value.to_yaml()?.as_str())?;
            manager.vault.meta.secrets.insert(
                SecretId::parse("secret_SMypl8K0w9a")?,
                (
                    SecretType::Login,
                    StoredRecordPayload::from_age_armored(ciphertext),
                ),
            );
            let mut catalog = SecretSearchCatalog::default();
            catalog.reconcile(&manager.vault.meta.secrets, &crypto, &keys.secrets_key)?;
            manager.vault.search_catalog = SearchCatalogState::Ready(catalog);
            manager.vault.crypto = VaultCryptoState::Unlocked(crypto);
            for origin in ["https://www.chase.com", "https://secure.chase.com"] {
                let accounts = manager.list_matching_login_accounts(origin)?;
                let [account] = accounts.as_slice() else {
                    anyhow::bail!("expected the selected synthetic Chase account");
                };
                assert_eq!(account.website_url(), website_url);
                assert_eq!(
                    account.website_host(),
                    WebsiteHost::normalize(website_url)?.as_str()
                );
                let credential = manager.reveal_matching_login_for_fill(&RevealLoginRequest {
                    secret_id: "secret_SMypl8K0w9a",
                    origin,
                })?;
                assert_eq!(credential.username(), "synthetic-chase-account");
                assert_eq!(credential.password(), "synthetic-chase-password");
                let focused = manager.reveal_matching_login_for_focused_fill(
                    NookFocusedLoginFillRequest {
                        secret_id: SecretId::parse("secret_SMypl8K0w9a")?,
                        origin: FocusedLoginFillOrigin::try_from(origin.to_owned())?,
                        credential: CredentialKind::CurrentPassword,
                    },
                )?;
                assert_eq!(focused.value(), "synthetic-chase-password");
            }
            for origin in [
                "https://unlisted.example.com",
                "https://nested.secure.evil.example",
                "https://secure.chase.com.evil.example",
                "https://evil-chase.com",
                "https://unrelated.example",
            ] {
                assert!(manager.list_matching_login_accounts(origin)?.is_empty());
                assert!(
                    manager
                        .reveal_matching_login_for_fill(&RevealLoginRequest {
                            secret_id: "secret_SMypl8K0w9a",
                            origin,
                        })
                        .is_err()
                );
                assert!(
                    manager
                        .reveal_matching_login_for_focused_fill(NookFocusedLoginFillRequest {
                            secret_id: SecretId::parse("secret_SMypl8K0w9a")?,
                            origin: FocusedLoginFillOrigin::try_from(origin.to_owned())?,
                            credential: CredentialKind::CurrentPassword,
                        })
                        .is_err()
                );
            }
        }
        Ok(())
    }

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn warm_login_listing_does_not_open_unrelated_full_records() -> anyhow::Result<()> {
        let keys = VaultKeys::generate()?;
        let crypto = VaultCrypto::new(&keys.secrets_key)?;
        let mut manager = NookVaultManager::new();
        let selected = SecretId::from_vault_record("secret_selected");
        let value = SecretValue::Login(LoginSecret {
            website_url: "https://example.com/login".to_owned(),
            username: "selected-account".to_owned(),
            password: "selected-password".to_owned(),
            notes: String::new(),
        });
        let ciphertext = crypto.encrypt_value(value.to_yaml()?.as_str())?;
        manager.vault.meta.secrets.insert(
            selected,
            (
                SecretType::Login,
                StoredRecordPayload::from_age_armored(ciphertext),
            ),
        );
        let mut catalog = SecretSearchCatalog::default();
        catalog.reconcile(&manager.vault.meta.secrets, &crypto, &keys.secrets_key)?;
        manager.vault.search_catalog = SearchCatalogState::Ready(catalog);
        // A warm lookup has no need to open an unrelated ciphertext. This sentinel
        // makes any full-record traversal observable as a decryption error.
        manager.vault.meta.secrets.insert(
            SecretId::from_vault_record("secret_unrelated"),
            (
                SecretType::Login,
                StoredRecordPayload::from_trusted("unreadable".to_owned()),
            ),
        );
        manager.vault.crypto = VaultCryptoState::Unlocked(crypto);

        let accounts = manager.list_matching_login_accounts("https://example.com")?;
        assert_eq!(accounts.len(), 1);
        let account = accounts
            .first()
            .ok_or_else(|| anyhow::anyhow!("missing account"))?;
        assert_eq!(account.username(), "selected-account");
        assert_eq!(account.website_host(), "example.com");
        Ok(())
    }

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn login_listing_rejects_invalid_origin_and_allows_valid_unmatched_origin() -> anyhow::Result<()>
    {
        let keys = VaultKeys::generate()?;
        let mut manager = NookVaultManager::new();
        manager.vault.crypto = VaultCryptoState::Unlocked(VaultCrypto::new(&keys.secrets_key)?);
        manager.vault.search_catalog = SearchCatalogState::Ready(SecretSearchCatalog::default());

        for origin in ["", "https://"] {
            assert!(matches!(
                manager.list_matching_login_accounts(origin),
                Err(NookError::LoginFillOrigin(_))
            ));
        }
        assert!(
            manager
                .list_matching_login_accounts("https://unmatched.example")?
                .is_empty()
        );
        Ok(())
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use super::*;
    use crate::manager::{SearchCatalogState, VaultCryptoState};
    use nook_core::{
        LoginSecret, SecretId, SecretSearchCatalog, SecretType, SecretValue, StoredRecordPayload,
        VaultCrypto,
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
        let mut catalog = SecretSearchCatalog::default();
        catalog.reconcile(&manager.vault.meta.secrets, &crypto, &keys.secrets_key)?;
        manager.vault.search_catalog = SearchCatalogState::Ready(catalog);
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
        let focused_username =
            manager.reveal_matching_login_for_focused_fill(NookFocusedLoginFillRequest {
                secret_id: SecretId::parse("secret_SMypl8K0w9a")?,
                origin: nook_core::FocusedLoginFillOrigin::try_from(
                    "https://example.com/account".to_owned(),
                )?,
                credential: nook_core::CredentialKind::Username,
            })?;
        assert_eq!(focused_username.value(), "alice");
        let focused_password =
            manager.reveal_matching_login_for_focused_fill(NookFocusedLoginFillRequest {
                secret_id: SecretId::parse("secret_SMypl8K0w9a")?,
                origin: nook_core::FocusedLoginFillOrigin::try_from(
                    "https://example.com/account".to_owned(),
                )?,
                credential: nook_core::CredentialKind::CurrentPassword,
            })?;
        assert_eq!(focused_password.value(), "correct");
        assert!(
            manager
                .reveal_matching_login_for_focused_fill(NookFocusedLoginFillRequest {
                    secret_id: SecretId::parse("secret_SMypl8K0w9a")?,
                    origin: nook_core::FocusedLoginFillOrigin::try_from(
                        "https://other.example".to_owned()
                    )?,
                    credential: nook_core::CredentialKind::Username,
                })
                .is_err()
        );
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

    #[wasm_bindgen_test]
    fn focused_reveal_requires_unlocked_crypto_and_strict_secret_identity() -> anyhow::Result<()> {
        let manager = NookVaultManager::new();
        let origin = nook_core::FocusedLoginFillOrigin::try_from("https://example.com".to_owned())?;
        assert!(
            manager
                .reveal_matching_login_for_focused_fill(NookFocusedLoginFillRequest {
                    secret_id: SecretId::parse("secret_SMypl8K0w9a")?,
                    origin: origin.clone(),
                    credential: nook_core::CredentialKind::Username,
                })
                .is_err()
        );
        assert!(
            manager
                .reveal_matching_login_for_focused_fill(NookFocusedLoginFillRequest {
                    secret_id: SecretId::from_vault_record("not-a-secret-id"),
                    origin,
                    credential: nook_core::CredentialKind::CurrentPassword,
                })
                .is_err()
        );
        Ok(())
    }
}

#[wasm_bindgen]
impl NookVaultManager {
    /// Hydrates the existing externally retained WASM vault session before one fill.
    #[wasm_bindgen]
    pub async fn reveal_website_login_for_focused_fill(
        &mut self,
        request: tsify::Ts<NookFocusedLoginFillRequest>,
    ) -> Result<NookFocusedLoginFillCredential, JsError> {
        let request = request
            .to_rust()
            .map_err(|_| JsError::new("Invalid focused login fill request."))?;
        self.ensure_login_fill_extension_capability()?;
        self.ensure_vault_crypto_from_cache().await?;
        self.reveal_matching_login_for_focused_fill(request)
            .map_err(Into::into)
    }

    #[wasm_bindgen]
    pub async fn list_website_login_accounts(
        &mut self,
        origin: &str,
    ) -> Result<Vec<NookLoginAccount>, JsError> {
        self.ensure_login_fill_extension_capability()?;
        self.ensure_vault_crypto_from_cache().await?;
        self.prepare_secret_search_catalog().await?;
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

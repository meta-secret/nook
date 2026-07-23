//! Authenticator metadata and one-time-code generation for the unlocked extension session.

use super::NookVaultManager;
use crate::NookError;
use crate::types::{NookAuthenticatorAccount, NookTotpCode};
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

impl NookVaultManager {
    fn list_authenticator_accounts(
        &self,
        query: &str,
    ) -> Result<Vec<NookAuthenticatorAccount>, NookError> {
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
            if record.matches_search(query)
                && let nook_core::SecretValue::Authenticator(authenticator) = &record.data
            {
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

#[cfg(all(test, target_arch = "wasm32"))]
mod wasm_tests {
    use super::*;
    use wasm_bindgen_test::*;

    fn insert_secret(
        manager: &mut NookVaultManager,
        crypto: &nook_core::VaultCrypto,
        id: &str,
        value: nook_core::SecretValue,
    ) {
        let secret_type = match &value {
            nook_core::SecretValue::Authenticator(_) => nook_core::SecretType::Authenticator,
            nook_core::SecretValue::SecureNote(_) => nook_core::SecretType::SecureNote,
            _ => panic!("unsupported test secret"),
        };
        let yaml = value.to_yaml().expect("serialize test secret");
        let ciphertext = crypto.encrypt_value(yaml.as_str()).expect("encrypt secret");
        manager.vault.meta.secrets.insert(
            nook_core::SecretId::from_vault_record(id),
            (
                secret_type,
                nook_core::StoredRecordPayload::from_age_armored(ciphertext),
            ),
        );
    }

    #[wasm_bindgen_test]
    fn authenticator_listing_filters_by_type_and_non_secret_metadata() {
        let keys = nook_core::generate_vault_keys().expect("vault keys");
        let crypto = nook_core::VaultCrypto::new(&keys.secrets_key).expect("vault crypto");
        let mut manager = NookVaultManager::new();
        insert_secret(
            &mut manager,
            &crypto,
            "secret_alpha_authenticator",
            nook_core::SecretValue::Authenticator(
                nook_core::AuthenticatorSecret::from_otpauth_uri(
                    "otpauth://totp/Alpha:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Alpha",
                )
                .expect("authenticator"),
            ),
        );
        insert_secret(
            &mut manager,
            &crypto,
            "secret_beta_authenticator",
            nook_core::SecretValue::Authenticator(
                nook_core::AuthenticatorSecret::from_otpauth_uri(
                    "otpauth://totp/Beta:bob@example.com?secret=KRSXG5DSNFXGOIDB&issuer=Beta",
                )
                .expect("authenticator"),
            ),
        );
        insert_secret(
            &mut manager,
            &crypto,
            "secret_alpha_note",
            nook_core::SecretValue::SecureNote(nook_core::SecureNoteSecret {
                title: "Alpha recovery".to_owned(),
                note: "not an authenticator".to_owned(),
            }),
        );
        manager.vault.crypto = Some(crypto);

        let all = manager
            .list_authenticator_accounts("")
            .expect("list authenticators");
        assert_eq!(all.len(), 2);

        let matching = manager
            .list_authenticator_accounts("ALICE@EXAMPLE.COM")
            .expect("search authenticators");
        assert_eq!(matching.len(), 1);
        assert_eq!(matching[0].issuer(), "Alpha");
        assert_eq!(matching[0].account(), "alice@example.com");

        assert!(
            manager
                .list_authenticator_accounts("recovery")
                .expect("exclude non-authenticator matches")
                .is_empty()
        );
        assert!(
            manager
                .list_authenticator_accounts("JBSWY3DPEHPK3PXP")
                .expect("exclude secret material")
                .is_empty()
        );
    }
}

#[wasm_bindgen]
impl NookVaultManager {
    #[wasm_bindgen(js_name = listAuthenticatorAccounts)]
    pub async fn list_authenticator_accounts_js(
        &mut self,
        query: &str,
    ) -> Result<Vec<NookAuthenticatorAccount>, JsError> {
        self.ensure_passkey_extension_capability()?;
        self.ensure_vault_crypto_from_cache().await?;
        self.list_authenticator_accounts(query).map_err(Into::into)
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

//! "This site" matches for the unlocked extension vault session.

use super::NookVaultManager;
use crate::NookError;
use nook_companion_core::SiteSecretMatches;
use nook_core::SiteSecretOrigin;
use tsify::{Ts, Tsify};
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

impl NookVaultManager {
    fn list_matching_site_secrets(&self, origin: &str) -> Result<SiteSecretMatches, NookError> {
        self.vault.crypto.get()?;
        let origin = SiteSecretOrigin::try_from(origin)?;
        self.vault
            .search_catalog
            .get()?
            .matching_site_secrets(&origin)
            .map_err(NookError::from)
    }
}

#[wasm_bindgen]
impl NookVaultManager {
    /// Every Login, Authenticator, Passkey, and API key of this vault bound to
    /// `origin`, as display-only metadata from the unlocked catalog.
    #[wasm_bindgen]
    pub async fn list_website_site_secrets(
        &mut self,
        origin: &str,
    ) -> Result<Ts<SiteSecretMatches>, JsError> {
        self.ensure_passkey_extension_capability()?;
        self.ensure_vault_crypto_from_cache().await?;
        self.prepare_secret_search_catalog().await?;
        self.list_matching_site_secrets(origin)?
            .into_ts()
            .map_err(|_| JsError::new("Site secret matches could not be encoded."))
    }
}

#[cfg(test)]
mod tests {
    use super::NookVaultManager;
    use crate::NookError;
    use crate::manager::{SearchCatalogState, VaultCryptoState};
    use nook_companion_core::SiteSecretKind;
    use nook_core::{
        LoginSecret, SecretId, SecretSearchCatalog, SecretValue, StoredRecordPayload, VaultCrypto,
        VaultKeys,
    };

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn unlocked_catalog_lists_site_matches_and_rejects_hostless_origins() -> anyhow::Result<()> {
        let keys = VaultKeys::generate()?;
        let crypto = VaultCrypto::new(&keys.secrets_key)?;
        let mut manager = NookVaultManager::new();
        let value = SecretValue::Login(LoginSecret {
            website_url: "https://www.namecheap.com/login".to_owned(),
            username: "bynull".to_owned(),
            password: "never-projected".to_owned(),
            notes: String::new(),
        });
        let ciphertext = crypto.encrypt_value(value.to_yaml()?.as_str())?;
        manager.vault.meta.secrets.insert(
            SecretId::parse("secret_SMypl8K0w9a")?,
            (
                value.secret_type(),
                StoredRecordPayload::from_age_armored(ciphertext),
            ),
        );
        let mut catalog = SecretSearchCatalog::default();
        catalog.reconcile(&manager.vault.meta.secrets, &crypto, &keys.secrets_key)?;
        manager.vault.search_catalog = SearchCatalogState::Ready(catalog);
        manager.vault.crypto = VaultCryptoState::Unlocked(crypto);

        let matches = manager.list_matching_site_secrets("https://www.namecheap.com")?;
        let [item] = matches.items.as_slice() else {
            anyhow::bail!("expected the saved Namecheap login");
        };
        assert_eq!(item.kind, SiteSecretKind::Login);
        assert_eq!(item.secret_id.as_str(), "secret_SMypl8K0w9a");
        assert!(
            manager
                .list_matching_site_secrets("https://unrelated.example")?
                .items
                .is_empty()
        );
        assert!(matches!(
            manager.list_matching_site_secrets("https://"),
            Err(NookError::LoginFillOrigin(_))
        ));
        Ok(())
    }
}

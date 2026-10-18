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

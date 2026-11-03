//! Lexical admission of provider credentials into extension storage.
//!
//! Extension pairing persists website-sealed provider grants without an
//! unlocked device session in the offscreen document. Admission observes only
//! whether every credential carries the armor marker; it does not validate the
//! armored bytes, their recipient, or authentication.

#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use super::AGE_ARMOR_MARKER;
use crate::{AuthProvidersSnapshot, ProviderSecretText, StorageProvider};

/// Marker compatibility is a storage admission check, not ciphertext validity.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderCredentialStorageAdmission {
    MarkerCompatible,
    PlaintextPresent,
}

/// A lexical credential observation, not ciphertext validation or authorization.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderCredentialEncoding {
    ArmorMarked,
    Plaintext,
}

impl ProviderCredentialEncoding {
    #[must_use]
    pub fn observe(secret: &ProviderSecretText) -> Self {
        if secret.expose().contains(AGE_ARMOR_MARKER) {
            Self::ArmorMarked
        } else {
            Self::Plaintext
        }
    }
}

impl AuthProvidersSnapshot {
    #[must_use]
    pub fn credential_storage_admission(&self) -> ProviderCredentialStorageAdmission {
        match self.providers.iter().find(|provider| {
            provider.credential_storage_admission()
                == ProviderCredentialStorageAdmission::PlaintextPresent
        }) {
            Some(_) => ProviderCredentialStorageAdmission::PlaintextPresent,
            None => ProviderCredentialStorageAdmission::MarkerCompatible,
        }
    }
}

impl StorageProvider {
    /// Admit only age-armored provider credentials for extension storage.
    #[must_use]
    pub fn credential_storage_admission(&self) -> ProviderCredentialStorageAdmission {
        match self.provider.secrets().into_iter().find(|secret| {
            ProviderCredentialEncoding::observe(secret) == ProviderCredentialEncoding::Plaintext
        }) {
            Some(_) => ProviderCredentialStorageAdmission::PlaintextPresent,
            None => ProviderCredentialStorageAdmission::MarkerCompatible,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::ProviderCredentialStorageAdmission;
    use crate::{
        ActiveVaultScope, AuthProvidersSnapshot, DeviceIdentity, ProviderCredentialRejection,
    };

    #[test]
    fn admission_accepts_sealed_credentials_only() -> anyhow::Result<()> {
        let identity = DeviceIdentity::generate()?;
        let plain = AuthProvidersSnapshot::credential_fixture()?;
        assert_eq!(
            plain.credential_storage_admission(),
            ProviderCredentialStorageAdmission::PlaintextPresent
        );
        for row in &plain.providers {
            let expected = match row.provider.secrets().len() {
                0 => ProviderCredentialStorageAdmission::MarkerCompatible,
                _ => ProviderCredentialStorageAdmission::PlaintextPresent,
            };
            assert_eq!(row.credential_storage_admission(), expected);
        }
        let sealed = plain
            .seal_credentials(&identity)
            .map_err(ProviderCredentialRejection::into_cause)?;
        assert_eq!(
            sealed.credential_storage_admission(),
            ProviderCredentialStorageAdmission::MarkerCompatible
        );
        assert_eq!(
            AuthProvidersSnapshot {
                providers: Vec::new(),
                active_vault_store_id: ActiveVaultScope::StoreId("store-1".to_owned()),
            }
            .credential_storage_admission(),
            ProviderCredentialStorageAdmission::MarkerCompatible
        );
        Ok(())
    }
}

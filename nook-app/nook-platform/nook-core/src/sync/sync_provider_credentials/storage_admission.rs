//! Lexical admission of provider credentials into extension storage.
//!
//! Extension pairing persists website-sealed provider grants without an
//! unlocked device session in the offscreen document. Admission observes only
//! whether every credential field is empty or carries the armor marker; it
//! does not validate the armored bytes, their recipient, or authentication.

#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use super::{AGE_ARMOR_MARKER, ProviderCredentialField};
use crate::{AuthProvidersSnapshotData, StorageProviderData};

/// Marker compatibility is a storage admission check, not ciphertext validity.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderCredentialStorageAdmission {
    MarkerCompatible,
    PlaintextPresent,
}

/// A lexical credential observation, not ciphertext validation or authorization.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderCredentialEncoding {
    Empty,
    ArmorMarked,
    Plaintext,
}
impl ProviderCredentialEncoding {
    #[must_use]
    pub fn observe(value: &str) -> Self {
        if value.is_empty() {
            Self::Empty
        } else if value.contains(AGE_ARMOR_MARKER) {
            Self::ArmorMarked
        } else {
            Self::Plaintext
        }
    }
}

impl AuthProvidersSnapshotData {
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

impl StorageProviderData {
    /// Admit only absent or age-armored provider credentials for extension storage.
    #[must_use]
    pub fn credential_storage_admission(&self) -> ProviderCredentialStorageAdmission {
        match self
            .credential_texts()
            .into_iter()
            .find(|text| !ProviderCredentialField::allows_storage(text))
        {
            Some(_) => ProviderCredentialStorageAdmission::PlaintextPresent,
            None => ProviderCredentialStorageAdmission::MarkerCompatible,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{AGE_ARMOR_MARKER, ProviderCredentialEncoding, ProviderCredentialStorageAdmission};
    use crate::{
        ActiveVaultScope, AuthProvidersSnapshotData, DeviceIdentity, ProviderCredentialRejection,
        S3ProviderConfig, StorageProviderData, StorageProviderType, StoredGithubPat,
        StoredS3Configuration,
    };

    impl AuthProvidersSnapshotData {
        fn admission_fixture(pat: &str) -> Self {
            Self {
                providers: vec![StorageProviderData::github(
                    "gh-1",
                    "GitHub",
                    pat,
                    "nook",
                    "2026-06-24T00:00:00.000Z",
                )],
                active_vault_store_id: ActiveVaultScope::Unselected,
            }
        }
    }

    #[test]
    fn presealed_check_accepts_sealed_or_empty_credentials() -> anyhow::Result<()> {
        let identity = DeviceIdentity::generate()?;
        let mut snapshot = AuthProvidersSnapshotData::admission_fixture("github_pat_11PRESEAL");
        assert_ne!(
            snapshot.credential_storage_admission(),
            ProviderCredentialStorageAdmission::MarkerCompatible
        );
        snapshot = snapshot
            .seal_credentials(&identity)
            .map_err(ProviderCredentialRejection::into_cause)?;
        assert_eq!(
            snapshot.credential_storage_admission(),
            ProviderCredentialStorageAdmission::MarkerCompatible
        );
        assert_eq!(
            (AuthProvidersSnapshotData {
                providers: Vec::new(),
                active_vault_store_id: ActiveVaultScope::StoreId("store-1".to_owned()),
            })
            .credential_storage_admission(),
            ProviderCredentialStorageAdmission::MarkerCompatible
        );
        Ok(())
    }

    #[test]
    fn an_s3_row_is_admitted_only_with_its_secret_sealed() -> anyhow::Result<()> {
        let identity = DeviceIdentity::generate()?;
        let mut row = StorageProviderData::github("s3", "S3", "", "", "now");
        row.provider_type = StorageProviderType::S3;
        row.github_pat = StoredGithubPat::Missing;
        row.s3 = StoredS3Configuration::Configured(S3ProviderConfig::fixture()?);
        let snapshot = AuthProvidersSnapshotData {
            providers: vec![row],
            active_vault_store_id: ActiveVaultScope::Unselected,
        };
        assert_eq!(
            snapshot.credential_storage_admission(),
            ProviderCredentialStorageAdmission::PlaintextPresent
        );
        let sealed = snapshot
            .seal_credentials_for(&identity.public_key())
            .map_err(ProviderCredentialRejection::into_cause)?;
        assert_eq!(
            sealed.credential_storage_admission(),
            ProviderCredentialStorageAdmission::MarkerCompatible
        );
        Ok(())
    }

    #[test]
    fn marker_observation_does_not_validate_ciphertext() -> anyhow::Result<()> {
        let identity = DeviceIdentity::generate()?;
        let malformed = format!("prefix {AGE_ARMOR_MARKER} malformed suffix");
        let mut snapshot = AuthProvidersSnapshotData::admission_fixture(&malformed);
        assert_eq!(
            ProviderCredentialEncoding::observe(&malformed),
            ProviderCredentialEncoding::ArmorMarked
        );
        assert_eq!(
            snapshot.credential_storage_admission(),
            ProviderCredentialStorageAdmission::MarkerCompatible
        );
        let original = snapshot.clone();
        snapshot = snapshot
            .seal_credentials(&identity)
            .map_err(ProviderCredentialRejection::into_cause)?;
        assert_eq!(snapshot, original);
        snapshot = snapshot
            .seal_credentials_for(&identity.public_key())
            .map_err(ProviderCredentialRejection::into_cause)?;
        assert_eq!(snapshot, original);
        match snapshot.open_credentials(&identity) {
            Ok(_) => anyhow::bail!("malformed armor must not open"),
            Err(rejection) => assert_eq!(rejection.snapshot, original),
        }
        Ok(())
    }

    #[test]
    fn credential_observation_preserves_empty_and_case_distinctions() {
        for (value, expected) in [
            ("", ProviderCredentialEncoding::Empty),
            (" ", ProviderCredentialEncoding::Plaintext),
            (
                "begin age encrypted file",
                ProviderCredentialEncoding::Plaintext,
            ),
            (
                "xBEGIN AGE ENCRYPTED FILEy",
                ProviderCredentialEncoding::ArmorMarked,
            ),
        ] {
            assert_eq!(ProviderCredentialEncoding::observe(value), expected);
        }
    }
}

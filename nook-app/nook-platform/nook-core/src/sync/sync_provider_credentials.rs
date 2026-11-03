//! Device-key sealing of the sync-provider credentials inside a persisted
//! snapshot: each row's GitHub token, OAuth access or web-auth token, or S3
//! secret access key, as [`crate::StoredProvider::secrets`] names them.

#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use crate::{
    AgeArmoredCiphertext, AuthProvidersSnapshot, DeviceIdentity, DevicePublicKey,
    ProviderSecretText, Sha256Hex,
    errors::{MultiDeviceError, MultiDeviceResult},
};
use zeroize::Zeroizing;

mod storage_admission;
pub use storage_admission::{ProviderCredentialEncoding, ProviderCredentialStorageAdmission};

/// Marker substring present in every age-armored credential ciphertext.
pub const AGE_ARMOR_MARKER: &str = "BEGIN AGE ENCRYPTED FILE";

/// Rejected transitions retain the original snapshot, including its encrypted
/// fields.
pub struct ProviderCredentialRejection {
    pub snapshot: AuthProvidersSnapshot,
    pub cause: MultiDeviceError,
}

impl ProviderCredentialRejection {
    /// Discard an admitted snapshot at a failed I/O boundary. Dropping it
    /// wipes its credentials.
    #[must_use]
    pub fn into_cause(self) -> MultiDeviceError {
        self.cause
    }
}

#[derive(Clone, Copy)]
enum CredentialTransition<'a> {
    Seal(&'a DevicePublicKey),
    Open(&'a DeviceIdentity),
}

impl CredentialTransition<'_> {
    /// Sealing armors plaintext and keeps armor, which is ciphertext already.
    /// Opening opens armor and refuses plaintext.
    fn apply(self, secret: &ProviderSecretText) -> MultiDeviceResult<ProviderSecretText> {
        match (self, ProviderCredentialEncoding::observe(secret)) {
            (Self::Seal(key), ProviderCredentialEncoding::Plaintext) => {
                Ok(ProviderSecretText::try_from(
                    key.seal_bytes(secret.expose().as_bytes())?.into_inner(),
                )?)
            }
            (Self::Seal(_), ProviderCredentialEncoding::ArmorMarked) => Ok(secret.clone()),
            (Self::Open(identity), ProviderCredentialEncoding::ArmorMarked) => {
                Ok(ProviderSecretText::try_from(identity.open_utf8(
                    &AgeArmoredCiphertext::parse(secret.expose())?,
                )?)?)
            }
            (Self::Open(_), ProviderCredentialEncoding::Plaintext) => {
                Err(MultiDeviceError::UnsealedProviderCredential)
            }
        }
    }
}

impl AuthProvidersSnapshot {
    /// Produce an encrypted storage projection without copying plaintext
    /// credentials.
    pub fn sealed_credentials_projection(
        &self,
        identity: &DeviceIdentity,
    ) -> MultiDeviceResult<Self> {
        let public_key = identity.public_key();
        let transition = CredentialTransition::Seal(&public_key);
        Ok(Self {
            providers: self
                .providers
                .iter()
                .map(|row| row.transition_secrets(|secret| transition.apply(secret)))
                .collect::<MultiDeviceResult<Vec<_>>>()?,
            active_vault_store_id: self.active_vault_store_id.clone(),
        })
    }

    pub fn seal_credentials(
        self,
        identity: &DeviceIdentity,
    ) -> Result<Self, ProviderCredentialRejection> {
        self.seal_credentials_for(&identity.public_key())
    }

    pub fn seal_credentials_for(
        self,
        public_key: &DevicePublicKey,
    ) -> Result<Self, ProviderCredentialRejection> {
        self.transition_credentials(CredentialTransition::Seal(public_key))
    }

    pub fn open_credentials(
        self,
        identity: &DeviceIdentity,
    ) -> Result<Self, ProviderCredentialRejection> {
        self.transition_credentials(CredentialTransition::Open(identity))
    }

    /// Every row's credentials transition, or none do: a failure returns the
    /// untouched original.
    fn transition_credentials(
        self,
        transition: CredentialTransition<'_>,
    ) -> Result<Self, ProviderCredentialRejection> {
        let providers = self
            .providers
            .iter()
            .map(|row| row.transition_secrets(|secret| transition.apply(secret)))
            .collect::<MultiDeviceResult<Vec<_>>>();
        match providers {
            Ok(providers) => Ok(Self {
                providers,
                active_vault_store_id: self.active_vault_store_id,
            }),
            Err(cause) => Err(ProviderCredentialRejection {
                snapshot: self,
                cause,
            }),
        }
    }

    /// Authenticate every credential for an exact recipient without retaining
    /// the decrypted plaintext.
    pub fn authenticate_credentials_for(&self, identity: &DeviceIdentity) -> MultiDeviceResult<()> {
        for provider in &self.providers {
            for secret in provider.provider.secrets() {
                let ciphertext = AgeArmoredCiphertext::parse(secret.expose())?;
                let _plaintext = Zeroizing::new(identity.open_utf8(&ciphertext)?);
            }
        }
        Ok(())
    }

    /// Hash the canonical typed provider snapshot, including encrypted fields.
    pub fn companion_pairing_manifest_digest(&self) -> serde_json::Result<Sha256Hex> {
        Ok(Sha256Hex::from_bytes(&serde_json::to_vec(self)?))
    }
}

#[cfg(test)]
mod tests {
    use super::{AGE_ARMOR_MARKER, ProviderCredentialRejection};
    use crate::errors::MultiDeviceError;
    use crate::{
        ActiveVaultScope, AuthProvidersSnapshot, DeviceIdentity, ProviderSecretText,
        StorageProvider, StoredProvider,
    };

    impl AuthProvidersSnapshot {
        /// One row of every credential-bearing provider.
        pub(crate) fn credential_fixture() -> anyhow::Result<Self> {
            Ok(Self {
                providers: vec![
                    StorageProvider::fixture("github", StoredProvider::github_fixture()?),
                    StorageProvider::fixture("drive", StoredProvider::google_drive_fixture()?),
                    StorageProvider::fixture("icloud", StoredProvider::icloud_fixture()?),
                    StorageProvider::fixture("s3", StoredProvider::s3_fixture()?),
                    StorageProvider::fixture("local", StoredProvider::Local {}),
                ],
                active_vault_store_id: ActiveVaultScope::Unselected,
            })
        }

        fn secret_texts(&self) -> Vec<String> {
            self.providers
                .iter()
                .flat_map(|row| row.provider.secrets())
                .map(|secret| secret.expose().to_owned())
                .collect()
        }
    }

    #[test]
    fn every_credential_seals_and_opens_back_to_its_text() -> anyhow::Result<()> {
        let identity = DeviceIdentity::generate()?;
        let plain = AuthProvidersSnapshot::credential_fixture()?;
        let sealed = plain
            .clone()
            .seal_credentials(&identity)
            .map_err(ProviderCredentialRejection::into_cause)?;
        assert_eq!(sealed.secret_texts().len(), 4);
        for text in sealed.secret_texts() {
            assert!(text.contains(AGE_ARMOR_MARKER));
        }
        for (sealed_row, plain_row) in sealed.providers.iter().zip(&plain.providers) {
            assert_eq!(sealed_row.kind(), plain_row.kind());
            assert_eq!(sealed_row.label, plain_row.label);
        }
        assert_eq!(
            sealed.sealed_credentials_projection(&identity)?,
            sealed,
            "sealing armor again keeps it"
        );
        let opened = sealed
            .open_credentials(&identity)
            .map_err(ProviderCredentialRejection::into_cause)?;
        assert_eq!(opened, plain);
        Ok(())
    }

    #[test]
    fn opening_refuses_plaintext_and_another_devices_armor_whole() -> anyhow::Result<()> {
        let identity = DeviceIdentity::generate()?;
        let other = DeviceIdentity::generate()?;
        let plain = AuthProvidersSnapshot::credential_fixture()?;
        let Err(rejected) = plain.clone().open_credentials(&identity) else {
            anyhow::bail!("plaintext never opens");
        };
        assert!(matches!(
            rejected.cause,
            MultiDeviceError::UnsealedProviderCredential
        ));
        assert_eq!(rejected.snapshot, plain);
        let sealed = plain
            .seal_credentials_for(&other.public_key())
            .map_err(ProviderCredentialRejection::into_cause)?;
        assert!(sealed.clone().open_credentials(&identity).is_err());
        // A damaged last credential leaves every row as it was.
        let mut damaged = sealed.clone();
        if let Some(row) = damaged.providers.get_mut(3) {
            row.provider = row.provider.transition_secrets(|_| {
                ProviderSecretText::try_from(AGE_ARMOR_MARKER.to_owned())
            })?;
        }
        let Err(rejected) = damaged.clone().open_credentials(&other) else {
            anyhow::bail!("damaged armor never opens");
        };
        assert_eq!(rejected.snapshot, damaged);
        Ok(())
    }

    #[test]
    fn pairing_authenticates_every_credential_for_its_recipient() -> anyhow::Result<()> {
        let recipient = DeviceIdentity::generate()?;
        let other = DeviceIdentity::generate()?;
        let plain = AuthProvidersSnapshot::credential_fixture()?;
        assert!(plain.authenticate_credentials_for(&recipient).is_err());
        let mut sealed = plain
            .seal_credentials_for(&recipient.public_key())
            .map_err(ProviderCredentialRejection::into_cause)?;
        let digest = sealed.companion_pairing_manifest_digest()?;
        sealed.authenticate_credentials_for(&recipient)?;
        assert!(sealed.authenticate_credentials_for(&other).is_err());
        if let Some(row) = sealed.providers.first_mut() {
            row.label = "Substituted".to_owned();
        }
        assert_ne!(sealed.companion_pairing_manifest_digest()?, digest);
        Ok(())
    }
}

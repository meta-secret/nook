//! Portable local keyring records for independently protected identities.

use std::collections::HashSet;

use ed25519_dalek::SigningKey;
use serde::{Deserialize, Serialize};

use crate::{
    AgeArmoredCiphertext, AppId, AppKey, DeviceSigningPublicKey, IdentityId, MultiDeviceError,
    MultiDeviceResult, SigningSeedHex, WrappedDeviceIdentity,
};

pub const LOCAL_IDENTITY_KEYRING_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalIdentityKeyringEntry {
    identity_id: IdentityId,
    app_id: AppId,
    wrapped_app_key: WrappedDeviceIdentity,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    signing_seed_envelope: Option<AgeArmoredCiphertext>,
}

impl LocalIdentityKeyringEntry {
    pub fn protected(
        identity_id: IdentityId,
        app_key: &AppKey,
        wrapped_app_key: WrappedDeviceIdentity,
        signing_seed: &str,
    ) -> MultiDeviceResult<Self> {
        let signing_public_key = signing_public_key(signing_seed)?;
        let signing_seed_envelope = app_key.seal_utf8(signing_seed)?;
        let entry = Self {
            identity_id,
            app_id: app_key.app_id().clone(),
            wrapped_app_key,
            signing_seed_envelope: Some(signing_seed_envelope),
        };
        if entry.signing_public_key(app_key)? != signing_public_key {
            return Err(MultiDeviceError::InvalidDeviceIdentity(
                "protected signing seed verification failed".to_owned(),
            ));
        }
        Ok(entry)
    }

    #[must_use]
    pub fn legacy(
        identity_id: IdentityId,
        app_id: AppId,
        wrapped_app_key: WrappedDeviceIdentity,
    ) -> Self {
        Self {
            identity_id,
            app_id,
            wrapped_app_key,
            signing_seed_envelope: None,
        }
    }

    #[must_use]
    pub fn identity_id(&self) -> &IdentityId {
        &self.identity_id
    }

    #[must_use]
    pub fn app_id(&self) -> &AppId {
        &self.app_id
    }

    #[must_use]
    pub fn wrapped_app_key(&self) -> &WrappedDeviceIdentity {
        &self.wrapped_app_key
    }

    #[must_use]
    pub fn has_signing_seed(&self) -> bool {
        self.signing_seed_envelope.is_some()
    }

    pub fn open_signing_seed(&self, app_key: &AppKey) -> MultiDeviceResult<Option<String>> {
        self.require_matching_app_key(app_key)?;
        self.signing_seed_envelope
            .as_ref()
            .map(|envelope| app_key.open_utf8(envelope))
            .transpose()
    }

    pub fn signing_public_key(
        &self,
        app_key: &AppKey,
    ) -> MultiDeviceResult<DeviceSigningPublicKey> {
        let seed = self.open_signing_seed(app_key)?.ok_or_else(|| {
            MultiDeviceError::InvalidDeviceIdentity(
                "local identity keyring entry has no protected signing seed".to_owned(),
            )
        })?;
        signing_public_key(&seed)
    }

    pub fn protect_signing_seed(
        &mut self,
        app_key: &AppKey,
        signing_seed: &str,
    ) -> MultiDeviceResult<DeviceSigningPublicKey> {
        self.require_matching_app_key(app_key)?;
        let signing_public_key = signing_public_key(signing_seed)?;
        self.signing_seed_envelope = Some(app_key.seal_utf8(signing_seed)?);
        Ok(signing_public_key)
    }

    fn require_matching_app_key(&self, app_key: &AppKey) -> MultiDeviceResult<()> {
        if self.app_id != *app_key.app_id() {
            return Err(MultiDeviceError::InvalidDeviceIdentity(
                "local identity keyring app id does not match the unlocked app key".to_owned(),
            ));
        }
        Ok(())
    }
}

fn signing_public_key(signing_seed: &str) -> MultiDeviceResult<DeviceSigningPublicKey> {
    let seed = SigningSeedHex::parse(signing_seed)?;
    let bytes = hex::decode(seed.as_str()).map_err(|_| {
        MultiDeviceError::InvalidDeviceIdentity("event signing seed is not hexadecimal".to_owned())
    })?;
    let seed_bytes: [u8; 32] = bytes.try_into().map_err(|_| {
        MultiDeviceError::InvalidDeviceIdentity(
            "event signing seed has the wrong length".to_owned(),
        )
    })?;
    Ok(DeviceSigningPublicKey::from_trusted(hex::encode(
        SigningKey::from_bytes(&seed_bytes)
            .verifying_key()
            .as_bytes(),
    )))
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalIdentityKeyring {
    version: u32,
    entries: Vec<LocalIdentityKeyringEntry>,
}

impl LocalIdentityKeyring {
    #[must_use]
    pub const fn empty() -> Self {
        Self {
            version: LOCAL_IDENTITY_KEYRING_VERSION,
            entries: Vec::new(),
        }
    }

    pub fn from_entries(entries: Vec<LocalIdentityKeyringEntry>) -> MultiDeviceResult<Self> {
        let keyring = Self {
            version: LOCAL_IDENTITY_KEYRING_VERSION,
            entries,
        };
        keyring.validate()?;
        Ok(keyring)
    }

    pub fn validate(&self) -> MultiDeviceResult<()> {
        if self.version != LOCAL_IDENTITY_KEYRING_VERSION {
            return Err(MultiDeviceError::InvalidDeviceIdentity(format!(
                "unsupported local identity keyring version: {}",
                self.version
            )));
        }
        let mut identity_ids = HashSet::with_capacity(self.entries.len());
        let mut app_ids = HashSet::with_capacity(self.entries.len());
        for entry in &self.entries {
            if !identity_ids.insert(entry.identity_id()) {
                return Err(MultiDeviceError::DuplicateIdentity {
                    identity_id: entry.identity_id().to_string(),
                });
            }
            if !app_ids.insert(entry.app_id()) {
                return Err(MultiDeviceError::DuplicateAppKeyOwnership {
                    app_id: entry.app_id().to_string(),
                });
            }
        }
        Ok(())
    }

    #[must_use]
    pub fn entries(&self) -> &[LocalIdentityKeyringEntry] {
        &self.entries
    }

    #[must_use]
    pub fn entry(&self, identity_id: &IdentityId) -> Option<&LocalIdentityKeyringEntry> {
        self.entries
            .iter()
            .find(|entry| entry.identity_id() == identity_id)
    }

    pub fn insert(&mut self, entry: LocalIdentityKeyringEntry) -> MultiDeviceResult<()> {
        if self.entry(entry.identity_id()).is_some() {
            return Err(MultiDeviceError::DuplicateIdentity {
                identity_id: entry.identity_id().to_string(),
            });
        }
        self.entries.push(entry);
        self.validate()
    }

    pub fn replace(&mut self, entry: LocalIdentityKeyringEntry) -> MultiDeviceResult<()> {
        let existing = self
            .entries
            .iter_mut()
            .find(|candidate| candidate.identity_id() == entry.identity_id())
            .ok_or_else(|| MultiDeviceError::IdentityNotFound {
                identity_id: entry.identity_id().to_string(),
            })?;
        if existing.app_id() != entry.app_id() {
            return Err(MultiDeviceError::InvalidDeviceIdentity(
                "cannot replace a local identity keyring entry with a different app id".to_owned(),
            ));
        }
        *existing = entry;
        self.validate()
    }

    pub fn remove(
        &mut self,
        identity_id: &IdentityId,
    ) -> MultiDeviceResult<LocalIdentityKeyringEntry> {
        let index = self
            .entries
            .iter()
            .position(|entry| entry.identity_id() == identity_id)
            .ok_or_else(|| MultiDeviceError::IdentityNotFound {
                identity_id: identity_id.to_string(),
            })?;
        Ok(self.entries.remove(index))
    }
}

impl Default for LocalIdentityKeyring {
    fn default() -> Self {
        Self::empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry() -> anyhow::Result<(LocalIdentityKeyringEntry, AppKey, DeviceSigningPublicKey)> {
        let app_key = AppKey::generate()?;
        let identity_id = IdentityId::generate()?;
        let wrapped = crate::wrap_device_identity_with_pin(
            &app_key.secret_string(),
            "correct horse battery staple",
        )?;
        let seed = "11".repeat(32);
        let signing_public_key = signing_public_key(&seed)?;
        let entry = LocalIdentityKeyringEntry::protected(identity_id, &app_key, wrapped, &seed)?;
        Ok((entry, app_key, signing_public_key))
    }

    #[test]
    fn protected_entry_opens_only_with_its_app_key() -> anyhow::Result<()> {
        let (entry, app_key, signing_public_key) = entry()?;

        assert_eq!(entry.signing_public_key(&app_key)?, signing_public_key);
        assert!(entry.open_signing_seed(&AppKey::generate()?).is_err());
        Ok(())
    }

    #[test]
    fn keyring_rejects_shared_app_keys_and_duplicate_identities() -> anyhow::Result<()> {
        let (first, _, _) = entry()?;
        let duplicate_identity = first.clone();
        assert!(
            LocalIdentityKeyring::from_entries(vec![first.clone(), duplicate_identity]).is_err()
        );

        let shared_app_key = LocalIdentityKeyringEntry::legacy(
            IdentityId::generate()?,
            first.app_id().clone(),
            first.wrapped_app_key().clone(),
        );
        assert!(LocalIdentityKeyring::from_entries(vec![first, shared_app_key]).is_err());
        Ok(())
    }

    #[test]
    fn keyring_roundtrip_preserves_only_wrapped_private_material() -> anyhow::Result<()> {
        let (entry, app_key, signing_public_key) = entry()?;
        let keyring = LocalIdentityKeyring::from_entries(vec![entry])?;
        let encoded = serde_json::to_string(&keyring)?;
        let decoded: LocalIdentityKeyring = serde_json::from_str(&encoded)?;

        decoded.validate()?;
        assert!(!encoded.contains(app_key.secret_string().as_str()));
        assert_eq!(
            decoded.entries()[0].signing_public_key(&app_key)?,
            signing_public_key
        );
        Ok(())
    }
}

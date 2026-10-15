//! Portable local keyring records for independently protected identities.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#[cfg(test)]
use crate::DeviceIdentityProtection;

use std::collections::HashSet;

use ed25519_dalek::SigningKey;
use serde::{Deserialize, Serialize};

use crate::{
    AgeArmoredCiphertext, AppId, AppKey, DeviceSigningPublicKey, IdentityId, MultiDeviceError,
    MultiDeviceResult, SigningSeedHex, WrappedDeviceIdentity,
};

mod transition;
pub use transition::{
    KeyringEntryRejection, KeyringRejection, RemovedLocalIdentityKey, WrappedAppKeyReplacement,
};

pub enum LocalIdentityProtection<'a> {
    Protected(&'a LocalIdentityKeyringEntry),
    Unprotected,
}

impl<'a> LocalIdentityProtection<'a> {
    pub fn require_protected(self) -> MultiDeviceResult<&'a LocalIdentityKeyringEntry> {
        match self {
            Self::Protected(entry) => Ok(entry),
            Self::Unprotected => Err(MultiDeviceError::InvalidDeviceIdentity(
                "Identity has no protected local keyring entry".to_owned(),
            )),
        }
    }
}

pub const LOCAL_IDENTITY_KEYRING_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalIdentityKeyringEntry {
    identity_id: IdentityId,
    app_id: AppId,
    wrapped_app_key: WrappedDeviceIdentity,
    signing_seed_envelope: AgeArmoredCiphertext,
}

impl LocalIdentityKeyringEntry {
    pub fn protected(
        identity_id: IdentityId,
        app_key: &AppKey,
        wrapped_app_key: WrappedDeviceIdentity,
        signing_seed: &str,
    ) -> MultiDeviceResult<Self> {
        let signing_public_key = DeviceSigningPublicKey::derive_from_seed(signing_seed)?;
        let signing_seed_envelope = app_key.seal_utf8(signing_seed)?;
        let entry = Self {
            identity_id,
            app_id: app_key.app_id().clone(),
            wrapped_app_key,
            signing_seed_envelope,
        };
        if entry.signing_public_key(app_key)? != signing_public_key {
            return Err(MultiDeviceError::InvalidDeviceIdentity(
                "protected signing seed verification failed".to_owned(),
            ));
        }
        Ok(entry)
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

    pub fn open_signing_seed(&self, app_key: &AppKey) -> MultiDeviceResult<SigningSeedHex> {
        self.require_matching_app_key(app_key)?;
        Ok(SigningSeedHex::try_from(
            app_key.open_utf8(&self.signing_seed_envelope)?,
        )?)
    }

    pub fn signing_public_key(
        &self,
        app_key: &AppKey,
    ) -> MultiDeviceResult<DeviceSigningPublicKey> {
        DeviceSigningPublicKey::derive_from_seed(self.open_signing_seed(app_key)?.as_str())
    }

    pub fn replace_wrapped_app_key(
        mut self,
        request: WrappedAppKeyReplacement<'_>,
    ) -> Result<Self, KeyringEntryRejection> {
        if self.app_id != *request.app_id {
            return Err(KeyringEntryRejection {
                entry: self,
                cause: MultiDeviceError::InvalidDeviceIdentity(
                    "cannot replace a wrapped app key owned by a different app id".to_owned(),
                ),
            });
        }
        self.wrapped_app_key = request.wrapped_app_key;
        Ok(self)
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

impl DeviceSigningPublicKey {
    fn derive_from_seed(signing_seed: &str) -> MultiDeviceResult<Self> {
        let seed = SigningSeedHex::parse(signing_seed)?;
        let bytes = hex::decode(seed.as_str()).map_err(|_| {
            MultiDeviceError::InvalidDeviceIdentity(
                "event signing seed is not hexadecimal".to_owned(),
            )
        })?;
        let seed_bytes: [u8; 32] = bytes.try_into().map_err(|_| {
            MultiDeviceError::InvalidDeviceIdentity(
                "event signing seed has the wrong length".to_owned(),
            )
        })?;
        Ok(Self::from_trusted(hex::encode(
            SigningKey::from_bytes(&seed_bytes)
                .verifying_key()
                .as_bytes(),
        )))
    }
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
    pub fn entry(&self, identity_id: &IdentityId) -> LocalIdentityProtection<'_> {
        match self
            .entries
            .iter()
            .find(|entry| entry.identity_id() == identity_id)
        {
            Some(entry) => LocalIdentityProtection::Protected(entry),
            None => LocalIdentityProtection::Unprotected,
        }
    }

    pub fn replace_wrapped_app_key(
        mut self,
        request: WrappedAppKeyReplacement<'_>,
    ) -> Result<Self, KeyringRejection> {
        match self
            .entries
            .iter()
            .position(|entry| entry.app_id() == request.app_id)
        {
            None => Err(KeyringRejection {
                keyring: self,
                cause: MultiDeviceError::InvalidDeviceIdentity(
                    "wrapped app key has no local keyring owner".to_owned(),
                ),
            }),
            Some(index) => {
                let Some(entry) = self.entries.get_mut(index) else {
                    return Err(KeyringRejection {
                        keyring: self,
                        cause: MultiDeviceError::InvalidDeviceIdentity(
                            "wrapped app key has no local keyring owner".to_owned(),
                        ),
                    });
                };
                entry.wrapped_app_key = request.wrapped_app_key;
                Ok(self)
            }
        }
    }

    pub fn insert(mut self, entry: LocalIdentityKeyringEntry) -> Result<Self, KeyringRejection> {
        match self.admit_insertion(&entry) {
            Err(cause) => Err(KeyringRejection {
                keyring: self,
                cause,
            }),
            Ok(()) => {
                self.entries.push(entry);
                Ok(self)
            }
        }
    }

    fn admit_insertion(&self, entry: &LocalIdentityKeyringEntry) -> MultiDeviceResult<()> {
        match self.entry(entry.identity_id()) {
            LocalIdentityProtection::Protected(_) => Err(MultiDeviceError::DuplicateIdentity {
                identity_id: entry.identity_id().to_string(),
            }),
            LocalIdentityProtection::Unprotected => {
                if self
                    .entries
                    .iter()
                    .any(|existing| existing.app_id() == entry.app_id())
                {
                    return Err(MultiDeviceError::DuplicateAppKeyOwnership {
                        app_id: entry.app_id().to_string(),
                    });
                }
                self.validate()
            }
        }
    }

    pub fn replace(mut self, entry: LocalIdentityKeyringEntry) -> Result<Self, KeyringRejection> {
        match self.admit_replacement(&entry) {
            Err(cause) => Err(KeyringRejection {
                keyring: self,
                cause,
            }),
            Ok(index) => {
                let Some(existing) = self.entries.get_mut(index) else {
                    return Err(KeyringRejection {
                        keyring: self,
                        cause: MultiDeviceError::IdentityNotFound {
                            identity_id: entry.identity_id().to_string(),
                        },
                    });
                };
                *existing = entry;
                Ok(self)
            }
        }
    }

    fn admit_replacement(&self, entry: &LocalIdentityKeyringEntry) -> MultiDeviceResult<usize> {
        self.validate()?;
        let index = self.entry_index(entry.identity_id())?;
        if self
            .entries
            .get(index)
            .ok_or_else(|| MultiDeviceError::IdentityNotFound {
                identity_id: entry.identity_id().to_string(),
            })?
            .app_id()
            != entry.app_id()
        {
            return Err(MultiDeviceError::InvalidDeviceIdentity(
                "cannot replace a local identity keyring entry with a different app id".to_owned(),
            ));
        }
        Ok(index)
    }

    fn entry_index(&self, identity_id: &IdentityId) -> MultiDeviceResult<usize> {
        self.entries
            .iter()
            .position(|entry| entry.identity_id() == identity_id)
            .ok_or_else(|| MultiDeviceError::IdentityNotFound {
                identity_id: identity_id.to_string(),
            })
    }

    /// Rebind a protected entry to the replicated identity it was adopted into.
    pub fn rebind_identity(
        mut self,
        local_identity_id: &IdentityId,
        replicated_identity_id: &IdentityId,
    ) -> Result<Self, KeyringRejection> {
        let admitted = self.validate().and_then(|()| {
            if self
                .entries
                .iter()
                .any(|entry| entry.identity_id() == replicated_identity_id)
            {
                return Err(MultiDeviceError::ReplicatedIdentityAlreadyLocal {
                    identity_id: replicated_identity_id.to_string(),
                });
            }
            self.entry_index(local_identity_id)
        });
        match admitted {
            Ok(index) => match self.entries.get_mut(index) {
                Some(entry) => {
                    entry.identity_id = replicated_identity_id.clone();
                    Ok(self)
                }
                None => Err(KeyringRejection {
                    keyring: self,
                    cause: MultiDeviceError::IdentityNotFound {
                        identity_id: local_identity_id.to_string(),
                    },
                }),
            },
            Err(cause) => Err(KeyringRejection {
                keyring: self,
                cause,
            }),
        }
    }

    pub fn remove(
        mut self,
        identity_id: &IdentityId,
    ) -> Result<RemovedLocalIdentityKey, KeyringRejection> {
        match self.entry_index(identity_id) {
            Err(cause) => Err(KeyringRejection {
                keyring: self,
                cause,
            }),
            Ok(index) => {
                let entry = self.entries.remove(index);
                Ok(RemovedLocalIdentityKey {
                    keyring: self,
                    entry,
                })
            }
        }
    }
}

impl Default for LocalIdentityKeyring {
    fn default() -> Self {
        Self::empty()
    }
}

#[cfg(test)]
mod tests {
    use crate::WrappedAppKeyReplacement;

    use super::*;
    use crate::ValidationError;

    struct ProtectedEntryFixture {
        entry: LocalIdentityKeyringEntry,
        app_key: AppKey,
        signing_public_key: DeviceSigningPublicKey,
    }

    impl ProtectedEntryFixture {
        fn new() -> anyhow::Result<Self> {
            let app_key = AppKey::generate()?;
            let identity_id = IdentityId::generate()?;
            let wrapped = DeviceIdentityProtection::new(&app_key.secret_string())
                .with_pin("correct horse battery staple")?;
            let seed = "11".repeat(32);
            let signing_public_key = DeviceSigningPublicKey::derive_from_seed(&seed)?;
            let entry =
                LocalIdentityKeyringEntry::protected(identity_id, &app_key, wrapped, &seed)?;
            Ok(Self {
                entry,
                app_key,
                signing_public_key,
            })
        }

        fn expect_invalid_identity<T>(
            result: MultiDeviceResult<T>,
            expected: &str,
        ) -> anyhow::Result<()> {
            match result {
                Err(MultiDeviceError::InvalidDeviceIdentity(message)) => {
                    assert_eq!(message, expected);
                    Ok(())
                }
                Err(error) => Err(error.into()),
                Ok(_) => anyhow::bail!("Invalid identity operation unexpectedly succeeded"),
            }
        }

        fn expect_invalid_seed<T>(result: MultiDeviceResult<T>) -> anyhow::Result<()> {
            match result {
                Err(MultiDeviceError::Validation(ValidationError::SigningSeedInvalid)) => Ok(()),
                Err(error) => Err(error.into()),
                Ok(_) => anyhow::bail!("Invalid signing seed unexpectedly succeeded"),
            }
        }
    }

    #[test]
    fn entries_need_a_valid_seed_and_their_own_app_key() -> anyhow::Result<()> {
        let ProtectedEntryFixture { entry, app_key, .. } = ProtectedEntryFixture::new()?;
        for seed in [
            String::new(),
            "11".repeat(31),
            "11".repeat(33),
            "zz".repeat(32),
        ] {
            ProtectedEntryFixture::expect_invalid_seed(LocalIdentityKeyringEntry::protected(
                entry.identity_id().clone(),
                &app_key,
                entry.wrapped_app_key().clone(),
                &seed,
            ))?;
        }
        ProtectedEntryFixture::expect_invalid_identity(
            entry.open_signing_seed(&AppKey::generate()?),
            "local identity keyring app id does not match the unlocked app key",
        )?;
        Ok(())
    }

    #[test]
    fn protected_entry_opens_only_with_its_app_key() -> anyhow::Result<()> {
        let ProtectedEntryFixture {
            entry,
            app_key,
            signing_public_key,
        } = ProtectedEntryFixture::new()?;

        assert_eq!(entry.signing_public_key(&app_key)?, signing_public_key);
        assert!(entry.open_signing_seed(&AppKey::generate()?).is_err());
        Ok(())
    }

    #[test]
    fn keyring_rejects_shared_app_keys_and_duplicate_identities() -> anyhow::Result<()> {
        let ProtectedEntryFixture {
            entry: first,
            app_key,
            ..
        } = ProtectedEntryFixture::new()?;
        let duplicate_identity = first.clone();
        assert!(
            LocalIdentityKeyring::from_entries(vec![first.clone(), duplicate_identity]).is_err()
        );

        let shared_app_key = LocalIdentityKeyringEntry::protected(
            IdentityId::generate()?,
            &app_key,
            first.wrapped_app_key().clone(),
            &"22".repeat(32),
        )?;
        assert!(LocalIdentityKeyring::from_entries(vec![first, shared_app_key]).is_err());
        Ok(())
    }

    #[test]
    fn keyring_roundtrip_preserves_only_wrapped_private_material() -> anyhow::Result<()> {
        let ProtectedEntryFixture {
            entry,
            app_key,
            signing_public_key,
        } = ProtectedEntryFixture::new()?;
        let keyring = LocalIdentityKeyring::from_entries(vec![entry])?;
        let encoded = serde_json::to_string(&keyring)?;
        let decoded: LocalIdentityKeyring = serde_json::from_str(&encoded)?;

        decoded.validate()?;
        assert!(!encoded.contains(app_key.secret_string().as_str()));
        assert_eq!(
            decoded
                .entries()
                .first()
                .ok_or_else(|| anyhow::anyhow!("decoded keyring must contain its entry"))?
                .signing_public_key(&app_key)?,
            signing_public_key
        );
        Ok(())
    }

    #[test]
    fn entries_without_a_protected_signing_seed_are_rejected() -> anyhow::Result<()> {
        let ProtectedEntryFixture {
            entry,
            app_key,
            signing_public_key,
        } = ProtectedEntryFixture::new()?;
        let protected_wire = serde_json::to_value(&entry)?;
        let protected: LocalIdentityKeyringEntry = serde_json::from_value(protected_wire.clone())?;
        assert_eq!(protected.signing_public_key(&app_key)?, signing_public_key);

        let mut omitted_wire = protected_wire;
        let serde_json::Value::Object(omitted_fields) = &mut omitted_wire else {
            anyhow::bail!("local identity keyring entry did not serialize as an object");
        };
        omitted_fields.remove("signingSeedEnvelope");
        assert!(serde_json::from_value::<LocalIdentityKeyringEntry>(omitted_wire).is_err());
        Ok(())
    }

    #[test]
    fn replacing_wrapped_app_key_preserves_protected_signing_seed() -> anyhow::Result<()> {
        let ProtectedEntryFixture {
            mut entry,
            app_key,
            signing_public_key,
        } = ProtectedEntryFixture::new()?;
        let replacement = DeviceIdentityProtection::new(&app_key.secret_string())
            .with_pin("replacement browser protection")?;

        entry = entry.replace_wrapped_app_key(WrappedAppKeyReplacement {
            app_id: app_key.app_id(),
            wrapped_app_key: replacement.clone(),
        })?;

        assert_eq!(entry.wrapped_app_key(), &replacement);
        assert_eq!(entry.signing_public_key(&app_key)?, signing_public_key);
        assert!(
            entry
                .replace_wrapped_app_key(WrappedAppKeyReplacement {
                    app_id: AppKey::generate()?.app_id(),
                    wrapped_app_key: replacement
                })
                .is_err()
        );
        Ok(())
    }
}

#[cfg(test)]
mod rebind_tests {
    use super::*;

    #[test]
    fn rebinding_moves_one_entry_and_refuses_an_existing_target() -> anyhow::Result<()> {
        let app = AppKey::generate()?;
        let local = IdentityId::generate()?;
        let replicated = IdentityId::generate()?;
        let wrapped = crate::DeviceIdentityProtection::new(&app.secret_string())
            .with_pin("correct horse battery staple")?;
        let entry =
            LocalIdentityKeyringEntry::protected(local.clone(), &app, wrapped, &"22".repeat(32))?;
        let keyring = LocalIdentityKeyring::empty().insert(entry)?;
        let rebound = keyring.rebind_identity(&local, &replicated)?;
        assert_eq!(rebound.entries().len(), 1);
        assert!(matches!(
            rebound.entry(&replicated),
            LocalIdentityProtection::Protected(_)
        ));
        assert!(matches!(
            rebound.entry(&local),
            LocalIdentityProtection::Unprotected
        ));
        assert!(rebound.rebind_identity(&replicated, &replicated).is_err());
        Ok(())
    }
}

//! Restore vault encryption keys from the projection-cache YAML.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use crate::SessionError;

use crate::errors::{MultiDeviceError, VaultResult};
use crate::{
    DeviceIdentity, StoreId, VaultFormatDocument, VaultRecordView, VaultStoreIdentity, VaultType,
};

/// The vault a session reads, which decides the projection caches that may
/// unlock it.
#[derive(Debug, Clone, Copy)]
pub enum ProjectionCacheScope<'a> {
    /// The session reads this vault: only its own cache unlocks it, never
    /// the cache of another vault this browser holds.
    Vault(&'a StoreId),
    /// The session has no vault yet: the cache brings the vault it opens.
    Unselected,
}

/// Borrowed projection-cache YAML awaiting a key hydration action.
pub struct VaultProjectionCache<'a> {
    yaml: &'a str,
}

impl<'a> VaultProjectionCache<'a> {
    #[must_use]
    pub fn new(yaml: &'a str) -> Self {
        Self { yaml }
    }

    /// Resolve both vault keys for the session's vault. A cache of another
    /// vault fails closed: its keys would decrypt nothing of this one.
    pub fn unlock_for(
        self,
        identity: &DeviceIdentity,
        scope: ProjectionCacheScope<'_>,
    ) -> VaultResult<(String, String)> {
        if self.yaml.trim().is_empty() {
            return Err(SessionError::EmptyProjectionCache.into());
        }
        match scope {
            ProjectionCacheScope::Unselected => {}
            ProjectionCacheScope::Vault(expected) => {
                match VaultFormatDocument::new(self.yaml).store_id()? {
                    VaultStoreIdentity::Assigned(cached) if cached == expected.as_str() => {}
                    VaultStoreIdentity::Assigned(_) | VaultStoreIdentity::Unassigned => {
                        return Err(SessionError::ProjectionCacheOfAnotherVault.into());
                    }
                }
            }
        }
        self.unlock(identity)
    }

    /// Resolve both vault keys without accepting a sentinel projection cache.
    pub fn unlock(self, identity: &DeviceIdentity) -> VaultResult<(String, String)> {
        if self.yaml.trim().is_empty() {
            return Err(SessionError::EmptyProjectionCache.into());
        }
        let architecture = crate::VaultFormatDocument::new(self.yaml).architecture()?;
        if architecture.vault_type == VaultType::Sentinel {
            return Err(MultiDeviceError::SentinelCeremonyRequired.into());
        }
        let format = VaultFormatDocument::new(self.yaml).detect()?;
        let records = VaultFormatDocument::new(self.yaml).deserialize(format)?;
        let record_view = VaultRecordView::new(&records);
        let secrets_key = record_view.secrets_key(identity)?;
        let members_key = record_view.members_key(identity)?;
        Ok((secrets_key.into_inner(), members_key.into_inner()))
    }
}

#[cfg(test)]
mod tests {
    use crate::VaultKeys;
    use crate::{CreateSentinelShareRecordsRequest, SentinelShareEnvelope};
    use crate::{
        MultiDeviceError, VaultError, VaultNameRef, VaultStoreIdentityRef, VaultVersionWrite,
    };

    use super::*;
    use crate::VaultResult;
    use crate::test_support;

    #[test]
    fn hydrate_keys_from_genesis_projection_yaml() -> VaultResult<()> {
        let (keys, identity, yaml) = test_support::simple_genesis_projection()?;
        let (secrets_key, members_key) =
            VaultProjectionCache::new(yaml.as_str()).unlock(&identity)?;
        assert_eq!(secrets_key, keys.secrets_key.as_str());
        assert_eq!(members_key, keys.members_key.as_str());
        Ok(())
    }

    /// A session that reads one vault takes keys only from that vault's
    /// cache. Another vault's cache, though this device can open it, fails
    /// closed; a session with no vault yet takes the cache's own vault.
    #[test]
    fn a_cache_unlocks_only_the_vault_it_belongs_to() -> anyhow::Result<()> {
        let (keys, identity, yaml) = test_support::simple_genesis_projection()?;
        let cached = match VaultFormatDocument::new(yaml.as_str()).store_id()? {
            VaultStoreIdentity::Assigned(store_id) => StoreId::parse(&store_id)?,
            VaultStoreIdentity::Unassigned => anyhow::bail!("the fixture names its vault"),
        };
        let own = VaultProjectionCache::new(yaml.as_str())
            .unlock_for(&identity, ProjectionCacheScope::Vault(&cached))?;
        assert_eq!(
            own,
            (
                keys.secrets_key.as_str().to_owned(),
                keys.members_key.as_str().to_owned()
            )
        );

        let other = StoreId::generate()?;
        let refused = VaultProjectionCache::new(yaml.as_str())
            .unlock_for(&identity, ProjectionCacheScope::Vault(&other))
            .err()
            .ok_or_else(|| anyhow::anyhow!("another vault's cache must not unlock this one"))?;
        assert!(matches!(
            refused,
            VaultError::Session(SessionError::ProjectionCacheOfAnotherVault)
        ));

        let unselected = VaultProjectionCache::new(yaml.as_str())
            .unlock_for(&identity, ProjectionCacheScope::Unselected)?;
        assert_eq!(unselected, own);
        assert!(matches!(
            VaultProjectionCache::new(" ")
                .unlock_for(&identity, ProjectionCacheScope::Vault(&other)),
            Err(VaultError::Session(SessionError::EmptyProjectionCache))
        ));
        Ok(())
    }

    #[test]
    fn hydrate_fails_on_empty_cache() -> VaultResult<()> {
        let identity = DeviceIdentity::generate()?;
        assert!(VaultProjectionCache::new("").unlock(&identity).is_err());
        assert!(VaultProjectionCache::new("   ").unlock(&identity).is_err());
        Ok(())
    }

    #[test]
    fn hydrate_fails_closed_for_sentinel_projection_yaml() -> anyhow::Result<()> {
        use crate::{
            DeviceMode, SentinelPolicy, StoreId, VaultArchitecture, VaultRecordSet, VaultType,
        };

        let keys = VaultKeys::generate()?;
        let first = DeviceIdentity::generate()?;
        let second = DeviceIdentity::generate()?;
        let shares = SentinelShareEnvelope::create_sentinel_share_records(
            CreateSentinelShareRecordsRequest {
                keys: &keys,
                participants: &[first.clone(), second.clone()],
                threshold: 2.into(),
            },
        )?;
        let architecture = VaultArchitecture::sentinel_personal(
            DeviceMode::Standard,
            SentinelPolicy {
                threshold: 2.into(),
                required_participants: 2.into(),
                ready_participants: 2.into(),
            },
        );
        assert_eq!(architecture.vault_type, VaultType::Sentinel);
        let store_id = StoreId::generate()?;
        let yaml = VaultRecordSet::serialize_yaml_with_name_architecture(
            &shares,
            VaultStoreIdentityRef::Assigned(store_id.as_str()),
            VaultNameRef::Unnamed,
            VaultVersionWrite::Initial,
            &architecture,
        )?;

        let err = VaultProjectionCache::new(yaml.as_str())
            .unlock(&first)
            .err()
            .ok_or_else(|| {
                anyhow::anyhow!("vault session cache test should reject invalid input")
            })?;
        assert!(
            matches!(
                err,
                VaultError::MultiDevice(MultiDeviceError::SentinelCeremonyRequired)
            ),
            "expected SentinelCeremonyRequired, got {err:?}"
        );
        Ok(())
    }
}

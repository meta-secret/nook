//! Restore vault encryption keys from the projection-cache YAML.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use crate::SessionError;

use crate::errors::{MultiDeviceError, VaultResult};
use crate::{DeviceIdentity, VaultFormatDocument, VaultRecordView, VaultType};

/// Borrowed projection-cache YAML awaiting a key hydration action.
pub struct VaultProjectionCache<'a> {
    yaml: &'a str,
}

impl<'a> VaultProjectionCache<'a> {
    #[must_use]
    pub fn new(yaml: &'a str) -> Self {
        Self { yaml }
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
    use crate::{
        MultiDeviceError, VaultError, VaultNameRef, VaultStoreIdentityRef, VaultVersionWrite,
    };

    use super::*;
    use crate::test_support;
    use crate::{VaultResult, VaultUnlock};

    #[test]
    fn hydrate_keys_from_genesis_projection_yaml() -> VaultResult<()> {
        let (keys, identity, yaml) = test_support::simple_genesis_projection()?;
        let (secrets_key, members_key) =
            VaultProjectionCache::new(yaml.as_str()).unlock(&identity)?;
        assert_eq!(secrets_key, keys.secrets_key.as_str());
        assert_eq!(members_key, keys.members_key.as_str());
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
            DeviceMode, SentinelPolicy, VaultArchitecture, VaultRecordSet, VaultType,
            create_sentinel_share_records, generate_store_id,
        };

        let keys = VaultKeys::generate()?;
        let first = DeviceIdentity::generate()?;
        let second = DeviceIdentity::generate()?;
        let shares =
            create_sentinel_share_records(&keys, &[first.clone(), second.clone()], 2.into())?;
        let architecture = VaultArchitecture::sentinel_personal(
            DeviceMode::Standard,
            SentinelPolicy {
                threshold: 2.into(),
                required_participants: 2.into(),
                ready_participants: 2.into(),
            },
        );
        assert_eq!(architecture.vault_type, VaultType::Sentinel);
        let store_id = generate_store_id()?;
        let yaml = VaultRecordSet::serialize_yaml_with_unlock_name_architecture(
            &shares,
            &VaultUnlock::Keys,
            &[],
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

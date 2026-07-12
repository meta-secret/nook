//! Restore vault encryption keys from the projection-cache YAML.

use crate::errors::{EventError, MultiDeviceError, VaultResult};
use crate::{
    DeviceIdentity, VaultType, deserialize_stored, detect_stored_format, resolve_members_key,
    resolve_secrets_key,
};

/// Resolve `secrets_key` and `members_key` from a stored vault YAML projection cache.
///
/// Sentinel vaults fail closed: auth envelopes must never unlock a sentinel session.
/// Browser unlock uses the opened-share ceremony instead.
pub fn hydrate_keys_from_projection_yaml(
    yaml: &str,
    identity: &DeviceIdentity,
) -> VaultResult<(String, String)> {
    if yaml.trim().is_empty() {
        return Err(EventError::EmptyProjectionCache.into());
    }
    let architecture = crate::read_vault_architecture(yaml)?;
    if architecture.vault_type == VaultType::Sentinel {
        return Err(MultiDeviceError::SentinelCeremonyRequired.into());
    }
    let format = detect_stored_format(yaml)?;
    let records = deserialize_stored(yaml, format)?;
    let secrets_key = resolve_secrets_key(&records, identity)?;
    let members_key = resolve_members_key(&records, identity)?;
    Ok((secrets_key.into_inner(), members_key.into_inner()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        VaultResult, VaultUnlock, generate_store_id, generate_vault_keys, genesis_auth_record,
        genesis_members_records, serialize_stored_yaml_with_unlock,
    };

    #[test]
    fn hydrate_keys_from_genesis_projection_yaml() -> VaultResult<()> {
        let keys = generate_vault_keys()?;
        let identity = DeviceIdentity::generate()?;
        let mut records = vec![genesis_auth_record(
            &identity,
            &keys.secrets_key,
            &keys.members_key,
        )?];
        records.extend(genesis_members_records(
            &identity,
            &keys.members_key,
            "2026-06-28T00:00:00Z",
        )?);
        let store_id = generate_store_id()?;
        let yaml = serialize_stored_yaml_with_unlock(
            &records,
            &VaultUnlock::Keys,
            &[],
            Some(store_id.as_str()),
            None,
        )?;
        let (secrets_key, members_key) =
            hydrate_keys_from_projection_yaml(yaml.as_str(), &identity)?;
        assert_eq!(secrets_key, keys.secrets_key.as_str());
        assert_eq!(members_key, keys.members_key.as_str());
        Ok(())
    }

    #[test]
    fn hydrate_fails_on_empty_cache() -> VaultResult<()> {
        let identity = DeviceIdentity::generate()?;
        assert!(hydrate_keys_from_projection_yaml("", &identity).is_err());
        assert!(hydrate_keys_from_projection_yaml("   ", &identity).is_err());
        Ok(())
    }

    #[test]
    fn hydrate_fails_closed_for_sentinel_projection_yaml() -> VaultResult<()> {
        use crate::{
            DeviceMode, SentinelPolicy, VaultArchitecture, VaultType,
            create_sentinel_share_records, generate_store_id, generate_vault_keys,
            serialize_stored_yaml_with_unlock_name_architecture,
        };

        let keys = generate_vault_keys()?;
        let first = DeviceIdentity::generate()?;
        let second = DeviceIdentity::generate()?;
        let shares = create_sentinel_share_records(&keys, &[first.clone(), second.clone()], 2)?;
        let architecture = VaultArchitecture::sentinel_personal(
            DeviceMode::Standard,
            SentinelPolicy {
                threshold: 2,
                required_participants: 2,
                ready_participants: 2,
            },
        );
        assert_eq!(architecture.vault_type, VaultType::Sentinel);
        let store_id = generate_store_id()?;
        let yaml = serialize_stored_yaml_with_unlock_name_architecture(
            &shares,
            &VaultUnlock::Keys,
            &[],
            Some(store_id.as_str()),
            None,
            None,
            &architecture,
        )?;

        let err = hydrate_keys_from_projection_yaml(yaml.as_str(), &first).unwrap_err();
        assert!(
            matches!(
                err,
                crate::VaultError::MultiDevice(crate::MultiDeviceError::SentinelCeremonyRequired)
            ),
            "expected SentinelCeremonyRequired, got {err:?}"
        );
        Ok(())
    }
}

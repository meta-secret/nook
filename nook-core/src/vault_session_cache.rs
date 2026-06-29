//! Restore vault encryption keys from the projection-cache YAML.

use crate::error::{VaultError, VaultResult};
use crate::{DeviceIdentity, deserialize_stored, detect_stored_format, resolve_members_key, resolve_secrets_key};

/// Resolve `secrets_key` and `members_key` from a stored vault YAML projection cache.
pub fn hydrate_keys_from_projection_yaml(
    yaml: &str,
    identity: &DeviceIdentity,
) -> VaultResult<(String, String)> {
    if yaml.trim().is_empty() {
        return Err(VaultError::EmptyProjectionCache);
    }
    let format = detect_stored_format(yaml).map_err(VaultError::vault_format)?;
    let records = deserialize_stored(yaml, format).map_err(VaultError::vault_format)?;
    let secrets_key = resolve_secrets_key(&records, identity).map_err(VaultError::multi_device)?;
    let members_key = resolve_members_key(&records, identity).map_err(VaultError::multi_device)?;
    Ok((secrets_key, members_key))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        VaultResult, VaultUnlock, genesis_auth_record, genesis_members_records, generate_store_id,
        generate_vault_keys, serialize_stored_yaml_with_unlock,
    };

    #[test]
    fn hydrate_keys_from_genesis_projection_yaml() -> VaultResult<()> {
        let keys = generate_vault_keys().map_err(VaultError::multi_device)?;
        let identity = DeviceIdentity::generate().map_err(VaultError::multi_device)?;
        let mut records = vec![genesis_auth_record(&identity, &keys.secrets_key, &keys.members_key).map_err(VaultError::multi_device)?];
        records.extend(genesis_members_records(&identity, &keys.members_key, "2026-06-28T00:00:00Z").map_err(VaultError::multi_device)?);
        let yaml = serialize_stored_yaml_with_unlock(
            &records,
            &VaultUnlock::Keys,
            &[],
            Some(&generate_store_id().map_err(VaultError::multi_device)?),
            None,
        )
        .map_err(VaultError::vault_format)?;
        let (secrets_key, members_key) = hydrate_keys_from_projection_yaml(&yaml, &identity)?;
        assert_eq!(secrets_key, keys.secrets_key);
        assert_eq!(members_key, keys.members_key);
        Ok(())
    }

    #[test]
    fn hydrate_fails_on_empty_cache() -> VaultResult<()> {
        let identity = DeviceIdentity::generate().map_err(VaultError::multi_device)?;
        assert!(hydrate_keys_from_projection_yaml("", &identity).is_err());
        assert!(hydrate_keys_from_projection_yaml("   ", &identity).is_err());
        Ok(())
    }
}

//! Restore vault encryption keys from the projection-cache YAML.

use crate::{DeviceIdentity, deserialize_stored, detect_stored_format, resolve_members_key, resolve_secrets_key};

/// Resolve `secrets_key` and `members_key` from a stored vault YAML projection cache.
pub fn hydrate_keys_from_projection_yaml(
    yaml: &str,
    identity: &DeviceIdentity,
) -> Result<(String, String), String> {
    if yaml.trim().is_empty() {
        return Err("Projection cache is empty.".to_owned());
    }
    let format = detect_stored_format(yaml)?;
    let records = deserialize_stored(yaml, format)?;
    let secrets_key = resolve_secrets_key(&records, identity)?;
    let members_key = resolve_members_key(&records, identity)?;
    Ok((secrets_key, members_key))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        VaultUnlock, genesis_auth_record, genesis_members_records, generate_store_id,
        generate_vault_keys, serialize_stored_yaml_with_unlock,
    };

    #[test]
    fn hydrate_keys_from_genesis_projection_yaml() -> Result<(), String> {
        let keys = generate_vault_keys()?;
        let identity = DeviceIdentity::generate()?;
        let mut records = vec![genesis_auth_record(&identity, &keys.secrets_key, &keys.members_key)?];
        records.extend(genesis_members_records(&identity, &keys.members_key, "2026-06-28T00:00:00Z")?);
        let yaml = serialize_stored_yaml_with_unlock(
            &records,
            &VaultUnlock::Keys,
            &[],
            Some(&generate_store_id()?),
            None,
        )?;
        let (secrets_key, members_key) = hydrate_keys_from_projection_yaml(&yaml, &identity)?;
        assert_eq!(secrets_key, keys.secrets_key);
        assert_eq!(members_key, keys.members_key);
        Ok(())
    }

    #[test]
    fn hydrate_fails_on_empty_cache() -> Result<(), String> {
        let identity = DeviceIdentity::generate()?;
        assert!(hydrate_keys_from_projection_yaml("", &identity).is_err());
        assert!(hydrate_keys_from_projection_yaml("   ", &identity).is_err());
        Ok(())
    }
}

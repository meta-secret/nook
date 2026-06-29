//! Regression tests for vault crypto restore after session state is dropped (bf04223).

use nook_core::{
    DeviceIdentity, VaultCrypto, VaultError, VaultKeys, VaultResult, VaultUnlock,
    genesis_auth_record, genesis_members_records, generate_store_id, generate_vault_keys,
    hydrate_keys_from_projection_yaml, serialize_stored_yaml_with_unlock,
};

fn genesis_projection_yaml(keys: &VaultKeys, identity: &DeviceIdentity) -> VaultResult<String> {
    let mut records = vec![VaultError::from_multi_device(genesis_auth_record(
        identity,
        &keys.secrets_key,
        &keys.members_key,
    ))?];
    records.extend(VaultError::from_multi_device(genesis_members_records(
        identity,
        &keys.members_key,
        "2026-06-28T00:00:00Z",
    ))?);
    VaultError::from_vault_format(serialize_stored_yaml_with_unlock(
        &records,
        &VaultUnlock::Keys,
        &[],
        Some(&VaultError::from_multi_device(generate_store_id())?),
        None,
    ))
}

#[test]
fn session_survives_provider_switch_simulation() -> VaultResult<()> {
    let keys = VaultError::from_multi_device(generate_vault_keys())?;
    let identity = VaultError::from_multi_device(DeviceIdentity::generate())?;
    let yaml = genesis_projection_yaml(&keys, &identity)?;

    // Active session with crypto initialized.
    let crypto = VaultError::from_crypto(VaultCrypto::new(&keys.secrets_key))?;
    VaultError::from_crypto(crypto.encrypt_value("probe"))?;

    // Provider sync / prepare_storage drops in-memory crypto but keeps YAML cache.
    drop(crypto);
    let secrets_key = String::new();
    let members_key = String::new();
    assert!(secrets_key.is_empty() && members_key.is_empty());

    // Re-hydrate keys from projection cache (ensure_vault_crypto_from_cache path).
    let (restored_secrets, restored_members) =
        hydrate_keys_from_projection_yaml(&yaml, &identity)?;
    assert_eq!(restored_secrets, keys.secrets_key);
    assert_eq!(restored_members, keys.members_key);

    let restored_crypto = VaultError::from_crypto(VaultCrypto::new(&restored_secrets))?;
    VaultError::from_crypto(restored_crypto.encrypt_value("after-sync"))?;
    Ok(())
}

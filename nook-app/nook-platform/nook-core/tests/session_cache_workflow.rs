//! Regression tests for vault crypto restore after session state is dropped (bf04223).

use nook_auth2::{GenesisMembersRecordsRequest, VaultMember};
use nook_core::{SymmetricKey, VaultError, VaultStoreIdentityRef, VaultVersionWrite};

use nook_core::{
    DeviceIdentity, StoreId, VaultCrypto, VaultKeys, VaultProjectionCache, VaultRecordSet,
    VaultResult, VaultUnlock,
};

fn genesis_projection_yaml(keys: &VaultKeys, identity: &DeviceIdentity) -> VaultResult<String> {
    let mut records = vec![identity.auth_record(&keys.secrets_key, &keys.members_key)?];
    records.extend(VaultMember::genesis_members_records(
        GenesisMembersRecordsRequest {
            identity,
            members_key: &keys.members_key,
            enrolled_at: "2026-06-28T00:00:00Z",
        },
    )?);
    let store_id = StoreId::generate()?;
    Ok(VaultRecordSet::serialize_yaml_with_unlock(
        &records,
        &VaultUnlock::Keys,
        &[],
        VaultStoreIdentityRef::Assigned(store_id.as_str()),
        VaultVersionWrite::Initial,
    )
    .map_err(VaultError::from)?
    .into_inner())
}

#[test]
fn session_survives_provider_switch_simulation() -> VaultResult<()> {
    let keys = VaultKeys::generate()?;
    let identity = DeviceIdentity::generate()?;
    let yaml = genesis_projection_yaml(&keys, &identity)?;

    // Active session with crypto initialized.
    let crypto = VaultCrypto::new(&keys.secrets_key)?;
    crypto.encrypt_value("probe")?;

    // Provider sync / prepare_storage drops in-memory crypto but keeps YAML cache.
    drop(crypto);
    let secrets_key = String::new();
    let members_key = String::new();
    assert!(secrets_key.is_empty() && members_key.is_empty());

    // Re-hydrate keys from projection cache (ensure_vault_crypto_from_cache path).
    let (restored_secrets, restored_members) =
        VaultProjectionCache::new(&yaml).unlock(&identity)?;
    assert_eq!(restored_secrets.as_str(), keys.secrets_key.as_str());
    assert_eq!(restored_members.as_str(), keys.members_key.as_str());

    let restored_crypto = VaultCrypto::new(&SymmetricKey::parse(&restored_secrets)?)?;
    restored_crypto.encrypt_value("after-sync")?;
    Ok(())
}

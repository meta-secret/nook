//! Nexus vault key-share lifecycle integration tests.

use nook_core::{
    DeviceIdentity, DeviceMode, MultiDeviceError, SentinelPolicy, VaultArchitecture, VaultType,
    VaultUnlock, create_sentinel_share_records, generate_store_id, generate_vault_keys,
    load_sentinel_vault, load_sentinel_vault_from_opened, load_stored_vault,
    open_sentinel_share_for_identity, reconstruct_nexus_vault_keys_from_opened,
    serialize_stored_yaml_with_unlock_name_architecture,
};

#[test]
fn nexus_threshold_shares_block_single_device_and_unlock_with_quorum() {
    let keys = generate_vault_keys().unwrap();
    let first = DeviceIdentity::generate().unwrap();
    let second = DeviceIdentity::generate().unwrap();
    let third = DeviceIdentity::generate().unwrap();
    let shares =
        create_sentinel_share_records(&keys, &[first.clone(), second.clone(), third.clone()], 2)
            .unwrap();

    let architecture = VaultArchitecture::sentinel_personal(
        DeviceMode::Standard,
        SentinelPolicy {
            threshold: 2,
            required_participants: 3,
            ready_participants: 3,
        },
    );
    assert!(!architecture.can_create_secret_with_records(&[]));
    assert!(!architecture.can_create_secret_with_records(&shares[..1]));
    assert!(architecture.can_create_secret_with_records(&shares));

    let store_id = generate_store_id().unwrap();
    let yaml = serialize_stored_yaml_with_unlock_name_architecture(
        &shares,
        &VaultUnlock::Keys,
        &[],
        Some(store_id.as_str()),
        None,
        None,
        &architecture,
    )
    .unwrap();

    assert!(matches!(
        load_stored_vault(yaml.as_str(), &first),
        Err(nook_core::VaultError::MultiDevice(
            MultiDeviceError::SentinelCeremonyRequired
        ))
    ));
    assert!(load_sentinel_vault(yaml.as_str(), std::slice::from_ref(&first)).is_err());

    let loaded = load_sentinel_vault(yaml.as_str(), &[first.clone(), second.clone()]).unwrap();
    assert_eq!(loaded.secrets_key, keys.secrets_key);
    assert_eq!(loaded.members_key, keys.members_key);
    assert_eq!(loaded.meta.nexus_shares.len(), 3);
    assert_eq!(architecture.vault_type, VaultType::Sentinel);
    // Browser path: open shares locally, reconstruct without peer identities.
    let opened = [
        open_sentinel_share_for_identity(&shares, &first).unwrap(),
        open_sentinel_share_for_identity(&shares, &second).unwrap(),
    ];
    let from_opened = reconstruct_nexus_vault_keys_from_opened(&shares, &opened).unwrap();
    assert_eq!(from_opened, keys);

    let loaded_opened = load_sentinel_vault_from_opened(yaml.as_str(), &opened).unwrap();
    assert_eq!(loaded_opened.secrets_key, keys.secrets_key);
    assert_eq!(loaded_opened.members_key, keys.members_key);
}

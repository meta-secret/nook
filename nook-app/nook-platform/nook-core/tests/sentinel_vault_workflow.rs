//! Sentinel vault key-share lifecycle integration tests.

use nook_auth2::{CreateSentinelShareRecordsRequest, SentinelShareEnvelope};
use nook_core::{VaultError, VaultNameRef, VaultStoreIdentityRef, VaultVersionWrite};

use std::slice;

use nook_core::{
    DeviceIdentity, DeviceMode, MultiDeviceError, SentinelKeyReconstruction, SentinelPolicy,
    SentinelShareOpening, StoreId, VaultArchitecture, VaultContent, VaultKeys, VaultRecordSet,
    VaultType, VaultUnlock,
};

#[test]
fn sentinel_threshold_shares_block_single_device_and_unlock_with_quorum() -> anyhow::Result<()> {
    let keys = VaultKeys::generate()?;
    let first = DeviceIdentity::generate()?;
    let second = DeviceIdentity::generate()?;
    let third = DeviceIdentity::generate()?;
    let shares =
        SentinelShareEnvelope::create_sentinel_share_records(CreateSentinelShareRecordsRequest {
            keys: &keys,
            participants: &[first.clone(), second.clone(), third.clone()],
            threshold: 2.into(),
        })?;

    let architecture = VaultArchitecture::sentinel_personal(
        DeviceMode::Standard,
        SentinelPolicy {
            threshold: 2.into(),
            required_participants: 3.into(),
            ready_participants: 3.into(),
        },
    );
    assert!(!architecture.can_create_secret_with_records(&[]));
    assert!(!architecture.can_create_secret_with_records(&shares[..1]));
    assert!(architecture.can_create_secret_with_records(&shares));

    let store_id = StoreId::generate()?;
    let yaml = VaultRecordSet::serialize_yaml_with_unlock_name_architecture(
        &shares,
        &VaultUnlock::Keys,
        &[],
        VaultStoreIdentityRef::Assigned(store_id.as_str()),
        VaultNameRef::Unnamed,
        VaultVersionWrite::Initial,
        &architecture,
    )?;

    assert!(matches!(
        VaultContent::new(yaml.as_str()).load(&first),
        Err(VaultError::MultiDevice(
            MultiDeviceError::SentinelCeremonyRequired
        ))
    ));
    assert!(
        VaultContent::new(yaml.as_str())
            .load_sentinel(slice::from_ref(&first))
            .is_err()
    );

    let loaded =
        VaultContent::new(yaml.as_str()).load_sentinel(&[first.clone(), second.clone()])?;
    assert_eq!(loaded.secrets_key, keys.secrets_key);
    assert_eq!(loaded.members_key, keys.members_key);
    assert_eq!(loaded.meta.sentinel_shares.len(), 3);
    assert_eq!(architecture.vault_type, VaultType::Sentinel);
    // Browser path: open shares locally, reconstruct without peer identities.
    let opened = [
        SentinelShareOpening::new(&shares, &first).open()?,
        SentinelShareOpening::new(&shares, &second).open()?,
    ];
    let from_opened = SentinelKeyReconstruction::from_opened(&shares, &opened).reconstruct()?;
    assert_eq!(from_opened, keys);

    let loaded_opened = VaultContent::new(yaml.as_str()).load_sentinel_from_opened(&opened)?;
    assert_eq!(loaded_opened.secrets_key, keys.secrets_key);
    assert_eq!(loaded_opened.members_key, keys.members_key);
    Ok(())
}

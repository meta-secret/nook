use crate::vault_signing::SigningIdentity;
use crate::{
    AuthKeyId, DeviceIdentity, DeviceSigningPublicKey, EventId, SecretId, StoreId,
    StoredRecordPayload, StoredVaultYaml, VaultKeys, VaultResult, VaultUnlock, generate_store_id,
    genesis_auth_record, genesis_members_records, serialize_stored_yaml_with_unlock,
};
use ed25519_dalek::SigningKey;
use rand_core::OsRng;

pub(crate) fn signing_key() -> SigningKey {
    SigningKey::generate(&mut OsRng)
}

pub(crate) fn actor(signing_key: &SigningKey) -> AuthKeyId {
    SigningIdentity::actor_id_for_verifying_key(&signing_key.verifying_key()).unwrap()
}

pub(crate) fn public_key(signing_key: &SigningKey) -> DeviceSigningPublicKey {
    DeviceSigningPublicKey::from_trusted(hex::encode(signing_key.verifying_key().as_bytes()))
}

pub(crate) fn epoch() -> EventId {
    EventId::parse("sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo").unwrap()
}

pub(crate) fn store() -> StoreId {
    StoreId::parse("store_testtoken11").unwrap()
}

pub(crate) fn sample_vault_yaml(version: u64, store_id: &str, armor_line: &str) -> String {
    serialize_stored_yaml_with_unlock(
        &[crate::StoredSecretRecord {
            key: SecretId::from_vault_record("secret_SMypl8K0w9Y"),
            secret_type: None,
            value: StoredRecordPayload::from_trusted(format!(
                "-----BEGIN AGE ENCRYPTED FILE-----\n{armor_line}\n-----END AGE ENCRYPTED FILE-----"
            )),
        }],
        &VaultUnlock::Keys,
        &[],
        Some(store_id),
        Some(version),
    )
    .unwrap()
    .into_inner()
}

pub(crate) fn simple_genesis_projection()
-> VaultResult<(VaultKeys, DeviceIdentity, StoredVaultYaml)> {
    let keys = crate::generate_vault_keys()?;
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
    Ok((keys, identity, yaml))
}

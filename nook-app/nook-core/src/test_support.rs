use crate::{
    DeviceIdentity, SecretId, StoredRecordPayload, StoredVaultYaml, VaultKeys, VaultResult,
    VaultUnlock, generate_store_id, genesis_auth_record, genesis_members_records,
    serialize_stored_yaml_with_unlock,
};

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

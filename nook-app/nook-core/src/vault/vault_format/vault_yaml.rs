use super::{
    AgeArmoredCiphertext, AuthEnvelopes, AuthKeyId, PasswordUnlockEntry, SecretId,
    StoredRecordPayload, StoredSecretRecord, VaultArchitecture, VaultFormatError,
    VaultFormatResult, VaultUnlock, is_auth_stored_record, is_join_stored_record,
    is_members_stored_record, is_sentinel_share_stored_record, vault_unlock_is_keys,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(super) struct AuthYamlRecord {
    /// SHA256(public key) — public key is never stored in the vault file.
    pub(super) pk_id: String,
    pub(super) secrets_key: String,
    pub(super) members_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(super) struct MembersYamlRecord {
    pub(super) pk_id: String,
    pub(super) ciphertext: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub(super) struct StoredVaultYaml {
    /// Explicit projection-cache schema.
    pub(super) schema_version: u32,
    /// Monotonic revision counter — incremented on every save.
    #[serde(default, skip_serializing_if = "vault_version_is_zero")]
    pub(super) vault_version: u64,
    /// Logical secret-store identity — same id on every provider replica of this vault.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) store_id: Option<String>,
    /// Human-readable vault label.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) name: Option<String>,
    /// Active unlock mechanism. Omitted on write when `Keys` (the default).
    #[serde(default, skip_serializing_if = "vault_unlock_is_keys")]
    pub(super) unlock: VaultUnlock,
    /// Grouped vault architecture modes.
    #[serde(default, skip_serializing_if = "vault_architecture_is_default")]
    pub(super) architecture: VaultArchitecture,
    #[serde(default)]
    pub(super) secrets: Vec<StoredSecretRecord>,
    /// Populated only when `unlock = Keys`. Strict mutex: writing this
    /// section in password mode is rejected by `serialize_stored_yaml_with_unlock`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(super) auth: Vec<AuthYamlRecord>,
    /// Same mutex as `auth:` — joins/approve flow exists only in keys mode.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(super) joins: Vec<StoredSecretRecord>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(super) members: Vec<MembersYamlRecord>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(super) sentinel_shares: Vec<StoredSecretRecord>,
    /// Optional backup passwords — coexist with `auth:` device-key unlock.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(super) password_entries: Vec<PasswordUnlockEntry>,
}

pub(super) fn stored_record_to_auth(
    record: &StoredSecretRecord,
) -> VaultFormatResult<AuthYamlRecord> {
    let envelopes = crate::parse_auth_envelopes(record.value.as_str())
        .map_err(|error| VaultFormatError::InvalidAuthRecord(error.to_string()))?;
    Ok(AuthYamlRecord {
        pk_id: crate::normalize_auth_key_id(record.key.as_str())
            .map_or_else(|_| record.key.to_string(), |id| id.to_string()),
        secrets_key: envelopes.secrets_key.as_str().to_owned(),
        members_key: envelopes.members_key.as_str().to_owned(),
    })
}

pub(super) fn auth_to_stored_record(
    record: AuthYamlRecord,
) -> VaultFormatResult<StoredSecretRecord> {
    let pk_id = crate::normalize_auth_key_id(&record.pk_id)
        .map(|id| id.to_string())
        .unwrap_or(record.pk_id);
    Ok(StoredSecretRecord {
        key: SecretId::from_vault_record(&pk_id),
        secret_type: None,
        value: StoredRecordPayload::from_trusted(
            serde_json::to_string(&AuthEnvelopes {
                secrets_key: AgeArmoredCiphertext::from_trusted_armored(record.secrets_key),
                members_key: AgeArmoredCiphertext::from_trusted_armored(record.members_key),
            })
            .map_err(VaultFormatError::JsonSerialize)?,
        ),
    })
}

pub(super) fn members_to_stored_record(
    record: MembersYamlRecord,
) -> VaultFormatResult<StoredSecretRecord> {
    let pk_id = crate::normalize_auth_key_id(&record.pk_id)
        .map(|id| id.to_string())
        .unwrap_or(record.pk_id);
    Ok(StoredSecretRecord {
        key: SecretId::from_vault_record(&crate::member_stored_key(&AuthKeyId::parse(&pk_id)?)),
        secret_type: None,
        value: StoredRecordPayload::from_trusted(record.ciphertext),
    })
}

pub(super) fn partition_yaml_records(
    records: &[StoredSecretRecord],
) -> VaultFormatResult<StoredVaultYaml> {
    let mut vault = StoredVaultYaml::default();
    for record in records {
        // Device-protection wrappers are browser-local state. Keep this final
        // serialization boundary defensive even if a caller accidentally
        // mixes an IndexedDB wrapper into the vault record collection.
        if crate::parse_wrapped_device_identity(record.value.as_str()).is_ok() {
            continue;
        }
        if is_join_stored_record(record) {
            vault.joins.push(record.clone());
        } else if is_members_stored_record(record) {
            let key_str = record.key.as_str();
            let pk_id = crate::normalize_auth_key_id(
                key_str
                    .strip_prefix(crate::MEMBER_RECORD_PREFIX)
                    .unwrap_or(key_str),
            )
            .map_or_else(
                |_| {
                    key_str
                        .strip_prefix(crate::MEMBER_RECORD_PREFIX)
                        .unwrap_or(key_str)
                        .to_owned()
                },
                |id| id.to_string(),
            );
            vault.members.push(MembersYamlRecord {
                pk_id,
                ciphertext: record.value.as_str().to_owned(),
            });
        } else if is_auth_stored_record(record) {
            vault.auth.push(stored_record_to_auth(record)?);
        } else if is_sentinel_share_stored_record(record) {
            vault.sentinel_shares.push(record.clone());
        } else {
            vault.secrets.push(record.clone());
        }
    }
    for secret in &mut vault.secrets {
        if let Ok(id) = crate::normalize_secret_id_for_write(secret.key.as_str()) {
            secret.key = id;
        }
    }
    Ok(vault)
}

#[allow(clippy::trivially_copy_pass_by_ref)]
pub(super) fn vault_version_is_zero(version: &u64) -> bool {
    *version == 0
}

pub(super) fn vault_architecture_is_default(architecture: &VaultArchitecture) -> bool {
    architecture == &VaultArchitecture::default()
}

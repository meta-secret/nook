use super::vault_unlock_is_keys;
use crate::errors::{VaultFormatError, VaultFormatResult};
use crate::{
    AgeArmoredCiphertext, AuthEnvelopes, AuthKeyId, PasswordUnlockEntry, SecretId,
    StoredRecordPayload, StoredSecretRecord, VaultArchitecture, VaultUnlock, is_auth_stored_record,
    is_join_stored_record, is_members_stored_record, is_sentinel_share_stored_record,
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
        if is_local_device_wrapper(record.value.as_str()) {
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

fn is_local_device_wrapper(value: &str) -> bool {
    let Ok(serde_json::Value::Object(fields)) = serde_json::from_str(value) else {
        return false;
    };
    // Match the deserializer's required structural fields, independent of version or
    // protection validity, so unknown/future local wrappers cannot become vault secrets.
    let has_fields = |required: &[&str]| required.iter().all(|field| fields.contains_key(*field));
    fields
        .get("protection")
        .is_some_and(serde_json::Value::is_string)
        && has_fields(&["version"])
        && (has_fields(&["credentialId", "userHandle", "prfInput", "kdf"])
            || has_fields(&["kdf", "iterations", "salt", "cipher", "nonce", "ciphertext"]))
}

#[allow(clippy::trivially_copy_pass_by_ref)]
pub(super) fn vault_version_is_zero(version: &u64) -> bool {
    *version == 0
}

pub(super) fn vault_architecture_is_default(architecture: &VaultArchitecture) -> bool {
    architecture == &VaultArchitecture::default()
}

#[cfg(test)]
mod tests {
    use crate::{DeviceIdentity, DeviceMode, DeviceSigningPublicKey, SecretType};

    use std::slice;

    use super::super::{
        VaultNameRef, VaultStoreIdentityRef, VaultVersionWrite, deserialize_stored_yaml,
        serialize_stored_yaml, serialize_stored_yaml_with_unlock_name_architecture,
    };
    use super::*;

    fn sid(label: &str) -> SecretId {
        SecretId::from_vault_record(label)
    }

    #[test]
    fn auth_and_join_records_use_dedicated_yaml_sections() -> anyhow::Result<()> {
        use crate::multi_device::{DeviceIdentity, JoinRequest};

        let device_id = "abc123def4567890";
        let auth_id = format!("key_{}", "a".repeat(64));
        let joiner = DeviceIdentity::generate()?;
        let join_request = JoinRequest {
            device_id: joiner.device_id().clone(),
            public_key: joiner.public_key(),
            signing_public_key: DeviceSigningPublicKey::default(),
            requested_at: "2026-01-01T00:00:00Z".to_owned(),
        };
        let join_id = join_request.device_id.as_str();
        let records = vec![
            StoredSecretRecord {
                key: sid("github.com"),
                secret_type: Some(SecretType::Login),
                value: StoredRecordPayload::from_trusted("encrypted-user-secret".to_owned()),
            },
            auth_to_stored_record(AuthYamlRecord {
                pk_id: auth_id,
                secrets_key:
                    "-----BEGIN AGE ENCRYPTED FILE-----\nsecrets\n-----END AGE ENCRYPTED FILE-----"
                        .to_owned(),
                members_key:
                    "-----BEGIN AGE ENCRYPTED FILE-----\nmembers\n-----END AGE ENCRYPTED FILE-----"
                        .to_owned(),
            })?,
            StoredSecretRecord {
                key: sid(join_id),
                secret_type: None,
                value: StoredRecordPayload::from_trusted(serde_json::to_string(&join_request)?),
            },
        ];

        let stored = serialize_stored_yaml(&records)?;
        assert!(stored.as_str().contains("secrets:"));
        assert!(stored.as_str().contains("auth:"));
        assert!(stored.as_str().contains("joins:"));
        assert!(stored.as_str().contains("pk_id: "));
        assert!(stored.as_str().contains("secrets_key: "));
        assert!(stored.as_str().contains("members_key: "));
        assert!(!stored.as_str().contains("dec: "));
        assert!(!stored.as_str().contains("auth:\n- key:"));
        assert!(!stored.as_str().contains(device_id));

        assert_eq!(deserialize_stored_yaml(stored.as_str())?.len(), 3);
        Ok(())
    }

    #[test]
    fn member_records_use_pk_id_and_ciphertext_yaml_fields() -> anyhow::Result<()> {
        let auth_id = format!("key_{}", "c".repeat(64));
        let records = vec![StoredSecretRecord {
            key: sid(&format!("member:{auth_id}")),
            secret_type: None,
            value: StoredRecordPayload::from_trusted(
                "-----BEGIN AGE ENCRYPTED FILE-----\nline\n-----END AGE ENCRYPTED FILE-----"
                    .to_owned(),
            ),
        }];

        let stored = serialize_stored_yaml(&records)?;
        assert!(stored.as_str().contains("members:"));
        assert!(stored.as_str().contains("pk_id:"));
        assert!(stored.as_str().contains("ciphertext:"));
        assert!(stored.as_str().contains(&auth_id));
        assert!(!stored.as_str().contains("member:"));

        let parsed = deserialize_stored_yaml(stored.as_str())?;
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].key.as_str(), format!("member:{auth_id}"));
        Ok(())
    }

    #[test]
    fn local_device_wrapper_is_excluded_from_yaml_partition() -> anyhow::Result<()> {
        let credential_id = vec![7u8; 48];
        let user_handle = vec![8u8; 32];
        let prf_input = crate::deterministic_passkey_prf_input();
        let material = crate::finish_passkey_wrapped_device_identity(
            &credential_id,
            &user_handle,
            &prf_input,
            &[10u8; 32],
        )?;
        let local_record = crate::serialize_wrapped_device_identity(material.record())?;
        let unsupported = local_record.replace(r#""version":4"#, r#""version":99"#);
        let unknown = local_record.replace(
            r#""protection":"passkey-wrapped-local""#,
            r#""protection":"future-local-wrapper""#,
        );
        assert_ne!(unsupported, local_record);
        assert_ne!(unknown, local_record);
        let records = [local_record, unsupported, unknown]
            .into_iter()
            .enumerate()
            .map(|(index, value)| StoredSecretRecord {
                key: sid(&format!("device_identity_wrapped_{index}")),
                secret_type: None,
                value: StoredRecordPayload::from_trusted(value),
            })
            .collect::<Vec<_>>();
        let architecture = VaultArchitecture {
            device_mode: DeviceMode::AntiHacker,
            ..VaultArchitecture::default()
        };

        let yaml = serialize_stored_yaml_with_unlock_name_architecture(
            &records,
            &VaultUnlock::Keys,
            &[],
            VaultStoreIdentityRef::Assigned("store_SMypl8K0w9Y"),
            VaultNameRef::Named("Anti-hacker vault"),
            VaultVersionWrite::Version(1),
            &architecture,
        )?;
        let stored = yaml.as_str();
        assert!(stored.contains("device_mode: anti-hacker"));
        assert!(stored.contains("secrets: []"));
        assert!(!stored.contains("passkey-wrapped-local"));
        assert!(!stored.contains("future-local-wrapper"));
        assert!(!stored.contains("version: 99"));
        assert!(!stored.contains("credentialId"));
        assert!(!stored.contains("ciphertext"));
        assert!(!stored.contains("AGE-SECRET-KEY-"));
        Ok(())
    }

    #[test]
    fn sentinel_records_use_dedicated_yaml_section() -> anyhow::Result<()> {
        let keys = crate::generate_vault_keys()?;
        let first = DeviceIdentity::generate()?;
        let second = DeviceIdentity::generate()?;
        let shares = crate::create_sentinel_share_records(&keys, &[first, second], 2.into())?;
        let architecture = VaultArchitecture::sentinel_personal(
            DeviceMode::Standard,
            crate::SentinelPolicy {
                threshold: 2,
                required_participants: 2,
                ready_participants: 2,
            },
        );

        let yaml = serialize_stored_yaml_with_unlock_name_architecture(
            &shares,
            &VaultUnlock::Keys,
            &[],
            VaultStoreIdentityRef::Assigned("store_SMypl8K0w9Y"),
            VaultNameRef::Named("Sentinel vault"),
            VaultVersionWrite::Version(1),
            &architecture,
        )?;
        assert!(yaml.as_str().contains("sentinel_shares:"));
        assert!(!yaml.as_str().contains("auth:"));
        assert!(yaml.as_str().contains("secrets: []"));

        let parsed = deserialize_stored_yaml(yaml.as_str())?;
        assert_eq!(parsed, shares);
        assert!(parsed.iter().all(crate::is_sentinel_share_stored_record));
        Ok(())
    }

    #[test]
    fn auth_envelopes_roundtrip_through_internal_json() -> anyhow::Result<()> {
        let auth_id = format!("key_{}", "b".repeat(64));
        let record = auth_to_stored_record(AuthYamlRecord {
            pk_id: auth_id.clone(),
            secrets_key: "-----BEGIN AGE ENCRYPTED FILE-----\ns\n-----END AGE ENCRYPTED FILE-----"
                .to_owned(),
            members_key: "-----BEGIN AGE ENCRYPTED FILE-----\nm\n-----END AGE ENCRYPTED FILE-----"
                .to_owned(),
        })?;

        let yaml = serialize_stored_yaml(slice::from_ref(&record))?;
        assert!(yaml.as_str().contains("secrets_key:"));
        assert!(yaml.as_str().contains("members_key:"));
        assert!(!yaml.as_str().contains("dek:"));
        assert!(!yaml.as_str().contains("mek:"));

        let parsed = deserialize_stored_yaml(yaml.as_str())?;
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].key.as_str(), auth_id);

        let envelopes = crate::parse_auth_envelopes(parsed[0].value.as_str())?;
        assert!(
            envelopes
                .secrets_key
                .as_str()
                .contains("BEGIN AGE ENCRYPTED FILE")
        );
        assert!(
            envelopes
                .members_key
                .as_str()
                .contains("BEGIN AGE ENCRYPTED FILE")
        );
        Ok(())
    }
}

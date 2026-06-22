use crate::{
    AuthEnvelopes, StoredSecretRecord, is_auth_stored_record, is_join_stored_record,
    is_members_stored_record,
};
use serde::{Deserialize, Serialize};

/// On-disk vault serialization format.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VaultFormat {
    Jsonl,
    Yaml,
}

impl VaultFormat {
    #[must_use]
    pub fn from_path(path: &str) -> Self {
        if std::path::Path::new(path)
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("jsonl"))
        {
            Self::Jsonl
        } else {
            Self::Yaml
        }
    }
}

/// Detect stored vault format from file contents.
pub fn detect_stored_format(stored: &str) -> Result<VaultFormat, String> {
    let trimmed = stored.trim();
    if trimmed.is_empty() {
        return Ok(VaultFormat::Yaml);
    }

    let first_line = trimmed
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("");

    if first_line.starts_with('{') {
        return Ok(VaultFormat::Jsonl);
    }

    if first_line.starts_with('-')
        || first_line.starts_with('[')
        || first_line.starts_with("%YAML")
        || first_line.starts_with("secrets:")
        || first_line.starts_with("auth:")
        || first_line.starts_with("joins:")
        || first_line.starts_with("members:")
    {
        return Ok(VaultFormat::Yaml);
    }

    Err(format!(
        "Unrecognized vault format (first non-empty line: {:?})",
        first_line
    ))
}

pub fn serialize_stored(
    records: &[StoredSecretRecord],
    format: VaultFormat,
) -> Result<String, String> {
    match format {
        VaultFormat::Jsonl => serialize_stored_jsonl(records),
        VaultFormat::Yaml => serialize_stored_yaml(records),
    }
}

pub fn deserialize_stored(
    stored: &str,
    format: VaultFormat,
) -> Result<Vec<StoredSecretRecord>, String> {
    match format {
        VaultFormat::Jsonl => deserialize_stored_jsonl(stored),
        VaultFormat::Yaml => deserialize_stored_yaml(stored),
    }
}

pub fn serialize_stored_jsonl(records: &[StoredSecretRecord]) -> Result<String, String> {
    let mut lines = Vec::with_capacity(records.len());
    for record in records {
        let line = serde_json::to_string(record)
            .map_err(|e| format!("Failed to serialize stored JSONL record: {}", e))?;
        lines.push(line);
    }
    Ok(lines.join("\n"))
}

pub fn deserialize_stored_jsonl(stored: &str) -> Result<Vec<StoredSecretRecord>, String> {
    let mut records = Vec::new();
    for line in stored.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let record: StoredSecretRecord = serde_json::from_str(line)
            .map_err(|e| format!("Failed to parse stored JSONL line: {}", e))?;
        records.push(record);
    }
    Ok(records)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct AuthYamlRecord {
    /// SHA256(public key) — public key is never stored in the vault file.
    pk_id: String,
    secrets_key: String,
    members_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct MembersYamlRecord {
    pk_id: String,
    ciphertext: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
struct StoredVaultYaml {
    #[serde(default)]
    secrets: Vec<StoredSecretRecord>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    auth: Vec<AuthYamlRecord>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    joins: Vec<StoredSecretRecord>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    members: Vec<MembersYamlRecord>,
}

fn stored_record_to_auth(record: &StoredSecretRecord) -> AuthYamlRecord {
    let envelopes = crate::parse_auth_envelopes(&record.value)
        .expect("auth record must parse before YAML serialization");
    AuthYamlRecord {
        pk_id: record.key.clone(),
        secrets_key: envelopes.secrets_key,
        members_key: envelopes.members_key,
    }
}

fn auth_to_stored_record(record: AuthYamlRecord) -> StoredSecretRecord {
    StoredSecretRecord {
        key: record.pk_id,
        secret_type: None,
        value: serde_json::to_string(&AuthEnvelopes {
            secrets_key: record.secrets_key,
            members_key: record.members_key,
        })
        .expect("auth envelopes must serialize"),
    }
}

fn members_to_stored_record(record: MembersYamlRecord) -> StoredSecretRecord {
    StoredSecretRecord {
        key: crate::member_stored_key(&record.pk_id),
        secret_type: None,
        value: record.ciphertext,
    }
}

fn partition_yaml_records(records: &[StoredSecretRecord]) -> StoredVaultYaml {
    let mut vault = StoredVaultYaml::default();
    for record in records {
        if is_join_stored_record(record) {
            vault.joins.push(record.clone());
        } else if is_members_stored_record(record) {
            vault.members.push(MembersYamlRecord {
                pk_id: record
                    .key
                    .strip_prefix(crate::MEMBER_RECORD_PREFIX)
                    .unwrap_or(&record.key)
                    .to_owned(),
                ciphertext: record.value.clone(),
            });
        } else if is_auth_stored_record(record) {
            vault.auth.push(stored_record_to_auth(record));
        } else {
            vault.secrets.push(record.clone());
        }
    }
    vault
}

pub fn serialize_stored_yaml(records: &[StoredSecretRecord]) -> Result<String, String> {
    let vault = partition_yaml_records(records);
    serde_yaml::to_string(&vault).map_err(|e| format!("Failed to serialize stored YAML: {}", e))
}

pub fn deserialize_stored_yaml(stored: &str) -> Result<Vec<StoredSecretRecord>, String> {
    let trimmed = stored.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }

    if let Ok(vault) = serde_yaml::from_str::<StoredVaultYaml>(trimmed) {
        let mut records = vault.secrets;
        records.extend(vault.auth.into_iter().map(auth_to_stored_record));
        records.extend(vault.joins);
        records.extend(vault.members.into_iter().map(members_to_stored_record));
        return Ok(records);
    }

    Err("Failed to parse stored YAML: expected secrets/auth/joins/members sections".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_records() -> Vec<StoredSecretRecord> {
        vec![
            StoredSecretRecord {
                key: "github.com".to_owned(),
                secret_type: Some(crate::SecretType::Login),
                value: "-----BEGIN AGE ENCRYPTED FILE-----\nline1\nline2\n-----END AGE ENCRYPTED FILE-----"
                    .to_owned(),
            },
            StoredSecretRecord {
                key: "work-vpn".to_owned(),
                secret_type: Some(crate::SecretType::ApiKey),
                value: "-----BEGIN AGE ENCRYPTED FILE-----\nsecret\n-----END AGE ENCRYPTED FILE-----"
                    .to_owned(),
            },
        ]
    }

    #[test]
    fn jsonl_roundtrip_stored_records() {
        let records = sample_records();
        let stored = serialize_stored_jsonl(&records).unwrap();
        assert!(stored.contains("\"id\":\"github.com\""));
        assert!(stored.lines().count() == 2);

        let parsed = deserialize_stored_jsonl(&stored).unwrap();
        assert_eq!(parsed, records);
    }

    #[test]
    fn yaml_roundtrip_stored_records() {
        let records = sample_records();
        let stored = serialize_stored_yaml(&records).unwrap();
        assert!(stored.contains("github.com"));
        assert!(stored.contains('|'));
        assert!(!stored.contains("\\n"));

        let parsed = deserialize_stored_yaml(&stored).unwrap();
        assert_eq!(parsed, records);
    }

    #[test]
    fn detect_jsonl_and_yaml() {
        assert_eq!(
            detect_stored_format(r#"{"key":"a","value":"b"}"#).unwrap(),
            VaultFormat::Jsonl
        );
        assert_eq!(
            detect_stored_format("secrets:\n  - key: a\n    value: b\n").unwrap(),
            VaultFormat::Yaml
        );
        assert_eq!(
            detect_stored_format("- key: a\n  value: b\n").unwrap(),
            VaultFormat::Yaml
        );
    }

    #[test]
    fn format_from_path() {
        assert_eq!(VaultFormat::from_path("nook-vault.yaml"), VaultFormat::Yaml);
        assert_eq!(
            VaultFormat::from_path("nook-vault.jsonl"),
            VaultFormat::Jsonl
        );
        assert_eq!(VaultFormat::from_path("nook-vault.yml"), VaultFormat::Yaml);
        assert_eq!(
            VaultFormat::from_path("/data/user/nook-vault.yaml"),
            VaultFormat::Yaml
        );
    }

    #[test]
    fn detect_empty_defaults_to_yaml() {
        assert_eq!(detect_stored_format("").unwrap(), VaultFormat::Yaml);
        assert_eq!(
            detect_stored_format("   \n  \n").unwrap(),
            VaultFormat::Yaml
        );
    }

    #[test]
    fn detect_leading_whitespace_before_jsonl() {
        assert_eq!(
            detect_stored_format("\n\n  {\"key\":\"a\",\"value\":\"b\"}\n").unwrap(),
            VaultFormat::Jsonl
        );
    }

    #[test]
    fn detect_yaml_document_header() {
        assert_eq!(
            detect_stored_format("%YAML 1.2\n---\nsecrets: []\n").unwrap(),
            VaultFormat::Yaml
        );
    }

    #[test]
    fn detect_unrecognized_format_fails() {
        assert!(detect_stored_format("not a vault file").is_err());
        assert!(detect_stored_format("key: value").is_err());
    }

    #[test]
    fn empty_stored_records_roundtrip_both_formats() {
        for format in [VaultFormat::Jsonl, VaultFormat::Yaml] {
            let stored = serialize_stored(&[], format).unwrap();
            let parsed = deserialize_stored(&stored, format).unwrap();
            assert!(parsed.is_empty());
        }
        assert!(deserialize_stored_yaml("").unwrap().is_empty());
        assert!(deserialize_stored_yaml("  \n").unwrap().is_empty());
        assert!(deserialize_stored_jsonl("").unwrap().is_empty());
        assert!(deserialize_stored_jsonl("\n\n").unwrap().is_empty());
    }

    #[test]
    fn jsonl_skips_blank_lines() {
        let records = sample_records();
        let mut stored = serialize_stored_jsonl(&records).unwrap();
        stored.insert(0, '\n');
        stored.push('\n');
        stored.push('\n');

        let parsed = deserialize_stored_jsonl(&stored).unwrap();
        assert_eq!(parsed, records);
    }

    #[test]
    fn jsonl_invalid_line_fails() {
        let err = deserialize_stored_jsonl(
            r#"{"key":"ok","value":"x"}
not-json
"#,
        )
        .unwrap_err();
        assert!(err.contains("Failed to parse stored JSONL line"));
    }

    #[test]
    fn yaml_requires_secrets_auth_joins_sections() {
        let records = sample_records();
        let wrapped = serialize_stored_yaml(&records).unwrap();
        assert_eq!(deserialize_stored_yaml(&wrapped).unwrap(), records);

        let root = serde_yaml::to_string(&records).unwrap();
        assert!(deserialize_stored_yaml(&root).is_err());
    }

    #[test]
    fn deserialize_stored_rejects_wrong_format() {
        let records = sample_records();
        let jsonl = serialize_stored_jsonl(&records).unwrap();
        let yaml = serialize_stored_yaml(&records).unwrap();

        assert!(deserialize_stored(&jsonl, VaultFormat::Yaml).is_err());
        assert!(deserialize_stored(&yaml, VaultFormat::Jsonl).is_err());
    }

    #[test]
    fn serialize_stored_matches_format_specific_helpers() {
        let records = sample_records();
        assert_eq!(
            serialize_stored(&records, VaultFormat::Jsonl).unwrap(),
            serialize_stored_jsonl(&records).unwrap()
        );
        assert_eq!(
            serialize_stored(&records, VaultFormat::Yaml).unwrap(),
            serialize_stored_yaml(&records).unwrap()
        );
    }

    #[test]
    fn yaml_preserves_multiline_armored_value_exactly() {
        let records = sample_records();
        let stored = serialize_stored_yaml(&records).unwrap();
        let parsed = deserialize_stored_yaml(&stored).unwrap();

        assert_eq!(parsed[0].value, records[0].value);
        assert!(parsed[0].value.contains('\n'));
    }

    #[test]
    fn yaml_accepts_root_sequence_format_detection_only() {
        assert_eq!(
            detect_stored_format("- key: a\n  value: b\n").unwrap(),
            VaultFormat::Yaml
        );
        assert!(deserialize_stored_yaml("- key: a\n  value: b\n").is_err());
    }

    #[test]
    fn serialize_empty_yaml_has_secrets_key() {
        let stored = serialize_stored_yaml(&[]).unwrap();
        assert!(stored.contains("secrets:"));
        assert!(!stored.contains("auth:"));
        assert!(deserialize_stored_yaml(&stored).unwrap().is_empty());
    }

    #[test]
    fn yaml_auth_section_uses_pk_id_secrets_key_and_members_key() {
        let device_id = "abc123def4567890";
        let auth_id = "a".repeat(64);
        let join_id = "fedcba9876543210";
        let records = vec![
            StoredSecretRecord {
                key: "github.com".to_owned(),
                secret_type: Some(crate::SecretType::Login),
                value: "encrypted-user-secret".to_owned(),
            },
            auth_to_stored_record(AuthYamlRecord {
                pk_id: auth_id.clone(),
                secrets_key:
                    "-----BEGIN AGE ENCRYPTED FILE-----\nsecrets\n-----END AGE ENCRYPTED FILE-----"
                        .to_owned(),
                members_key:
                    "-----BEGIN AGE ENCRYPTED FILE-----\nmembers\n-----END AGE ENCRYPTED FILE-----"
                        .to_owned(),
            }),
            StoredSecretRecord {
                key: join_id.to_owned(),
                secret_type: None,
                value: format!(
                    r#"{{"device_id":"{join_id}","public_key":"age1test","requested_at":"2026-01-01T00:00:00Z"}}"#
                ),
            },
        ];

        let stored = serialize_stored_yaml(&records).unwrap();
        assert!(stored.contains("secrets:"));
        assert!(stored.contains("auth:"));
        assert!(stored.contains("joins:"));
        assert!(stored.contains("pk_id: "));
        assert!(stored.contains("secrets_key: "));
        assert!(stored.contains("members_key: "));
        assert!(!stored.contains("dec: "));
        assert!(!stored.contains("auth:\n- key:"));
        assert!(!stored.contains(device_id));

        let parsed = deserialize_stored_yaml(&stored).unwrap();
        assert_eq!(parsed.len(), 3);
    }

    #[test]
    fn yaml_members_section_uses_pk_id_and_ciphertext() {
        let auth_id = "c".repeat(64);
        let records = vec![StoredSecretRecord {
            key: format!("member:{auth_id}"),
            secret_type: None,
            value: "-----BEGIN AGE ENCRYPTED FILE-----\nline\n-----END AGE ENCRYPTED FILE-----"
                .to_owned(),
        }];

        let stored = serialize_stored_yaml(&records).unwrap();
        assert!(stored.contains("members:"));
        assert!(stored.contains("pk_id:"));
        assert!(stored.contains("ciphertext:"));
        assert!(stored.contains(&auth_id));
        assert!(!stored.contains("member:"));

        let parsed = deserialize_stored_yaml(&stored).unwrap();
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].key, format!("member:{auth_id}"));
    }

    #[test]
    fn yaml_auth_envelopes_roundtrip_through_internal_json() {
        let auth_id = "b".repeat(64);
        let record = auth_to_stored_record(AuthYamlRecord {
            pk_id: auth_id.clone(),
            secrets_key: "-----BEGIN AGE ENCRYPTED FILE-----\ns\n-----END AGE ENCRYPTED FILE-----"
                .to_owned(),
            members_key: "-----BEGIN AGE ENCRYPTED FILE-----\nm\n-----END AGE ENCRYPTED FILE-----"
                .to_owned(),
        });

        let yaml = serialize_stored_yaml(std::slice::from_ref(&record)).unwrap();
        assert!(yaml.contains("secrets_key:"));
        assert!(yaml.contains("members_key:"));
        assert!(!yaml.contains("dek:"));
        assert!(!yaml.contains("mek:"));

        let parsed = deserialize_stored_yaml(&yaml).unwrap();
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].key, auth_id);

        let env = crate::parse_auth_envelopes(&parsed[0].value).unwrap();
        assert!(env.secrets_key.contains("BEGIN AGE ENCRYPTED FILE"));
        assert!(env.members_key.contains("BEGIN AGE ENCRYPTED FILE"));
    }
}

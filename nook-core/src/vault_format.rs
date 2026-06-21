use crate::StoredSecretRecord;
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
        if path.ends_with(".jsonl") {
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
struct StoredVaultYaml {
    secrets: Vec<StoredSecretRecord>,
}

pub fn serialize_stored_yaml(records: &[StoredSecretRecord]) -> Result<String, String> {
    let vault = StoredVaultYaml {
        secrets: records.to_vec(),
    };
    serde_yaml::to_string(&vault).map_err(|e| format!("Failed to serialize stored YAML: {}", e))
}

pub fn deserialize_stored_yaml(stored: &str) -> Result<Vec<StoredSecretRecord>, String> {
    let trimmed = stored.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }

    if let Ok(vault) = serde_yaml::from_str::<StoredVaultYaml>(trimmed) {
        return Ok(vault.secrets);
    }

    // Root-level sequence (no `secrets:` wrapper).
    serde_yaml::from_str::<Vec<StoredSecretRecord>>(trimmed)
        .map_err(|e| format!("Failed to parse stored YAML: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_records() -> Vec<StoredSecretRecord> {
        vec![
            StoredSecretRecord {
                key: "github.com".to_owned(),
                value: "-----BEGIN AGE ENCRYPTED FILE-----\nline1\nline2\n-----END AGE ENCRYPTED FILE-----"
                    .to_owned(),
            },
            StoredSecretRecord {
                key: "work-vpn".to_owned(),
                value: "-----BEGIN AGE ENCRYPTED FILE-----\nsecret\n-----END AGE ENCRYPTED FILE-----"
                    .to_owned(),
            },
        ]
    }

    #[test]
    fn jsonl_roundtrip_stored_records() {
        let records = sample_records();
        let stored = serialize_stored_jsonl(&records).unwrap();
        assert!(stored.contains("\"key\":\"github.com\""));
        assert!(stored.lines().count() == 2);

        let parsed = deserialize_stored_jsonl(&stored).unwrap();
        assert_eq!(parsed, records);
    }

    #[test]
    fn yaml_roundtrip_stored_records() {
        let records = sample_records();
        let stored = serialize_stored_yaml(&records).unwrap();
        assert!(stored.contains("github.com"));
        assert!(stored.contains("|"));
        assert!(!stored.contains("\\n"));

        let parsed = deserialize_stored_yaml(&stored).unwrap();
        assert_eq!(parsed, records);
    }

    #[test]
    fn yaml_accepts_root_sequence() {
        let yaml = r#"- key: github.com
  value: |
    armored-block
"#;
        let parsed = deserialize_stored_yaml(yaml).unwrap();
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].key, "github.com");
        assert_eq!(parsed[0].value.trim(), "armored-block");
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
        assert_eq!(
            VaultFormat::from_path("nook-vault.yaml"),
            VaultFormat::Yaml
        );
        assert_eq!(
            VaultFormat::from_path("nook-vault.jsonl"),
            VaultFormat::Jsonl
        );
        assert_eq!(
            VaultFormat::from_path("nook-vault.yml"),
            VaultFormat::Yaml
        );
        assert_eq!(
            VaultFormat::from_path("/data/user/nook-vault.yaml"),
            VaultFormat::Yaml
        );
    }

    #[test]
    fn detect_empty_defaults_to_yaml() {
        assert_eq!(detect_stored_format("").unwrap(), VaultFormat::Yaml);
        assert_eq!(detect_stored_format("   \n  \n").unwrap(), VaultFormat::Yaml);
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
        let err = deserialize_stored_jsonl(r#"{"key":"ok","value":"x"}
not-json
"#)
        .unwrap_err();
        assert!(err.contains("Failed to parse stored JSONL line"));
    }

    #[test]
    fn yaml_wrapped_and_root_sequence_equivalent() {
        let records = sample_records();
        let wrapped = serialize_stored_yaml(&records).unwrap();
        let root = serde_yaml::to_string(&records).unwrap();

        assert_eq!(deserialize_stored_yaml(&wrapped).unwrap(), records);
        assert_eq!(deserialize_stored_yaml(&root).unwrap(), records);
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
    fn detect_root_array_yaml() {
        assert_eq!(
            detect_stored_format("- key: a\n  value: b\n").unwrap(),
            VaultFormat::Yaml
        );
    }

    #[test]
    fn serialize_empty_yaml_has_secrets_key() {
        let stored = serialize_stored_yaml(&[]).unwrap();
        assert!(stored.contains("secrets:"));
        assert!(deserialize_stored_yaml(&stored).unwrap().is_empty());
    }
}

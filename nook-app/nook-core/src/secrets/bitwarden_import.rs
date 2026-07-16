//! Bitwarden vault-item conversion into Nook's typed plaintext secret model.

use crate::{LoginSecret, SecretValue, SecureNoteSecret};
use serde::Deserialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum BitwardenImportError {
    #[error("Bitwarden returned invalid JSON: {0}")]
    InvalidJson(#[from] serde_json::Error),
    #[error("This is not a Bitwarden JSON export: the items list is missing.")]
    InvalidResponse,
    #[error("Encrypted Bitwarden exports are not supported. Export plaintext JSON instead.")]
    EncryptedExport,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BitwardenImportPlan {
    pub items: Vec<SecretValue>,
    pub source_count: usize,
    pub skipped_unsupported: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BitwardenItem {
    #[serde(rename = "type")]
    item_type: u8,
    #[serde(default, deserialize_with = "deserialize_string_or_default")]
    name: String,
    #[serde(default, deserialize_with = "deserialize_string_or_default")]
    notes: String,
    login: Option<BitwardenLogin>,
}

#[derive(Debug, Deserialize)]
struct BitwardenLogin {
    #[serde(default, deserialize_with = "deserialize_string_or_default")]
    username: String,
    #[serde(default, deserialize_with = "deserialize_string_or_default")]
    password: String,
    #[serde(default)]
    uris: Vec<BitwardenUri>,
}

#[derive(Debug, Deserialize)]
struct BitwardenUri {
    #[serde(default, deserialize_with = "deserialize_string_or_default")]
    uri: String,
}

fn deserialize_string_or_default<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Ok(Option::<String>::deserialize(deserializer)?.unwrap_or_default())
}

fn parse_items(value: &serde_json::Value) -> Result<Vec<BitwardenItem>, BitwardenImportError> {
    let items = value
        .get("items")
        .ok_or(BitwardenImportError::InvalidResponse)?;
    serde_json::from_value(items.clone()).map_err(Into::into)
}

fn convert_login(item: BitwardenItem) -> Option<SecretValue> {
    let login = item.login?;
    let uris = login
        .uris
        .into_iter()
        .map(|entry| entry.uri.trim().to_owned())
        .filter(|uri| !uri.is_empty())
        .collect::<Vec<_>>();
    let website_url = uris
        .first()
        .cloned()
        .unwrap_or_else(|| item.name.trim().to_owned());

    Some(SecretValue::Login(LoginSecret {
        website_url: website_url.trim().to_owned(),
        username: login.username,
        password: login.password,
        notes: item.notes,
    }))
}

fn convert_item(item: BitwardenItem) -> Option<SecretValue> {
    match item.item_type {
        1 => convert_login(item),
        2 => Some(SecretValue::SecureNote(SecureNoteSecret {
            title: item.name.trim().to_owned(),
            note: item.notes,
        })),
        _ => None,
    }
}

/// Parse a plaintext Bitwarden JSON export.
pub fn plan_bitwarden_import(json: &str) -> Result<BitwardenImportPlan, BitwardenImportError> {
    let value: serde_json::Value = serde_json::from_str(json)?;
    if value
        .get("encrypted")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false)
    {
        return Err(BitwardenImportError::EncryptedExport);
    }
    let items = parse_items(&value)?;
    let source_count = items.len();
    let converted = items
        .into_iter()
        .filter_map(convert_item)
        .collect::<Vec<_>>();
    let skipped_unsupported = source_count.saturating_sub(converted.len());
    Ok(BitwardenImportPlan {
        items: converted,
        source_count,
        skipped_unsupported,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_export_login_fields() {
        let json = r#"{
          "items": [{
            "id": "bw-1", "type": 1, "name": "GitHub work", "notes": "recovery codes elsewhere",
            "fields": [{"name": "PIN", "value": "1234"}],
            "login": {"username": "alice", "password": "secret", "totp": "otpauth://secret",
              "uris": [{"uri": "https://github.com/login"}, {"uri": "https://gist.github.com"}]}}
          ]
        }"#;

        let plan = plan_bitwarden_import(json).unwrap();
        assert_eq!(plan.source_count, 1);
        assert_eq!(plan.skipped_unsupported, 0);
        let SecretValue::Login(login) = &plan.items[0] else {
            panic!("expected login")
        };
        assert_eq!(login.website_url, "https://github.com/login");
        assert_eq!(login.username, "alice");
        assert_eq!(login.password, "secret");
        assert_eq!(login.notes, "recovery codes elsewhere");
    }

    #[test]
    fn converts_plaintext_export_notes_and_skips_unsupported_items() {
        let json = r#"{"items":[
          {"type":2,"name":"Private note","notes":"hello"},
          {"type":3,"name":"Card"},
          {"type":4,"name":"Identity"}
        ]}"#;
        let plan = plan_bitwarden_import(json).unwrap();
        assert_eq!(plan.source_count, 3);
        assert_eq!(plan.skipped_unsupported, 2);
        assert_eq!(
            plan.items,
            vec![SecretValue::SecureNote(SecureNoteSecret {
                title: "Private note".to_owned(),
                note: "hello".to_owned(),
            })]
        );
    }

    #[test]
    fn accepts_null_optional_login_fields() {
        let plan = plan_bitwarden_import(
            r#"{"items":[{"type":1,"name":"Example","notes":null,"login":{"username":null,"password":"pw","totp":null,"uris":[{"uri":null}]}}]}"#,
        )
        .unwrap();
        let SecretValue::Login(login) = &plan.items[0] else {
            panic!("expected login")
        };
        assert_eq!(login.website_url, "Example");
        assert_eq!(login.username, "");
        assert_eq!(login.password, "pw");
    }

    #[test]
    fn rejects_encrypted_exports() {
        let error = plan_bitwarden_import(r#"{"encrypted":true,"items":[]}"#).unwrap_err();
        assert!(matches!(error, BitwardenImportError::EncryptedExport));
    }
}

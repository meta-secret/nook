//! Proton Pass export conversion into Nook's typed plaintext secret model.

use std::collections::BTreeMap;
use std::io::{Cursor, Read};

use serde::Deserialize;
use serde_json::Value;
use thiserror::Error;
use zip::ZipArchive;

use crate::{LoginSecret, SecretValue, SecureNoteSecret};

const MAX_ARCHIVE_BYTES: usize = 128 * 1024 * 1024;
const MAX_EXPORT_DATA_BYTES: u64 = 64 * 1024 * 1024;
const DATA_FILE: &str = "Proton Pass/data.json";

#[derive(Debug, Error)]
pub enum ProtonPassImportError {
    #[error("The Proton Pass export is too large to import safely.")]
    ExportTooLarge,
    #[error(
        "This Proton Pass archive is encrypted. Export an unencrypted ZIP, or decrypt data.pgp and import the resulting JSON file."
    )]
    EncryptedExport,
    #[error("The Proton Pass export is missing Proton Pass/data.json.")]
    MissingDataFile,
    #[error("This is not a valid Proton Pass ZIP or JSON export: {0}")]
    InvalidExport(String),
    #[error("The Proton Pass export data is invalid: {0}")]
    InvalidData(#[source] serde_json::Error),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProtonPassImportPlan {
    pub items: Vec<SecretValue>,
    pub source_count: usize,
    pub skipped_unsupported: usize,
}

#[derive(Debug, Deserialize)]
struct ProtonPassExport {
    vaults: BTreeMap<String, ProtonPassVault>,
}

#[derive(Debug, Deserialize)]
struct ProtonPassVault {
    #[serde(default)]
    name: String,
    #[serde(default)]
    items: Vec<ProtonPassItem>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProtonPassItem {
    data: ProtonPassItemData,
    #[serde(default)]
    state: u8,
    #[serde(default)]
    pinned: bool,
    #[serde(default)]
    files: Vec<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProtonPassItemData {
    #[serde(default)]
    metadata: ProtonPassMetadata,
    #[serde(default)]
    extra_fields: Vec<ProtonPassField>,
    #[serde(rename = "type")]
    item_type: String,
    #[serde(default)]
    content: ProtonPassContent,
}

#[derive(Debug, Default, Deserialize)]
struct ProtonPassMetadata {
    #[serde(default)]
    name: String,
    #[serde(default)]
    note: String,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProtonPassContent {
    #[serde(default)]
    item_email: String,
    #[serde(default)]
    item_username: String,
    #[serde(default)]
    password: String,
    #[serde(default)]
    urls: Vec<String>,
    #[serde(default)]
    totp_uri: String,
    #[serde(default)]
    passkeys: Vec<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProtonPassField {
    #[serde(default)]
    field_name: String,
    #[serde(rename = "type", default)]
    field_type: String,
    #[serde(default)]
    data: Value,
}

fn invalid_export(error: impl std::fmt::Display) -> ProtonPassImportError {
    ProtonPassImportError::InvalidExport(error.to_string())
}

fn read_zip_data(bytes: &[u8]) -> Result<String, ProtonPassImportError> {
    let mut archive = ZipArchive::new(Cursor::new(bytes)).map_err(invalid_export)?;
    let mut encrypted_data_found = false;
    for index in 0..archive.len() {
        let file = archive.by_index(index).map_err(invalid_export)?;
        if file.name().ends_with("/data.pgp") || file.name() == "data.pgp" {
            encrypted_data_found = true;
        }
    }

    let file = match archive.by_name(DATA_FILE) {
        Ok(file) => file,
        Err(zip::result::ZipError::FileNotFound) if encrypted_data_found => {
            return Err(ProtonPassImportError::EncryptedExport);
        }
        Err(zip::result::ZipError::FileNotFound) => {
            return Err(ProtonPassImportError::MissingDataFile);
        }
        Err(error) => return Err(invalid_export(error)),
    };
    if file.size() > MAX_EXPORT_DATA_BYTES {
        return Err(ProtonPassImportError::ExportTooLarge);
    }
    let mut json = String::new();
    file.take(MAX_EXPORT_DATA_BYTES + 1)
        .read_to_string(&mut json)
        .map_err(invalid_export)?;
    if u64::try_from(json.len()).unwrap_or(u64::MAX) > MAX_EXPORT_DATA_BYTES {
        return Err(ProtonPassImportError::ExportTooLarge);
    }
    Ok(json)
}

fn field_value(field: &ProtonPassField) -> Option<String> {
    let key = match field.field_type.as_str() {
        "totp" => "totpUri",
        "timestamp" => "timestamp",
        "text" | "hidden" => "content",
        _ => return None,
    };
    match field.data.get(key) {
        Some(Value::String(value)) if !value.trim().is_empty() => Some(value.clone()),
        Some(Value::Number(value)) => Some(value.to_string()),
        _ => None,
    }
}

fn append_proton_metadata(
    notes: &mut String,
    metadata: impl IntoIterator<Item = (String, String)>,
) {
    let metadata = metadata
        .into_iter()
        .filter(|(_, value)| !value.trim().is_empty())
        .collect::<Vec<_>>();
    if metadata.is_empty() {
        return;
    }
    if !notes.is_empty() {
        notes.push_str("\n\n");
    }
    notes.push_str("## Proton Pass");
    for (key, value) in metadata {
        notes.push_str("\n- ");
        notes.push_str(&key);
        notes.push_str(": ");
        notes.push_str(&value);
    }
}

fn item_metadata(
    item: &ProtonPassItem,
    vault_name: &str,
    primary_url: &str,
    selected_username: &str,
) -> Vec<(String, String)> {
    let mut metadata = Vec::new();
    if !vault_name.trim().is_empty() {
        metadata.push(("vault".to_owned(), vault_name.trim().to_owned()));
    }
    if item.state == 2 {
        metadata.push(("state".to_owned(), "trashed".to_owned()));
    }
    if item.pinned {
        metadata.push(("pinned".to_owned(), "true".to_owned()));
    }
    let content = &item.data.content;
    if !content.item_email.trim().is_empty() && content.item_email.trim() != selected_username {
        metadata.push(("email".to_owned(), content.item_email.trim().to_owned()));
    }
    if !content.totp_uri.trim().is_empty() {
        metadata.push(("totp".to_owned(), content.totp_uri.clone()));
    }
    metadata.extend(
        content
            .urls
            .iter()
            .filter(|url| !url.trim().is_empty() && url.trim() != primary_url)
            .enumerate()
            .map(|(index, url)| (format!("url[{}]", index + 2), url.trim().to_owned())),
    );
    metadata.extend(
        item.data
            .extra_fields
            .iter()
            .enumerate()
            .filter_map(|(index, field)| {
                let value = field_value(field)?;
                let name = if field.field_name.trim().is_empty() {
                    format!("field[{}]", index + 1)
                } else {
                    format!("field.{}", field.field_name.trim())
                };
                Some((name, value))
            }),
    );
    if !content.passkeys.is_empty() {
        metadata.push((
            "passkeys_skipped".to_owned(),
            content.passkeys.len().to_string(),
        ));
    }
    if !item.files.is_empty() {
        metadata.push((
            "attachments_skipped".to_owned(),
            item.files.len().to_string(),
        ));
    }
    metadata
}

fn convert_login(item: &ProtonPassItem, vault_name: &str) -> SecretValue {
    let content = &item.data.content;
    let website_url = content
        .urls
        .iter()
        .find(|url| !url.trim().is_empty())
        .map_or_else(
            || item.data.metadata.name.trim().to_owned(),
            |url| url.trim().to_owned(),
        );
    let username = if content.item_username.trim().is_empty() {
        content.item_email.trim()
    } else {
        content.item_username.trim()
    };
    let mut notes = item.data.metadata.note.clone();
    append_proton_metadata(
        &mut notes,
        item_metadata(item, vault_name, website_url.as_str(), username),
    );
    SecretValue::Login(LoginSecret {
        website_url,
        username: username.to_owned(),
        password: content.password.clone(),
        notes,
    })
}

fn convert_note(item: &ProtonPassItem, vault_name: &str) -> SecretValue {
    let mut note = item.data.metadata.note.clone();
    append_proton_metadata(&mut note, item_metadata(item, vault_name, "", ""));
    SecretValue::SecureNote(SecureNoteSecret {
        title: item.data.metadata.name.trim().to_owned(),
        note,
    })
}

fn plan_json(json: &str) -> Result<ProtonPassImportPlan, ProtonPassImportError> {
    let export: ProtonPassExport =
        serde_json::from_str(json).map_err(ProtonPassImportError::InvalidData)?;
    let mut source_count = 0;
    let mut items = Vec::new();
    for vault in export.vaults.into_values() {
        source_count += vault.items.len();
        for item in vault.items {
            match item.data.item_type.as_str() {
                "login" => items.push(convert_login(&item, &vault.name)),
                "note" => items.push(convert_note(&item, &vault.name)),
                _ => {}
            }
        }
    }
    let skipped_unsupported = source_count.saturating_sub(items.len());
    Ok(ProtonPassImportPlan {
        items,
        source_count,
        skipped_unsupported,
    })
}

/// Parse an unencrypted Proton Pass ZIP export or a decrypted `data.json`
/// export entirely in memory.
pub fn plan_proton_pass_import(
    export_bytes: &[u8],
) -> Result<ProtonPassImportPlan, ProtonPassImportError> {
    if export_bytes.len() > MAX_ARCHIVE_BYTES {
        return Err(ProtonPassImportError::ExportTooLarge);
    }
    if export_bytes.starts_with(b"-----BEGIN PGP MESSAGE-----") {
        return Err(ProtonPassImportError::EncryptedExport);
    }
    if export_bytes.starts_with(b"PK\x03\x04")
        || export_bytes.starts_with(b"PK\x05\x06")
        || export_bytes.starts_with(b"PK\x07\x08")
    {
        let json = read_zip_data(export_bytes)?;
        return plan_json(&json);
    }
    let json = std::str::from_utf8(export_bytes).map_err(invalid_export)?;
    plan_json(json)
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use zip::{CompressionMethod, ZipWriter, write::SimpleFileOptions};

    use super::*;

    fn build_zip(name: &str, data: &[u8]) -> Vec<u8> {
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        writer.start_file(name, options).unwrap();
        writer.write_all(data).unwrap();
        writer.finish().unwrap().into_inner()
    }

    fn export_json() -> &'static str {
        r#"{
          "userId":"user",
          "version":"1.32.0",
          "vaults":{
            "vault-b":{
              "name":"Work",
              "items":[
                {
                  "data":{
                    "metadata":{"name":"GitHub","note":"Recovery codes elsewhere"},
                    "extraFields":[
                      {"fieldName":"PIN","type":"hidden","data":{"content":"1234"}},
                      {"fieldName":"Backup OTP","type":"totp","data":{"totpUri":"otpauth://backup"}}
                    ],
                    "type":"login",
                    "content":{
                      "itemEmail":"alice@example.com",
                      "itemUsername":"alice",
                      "password":"secret",
                      "urls":["https://github.com/login","https://gist.github.com"],
                      "totpUri":"otpauth://primary",
                      "passkeys":[{"credentialId":"redacted"}]
                    }
                  },
                  "state":1,
                  "pinned":true,
                  "files":[{"fileId":"attachment"}]
                },
                {
                  "data":{
                    "metadata":{"name":"Private note","note":"Keep offline"},
                    "extraFields":[],
                    "type":"note",
                    "content":{}
                  },
                  "state":2
                },
                {
                  "data":{
                    "metadata":{"name":"Card","note":""},
                    "extraFields":[],
                    "type":"creditCard",
                    "content":{}
                  },
                  "state":1
                }
              ]
            }
          }
        }"#
    }

    #[test]
    fn converts_zip_logins_and_notes_and_counts_unsupported_items() {
        let plan =
            plan_proton_pass_import(&build_zip(DATA_FILE, export_json().as_bytes())).unwrap();
        assert_eq!(plan.source_count, 3);
        assert_eq!(plan.skipped_unsupported, 1);
        assert_eq!(plan.items.len(), 2);
        assert_eq!(
            plan.items[0],
            SecretValue::Login(LoginSecret {
                website_url: "https://github.com/login".to_owned(),
                username: "alice".to_owned(),
                password: "secret".to_owned(),
                notes: concat!(
                    "Recovery codes elsewhere\n\n## Proton Pass",
                    "\n- vault: Work",
                    "\n- pinned: true",
                    "\n- email: alice@example.com",
                    "\n- totp: otpauth://primary",
                    "\n- url[2]: https://gist.github.com",
                    "\n- field.PIN: 1234",
                    "\n- field.Backup OTP: otpauth://backup",
                    "\n- passkeys_skipped: 1",
                    "\n- attachments_skipped: 1"
                )
                .to_owned(),
            })
        );
        assert_eq!(
            plan.items[1],
            SecretValue::SecureNote(SecureNoteSecret {
                title: "Private note".to_owned(),
                note: "Keep offline\n\n## Proton Pass\n- vault: Work\n- state: trashed".to_owned(),
            })
        );
    }

    #[test]
    fn accepts_decrypted_json_and_uses_email_as_username_fallback() {
        let json = export_json().replace(r#""itemUsername":"alice""#, r#""itemUsername":"""#);
        let plan = plan_proton_pass_import(json.as_bytes()).unwrap();
        let SecretValue::Login(login) = &plan.items[0] else {
            panic!("expected login")
        };
        assert_eq!(login.username, "alice@example.com");
        assert!(!login.notes.contains("- email:"));
    }

    #[test]
    fn rejects_encrypted_missing_invalid_and_oversized_exports() {
        let encrypted = build_zip("Proton Pass/data.pgp", b"encrypted");
        assert!(matches!(
            plan_proton_pass_import(&encrypted),
            Err(ProtonPassImportError::EncryptedExport)
        ));
        let missing = build_zip("other.json", b"{}");
        assert!(matches!(
            plan_proton_pass_import(&missing),
            Err(ProtonPassImportError::MissingDataFile)
        ));
        assert!(matches!(
            plan_proton_pass_import(b"not json"),
            Err(ProtonPassImportError::InvalidData(_))
        ));
        let oversized = vec![0_u8; MAX_ARCHIVE_BYTES + 1];
        assert!(matches!(
            plan_proton_pass_import(&oversized),
            Err(ProtonPassImportError::ExportTooLarge)
        ));
    }
}

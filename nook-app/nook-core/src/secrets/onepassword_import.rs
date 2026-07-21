//! 1Password 1PUX conversion into Nook's typed plaintext secret model.

use std::io::{Cursor, Read};

use serde::Deserialize;
use serde_json::Value;
use thiserror::Error;
use zip::ZipArchive;

use crate::{CreditCardSecret, LoginSecret, SecretValue, SecureNoteSecret};

const SUPPORTED_1PUX_VERSION: u32 = 3;
const MAX_ARCHIVE_BYTES: usize = 128 * 1024 * 1024;
const MAX_EXPORT_DATA_BYTES: u64 = 64 * 1024 * 1024;
const LOGIN_CATEGORY_UUID: &str = "001";
const CREDIT_CARD_CATEGORY_UUID: &str = "002";
const SECURE_NOTE_CATEGORY_UUID: &str = "003";
const PASSWORD_CATEGORY_UUID: &str = "005";

#[derive(Debug, Error)]
pub enum OnePasswordImportError {
    #[error("This is not a valid 1Password 1PUX archive: {0}")]
    InvalidArchive(String),
    #[error("The 1Password export is missing {0}.")]
    MissingEntry(&'static str),
    #[error("The 1Password export is too large to import safely.")]
    ArchiveTooLarge,
    #[error("The 1Password export data is too large to import safely.")]
    ExportDataTooLarge,
    #[error("This 1Password export uses unsupported 1PUX version {0}.")]
    UnsupportedVersion(u32),
    #[error("The 1Password export metadata is invalid: {0}")]
    InvalidAttributes(#[source] serde_json::Error),
    #[error("The 1Password export data is invalid: {0}")]
    InvalidData(#[source] serde_json::Error),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OnePasswordImportPlan {
    pub items: Vec<SecretValue>,
    pub source_count: usize,
    pub skipped_unsupported: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportAttributes {
    version: u32,
    description: String,
}

#[derive(Debug, Deserialize)]
struct ExportData {
    accounts: Vec<OnePasswordAccount>,
}

#[derive(Debug, Deserialize)]
struct OnePasswordAccount {
    vaults: Vec<OnePasswordVault>,
}

#[derive(Debug, Deserialize)]
struct OnePasswordVault {
    #[serde(default)]
    attrs: OnePasswordVaultAttrs,
    #[serde(default)]
    items: Vec<OnePasswordItemEnvelope>,
}

#[derive(Debug, Default, Deserialize)]
struct OnePasswordVaultAttrs {
    #[serde(default)]
    name: String,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum OnePasswordItemEnvelope {
    Direct(OnePasswordItem),
    Wrapped { item: OnePasswordItem },
}

impl OnePasswordItemEnvelope {
    fn into_item(self) -> OnePasswordItem {
        match self {
            Self::Direct(item) | Self::Wrapped { item } => item,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OnePasswordItem {
    #[serde(default)]
    state: String,
    category_uuid: String,
    #[serde(default)]
    details: OnePasswordDetails,
    #[serde(default)]
    overview: OnePasswordOverview,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OnePasswordDetails {
    #[serde(default)]
    login_fields: Vec<OnePasswordLoginField>,
    #[serde(default)]
    notes_plain: String,
    #[serde(default)]
    password: String,
    #[serde(default)]
    sections: Vec<OnePasswordSection>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OnePasswordLoginField {
    #[serde(default)]
    value: String,
    #[serde(default)]
    name: String,
    #[serde(default, alias = "type")]
    field_type: String,
    #[serde(default)]
    designation: String,
}

#[derive(Debug, Deserialize)]
struct OnePasswordSection {
    #[serde(default)]
    title: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    fields: Vec<OnePasswordField>,
}

#[derive(Debug, Deserialize)]
struct OnePasswordField {
    #[serde(default)]
    title: String,
    #[serde(default)]
    id: String,
    #[serde(default)]
    value: Value,
}

#[derive(Debug, Default, Deserialize)]
struct OnePasswordOverview {
    #[serde(default)]
    title: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    urls: Vec<OnePasswordUrl>,
    #[serde(default)]
    tags: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct OnePasswordUrl {
    #[serde(default)]
    label: String,
    #[serde(default)]
    url: String,
}

fn archive_error(error: impl std::fmt::Display) -> OnePasswordImportError {
    OnePasswordImportError::InvalidArchive(error.to_string())
}

fn read_zip_text(
    archive: &mut ZipArchive<Cursor<&[u8]>>,
    name: &'static str,
    max_bytes: u64,
) -> Result<String, OnePasswordImportError> {
    let file = archive.by_name(name).map_err(|error| match error {
        zip::result::ZipError::FileNotFound => OnePasswordImportError::MissingEntry(name),
        other => archive_error(other),
    })?;
    if file.size() > max_bytes {
        return Err(if name == "export.data" {
            OnePasswordImportError::ExportDataTooLarge
        } else {
            OnePasswordImportError::ArchiveTooLarge
        });
    }
    let mut text = String::new();
    file.take(max_bytes + 1)
        .read_to_string(&mut text)
        .map_err(archive_error)?;
    if u64::try_from(text.len()).unwrap_or(u64::MAX) > max_bytes {
        return Err(if name == "export.data" {
            OnePasswordImportError::ExportDataTooLarge
        } else {
            OnePasswordImportError::ArchiveTooLarge
        });
    }
    Ok(text)
}

fn field_value(value: &Value) -> Option<String> {
    match value {
        Value::Null => None,
        Value::String(value) => (!value.trim().is_empty()).then(|| value.clone()),
        Value::Bool(value) => Some(value.to_string()),
        Value::Number(value) => Some(value.to_string()),
        Value::Array(values) => {
            let values = values.iter().filter_map(field_value).collect::<Vec<_>>();
            (!values.is_empty()).then(|| values.join(", "))
        }
        Value::Object(values) => {
            const WRAPPED_VALUE_KEYS: [&str; 13] = [
                "concealed",
                "string",
                "email",
                "url",
                "totp",
                "oneTimePassword",
                "phone",
                "date",
                "monthYear",
                "menu",
                "reference",
                "address",
                "creditCardNumber",
            ];
            WRAPPED_VALUE_KEYS
                .iter()
                .find_map(|key| values.get(*key).and_then(field_value))
                .or_else(|| serde_json::to_string(value).ok())
        }
    }
}

fn append_onepassword_metadata(
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
    notes.push_str("## 1Password");
    notes.push_str("\n- format: 1PUX");
    for (key, value) in metadata {
        notes.push_str("\n- ");
        notes.push_str(&key);
        notes.push_str(": ");
        notes.push_str(&value);
    }
}

fn normalized_field_name(field: &OnePasswordField) -> String {
    let name = if field.title.trim().is_empty() {
        field.id.trim()
    } else {
        field.title.trim()
    };
    name.to_ascii_lowercase()
}

fn section_metadata(
    sections: &[OnePasswordSection],
    omit_login_credentials: bool,
) -> Vec<(String, String)> {
    sections
        .iter()
        .flat_map(|section| {
            let section_name = if section.title.trim().is_empty() {
                section.name.trim()
            } else {
                section.title.trim()
            };
            section
                .fields
                .iter()
                .enumerate()
                .filter_map(move |(index, field)| {
                    if omit_login_credentials
                        && [
                            "username",
                            "email",
                            "password",
                            "cardholder",
                            "cardholder name",
                            "name on card",
                            "number",
                            "card number",
                            "credit card number",
                            "ccnum",
                            "expiry",
                            "expires",
                            "expiration",
                            "expiry date",
                            "valid thru",
                            "cvv",
                            "cvc",
                            "security code",
                            "verification number",
                        ]
                        .contains(&normalized_field_name(field).as_str())
                    {
                        return None;
                    }
                    let value = field_value(&field.value)?;
                    let field_name = if field.title.trim().is_empty() {
                        if field.id.trim().is_empty() {
                            format!("field[{}]", index + 1)
                        } else {
                            field.id.trim().to_owned()
                        }
                    } else {
                        field.title.trim().to_owned()
                    };
                    let key = if section_name.is_empty() {
                        field_name
                    } else {
                        format!("{section_name}.{field_name}")
                    };
                    Some((key, value))
                })
        })
        .collect()
}

fn item_metadata(
    item: &OnePasswordItem,
    vault_name: &str,
    primary_url: &str,
    omit_login_credentials: bool,
) -> Vec<(String, String)> {
    let mut metadata = Vec::new();
    if !vault_name.trim().is_empty() {
        metadata.push(("vault".to_owned(), vault_name.trim().to_owned()));
    }
    if item.state.eq_ignore_ascii_case("archived") {
        metadata.push(("state".to_owned(), "archived".to_owned()));
    }
    if !item.overview.tags.is_empty() {
        metadata.push(("tags".to_owned(), item.overview.tags.join(", ")));
    }
    metadata.extend(
        item.overview
            .urls
            .iter()
            .filter(|entry| !entry.url.trim().is_empty() && entry.url.trim() != primary_url)
            .enumerate()
            .map(|(index, entry)| {
                let label = if entry.label.trim().is_empty() {
                    format!("url[{}]", index + 2)
                } else {
                    format!("url.{}", entry.label.trim())
                };
                (label, entry.url.trim().to_owned())
            }),
    );
    metadata.extend(section_metadata(
        &item.details.sections,
        omit_login_credentials,
    ));
    metadata
}

fn section_credential(sections: &[OnePasswordSection], names: &[&str]) -> String {
    sections
        .iter()
        .flat_map(|section| section.fields.iter())
        .find(|field| names.contains(&normalized_field_name(field).as_str()))
        .and_then(|field| field_value(&field.value))
        .unwrap_or_default()
}

fn login_field(item: &OnePasswordItem, designation: &str, fallback_names: &[&str]) -> String {
    item.details
        .login_fields
        .iter()
        .find(|field| field.designation.eq_ignore_ascii_case(designation))
        .or_else(|| {
            item.details.login_fields.iter().find(|field| {
                fallback_names.contains(&field.name.trim().to_ascii_lowercase().as_str())
                    || (designation == "password" && field.field_type.eq_ignore_ascii_case("P"))
            })
        })
        .map(|field| field.value.clone())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| section_credential(&item.details.sections, fallback_names))
}

fn primary_url(item: &OnePasswordItem) -> String {
    if !item.overview.url.trim().is_empty() {
        return item.overview.url.trim().to_owned();
    }
    item.overview
        .urls
        .iter()
        .find(|entry| !entry.url.trim().is_empty())
        .map_or_else(
            || item.overview.title.trim().to_owned(),
            |entry| entry.url.trim().to_owned(),
        )
}

fn convert_login(item: &OnePasswordItem, vault_name: &str) -> SecretValue {
    let website_url = primary_url(item);
    let username = login_field(item, "username", &["username", "email"]);
    let password = if item.details.password.is_empty() {
        login_field(item, "password", &["password"])
    } else {
        item.details.password.clone()
    };
    let mut notes = item.details.notes_plain.clone();
    append_onepassword_metadata(
        &mut notes,
        item_metadata(item, vault_name, website_url.as_str(), true),
    );
    SecretValue::Login(LoginSecret {
        website_url,
        username,
        password,
        notes,
    })
}

fn convert_secure_note(item: &OnePasswordItem, vault_name: &str) -> SecretValue {
    let mut note = item.details.notes_plain.clone();
    append_onepassword_metadata(&mut note, item_metadata(item, vault_name, "", false));
    SecretValue::SecureNote(SecureNoteSecret {
        title: item.overview.title.trim().to_owned(),
        note,
    })
}

fn parse_month_year(raw: &str) -> (String, String) {
    let digits: String = raw.chars().filter(char::is_ascii_digit).collect();
    if digits.len() == 6 {
        return (digits[4..6].to_owned(), digits[..4].to_owned());
    }
    if let Some((month, year)) = raw.split_once(['/', '-']) {
        return (month.trim().to_owned(), year.trim().to_owned());
    }
    (String::new(), String::new())
}

fn convert_credit_card(item: &OnePasswordItem, vault_name: &str) -> Option<SecretValue> {
    let cardholder = section_credential(
        &item.details.sections,
        &["cardholder", "cardholder name", "name on card"],
    );
    let number = section_credential(
        &item.details.sections,
        &["number", "card number", "credit card number", "ccnum"],
    );
    let expiry = section_credential(
        &item.details.sections,
        &[
            "expiry",
            "expires",
            "expiration",
            "expiry date",
            "valid thru",
        ],
    );
    let (expiration_month, expiration_year) = parse_month_year(&expiry);
    let cvv = section_credential(
        &item.details.sections,
        &["cvv", "cvc", "security code", "verification number"],
    );
    let mut notes = item.details.notes_plain.clone();
    append_onepassword_metadata(&mut notes, item_metadata(item, vault_name, "", true));
    CreditCardSecret::from_fields(
        item.overview.title.trim(),
        cardholder.trim(),
        number.trim(),
        expiration_month.trim(),
        expiration_year.trim(),
        cvv.trim(),
        &notes,
    )
    .ok()
    .map(SecretValue::CreditCard)
}

fn convert_item(item: &OnePasswordItem, vault_name: &str) -> Option<SecretValue> {
    match item.category_uuid.as_str() {
        LOGIN_CATEGORY_UUID | PASSWORD_CATEGORY_UUID => Some(convert_login(item, vault_name)),
        SECURE_NOTE_CATEGORY_UUID => Some(convert_secure_note(item, vault_name)),
        CREDIT_CARD_CATEGORY_UUID => convert_credit_card(item, vault_name),
        _ => None,
    }
}

fn plan_export_data(json: &str) -> Result<OnePasswordImportPlan, OnePasswordImportError> {
    let data: ExportData =
        serde_json::from_str(json).map_err(OnePasswordImportError::InvalidData)?;
    let mut source_count = 0;
    let mut items = Vec::new();
    for account in data.accounts {
        for vault in account.vaults {
            let vault_name = vault.attrs.name;
            source_count += vault.items.len();
            items.extend(vault.items.into_iter().filter_map(|item| {
                let item = item.into_item();
                convert_item(&item, &vault_name)
            }));
        }
    }
    let skipped_unsupported = source_count.saturating_sub(items.len());
    Ok(OnePasswordImportPlan {
        items,
        source_count,
        skipped_unsupported,
    })
}

/// Parse a 1Password Unencrypted Export (`.1pux`) archive without extracting it
/// to disk. Only the bounded `export.attributes` and `export.data` entries are
/// read; attachments remain untouched and unsupported.
pub fn plan_onepassword_import(
    archive_bytes: &[u8],
) -> Result<OnePasswordImportPlan, OnePasswordImportError> {
    if archive_bytes.len() > MAX_ARCHIVE_BYTES {
        return Err(OnePasswordImportError::ArchiveTooLarge);
    }
    let mut archive = ZipArchive::new(Cursor::new(archive_bytes)).map_err(archive_error)?;
    let attributes_json = read_zip_text(&mut archive, "export.attributes", 64 * 1024)?;
    let attributes: ExportAttributes = serde_json::from_str(&attributes_json)
        .map_err(OnePasswordImportError::InvalidAttributes)?;
    if attributes.description != "1Password Unencrypted Export" {
        return Err(archive_error(
            "export.attributes has an unexpected description",
        ));
    }
    if attributes.version != SUPPORTED_1PUX_VERSION {
        return Err(OnePasswordImportError::UnsupportedVersion(
            attributes.version,
        ));
    }
    let export_data = read_zip_text(&mut archive, "export.data", MAX_EXPORT_DATA_BYTES)?;
    plan_export_data(&export_data)
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use zip::{CompressionMethod, ZipWriter, write::SimpleFileOptions};

    use super::*;

    fn build_1pux(attributes: &str, data: &str) -> Vec<u8> {
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        writer.start_file("export.attributes", options).unwrap();
        writer.write_all(attributes.as_bytes()).unwrap();
        writer.start_file("export.data", options).unwrap();
        writer.write_all(data.as_bytes()).unwrap();
        writer.finish().unwrap().into_inner()
    }

    fn current_attributes() -> &'static str {
        r#"{"version":3,"description":"1Password Unencrypted Export","createdAt":1585333569}"#
    }

    #[test]
    fn converts_login_password_and_secure_note_items() {
        let data = r#"{
          "accounts":[{
            "vaults":[{
              "attrs":{"name":"Personal"},
              "items":[
                {
                  "categoryUuid":"001",
                  "state":"active",
                  "overview":{
                    "title":"GitHub",
                    "url":"https://github.com/login",
                    "urls":[
                      {"label":"","url":"https://github.com/login"},
                      {"label":"gist","url":"https://gist.github.com"}
                    ],
                    "tags":["work","code"]
                  },
                  "details":{
                    "loginFields":[
                      {"value":"alice","name":"username","fieldType":"T","designation":"username"},
                      {"value":"secret","name":"password","fieldType":"P","designation":"password"}
                    ],
                    "notesPlain":"Recovery codes elsewhere",
                    "sections":[{
                      "title":"Security",
                      "name":"security",
                      "fields":[
                        {"title":"PIN","id":"pin","value":{"concealed":"1234"}},
                        {"title":"TOTP","id":"otp","value":{"oneTimePassword":"otpauth://secret"}}
                      ]
                    }]
                  }
                },
                {
                  "categoryUuid":"005",
                  "overview":{"title":"Router"},
                  "details":{"password":"router-secret"}
                },
                {
                  "categoryUuid":"003",
                  "state":"archived",
                  "overview":{"title":"Private note"},
                  "details":{"notesPlain":"hello"}
                }
              ]
            }]
          }]
        }"#;
        let plan = plan_onepassword_import(&build_1pux(current_attributes(), data)).unwrap();
        assert_eq!(plan.source_count, 3);
        assert_eq!(plan.skipped_unsupported, 0);
        assert_eq!(plan.items.len(), 3);

        let SecretValue::Login(login) = &plan.items[0] else {
            panic!("expected login")
        };
        assert_eq!(login.website_url, "https://github.com/login");
        assert_eq!(login.username, "alice");
        assert_eq!(login.password, "secret");
        assert_eq!(
            login.notes,
            "Recovery codes elsewhere\n\n## 1Password\n- format: 1PUX\n- vault: Personal\n- tags: work, code\n- url.gist: https://gist.github.com\n- Security.PIN: 1234\n- Security.TOTP: otpauth://secret"
        );

        let SecretValue::Login(password) = &plan.items[1] else {
            panic!("expected password item as login")
        };
        assert_eq!(password.website_url, "Router");
        assert_eq!(password.password, "router-secret");

        assert_eq!(
            plan.items[2],
            SecretValue::SecureNote(SecureNoteSecret {
                title: "Private note".to_owned(),
                note: "hello\n\n## 1Password\n- format: 1PUX\n- vault: Personal\n- state: archived"
                    .to_owned(),
            })
        );
    }

    #[test]
    fn accepts_wrapped_items_and_skips_unsupported_categories() {
        let data = r#"{
          "accounts": [{
            "vaults": [{
              "items": [
                {"item":{"categoryUuid":"003","overview":{"title":"Wrapped"},"details":{"notesPlain":"ok"}}},
                {"categoryUuid":"002","overview":{"title":"Credit card"},"details":{"sections":[{"fields":[
                  {"id":"cardholder","value":"Ada"},
                  {"id":"ccnum","value":{"creditCardNumber":"4111111111111111"}},
                  {"id":"expiry","value":{"monthYear":203012}},
                  {"id":"cvv","value":{"concealed":"123"}}
                ]}]}},
                {"categoryUuid":"006","overview":{"title":"Document"}},
                {"categoryUuid":"109","overview":{"title":"SSH key"}}
              ]
            }]
          }]
        }"#;
        let plan = plan_onepassword_import(&build_1pux(current_attributes(), data)).unwrap();
        assert_eq!(plan.source_count, 4);
        assert_eq!(plan.skipped_unsupported, 2);
        assert_eq!(plan.items.len(), 2);
        let SecretValue::CreditCard(card) = &plan.items[1] else {
            panic!("expected credit card");
        };
        assert_eq!(card.number, "4111111111111111");
        assert_eq!(card.expiration_month, "12");
        assert_eq!(card.expiration_year, "2030");
    }

    #[test]
    fn rejects_non_archives_missing_entries_and_unknown_versions() {
        assert!(matches!(
            plan_onepassword_import(b"not a zip"),
            Err(OnePasswordImportError::InvalidArchive(_))
        ));

        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        writer
            .start_file("export.attributes", SimpleFileOptions::default())
            .unwrap();
        writer.write_all(current_attributes().as_bytes()).unwrap();
        let missing_data = writer.finish().unwrap().into_inner();
        assert!(matches!(
            plan_onepassword_import(&missing_data),
            Err(OnePasswordImportError::MissingEntry("export.data"))
        ));

        let future = build_1pux(
            r#"{"version":4,"description":"1Password Unencrypted Export"}"#,
            r#"{"accounts":[]}"#,
        );
        assert!(matches!(
            plan_onepassword_import(&future),
            Err(OnePasswordImportError::UnsupportedVersion(4))
        ));
    }

    #[test]
    fn rejects_oversized_archives_before_parsing() {
        let archive = vec![0_u8; MAX_ARCHIVE_BYTES + 1];
        assert!(matches!(
            plan_onepassword_import(&archive),
            Err(OnePasswordImportError::ArchiveTooLarge)
        ));
    }
}

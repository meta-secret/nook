#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! Decoded Proton Pass vaults and ordered item metadata conversion.
#[derive(Debug, PartialEq, Eq)]
enum ExportFieldExclusion {
    EmptyText,
    UnsupportedValue,
}
use super::super::import_support::{ImportMetadata, SourceLabelMetadata};
use super::{ProtonPassImportError, ProtonPassImportPlan};
use crate::CreditCardFields;
use crate::secrets::import_support::{ImportItemDisposition, ImportSkipReason};
use crate::{CreditCardSecret, LoginSecret, SecretValue, SecureNoteSecret};
use serde::Deserialize;
use serde::de::IgnoredAny;
use serde_json::Number;
use std::{collections::BTreeMap, str};
#[derive(Debug, Deserialize)]
pub(super) struct ProtonPassExport {
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
    files: Vec<IgnoredAny>,
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
    username: String,
    #[serde(default)]
    password: String,
    #[serde(default)]
    urls: Vec<String>,
    #[serde(default)]
    totp_uri: String,
    #[serde(default)]
    passkeys: Vec<IgnoredAny>,
    #[serde(default)]
    cardholder_name: String,
    #[serde(default)]
    number: String,
    #[serde(default)]
    expiration_date: String,
    #[serde(default)]
    verification_number: String,
    #[serde(default)]
    pin: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProtonPassField {
    #[serde(default)]
    field_name: String,
    #[serde(rename = "type", default)]
    field_type: String,
    #[serde(default)]
    data: ProtonPassFieldContent,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum ProtonPassFieldContent {
    Object(ProtonPassFieldData),
    Unsupported(IgnoredAny),
}
impl Default for ProtonPassFieldContent {
    fn default() -> Self {
        Self::Unsupported(IgnoredAny)
    }
}
/// Only recognized scalar field content enters imported metadata.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProtonPassFieldData {
    #[serde(default)]
    content: ProtonPassFieldScalar,
    #[serde(default)]
    totp_uri: ProtonPassFieldScalar,
    #[serde(default)]
    timestamp: ProtonPassFieldScalar,
}
#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum ProtonPassFieldScalar {
    Text(String),
    Number(Number),
    Unsupported(IgnoredAny),
}
impl Default for ProtonPassFieldScalar {
    fn default() -> Self {
        Self::Unsupported(IgnoredAny)
    }
}
impl ProtonPassFieldScalar {
    fn text(&self) -> Result<String, ExportFieldExclusion> {
        match self {
            Self::Text(value) if !value.trim().is_empty() => Ok(value.clone()),
            Self::Number(value) => Ok(value.to_string()),
            Self::Text(_) => Err(ExportFieldExclusion::EmptyText),
            Self::Unsupported(_) => Err(ExportFieldExclusion::UnsupportedValue),
        }
    }
}
impl ProtonPassField {
    fn value(&self) -> Result<String, ExportFieldExclusion> {
        let ProtonPassFieldContent::Object(data) = &self.data else {
            return Err(ExportFieldExclusion::UnsupportedValue);
        };
        match self.field_type.as_str() {
            "totp" => data.totp_uri.text(),
            "timestamp" => data.timestamp.text(),
            "text" | "hidden" => data.content.text(),
            _ => Err(ExportFieldExclusion::UnsupportedValue),
        }
    }
}
struct ProtonPassNotes<'a> {
    notes: &'a mut String,
}
impl ProtonPassNotes<'_> {
    fn append(self, metadata: impl IntoIterator<Item = (String, String)>) {
        ImportMetadata {
            heading: "Proton Pass",
            entries: metadata,
        }
        .append_to(self.notes);
    }
}
struct ProtonPassMetadataSelection<'a> {
    primary_url: &'a str,
    username: &'a str,
}
struct ProtonPassVaultItem<'a> {
    item: ProtonPassItem,
    vault_name: &'a str,
}
impl ProtonPassVaultItem<'_> {
    fn metadata(&self, selection: &ProtonPassMetadataSelection<'_>) -> Vec<(String, String)> {
        let item = &self.item;
        let vault_name = self.vault_name;
        let primary_url = selection.primary_url;
        let selected_username = selection.username;
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
                    let value = field.value().ok()?;
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
}
impl ProtonPassVaultItem<'_> {
    fn login(self) -> SecretValue {
        let item = &self.item;

        let content = &item.data.content;
        let website_url = content
            .urls
            .iter()
            .find(|url| !url.trim().is_empty())
            .map_or_else(
                || item.data.metadata.name.trim().to_owned(),
                |url| url.trim().to_owned(),
            );
        let username = [
            content.item_username.as_str(),
            content.username.as_str(),
            content.item_email.as_str(),
        ]
        .into_iter()
        .find(|candidate| !candidate.trim().is_empty())
        .map_or("", str::trim);
        let mut metadata = self.metadata(&ProtonPassMetadataSelection {
            primary_url: website_url.as_str(),
            username,
        });
        if let Ok(name) = (SourceLabelMetadata {
            key: "name",
            label: &item.data.metadata.name,
            website_url: website_url.as_str(),
        })
        .entry()
        {
            metadata.insert(0, name);
        }
        let mut notes = self.item.data.metadata.note;
        let content = self.item.data.content;
        let mut username = [content.item_username, content.username, content.item_email]
            .into_iter()
            .find(|candidate| !candidate.trim().is_empty())
            .unwrap_or_default();
        username.truncate(username.trim_end().len());
        let leading_whitespace = username.len() - username.trim_start().len();
        username.drain(..leading_whitespace);
        ProtonPassNotes { notes: &mut notes }.append(metadata);
        SecretValue::Login(LoginSecret {
            website_url,
            username,
            password: content.password,
            notes,
        })
    }
}
impl ProtonPassVaultItem<'_> {
    fn note(self) -> SecretValue {
        let item = &self.item;

        let metadata = self.metadata(&ProtonPassMetadataSelection {
            primary_url: "",
            username: "",
        });
        let title = item.data.metadata.name.trim().to_owned();
        let mut note = self.item.data.metadata.note;
        ProtonPassNotes { notes: &mut note }.append(metadata);
        SecretValue::SecureNote(SecureNoteSecret { title, note })
    }
}
impl ProtonPassVaultItem<'_> {
    fn credit_card(self) -> ImportItemDisposition {
        let item = &self.item;

        let content = &item.data.content;
        let (expiration_month, expiration_year) = ProtonPassExpiration {
            raw: &content.expiration_date,
        }
        .month_year();
        let mut metadata = self.metadata(&ProtonPassMetadataSelection {
            primary_url: "",
            username: "",
        });
        if !content.pin.trim().is_empty() {
            metadata.push(("pin".to_owned(), content.pin.trim().to_owned()));
        }
        let mut notes = self.item.data.metadata.note;
        let content = &self.item.data.content;
        ProtonPassNotes { notes: &mut notes }.append(metadata);
        CreditCardSecret::from_fields(CreditCardFields {
            title: self.item.data.metadata.name.trim(),
            cardholder_name: content.cardholder_name.trim(),
            number: content.number.trim(),
            expiration_month: expiration_month.trim(),
            expiration_year: expiration_year.trim(),
            cvv: content.verification_number.trim(),
            notes: &notes,
        })
        .map_or(
            ImportItemDisposition::Skipped(ImportSkipReason::InvalidCard),
            |card| ImportItemDisposition::Imported(SecretValue::CreditCard(card)),
        )
    }
}
struct ProtonPassExpiration<'a> {
    raw: &'a str,
}
impl ProtonPassExpiration<'_> {
    fn month_year(&self) -> (String, String) {
        let trimmed = self.raw.trim();
        if let Some((year, month)) = trimmed.split_once('-') {
            return (month.trim().to_owned(), year.trim().to_owned());
        }
        if let Some((month, year)) = trimmed.split_once('/') {
            return (month.trim().to_owned(), year.trim().to_owned());
        }
        (String::new(), String::new())
    }
}
impl ProtonPassExport {
    pub(super) fn parse(json: &str) -> Result<Self, ProtonPassImportError> {
        serde_json::from_str(json).map_err(ProtonPassImportError::InvalidData)
    }
    #[must_use]
    pub(super) fn plan(self) -> ProtonPassImportPlan {
        let mut source_count = 0;
        let mut items = Vec::new();
        for vault in self.vaults.into_values() {
            source_count += vault.items.len();
            for item in vault.items {
                match item.data.item_type.as_str() {
                    "login" => items.push(
                        ProtonPassVaultItem {
                            item,
                            vault_name: &vault.name,
                        }
                        .login(),
                    ),
                    "note" => items.push(
                        ProtonPassVaultItem {
                            item,
                            vault_name: &vault.name,
                        }
                        .note(),
                    ),
                    "creditCard" => {
                        if let ImportItemDisposition::Imported(card) = (ProtonPassVaultItem {
                            item,
                            vault_name: &vault.name,
                        })
                        .credit_card()
                        {
                            items.push(card);
                        }
                    }
                    _ => {}
                }
            }
        }
        let skipped_unsupported = source_count.saturating_sub(items.len());
        ProtonPassImportPlan {
            items,
            source_count: source_count.into(),
            skipped_unsupported: skipped_unsupported.into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{ProtonPassExpiration, ProtonPassExport, ProtonPassField};
    use crate::SecretValue;

    #[test]
    fn dynamic_fields_keep_type_selection_and_exact_text() -> anyhow::Result<()> {
        for (json, expected) in [
            (
                r#"{"type":"hidden","data":{"content":"  secret  "}}"#,
                Some("  secret  "),
            ),
            (
                r#"{"type":"totp","data":{"content":"ignored","totpUri":"otp"}}"#,
                Some("otp"),
            ),
            (
                r#"{"type":"timestamp","data":{"timestamp":123}}"#,
                Some("123"),
            ),
            (r#"{"type":"unknown","data":{"content":"secret"}}"#, None),
            (r#"{"type":"text","data":{"content":false}}"#, None),
            (r#"{"type":"text","data":null}"#, None),
            (r#"{"type":"text","data":42}"#, None),
            (r#"{"type":"text","data":true}"#, None),
            (r#"{"type":"text","data":"ignored"}"#, None),
            (r#"{"type":"text","data":[]}"#, None),
            (r#"{"type":"text","data":{"content":" "}}"#, None),
        ] {
            let field: ProtonPassField = serde_json::from_str(json)?;
            assert_eq!(field.value().ok().as_deref(), expected);
        }
        Ok(())
    }

    #[test]
    fn vault_key_order_item_order_and_unsupported_counts_are_preserved() -> anyhow::Result<()> {
        let json = r#"{"vaults":{"z":{"items":[{"data":{"type":"note","metadata":{"name":"last"}}}]},"a":{"items":[{"data":{"type":"note","metadata":{"name":"first"}}},{"data":{"type":"unknown"}},{"data":{"type":"note","metadata":{"name":"second"}}}]}}}"#;
        let plan = ProtonPassExport::parse(json)?.plan();
        assert_eq!(usize::from(plan.source_count), 4);
        assert_eq!(usize::from(plan.skipped_unsupported), 1);
        for (item, expected) in plan.items.iter().zip(["first", "second", "last"]) {
            let SecretValue::SecureNote(note) = item else {
                anyhow::bail!("expected note")
            };
            assert_eq!(note.title, expected);
        }
        assert_eq!(plan.items.len(), 3);
        Ok(())
    }

    #[test]
    fn username_precedence_trims_selection_but_preserves_password_bytes() -> anyhow::Result<()> {
        let json = r#"{"vaults":{"a":{"name":"Vault","items":[{"data":{"type":"login","metadata":{"name":"Title"},"content":{"itemUsername":"  alice  ","username":"legacy","itemEmail":"email","password":"  sécret 🔑  ","urls":[" https://example.com "]}}}]}}}"#;
        let plan = ProtonPassExport::parse(json)?.plan();
        let [SecretValue::Login(login)] = plan.items.as_slice() else {
            anyhow::bail!("expected login")
        };
        assert_eq!(login.username, "alice");
        assert_eq!(login.password, "  sécret 🔑  ");
        assert_eq!(
            login.notes,
            "## Proton Pass\n- name: Title\n- vault: Vault\n- email: email"
        );
        Ok(())
    }

    #[test]
    fn expiration_keeps_hyphen_before_slash_order() {
        for (raw, month, year) in [
            ("2030-12", "12", "2030"),
            ("12/30", "12", "30"),
            ("2030-12/01", "12/01", "2030"),
            ("invalid", "", ""),
        ] {
            assert_eq!(
                ProtonPassExpiration { raw }.month_year(),
                (month.to_owned(), year.to_owned())
            );
        }
    }
    #[test]
    fn unsupported_custom_data_does_not_discard_valid_export_items() -> anyhow::Result<()> {
        let plan = ProtonPassExport::parse(r#"{"vaults":{"a":{"items":[{"data":{"type":"note","metadata":{"name":"Kept"},"extraFields":[{"fieldName":"ignored","type":"text","data":null},{"fieldName":"array","type":"text","data":[1]},{"fieldName":"scalar","type":"text","data":true},{"fieldName":"known","type":"text","data":{"content":"retained"}}]}}]}}}"#)?.plan();
        let [SecretValue::SecureNote(note)] = plan.items.as_slice() else {
            anyhow::bail!("expected retained note")
        };
        assert_eq!(note.title, "Kept");
        assert!(note.note.contains("retained"));
        assert!(!note.note.contains("ignored"));
        assert_eq!(usize::from(plan.source_count), 1);
        assert_eq!(usize::from(plan.skipped_unsupported), 0);
        Ok(())
    }
}

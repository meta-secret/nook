#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! Ordered vault item conversion and dynamic field interpretation.
use super::super::import_support::{ImportMetadata, SourceLabelMetadata};
use super::{OnePasswordImportError, OnePasswordImportPlan};
use crate::CreditCardFields;
use crate::{CreditCardSecret, LoginSecret, SecretValue, SecureNoteSecret};
use serde::Deserialize;
use serde_json::Value;
use std::iter;
const LOGIN_CATEGORY_UUID: &str = "001";
const CREDIT_CARD_CATEGORY_UUID: &str = "002";
const SECURE_NOTE_CATEGORY_UUID: &str = "003";
const PASSWORD_CATEGORY_UUID: &str = "005";
#[derive(Debug, Deserialize)]
pub(super) struct ExportData {
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

struct OnePasswordFieldValue<'a> {
    value: &'a Value,
}
impl OnePasswordFieldValue<'_> {
    fn text(&self) -> Option<String> {
        match self.value {
            Value::Null => None,
            Value::String(value) => (!value.trim().is_empty()).then(|| value.clone()),
            Value::Bool(value) => Some(value.to_string()),
            Value::Number(value) => Some(value.to_string()),
            Value::Array(values) => {
                let values = values
                    .iter()
                    .filter_map(|value| OnePasswordFieldValue { value }.text())
                    .collect::<Vec<_>>();
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
                    .find_map(|key| {
                        values
                            .get(*key)
                            .and_then(|value| OnePasswordFieldValue { value }.text())
                    })
                    .or_else(|| serde_json::to_string(self.value).ok())
            }
        }
    }
}
struct OnePasswordNotes<'a> {
    notes: &'a mut String,
}
impl OnePasswordNotes<'_> {
    fn append(self, metadata: impl IntoIterator<Item = (String, String)>) {
        ImportMetadata {
            heading: "1Password",
            entries: iter::once(("format".to_owned(), "1PUX".to_owned())).chain(metadata),
        }
        .append_to(self.notes);
    }
}
impl OnePasswordField {
    fn normalized_name(&self) -> String {
        let name = if self.title.trim().is_empty() {
            self.id.trim()
        } else {
            self.title.trim()
        };
        name.to_ascii_lowercase()
    }
}
#[derive(Clone, Copy)]
enum OnePasswordMetadataPolicy {
    OmitCredentials,
    AllFields,
}
struct OnePasswordSections<'a> {
    sections: &'a [OnePasswordSection],
}
impl OnePasswordSections<'_> {
    fn metadata(&self, policy: OnePasswordMetadataPolicy) -> Vec<(String, String)> {
        self.sections
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
                        if matches!(policy, OnePasswordMetadataPolicy::OmitCredentials)
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
                            .contains(&field.normalized_name().as_str())
                        {
                            return None;
                        }
                        let value = OnePasswordFieldValue {
                            value: &field.value,
                        }
                        .text()?;
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
    fn credential(&self, names: &[&str]) -> String {
        self.sections
            .iter()
            .flat_map(|section| section.fields.iter())
            .find(|field| names.contains(&field.normalized_name().as_str()))
            .and_then(|field| {
                OnePasswordFieldValue {
                    value: &field.value,
                }
                .text()
            })
            .unwrap_or_default()
    }
}
struct OnePasswordMetadataRequest<'a> {
    primary_url: &'a str,
    policy: OnePasswordMetadataPolicy,
}
struct OnePasswordVaultItem<'a> {
    item: &'a OnePasswordItem,
    vault_name: &'a str,
}
impl OnePasswordVaultItem<'_> {
    fn metadata(&self, request: &OnePasswordMetadataRequest<'_>) -> Vec<(String, String)> {
        let primary_url = request.primary_url;
        let policy = request.policy;
        let item = self.item;
        let vault_name = self.vault_name;
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
        metadata.extend(
            OnePasswordSections {
                sections: &item.details.sections,
            }
            .metadata(policy),
        );
        metadata
    }
}
enum OnePasswordCredential {
    Username,
    Password,
}
impl OnePasswordCredential {
    fn lookup(self) -> (&'static str, &'static [&'static str]) {
        match self {
            Self::Username => ("username", &["username", "email"]),
            Self::Password => ("password", &["password"]),
        }
    }
}
impl OnePasswordItem {
    fn login_field(&self, kind: OnePasswordCredential) -> String {
        let (designation, fallback_names) = kind.lookup();
        self.details
            .login_fields
            .iter()
            .find(|field| field.designation.eq_ignore_ascii_case(designation))
            .or_else(|| {
                self.details.login_fields.iter().find(|field| {
                    fallback_names.contains(&field.name.trim().to_ascii_lowercase().as_str())
                        || (designation == "password" && field.field_type.eq_ignore_ascii_case("P"))
                })
            })
            .map(|field| field.value.clone())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| {
                OnePasswordSections {
                    sections: &self.details.sections,
                }
                .credential(fallback_names)
            })
    }
    fn primary_url(&self) -> String {
        if !self.overview.url.trim().is_empty() {
            return self.overview.url.trim().to_owned();
        }
        self.overview
            .urls
            .iter()
            .find(|entry| !entry.url.trim().is_empty())
            .map_or_else(
                || self.overview.title.trim().to_owned(),
                |entry| entry.url.trim().to_owned(),
            )
    }
}
impl OnePasswordVaultItem<'_> {
    fn login(&self) -> SecretValue {
        let item = self.item;

        let website_url = item.primary_url();
        let username = item.login_field(OnePasswordCredential::Username);
        let password = if item.details.password.is_empty() {
            item.login_field(OnePasswordCredential::Password)
        } else {
            item.details.password.clone()
        };
        let mut notes = item.details.notes_plain.clone();
        let mut metadata = self.metadata(&OnePasswordMetadataRequest {
            primary_url: website_url.as_str(),
            policy: OnePasswordMetadataPolicy::OmitCredentials,
        });
        if let Some(title) = (SourceLabelMetadata {
            key: "title",
            label: &item.overview.title,
            website_url: website_url.as_str(),
        })
        .entry()
        {
            metadata.insert(0, title);
        }
        OnePasswordNotes { notes: &mut notes }.append(metadata);
        SecretValue::Login(LoginSecret {
            website_url,
            username,
            password,
            notes,
        })
    }
}
impl OnePasswordVaultItem<'_> {
    fn secure_note(&self) -> SecretValue {
        let item = self.item;

        let mut note = item.details.notes_plain.clone();
        OnePasswordNotes { notes: &mut note }.append(self.metadata(&OnePasswordMetadataRequest {
            primary_url: "",
            policy: OnePasswordMetadataPolicy::AllFields,
        }));
        SecretValue::SecureNote(SecureNoteSecret {
            title: item.overview.title.trim().to_owned(),
            note,
        })
    }
}
impl OnePasswordVaultItem<'_> {
    fn credit_card(&self) -> Option<SecretValue> {
        let item = self.item;

        let cardholder = OnePasswordSections {
            sections: &item.details.sections,
        }
        .credential(&["cardholder", "cardholder name", "name on card"]);
        let number = OnePasswordSections {
            sections: &item.details.sections,
        }
        .credential(&["number", "card number", "credit card number", "ccnum"]);
        let expiry = OnePasswordSections {
            sections: &item.details.sections,
        }
        .credential(&[
            "expiry",
            "expires",
            "expiration",
            "expiry date",
            "valid thru",
        ]);
        let (expiration_month, expiration_year) = OnePasswordExpiry { raw: &expiry }.month_year();
        let cvv = OnePasswordSections {
            sections: &item.details.sections,
        }
        .credential(&["cvv", "cvc", "security code", "verification number"]);
        let mut notes = item.details.notes_plain.clone();
        OnePasswordNotes { notes: &mut notes }.append(self.metadata(&OnePasswordMetadataRequest {
            primary_url: "",
            policy: OnePasswordMetadataPolicy::OmitCredentials,
        }));
        CreditCardSecret::from_fields(CreditCardFields {
            title: item.overview.title.trim(),
            cardholder_name: cardholder.trim(),
            number: number.trim(),
            expiration_month: expiration_month.trim(),
            expiration_year: expiration_year.trim(),
            cvv: cvv.trim(),
            notes: &notes,
        })
        .ok()
        .map(SecretValue::CreditCard)
    }
}
impl OnePasswordVaultItem<'_> {
    fn item(&self) -> Option<SecretValue> {
        let item = self.item;

        match item.category_uuid.as_str() {
            LOGIN_CATEGORY_UUID | PASSWORD_CATEGORY_UUID => Some(self.login()),
            SECURE_NOTE_CATEGORY_UUID => Some(self.secure_note()),
            CREDIT_CARD_CATEGORY_UUID => self.credit_card(),
            _ => None,
        }
    }
}
struct OnePasswordExpiry<'a> {
    raw: &'a str,
}
impl OnePasswordExpiry<'_> {
    fn month_year(&self) -> (String, String) {
        let digits: String = self.raw.chars().filter(char::is_ascii_digit).collect();
        if digits.len() == 6 {
            return (digits[4..6].to_owned(), digits[..4].to_owned());
        }
        if let Some((month, year)) = self.raw.split_once(['/', '-']) {
            return (month.trim().to_owned(), year.trim().to_owned());
        }
        (String::new(), String::new())
    }
}
impl ExportData {
    pub(super) fn parse(json: &str) -> Result<Self, OnePasswordImportError> {
        serde_json::from_str(json).map_err(OnePasswordImportError::InvalidData)
    }
    #[must_use]
    pub(super) fn plan(self) -> OnePasswordImportPlan {
        let mut source_count = 0;
        let mut items = Vec::new();
        for account in self.accounts {
            for vault in account.vaults {
                let vault_name = vault.attrs.name;
                source_count += vault.items.len();
                items.extend(vault.items.into_iter().filter_map(|item| {
                    let item = item.into_item();
                    OnePasswordVaultItem {
                        item: &item,
                        vault_name: &vault_name,
                    }
                    .item()
                }));
            }
        }
        let skipped_unsupported = source_count.saturating_sub(items.len());
        OnePasswordImportPlan {
            items,
            source_count: source_count.into(),
            skipped_unsupported: skipped_unsupported.into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{ExportData, OnePasswordExpiry, OnePasswordFieldValue};
    use crate::SecretValue;

    #[test]
    fn dynamic_fields_preserve_wrapper_precedence_and_recursive_values() -> anyhow::Result<()> {
        for (json, expected) in [
            (
                r#"{"string":"second","concealed":"  first  "}"#,
                Some("  first  "),
            ),
            (r#"{"concealed":" ","string":"second"}"#, Some("second")),
            (
                r#"[null," ",false,7,{"email":"alice"}]"#,
                Some("false, 7, alice"),
            ),
            (r#"{"unknown":"value"}"#, Some(r#"{"unknown":"value"}"#)),
            ("null", None),
            ("[]", None),
        ] {
            let value = serde_json::from_str(json)?;
            assert_eq!(
                OnePasswordFieldValue { value: &value }.text().as_deref(),
                expected
            );
        }
        Ok(())
    }

    #[test]
    fn explicit_password_and_designation_preserve_exact_bytes() -> anyhow::Result<()> {
        let data = r#"{"accounts":[{"vaults":[{"attrs":{"name":"Vault"},"items":[{"categoryUuid":"001","overview":{"title":"Title","url":" https://example.com "},"details":{"password":"  sécret 🔑  ","loginFields":[{"name":"username","value":"fallback"},{"designation":"USERNAME","value":"  alice  "},{"designation":"password","value":"ignored"}],"sections":[{"fields":[{"title":"Password","value":"section"},{"title":"PIN","value":"1234"}]}]}}]}]}]}"#;
        let plan = ExportData::parse(data)?.plan();
        let [SecretValue::Login(login)] = plan.items.as_slice() else {
            anyhow::bail!("expected one login")
        };
        assert_eq!(login.username, "  alice  ");
        assert_eq!(login.password, "  sécret 🔑  ");
        assert_eq!(login.website_url, "https://example.com");
        assert_eq!(
            login.notes,
            "## 1Password\n- format: 1PUX\n- title: Title\n- vault: Vault\n- PIN: 1234"
        );
        Ok(())
    }

    #[test]
    fn empty_designated_value_uses_section_instead_of_later_login_field() -> anyhow::Result<()> {
        let data = r#"{"accounts":[{"vaults":[{"items":[{"categoryUuid":"001","details":{"loginFields":[{"designation":"username","value":""},{"name":"username","value":"later"}],"sections":[{"fields":[{"id":"username","value":"section"}]}]}}]}]}]}"#;
        let plan = ExportData::parse(data)?.plan();
        let [SecretValue::Login(login)] = plan.items.as_slice() else {
            anyhow::bail!("expected one login")
        };
        assert_eq!(login.username, "section");
        Ok(())
    }

    #[test]
    fn expiry_keeps_six_digit_and_delimited_interpretation() {
        for (raw, month, year) in [
            ("203012", "12", "2030"),
            ("12/30", "12", "30"),
            (" 12 - 30 ", "12", "30"),
            ("invalid", "", ""),
        ] {
            assert_eq!(
                OnePasswordExpiry { raw }.month_year(),
                (month.to_owned(), year.to_owned())
            );
        }
    }
}

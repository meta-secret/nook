#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! Bitwarden plaintext items, nullable text and ordered metadata conversion.
use super::super::import_support::{ImportMetadata, SourceLabelMetadata};
use super::{BitwardenImportError, BitwardenImportPlan};
use crate::CreditCardFields;
use crate::{CreditCardSecret, LoginSecret, SecretValue, SecureNoteSecret};
use serde::Deserialize;
use serde_json::Value;
use std::ops::Deref;
#[derive(Debug, Default, Deserialize)]
#[serde(from = "Option<String>")]
struct BitwardenText(String);
impl From<Option<String>> for BitwardenText {
    fn from(value: Option<String>) -> Self {
        Self(value.unwrap_or_default())
    }
}
impl Deref for BitwardenText {
    type Target = str;
    fn deref(&self) -> &str {
        &self.0
    }
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BitwardenItem {
    #[serde(rename = "type")]
    item_type: u8,
    #[serde(default)]
    name: BitwardenText,
    #[serde(default)]
    notes: BitwardenText,
    #[serde(default)]
    fields: Vec<BitwardenField>,
    login: Option<BitwardenLogin>,
    card: Option<BitwardenCard>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BitwardenCard {
    #[serde(default)]
    cardholder_name: BitwardenText,
    #[serde(default)]
    brand: BitwardenText,
    #[serde(default)]
    number: BitwardenText,
    #[serde(default)]
    exp_month: BitwardenText,
    #[serde(default)]
    exp_year: BitwardenText,
    #[serde(default)]
    code: BitwardenText,
}

#[derive(Debug, Deserialize)]
struct BitwardenLogin {
    #[serde(default)]
    username: BitwardenText,
    #[serde(default)]
    password: BitwardenText,
    #[serde(default)]
    totp: BitwardenText,
    #[serde(default)]
    uris: Vec<BitwardenUri>,
}

#[derive(Debug, Deserialize)]
struct BitwardenField {
    #[serde(default)]
    name: BitwardenText,
    #[serde(default)]
    value: BitwardenText,
}

#[derive(Debug, Deserialize)]
struct BitwardenUri {
    #[serde(default)]
    uri: BitwardenText,
}

pub(super) struct BitwardenItems {
    items: Vec<BitwardenItem>,
}
impl BitwardenItems {
    pub(super) fn parse(value: &Value) -> Result<Self, BitwardenImportError> {
        let items = value
            .get("items")
            .ok_or(BitwardenImportError::InvalidResponse)?;
        Ok(Self {
            items: serde_json::from_value(items.clone())?,
        })
    }
    #[must_use]
    pub(super) fn plan(self) -> BitwardenImportPlan {
        let source_count = self.items.len();
        let converted = self
            .items
            .into_iter()
            .filter_map(BitwardenItem::convert)
            .collect::<Vec<_>>();
        let skipped_unsupported = source_count.saturating_sub(converted.len());
        BitwardenImportPlan {
            items: converted,
            source_count: source_count.into(),
            skipped_unsupported: skipped_unsupported.into(),
        }
    }
}
impl BitwardenItem {
    fn login(self) -> Option<SecretValue> {
        let login = self.login?;
        let uris = login
            .uris
            .into_iter()
            .map(|entry| entry.uri.trim().to_owned())
            .filter(|uri| !uri.is_empty())
            .collect::<Vec<_>>();
        let website_url = uris
            .first()
            .cloned()
            .unwrap_or_else(|| self.name.trim().to_owned());
        let mut metadata = Vec::new();
        if let Some(name) = (SourceLabelMetadata {
            key: "name",
            label: &self.name,
            website_url: &website_url,
        })
        .entry()
        {
            metadata.push(name);
        }
        metadata.push(("totp".to_owned(), login.totp.0));
        metadata.extend(
            uris.into_iter()
                .skip(1)
                .enumerate()
                .map(|(index, uri)| (format!("uri[{}]", index + 2), uri)),
        );
        metadata.extend(
            BitwardenFields {
                fields: self.fields,
            }
            .metadata(),
        );
        let mut notes = self.notes.0;
        BitwardenNotes { notes: &mut notes }.append(metadata);

        Some(SecretValue::Login(LoginSecret {
            website_url: website_url.trim().to_owned(),
            username: login.username.0,
            password: login.password.0,
            notes,
        }))
    }
}
impl BitwardenItem {
    fn card(self) -> Option<SecretValue> {
        let card = self.card?;
        let mut notes = self.notes.0;
        let mut metadata = BitwardenFields {
            fields: self.fields,
        }
        .metadata();
        if !card.brand.trim().is_empty() {
            metadata.insert(0, ("brand".to_owned(), card.brand.0));
        }
        BitwardenNotes { notes: &mut notes }.append(metadata);
        CreditCardSecret::from_fields(CreditCardFields {
            title: self.name.trim(),
            cardholder_name: card.cardholder_name.trim(),
            number: card.number.trim(),
            expiration_month: card.exp_month.trim(),
            expiration_year: card.exp_year.trim(),
            cvv: card.code.trim(),
            notes: &notes,
        })
        .ok()
        .map(SecretValue::CreditCard)
    }
}
impl BitwardenItem {
    fn convert(self) -> Option<SecretValue> {
        match self.item_type {
            1 => self.login(),
            2 => {
                let mut notes = self.notes.0;
                BitwardenNotes { notes: &mut notes }.append(
                    BitwardenFields {
                        fields: self.fields,
                    }
                    .metadata(),
                );
                Some(SecretValue::SecureNote(SecureNoteSecret {
                    title: self.name.trim().to_owned(),
                    note: notes,
                }))
            }
            3 => self.card(),
            _ => None,
        }
    }
}
struct BitwardenFields {
    fields: Vec<BitwardenField>,
}
impl BitwardenFields {
    fn metadata(self) -> Vec<(String, String)> {
        self.fields
            .into_iter()
            .enumerate()
            .map(|(index, field)| {
                let name = field.name.trim();
                let key = if name.is_empty() {
                    format!("field[{}]", index + 1)
                } else {
                    format!("field.{name}")
                };
                (key, field.value.0)
            })
            .collect()
    }
}
struct BitwardenNotes<'a> {
    notes: &'a mut String,
}
impl BitwardenNotes<'_> {
    fn append(self, metadata: impl IntoIterator<Item = (String, String)>) {
        ImportMetadata {
            heading: "Bitwarden",
            entries: metadata,
        }
        .append_to(self.notes);
    }
}

#[cfg(test)]
mod tests {
    use super::{BitwardenItems, BitwardenText};
    use crate::SecretValue;

    #[test]
    fn nullable_text_preserves_exact_strings_and_rejects_other_shapes() -> anyhow::Result<()> {
        assert_eq!(serde_json::from_str::<BitwardenText>("null")?.0, "");
        assert_eq!(
            serde_json::from_str::<BitwardenText>(r#""  sécret 🔑  ""#)?.0,
            "  sécret 🔑  "
        );
        for json in ["false", "42", "[]", "{}"] {
            assert!(serde_json::from_str::<BitwardenText>(json).is_err());
        }
        Ok(())
    }

    #[test]
    fn login_conversion_keeps_credential_bytes_and_trimmed_url() -> anyhow::Result<()> {
        let json = r#"{"items":[{"type":1,"name":"Title","login":{"username":"  alice  ","password":"  sécret 🔑  ","uris":[{"uri":"  https://example.com  "}]}}]}"#;
        let plan = BitwardenItems::parse(&serde_json::from_str(json)?)?.plan();
        let [SecretValue::Login(login)] = plan.items.as_slice() else {
            anyhow::bail!("expected one login")
        };
        assert_eq!(login.username, "  alice  ");
        assert_eq!(login.password, "  sécret 🔑  ");
        assert_eq!(login.website_url, "https://example.com");
        assert_eq!(login.notes, "## Bitwarden\n- name: Title");
        Ok(())
    }
}

//! Rust-owned "This site" listing for the extension side panel.
//!
//! Each paired vault reports the site-bound secrets it matched to the active
//! tab's site as display-only [`SiteSecretItem`]s (the vault bridge projects
//! them from authenticated catalog metadata; no password, TOTP seed, key, or
//! passkey private data ever enters this contract). The service worker passes
//! every vault's matches here with the page need the tab's content script
//! reported. Rust presents one section per identity:vault, filters each
//! vault's matches by the kinds the page needs, orders sections and rows, and
//! selects every translation key the panel shows, so TypeScript only renders
//! the result.

mod page_need;
mod row_presentation;
mod sections;

pub use page_need::SitePageNeed;

use nook_auth2::{SecretId, StoreId};
use sections::SiteSecretSectionGrouping;
use serde::{Deserialize, Serialize};
use tsify::Tsify;
use wasm_bindgen::prelude::wasm_bindgen;

/// Site-bound secret kinds. Declaration order is the row order inside a
/// section. Credit cards, notes, seed phrases, and files are not bound to a
/// site and never appear in this listing.
#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum SiteSecretKind {
    Login,
    Authenticator,
    Passkey,
    ApiKey,
}

/// Row title: a login's or API key's saved host, an authenticator's issuer,
/// or a passkey's relying-party name.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify, derive_more::From)]
#[serde(transparent)]
pub struct SiteSecretTitle(String);

/// Account shown under the title; empty when the item names no account.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify, derive_more::From)]
#[serde(transparent)]
pub struct SiteSecretAccount(String);

/// Normalized host the item is saved for.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify, derive_more::From)]
#[serde(transparent)]
pub struct SiteSecretSavedHost(String);

/// Vault name from the pairing grant; empty for an unnamed vault.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify, derive_more::From)]
#[serde(transparent)]
pub struct SiteSecretVaultName(String);

/// Identity name from the pairing grant; empty for grants paired before the
/// extension recorded identities.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify, derive_more::From)]
#[serde(transparent)]
pub struct SiteSecretIdentityName(String);

/// The extension's app key for the identity, as the pairing grant records it.
/// It only tells identities apart while sections are ordered; the listing
/// never carries it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify, derive_more::From)]
#[serde(transparent)]
pub struct SiteSecretIdentityDevice(String);

/// Key into the shared translation catalogs, selected by Rust.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Tsify)]
#[serde(transparent)]
pub struct SiteSecretMessageKey(String);

impl SiteSecretMessageKey {
    fn catalog(key: &'static str) -> Self {
        Self(key.to_owned())
    }
}

/// One site-bound secret a vault matched to the site, without secret material.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(deny_unknown_fields)]
pub struct SiteSecretItem {
    #[tsify(type = "keyof typeof SiteSecretKind")]
    pub kind: SiteSecretKind,
    pub secret_id: SecretId,
    pub title: SiteSecretTitle,
    pub account: SiteSecretAccount,
    pub saved_host: SiteSecretSavedHost,
}

/// Every site-bound secret one vault matched to the site.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(deny_unknown_fields)]
pub struct SiteSecretMatches {
    pub items: Vec<SiteSecretItem>,
}

/// The identity a paired vault belongs to.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(deny_unknown_fields)]
pub struct SiteSecretIdentity {
    pub device_id: SiteSecretIdentityDevice,
    pub name: SiteSecretIdentityName,
}

/// One paired vault's grant labels with the matches its session returned.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(deny_unknown_fields)]
pub struct SiteSecretVault {
    pub vault_store_id: StoreId,
    pub vault_name: SiteSecretVaultName,
    pub identity: SiteSecretIdentity,
    pub matches: SiteSecretMatches,
}

/// Every paired vault's matches, in pairing-grant order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(deny_unknown_fields)]
pub struct SiteSecretVaults {
    pub vaults: Vec<SiteSecretVault>,
}

/// What the side panel shows for the active tab's site: one section per
/// paired vault in Rust's order, and whether any section lists a row.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Tsify)]
pub struct SiteSecretListing {
    pub summary: SiteSecretListingSummary,
    pub sections: Vec<SiteSecretSection>,
}

/// Whether any section lists a row the page needs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Tsify)]
#[serde(tag = "kind")]
pub enum SiteSecretListingSummary {
    /// At least one section lists a row.
    Listed,
    /// No section lists a row the page needs. `message_key` takes a `{host}`
    /// replacement with the tab's display host; the panel shows it above the
    /// sections.
    Empty {
        message_key: SiteSecretMessageKey,
        hint: SiteSecretEmptyHint,
    },
}

/// Guidance shown under the empty listing message.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Tsify)]
#[serde(tag = "kind")]
pub enum SiteSecretEmptyHint {
    Shown { message_key: SiteSecretMessageKey },
    Absent,
}

/// One paired vault under its identity. The header shows the identity label
/// and the vault label; `vault_store_id` names the vault the rows come from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Tsify)]
pub struct SiteSecretSection {
    pub vault_store_id: StoreId,
    pub identity: SiteSecretIdentityHeader,
    pub vault: SiteSecretVaultLabel,
    pub content: SiteSecretSectionContent,
}

/// A section's rows, or the line shown when its vault has none the page needs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Tsify)]
#[serde(tag = "kind")]
pub enum SiteSecretSectionContent {
    /// The vault's rows the page needs, sorted by kind, title, then account.
    Listed { rows: Vec<SiteSecretRow> },
    /// The vault holds nothing the page needs for this site.
    Empty { message_key: SiteSecretMessageKey },
}

/// Identity label of a section header: the saved name, or the catalog's
/// unnamed label.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Tsify)]
#[serde(tag = "kind")]
pub enum SiteSecretIdentityHeader {
    Named { name: SiteSecretIdentityName },
    Unnamed { message_key: SiteSecretMessageKey },
}

/// Vault label of a section header: the saved name, or the catalog's unnamed
/// label.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Tsify)]
#[serde(tag = "kind")]
pub enum SiteSecretVaultLabel {
    Named { name: SiteSecretVaultName },
    Unnamed { message_key: SiteSecretMessageKey },
}

/// Opaque lookup key of one listed item; never authority.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Tsify)]
pub struct SiteSecretItemId {
    pub vault_store_id: StoreId,
    pub secret_id: SecretId,
}

/// The one action a row offers. Both fill labels take `{login}` and `{vault}`
/// replacements in their accessible label; `{vault}` is the vault label of the
/// row's section.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Tsify)]
#[serde(tag = "kind")]
pub enum SiteSecretAction {
    /// Fill the saved login into the page.
    FillLogin(SiteSecretActionLabels),
    /// Fill the authenticator's current code into the page's code field.
    FillCode(SiteSecretActionLabels),
    /// Passkeys and API keys are shown for reference only.
    ViewOnly,
}

/// Button text and accessible label keys of a row action.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Tsify)]
pub struct SiteSecretActionLabels {
    pub label_key: SiteSecretMessageKey,
    pub accessible_label_key: SiteSecretMessageKey,
}

/// One display row. It carries no secret material; its section names the
/// identity and vault.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Tsify)]
pub struct SiteSecretRow {
    #[tsify(type = "keyof typeof SiteSecretKind")]
    pub kind: SiteSecretKind,
    pub item_id: SiteSecretItemId,
    pub type_label_key: SiteSecretMessageKey,
    pub title: SiteSecretTitle,
    pub account: SiteSecretAccount,
    pub saved_host: SiteSecretSavedHost,
    pub action: SiteSecretAction,
}

/// Every vault's matches and the page need that filters them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SiteSecretListingRequest {
    pub page_need: SitePageNeed,
    pub vaults: SiteSecretVaults,
}

impl SiteSecretListingRequest {
    /// Presents one section per vault, with the vault's matches filtered by the
    /// page need, ordered by identity.
    #[must_use]
    pub fn present(self) -> SiteSecretListing {
        let Self { page_need, vaults } = self;
        vaults
            .vaults
            .into_iter()
            .map(|vault| vault.section(page_need))
            .fold(
                SiteSecretSectionGrouping::default(),
                SiteSecretSectionGrouping::with_section,
            )
            .listing(page_need)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nook_app_common::i18n_keys;

    /// One site-bound item saved for namecheap.com under account "bynull".
    struct ItemFixture {
        kind: SiteSecretKind,
        id: &'static str,
        title: &'static str,
    }

    /// One paired vault and the items its session matched.
    struct VaultFixture {
        store: &'static str,
        vault_name: &'static str,
        device: &'static str,
        identity: &'static str,
        items: Vec<ItemFixture>,
    }

    /// Fixture vaults, in grant order, presented for one page need.
    struct ListingScenario {
        page_need: SitePageNeed,
        vaults: Vec<VaultFixture>,
    }

    /// A string the encoded listing holds at a JSON pointer.
    struct WireField {
        pointer: String,
        value: &'static str,
    }

    impl ItemFixture {
        fn item(&self) -> SiteSecretItem {
            SiteSecretItem {
                kind: self.kind,
                secret_id: SecretId::from_vault_record(self.id),
                title: SiteSecretTitle::from(self.title.to_owned()),
                account: SiteSecretAccount::from("bynull".to_owned()),
                saved_host: SiteSecretSavedHost::from("namecheap.com".to_owned()),
            }
        }
    }

    impl VaultFixture {
        fn vault(&self) -> anyhow::Result<SiteSecretVault> {
            Ok(SiteSecretVault {
                vault_store_id: StoreId::parse(self.store)?,
                vault_name: SiteSecretVaultName::from(self.vault_name.to_owned()),
                identity: SiteSecretIdentity {
                    device_id: SiteSecretIdentityDevice::from(self.device.to_owned()),
                    name: SiteSecretIdentityName::from(self.identity.to_owned()),
                },
                matches: SiteSecretMatches {
                    items: self.items.iter().map(ItemFixture::item).collect(),
                },
            })
        }

        /// The personal vault with only a Namecheap login.
        fn personal_login() -> Self {
            Self {
                store: "store_SMypl8K0w9a",
                vault_name: "bynull",
                device: "device-personal",
                identity: "Personal",
                items: vec![ItemFixture {
                    kind: SiteSecretKind::Login,
                    id: "secret_personal_login",
                    title: "namecheap.com",
                }],
            }
        }

        /// The reported Namecheap case: a login and an authenticator in the
        /// personal vault, and the same in vault "www" of the work identity,
        /// plus a passkey and an API key so every kind is present.
        fn namecheap() -> Vec<Self> {
            let personal = Self {
                items: vec![
                    ItemFixture {
                        kind: SiteSecretKind::ApiKey,
                        id: "secret_personal_api",
                        title: "namecheap.com",
                    },
                    ItemFixture {
                        kind: SiteSecretKind::Authenticator,
                        id: "secret_personal_totp",
                        title: "Namecheap",
                    },
                    ItemFixture {
                        kind: SiteSecretKind::Login,
                        id: "secret_personal_login",
                        title: "namecheap.com",
                    },
                ],
                ..Self::personal_login()
            };
            let work = Self {
                store: "store_SMypl8K0w9b",
                vault_name: "www",
                device: "device-work",
                identity: "work",
                items: vec![
                    ItemFixture {
                        kind: SiteSecretKind::Passkey,
                        id: "secret_work_passkey",
                        title: "Namecheap",
                    },
                    ItemFixture {
                        kind: SiteSecretKind::Login,
                        id: "secret_work_login",
                        title: "namecheap.com",
                    },
                    ItemFixture {
                        kind: SiteSecretKind::Authenticator,
                        id: "secret_work_totp",
                        title: "Namecheap",
                    },
                ],
            };
            vec![personal, work]
        }
    }

    impl ListingScenario {
        fn present(&self) -> anyhow::Result<SiteSecretListing> {
            let vaults = self
                .vaults
                .iter()
                .map(VaultFixture::vault)
                .collect::<anyhow::Result<_>>()?;
            Ok(SiteSecretListingRequest {
                page_need: self.page_need,
                vaults: SiteSecretVaults { vaults },
            }
            .present())
        }

        /// The presented sections of a listing that lists at least one row.
        fn listed_sections(&self) -> anyhow::Result<Vec<SiteSecretSection>> {
            let SiteSecretListing { summary, sections } = self.present()?;
            let SiteSecretListingSummary::Listed = summary else {
                anyhow::bail!("expected a listed summary, got {summary:?}");
            };
            Ok(sections)
        }

        /// Every listed row, section by section.
        fn listed_rows(&self) -> anyhow::Result<Vec<SiteSecretRow>> {
            Ok(self
                .listed_sections()?
                .into_iter()
                .flat_map(|section| match section.content {
                    SiteSecretSectionContent::Listed { rows } => rows,
                    SiteSecretSectionContent::Empty { .. } => Vec::new(),
                })
                .collect())
        }
    }

    impl WireField {
        fn assert_in(&self, json: &serde_json::Value) {
            assert_eq!(
                json.pointer(&self.pointer)
                    .and_then(serde_json::Value::as_str),
                Some(self.value),
                "{}",
                self.pointer
            );
        }
    }

    #[test]
    fn unrecognized_page_lists_every_kind_in_one_section_per_vault() -> anyhow::Result<()> {
        let sections = ListingScenario {
            page_need: SitePageNeed::AnySiteSecret,
            vaults: VaultFixture::namecheap(),
        }
        .listed_sections()?;
        let [personal, work] = sections.as_slice() else {
            anyhow::bail!("expected one section per vault, got {sections:?}");
        };
        assert_eq!(
            personal.vault_store_id,
            StoreId::parse("store_SMypl8K0w9a")?
        );
        assert_eq!(
            personal.identity,
            SiteSecretIdentityHeader::Named {
                name: SiteSecretIdentityName::from("Personal".to_owned()),
            }
        );
        assert_eq!(
            personal.vault,
            SiteSecretVaultLabel::Named {
                name: SiteSecretVaultName::from("bynull".to_owned()),
            }
        );
        let SiteSecretSectionContent::Listed {
            rows: personal_rows,
        } = &personal.content
        else {
            anyhow::bail!("expected personal rows, got {:?}", personal.content);
        };
        assert_eq!(
            personal_rows
                .iter()
                .map(|row| row.item_id.secret_id.clone())
                .collect::<Vec<_>>(),
            [
                "secret_personal_login",
                "secret_personal_totp",
                "secret_personal_api"
            ]
            .map(SecretId::from_vault_record)
        );
        for row in personal_rows {
            assert_eq!(row.item_id.vault_store_id, personal.vault_store_id);
        }
        assert_eq!(work.vault_store_id, StoreId::parse("store_SMypl8K0w9b")?);
        let SiteSecretSectionContent::Listed { rows: work_rows } = &work.content else {
            anyhow::bail!("expected work rows, got {:?}", work.content);
        };
        assert_eq!(
            work_rows.iter().map(|row| row.kind).collect::<Vec<_>>(),
            [
                SiteSecretKind::Login,
                SiteSecretKind::Authenticator,
                SiteSecretKind::Passkey
            ]
        );
        Ok(())
    }

    #[test]
    fn one_time_code_page_lists_only_authenticators() -> anyhow::Result<()> {
        let rows = ListingScenario {
            page_need: SitePageNeed::OneTimeCode,
            vaults: VaultFixture::namecheap(),
        }
        .listed_rows()?;
        assert_eq!(rows.len(), 2);
        for row in rows {
            assert_eq!(row.kind, SiteSecretKind::Authenticator);
            assert_eq!(
                row.type_label_key,
                SiteSecretMessageKey::catalog(i18n_keys::VAULT_TYPES_AUTHENTICATOR)
            );
            assert_eq!(
                row.action,
                SiteSecretAction::FillCode(SiteSecretActionLabels {
                    label_key: SiteSecretMessageKey::catalog(i18n_keys::EXTENSION_ACTION_FILL_CODE),
                    accessible_label_key: SiteSecretMessageKey::catalog(
                        i18n_keys::EXTENSION_ACTION_FILL_CODE_FOR
                    ),
                })
            );
        }
        Ok(())
    }

    #[test]
    fn credentials_page_lists_only_logins_with_fill() -> anyhow::Result<()> {
        let rows = ListingScenario {
            page_need: SitePageNeed::Credentials,
            vaults: VaultFixture::namecheap(),
        }
        .listed_rows()?;
        assert_eq!(rows.len(), 2);
        for row in rows {
            assert_eq!(row.kind, SiteSecretKind::Login);
            assert_eq!(
                row.action,
                SiteSecretAction::FillLogin(SiteSecretActionLabels {
                    label_key: SiteSecretMessageKey::catalog(i18n_keys::EXTENSION_ACTION_FILL),
                    accessible_label_key: SiteSecretMessageKey::catalog(
                        i18n_keys::EXTENSION_ACTION_FILL_LOGIN
                    ),
                })
            );
        }
        Ok(())
    }

    #[test]
    fn listing_without_rows_names_the_page_need_beside_every_section() -> anyhow::Result<()> {
        let save_hint = SiteSecretEmptyHint::Shown {
            message_key: SiteSecretMessageKey::catalog(i18n_keys::EXTENSION_ACTION_SITE_EMPTY_HINT),
        };
        assert_eq!(
            ListingScenario {
                page_need: SitePageNeed::OneTimeCode,
                vaults: vec![VaultFixture::personal_login()],
            }
            .present()?,
            SiteSecretListing {
                summary: SiteSecretListingSummary::Empty {
                    message_key: SiteSecretMessageKey::catalog(
                        i18n_keys::EXTENSION_ACTION_SITE_EMPTY_TOTP
                    ),
                    hint: SiteSecretEmptyHint::Absent,
                },
                sections: vec![SiteSecretSection {
                    vault_store_id: StoreId::parse("store_SMypl8K0w9a")?,
                    identity: SiteSecretIdentityHeader::Named {
                        name: SiteSecretIdentityName::from("Personal".to_owned()),
                    },
                    vault: SiteSecretVaultLabel::Named {
                        name: SiteSecretVaultName::from("bynull".to_owned()),
                    },
                    content: SiteSecretSectionContent::Empty {
                        message_key: SiteSecretMessageKey::catalog(
                            i18n_keys::EXTENSION_ACTION_SITE_VAULT_EMPTY
                        ),
                    },
                }],
            }
        );
        assert_eq!(
            ListingScenario {
                page_need: SitePageNeed::Credentials,
                vaults: vec![],
            }
            .present()?,
            SiteSecretListing {
                summary: SiteSecretListingSummary::Empty {
                    message_key: SiteSecretMessageKey::catalog(
                        i18n_keys::EXTENSION_ACTION_SITE_EMPTY
                    ),
                    hint: save_hint.clone(),
                },
                sections: vec![],
            }
        );
        assert_eq!(
            ListingScenario {
                page_need: SitePageNeed::AnySiteSecret,
                vaults: vec![],
            }
            .present()?
            .summary,
            SiteSecretListingSummary::Empty {
                message_key: SiteSecretMessageKey::catalog(
                    i18n_keys::EXTENSION_ACTION_SITE_EMPTY_ANY
                ),
                hint: save_hint,
            }
        );
        Ok(())
    }

    #[test]
    fn vault_matches_decode_strictly_and_project_no_secret_fields() -> anyhow::Result<()> {
        let decoded: SiteSecretMatches = serde_json::from_str(
            r#"{"items":[{"kind":"Authenticator","secret_id":"secret_SMypl8K0w9a","title":"Namecheap","account":"bynull","saved_host":"namecheap.com"}]}"#,
        )?;
        assert_eq!(decoded.items.len(), 1);
        for rejected in [
            r#"{"items":[{"kind":"Authenticator","secret_id":"secret_SMypl8K0w9a","title":"Namecheap","account":"bynull","saved_host":"namecheap.com","secret":"JBSWY3DPEHPK3PXP"}]}"#,
            r#"{"items":[{"kind":"CreditCard","secret_id":"secret_SMypl8K0w9a","title":"Card","account":"","saved_host":""}]}"#,
            r#"{"items":[{"kind":"Login","secret_id":"","title":"x","account":"","saved_host":"x"}]}"#,
        ] {
            assert!(serde_json::from_str::<SiteSecretMatches>(rejected).is_err());
        }
        Ok(())
    }

    #[test]
    fn listed_wire_tags_sections_and_rows_without_vault_or_device() -> anyhow::Result<()> {
        let listing = ListingScenario {
            page_need: SitePageNeed::OneTimeCode,
            vaults: VaultFixture::namecheap(),
        }
        .present()?;
        let json = serde_json::to_value(&listing)?;
        let section = "/sections/0";
        let row = "/sections/0/content/rows/0";
        for expected in [
            WireField {
                pointer: "/summary/kind".to_owned(),
                value: "Listed",
            },
            WireField {
                pointer: format!("{section}/vault_store_id"),
                value: "store_SMypl8K0w9a",
            },
            WireField {
                pointer: format!("{section}/identity/kind"),
                value: "Named",
            },
            WireField {
                pointer: format!("{section}/identity/name"),
                value: "Personal",
            },
            WireField {
                pointer: format!("{section}/vault/kind"),
                value: "Named",
            },
            WireField {
                pointer: format!("{section}/vault/name"),
                value: "bynull",
            },
            WireField {
                pointer: format!("{section}/content/kind"),
                value: "Listed",
            },
            WireField {
                pointer: format!("{row}/kind"),
                value: "Authenticator",
            },
            WireField {
                pointer: format!("{row}/item_id/vault_store_id"),
                value: "store_SMypl8K0w9a",
            },
            WireField {
                pointer: format!("{row}/item_id/secret_id"),
                value: "secret_personal_totp",
            },
            WireField {
                pointer: format!("{row}/type_label_key"),
                value: i18n_keys::VAULT_TYPES_AUTHENTICATOR,
            },
            WireField {
                pointer: format!("{row}/title"),
                value: "Namecheap",
            },
            WireField {
                pointer: format!("{row}/account"),
                value: "bynull",
            },
            WireField {
                pointer: format!("{row}/saved_host"),
                value: "namecheap.com",
            },
            WireField {
                pointer: format!("{row}/action/kind"),
                value: "FillCode",
            },
            WireField {
                pointer: format!("{row}/action/label_key"),
                value: i18n_keys::EXTENSION_ACTION_FILL_CODE,
            },
        ] {
            expected.assert_in(&json);
        }
        for absent in [
            format!("{row}/vault"),
            format!("{section}/identity/device_id"),
            "/summary/message_key".to_owned(),
        ] {
            assert_eq!(json.pointer(&absent), None, "{absent}");
        }
        let encoded = serde_json::to_string(&listing)?;
        for device in ["device_id", "device-personal", "device-work"] {
            assert!(!encoded.contains(device), "{device}");
        }
        Ok(())
    }

    #[test]
    fn empty_wire_tags_the_summary_and_the_section_line() -> anyhow::Result<()> {
        let json = serde_json::to_value(
            ListingScenario {
                page_need: SitePageNeed::OneTimeCode,
                vaults: vec![VaultFixture::personal_login()],
            }
            .present()?,
        )?;
        for expected in [
            WireField {
                pointer: "/summary/kind".to_owned(),
                value: "Empty",
            },
            WireField {
                pointer: "/summary/message_key".to_owned(),
                value: i18n_keys::EXTENSION_ACTION_SITE_EMPTY_TOTP,
            },
            WireField {
                pointer: "/summary/hint/kind".to_owned(),
                value: "Absent",
            },
            WireField {
                pointer: "/sections/0/content/kind".to_owned(),
                value: "Empty",
            },
            WireField {
                pointer: "/sections/0/content/message_key".to_owned(),
                value: i18n_keys::EXTENSION_ACTION_SITE_VAULT_EMPTY,
            },
        ] {
            expected.assert_in(&json);
        }
        Ok(())
    }
}

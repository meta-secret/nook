//! Rust-owned "This site" listing for the extension side panel.
//!
//! Each paired vault reports the site-bound secrets it matched to the active
//! tab's site as display-only [`SiteSecretItem`]s (the vault bridge projects
//! them from authenticated catalog metadata; no password, TOTP seed, key, or
//! passkey private data ever enters this contract). The service worker passes
//! every vault's matches here with the page need the tab's content script
//! reported. Rust filters the kinds the page needs, groups rows under identity
//! headers in a fixed order, and selects every translation key the panel shows,
//! so TypeScript only renders the result.

mod page_need;
mod row_presentation;

pub use page_need::SitePageNeed;

use nook_auth2::{SecretId, StoreId};
use page_need::SiteSecretRelevance;
use row_presentation::SiteSecretNaming;
use serde::{Deserialize, Serialize};
use tsify::Tsify;
use wasm_bindgen::prelude::wasm_bindgen;

/// Site-bound secret kinds. Declaration order is the row order inside an
/// identity group. Credit cards, notes, seed phrases, and files are not bound
/// to a site and never appear in this listing.
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

/// What the side panel shows for the active tab's site.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Tsify)]
#[serde(tag = "kind")]
pub enum SiteSecretListing {
    /// At least one row the page needs, under identity headers in Rust's order.
    Listed {
        groups: Vec<SiteSecretIdentityGroup>,
    },
    /// Nothing the page needs is saved. `message_key` takes a `{host}`
    /// replacement with the tab's display host.
    Empty {
        message_key: SiteSecretMessageKey,
        hint: SiteSecretEmptyHint,
    },
}

/// Guidance shown under an empty listing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Tsify)]
#[serde(tag = "kind")]
pub enum SiteSecretEmptyHint {
    Shown { message_key: SiteSecretMessageKey },
    Absent,
}

/// Rows of one identity.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Tsify)]
pub struct SiteSecretIdentityGroup {
    pub header: SiteSecretIdentityHeader,
    pub rows: Vec<SiteSecretRow>,
}

/// Identity header text: the saved name, or the catalog's unnamed label.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Tsify)]
#[serde(tag = "kind")]
pub enum SiteSecretIdentityHeader {
    Named { name: SiteSecretIdentityName },
    Unnamed { message_key: SiteSecretMessageKey },
}

/// Vault label text: the saved name, or the catalog's unnamed label.
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
/// replacements in their accessible label.
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

/// One display row. It carries no secret material.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Tsify)]
pub struct SiteSecretRow {
    #[tsify(type = "keyof typeof SiteSecretKind")]
    pub kind: SiteSecretKind,
    pub item_id: SiteSecretItemId,
    pub type_label_key: SiteSecretMessageKey,
    pub title: SiteSecretTitle,
    pub account: SiteSecretAccount,
    pub saved_host: SiteSecretSavedHost,
    pub vault: SiteSecretVaultLabel,
    pub action: SiteSecretAction,
}

/// Every vault's matches and the page need that filters them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SiteSecretListingRequest {
    pub page_need: SitePageNeed,
    pub vaults: SiteSecretVaults,
}

impl SiteSecretTitle {
    fn sort_key(&self) -> String {
        let Self(title) = self;
        title.to_lowercase()
    }
}

impl SiteSecretAccount {
    fn sort_key(&self) -> String {
        let Self(account) = self;
        account.to_lowercase()
    }
}

/// Rows collected for one identity while vaults are folded in grant order.
struct SiteSecretGroupDraft {
    identity: SiteSecretIdentity,
    rows: Vec<SiteSecretRow>,
}

/// Identity groups in order of their first vault in the pairing grants.
#[derive(Default)]
struct SiteSecretGrouping {
    drafts: Vec<SiteSecretGroupDraft>,
}

impl SiteSecretVault {
    /// The vault's rows the page needs, in the vault's match order.
    fn rows(self, need: SitePageNeed) -> SiteSecretRowsDraft {
        let Self {
            vault_store_id,
            vault_name,
            identity,
            matches,
        } = self;
        let vault = SiteSecretVaultLabel::from(vault_name);
        let rows = matches
            .items
            .into_iter()
            .filter(|item| match item.kind.relevance(need) {
                SiteSecretRelevance::Relevant => true,
                SiteSecretRelevance::Hidden => false,
            })
            .map(|item| SiteSecretRow {
                kind: item.kind,
                item_id: SiteSecretItemId {
                    vault_store_id: vault_store_id.clone(),
                    secret_id: item.secret_id,
                },
                type_label_key: item.kind.type_label_key(),
                title: item.title,
                account: item.account,
                saved_host: item.saved_host,
                vault: vault.clone(),
                action: item.kind.action(),
            })
            .collect();
        SiteSecretRowsDraft { identity, rows }
    }
}

/// One vault's admitted rows with the identity they belong under.
struct SiteSecretRowsDraft {
    identity: SiteSecretIdentity,
    rows: Vec<SiteSecretRow>,
}

impl SiteSecretGrouping {
    #[must_use]
    fn with_rows(mut self, draft: SiteSecretRowsDraft) -> Self {
        let SiteSecretRowsDraft { identity, mut rows } = draft;
        let [_, ..] = rows.as_slice() else {
            return self;
        };
        match self
            .drafts
            .iter_mut()
            .find(|group| group.identity == identity)
        {
            Some(group) => group.rows.append(&mut rows),
            None => self.drafts.push(SiteSecretGroupDraft { identity, rows }),
        }
        self
    }

    /// Named identities keep their first-appearance order; grants without a
    /// recorded identity come last. Rows sort by kind, then by title, then by account.
    fn listing(self, need: SitePageNeed) -> SiteSecretListing {
        let (named, unnamed): (Vec<SiteSecretGroupDraft>, Vec<SiteSecretGroupDraft>) =
            self.drafts.into_iter().partition(|group| {
                let SiteSecretIdentityName(name) = &group.identity.name;
                match SiteSecretNaming::of(name) {
                    SiteSecretNaming::Named => true,
                    SiteSecretNaming::Unnamed => false,
                }
            });
        let groups: Vec<SiteSecretIdentityGroup> = named
            .into_iter()
            .chain(unnamed)
            .map(|group| {
                let SiteSecretGroupDraft { identity, mut rows } = group;
                rows.sort_by_cached_key(|row| SiteSecretRowOrder {
                    kind: row.kind,
                    title: row.title.sort_key(),
                    account: row.account.sort_key(),
                });
                SiteSecretIdentityGroup {
                    header: SiteSecretIdentityHeader::from(identity.name),
                    rows,
                }
            })
            .collect();
        match groups.as_slice() {
            [] => need.empty_listing(),
            [_, ..] => SiteSecretListing::Listed { groups },
        }
    }
}

/// Stable row sort key inside one identity group.
#[derive(PartialEq, Eq, PartialOrd, Ord)]
struct SiteSecretRowOrder {
    kind: SiteSecretKind,
    title: String,
    account: String,
}

impl SiteSecretListingRequest {
    /// Filters every vault's matches by the page need and groups them by identity.
    #[must_use]
    pub fn present(self) -> SiteSecretListing {
        let Self { page_need, vaults } = self;
        vaults
            .vaults
            .into_iter()
            .map(|vault| vault.rows(page_need))
            .fold(SiteSecretGrouping::default(), SiteSecretGrouping::with_rows)
            .listing(page_need)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nook_app_common::i18n_keys;

    struct ItemFixture {
        kind: SiteSecretKind,
        id: &'static str,
        title: &'static str,
    }

    struct VaultFixture {
        store: &'static str,
        vault_name: &'static str,
        device: &'static str,
        identity: &'static str,
        items: Vec<ItemFixture>,
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
    }

    /// A vault holding one Namecheap login, for identity grouping cases.
    struct LoginVaultCase {
        store: &'static str,
        vault_name: &'static str,
        device: &'static str,
        identity: &'static str,
        id: &'static str,
    }

    impl LoginVaultCase {
        fn vault(&self) -> anyhow::Result<SiteSecretVault> {
            VaultFixture {
                store: self.store,
                vault_name: self.vault_name,
                device: self.device,
                identity: self.identity,
                items: vec![ItemFixture {
                    kind: SiteSecretKind::Login,
                    id: self.id,
                    title: "namecheap.com",
                }],
            }
            .vault()
        }
    }

    /// The reported Namecheap case: a login and an authenticator in the
    /// personal vault, and the same in vault "www" of the work identity, plus
    /// a passkey and an API key so every kind is present.
    fn namecheap_vaults() -> anyhow::Result<SiteSecretVaults> {
        let personal = VaultFixture {
            store: "store_SMypl8K0w9a",
            vault_name: "bynull",
            device: "device-personal",
            identity: "Personal",
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
        };
        let work = VaultFixture {
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
        Ok(SiteSecretVaults {
            vaults: vec![personal.vault()?, work.vault()?],
        })
    }

    struct RowSummary {
        kind: SiteSecretKind,
        secret: String,
    }

    fn listed_groups(listing: SiteSecretListing) -> anyhow::Result<Vec<SiteSecretIdentityGroup>> {
        let SiteSecretListing::Listed { groups } = listing else {
            anyhow::bail!("expected a listed result, got {listing:?}");
        };
        Ok(groups)
    }

    fn row_summaries(group: &SiteSecretIdentityGroup) -> Vec<RowSummary> {
        group
            .rows
            .iter()
            .map(|row| RowSummary {
                kind: row.kind,
                secret: row.item_id.secret_id.as_str().to_owned(),
            })
            .collect()
    }

    fn header_name(group: &SiteSecretIdentityGroup) -> String {
        match &group.header {
            SiteSecretIdentityHeader::Named {
                name: SiteSecretIdentityName(name),
            } => name.clone(),
            SiteSecretIdentityHeader::Unnamed { message_key } => {
                let SiteSecretMessageKey(key) = message_key;
                key.clone()
            }
        }
    }

    #[test]
    fn unrecognized_page_lists_every_kind_grouped_by_identity_in_grant_order() -> anyhow::Result<()>
    {
        let groups = listed_groups(
            SiteSecretListingRequest {
                page_need: SitePageNeed::AnySiteSecret,
                vaults: namecheap_vaults()?,
            }
            .present(),
        )?;
        let headers: Vec<String> = groups.iter().map(header_name).collect();
        assert_eq!(headers, ["Personal", "work"]);
        let [personal, work] = groups.as_slice() else {
            anyhow::bail!("expected two identity groups");
        };
        let personal_rows = row_summaries(personal);
        assert_eq!(
            personal_rows.iter().map(|row| row.kind).collect::<Vec<_>>(),
            [
                SiteSecretKind::Login,
                SiteSecretKind::Authenticator,
                SiteSecretKind::ApiKey
            ]
        );
        assert_eq!(
            work.rows.iter().map(|row| row.kind).collect::<Vec<_>>(),
            [
                SiteSecretKind::Login,
                SiteSecretKind::Authenticator,
                SiteSecretKind::Passkey
            ]
        );
        assert_eq!(
            personal_rows
                .iter()
                .map(|row| row.secret.as_str())
                .collect::<Vec<_>>(),
            [
                "secret_personal_login",
                "secret_personal_totp",
                "secret_personal_api"
            ]
        );
        Ok(())
    }

    #[test]
    fn one_time_code_page_lists_only_authenticators() -> anyhow::Result<()> {
        let groups = listed_groups(
            SiteSecretListingRequest {
                page_need: SitePageNeed::OneTimeCode,
                vaults: namecheap_vaults()?,
            }
            .present(),
        )?;
        let rows: Vec<&SiteSecretRow> = groups.iter().flat_map(|group| &group.rows).collect();
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
        let groups = listed_groups(
            SiteSecretListingRequest {
                page_need: SitePageNeed::Credentials,
                vaults: namecheap_vaults()?,
            }
            .present(),
        )?;
        let rows: Vec<&SiteSecretRow> = groups.iter().flat_map(|group| &group.rows).collect();
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
    fn filtered_empty_results_select_the_page_need_empty_state() -> anyhow::Result<()> {
        let only_login = SiteSecretVaults {
            vaults: vec![
                VaultFixture {
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
                .vault()?,
            ],
        };
        assert_eq!(
            SiteSecretListingRequest {
                page_need: SitePageNeed::OneTimeCode,
                vaults: only_login,
            }
            .present(),
            SiteSecretListing::Empty {
                message_key: SiteSecretMessageKey::catalog(
                    i18n_keys::EXTENSION_ACTION_SITE_EMPTY_TOTP
                ),
                hint: SiteSecretEmptyHint::Absent,
            }
        );
        let nothing = SiteSecretVaults { vaults: vec![] };
        assert_eq!(
            SiteSecretListingRequest {
                page_need: SitePageNeed::Credentials,
                vaults: nothing.clone(),
            }
            .present(),
            SiteSecretListing::Empty {
                message_key: SiteSecretMessageKey::catalog(i18n_keys::EXTENSION_ACTION_SITE_EMPTY),
                hint: SiteSecretEmptyHint::Shown {
                    message_key: SiteSecretMessageKey::catalog(
                        i18n_keys::EXTENSION_ACTION_SITE_EMPTY_HINT
                    ),
                },
            }
        );
        assert_eq!(
            SiteSecretListingRequest {
                page_need: SitePageNeed::AnySiteSecret,
                vaults: nothing,
            }
            .present(),
            SiteSecretListing::Empty {
                message_key: SiteSecretMessageKey::catalog(
                    i18n_keys::EXTENSION_ACTION_SITE_EMPTY_ANY
                ),
                hint: SiteSecretEmptyHint::Shown {
                    message_key: SiteSecretMessageKey::catalog(
                        i18n_keys::EXTENSION_ACTION_SITE_EMPTY_HINT
                    ),
                },
            }
        );
        Ok(())
    }

    #[test]
    fn identities_merge_by_device_and_name_and_unnamed_identity_comes_last() -> anyhow::Result<()> {
        let vaults = SiteSecretVaults {
            vaults: [
                LoginVaultCase {
                    store: "store_SMypl8K0w9a",
                    vault_name: "old",
                    device: "device-old",
                    identity: "",
                    id: "secret_a",
                },
                LoginVaultCase {
                    store: "store_SMypl8K0w9b",
                    vault_name: "bynull",
                    device: "device-p",
                    identity: "Personal",
                    id: "secret_b",
                },
                LoginVaultCase {
                    store: "store_SMypl8K0w9c",
                    vault_name: "",
                    device: "device-w",
                    identity: "work",
                    id: "secret_c",
                },
                LoginVaultCase {
                    store: "store_SMypl8K0w9d",
                    vault_name: "www",
                    device: "device-p",
                    identity: "Personal",
                    id: "secret_d",
                },
                LoginVaultCase {
                    store: "store_SMypl8K0w9e",
                    vault_name: "twin",
                    device: "device-x",
                    identity: "Personal",
                    id: "secret_e",
                },
            ]
            .iter()
            .map(LoginVaultCase::vault)
            .collect::<anyhow::Result<_>>()?,
        };
        let groups = listed_groups(
            SiteSecretListingRequest {
                page_need: SitePageNeed::Credentials,
                vaults,
            }
            .present(),
        )?;
        assert_eq!(
            groups.iter().map(header_name).collect::<Vec<_>>(),
            [
                "Personal",
                "work",
                "Personal",
                i18n_keys::EXTENSION_COMPANION_OTHER_VAULTS
            ]
        );
        let [personal, work, _, _] = groups.as_slice() else {
            anyhow::bail!("expected four identity groups");
        };
        assert_eq!(
            row_summaries(personal)
                .iter()
                .map(|row| row.secret.as_str())
                .collect::<Vec<_>>(),
            ["secret_b", "secret_d"]
        );
        let [work_row] = work.rows.as_slice() else {
            anyhow::bail!("expected one work row");
        };
        assert_eq!(
            work_row.vault,
            SiteSecretVaultLabel::Unnamed {
                message_key: SiteSecretMessageKey::catalog(i18n_keys::LOGIN_VAULT_PICKER_UNNAMED),
            }
        );
        assert_eq!(
            work_row.item_id.vault_store_id,
            StoreId::parse("store_SMypl8K0w9c")?
        );
        Ok(())
    }

    #[test]
    fn rows_of_one_kind_sort_by_title_ignoring_case() -> anyhow::Result<()> {
        let vaults = SiteSecretVaults {
            vaults: vec![
                VaultFixture {
                    store: "store_SMypl8K0w9a",
                    vault_name: "bynull",
                    device: "device-personal",
                    identity: "Personal",
                    items: vec![
                        ItemFixture {
                            kind: SiteSecretKind::Authenticator,
                            id: "secret_z",
                            title: "zeta",
                        },
                        ItemFixture {
                            kind: SiteSecretKind::Authenticator,
                            id: "secret_a",
                            title: "Alpha",
                        },
                    ],
                }
                .vault()?,
            ],
        };
        let groups = listed_groups(
            SiteSecretListingRequest {
                page_need: SitePageNeed::OneTimeCode,
                vaults,
            }
            .present(),
        )?;
        let [group] = groups.as_slice() else {
            anyhow::bail!("expected one group");
        };
        assert_eq!(
            row_summaries(group)
                .iter()
                .map(|row| row.secret.as_str())
                .collect::<Vec<_>>(),
            ["secret_a", "secret_z"]
        );
        Ok(())
    }

    #[test]
    fn same_host_logins_sort_by_account_ignoring_case() -> anyhow::Result<()> {
        let login = |id: &str, account: &str| SiteSecretItem {
            kind: SiteSecretKind::Login,
            secret_id: SecretId::from_vault_record(id),
            title: SiteSecretTitle::from("namecheap.com".to_owned()),
            account: SiteSecretAccount::from(account.to_owned()),
            saved_host: SiteSecretSavedHost::from("namecheap.com".to_owned()),
        };
        let vault = SiteSecretVault {
            matches: SiteSecretMatches {
                items: vec![
                    login("secret_zed", "zed"),
                    login("secret_bynull", "bynull"),
                    login("secret_alice", "Alice"),
                ],
            },
            ..VaultFixture {
                store: "store_SMypl8K0w9a",
                vault_name: "bynull",
                device: "device-personal",
                identity: "Personal",
                items: vec![],
            }
            .vault()?
        };
        let groups = listed_groups(
            SiteSecretListingRequest {
                page_need: SitePageNeed::Credentials,
                vaults: SiteSecretVaults {
                    vaults: vec![vault],
                },
            }
            .present(),
        )?;
        let [group] = groups.as_slice() else {
            anyhow::bail!("expected one group");
        };
        assert_eq!(
            row_summaries(group)
                .iter()
                .map(|row| row.secret.as_str())
                .collect::<Vec<_>>(),
            ["secret_alice", "secret_bynull", "secret_zed"]
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
    fn listing_wire_uses_tagged_display_values() -> anyhow::Result<()> {
        let groups = listed_groups(
            SiteSecretListingRequest {
                page_need: SitePageNeed::OneTimeCode,
                vaults: namecheap_vaults()?,
            }
            .present(),
        )?;
        let json = serde_json::to_value(SiteSecretListing::Listed { groups })?;
        let row = "/groups/0/rows/0";
        for expected in [
            WireField {
                pointer: "/kind".to_owned(),
                value: "Listed",
            },
            WireField {
                pointer: "/groups/0/header/kind".to_owned(),
                value: "Named",
            },
            WireField {
                pointer: "/groups/0/header/name".to_owned(),
                value: "Personal",
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
                pointer: format!("{row}/vault/kind"),
                value: "Named",
            },
            WireField {
                pointer: format!("{row}/vault/name"),
                value: "bynull",
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
            assert_eq!(
                json.pointer(&expected.pointer)
                    .and_then(serde_json::Value::as_str),
                Some(expected.value),
                "{}",
                expected.pointer
            );
        }
        Ok(())
    }

    struct WireField {
        pointer: String,
        value: &'static str,
    }
}

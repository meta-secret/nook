//! Identity:vault sections of the "This site" listing.
//!
//! Every paired vault becomes one section, even when the page needs none of
//! its matches. Identities keep the order of their first vault in the pairing
//! grants, named identities before grants without a recorded identity, and an
//! identity's vaults stay adjacent in grant order. Rows sort inside their
//! section by kind, then title, then account.

use super::page_need::SiteSecretRelevance;
use super::row_presentation::SiteSecretNaming;
use super::{
    SitePageNeed, SiteSecretAccount, SiteSecretIdentity, SiteSecretIdentityHeader,
    SiteSecretIdentityName, SiteSecretItemId, SiteSecretKind, SiteSecretListing,
    SiteSecretListingSummary, SiteSecretMessageKey, SiteSecretRow, SiteSecretSection,
    SiteSecretSectionContent, SiteSecretTitle, SiteSecretVault, SiteSecretVaultLabel,
};
use nook_app_common::i18n_keys;

/// One vault's section with the identity that orders it.
pub(super) struct SiteSecretSectionDraft {
    identity: SiteSecretIdentity,
    section: SiteSecretSection,
}

/// The sections of one identity, in grant order.
struct SiteSecretIdentitySections {
    identity: SiteSecretIdentity,
    sections: Vec<SiteSecretSection>,
}

/// Identities in order of their first vault in the pairing grants.
#[derive(Default)]
pub(super) struct SiteSecretSectionGrouping {
    identities: Vec<SiteSecretIdentitySections>,
}

/// Stable row sort key inside one section.
#[derive(PartialEq, Eq, PartialOrd, Ord)]
struct SiteSecretRowOrder {
    kind: SiteSecretKind,
    title: SiteSecretSortText,
    account: SiteSecretSortText,
}

/// Case-folded display text that rows sort by, so case never reorders them.
#[derive(PartialEq, Eq, PartialOrd, Ord)]
struct SiteSecretSortText(String);

impl SiteSecretTitle {
    fn sort_key(&self) -> SiteSecretSortText {
        let Self(title) = self;
        SiteSecretSortText(title.to_lowercase())
    }
}

impl SiteSecretAccount {
    fn sort_key(&self) -> SiteSecretSortText {
        let Self(account) = self;
        SiteSecretSortText(account.to_lowercase())
    }
}

impl SiteSecretVault {
    /// The vault's section: its identity and vault labels with the rows the
    /// page needs.
    pub(super) fn section(self, need: SitePageNeed) -> SiteSecretSectionDraft {
        let Self {
            vault_store_id,
            vault_name,
            identity,
            matches,
        } = self;
        let rows: Vec<SiteSecretRow> = matches
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
                action: item.kind.action(),
            })
            .collect();
        let section = SiteSecretSection {
            identity: SiteSecretIdentityHeader::from(identity.name.clone()),
            vault: SiteSecretVaultLabel::from(vault_name),
            content: SiteSecretSectionContent::of(rows),
            vault_store_id,
        };
        SiteSecretSectionDraft { identity, section }
    }
}

impl SiteSecretSectionContent {
    /// Rows sorted by kind, then by title, then by account, ignoring case; or
    /// the empty line when the vault has nothing the page needs.
    fn of(mut rows: Vec<SiteSecretRow>) -> Self {
        rows.sort_by_cached_key(|row| SiteSecretRowOrder {
            kind: row.kind,
            title: row.title.sort_key(),
            account: row.account.sort_key(),
        });
        match rows.as_slice() {
            [] => Self::Empty {
                message_key: SiteSecretMessageKey::catalog(
                    i18n_keys::EXTENSION_ACTION_SITE_VAULT_EMPTY,
                ),
            },
            [_, ..] => Self::Listed { rows },
        }
    }
}

impl SiteSecretSectionGrouping {
    #[must_use]
    pub(super) fn with_section(mut self, draft: SiteSecretSectionDraft) -> Self {
        let SiteSecretSectionDraft { identity, section } = draft;
        match self
            .identities
            .iter_mut()
            .find(|group| group.identity == identity)
        {
            Some(group) => group.sections.push(section),
            None => self.identities.push(SiteSecretIdentitySections {
                identity,
                sections: vec![section],
            }),
        }
        self
    }

    /// Named identities keep their first-appearance order; grants without a
    /// recorded identity come last. Without a row in any section, the summary
    /// carries the page need's empty state.
    pub(super) fn listing(self, need: SitePageNeed) -> SiteSecretListing {
        let (named, unnamed): (
            Vec<SiteSecretIdentitySections>,
            Vec<SiteSecretIdentitySections>,
        ) = self.identities.into_iter().partition(|group| {
            let SiteSecretIdentityName(name) = &group.identity.name;
            match SiteSecretNaming::of(name) {
                SiteSecretNaming::Named => true,
                SiteSecretNaming::Unnamed => false,
            }
        });
        let sections: Vec<SiteSecretSection> = named
            .into_iter()
            .chain(unnamed)
            .flat_map(|group| group.sections)
            .collect();
        let summary = match sections.iter().find(|section| match section.content {
            SiteSecretSectionContent::Listed { .. } => true,
            SiteSecretSectionContent::Empty { .. } => false,
        }) {
            Some(_) => SiteSecretListingSummary::Listed,
            None => need.empty_summary(),
        };
        SiteSecretListing {
            summary,
            sections,
            page_offer: need.page_offer(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::{
        SiteSecretIdentityDevice, SiteSecretItem, SiteSecretListingRequest, SiteSecretMatches,
        SiteSecretSavedHost, SiteSecretVaultName, SiteSecretVaults,
    };
    use super::*;
    use nook_auth2::{SecretId, StoreId};

    /// One site-bound item saved for namecheap.com.
    struct ItemFixture {
        kind: SiteSecretKind,
        id: &'static str,
        title: &'static str,
        account: &'static str,
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
    struct SectionScenario {
        page_need: SitePageNeed,
        vaults: Vec<VaultFixture>,
    }

    /// Where a section sits and what its header shows.
    #[derive(Debug, PartialEq, Eq)]
    struct SectionHeading {
        store: StoreId,
        identity: SiteSecretIdentityHeader,
        vault: SiteSecretVaultLabel,
    }

    impl ItemFixture {
        fn login(id: &'static str) -> Self {
            Self {
                kind: SiteSecretKind::Login,
                id,
                title: "namecheap.com",
                account: "bynull",
            }
        }

        fn item(&self) -> SiteSecretItem {
            SiteSecretItem {
                kind: self.kind,
                secret_id: SecretId::from_vault_record(self.id),
                title: SiteSecretTitle::from(self.title.to_owned()),
                account: SiteSecretAccount::from(self.account.to_owned()),
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

    impl SectionScenario {
        fn listing(&self) -> anyhow::Result<SiteSecretListing> {
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

        fn headings(&self) -> anyhow::Result<Vec<SectionHeading>> {
            Ok(self
                .listing()?
                .sections
                .into_iter()
                .map(|section| SectionHeading {
                    store: section.vault_store_id,
                    identity: section.identity,
                    vault: section.vault,
                })
                .collect())
        }

        /// Secret ids of the only section, in row order.
        fn only_section_secrets(&self) -> anyhow::Result<Vec<SecretId>> {
            let sections = self.listing()?.sections;
            let [
                SiteSecretSection {
                    content: SiteSecretSectionContent::Listed { rows },
                    ..
                },
            ] = sections.as_slice()
            else {
                anyhow::bail!("expected one listed section, got {sections:?}");
            };
            Ok(rows
                .iter()
                .map(|row| row.item_id.secret_id.clone())
                .collect())
        }
    }

    #[test]
    fn sections_follow_grant_order_with_identity_vaults_adjacent_and_unnamed_last()
    -> anyhow::Result<()> {
        let scenario = SectionScenario {
            page_need: SitePageNeed::Credentials,
            vaults: vec![
                VaultFixture {
                    store: "store_SMypl8K0w9a",
                    vault_name: "old",
                    device: "device-old",
                    identity: "",
                    items: vec![ItemFixture::login("secret_a")],
                },
                VaultFixture {
                    store: "store_SMypl8K0w9b",
                    vault_name: "one",
                    device: "device-p",
                    identity: "Personal",
                    items: vec![ItemFixture::login("secret_b")],
                },
                VaultFixture {
                    store: "store_SMypl8K0w9c",
                    vault_name: "two",
                    device: "device-w",
                    identity: "work",
                    items: vec![ItemFixture::login("secret_c")],
                },
                VaultFixture {
                    store: "store_SMypl8K0w9d",
                    vault_name: "three",
                    device: "device-p",
                    identity: "Personal",
                    items: vec![ItemFixture::login("secret_d")],
                },
                VaultFixture {
                    store: "store_SMypl8K0w9e",
                    vault_name: "twin",
                    device: "device-x",
                    identity: "Personal",
                    items: vec![ItemFixture::login("secret_e")],
                },
            ],
        };
        let stores: Vec<StoreId> = scenario
            .headings()?
            .into_iter()
            .map(|heading| heading.store)
            .collect();
        let expected = [
            "store_SMypl8K0w9b",
            "store_SMypl8K0w9d",
            "store_SMypl8K0w9c",
            "store_SMypl8K0w9e",
            "store_SMypl8K0w9a",
        ]
        .into_iter()
        .map(StoreId::parse)
        .collect::<Result<Vec<_>, _>>()?;
        assert_eq!(stores, expected);
        Ok(())
    }

    #[test]
    fn section_headers_carry_identity_and_vault_labels_with_unnamed_fallbacks() -> anyhow::Result<()>
    {
        let scenario = SectionScenario {
            page_need: SitePageNeed::AnySiteSecret,
            vaults: vec![
                VaultFixture {
                    store: "store_SMypl8K0w9a",
                    vault_name: "test",
                    device: "device-p",
                    identity: "Personal",
                    items: vec![],
                },
                VaultFixture {
                    store: "store_SMypl8K0w9b",
                    vault_name: " ",
                    device: "device-w",
                    identity: "work",
                    items: vec![],
                },
                VaultFixture {
                    store: "store_SMypl8K0w9c",
                    vault_name: "old",
                    device: "device-old",
                    identity: "",
                    items: vec![],
                },
            ],
        };
        assert_eq!(
            scenario.headings()?,
            [
                SectionHeading {
                    store: StoreId::parse("store_SMypl8K0w9a")?,
                    identity: SiteSecretIdentityHeader::Named {
                        name: SiteSecretIdentityName::from("Personal".to_owned()),
                    },
                    vault: SiteSecretVaultLabel::Named {
                        name: SiteSecretVaultName::from("test".to_owned()),
                    },
                },
                SectionHeading {
                    store: StoreId::parse("store_SMypl8K0w9b")?,
                    identity: SiteSecretIdentityHeader::Named {
                        name: SiteSecretIdentityName::from("work".to_owned()),
                    },
                    vault: SiteSecretVaultLabel::Unnamed {
                        message_key: SiteSecretMessageKey::catalog(
                            i18n_keys::LOGIN_VAULT_PICKER_UNNAMED,
                        ),
                    },
                },
                SectionHeading {
                    store: StoreId::parse("store_SMypl8K0w9c")?,
                    identity: SiteSecretIdentityHeader::Unnamed {
                        message_key: SiteSecretMessageKey::catalog(
                            i18n_keys::EXTENSION_COMPANION_OTHER_VAULTS,
                        ),
                    },
                    vault: SiteSecretVaultLabel::Named {
                        name: SiteSecretVaultName::from("old".to_owned()),
                    },
                },
            ]
        );
        Ok(())
    }

    #[test]
    fn vault_without_needed_matches_presents_the_empty_line() -> anyhow::Result<()> {
        let listing = SectionScenario {
            page_need: SitePageNeed::Credentials,
            vaults: vec![
                VaultFixture {
                    store: "store_SMypl8K0w9a",
                    vault_name: "bynull",
                    device: "device-p",
                    identity: "Personal",
                    items: vec![ItemFixture::login("secret_login")],
                },
                VaultFixture {
                    store: "store_SMypl8K0w9b",
                    vault_name: "nothing",
                    device: "device-p",
                    identity: "Personal",
                    items: vec![],
                },
                VaultFixture {
                    store: "store_SMypl8K0w9c",
                    vault_name: "codes",
                    device: "device-w",
                    identity: "work",
                    items: vec![ItemFixture {
                        kind: SiteSecretKind::Authenticator,
                        id: "secret_totp",
                        title: "Namecheap",
                        account: "bynull",
                    }],
                },
            ],
        }
        .listing()?;
        assert_eq!(listing.summary, SiteSecretListingSummary::Listed);
        let empty_line = SiteSecretSectionContent::Empty {
            message_key: SiteSecretMessageKey::catalog(
                i18n_keys::EXTENSION_ACTION_SITE_VAULT_EMPTY,
            ),
        };
        let [listed, nothing, filtered] = listing.sections.as_slice() else {
            anyhow::bail!("expected three sections, got {:?}", listing.sections);
        };
        let SiteSecretSectionContent::Listed { rows } = &listed.content else {
            anyhow::bail!("expected the login row, got {:?}", listed.content);
        };
        assert_eq!(rows.len(), 1);
        assert_eq!(nothing.content, empty_line);
        assert_eq!(filtered.content, empty_line);
        assert_eq!(
            filtered.vault_store_id,
            StoreId::parse("store_SMypl8K0w9c")?
        );
        Ok(())
    }

    #[test]
    fn rows_of_one_kind_sort_by_title_ignoring_case() -> anyhow::Result<()> {
        let secrets = SectionScenario {
            page_need: SitePageNeed::OneTimeCode,
            vaults: vec![VaultFixture {
                store: "store_SMypl8K0w9a",
                vault_name: "bynull",
                device: "device-p",
                identity: "Personal",
                items: vec![
                    ItemFixture {
                        kind: SiteSecretKind::Authenticator,
                        id: "secret_z",
                        title: "zeta",
                        account: "bynull",
                    },
                    ItemFixture {
                        kind: SiteSecretKind::Authenticator,
                        id: "secret_a",
                        title: "Alpha",
                        account: "bynull",
                    },
                ],
            }],
        }
        .only_section_secrets()?;
        assert_eq!(
            secrets,
            ["secret_a", "secret_z"].map(SecretId::from_vault_record)
        );
        Ok(())
    }

    #[test]
    fn same_host_logins_sort_by_account_ignoring_case() -> anyhow::Result<()> {
        let secrets = SectionScenario {
            page_need: SitePageNeed::Credentials,
            vaults: vec![VaultFixture {
                store: "store_SMypl8K0w9a",
                vault_name: "bynull",
                device: "device-p",
                identity: "Personal",
                items: vec![
                    ItemFixture {
                        account: "zed",
                        ..ItemFixture::login("secret_zed")
                    },
                    ItemFixture {
                        account: "bynull",
                        ..ItemFixture::login("secret_bynull")
                    },
                    ItemFixture {
                        account: "Alice",
                        ..ItemFixture::login("secret_alice")
                    },
                ],
            }],
        }
        .only_section_secrets()?;
        assert_eq!(
            secrets,
            ["secret_alice", "secret_bynull", "secret_zed"].map(SecretId::from_vault_record)
        );
        Ok(())
    }
}

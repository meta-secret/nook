//! Origin-matched login labels from the authenticated unlocked metadata catalog.

use super::SecretSearchCatalog;
use crate::{
    LoginHostMatchRequest, LoginSiteHostsError, SecretId, SecretListItemData, WebsiteHost,
};

#[derive(Debug, Clone, PartialEq, Eq, derive_more::From)]
pub struct LoginAccountUsername(String);

impl From<LoginAccountUsername> for String {
    fn from(value: LoginAccountUsername) -> Self {
        let LoginAccountUsername(value) = value;
        value
    }
}

#[derive(Debug, Clone, PartialEq, Eq, derive_more::From)]
pub struct LoginAccountWebsiteUrl(String);

impl From<LoginAccountWebsiteUrl> for String {
    fn from(value: LoginAccountWebsiteUrl) -> Self {
        let LoginAccountWebsiteUrl(value) = value;
        value
    }
}

/// The list carries no password, notes, or full decrypted record.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoginAccountMetadata {
    pub secret_id: SecretId,
    pub username: LoginAccountUsername,
    pub website_url: LoginAccountWebsiteUrl,
    pub website_host: WebsiteHost,
}

enum LoginAccountMatch {
    Matched,
    Unmatched,
}

impl SecretSearchCatalog {
    /// Applies the same host/family policy as selected-record reveal without
    /// opening any full record. Catalog reconciliation authenticates these rows.
    #[expect(
        clippy::match_bool,
        reason = "native-bool boundary conversion into named match outcomes required by branching-and-exhaustive-matching"
    )]
    pub fn matching_login_accounts(
        &self,
        origin: &WebsiteHost,
    ) -> Result<Vec<LoginAccountMetadata>, LoginSiteHostsError> {
        let mut accounts = Vec::new();
        for entry in self.entries.values() {
            let SecretListItemData::Login {
                website_url,
                username,
            } = &entry.item.data
            else {
                continue;
            };
            let Ok(website_host) = WebsiteHost::normalize(website_url) else {
                continue;
            };
            let matching = match (LoginHostMatchRequest {
                website_url,
                origin: origin.as_str(),
            })
            .matches()?
            {
                true => LoginAccountMatch::Matched,
                false => LoginAccountMatch::Unmatched,
            };
            match matching {
                LoginAccountMatch::Unmatched => {}
                LoginAccountMatch::Matched => accounts.push(LoginAccountMetadata {
                    secret_id: entry.item.id.clone(),
                    username: LoginAccountUsername(username.clone()),
                    website_url: LoginAccountWebsiteUrl(website_url.clone()),
                    website_host,
                }),
            }
        }
        Ok(accounts)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::vault_search_catalog::{
        SecretSearchCatalogEntry, SecretSearchCatalogEntryRequest, SecretSearchCatalogPayloadDigest,
    };
    use crate::{SecretListItem, SymmetricKey};

    struct LoginCatalogFixture {
        catalog: SecretSearchCatalog,
        integrity_key: SymmetricKey,
    }

    impl LoginCatalogFixture {
        fn new() -> anyhow::Result<Self> {
            Ok(Self {
                catalog: SecretSearchCatalog::default(),
                integrity_key: SymmetricKey::parse(&"a".repeat(64))?,
            })
        }

        #[must_use = "retain the updated catalog fixture"]
        fn with_item(mut self, item: SecretListItem) -> anyhow::Result<Self> {
            self.catalog.entries.insert(
                item.id.clone(),
                SecretSearchCatalogEntry::new(SecretSearchCatalogEntryRequest {
                    payload_digest: SecretSearchCatalogPayloadDigest::from([0; 16]),
                    item,
                    integrity_key: &self.integrity_key,
                })?,
            );
            Ok(self)
        }
    }

    #[test]
    fn thirteen_hundred_login_catalog_lists_without_full_record_capability() -> anyhow::Result<()> {
        let mut fixture = LoginCatalogFixture::new()?;
        for index in 0..1_300 {
            fixture = fixture.with_item(SecretListItem {
                id: SecretId::from_vault_record(&format!("secret_listing{index:05}")),
                data: SecretListItemData::Login {
                    website_url: format!("https://site-{index}.example.com/login"),
                    username: format!("account-{index}"),
                },
            })?;
        }
        // There is no VaultCrypto, encrypted record map, or password here. All
        // twenty repeated requests operate on the existing authenticated metadata.
        let origin = WebsiteHost::normalize("https://site-987.example.com/account")?;
        for _ in 0..20 {
            let accounts = fixture.catalog.matching_login_accounts(&origin)?;
            assert_eq!(accounts.len(), 1);
            let account = accounts
                .first()
                .ok_or_else(|| anyhow::anyhow!("missing account"))?;
            assert_eq!(
                account.secret_id,
                SecretId::from_vault_record("secret_listing00987")
            );
            assert_eq!(String::from(account.username.clone()), "account-987");
        }
        Ok(())
    }

    #[test]
    fn catalog_listing_preserves_host_family_labels_and_type_boundary() -> anyhow::Result<()> {
        let fixture = LoginCatalogFixture::new()?
            .with_item(SecretListItem {
                id: SecretId::from_vault_record("secret_microsoft"),
                data: SecretListItemData::Login {
                    website_url: "https://www.microsoft.com/login".to_owned(),
                    username: "work-account".to_owned(),
                },
            })?
            .with_item(SecretListItem {
                id: SecretId::from_vault_record("secret_note"),
                data: SecretListItemData::SecureNote {
                    title: "microsoft.com".to_owned(),
                },
            })?;
        let accounts = fixture
            .catalog
            .matching_login_accounts(&WebsiteHost::normalize(
                "https://login.microsoftonline.com",
            )?)?;
        assert_eq!(accounts.len(), 1);
        let account = accounts
            .first()
            .ok_or_else(|| anyhow::anyhow!("missing account"))?;
        assert_eq!(String::from(account.username.clone()), "work-account");
        assert_eq!(
            String::from(account.website_url.clone()),
            "https://www.microsoft.com/login"
        );
        assert_eq!(account.website_host.as_str(), "microsoft.com");
        assert!(
            fixture
                .catalog
                .matching_login_accounts(&WebsiteHost::normalize("https://other.example")?)?
                .is_empty()
        );
        Ok(())
    }
}

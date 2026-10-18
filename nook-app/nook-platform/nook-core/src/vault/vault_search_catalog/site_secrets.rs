//! Site-bound secrets matched to a requesting page from the authenticated
//! unlocked metadata catalog, projected for display only.
//!
//! Logins and API keys match their saved website with the same
//! registrable-domain policy as login fill. Authenticators match the host
//! resolved from their website URL or issuer, under that same policy. Passkeys
//! match only where `WebAuthn` would let the page use them. Catalog rows carry
//! no password, TOTP seed, API key, or passkey private key, and the projection
//! copies only titles, accounts, and hosts.

use super::SecretSearchCatalog;
use crate::{
    AuthenticatorGroupKeyRequest, AuthenticatorHostResolution, AuthenticatorIssuerHostsError,
    LoginHostMatch, LoginWebsiteHost, PasskeyOrigin, SecretListItem, SecretListItemData,
    WebsiteHost, WebsiteHostError,
};
use nook_companion_core::{
    SiteSecretAccount, SiteSecretItem, SiteSecretKind, SiteSecretMatches, SiteSecretSavedHost,
    SiteSecretTitle,
};

/// The requesting page origin, parsed once for every site-bound match.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SiteSecretOrigin {
    origin: String,
    host: LoginWebsiteHost,
}

impl TryFrom<&str> for SiteSecretOrigin {
    type Error = WebsiteHostError;

    fn try_from(origin: &str) -> Result<Self, Self::Error> {
        let host = LoginWebsiteHost::try_from(origin)?;
        Ok(Self {
            origin: origin.to_owned(),
            host,
        })
    }
}

/// Whether one catalog row is bound to the requesting site.
enum SiteSecretMatch {
    Matched(SiteSecretItem),
    Unmatched,
}

/// Whether a saved website belongs to the requesting site, with its display host.
enum SiteSavedHostMatch {
    Matched(WebsiteHost),
    Unmatched,
}

/// Display text that falls back when the preferred saved value is empty.
struct SiteSecretText<'a> {
    preferred: &'a str,
    fallback: &'a str,
}

impl SiteSecretText<'_> {
    fn chosen(&self) -> String {
        match self.preferred.trim() {
            "" => self.fallback.trim().to_owned(),
            preferred => preferred.to_owned(),
        }
    }
}

/// One catalog row assessed against the requesting site.
struct SiteSecretCandidate<'a> {
    item: &'a SecretListItem,
    origin: &'a SiteSecretOrigin,
}

/// A website-bound row: its kind, saved website, and saved account.
struct SiteWebsiteSecret<'a> {
    kind: SiteSecretKind,
    website_url: &'a str,
    account: &'a str,
}

impl SecretSearchCatalog {
    /// Lists every Login, Authenticator, Passkey, and API key bound to the
    /// requesting site without opening any full record.
    pub fn matching_site_secrets(
        &self,
        origin: &SiteSecretOrigin,
    ) -> Result<SiteSecretMatches, AuthenticatorIssuerHostsError> {
        let mut items = Vec::new();
        for entry in self.entries.values() {
            let candidate = SiteSecretCandidate {
                item: &entry.item,
                origin,
            };
            match candidate.assess()? {
                SiteSecretMatch::Matched(item) => items.push(item),
                SiteSecretMatch::Unmatched => {}
            }
        }
        Ok(SiteSecretMatches { items })
    }
}

impl SiteSecretCandidate<'_> {
    fn assess(&self) -> Result<SiteSecretMatch, AuthenticatorIssuerHostsError> {
        match &self.item.data {
            SecretListItemData::Login {
                website_url,
                username,
            } => Ok(self.website_secret(&SiteWebsiteSecret {
                kind: SiteSecretKind::Login,
                website_url,
                account: username,
            })),
            SecretListItemData::ApiKey { website_url, .. } => {
                Ok(self.website_secret(&SiteWebsiteSecret {
                    kind: SiteSecretKind::ApiKey,
                    website_url,
                    account: "",
                }))
            }
            SecretListItemData::Authenticator {
                issuer,
                account,
                website_url,
                ..
            } => self.authenticator(&SiteAuthenticatorRow {
                website_url,
                issuer,
                account,
            }),
            SecretListItemData::Passkey {
                rp_id,
                rp_name,
                user_name,
                user_display_name,
            } => Ok(self.passkey(&SitePasskey {
                rp_id,
                rp_name,
                user_name,
                user_display_name,
            })),
            SecretListItemData::SeedPhrase { .. }
            | SecretListItemData::SecureNote { .. }
            | SecretListItemData::CreditCard { .. }
            | SecretListItemData::FileAttachment { .. } => Ok(SiteSecretMatch::Unmatched),
        }
    }

    fn saved_host(&self, saved: &str) -> SiteSavedHostMatch {
        let Ok(saved_host) = LoginWebsiteHost::try_from(saved) else {
            return SiteSavedHostMatch::Unmatched;
        };
        let Ok(display_host) = WebsiteHost::normalize(saved) else {
            return SiteSavedHostMatch::Unmatched;
        };
        match saved_host.matches(&self.origin.host) {
            LoginHostMatch::Matched => SiteSavedHostMatch::Matched(display_host),
            LoginHostMatch::Unmatched => SiteSavedHostMatch::Unmatched,
        }
    }

    fn website_secret(&self, secret: &SiteWebsiteSecret<'_>) -> SiteSecretMatch {
        match self.saved_host(secret.website_url) {
            SiteSavedHostMatch::Matched(host) => SiteSecretMatch::Matched(SiteSecretItem {
                kind: secret.kind,
                secret_id: self.item.id.clone(),
                title: SiteSecretTitle::from(host.as_str().to_owned()),
                account: SiteSecretAccount::from(secret.account.trim().to_owned()),
                saved_host: SiteSecretSavedHost::from(host.into_string()),
            }),
            SiteSavedHostMatch::Unmatched => SiteSecretMatch::Unmatched,
        }
    }
}

/// The saved fields of an authenticator row needed for matching.
struct SiteAuthenticatorRow<'a> {
    website_url: &'a str,
    issuer: &'a str,
    account: &'a str,
}

/// The saved fields of an authenticator row needed for its display.
struct SiteAuthenticator<'a> {
    host: &'a WebsiteHost,
    issuer: &'a str,
    account: &'a str,
}

/// The saved fields of a passkey row needed for matching and display.
struct SitePasskey<'a> {
    rp_id: &'a str,
    rp_name: &'a str,
    user_name: &'a str,
    user_display_name: &'a str,
}

impl SiteSecretCandidate<'_> {
    fn authenticator(
        &self,
        row: &SiteAuthenticatorRow<'_>,
    ) -> Result<SiteSecretMatch, AuthenticatorIssuerHostsError> {
        let request = AuthenticatorGroupKeyRequest {
            website_url: row.website_url,
            issuer: row.issuer,
        };
        let AuthenticatorHostResolution::Resolved(resolved) = request.website_host()? else {
            return Ok(SiteSecretMatch::Unmatched);
        };
        Ok(match self.saved_host(resolved.as_str()) {
            SiteSavedHostMatch::Matched(host) => self.authenticator_item(&SiteAuthenticator {
                host: &host,
                issuer: row.issuer,
                account: row.account,
            }),
            SiteSavedHostMatch::Unmatched => SiteSecretMatch::Unmatched,
        })
    }

    fn authenticator_item(&self, authenticator: &SiteAuthenticator<'_>) -> SiteSecretMatch {
        SiteSecretMatch::Matched(SiteSecretItem {
            kind: SiteSecretKind::Authenticator,
            secret_id: self.item.id.clone(),
            title: SiteSecretTitle::from(
                SiteSecretText {
                    preferred: authenticator.issuer,
                    fallback: authenticator.host.as_str(),
                }
                .chosen(),
            ),
            account: SiteSecretAccount::from(authenticator.account.trim().to_owned()),
            saved_host: SiteSecretSavedHost::from(authenticator.host.as_str().to_owned()),
        })
    }

    fn passkey(&self, passkey: &SitePasskey<'_>) -> SiteSecretMatch {
        let usable = PasskeyOrigin {
            rp_id: passkey.rp_id,
            origin: &self.origin.origin,
        }
        .validate();
        let Ok(()) = usable else {
            return SiteSecretMatch::Unmatched;
        };
        let Ok(host) = WebsiteHost::normalize(passkey.rp_id) else {
            return SiteSecretMatch::Unmatched;
        };
        SiteSecretMatch::Matched(SiteSecretItem {
            kind: SiteSecretKind::Passkey,
            secret_id: self.item.id.clone(),
            title: SiteSecretTitle::from(
                SiteSecretText {
                    preferred: passkey.rp_name,
                    fallback: passkey.rp_id,
                }
                .chosen(),
            ),
            account: SiteSecretAccount::from(
                SiteSecretText {
                    preferred: passkey.user_name,
                    fallback: passkey.user_display_name,
                }
                .chosen(),
            ),
            saved_host: SiteSecretSavedHost::from(host.into_string()),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::vault_search_catalog::{
        SecretSearchCatalogEntry, SecretSearchCatalogEntryRequest, SecretSearchCatalogPayloadDigest,
    };
    use crate::{
        ApiKeySecret, AuthenticatorBackupCodeCount, AuthenticatorSecret, LoginSecret, SecretId,
        SecretType, SecretValue, StoredRecordPayload, SymmetricKey, TotpAlgorithm, TotpDigits,
        TotpPeriod, TotpSecret, VaultCrypto, VaultKeys,
    };
    use std::collections::HashMap;

    struct SiteCatalogFixture {
        catalog: SecretSearchCatalog,
        integrity_key: SymmetricKey,
    }

    struct CatalogRow {
        id: &'static str,
        data: SecretListItemData,
    }

    impl SiteCatalogFixture {
        fn new() -> anyhow::Result<Self> {
            Ok(Self {
                catalog: SecretSearchCatalog::default(),
                integrity_key: SymmetricKey::parse(&"a".repeat(64))?,
            })
        }

        #[must_use = "retain the updated catalog fixture"]
        fn with_row(mut self, row: CatalogRow) -> anyhow::Result<Self> {
            let id = SecretId::from_vault_record(row.id);
            self.catalog.entries.insert(
                id.clone(),
                SecretSearchCatalogEntry::new(SecretSearchCatalogEntryRequest {
                    payload_digest: SecretSearchCatalogPayloadDigest::from([0; 16]),
                    item: SecretListItem { id, data: row.data },
                    integrity_key: &self.integrity_key,
                })?,
            );
            Ok(self)
        }

        fn with_rows(self, rows: Vec<CatalogRow>) -> anyhow::Result<Self> {
            rows.into_iter().try_fold(self, Self::with_row)
        }

        fn matches(&self, origin: &str) -> anyhow::Result<Vec<SiteSecretItem>> {
            let origin = SiteSecretOrigin::try_from(origin)?;
            Ok(self.catalog.matching_site_secrets(&origin)?.items)
        }
    }

    /// Catalog metadata of one fixture row, by kind.
    enum RowSpec {
        Login {
            url: &'static str,
            user: &'static str,
        },
        Totp {
            issuer: &'static str,
            url: &'static str,
        },
        Passkey {
            rp_id: &'static str,
            rp_name: &'static str,
        },
        ApiKey {
            url: &'static str,
        },
    }

    impl RowSpec {
        fn data(&self) -> SecretListItemData {
            match *self {
                Self::Login { url, user } => SecretListItemData::Login {
                    website_url: url.to_owned(),
                    username: user.to_owned(),
                },
                Self::Totp { issuer, url } => SecretListItemData::Authenticator {
                    issuer: issuer.to_owned(),
                    account: "bynull".to_owned(),
                    website_url: url.to_owned(),
                    backup_code_count: AuthenticatorBackupCodeCount::from(2),
                },
                Self::Passkey { rp_id, rp_name } => SecretListItemData::Passkey {
                    rp_id: rp_id.to_owned(),
                    rp_name: rp_name.to_owned(),
                    user_name: "bynull".to_owned(),
                    user_display_name: "By Null".to_owned(),
                },
                Self::ApiKey { url } => SecretListItemData::ApiKey {
                    website_url: url.to_owned(),
                    expires_at: String::new(),
                },
            }
        }
    }

    impl CatalogRow {
        /// Namecheap-bound rows of every kind.
        fn namecheap_bound() -> Vec<Self> {
            vec![
                CatalogRow {
                    id: "secret_login",
                    data: RowSpec::Login {
                        url: "https://www.namecheap.com/myaccount/login/",
                        user: "bynull",
                    }
                    .data(),
                },
                CatalogRow {
                    id: "secret_totp_issuer",
                    data: RowSpec::Totp {
                        issuer: "Namecheap",
                        url: "",
                    }
                    .data(),
                },
                CatalogRow {
                    id: "secret_totp_url",
                    data: RowSpec::Totp {
                        issuer: "",
                        url: "https://ap.www.namecheap.com/",
                    }
                    .data(),
                },
                CatalogRow {
                    id: "secret_passkey",
                    data: RowSpec::Passkey {
                        rp_id: "namecheap.com",
                        rp_name: "Namecheap",
                    }
                    .data(),
                },
                CatalogRow {
                    id: "secret_passkey_subdomain",
                    data: RowSpec::Passkey {
                        rp_id: "login.namecheap.com",
                        rp_name: "Namecheap login",
                    }
                    .data(),
                },
                CatalogRow {
                    id: "secret_api_key",
                    data: RowSpec::ApiKey {
                        url: "https://api.namecheap.com/xml.response",
                    }
                    .data(),
                },
            ]
        }

        /// Rows bound to other sites or to no site.
        fn unrelated() -> Vec<Self> {
            vec![
                CatalogRow {
                    id: "secret_github_login",
                    data: RowSpec::Login {
                        url: "https://github.com/login",
                        user: "octo",
                    }
                    .data(),
                },
                CatalogRow {
                    id: "secret_github_totp",
                    data: RowSpec::Totp {
                        issuer: "GitHub",
                        url: "",
                    }
                    .data(),
                },
                CatalogRow {
                    id: "secret_unmapped_totp",
                    data: RowSpec::Totp {
                        issuer: "Some Private Brand",
                        url: "",
                    }
                    .data(),
                },
                CatalogRow {
                    id: "secret_github_passkey",
                    data: RowSpec::Passkey {
                        rp_id: "github.com",
                        rp_name: "GitHub",
                    }
                    .data(),
                },
                CatalogRow {
                    id: "secret_github_api_key",
                    data: RowSpec::ApiKey {
                        url: "https://api.github.com",
                    }
                    .data(),
                },
                CatalogRow {
                    id: "secret_note",
                    data: SecretListItemData::SecureNote {
                        title: "namecheap.com".to_owned(),
                    },
                },
                CatalogRow {
                    id: "secret_card",
                    data: SecretListItemData::CreditCard {
                        title: "namecheap.com".to_owned(),
                        cardholder_name: "By Null".to_owned(),
                        last4: "4242".to_owned(),
                        expiration_month: "01".to_owned(),
                        expiration_year: "2030".to_owned(),
                    },
                },
            ]
        }
    }

    impl SiteCatalogFixture {
        /// Namecheap-bound rows of every kind beside unrelated and unbound rows.
        fn namecheap() -> anyhow::Result<Self> {
            Self::new()?
                .with_rows(CatalogRow::namecheap_bound())?
                .with_rows(CatalogRow::unrelated())
        }
    }

    /// One expected display item.
    struct Expected {
        kind: SiteSecretKind,
        id: &'static str,
        title: &'static str,
        account: &'static str,
        host: &'static str,
    }

    impl Expected {
        fn item(&self) -> SiteSecretItem {
            SiteSecretItem {
                kind: self.kind,
                secret_id: SecretId::from_vault_record(self.id),
                title: SiteSecretTitle::from(self.title.to_owned()),
                account: SiteSecretAccount::from(self.account.to_owned()),
                saved_host: SiteSecretSavedHost::from(self.host.to_owned()),
            }
        }
    }

    #[test]
    fn namecheap_page_lists_every_site_bound_kind_and_nothing_else() -> anyhow::Result<()> {
        let mut items = SiteCatalogFixture::namecheap()?.matches("https://www.namecheap.com")?;
        items.sort_by(|left, right| left.secret_id.cmp(&right.secret_id));
        let mut wanted = vec![
            Expected {
                kind: SiteSecretKind::Login,
                id: "secret_login",
                title: "namecheap.com",
                account: "bynull",
                host: "namecheap.com",
            }
            .item(),
            Expected {
                kind: SiteSecretKind::Authenticator,
                id: "secret_totp_issuer",
                title: "Namecheap",
                account: "bynull",
                host: "namecheap.com",
            }
            .item(),
            Expected {
                kind: SiteSecretKind::Authenticator,
                id: "secret_totp_url",
                title: "ap.www.namecheap.com",
                account: "bynull",
                host: "ap.www.namecheap.com",
            }
            .item(),
            Expected {
                kind: SiteSecretKind::Passkey,
                id: "secret_passkey",
                title: "Namecheap",
                account: "bynull",
                host: "namecheap.com",
            }
            .item(),
            Expected {
                kind: SiteSecretKind::ApiKey,
                id: "secret_api_key",
                title: "api.namecheap.com",
                account: "",
                host: "api.namecheap.com",
            }
            .item(),
        ];
        wanted.sort_by(|left, right| left.secret_id.cmp(&right.secret_id));
        assert_eq!(items, wanted);
        Ok(())
    }

    #[test]
    fn passkeys_match_only_where_webauthn_admits_the_origin() -> anyhow::Result<()> {
        let fixture = SiteCatalogFixture::namecheap()?;
        let passkeys = |origin| -> anyhow::Result<Vec<String>> {
            Ok(fixture
                .matches(origin)?
                .into_iter()
                .filter(|item| item.kind == SiteSecretKind::Passkey)
                .map(|item| item.secret_id.into_inner())
                .collect())
        };
        assert_eq!(passkeys("https://www.namecheap.com")?, ["secret_passkey"]);
        assert_eq!(
            passkeys("https://login.namecheap.com")?,
            ["secret_passkey", "secret_passkey_subdomain"]
        );
        assert!(passkeys("http://www.namecheap.com")?.is_empty());
        Ok(())
    }

    #[test]
    fn lookalike_and_unrelated_origins_match_nothing() -> anyhow::Result<()> {
        let fixture = SiteCatalogFixture::namecheap()?;
        for origin in [
            "https://namecheap.com.evil.example",
            "https://evil-namecheap.com",
            "https://unrelated.example",
        ] {
            assert!(fixture.matches(origin)?.is_empty(), "{origin}");
        }
        Ok(())
    }

    #[test]
    fn site_origin_rejects_text_without_a_host() {
        for origin in ["", "https://", "   "] {
            assert!(SiteSecretOrigin::try_from(origin).is_err(), "{origin:?}");
        }
    }

    #[test]
    fn untitled_passkey_and_authenticator_fall_back_to_their_host() -> anyhow::Result<()> {
        let fixture = SiteCatalogFixture::new()?.with_rows(vec![
            CatalogRow {
                id: "secret_passkey",
                data: SecretListItemData::Passkey {
                    rp_id: "namecheap.com".to_owned(),
                    rp_name: " ".to_owned(),
                    user_name: String::new(),
                    user_display_name: "By Null".to_owned(),
                },
            },
            CatalogRow {
                id: "secret_totp",
                data: RowSpec::Totp {
                    issuer: "  ",
                    url: "https://namecheap.com",
                }
                .data(),
            },
        ])?;
        let mut items = fixture.matches("https://www.namecheap.com")?;
        items.sort_by(|left, right| left.secret_id.cmp(&right.secret_id));
        assert_eq!(
            items,
            [
                Expected {
                    kind: SiteSecretKind::Passkey,
                    id: "secret_passkey",
                    title: "namecheap.com",
                    account: "By Null",
                    host: "namecheap.com"
                }
                .item(),
                Expected {
                    kind: SiteSecretKind::Authenticator,
                    id: "secret_totp",
                    title: "namecheap.com",
                    account: "bynull",
                    host: "namecheap.com"
                }
                .item(),
            ]
        );
        Ok(())
    }

    #[test]
    fn projection_from_reconciled_records_carries_no_secret_material() -> anyhow::Result<()> {
        let keys = VaultKeys::generate()?;
        let crypto = VaultCrypto::new(&keys.secrets_key)?;
        let records = [
            SecretValue::Login(LoginSecret {
                website_url: "https://www.namecheap.com/login".to_owned(),
                username: "bynull".to_owned(),
                password: "password-sentinel".to_owned(),
                notes: "notes-sentinel".to_owned(),
            }),
            SecretValue::Authenticator(AuthenticatorSecret {
                issuer: "Namecheap".to_owned(),
                account: "bynull".to_owned(),
                website_url: String::new(),
                secret: TotpSecret::parse("JBSWY3DPEHPK3PXP")?,
                algorithm: TotpAlgorithm::Sha1,
                digits: TotpDigits::Six,
                period: TotpPeriod::default(),
                backup_codes: vec!["BACKUP-SENTINEL".to_owned()],
            }),
            SecretValue::ApiKey(ApiKeySecret {
                website_url: "https://api.namecheap.com".to_owned(),
                key: "api-key-sentinel".to_owned(),
                expires_at: String::new(),
            }),
        ];
        let mut stored = HashMap::new();
        for (index, value) in records.iter().enumerate() {
            let ciphertext = crypto.encrypt_value(value.to_yaml()?.as_str())?;
            stored.insert(
                SecretId::from_vault_record(&format!("secret_record{index}")),
                (
                    value.secret_type(),
                    StoredRecordPayload::from_age_armored(ciphertext),
                ),
            );
        }
        let mut catalog = SecretSearchCatalog::default();
        catalog.reconcile(&stored, &crypto, &keys.secrets_key)?;
        let matches = catalog
            .matching_site_secrets(&SiteSecretOrigin::try_from("https://www.namecheap.com")?)?;
        assert_eq!(matches.items.len(), 3);
        assert!(
            stored
                .values()
                .all(|(kind, _)| *kind != SecretType::Passkey)
        );
        let json = serde_json::to_string(&matches)?;
        for secret in [
            "password-sentinel",
            "notes-sentinel",
            "JBSWY3DPEHPK3PXP",
            "BACKUP-SENTINEL",
            "api-key-sentinel",
        ] {
            assert!(!json.contains(secret), "projected {secret}");
        }
        Ok(())
    }
}

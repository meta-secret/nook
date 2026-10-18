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

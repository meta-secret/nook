//! What the user can decide about each identity a sync provider holds.
//!
//! Passkeys and devices belong to identities, not vaults, so a provider's
//! vaults are grouped under the identity that files them and every decision
//! is made per identity. Each identity gets a standing (whether it opens on
//! this browser, and how) and the decisions that standing allows; **Leave as
//! is** comes first and is the default. The checks run on the page name an
//! identity and its vaults once they decrypted them.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use serde::{Deserialize, Serialize};
use tsify::Tsify;

use crate::{
    CheckedCredential, CredentialCheckReport, FilingIdentity, IdentityCheck, IdentityCheckOutcome,
    ProviderIdentityLog, ProviderVaultAccess, ProviderVaultName, ProviderVaultSummary,
    VaultCheckOutcome,
};

/// Whether an identity is in use on this browser, which merging needs.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub enum IdentitySession {
    /// No identity is in use, as on the first-run or recovery screen.
    NoIdentity,
    /// An identity is unlocked and in use.
    IdentityInUse,
}

/// Whether an identity opens on this browser, and how.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum IdentityStanding {
    /// This browser's own key is one of its devices: it syncs here.
    ThisBrowser,
    /// Another identity on this browser was granted its vaults.
    #[serde(rename_all = "camelCase")]
    OtherIdentityHere { identity_label: String },
    /// A passkey checked on this page belongs to it.
    OpenedByPasskey {
        /// The short form of the passkey's fingerprint.
        passkey: String,
    },
    /// This browser asked to join; a device of the identity approves it.
    JoinRequested,
    /// Passkeys were checked here, and none belongs to it.
    NotOpened,
    /// Nothing on this browser has opened it yet.
    Unchecked,
}

/// One thing the user may decide about an identity.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub enum IdentityDecision {
    /// Change nothing; the default.
    Leave,
    /// Add it to this browser as its own identity, proven by its passkey.
    AddToBrowser,
    /// Make its vaults vaults of the identity in use, proven by its passkey.
    MergeIntoCurrent,
    /// Ask one of its devices to let this browser join it.
    AskToJoin,
}

/// One identity a provider holds: its standing, what the user may decide,
/// and its vaults, named once a check decrypted them.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct ProviderIdentityChoice {
    pub identity: FilingIdentity,
    pub standing: IdentityStanding,
    /// Empty when there is nothing to decide; otherwise **Leave** first.
    pub decisions: Vec<IdentityDecision>,
    pub vaults: Vec<ProviderVaultSummary>,
}

/// A provider listing, the checks run on the page, and the session.
#[derive(Clone, Copy, Debug)]
pub struct ProviderIdentityChoices<'a> {
    pub vaults: &'a [ProviderVaultSummary],
    pub checks: &'a [CredentialCheckReport],
    pub session: IdentitySession,
}

impl ProviderIdentityChoices<'_> {
    /// Every listed identity, in listing order.
    #[must_use]
    pub fn choices(&self) -> Vec<ProviderIdentityChoice> {
        let mut choices: Vec<ProviderIdentityChoice> = Vec::new();
        for summary in self.vaults {
            let vault = self.named_vault(summary);
            if let Some(choice) = choices
                .iter_mut()
                .find(|choice| choice.identity.identity_id == summary.identity.identity_id)
            {
                choice.vaults.push(vault);
            } else {
                choices.push(ProviderIdentityChoice {
                    identity: self.named_identity(&summary.identity),
                    standing: IdentityStanding::Unchecked,
                    decisions: Vec::new(),
                    vaults: vec![vault],
                });
            }
        }
        for choice in &mut choices {
            choice.standing = self.standing(choice);
            choice.decisions = self.decisions(&choice.standing);
        }
        choices
    }

    fn standing(&self, choice: &ProviderIdentityChoice) -> IdentityStanding {
        let held_here = match choice.identity.log {
            ProviderIdentityLog::Read { this_browser, .. } => this_browser,
            ProviderIdentityLog::Absent => false,
        };
        if held_here
            || choice
                .vaults
                .iter()
                .any(|vault| vault.access == ProviderVaultAccess::Syncs)
        {
            return IdentityStanding::ThisBrowser;
        }
        for vault in &choice.vaults {
            if let ProviderVaultAccess::OtherIdentityHere { identity_label } = &vault.access {
                return IdentityStanding::OtherIdentityHere {
                    identity_label: identity_label.clone(),
                };
            }
        }
        if let Some(passkey) = self.opening_passkey(&choice.identity) {
            return IdentityStanding::OpenedByPasskey { passkey };
        }
        if choice
            .vaults
            .iter()
            .all(|vault| vault.access == ProviderVaultAccess::Requested)
        {
            return IdentityStanding::JoinRequested;
        }
        if self.passkey_checked() {
            IdentityStanding::NotOpened
        } else {
            IdentityStanding::Unchecked
        }
    }

    /// What a standing allows, **Leave** first. Adding and merging need the
    /// identity's passkey: one a check found, or, on a browser with no
    /// identity yet, the passkey the user taps when the plan runs.
    fn decisions(&self, standing: &IdentityStanding) -> Vec<IdentityDecision> {
        match (standing, self.session) {
            (
                IdentityStanding::ThisBrowser
                | IdentityStanding::OtherIdentityHere { .. }
                | IdentityStanding::JoinRequested,
                _,
            ) => Vec::new(),
            (IdentityStanding::OpenedByPasskey { .. }, IdentitySession::IdentityInUse) => vec![
                IdentityDecision::Leave,
                IdentityDecision::AddToBrowser,
                IdentityDecision::MergeIntoCurrent,
            ],
            (IdentityStanding::OpenedByPasskey { .. }, IdentitySession::NoIdentity) => {
                vec![IdentityDecision::Leave, IdentityDecision::AddToBrowser]
            }
            (IdentityStanding::Unchecked, IdentitySession::NoIdentity) => vec![
                IdentityDecision::Leave,
                IdentityDecision::AddToBrowser,
                IdentityDecision::AskToJoin,
            ],
            (
                IdentityStanding::Unchecked | IdentityStanding::NotOpened,
                IdentitySession::IdentityInUse,
            )
            | (IdentityStanding::NotOpened, IdentitySession::NoIdentity) => {
                vec![IdentityDecision::Leave, IdentityDecision::AskToJoin]
            }
        }
    }

    /// The short id of the first checked passkey that opened the identity.
    fn opening_passkey(&self, identity: &FilingIdentity) -> Option<String> {
        self.checks
            .iter()
            .find_map(|report| match &report.credential {
                CheckedCredential::Passkey { fingerprint } => report
                    .identities
                    .iter()
                    .any(|checked| {
                        checked.identity_id == identity.identity_id
                            && checked.outcome == IdentityCheckOutcome::Opens
                    })
                    .then(|| PasskeyFingerprint(fingerprint).short()),
                CheckedCredential::BackupPassword => None,
            })
    }

    fn passkey_checked(&self) -> bool {
        self.checks
            .iter()
            .any(|report| matches!(report.credential, CheckedCredential::Passkey { .. }))
    }

    fn checked_identities(&self) -> impl Iterator<Item = &IdentityCheck> {
        self.checks.iter().flat_map(|report| &report.identities)
    }

    /// The identity, named once a passkey opened it.
    fn named_identity(&self, identity: &FilingIdentity) -> FilingIdentity {
        let mut named = identity.clone();
        if named.name == ProviderVaultName::Unknown
            && let Some(name) = self
                .checked_identities()
                .filter(|checked| checked.identity_id == identity.identity_id)
                .map(|checked| &checked.name)
                .find(|name| **name != ProviderVaultName::Unknown)
        {
            named.name = name.clone();
        }
        named
    }

    /// The vault, named once a check decrypted it.
    fn named_vault(&self, summary: &ProviderVaultSummary) -> ProviderVaultSummary {
        let mut named = summary.clone();
        if named.name == ProviderVaultName::Unknown
            && let Some(name) = self
                .checked_identities()
                .flat_map(|checked| &checked.vaults)
                .filter(|vault| vault.store_id == summary.store_id)
                .find_map(|vault| match &vault.outcome {
                    VaultCheckOutcome::Opens { name } if *name != ProviderVaultName::Unknown => {
                        Some(name)
                    }
                    VaultCheckOutcome::Opens { .. }
                    | VaultCheckOutcome::DoesNotOpen
                    | VaultCheckOutcome::NoBackupPassword => None,
                })
        {
            named.name = name.clone();
        }
        named
    }
}

/// A passkey's fingerprint, `passkey_` and sixteen hex digits.
struct PasskeyFingerprint<'a>(&'a str);

impl PasskeyFingerprint<'_> {
    /// The eight characters people compare by eye.
    fn short(&self) -> String {
        let raw = self.0;
        raw.strip_prefix("passkey_")
            .unwrap_or(raw)
            .chars()
            .take(8)
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{IdentityId, IdentityWords, ProviderVaultTime, StoreId, VaultCheck};

    struct Fixture;

    impl Fixture {
        fn at(
            choices: &[ProviderIdentityChoice],
            index: usize,
        ) -> anyhow::Result<&ProviderIdentityChoice> {
            choices
                .get(index)
                .ok_or_else(|| anyhow::anyhow!("no identity at {index}"))
        }

        fn first_vault_name(choice: &ProviderIdentityChoice) -> Option<&ProviderVaultName> {
            choice.vaults.first().map(|vault| &vault.name)
        }

        fn identity(raw: &str, log: ProviderIdentityLog) -> anyhow::Result<FilingIdentity> {
            let identity_id = IdentityId::parse(raw)?;
            Ok(FilingIdentity {
                short_id: raw.to_owned(),
                name: ProviderVaultName::Unknown,
                words: IdentityWords::of(&identity_id),
                identity_id,
                log,
            })
        }

        fn vault(
            store: &str,
            identity: &FilingIdentity,
            access: ProviderVaultAccess,
        ) -> anyhow::Result<ProviderVaultSummary> {
            Ok(ProviderVaultSummary {
                store_id: StoreId::parse(store)?,
                short_id: store.to_owned(),
                name: ProviderVaultName::Unknown,
                identity: identity.clone(),
                created: ProviderVaultTime::Unreported,
                last_activity: ProviderVaultTime::Unreported,
                event_count: crate::ProviderEventCount::default(),
                access,
                actions: Vec::new(),
            })
        }

        fn passkey_opening(
            identity: &FilingIdentity,
            store: &str,
        ) -> anyhow::Result<CredentialCheckReport> {
            Ok(CredentialCheckReport {
                credential: CheckedCredential::Passkey {
                    fingerprint: "passkey_a1b2c3d4e5f60708".to_owned(),
                },
                identities: vec![IdentityCheck {
                    identity_id: identity.identity_id.clone(),
                    words: identity.words.clone(),
                    name: ProviderVaultName::named("Personal"),
                    outcome: IdentityCheckOutcome::Opens,
                    vaults: vec![VaultCheck {
                        store_id: StoreId::parse(store)?,
                        short_id: store.to_owned(),
                        outcome: VaultCheckOutcome::Opens {
                            name: ProviderVaultName::named("Family"),
                        },
                    }],
                }],
            })
        }
    }

    const MINE: &str = "idn_mineabcdefg";
    const OTHER: &str = "idn_otherabcdef";
    const MY_VAULT: &str = "store_mineabcdefg";
    const OTHER_VAULT: &str = "store_otherabcdeg";
    const SECOND_VAULT: &str = "store_secondabcdg";

    #[test]
    fn the_identity_this_browser_holds_needs_no_decision() -> anyhow::Result<()> {
        let mine = Fixture::identity(MINE, ProviderIdentityLog::Absent)?;
        let vaults = [Fixture::vault(MY_VAULT, &mine, ProviderVaultAccess::Syncs)?];
        let choices = ProviderIdentityChoices {
            vaults: &vaults,
            checks: &[],
            session: IdentitySession::IdentityInUse,
        }
        .choices();

        assert_eq!(choices.len(), 1);
        assert_eq!(
            Fixture::at(&choices, 0)?.standing,
            IdentityStanding::ThisBrowser
        );
        assert!(Fixture::at(&choices, 0)?.decisions.is_empty());
        Ok(())
    }

    #[test]
    fn vaults_are_grouped_under_their_identity_in_listing_order() -> anyhow::Result<()> {
        let mine = Fixture::identity(MINE, ProviderIdentityLog::Absent)?;
        let other = Fixture::identity(OTHER, ProviderIdentityLog::Absent)?;
        let vaults = [
            Fixture::vault(OTHER_VAULT, &other, ProviderVaultAccess::Locked)?,
            Fixture::vault(MY_VAULT, &mine, ProviderVaultAccess::Syncs)?,
            Fixture::vault(SECOND_VAULT, &other, ProviderVaultAccess::Locked)?,
        ];
        let choices = ProviderIdentityChoices {
            vaults: &vaults,
            checks: &[],
            session: IdentitySession::IdentityInUse,
        }
        .choices();

        let order: Vec<_> = choices
            .iter()
            .map(|choice| (choice.identity.identity_id.as_str(), choice.vaults.len()))
            .collect();
        assert_eq!(order, vec![(OTHER, 2), (MINE, 1)]);
        Ok(())
    }

    #[test]
    fn a_checked_passkey_offers_adding_or_merging_and_names_the_identity() -> anyhow::Result<()> {
        let other = Fixture::identity(OTHER, ProviderIdentityLog::Absent)?;
        let vaults = [Fixture::vault(
            OTHER_VAULT,
            &other,
            ProviderVaultAccess::Locked,
        )?];
        let checks = [Fixture::passkey_opening(&other, OTHER_VAULT)?];
        let choices = ProviderIdentityChoices {
            vaults: &vaults,
            checks: &checks,
            session: IdentitySession::IdentityInUse,
        }
        .choices();

        let choice = Fixture::at(&choices, 0)?;
        assert_eq!(
            choice.standing,
            IdentityStanding::OpenedByPasskey {
                passkey: "a1b2c3d4".to_owned()
            }
        );
        assert_eq!(
            choice.decisions,
            vec![
                IdentityDecision::Leave,
                IdentityDecision::AddToBrowser,
                IdentityDecision::MergeIntoCurrent,
            ]
        );
        assert_eq!(choice.identity.name, ProviderVaultName::named("Personal"));
        assert_eq!(
            Fixture::first_vault_name(choice),
            Some(&ProviderVaultName::named("Family"))
        );
        Ok(())
    }

    #[test]
    fn merging_needs_an_identity_in_use() -> anyhow::Result<()> {
        let other = Fixture::identity(OTHER, ProviderIdentityLog::Absent)?;
        let vaults = [Fixture::vault(
            OTHER_VAULT,
            &other,
            ProviderVaultAccess::Unchecked,
        )?];
        let checks = [Fixture::passkey_opening(&other, OTHER_VAULT)?];
        let choices = ProviderIdentityChoices {
            vaults: &vaults,
            checks: &checks,
            session: IdentitySession::NoIdentity,
        }
        .choices();

        assert_eq!(
            Fixture::at(&choices, 0)?.decisions,
            vec![IdentityDecision::Leave, IdentityDecision::AddToBrowser]
        );
        Ok(())
    }

    #[test]
    fn an_empty_browser_can_recover_or_ask_to_join_an_unchecked_identity() -> anyhow::Result<()> {
        let other = Fixture::identity(OTHER, ProviderIdentityLog::Absent)?;
        let vaults = [Fixture::vault(
            OTHER_VAULT,
            &other,
            ProviderVaultAccess::Unchecked,
        )?];
        let choices = ProviderIdentityChoices {
            vaults: &vaults,
            checks: &[],
            session: IdentitySession::NoIdentity,
        }
        .choices();

        assert_eq!(
            Fixture::at(&choices, 0)?.standing,
            IdentityStanding::Unchecked
        );
        assert_eq!(
            Fixture::at(&choices, 0)?.decisions,
            vec![
                IdentityDecision::Leave,
                IdentityDecision::AddToBrowser,
                IdentityDecision::AskToJoin,
            ]
        );
        Ok(())
    }

    #[test]
    fn an_identity_no_checked_passkey_opens_can_only_be_joined() -> anyhow::Result<()> {
        let mine = Fixture::identity(MINE, ProviderIdentityLog::Absent)?;
        let other = Fixture::identity(OTHER, ProviderIdentityLog::Absent)?;
        let vaults = [
            Fixture::vault(MY_VAULT, &mine, ProviderVaultAccess::Syncs)?,
            Fixture::vault(OTHER_VAULT, &other, ProviderVaultAccess::Locked)?,
        ];
        // The checked passkey opens the identity in use, not the other one.
        let checks = [Fixture::passkey_opening(&mine, MY_VAULT)?];
        let choices = ProviderIdentityChoices {
            vaults: &vaults,
            checks: &checks,
            session: IdentitySession::IdentityInUse,
        }
        .choices();

        assert_eq!(
            Fixture::at(&choices, 1)?.standing,
            IdentityStanding::NotOpened
        );
        assert_eq!(
            Fixture::at(&choices, 1)?.decisions,
            vec![IdentityDecision::Leave, IdentityDecision::AskToJoin]
        );
        Ok(())
    }

    #[test]
    fn a_backup_password_names_a_vault_but_never_opens_its_identity() -> anyhow::Result<()> {
        let other = Fixture::identity(OTHER, ProviderIdentityLog::Absent)?;
        let vaults = [Fixture::vault(
            OTHER_VAULT,
            &other,
            ProviderVaultAccess::Locked,
        )?];
        let mut password = Fixture::passkey_opening(&other, OTHER_VAULT)?;
        password.credential = CheckedCredential::BackupPassword;
        for checked in &mut password.identities {
            checked.outcome = IdentityCheckOutcome::VaultsOnly;
            checked.name = ProviderVaultName::Unknown;
        }
        let checks = [password];
        let choices = ProviderIdentityChoices {
            vaults: &vaults,
            checks: &checks,
            session: IdentitySession::IdentityInUse,
        }
        .choices();

        assert_eq!(
            Fixture::at(&choices, 0)?.standing,
            IdentityStanding::Unchecked
        );
        assert_eq!(
            Fixture::first_vault_name(Fixture::at(&choices, 0)?),
            Some(&ProviderVaultName::named("Family"))
        );
        assert_eq!(
            Fixture::at(&choices, 0)?.identity.name,
            ProviderVaultName::Unknown
        );
        Ok(())
    }
}

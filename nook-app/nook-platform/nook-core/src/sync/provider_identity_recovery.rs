//! Whether a keyring a sync provider lists can be recovered with one of its
//! recovery passphrases: offered beside asking to join wherever this browser
//! may join it and its log lists one. A provider holding one vault lists that
//! vault's keyring for the user's choice too when it can.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use serde::{Deserialize, Serialize};
use tsify::Tsify;

use crate::{IdentitySetup, ProviderIdentityChoices, ProviderIdentityLog, ProviderLogCount};

/// Whether setup offers to recover an identity with one of its recovery
/// passphrases, beside asking to join it. It does when this browser may join
/// the identity and its log lists a passphrase.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub enum IdentityRecoveryOffer {
    Offered,
    NotOffered,
}

impl IdentityRecoveryOffer {
    pub(crate) fn of(setup: IdentitySetup, log: ProviderIdentityLog) -> Self {
        match (setup, log) {
            (
                IdentitySetup::RequestToJoin | IdentitySetup::Waiting,
                ProviderIdentityLog::Read {
                    recovery_passphrases,
                    ..
                },
            ) if recovery_passphrases != ProviderLogCount::default() => Self::Offered,
            (
                IdentitySetup::RequestToJoin | IdentitySetup::Waiting,
                ProviderIdentityLog::Read { .. } | ProviderIdentityLog::Absent,
            )
            | (
                IdentitySetup::Continue { .. } | IdentitySetup::InUse | IdentitySetup::Unavailable,
                ProviderIdentityLog::Read { .. } | ProviderIdentityLog::Absent,
            ) => Self::NotOffered,
        }
    }
}

impl ProviderIdentityChoices<'_> {
    /// Whether a keyring listed here can be recovered with one of its
    /// recovery passphrases. A provider holding only one vault then shows
    /// its keyring for the user's choice too, instead of opening that vault
    /// for a passkey that may be lost with every device.
    #[must_use]
    pub fn recoverable_with_passphrase(&self) -> bool {
        self.choices()
            .iter()
            .any(|choice| choice.recovery == IdentityRecoveryOffer::Offered)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        FilingIdentity, IdentityDecision, IdentityId, IdentitySession, IdentityWords,
        ProviderIdentityChoice, ProviderIdentityJoin, ProviderVaultAccess, ProviderVaultName,
        ProviderVaultSummary, ProviderVaultTime, StoreId,
    };

    const MINE: &str = "idn_mineabcdefg";
    const OTHER: &str = "idn_otherabcdef";
    const OTHER_VAULT: &str = "store_otherabcdeg";

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
    }

    /// Setup offers recovering with a passphrase only for an identity this
    /// browser may join whose log lists one.
    #[test]
    fn recovery_is_offered_beside_joining_when_the_log_lists_a_passphrase() -> anyhow::Result<()> {
        let with_passphrases = |count: u32, join: ProviderIdentityJoin| ProviderIdentityLog::Read {
            devices: crate::ProviderLogCount::from(1),
            newest_device: ProviderVaultTime::Unreported,
            vaults: crate::ProviderLogCount::from(0),
            recovery_passphrases: crate::ProviderLogCount::from(count),
            this_browser: false,
            join,
        };
        let offer = |log: ProviderIdentityLog| -> anyhow::Result<IdentityRecoveryOffer> {
            let identity = Fixture::identity(MINE, log)?;
            let choices = ProviderIdentityChoices {
                vaults: &[],
                identities: &[identity],
                checks: &[],
                session: IdentitySession::NoIdentity,
            }
            .choices();
            Ok(Fixture::at(&choices, 0)?.recovery)
        };
        assert_eq!(
            offer(with_passphrases(2, ProviderIdentityJoin::NotAsked))?,
            IdentityRecoveryOffer::Offered
        );
        // Waiting on a join request still lets the passphrase in instead.
        assert_eq!(
            offer(with_passphrases(1, ProviderIdentityJoin::Requested))?,
            IdentityRecoveryOffer::Offered
        );
        assert_eq!(
            offer(with_passphrases(0, ProviderIdentityJoin::NotAsked))?,
            IdentityRecoveryOffer::NotOffered
        );
        assert_eq!(
            offer(ProviderIdentityLog::Absent)?,
            IdentityRecoveryOffer::NotOffered
        );
        // A browser that can finish joining needs no passphrase.
        assert_eq!(
            offer(with_passphrases(2, ProviderIdentityJoin::Approved))?,
            IdentityRecoveryOffer::NotOffered
        );
        Ok(())
    }

    /// A keyring whose log lists a recovery passphrase can be joined with its
    /// words wherever this browser may join it, before asking its devices;
    /// one without a passphrase, or one this browser finishes joining,
    /// offers no words.
    #[test]
    fn a_keyring_with_a_passphrase_offers_recovering_with_its_words() -> anyhow::Result<()> {
        let decisions = |count: u32,
                         join: ProviderIdentityJoin,
                         session: IdentitySession|
         -> anyhow::Result<Vec<IdentityDecision>> {
            let log = ProviderIdentityLog::Read {
                devices: crate::ProviderLogCount::from(1),
                newest_device: ProviderVaultTime::Unreported,
                vaults: crate::ProviderLogCount::from(0),
                recovery_passphrases: crate::ProviderLogCount::from(count),
                this_browser: false,
                join,
            };
            let identities = [Fixture::identity(OTHER, log)?];
            let choices = ProviderIdentityChoices {
                vaults: &[],
                identities: &identities,
                checks: &[],
                session,
            }
            .choices();
            Ok(Fixture::at(&choices, 0)?.decisions.clone())
        };
        assert_eq!(
            decisions(
                1,
                ProviderIdentityJoin::NotAsked,
                IdentitySession::NoIdentity
            )?,
            vec![
                IdentityDecision::AddToBrowser,
                IdentityDecision::RecoverWithPassphrase,
                IdentityDecision::AskToJoin,
            ]
        );
        assert_eq!(
            decisions(
                2,
                ProviderIdentityJoin::Denied,
                IdentitySession::IdentityInUse
            )?,
            vec![
                IdentityDecision::RecoverWithPassphrase,
                IdentityDecision::AskToJoin
            ]
        );
        // A request waiting on its devices can still be let in by the words.
        assert_eq!(
            decisions(
                1,
                ProviderIdentityJoin::Requested,
                IdentitySession::NoIdentity
            )?,
            vec![IdentityDecision::RecoverWithPassphrase]
        );
        assert_eq!(
            decisions(
                0,
                ProviderIdentityJoin::NotAsked,
                IdentitySession::NoIdentity
            )?,
            vec![IdentityDecision::AddToBrowser, IdentityDecision::AskToJoin]
        );
        assert_eq!(
            decisions(
                1,
                ProviderIdentityJoin::Approved,
                IdentitySession::NoIdentity
            )?,
            vec![IdentityDecision::FinishJoining]
        );
        Ok(())
    }

    /// One vault whose keyring lists a recovery passphrase waits for the
    /// user's choice; one this browser already holds, or a keyring without a
    /// passphrase, opens as before.
    #[test]
    fn a_listing_is_recoverable_with_a_passphrase_only_for_a_keyring_this_browser_may_join()
    -> anyhow::Result<()> {
        let recoverable = |count: u32, this_browser: bool| -> anyhow::Result<bool> {
            let log = ProviderIdentityLog::Read {
                devices: crate::ProviderLogCount::from(1),
                newest_device: ProviderVaultTime::Unreported,
                vaults: crate::ProviderLogCount::from(1),
                recovery_passphrases: crate::ProviderLogCount::from(count),
                this_browser,
                join: ProviderIdentityJoin::NotAsked,
            };
            let other = Fixture::identity(OTHER, log)?;
            let vaults = [Fixture::vault(
                OTHER_VAULT,
                &other,
                ProviderVaultAccess::Unchecked,
            )?];
            Ok(ProviderIdentityChoices {
                vaults: &vaults,
                identities: &[],
                checks: &[],
                session: IdentitySession::NoIdentity,
            }
            .recoverable_with_passphrase())
        };
        assert!(recoverable(1, false)?);
        assert!(!recoverable(0, false)?);
        assert!(!recoverable(1, true)?);
        Ok(())
    }
}

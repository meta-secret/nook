//! Which vaults of its identity a member installation still has to pair.
//!
//! The browser extension keeps one pairing grant per vault. After it joins
//! an identity, vaults other members create later reach it through the
//! identity log; it pairs each vault the identity grants it and it has no
//! grant for. A vault the identity has not granted it yet stays listed, so
//! the extension can say so instead of skipping it.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use serde::{Deserialize, Serialize};
use tsify::Tsify;

use super::identity_control_snapshot::{IdentityControlSnapshot, IdentityControlStanding};

/// This installation's identity and the vaults it already pairs.
pub struct IdentityVaultPairingRequest<'a> {
    pub snapshot: &'a IdentityControlSnapshot,
    /// Store ids of the vaults this installation holds pairing grants for.
    pub paired_store_ids: &'a [String],
}

/// The vaults of the identity left to pair here.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct IdentityVaultPairingPlan {
    pub identity_id: String,
    pub identity_label: String,
    pub standing: IdentityControlStanding,
    /// Vaults whose key the identity grants this installation and that it
    /// does not pair yet.
    pub to_pair: Vec<String>,
    /// Vaults it does not pair whose key the identity has not granted it.
    pub awaiting_grant: Vec<String>,
}

impl IdentityVaultPairingRequest<'_> {
    /// Only an active member pairs the identity's vaults; any other standing
    /// leaves nothing to pair.
    #[must_use]
    pub fn plan(&self) -> IdentityVaultPairingPlan {
        let snapshot = self.snapshot;
        let mut to_pair = Vec::new();
        let mut awaiting_grant = Vec::new();
        if snapshot.standing == IdentityControlStanding::Member {
            for vault in &snapshot.vaults {
                if self.paired_store_ids.contains(&vault.store_id) {
                    continue;
                }
                if vault.granted_to_current_installation {
                    to_pair.push(vault.store_id.clone());
                } else {
                    awaiting_grant.push(vault.store_id.clone());
                }
            }
        }
        IdentityVaultPairingPlan {
            identity_id: snapshot.identity_id.clone(),
            identity_label: snapshot.identity_label.clone(),
            standing: snapshot.standing,
            to_pair,
            awaiting_grant,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::IdentityVaultView;

    fn vault(store_id: &str, granted: bool) -> IdentityVaultView {
        IdentityVaultView {
            store_id: store_id.to_owned(),
            granted_to_current_installation: granted,
            members_missing_dek: Vec::new(),
        }
    }

    fn snapshot(
        standing: IdentityControlStanding,
        vaults: Vec<IdentityVaultView>,
    ) -> IdentityControlSnapshot {
        IdentityControlSnapshot {
            identity_id: "identity-1".to_owned(),
            identity_label: "Family".to_owned(),
            standing,
            members: Vec::new(),
            join_requests: Vec::new(),
            vaults,
            mounts: Vec::new(),
        }
    }

    fn plan(snapshot: &IdentityControlSnapshot, paired: &[&str]) -> IdentityVaultPairingPlan {
        let paired_store_ids = paired.iter().map(|id| (*id).to_owned()).collect::<Vec<_>>();
        IdentityVaultPairingRequest {
            snapshot,
            paired_store_ids: &paired_store_ids,
        }
        .plan()
    }

    #[test]
    fn a_member_pairs_vaults_created_after_it_joined() {
        let identity = snapshot(
            IdentityControlStanding::Member,
            vec![vault("approved", true), vault("later", true)],
        );

        let planned = plan(&identity, &["approved"]);

        assert_eq!(planned.to_pair, vec!["later".to_owned()]);
        assert!(planned.awaiting_grant.is_empty());
        assert_eq!(planned.identity_label, "Family");
    }

    #[test]
    fn a_fully_paired_identity_has_nothing_left() {
        let identity = snapshot(
            IdentityControlStanding::Member,
            vec![vault("approved", true), vault("later", true)],
        );

        let planned = plan(&identity, &["later", "approved"]);

        assert!(planned.to_pair.is_empty());
        assert!(planned.awaiting_grant.is_empty());
    }

    #[test]
    fn a_vault_without_a_grant_here_is_reported_not_paired() {
        let identity = snapshot(
            IdentityControlStanding::Member,
            vec![vault("approved", true), vault("not-shared-yet", false)],
        );

        let planned = plan(&identity, &["approved"]);

        assert!(planned.to_pair.is_empty());
        assert_eq!(planned.awaiting_grant, vec!["not-shared-yet".to_owned()]);
    }

    #[test]
    fn an_installation_that_is_not_an_active_member_pairs_nothing() {
        for standing in [
            IdentityControlStanding::NotReplicated,
            IdentityControlStanding::PendingJoin,
            IdentityControlStanding::Revoked,
            IdentityControlStanding::NotListed,
        ] {
            let identity = snapshot(
                standing,
                vec![vault("granted", true), vault("other", false)],
            );

            let planned = plan(&identity, &[]);

            assert_eq!(planned.standing, standing);
            assert!(planned.to_pair.is_empty());
            assert!(planned.awaiting_grant.is_empty());
        }
    }
}

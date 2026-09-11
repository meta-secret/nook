//! Semantic comparison for identity-held vault DEK grants.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use super::identity::{IdentityMember, IdentityVaultDek, IdentityVaultDekEpoch, MemberDekEnvelope};
use super::multi_device::{AppKey, VaultKeys};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum IdentityVaultGrantReconciliation {
    Current,
    RewrapRequired,
}

impl IdentityVaultDek {
    #[must_use]
    pub(super) fn reconciliation_with(
        &self,
        app_key: &AppKey,
        members: &[IdentityMember],
        keys: &VaultKeys,
        key_epoch: &IdentityVaultDekEpoch,
    ) -> IdentityVaultGrantReconciliation {
        if &self.key_epoch != key_epoch
            || self.secrets_envelopes.len() != members.len()
            || self.members_envelopes.len() != members.len()
        {
            return IdentityVaultGrantReconciliation::RewrapRequired;
        }
        let covers_members = |envelopes: &[MemberDekEnvelope]| {
            members.iter().all(|member| {
                envelopes
                    .iter()
                    .filter(|entry| entry.app_id == member.app_id)
                    .count()
                    == 1
            })
        };
        if !covers_members(&self.secrets_envelopes) || !covers_members(&self.members_envelopes) {
            return IdentityVaultGrantReconciliation::RewrapRequired;
        }
        let super::identity::IdentityVaultAppEnvelopes::Granted { secrets, members } =
            self.app_envelopes(app_key.app_id())
        else {
            return IdentityVaultGrantReconciliation::RewrapRequired;
        };
        if app_key.decrypt_envelope(&secrets.envelope).ok().as_ref() == Some(&keys.secrets_key)
            && app_key.decrypt_envelope(&members.envelope).ok().as_ref() == Some(&keys.members_key)
        {
            IdentityVaultGrantReconciliation::Current
        } else {
            IdentityVaultGrantReconciliation::RewrapRequired
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{AppKey, IdentityMember, IdentityVaultDek, IdentityVaultDekEpoch, VaultKeys};
    use crate::{IdentityRecord, IdentityVaultEventId, MemberLabelState, StoreId};
    use std::mem;

    struct GrantFixture {
        app: AppKey,
        members: Vec<IdentityMember>,
        keys: VaultKeys,
        grant: IdentityVaultDek,
    }

    impl GrantFixture {
        fn new() -> anyhow::Result<Self> {
            let app = AppKey::generate()?;
            let second = AppKey::generate()?;
            let mut identity =
                IdentityRecord::create_with_app_key("Personal", &app, MemberLabelState::Unnamed)?;
            let peer =
                IdentityRecord::create_with_app_key("Peer", &second, MemberLabelState::Unnamed)?;
            identity.members.extend(peer.members);
            let opened_identity =
                identity.generate_vault_dek(StoreId::parse("store_abcdefghijk")?)?;
            identity = opened_identity.identity;
            let keys = opened_identity.keys;
            let grant = identity
                .vault_deks
                .pop()
                .ok_or_else(|| anyhow::anyhow!("missing grant"))?;
            Ok(Self {
                app,
                members: identity.members,
                keys,
                grant,
            })
        }

        fn matches(&self, grant: &IdentityVaultDek) -> bool {
            grant.reconciliation_with(
                &self.app,
                &self.members,
                &self.keys,
                &IdentityVaultDekEpoch::LegacyUnknown,
            ) == super::IdentityVaultGrantReconciliation::Current
        }
    }

    #[test]
    fn matching_grant_covers_each_member_and_both_keys() -> anyhow::Result<()> {
        let fixture = GrantFixture::new()?;
        assert!(fixture.matches(&fixture.grant));
        let mut reordered = fixture.grant.clone();
        reordered.secrets_envelopes.reverse();
        reordered.members_envelopes.reverse();
        assert!(fixture.matches(&reordered));
        Ok(())
    }

    #[test]
    fn missing_and_duplicate_envelopes_do_not_cover_members() -> anyhow::Result<()> {
        let fixture = GrantFixture::new()?;
        let mut missing = fixture.grant.clone();
        missing.secrets_envelopes.clear();
        assert!(!fixture.matches(&missing));
        let mut missing = fixture.grant.clone();
        missing.members_envelopes.clear();
        assert!(!fixture.matches(&missing));
        let mut duplicate = fixture.grant.clone();
        let first = duplicate
            .secrets_envelopes
            .first()
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("fixture must contain a secrets envelope"))?;
        *duplicate
            .secrets_envelopes
            .get_mut(1)
            .ok_or_else(|| anyhow::anyhow!("fixture must contain two secrets envelopes"))? = first;
        assert!(!fixture.matches(&duplicate));
        let mut duplicate = fixture.grant.clone();
        let first = duplicate
            .members_envelopes
            .first()
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("fixture must contain a members envelope"))?;
        *duplicate
            .members_envelopes
            .get_mut(1)
            .ok_or_else(|| anyhow::anyhow!("fixture must contain two members envelopes"))? = first;
        assert!(!fixture.matches(&duplicate));
        Ok(())
    }

    #[test]
    fn epoch_or_either_key_mismatch_requires_rewrapping() -> anyhow::Result<()> {
        let mut fixture = GrantFixture::new()?;
        let epoch = IdentityVaultDekEpoch::Known {
            key_epoch: IdentityVaultEventId::parse(&format!("sha256u:{}", "a".repeat(43)))?,
            checkpoint: IdentityVaultEventId::parse(&format!("sha256u:{}", "b".repeat(43)))?,
        };
        assert_eq!(
            fixture.grant.reconciliation_with(
                &fixture.app,
                &fixture.members,
                &fixture.keys,
                &epoch
            ),
            super::IdentityVaultGrantReconciliation::RewrapRequired
        );
        let different = crate::VaultKeys::generate()?;
        let original = mem::replace(&mut fixture.keys.secrets_key, different.secrets_key);
        assert!(!fixture.matches(&fixture.grant));
        fixture.keys.secrets_key = original;
        fixture.keys.members_key = different.members_key;
        assert!(!fixture.matches(&fixture.grant));
        Ok(())
    }

    #[test]
    fn undecryptable_current_app_envelope_is_not_a_matching_grant() -> anyhow::Result<()> {
        let fixture = GrantFixture::new()?;
        let other = AppKey::generate()?;
        let encrypted_for_other = other
            .public_key()
            .seal_bytes(fixture.keys.secrets_key.as_str().as_bytes())?;
        let mut unreadable = fixture.grant.clone();
        unreadable
            .secrets_envelopes
            .first_mut()
            .ok_or_else(|| anyhow::anyhow!("fixture must contain a secrets envelope"))?
            .envelope = encrypted_for_other;
        assert!(!fixture.matches(&unreadable));
        let mut unreadable = fixture.grant.clone();
        unreadable
            .members_envelopes
            .first_mut()
            .ok_or_else(|| anyhow::anyhow!("fixture must contain a members envelope"))?
            .envelope = other
            .public_key()
            .seal_bytes(fixture.keys.members_key.as_str().as_bytes())?;
        assert!(!fixture.matches(&unreadable));
        Ok(())
    }
}

//! Semantic comparison for identity-held vault DEK grants.

use super::identity::{IdentityMember, IdentityVaultDek, MemberDekEnvelope};
use super::multi_device::{AppKey, VaultKeys};

pub(super) fn already_grants(
    vault_dek: &IdentityVaultDek,
    app_key: &AppKey,
    members: &[IdentityMember],
    keys: &VaultKeys,
) -> bool {
    if vault_dek.secrets_envelopes.len() != members.len()
        || vault_dek.members_envelopes.len() != members.len()
    {
        return false;
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
    if !covers_members(&vault_dek.secrets_envelopes)
        || !covers_members(&vault_dek.members_envelopes)
    {
        return false;
    }
    let decrypt_for_app = |envelopes: &[MemberDekEnvelope]| {
        envelopes
            .iter()
            .find(|entry| entry.app_id == *app_key.app_id())
            .and_then(|entry| app_key.decrypt_envelope(&entry.envelope).ok())
    };
    decrypt_for_app(&vault_dek.secrets_envelopes).as_ref() == Some(&keys.secrets_key)
        && decrypt_for_app(&vault_dek.members_envelopes).as_ref() == Some(&keys.members_key)
}

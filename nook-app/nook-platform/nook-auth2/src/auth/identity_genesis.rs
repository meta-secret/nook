//! Vault authorization rows derived from an identity's complete app-key roster.

use super::identity::IdentityRecord;
use super::multi_device::{VaultKeys, VaultMember, auth_record, build_members_records};
use crate::{MultiDeviceError, MultiDeviceResult, StoredSecretRecord};

/// Authorize every member of an identity in a new Simple vault.
pub fn identity_vault_genesis_records(
    identity: &IdentityRecord,
    keys: &VaultKeys,
    enrolled_at: &str,
) -> MultiDeviceResult<Vec<StoredSecretRecord>> {
    if identity.members.is_empty() {
        return Err(MultiDeviceError::InvalidDeviceIdentity(
            "identity must have at least one app key before vault genesis".to_owned(),
        ));
    }
    let mut records = Vec::with_capacity(identity.members.len().saturating_mul(2));
    let mut roster = Vec::with_capacity(identity.members.len());
    for member in &identity.members {
        if crate::app_id_from_public_key(&member.public_key)? != member.app_id
            || crate::dec_auth_id_from_public_key(&member.public_key)? != member.auth_id
        {
            return Err(MultiDeviceError::InvalidDeviceIdentity(
                "identity member key material does not match its identifiers".to_owned(),
            ));
        }
        records.push(auth_record(
            &member.auth_id,
            &keys.secrets_key,
            &keys.members_key,
            &member.public_key,
        )?);
        roster.push(VaultMember {
            auth_id: member.auth_id.clone(),
            device_id: member.app_id.clone(),
            public_key: member.public_key.clone(),
            enrolled_at: enrolled_at.to_owned(),
            label: member.label.clone(),
        });
    }
    records.extend(build_members_records(&roster, &keys.members_key)?);
    Ok(records)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{AppKey, IdentityMember, resolve_members_key, resolve_secrets_key};

    #[test]
    fn genesis_authorizes_every_identity_member() -> anyhow::Result<()> {
        let first = AppKey::generate()?;
        let second = AppKey::generate()?;
        let mut identity = IdentityRecord::create_with_app_key("Personal", &first, None)?;
        identity.add_member(IdentityMember {
            app_id: second.app_id().clone(),
            auth_id: second.auth_id(),
            public_key: second.public_key(),
            signing_public_key: crate::DeviceSigningPublicKey::Unavailable,
            label: Some("Phone".to_owned()),
        })?;
        let keys = crate::generate_vault_keys()?;
        let records = identity_vault_genesis_records(&identity, &keys, "genesis")?;

        for app_key in [&first, &second] {
            assert_eq!(resolve_secrets_key(&records, app_key)?, keys.secrets_key);
            assert_eq!(resolve_members_key(&records, app_key)?, keys.members_key);
        }
        Ok(())
    }
}

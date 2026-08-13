//! First-class Identity: passkeys, app-key members, and identity-owned vault DEKs.

use crate::errors::{MultiDeviceError, MultiDeviceResult, ValidationError, ValidationResult};
use crate::{
    AgeArmoredCiphertext, AppId, AppKey, AuthKeyId, DevicePublicKey, StoreId, VaultKeys,
    encrypt_for_recipient, generate_id, generate_vault_keys,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const IDENTITY_ID_PREFIX: &str = "idn_";

/// Stable identity identifier (`idn_{compact_token}`).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct IdentityId(String);

impl IdentityId {
    pub fn generate() -> MultiDeviceResult<Self> {
        let token = generate_id()?;
        Ok(Self(format!("{IDENTITY_ID_PREFIX}{}", token.as_str())))
    }

    pub fn parse(raw: &str) -> ValidationResult<Self> {
        let trimmed = raw.trim();
        let Some(suffix) = trimmed.strip_prefix(IDENTITY_ID_PREFIX) else {
            return Err(ValidationError::StoreIdInvalid);
        };
        if !crate::is_compact_token(suffix) {
            return Err(ValidationError::StoreIdInvalid);
        }
        Ok(Self(trimmed.to_owned()))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for IdentityId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// One app-key member of an identity.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct IdentityMember {
    pub app_id: AppId,
    pub auth_id: AuthKeyId,
    pub public_key: DevicePublicKey,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

/// Identity-held DEK envelopes for one vault.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct IdentityVaultDek {
    pub store_id: StoreId,
    /// Age ciphertext of `secrets_key` for each member app public key.
    pub secrets_envelopes: Vec<MemberDekEnvelope>,
    /// Age ciphertext of `members_key` for each member app public key.
    pub members_envelopes: Vec<MemberDekEnvelope>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MemberDekEnvelope {
    pub app_id: AppId,
    pub envelope: AgeArmoredCiphertext,
}

/// Local identity control record. Owns per-vault DEKs.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct IdentityRecord {
    pub identity_id: IdentityId,
    pub label: String,
    pub control_epoch: u64,
    pub members: Vec<IdentityMember>,
    pub vault_deks: Vec<IdentityVaultDek>,
    /// Sentinel vaults associated with this identity. Their quorum-protected
    /// roots are never represented as app-key DEK envelopes.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sentinel_vaults: Vec<StoreId>,
}

impl IdentityRecord {
    /// Create an identity that already has one app-key member.
    pub fn create_with_app_key(
        label: impl Into<String>,
        app_key: &AppKey,
        member_label: Option<String>,
    ) -> MultiDeviceResult<Self> {
        Ok(Self {
            identity_id: IdentityId::generate()?,
            label: label.into(),
            control_epoch: 1,
            members: vec![IdentityMember {
                app_id: app_key.app_id().clone(),
                auth_id: app_key.auth_id(),
                public_key: app_key.public_key(),
                label: member_label,
            }],
            vault_deks: Vec::new(),
            sentinel_vaults: Vec::new(),
        })
    }

    #[must_use]
    pub fn has_members(&self) -> bool {
        !self.members.is_empty()
    }

    /// Generate vault DEKs and wrap them to every current member.
    ///
    /// A vault cannot be created until this succeeds.
    pub fn generate_vault_dek(&mut self, store_id: StoreId) -> MultiDeviceResult<VaultKeys> {
        if !self.has_members() {
            return Err(MultiDeviceError::InvalidDeviceIdentity(
                "identity must have at least one app key before creating a vault".to_owned(),
            ));
        }
        if self
            .vault_deks
            .iter()
            .any(|entry| entry.store_id == store_id)
        {
            return Err(MultiDeviceError::InvalidDeviceIdentity(
                "identity already holds a DEK for this vault".to_owned(),
            ));
        }
        let keys = generate_vault_keys()?;
        let vault_dek = wrap_vault_keys_for_members(&keys, &self.members, store_id)?;
        self.control_epoch = self.control_epoch.saturating_add(1);
        self.vault_deks.push(vault_dek);
        Ok(keys)
    }

    /// Re-wrap every vault DEK to the current member set after membership change.
    pub fn rewrap_vault_deks(
        &mut self,
        keys_by_store: &[(StoreId, VaultKeys)],
    ) -> MultiDeviceResult<()> {
        let mut next = Vec::with_capacity(keys_by_store.len());
        for (store_id, keys) in keys_by_store {
            next.push(wrap_vault_keys_for_members(
                keys,
                &self.members,
                store_id.clone(),
            )?);
        }
        self.control_epoch = self.control_epoch.saturating_add(1);
        self.vault_deks = next;
        Ok(())
    }

    pub fn add_member(&mut self, member: IdentityMember) -> MultiDeviceResult<()> {
        if self
            .members
            .iter()
            .any(|existing| existing.app_id == member.app_id)
        {
            return Err(MultiDeviceError::InvalidDeviceIdentity(
                "app key is already a member of this identity".to_owned(),
            ));
        }
        self.members.push(member);
        self.control_epoch = self.control_epoch.saturating_add(1);
        Ok(())
    }

    pub fn remove_member(&mut self, app_id: &AppId) -> MultiDeviceResult<()> {
        let Some(index) = self
            .members
            .iter()
            .position(|member| &member.app_id == app_id)
        else {
            return Err(MultiDeviceError::InvalidDeviceIdentity(
                "app key is not a member of this identity".to_owned(),
            ));
        };
        if self.members.len() == 1 {
            return Err(MultiDeviceError::InvalidDeviceIdentity(
                "identity must keep at least one app key".to_owned(),
            ));
        }
        self.members.remove(index);
        self.control_epoch = self.control_epoch.saturating_add(1);
        Ok(())
    }

    #[must_use]
    pub fn vault_dek(&self, store_id: &StoreId) -> Option<&IdentityVaultDek> {
        self.vault_deks
            .iter()
            .find(|entry| &entry.store_id == store_id)
    }

    #[must_use]
    pub fn owns_vault(&self, store_id: &StoreId) -> bool {
        self.vault_dek(store_id).is_some() || self.sentinel_vaults.contains(store_id)
    }

    pub fn associate_sentinel_vault(&mut self, store_id: StoreId) {
        if !self.owns_vault(&store_id) {
            self.sentinel_vaults.push(store_id);
            self.control_epoch = self.control_epoch.saturating_add(1);
        }
    }

    pub fn reconcile_legacy_vault_member(
        &mut self,
        app_key: &AppKey,
        store_id: &StoreId,
        secrets_envelope: AgeArmoredCiphertext,
        members_envelope: AgeArmoredCiphertext,
    ) -> MultiDeviceResult<()> {
        if let Some(existing) = self
            .members
            .iter()
            .find(|member| member.app_id == *app_key.app_id())
        {
            if existing.auth_id != app_key.auth_id() || existing.public_key != app_key.public_key()
            {
                return Err(MultiDeviceError::InvalidDeviceIdentity(
                    "existing app id has different key material".to_owned(),
                ));
            }
        } else {
            self.add_member(IdentityMember {
                app_id: app_key.app_id().clone(),
                auth_id: app_key.auth_id(),
                public_key: app_key.public_key(),
                label: None,
            })?;
        }
        let vault_dek = self
            .vault_deks
            .iter_mut()
            .find(|entry| entry.store_id == *store_id)
            .ok_or_else(|| {
                MultiDeviceError::InvalidDeviceIdentity(
                    "identity does not own this legacy vault".to_owned(),
                )
            })?;
        if !vault_dek
            .secrets_envelopes
            .iter()
            .any(|entry| entry.app_id == *app_key.app_id())
        {
            vault_dek.secrets_envelopes.push(MemberDekEnvelope {
                app_id: app_key.app_id().clone(),
                envelope: secrets_envelope,
            });
            vault_dek.members_envelopes.push(MemberDekEnvelope {
                app_id: app_key.app_id().clone(),
                envelope: members_envelope,
            });
            self.control_epoch = self.control_epoch.saturating_add(1);
        }
        Ok(())
    }

    /// Synthesize an identity from a legacy vault member + auth envelopes.
    pub fn synthesize_from_legacy_vault(
        label: impl Into<String>,
        member: IdentityMember,
        store_id: StoreId,
        secrets_envelope: AgeArmoredCiphertext,
        members_envelope: AgeArmoredCiphertext,
    ) -> MultiDeviceResult<Self> {
        let identity_id = IdentityId::generate()?;
        Ok(Self {
            identity_id,
            label: label.into(),
            control_epoch: 1,
            members: vec![member.clone()],
            vault_deks: vec![IdentityVaultDek {
                store_id,
                secrets_envelopes: vec![MemberDekEnvelope {
                    app_id: member.app_id.clone(),
                    envelope: secrets_envelope,
                }],
                members_envelopes: vec![MemberDekEnvelope {
                    app_id: member.app_id,
                    envelope: members_envelope,
                }],
            }],
            sentinel_vaults: Vec::new(),
        })
    }
}

fn wrap_vault_keys_for_members(
    keys: &VaultKeys,
    members: &[IdentityMember],
    store_id: StoreId,
) -> MultiDeviceResult<IdentityVaultDek> {
    let mut secrets_envelopes = Vec::with_capacity(members.len());
    let mut members_envelopes = Vec::with_capacity(members.len());
    for member in members {
        secrets_envelopes.push(MemberDekEnvelope {
            app_id: member.app_id.clone(),
            envelope: encrypt_for_recipient(
                keys.secrets_key.as_str().as_bytes(),
                &member.public_key,
            )?,
        });
        members_envelopes.push(MemberDekEnvelope {
            app_id: member.app_id.clone(),
            envelope: encrypt_for_recipient(
                keys.members_key.as_str().as_bytes(),
                &member.public_key,
            )?,
        });
    }
    Ok(IdentityVaultDek {
        store_id,
        secrets_envelopes,
        members_envelopes,
    })
}

/// Deterministic identity fingerprint for UI progressive disclosure.
#[must_use]
pub fn identity_fingerprint(identity_id: &IdentityId) -> String {
    let hash = Sha256::digest(identity_id.as_str().as_bytes());
    hex::encode(&hash[..8])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::AppKey;

    #[test]
    fn identity_requires_member_before_vault_dek() -> anyhow::Result<()> {
        let mut identity = IdentityRecord {
            identity_id: IdentityId::generate()?,
            label: "Empty".to_owned(),
            control_epoch: 1,
            members: Vec::new(),
            vault_deks: Vec::new(),
            sentinel_vaults: Vec::new(),
        };
        let store = StoreId::before_genesis_placeholder();
        assert!(identity.generate_vault_dek(store).is_err());
        Ok(())
    }

    #[test]
    fn identity_generates_dek_for_members() -> anyhow::Result<()> {
        let app_key = AppKey::generate()?;
        let mut identity = IdentityRecord::create_with_app_key("Personal", &app_key, None)?;
        let store = StoreId::parse("store_abcdefghijk")?;
        let keys = identity.generate_vault_dek(store.clone())?;
        let vault_dek = identity
            .vault_dek(&store)
            .ok_or_else(|| anyhow::anyhow!("identity DEK missing after generate"))?;
        let opened = app_key.decrypt_envelope(&vault_dek.secrets_envelopes[0].envelope)?;
        assert_eq!(opened.as_str(), keys.secrets_key.as_str());
        Ok(())
    }

    #[test]
    fn member_remove_keeps_at_least_one_app_key() -> anyhow::Result<()> {
        let first = AppKey::generate()?;
        let second = AppKey::generate()?;
        let mut identity = IdentityRecord::create_with_app_key("Personal", &first, None)?;
        identity.add_member(IdentityMember {
            app_id: second.app_id().clone(),
            auth_id: second.auth_id(),
            public_key: second.public_key(),
            label: None,
        })?;
        identity.remove_member(second.app_id())?;
        assert!(identity.remove_member(first.app_id()).is_err());
        Ok(())
    }
}

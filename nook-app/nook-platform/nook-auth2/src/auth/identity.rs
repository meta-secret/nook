//! First-class Identity: passkeys, app-key members, and identity-owned vault DEKs.

use crate::errors::{MultiDeviceError, MultiDeviceResult, ValidationError, ValidationResult};
use crate::{
    AgeArmoredCiphertext, AppId, AppKey, AuthKeyId, DevicePublicKey, DeviceSigningPublicKey,
    StoreId, VaultKeys, encrypt_for_recipient, generate_id, generate_vault_keys,
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
    #[serde(default, skip_serializing_if = "DeviceSigningPublicKey::is_empty")]
    pub signing_public_key: DeviceSigningPublicKey,
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

#[derive(Debug, Clone)]
pub struct IdentityVaultDekReconciliation {
    pub secrets_envelope: AgeArmoredCiphertext,
    pub members_envelope: AgeArmoredCiphertext,
    pub authorized_auth_ids: Vec<AuthKeyId>,
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
                signing_public_key: DeviceSigningPublicKey::Unavailable,
                label: member_label,
            }],
            vault_deks: Vec::new(),
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

    /// Reopen a previously committed DEK on retry, or generate it once.
    pub fn open_or_generate_vault_dek(
        &mut self,
        app_key: &AppKey,
        store_id: StoreId,
    ) -> MultiDeviceResult<VaultKeys> {
        let member = self
            .members
            .iter()
            .find(|member| member.app_id == *app_key.app_id())
            .ok_or(MultiDeviceError::IdentityEnrollmentRequired)?;
        if member.auth_id != app_key.auth_id() || member.public_key != app_key.public_key() {
            return Err(MultiDeviceError::InvalidDeviceIdentity(
                "existing app id has different key material".to_owned(),
            ));
        }
        let Some(vault_dek) = self.vault_dek(&store_id) else {
            return self.generate_vault_dek(store_id);
        };
        let secrets = vault_dek
            .secrets_envelopes
            .iter()
            .find(|entry| entry.app_id == *app_key.app_id())
            .ok_or(MultiDeviceError::IdentityEnrollmentRequired)?;
        let members = vault_dek
            .members_envelopes
            .iter()
            .find(|entry| entry.app_id == *app_key.app_id())
            .ok_or(MultiDeviceError::IdentityEnrollmentRequired)?;
        Ok(VaultKeys {
            secrets_key: app_key.decrypt_envelope(&secrets.envelope)?,
            members_key: app_key.decrypt_envelope(&members.envelope)?,
        })
    }

    /// Grant a newly authenticated member only to vaults the authorizing app
    /// key could already open. Preserve each vault's existing recipient set so
    /// identity membership cannot resurrect a vault-level revocation.
    pub fn grant_member_to_vaults(
        &mut self,
        member: &IdentityMember,
        keys_by_store: &[(StoreId, VaultKeys)],
    ) -> MultiDeviceResult<()> {
        for (store_id, keys) in keys_by_store {
            let index = self
                .vault_deks
                .iter()
                .position(|grant| grant.store_id == *store_id)
                .ok_or_else(|| {
                    MultiDeviceError::InvalidDeviceIdentity(
                        "identity does not own the vault being granted".to_owned(),
                    )
                })?;
            let grant = &self.vault_deks[index];
            let authorized_app_ids = grant
                .secrets_envelopes
                .iter()
                .map(|entry| entry.app_id.clone())
                .collect::<Vec<_>>();
            let members_cover_same_apps = authorized_app_ids.len() == grant.members_envelopes.len()
                && authorized_app_ids.iter().all(|app_id| {
                    grant
                        .members_envelopes
                        .iter()
                        .filter(|entry| entry.app_id == *app_id)
                        .count()
                        == 1
                });
            if !members_cover_same_apps {
                return Err(MultiDeviceError::InvalidDeviceIdentity(
                    "identity vault grant has inconsistent recipient envelopes".to_owned(),
                ));
            }
            let mut authorized_members = authorized_app_ids
                .iter()
                .map(|app_id| {
                    self.members
                        .iter()
                        .find(|candidate| candidate.app_id == *app_id)
                        .cloned()
                        .ok_or_else(|| {
                            MultiDeviceError::InvalidDeviceIdentity(
                                "vault grant references an unknown identity member".to_owned(),
                            )
                        })
                })
                .collect::<MultiDeviceResult<Vec<_>>>()?;
            if authorized_members
                .iter()
                .all(|candidate| candidate.app_id != member.app_id)
            {
                authorized_members.push(member.clone());
            }
            self.vault_deks[index] =
                wrap_vault_keys_for_members(keys, &authorized_members, store_id.clone())?;
        }
        if !keys_by_store.is_empty() {
            self.control_epoch = self.control_epoch.saturating_add(1);
        }
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
        self.add_prevalidated_member(member);
        Ok(())
    }

    pub fn set_member_signing_public_key(
        &mut self,
        app_id: &AppId,
        signing_public_key: &DeviceSigningPublicKey,
    ) -> MultiDeviceResult<()> {
        let member = self
            .members
            .iter_mut()
            .find(|member| &member.app_id == app_id)
            .ok_or(MultiDeviceError::IdentityEnrollmentRequired)?;
        if member.signing_public_key != *signing_public_key {
            member.signing_public_key = signing_public_key.clone();
            self.control_epoch = self.control_epoch.saturating_add(1);
        }
        Ok(())
    }

    pub(crate) fn add_prevalidated_member(&mut self, member: IdentityMember) {
        let is_new = self
            .members
            .iter()
            .all(|existing| existing.app_id != member.app_id);
        debug_assert!(is_new, "identity member must be validated before mutation");
        self.members.push(member);
        self.control_epoch = self.control_epoch.saturating_add(1);
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
        self.vault_dek(store_id).is_some()
    }

    pub fn reconcile_legacy_vault_member(
        &mut self,
        app_key: &AppKey,
        store_id: &StoreId,
        reconciliation: &IdentityVaultDekReconciliation,
    ) -> MultiDeviceResult<()> {
        let existing = self
            .members
            .iter()
            .find(|member| member.app_id == *app_key.app_id())
            .ok_or(MultiDeviceError::IdentityEnrollmentRequired)?;
        if existing.auth_id != app_key.auth_id() || existing.public_key != app_key.public_key() {
            return Err(MultiDeviceError::InvalidDeviceIdentity(
                "existing app id has different key material".to_owned(),
            ));
        }
        let vault_dek_index = self
            .vault_deks
            .iter()
            .position(|entry| entry.store_id == *store_id)
            .ok_or_else(|| {
                MultiDeviceError::InvalidDeviceIdentity(
                    "identity does not own this legacy vault".to_owned(),
                )
            })?;
        let vault_dek = &self.vault_deks[vault_dek_index];
        let keys = VaultKeys {
            secrets_key: app_key.decrypt_envelope(&reconciliation.secrets_envelope)?,
            members_key: app_key.decrypt_envelope(&reconciliation.members_envelope)?,
        };
        let authorized_members = self
            .members
            .iter()
            .filter(|member| reconciliation.authorized_auth_ids.contains(&member.auth_id))
            .cloned()
            .collect::<Vec<_>>();
        if !authorized_members
            .iter()
            .any(|member| member.app_id == *app_key.app_id())
        {
            return Err(MultiDeviceError::InvalidDeviceIdentity(
                "reconciling app key is not authorized for this vault".to_owned(),
            ));
        }
        if crate::auth::identity_dek_grant::already_grants(
            vault_dek,
            app_key,
            &authorized_members,
            &keys,
        ) {
            return Ok(());
        }
        let rewrapped = wrap_vault_keys_for_members(&keys, &authorized_members, store_id.clone())?;
        if *vault_dek != rewrapped {
            self.vault_deks[vault_dek_index] = rewrapped;
            self.control_epoch = self.control_epoch.saturating_add(1);
        }
        Ok(())
    }

    pub fn import_legacy_vault(
        &mut self,
        app_key: &AppKey,
        store_id: StoreId,
        reconciliation: &IdentityVaultDekReconciliation,
    ) -> MultiDeviceResult<()> {
        let existing = self
            .members
            .iter()
            .find(|member| member.app_id == *app_key.app_id())
            .ok_or(MultiDeviceError::IdentityEnrollmentRequired)?;
        if existing.auth_id != app_key.auth_id() || existing.public_key != app_key.public_key() {
            return Err(MultiDeviceError::InvalidDeviceIdentity(
                "existing app id has different key material".to_owned(),
            ));
        }
        let keys = VaultKeys {
            secrets_key: app_key.decrypt_envelope(&reconciliation.secrets_envelope)?,
            members_key: app_key.decrypt_envelope(&reconciliation.members_envelope)?,
        };
        let authorized_members = self
            .members
            .iter()
            .filter(|member| reconciliation.authorized_auth_ids.contains(&member.auth_id))
            .cloned()
            .collect::<Vec<_>>();
        if !authorized_members
            .iter()
            .any(|member| member.app_id == *app_key.app_id())
        {
            return Err(MultiDeviceError::InvalidDeviceIdentity(
                "importing app key is not authorized for this vault".to_owned(),
            ));
        }
        self.vault_deks.push(wrap_vault_keys_for_members(
            &keys,
            &authorized_members,
            store_id,
        )?);
        self.control_epoch = self.control_epoch.saturating_add(1);
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
        };
        let store = StoreId::before_genesis_placeholder();
        assert!(identity.generate_vault_dek(store).is_err());
        Ok(())
    }

    #[test]
    fn identity_generates_dek_for_members() -> anyhow::Result<()> {
        let app_key = AppKey::generate()?;
        let second_key = AppKey::generate()?;
        let mut identity = IdentityRecord::create_with_app_key("Personal", &app_key, None)?;
        identity.add_member(IdentityMember {
            app_id: second_key.app_id().clone(),
            auth_id: second_key.auth_id(),
            public_key: second_key.public_key(),
            signing_public_key: DeviceSigningPublicKey::Unavailable,
            label: None,
        })?;
        let store = StoreId::parse("store_abcdefghijk")?;
        let keys = identity.generate_vault_dek(store.clone())?;
        let vault_dek = identity
            .vault_dek(&store)
            .ok_or_else(|| anyhow::anyhow!("identity DEK missing after generate"))?;
        let opened = app_key.decrypt_envelope(&vault_dek.secrets_envelopes[0].envelope)?;
        assert_eq!(opened.as_str(), keys.secrets_key.as_str());
        let reopened = identity.open_or_generate_vault_dek(&app_key, store.clone())?;
        assert_eq!(reopened, keys);
        assert_eq!(identity.vault_deks.len(), 1);
        let rotated = crate::generate_vault_keys()?;
        identity.reconcile_legacy_vault_member(
            &app_key,
            &store,
            &IdentityVaultDekReconciliation {
                secrets_envelope: crate::encrypt_for_recipient(
                    rotated.secrets_key.as_str().as_bytes(),
                    &app_key.public_key(),
                )?,
                members_envelope: crate::encrypt_for_recipient(
                    rotated.members_key.as_str().as_bytes(),
                    &app_key.public_key(),
                )?,
                authorized_auth_ids: vec![app_key.auth_id(), second_key.auth_id()],
            },
        )?;
        assert_eq!(
            identity.open_or_generate_vault_dek(&app_key, store.clone())?,
            rotated
        );
        assert_eq!(
            identity.open_or_generate_vault_dek(&second_key, store)?,
            rotated
        );
        Ok(())
    }

    #[test]
    fn reconciliation_excludes_identity_member_revoked_from_vault() -> anyhow::Result<()> {
        let active = AppKey::generate()?;
        let revoked = AppKey::generate()?;
        let mut identity = IdentityRecord::create_with_app_key("Personal", &active, None)?;
        identity.add_member(IdentityMember {
            app_id: revoked.app_id().clone(),
            auth_id: revoked.auth_id(),
            public_key: revoked.public_key(),
            signing_public_key: DeviceSigningPublicKey::Unavailable,
            label: None,
        })?;
        let store = StoreId::parse("store_abcdefghijk")?;
        let _ = identity.generate_vault_dek(store.clone())?;
        let rotated = crate::generate_vault_keys()?;
        let mut reconciliation = reconciliation_for_keys(&active, &rotated)?;
        reconciliation.authorized_auth_ids = vec![active.auth_id()];

        identity.reconcile_legacy_vault_member(&active, &store, &reconciliation)?;

        assert_eq!(
            identity.open_or_generate_vault_dek(&active, store.clone())?,
            rotated
        );
        assert!(
            identity
                .open_or_generate_vault_dek(&revoked, store)
                .is_err()
        );
        Ok(())
    }

    fn reconciliation_for_keys(
        app_key: &AppKey,
        keys: &VaultKeys,
    ) -> anyhow::Result<IdentityVaultDekReconciliation> {
        Ok(IdentityVaultDekReconciliation {
            secrets_envelope: crate::encrypt_for_recipient(
                keys.secrets_key.as_str().as_bytes(),
                &app_key.public_key(),
            )?,
            members_envelope: crate::encrypt_for_recipient(
                keys.members_key.as_str().as_bytes(),
                &app_key.public_key(),
            )?,
            authorized_auth_ids: vec![app_key.auth_id()],
        })
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
            signing_public_key: DeviceSigningPublicKey::Unavailable,
            label: None,
        })?;
        identity.remove_member(second.app_id())?;
        assert!(identity.remove_member(first.app_id()).is_err());
        Ok(())
    }

    #[test]
    fn member_signing_key_migrates_from_unavailable_and_persists() -> anyhow::Result<()> {
        let app_key = AppKey::generate()?;
        let mut identity = IdentityRecord::create_with_app_key("Personal", &app_key, None)?;
        let legacy_json = serde_json::to_string(&identity)?;
        let legacy: IdentityRecord = serde_json::from_str(&legacy_json)?;
        assert!(legacy.members[0].signing_public_key.is_empty());

        let signing_public_key = DeviceSigningPublicKey::parse(&"11".repeat(32))?;
        identity.set_member_signing_public_key(app_key.app_id(), &signing_public_key)?;
        let restored: IdentityRecord = serde_json::from_str(&serde_json::to_string(&identity)?)?;
        assert_eq!(restored.members[0].signing_public_key, signing_public_key);
        Ok(())
    }
}

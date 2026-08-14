//! First-class Identity: passkeys, app-key members, and identity-owned vault DEKs.

use crate::errors::{MultiDeviceError, MultiDeviceResult, ValidationError, ValidationResult};
use crate::{
    AgeArmoredCiphertext, AppId, AppKey, AuthKeyId, DevicePublicKey, Sha256Hex, StoreId, VaultKeys,
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
    #[serde(default)]
    pub key_epoch: IdentityVaultDekEpoch,
    /// Age ciphertext of `secrets_key` for each member app public key.
    pub secrets_envelopes: Vec<MemberDekEnvelope>,
    /// Age ciphertext of `members_key` for each member app public key.
    pub members_envelopes: Vec<MemberDekEnvelope>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum IdentityVaultDekEpoch {
    #[default]
    LegacyUnknown,
    Known {
        key_epoch: Sha256Hex,
        checkpoint: Sha256Hex,
    },
}

#[derive(Debug, Clone)]
pub enum IdentityVaultDekEpochUpdate {
    Observe {
        key_epoch: IdentityVaultDekEpoch,
    },
    Rotate {
        previous_key_epoch: Sha256Hex,
        previous_checkpoint: Sha256Hex,
        key_epoch: Sha256Hex,
        checkpoint: Sha256Hex,
    },
}

impl IdentityVaultDekEpochUpdate {
    #[must_use]
    pub fn committed_epoch(&self) -> IdentityVaultDekEpoch {
        match self {
            Self::Observe { key_epoch } => key_epoch.clone(),
            Self::Rotate {
                key_epoch,
                checkpoint,
                ..
            } => IdentityVaultDekEpoch::Known {
                key_epoch: key_epoch.clone(),
                checkpoint: checkpoint.clone(),
            },
        }
    }
}

#[derive(Debug, Clone)]
pub struct IdentityVaultDekReconciliation {
    pub secrets_envelope: AgeArmoredCiphertext,
    pub members_envelope: AgeArmoredCiphertext,
    pub epoch_update: IdentityVaultDekEpochUpdate,
}

impl IdentityVaultDek {
    fn next_epoch(
        &self,
        update: &IdentityVaultDekEpochUpdate,
    ) -> MultiDeviceResult<IdentityVaultDekEpoch> {
        let next = match (&self.key_epoch, update) {
            (
                IdentityVaultDekEpoch::LegacyUnknown,
                IdentityVaultDekEpochUpdate::Observe { key_epoch },
            ) => key_epoch.clone(),
            (
                IdentityVaultDekEpoch::Known {
                    key_epoch: current_epoch,
                    ..
                },
                IdentityVaultDekEpochUpdate::Observe {
                    key_epoch:
                        IdentityVaultDekEpoch::Known {
                            key_epoch,
                            checkpoint,
                        },
                },
            ) if current_epoch == key_epoch => IdentityVaultDekEpoch::Known {
                key_epoch: key_epoch.clone(),
                checkpoint: checkpoint.clone(),
            },
            (
                IdentityVaultDekEpoch::LegacyUnknown,
                IdentityVaultDekEpochUpdate::Rotate {
                    key_epoch,
                    checkpoint,
                    ..
                },
            ) => IdentityVaultDekEpoch::Known {
                key_epoch: key_epoch.clone(),
                checkpoint: checkpoint.clone(),
            },
            (
                IdentityVaultDekEpoch::Known {
                    key_epoch: current_epoch,
                    checkpoint: current_checkpoint,
                },
                IdentityVaultDekEpochUpdate::Rotate {
                    previous_key_epoch,
                    previous_checkpoint,
                    key_epoch,
                    checkpoint,
                },
            ) if (current_epoch == previous_key_epoch
                && current_checkpoint == previous_checkpoint)
                || (current_epoch == key_epoch && current_checkpoint == checkpoint) =>
            {
                IdentityVaultDekEpoch::Known {
                    key_epoch: key_epoch.clone(),
                    checkpoint: checkpoint.clone(),
                }
            }
            (current, update) => {
                let expected = match update {
                    IdentityVaultDekEpochUpdate::Observe { key_epoch } => epoch_label(key_epoch),
                    IdentityVaultDekEpochUpdate::Rotate {
                        previous_key_epoch,
                        previous_checkpoint,
                        ..
                    } => format!("{previous_key_epoch}@{previous_checkpoint}"),
                };
                return Err(MultiDeviceError::StaleVaultDekEpoch {
                    expected,
                    actual: epoch_label(current),
                });
            }
        };
        Ok(next)
    }
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
        reconciliation: IdentityVaultDekReconciliation,
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
        let next_epoch = vault_dek.next_epoch(&reconciliation.epoch_update)?;
        let secrets_entry = vault_dek
            .secrets_envelopes
            .iter()
            .position(|entry| entry.app_id == *app_key.app_id());
        let members_entry = vault_dek
            .members_envelopes
            .iter()
            .position(|entry| entry.app_id == *app_key.app_id());
        match (secrets_entry, members_entry) {
            (Some(secrets_index), Some(members_index)) => {
                if vault_dek.secrets_envelopes[secrets_index].envelope
                    != reconciliation.secrets_envelope
                    || vault_dek.members_envelopes[members_index].envelope
                        != reconciliation.members_envelope
                    || vault_dek.key_epoch != next_epoch
                {
                    let vault_dek = &mut self.vault_deks[vault_dek_index];
                    vault_dek.secrets_envelopes[secrets_index].envelope =
                        reconciliation.secrets_envelope;
                    vault_dek.members_envelopes[members_index].envelope =
                        reconciliation.members_envelope;
                    vault_dek.key_epoch = next_epoch;
                    self.control_epoch = self.control_epoch.saturating_add(1);
                }
            }
            (None, None) => {
                let vault_dek = &mut self.vault_deks[vault_dek_index];
                vault_dek.secrets_envelopes.push(MemberDekEnvelope {
                    app_id: app_key.app_id().clone(),
                    envelope: reconciliation.secrets_envelope,
                });
                vault_dek.members_envelopes.push(MemberDekEnvelope {
                    app_id: app_key.app_id().clone(),
                    envelope: reconciliation.members_envelope,
                });
                vault_dek.key_epoch = next_epoch;
                self.control_epoch = self.control_epoch.saturating_add(1);
            }
            _ => {
                return Err(MultiDeviceError::InvalidDeviceIdentity(
                    "vault DEK envelope sets are inconsistent".to_owned(),
                ));
            }
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
        key_epoch: IdentityVaultDekEpoch,
    ) -> MultiDeviceResult<Self> {
        let identity_id = IdentityId::generate()?;
        Ok(Self {
            identity_id,
            label: label.into(),
            control_epoch: 1,
            members: vec![member.clone()],
            vault_deks: vec![IdentityVaultDek {
                store_id,
                key_epoch,
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
        key_epoch: IdentityVaultDekEpoch::LegacyUnknown,
        secrets_envelopes,
        members_envelopes,
    })
}

fn epoch_label(epoch: &IdentityVaultDekEpoch) -> String {
    match epoch {
        IdentityVaultDekEpoch::LegacyUnknown => "legacy-unknown".to_owned(),
        IdentityVaultDekEpoch::Known {
            key_epoch,
            checkpoint,
        } => format!("{key_epoch}@{checkpoint}"),
    }
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
        let reopened = identity.open_or_generate_vault_dek(&app_key, store.clone())?;
        assert_eq!(reopened, keys);
        assert_eq!(identity.vault_deks.len(), 1);
        let rotated = crate::generate_vault_keys()?;
        identity.reconcile_legacy_vault_member(
            &app_key,
            &store,
            IdentityVaultDekReconciliation {
                secrets_envelope: crate::encrypt_for_recipient(
                    rotated.secrets_key.as_str().as_bytes(),
                    &app_key.public_key(),
                )?,
                members_envelope: crate::encrypt_for_recipient(
                    rotated.members_key.as_str().as_bytes(),
                    &app_key.public_key(),
                )?,
                epoch_update: IdentityVaultDekEpochUpdate::Observe {
                    key_epoch: IdentityVaultDekEpoch::LegacyUnknown,
                },
            },
        )?;
        assert_eq!(
            identity.open_or_generate_vault_dek(&app_key, store)?,
            rotated
        );
        Ok(())
    }

    #[test]
    fn stale_dek_observation_cannot_overwrite_rotated_epoch() -> anyhow::Result<()> {
        let app_key = AppKey::generate()?;
        let mut identity = IdentityRecord::create_with_app_key("Personal", &app_key, None)?;
        let store = StoreId::parse("store_abcdefghijk")?;
        let original = identity.generate_vault_dek(store.clone())?;
        let previous = Sha256Hex::parse(&"1".repeat(64))?;
        let current = Sha256Hex::parse(&"2".repeat(64))?;
        let previous_checkpoint = Sha256Hex::parse(&"3".repeat(64))?;
        let current_checkpoint = Sha256Hex::parse(&"4".repeat(64))?;
        let rotated = crate::generate_vault_keys()?;
        let rotated_reconciliation = reconciliation_for_keys(
            &app_key,
            &rotated,
            IdentityVaultDekEpochUpdate::Rotate {
                previous_key_epoch: previous.clone(),
                previous_checkpoint: previous_checkpoint.clone(),
                key_epoch: current.clone(),
                checkpoint: current_checkpoint,
            },
        )?;
        identity.reconcile_legacy_vault_member(&app_key, &store, rotated_reconciliation.clone())?;
        identity.reconcile_legacy_vault_member(&app_key, &store, rotated_reconciliation)?;

        let stale = reconciliation_for_keys(
            &app_key,
            &original,
            IdentityVaultDekEpochUpdate::Observe {
                key_epoch: IdentityVaultDekEpoch::Known {
                    key_epoch: previous,
                    checkpoint: previous_checkpoint,
                },
            },
        )?;
        assert!(matches!(
            identity.reconcile_legacy_vault_member(&app_key, &store, stale),
            Err(MultiDeviceError::StaleVaultDekEpoch { .. })
        ));
        assert_eq!(
            identity.open_or_generate_vault_dek(&app_key, store)?,
            rotated
        );
        Ok(())
    }

    #[test]
    fn same_dek_epoch_accepts_an_advanced_event_checkpoint() -> anyhow::Result<()> {
        let app_key = AppKey::generate()?;
        let mut identity = IdentityRecord::create_with_app_key("Personal", &app_key, None)?;
        let store = StoreId::parse("store_abcdefghijk")?;
        let keys = identity.generate_vault_dek(store.clone())?;
        let key_epoch = Sha256Hex::parse(&"1".repeat(64))?;
        let first_checkpoint = Sha256Hex::parse(&"2".repeat(64))?;
        let advanced_checkpoint = Sha256Hex::parse(&"3".repeat(64))?;
        let first = reconciliation_for_keys(
            &app_key,
            &keys,
            IdentityVaultDekEpochUpdate::Rotate {
                previous_key_epoch: key_epoch.clone(),
                previous_checkpoint: key_epoch.clone(),
                key_epoch: key_epoch.clone(),
                checkpoint: first_checkpoint,
            },
        )?;
        identity.reconcile_legacy_vault_member(&app_key, &store, first)?;

        let advanced = reconciliation_for_keys(
            &app_key,
            &keys,
            IdentityVaultDekEpochUpdate::Observe {
                key_epoch: IdentityVaultDekEpoch::Known {
                    key_epoch: key_epoch.clone(),
                    checkpoint: advanced_checkpoint.clone(),
                },
            },
        )?;
        identity.reconcile_legacy_vault_member(&app_key, &store, advanced)?;

        assert_eq!(
            identity.vault_dek(&store).map(|dek| &dek.key_epoch),
            Some(&IdentityVaultDekEpoch::Known {
                key_epoch,
                checkpoint: advanced_checkpoint,
            })
        );
        Ok(())
    }

    fn reconciliation_for_keys(
        app_key: &AppKey,
        keys: &VaultKeys,
        epoch_update: IdentityVaultDekEpochUpdate,
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
            epoch_update,
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
            label: None,
        })?;
        identity.remove_member(second.app_id())?;
        assert!(identity.remove_member(first.app_id()).is_err());
        Ok(())
    }
}

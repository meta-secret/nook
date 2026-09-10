//! First-class Identity: passkeys, app-key members, and identity-owned vault DEKs.
mod legacy;

pub enum IdentityVaultBinding<'a> {
    Bound(&'a IdentityVaultDek),
    Unbound,
}

enum CommittedVaultKeys {
    Opened(VaultKeys),
    VaultNotCreated,
}

use crate::MemberLabelState;
use std::fmt;

use crate::errors::{MultiDeviceError, MultiDeviceResult, ValidationError, ValidationResult};
use crate::{
    AgeArmoredCiphertext, AppId, AppKey, AuthKeyId, CompactToken, DevicePublicKey,
    DeviceSigningPublicKey, IdentityControlEpoch, IdentityVaultEventId, StoreId, VaultKeys,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

mod transition;
pub use transition::{
    IdentityLegacyVaultImport, IdentityLegacyVaultReconciliation, IdentityMemberSigningUpdate,
    IdentityMemberVaultGrant, IdentityRecordRejection, IdentityVaultKeyOpening, IdentityVaultKeys,
};

const IDENTITY_ID_PREFIX: &str = "idn_";

/// Stable identity identifier (`idn_{compact_token}`).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct IdentityId(String);

impl IdentityId {
    pub fn generate() -> MultiDeviceResult<Self> {
        let token = CompactToken::generate()?;
        Ok(Self(format!("{IDENTITY_ID_PREFIX}{}", token.as_str())))
    }

    pub fn parse(raw: &str) -> ValidationResult<Self> {
        let trimmed = raw.trim();
        let Some(suffix) = trimmed.strip_prefix(IDENTITY_ID_PREFIX) else {
            return Err(ValidationError::StoreIdInvalid);
        };
        if !crate::CompactToken::is_valid(suffix) {
            return Err(ValidationError::StoreIdInvalid);
        }
        Ok(Self(trimmed.to_owned()))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for IdentityId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
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
    #[serde(default, skip_serializing_if = "MemberLabelState::is_unnamed")]
    pub label: MemberLabelState,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdentityMemberKeyBinding {
    Matches,
    DifferentKeyMaterial,
}
impl IdentityMember {
    pub fn binding_to_app_key(&self, app: &AppKey) -> IdentityMemberKeyBinding {
        if self.auth_id == app.auth_id() && self.public_key == app.public_key() {
            IdentityMemberKeyBinding::Matches
        } else {
            IdentityMemberKeyBinding::DifferentKeyMaterial
        }
    }
    pub(super) fn binding_to_member(&self, other: &Self) -> IdentityMemberKeyBinding {
        if self.auth_id == other.auth_id && self.public_key == other.public_key {
            IdentityMemberKeyBinding::Matches
        } else {
            IdentityMemberKeyBinding::DifferentKeyMaterial
        }
    }
}

pub enum IdentityVaultAppEnvelopes<'a> {
    NotGranted,
    Granted {
        secrets: &'a MemberDekEnvelope,
        members: &'a MemberDekEnvelope,
    },
}
impl IdentityVaultDek {
    pub fn app_envelopes(&self, app_id: &AppId) -> IdentityVaultAppEnvelopes<'_> {
        let secrets = self
            .secrets_envelopes
            .iter()
            .find(|entry| &entry.app_id == app_id);
        let members = self
            .members_envelopes
            .iter()
            .find(|entry| &entry.app_id == app_id);
        match (secrets, members) {
            (Some(secrets), Some(members)) => {
                IdentityVaultAppEnvelopes::Granted { secrets, members }
            }
            _ => IdentityVaultAppEnvelopes::NotGranted,
        }
    }
}

/// Identity-held DEK envelopes for one vault.
///
/// Grant comparison is internal to identity reconciliation:
/// ```compile_fail,E0624
/// use nook_auth2::{AppKey, IdentityMember, IdentityVaultDek, IdentityVaultDekEpoch, VaultKeys};
/// let compare = |grant: &IdentityVaultDek, app: &AppKey, members: &[IdentityMember],
///                keys: &VaultKeys, epoch: &IdentityVaultDekEpoch| {
///     grant.reconciliation_with(app, members, keys, epoch)
/// };
/// ```
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
        key_epoch: IdentityVaultEventId,
        checkpoint: IdentityVaultEventId,
    },
}

#[derive(Debug, Clone)]
pub enum IdentityVaultDekEpochUpdate {
    Observe {
        key_epoch: IdentityVaultDekEpoch,
        checkpoint_ancestors: Vec<IdentityVaultEventId>,
    },
    Rotate {
        previous_key_epoch: IdentityVaultEventId,
        previous_checkpoint_ancestors: Vec<IdentityVaultEventId>,
        key_epoch: IdentityVaultEventId,
        checkpoint: IdentityVaultEventId,
    },
}

impl IdentityVaultDekEpochUpdate {
    #[must_use]
    pub fn committed_epoch(&self) -> IdentityVaultDekEpoch {
        match self {
            Self::Observe { key_epoch, .. } => key_epoch.clone(),
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
    pub control_epoch: IdentityControlEpoch,
    pub members: Vec<IdentityMember>,
    pub vault_deks: Vec<IdentityVaultDek>,
}

impl IdentityRecord {
    /// Create an identity that already has one app-key member.
    pub fn create_with_app_key(
        label: impl Into<String>,
        app_key: &AppKey,
        member_label: MemberLabelState,
    ) -> MultiDeviceResult<Self> {
        Ok(Self {
            identity_id: IdentityId::generate()?,
            label: label.into(),
            control_epoch: IdentityControlEpoch::INITIAL,
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

    /// Whether this identity authorizes the supplied public app-key member.
    #[must_use]
    pub fn has_app_id(&self, app_id: &AppId) -> bool {
        self.members.iter().any(|member| member.app_id == *app_id)
    }

    /// Generate vault DEKs and wrap them to every current member.
    ///
    /// A vault cannot be created until this succeeds.
    pub fn generate_vault_dek(
        mut self,
        store_id: StoreId,
    ) -> Result<IdentityVaultKeys, IdentityRecordRejection> {
        let generated: MultiDeviceResult<VaultKeys> = (|| {
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
            let keys = VaultKeys::generate()?;
            let vault_dek =
                IdentityVaultDek::wrap_vault_keys_for_members(WrapVaultKeysForMembersRequest {
                    keys: &keys,
                    members: &self.members,
                    store_id: store_id,
                })?;
            self.control_epoch = self.control_epoch.next();
            self.vault_deks.push(vault_dek);
            Ok(keys)
        })();
        match generated {
            Ok(keys) => Ok(IdentityVaultKeys {
                identity: self,
                keys,
            }),
            Err(cause) => Err(IdentityRecordRejection {
                identity: self,
                cause,
            }),
        }
    }

    /// Reopen a previously committed DEK on retry, or generate it once.
    fn existing_vault_keys(
        &self,
        request: &IdentityVaultKeyOpening<'_>,
    ) -> MultiDeviceResult<CommittedVaultKeys> {
        let IdentityVaultKeyOpening { app_key, store_id } = request;
        let member = self
            .members
            .iter()
            .find(|member| member.app_id == *app_key.app_id())
            .ok_or(MultiDeviceError::IdentityEnrollmentRequired)?;
        if matches!(
            member.binding_to_app_key(app_key),
            IdentityMemberKeyBinding::DifferentKeyMaterial
        ) {
            return Err(MultiDeviceError::InvalidDeviceIdentity(
                "existing app id has different key material".to_owned(),
            ));
        }
        let IdentityVaultBinding::Bound(vault_dek) = self.vault_dek(&store_id) else {
            return Ok(CommittedVaultKeys::VaultNotCreated);
        };
        let IdentityVaultAppEnvelopes::Granted { secrets, members } =
            vault_dek.app_envelopes(app_key.app_id())
        else {
            return Err(MultiDeviceError::IdentityEnrollmentRequired);
        };
        Ok(CommittedVaultKeys::Opened(VaultKeys {
            secrets_key: app_key.decrypt_envelope(&secrets.envelope)?,
            members_key: app_key.decrypt_envelope(&members.envelope)?,
        }))
    }

    pub fn open_vault_dek(
        &self,
        request: IdentityVaultKeyOpening<'_>,
    ) -> MultiDeviceResult<VaultKeys> {
        match self.existing_vault_keys(&request)? {
            CommittedVaultKeys::Opened(keys) => Ok(keys),
            CommittedVaultKeys::VaultNotCreated => {
                Err(MultiDeviceError::IdentityEnrollmentRequired)
            }
        }
    }

    pub fn open_or_generate_vault_dek(
        self,
        request: IdentityVaultKeyOpening<'_>,
    ) -> Result<IdentityVaultKeys, IdentityRecordRejection> {
        match self.existing_vault_keys(&request) {
            Ok(CommittedVaultKeys::Opened(keys)) => Ok(IdentityVaultKeys {
                identity: self,
                keys,
            }),
            Ok(CommittedVaultKeys::VaultNotCreated) => self.generate_vault_dek(request.store_id),
            Err(cause) => Err(IdentityRecordRejection {
                identity: self,
                cause,
            }),
        }
    }

    /// Grant a newly authenticated member only to vaults the authorizing app
    /// key could already open. Preserve each vault's existing recipient set so
    /// identity membership cannot resurrect a vault-level revocation.
    pub fn grant_member_to_vaults(
        mut self,
        request: IdentityMemberVaultGrant<'_>,
    ) -> Result<Self, IdentityRecordRejection> {
        let IdentityMemberVaultGrant {
            member,
            keys_by_store,
        } = request;
        let result: MultiDeviceResult<()> = (|| {
            let mut replacements = Vec::with_capacity(keys_by_store.len());
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
                let members_cover_same_apps = authorized_app_ids.len()
                    == grant.members_envelopes.len()
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
                let key_epoch = self.vault_deks[index].key_epoch.clone();
                let mut replacement = IdentityVaultDek::wrap_vault_keys_for_members(
                    WrapVaultKeysForMembersRequest {
                        keys: keys,
                        members: &authorized_members,
                        store_id: store_id.clone(),
                    },
                )?;
                replacement.key_epoch = key_epoch;
                replacements.push((index, replacement));
            }
            for (index, replacement) in replacements {
                self.vault_deks[index] = replacement;
            }
            if !keys_by_store.is_empty() {
                self.control_epoch = self.control_epoch.next();
            }
            Ok(())
        })();
        match result {
            Ok(()) => Ok(self),
            Err(cause) => Err(IdentityRecordRejection {
                identity: self,
                cause,
            }),
        }
    }

    pub fn add_member(mut self, member: IdentityMember) -> Result<Self, IdentityRecordRejection> {
        let result: MultiDeviceResult<()> = (|| {
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
            self.control_epoch = self.control_epoch.next();
            Ok(())
        })();
        match result {
            Ok(()) => Ok(self),
            Err(cause) => Err(IdentityRecordRejection {
                identity: self,
                cause,
            }),
        }
    }

    pub fn set_member_signing_public_key(
        mut self,
        request: IdentityMemberSigningUpdate<'_>,
    ) -> Result<Self, IdentityRecordRejection> {
        let IdentityMemberSigningUpdate {
            app_id,
            signing_public_key,
        } = request;
        let result: MultiDeviceResult<()> = (|| {
            let member = self
                .members
                .iter_mut()
                .find(|member| &member.app_id == app_id)
                .ok_or(MultiDeviceError::IdentityEnrollmentRequired)?;
            if member.signing_public_key != *signing_public_key {
                member.signing_public_key = signing_public_key.clone();
                self.control_epoch = self.control_epoch.next();
            }
            Ok(())
        })();
        match result {
            Ok(()) => Ok(self),
            Err(cause) => Err(IdentityRecordRejection {
                identity: self,
                cause,
            }),
        }
    }

    pub(crate) fn add_prevalidated_member(mut self, member: IdentityMember) -> Self {
        let is_new = self
            .members
            .iter()
            .all(|existing| existing.app_id != member.app_id);
        debug_assert!(is_new, "identity member must be validated before mutation");
        self.members.push(member);
        self.control_epoch = self.control_epoch.next();
        self
    }

    pub fn remove_member(mut self, app_id: &AppId) -> Result<Self, IdentityRecordRejection> {
        let result: MultiDeviceResult<()> = (|| {
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
            for vault_dek in &mut self.vault_deks {
                vault_dek
                    .secrets_envelopes
                    .retain(|envelope| &envelope.app_id != app_id);
                vault_dek
                    .members_envelopes
                    .retain(|envelope| &envelope.app_id != app_id);
            }
            self.members.remove(index);
            self.control_epoch = self.control_epoch.next();
            Ok(())
        })();
        match result {
            Ok(()) => Ok(self),
            Err(cause) => Err(IdentityRecordRejection {
                identity: self,
                cause,
            }),
        }
    }

    #[must_use]
    pub fn vault_dek(&self, store_id: &StoreId) -> IdentityVaultBinding<'_> {
        match self
            .vault_deks
            .iter()
            .find(|entry| &entry.store_id == store_id)
        {
            Some(dek) => IdentityVaultBinding::Bound(dek),
            None => IdentityVaultBinding::Unbound,
        }
    }

    #[must_use]
    pub fn owns_vault(&self, store_id: &StoreId) -> bool {
        matches!(self.vault_dek(store_id), IdentityVaultBinding::Bound(_))
    }
}

/// Named values required by IdentityVaultDek::wrap_vault_keys_for_members.
struct WrapVaultKeysForMembersRequest<'a> {
    keys: &'a VaultKeys,
    members: &'a [IdentityMember],
    store_id: StoreId,
}

impl IdentityVaultDek {
    fn wrap_vault_keys_for_members(
        request: WrapVaultKeysForMembersRequest<'_>,
    ) -> MultiDeviceResult<IdentityVaultDek> {
        let WrapVaultKeysForMembersRequest {
            keys,
            members,
            store_id,
        } = request;
        let mut secrets_envelopes = Vec::with_capacity(members.len());
        let mut members_envelopes = Vec::with_capacity(members.len());
        for member in members {
            secrets_envelopes.push(MemberDekEnvelope {
                app_id: member.app_id.clone(),
                envelope: member
                    .public_key
                    .seal_bytes(keys.secrets_key.as_str().as_bytes())?,
            });
            members_envelopes.push(MemberDekEnvelope {
                app_id: member.app_id.clone(),
                envelope: member
                    .public_key
                    .seal_bytes(keys.members_key.as_str().as_bytes())?,
            });
        }
        Ok(IdentityVaultDek {
            store_id,
            key_epoch: IdentityVaultDekEpoch::LegacyUnknown,
            secrets_envelopes,
            members_envelopes,
        })
    }
}

/// Deterministic identity fingerprint for UI progressive disclosure.
impl IdentityId {
    #[must_use]
    pub fn identity_fingerprint(identity_id: &IdentityId) -> String {
        let hash = Sha256::digest(identity_id.as_str().as_bytes());
        hex::encode(&hash[..8])
    }
}

#[cfg(test)]
mod tests {

    use super::*;
    use crate::AppKey;
    use crate::{
        IdentityLegacyVaultReconciliation, IdentityMemberSigningUpdate, IdentityVaultKeyOpening,
    };

    #[test]
    fn identity_requires_member_before_vault_dek() -> anyhow::Result<()> {
        let mut identity = IdentityRecord {
            identity_id: IdentityId::generate()?,
            label: "Empty".to_owned(),
            control_epoch: IdentityControlEpoch::INITIAL,
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
        let mut identity =
            IdentityRecord::create_with_app_key("Personal", &app_key, MemberLabelState::Unnamed)?;
        identity = identity.add_member(IdentityMember {
            app_id: second_key.app_id().clone(),
            auth_id: second_key.auth_id(),
            public_key: second_key.public_key(),
            signing_public_key: DeviceSigningPublicKey::Unavailable,
            label: MemberLabelState::Unnamed,
        })?;
        let store = StoreId::parse("store_abcdefghijk")?;
        let opened_identity = identity.generate_vault_dek(store.clone())?;
        identity = opened_identity.identity;
        let keys = opened_identity.keys;
        assert!(identity.has_app_id(app_key.app_id()));
        assert!(identity.has_app_id(second_key.app_id()));
        assert!(identity.owns_vault(&store));
        let IdentityVaultBinding::Bound(vault_dek) = identity.vault_dek(&store) else {
            anyhow::bail!("identity DEK missing after generate")
        };
        let opened = app_key.decrypt_envelope(&vault_dek.secrets_envelopes[0].envelope)?;
        assert_eq!(opened.as_str(), keys.secrets_key.as_str());
        let opened_identity = identity.open_or_generate_vault_dek(IdentityVaultKeyOpening {
            app_key: &app_key,
            store_id: store.clone(),
        })?;
        identity = opened_identity.identity;
        let reopened = opened_identity.keys;
        assert_eq!(reopened, keys);
        assert_eq!(identity.vault_deks.len(), 1);
        let rotated = crate::VaultKeys::generate()?;
        identity = identity.reconcile_legacy_vault_member(IdentityLegacyVaultReconciliation {
            app_key: &app_key,
            store_id: &store,
            reconciliation: &IdentityVaultDekReconciliation {
                secrets_envelope: app_key
                    .public_key()
                    .seal_bytes(rotated.secrets_key.as_str().as_bytes())?,
                members_envelope: app_key
                    .public_key()
                    .seal_bytes(rotated.members_key.as_str().as_bytes())?,
                epoch_update: IdentityVaultDekEpochUpdate::Observe {
                    key_epoch: IdentityVaultDekEpoch::LegacyUnknown,
                    checkpoint_ancestors: Vec::new(),
                },
                authorized_auth_ids: vec![app_key.auth_id(), second_key.auth_id()],
            },
        })?;
        assert_eq!(
            identity.open_vault_dek(IdentityVaultKeyOpening {
                app_key: &app_key,
                store_id: store.clone()
            })?,
            rotated
        );
        assert_eq!(
            identity.open_vault_dek(IdentityVaultKeyOpening {
                app_key: &second_key,
                store_id: store
            })?,
            rotated
        );
        Ok(())
    }

    #[test]
    fn member_remove_keeps_at_least_one_app_key() -> anyhow::Result<()> {
        let first = AppKey::generate()?;
        let second = AppKey::generate()?;
        let mut identity =
            IdentityRecord::create_with_app_key("Personal", &first, MemberLabelState::Unnamed)?;
        identity = identity.add_member(IdentityMember {
            app_id: second.app_id().clone(),
            auth_id: second.auth_id(),
            public_key: second.public_key(),
            signing_public_key: DeviceSigningPublicKey::Unavailable,
            label: MemberLabelState::Unnamed,
        })?;
        let store_id = crate::StoreId::generate()?;
        let opened_identity = identity.generate_vault_dek(store_id.clone())?;
        identity = opened_identity.identity;
        identity = identity.remove_member(second.app_id())?;
        let IdentityVaultBinding::Bound(vault_dek) = identity.vault_dek(&store_id) else {
            anyhow::bail!("vault DEK is missing")
        };
        assert!(
            vault_dek
                .secrets_envelopes
                .iter()
                .all(|envelope| envelope.app_id != *second.app_id())
        );
        assert!(
            vault_dek
                .members_envelopes
                .iter()
                .all(|envelope| envelope.app_id != *second.app_id())
        );
        let opened_identity = identity.open_or_generate_vault_dek(IdentityVaultKeyOpening {
            app_key: &first,
            store_id: store_id,
        })?;
        identity = opened_identity.identity;
        assert!(identity.remove_member(first.app_id()).is_err());
        Ok(())
    }

    #[test]
    fn member_signing_key_migrates_from_unavailable_and_persists() -> anyhow::Result<()> {
        let app_key = AppKey::generate()?;
        let mut identity =
            IdentityRecord::create_with_app_key("Personal", &app_key, MemberLabelState::Unnamed)?;
        let legacy_json = serde_json::to_string(&identity)?;
        let legacy: IdentityRecord = serde_json::from_str(&legacy_json)?;
        assert!(legacy.members[0].signing_public_key.is_empty());

        let signing_public_key = DeviceSigningPublicKey::parse(&"11".repeat(32))?;
        identity = identity.set_member_signing_public_key(IdentityMemberSigningUpdate {
            app_id: app_key.app_id(),
            signing_public_key: &signing_public_key,
        })?;
        let restored: IdentityRecord = serde_json::from_str(&serde_json::to_string(&identity)?)?;
        assert_eq!(restored.members[0].signing_public_key, signing_public_key);
        Ok(())
    }
}

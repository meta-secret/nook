//! Signed identity control appends and DEK-wrapping operation builders.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use ed25519_dalek::SigningKey;
use nook_auth2::{AppId, DeviceSigningPublicKey, IdentityId, IsoTimestamp, StoreId, VaultKeys};

use super::graph::IdentityControlLog;
use super::projection::IdentityControlState;
use super::wire::{
    IdentityControlOperation, IdentityEvent, IdentityEventBody, IdentityEventSchemaVersion,
    IdentityMemberKeys, IdentityVaultDekGrant, MemberVaultDek,
};
use crate::signing::SigningIdentity;
use crate::{EventError, EventId, EventResult};

/// Named values required to sign one identity control event.
pub struct IdentityEventSigning<'a> {
    pub signing_key: &'a SigningKey,
    pub created_at: &'a IsoTimestamp,
}

/// Named values required to create an identity's genesis event.
pub struct IdentityGenesisRequest<'a> {
    pub identity_id: &'a IdentityId,
    pub founder: IdentityMemberKeys,
    pub signing: IdentityEventSigning<'a>,
}

/// One vault's DEK at a key epoch, opened by the acting member.
#[derive(Clone, Copy)]
pub struct OpenedVaultDek<'a> {
    pub store_id: &'a StoreId,
    pub key_epoch: &'a EventId,
    pub keys: &'a VaultKeys,
}

/// Named values required to approve a pending join.
pub struct IdentityApprovalRequest<'a> {
    pub app_id: &'a AppId,
    /// Every vault the identity owns, opened by the approver at its current epoch.
    pub vaults: &'a [OpenedVaultDek<'a>],
}

/// Named values required to register a vault with its owning identity.
#[derive(Clone, Copy)]
pub struct IdentityVaultRegistration<'a> {
    pub dek: OpenedVaultDek<'a>,
}

impl IdentityEvent {
    fn signed(
        identity_id: &IdentityId,
        parents: Vec<EventId>,
        operations: Vec<IdentityControlOperation>,
        signing: &IdentityEventSigning<'_>,
    ) -> EventResult<Self> {
        let verifying_key = signing.signing_key.verifying_key();
        let body = IdentityEventBody {
            schema_version: IdentityEventSchemaVersion::CURRENT,
            identity_id: identity_id.clone(),
            actor_id: SigningIdentity::actor_id_for_verifying_key(&verifying_key)?,
            actor_signing_public_key: DeviceSigningPublicKey::from_trusted(hex::encode(
                verifying_key.as_bytes(),
            )),
            parents,
            created_at: signing.created_at.clone(),
            operations,
        };
        Self::sign(body, signing.signing_key)
    }

    /// Create the founder-signed genesis event.
    pub fn genesis(request: IdentityGenesisRequest<'_>) -> EventResult<Self> {
        let IdentityGenesisRequest {
            identity_id,
            founder,
            signing,
        } = request;
        Self::signed(
            identity_id,
            Vec::new(),
            vec![IdentityControlOperation::IdentityCreated { founder }],
            &signing,
        )
    }
}

impl IdentityControlLog {
    /// Sign operations on top of every applicable head.
    pub fn build_append(
        &self,
        operations: Vec<IdentityControlOperation>,
        signing: &IdentityEventSigning<'_>,
    ) -> EventResult<IdentityEvent> {
        let heads = self.applicable_heads();
        if heads.is_empty() {
            return Err(EventError::IdentityControlInvalid(
                "identity log has no applicable genesis to extend".to_owned(),
            ));
        }
        IdentityEvent::signed(self.identity_id(), heads, operations, signing)
    }
}

impl IdentityMemberKeys {
    pub(super) fn wrap_vault_keys(&self, keys: &VaultKeys) -> EventResult<MemberVaultDek> {
        let seal = |plaintext: &str| {
            self.encryption_public_key
                .seal_bytes(plaintext.as_bytes())
                .map_err(|error| EventError::IdentityControlInvalid(error.to_string()))
        };
        Ok(MemberVaultDek {
            app_id: self.app_id.clone(),
            secrets_key_ciphertext: seal(keys.secrets_key.as_str())?,
            members_key_ciphertext: seal(keys.members_key.as_str())?,
        })
    }
}

impl IdentityControlState {
    /// Approve a pending join and wrap every owned vault's DEK to the joiner.
    pub fn approval_operation(
        &self,
        request: &IdentityApprovalRequest<'_>,
    ) -> EventResult<IdentityControlOperation> {
        let join = self.pending_join(request.app_id).ok_or_else(|| {
            EventError::IdentityControlInvalid(format!(
                "no pending identity join for app {}",
                request.app_id
            ))
        })?;
        for vault in &self.vaults {
            if !request.vaults.iter().any(|opened| {
                opened.store_id == &vault.store_id && opened.key_epoch == &vault.current_key_epoch
            }) {
                return Err(EventError::IdentityApprovalIncomplete {
                    store_id: vault.store_id.as_str().to_owned(),
                });
            }
        }
        let vault_deks = request
            .vaults
            .iter()
            .map(|opened| {
                let wrapped = join.member.wrap_vault_keys(opened.keys)?;
                Ok(IdentityVaultDekGrant {
                    store_id: opened.store_id.clone(),
                    key_epoch: opened.key_epoch.clone(),
                    secrets_key_ciphertext: wrapped.secrets_key_ciphertext,
                    members_key_ciphertext: wrapped.members_key_ciphertext,
                })
            })
            .collect::<EventResult<Vec<_>>>()?;
        Ok(IdentityControlOperation::MemberApproved {
            member: join.member.clone(),
            vault_deks,
        })
    }

    /// Deny a pending join.
    pub fn denial_operation(&self, app_id: &AppId) -> EventResult<IdentityControlOperation> {
        self.pending_join(app_id).ok_or_else(|| {
            EventError::IdentityControlInvalid(format!("no pending identity join for app {app_id}"))
        })?;
        Ok(IdentityControlOperation::MemberJoinDenied {
            app_id: app_id.clone(),
        })
    }

    /// Revoke an active member. The identity always keeps one member.
    pub fn revocation_operation(&self, app_id: &AppId) -> EventResult<IdentityControlOperation> {
        if self.member(app_id).is_none() {
            return Err(EventError::IdentityControlInvalid(format!(
                "app {app_id} is not an active identity member"
            )));
        }
        if self.members.len() == 1 {
            return Err(EventError::IdentityControlInvalid(
                "an identity must keep at least one app key".to_owned(),
            ));
        }
        Ok(IdentityControlOperation::MemberRevoked {
            app_id: app_id.clone(),
        })
    }

    fn recipients(&self, keys: &VaultKeys) -> EventResult<Vec<MemberVaultDek>> {
        self.members
            .iter()
            .map(|member| member.keys.wrap_vault_keys(keys))
            .collect()
    }

    /// Register a new vault and wrap its DEK to every active member.
    pub fn vault_registration_operation(
        &self,
        request: IdentityVaultRegistration<'_>,
    ) -> EventResult<IdentityControlOperation> {
        if self.vault(request.dek.store_id).is_some() {
            return Err(EventError::IdentityControlInvalid(format!(
                "vault {} is already registered with this identity",
                request.dek.store_id
            )));
        }
        Ok(IdentityControlOperation::VaultRegistered {
            store_id: request.dek.store_id.clone(),
            key_epoch: request.dek.key_epoch.clone(),
            recipients: self.recipients(request.dek.keys)?,
        })
    }

    /// Wrap a vault DEK epoch to every active member, after a key rotation or
    /// for members that joined concurrently with the vault's registration.
    pub fn vault_rewrap_operation(
        &self,
        dek: &OpenedVaultDek<'_>,
    ) -> EventResult<IdentityControlOperation> {
        if self.vault(dek.store_id).is_none() {
            return Err(EventError::IdentityControlInvalid(format!(
                "vault {} is not registered with this identity",
                dek.store_id
            )));
        }
        Ok(IdentityControlOperation::VaultDekGranted {
            store_id: dek.store_id.clone(),
            key_epoch: dek.key_epoch.clone(),
            recipients: self.recipients(dek.keys)?,
        })
    }
}

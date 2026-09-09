//! Vault member rename and revocation effects for an unlocked manager.

use super::event_log::SecurityEpochRotationFailure;
use super::{NookVaultManager, VaultCryptoState};
use crate::NookSecretRecord;
use nook_core::{
    AuthKeyId, DeviceId, MemberLabel, MultiDeviceError, RenameVaultMemberRequest,
    ResolveMemberRosterRequest, RevokeVaultMemberRequest, SymmetricKey, VaultMember,
    VaultMetaState, VaultOperation, VaultType,
};
use std::mem;
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

#[wasm_bindgen]
impl NookVaultManager {
    pub async fn rename_vault_member(
        &mut self,
        auth_id: String,
        label: String,
    ) -> Result<(), JsError> {
        let records = self.stored_records_snapshot();
        let parsed_auth_id = AuthKeyId::parse(&auth_id)?;
        let members_key = SymmetricKey::parse(&self.vault.members_key)?;
        let member_records = VaultMember::rename_vault_member(RenameVaultMemberRequest {
            records: &records,
            members_key: &members_key,
            auth_id: &parsed_auth_id,
            label: &label,
        })?;
        self.vault.meta.replace_member_records(&member_records)?;
        let roster = VaultMember::resolve_member_roster(ResolveMemberRosterRequest {
            records: &records,
            members_key: &members_key,
        })?;
        let device_id = roster
            .iter()
            .find(|member| member.auth_id == parsed_auth_id)
            .map(|member| member.device_id.to_string())
            .unwrap_or_default();
        self.persist_vault_change(vec![VaultOperation::MemberRenamed {
            device_id: DeviceId::parse(&device_id)?,
            label: MemberLabel::from_trusted(label),
        }])
        .await?;
        Ok(())
    }

    pub async fn revoke_vault_member(
        &mut self,
        auth_id: String,
    ) -> Result<Vec<NookSecretRecord>, JsError> {
        if self.vault.architecture.vault_type == VaultType::Sentinel {
            return Err(MultiDeviceError::SentinelRevocationUnsupported.into());
        }
        let identity = self.device_identity()?;
        let parsed_auth_id = AuthKeyId::parse(&auth_id)?;
        let is_self = parsed_auth_id == identity.auth_id();
        let records = self.stored_records_snapshot();
        let members_key = SymmetricKey::parse(&self.vault.members_key)?;
        let device_id = VaultMember::resolve_member_roster(ResolveMemberRosterRequest {
            records: &records,
            members_key: &members_key,
        })
        .ok()
        .and_then(|roster| {
            roster
                .iter()
                .find(|member| member.auth_id == parsed_auth_id)
                .map(|member| member.device_id.to_string())
        })
        .unwrap_or_default();
        let revoked_device_id = (!is_self)
            .then(|| DeviceId::parse(&device_id))
            .transpose()?;
        let updated = VaultMember::revoke_vault_member(RevokeVaultMemberRequest {
            records: &records,
            members_key: &members_key,
            auth_id: &parsed_auth_id,
        })?;
        let staged_meta = VaultMetaState::from_stored_records(&updated)?;

        if is_self {
            let live_meta = mem::replace(&mut self.vault.meta, staged_meta);
            if let Err(error) = self.persist_vault_change(Vec::new()).await {
                self.vault.meta = live_meta;
                return Err(error.into());
            }
            self.vault.secrets_key.clear();
            self.vault.members_key.clear();
            self.vault.crypto = VaultCryptoState::Locked;
            return Ok(Vec::new());
        }

        let revoked_device_id = revoked_device_id.ok_or_else(|| {
            MultiDeviceError::InvalidDeviceIdentity(
                "Revoked vault member has no device id.".to_owned(),
            )
        })?;
        self.ensure_event_log_ready().await?;
        let live_meta = mem::replace(&mut self.vault.meta, staged_meta);
        if let Err(failure) = self
            .rotate_security_epoch_classified(VaultOperation::DeviceRevoked {
                device_id: revoked_device_id,
            })
            .await
        {
            let error = match failure {
                SecurityEpochRotationFailure::BeforeCommit(error) => {
                    self.vault.meta = live_meta;
                    error
                }
                SecurityEpochRotationFailure::AfterCommit(error) => error,
            };
            return Err(error.into());
        }

        Ok(self.get_records()?)
    }
}

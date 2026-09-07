//! Sentinel share-policy inference and unlock-state projection.

use super::NookVaultManager;
use crate::NookError;
use nook_core::{
    MultiDeviceError, SentinelConfiguration, SentinelVaultUnlockState, VaultMetaState, VaultType,
};
use std::collections::BTreeSet;
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
impl NookVaultManager {
    /// Typed Sentinel unlock state for clients.
    #[wasm_bindgen]
    pub fn sentinel_unlock_status(&self) -> nook_core::SentinelVaultUnlockState {
        if !self.is_sentinel_session() {
            return SentinelVaultUnlockState::NotSentinel;
        }
        if !self.vault.secrets_key.is_empty() && !self.vault.members_key.is_empty() {
            return SentinelVaultUnlockState::Unlocked;
        }
        if self.vault.meta.sentinel_shares.is_empty() {
            SentinelVaultUnlockState::AwaitingShares
        } else {
            // Opening the one share addressed to this device is independent of
            // the reconstruction threshold. Only the later combine step needs T.
            SentinelVaultUnlockState::CeremonyRequired
        }
    }
}

impl NookVaultManager {
    /// Joiners may sync share events before architecture JSON is adopted.
    pub(in crate::manager) fn ensure_sentinel_architecture_from_shares(
        &mut self,
    ) -> Result<(), NookError> {
        if let Some(policy) = Self::sentinel_policy_from_shares(&self.vault.meta)? {
            self.vault.architecture.vault_type = VaultType::Sentinel;
            self.vault.architecture.sentinel = SentinelConfiguration::Enabled(policy);
        }
        Ok(())
    }

    pub(super) fn sentinel_policy_from_shares(
        meta: &VaultMetaState,
    ) -> Result<Option<nook_core::SentinelPolicy>, NookError> {
        if meta.sentinel_shares.is_empty() {
            return Ok(None);
        }
        let mut shares = meta.sentinel_shares.values();
        let first = shares
            .next()
            .ok_or(MultiDeviceError::InvalidSentinelShareEncoding)?;
        let version = first.version;
        let threshold = u8::from(first.threshold);
        let required = u8::from(first.required_participants);
        let mut indexes = BTreeSet::new();
        indexes.insert(u8::from(first.share_index));
        if threshold < 2
            || threshold > required
            || required > 16
            || u8::from(first.share_index) == 0
            || u8::from(first.share_index) > required
            || shares.any(|share| {
                share.version != version
                    || u8::from(share.threshold) != threshold
                    || u8::from(share.required_participants) != required
                    || u8::from(share.share_index) == 0
                    || u8::from(share.share_index) > required
                    || !indexes.insert(share.share_index.into())
            })
        {
            return Err(MultiDeviceError::InvalidSentinelShareEncoding.into());
        }
        let share_count = u8::try_from(meta.sentinel_shares.len())
            .map_err(|_| MultiDeviceError::InvalidSentinelThreshold)?;
        Ok(Some(nook_core::SentinelPolicy {
            threshold: threshold.into(),
            required_participants: required.into(),
            ready_participants: share_count.into(),
        }))
    }

    fn is_sentinel_session(&self) -> bool {
        self.vault.architecture.vault_type == VaultType::Sentinel
            || !self.vault.meta.sentinel_shares.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nook_core::{AgeArmoredCiphertext, DeviceId, DeviceMode, VaultArchitecture};

    #[test]
    fn sentinel_unlock_status_projects_each_session_state() -> anyhow::Result<()> {
        let mut manager = NookVaultManager::new();
        assert_eq!(
            manager.sentinel_unlock_status(),
            SentinelVaultUnlockState::NotSentinel
        );

        manager.vault.architecture = VaultArchitecture::sentinel_personal(
            DeviceMode::Standard,
            nook_core::SentinelPolicy {
                threshold: 2.into(),
                required_participants: 3.into(),
                ready_participants: 0.into(),
            },
        );
        assert_eq!(
            manager.sentinel_unlock_status(),
            SentinelVaultUnlockState::AwaitingShares
        );

        manager.vault.meta.sentinel_shares.insert(
            DeviceId::parse("0123456789abcdef")?,
            nook_core::SentinelShareEnvelope {
                version: nook_core::SentinelShareVersion::CURRENT,
                threshold: 2.into(),
                required_participants: 3.into(),
                share_index: 1.into(),
                ciphertext: AgeArmoredCiphertext::from_trusted("encrypted".to_owned()),
            },
        );
        assert_eq!(
            manager.sentinel_unlock_status(),
            SentinelVaultUnlockState::CeremonyRequired
        );

        let keys = nook_core::VaultKeys::generate()?;
        manager.vault.secrets_key = keys.secrets_key.to_string();
        manager.vault.members_key = keys.members_key.to_string();
        assert_eq!(
            manager.sentinel_unlock_status(),
            SentinelVaultUnlockState::Unlocked
        );
        Ok(())
    }

    #[test]
    fn architecture_rejects_invalid_share_indexes_and_versions() -> anyhow::Result<()> {
        let mut manager = NookVaultManager::new();
        manager.vault.meta.sentinel_shares.insert(
            DeviceId::parse("0123456789abcdef")?,
            nook_core::SentinelShareEnvelope {
                version: nook_core::SentinelShareVersion::CURRENT,
                threshold: 2.into(),
                required_participants: 3.into(),
                share_index: 0.into(),
                ciphertext: AgeArmoredCiphertext::from_trusted("encrypted".to_owned()),
            },
        );
        assert!(manager.ensure_sentinel_architecture_from_shares().is_err());

        manager.vault.meta.sentinel_shares.clear();
        manager.vault.meta.sentinel_shares.insert(
            DeviceId::parse("0123456789abcdef")?,
            nook_core::SentinelShareEnvelope {
                version: nook_core::SentinelShareVersion::LEGACY,
                threshold: 2.into(),
                required_participants: 3.into(),
                share_index: 1.into(),
                ciphertext: AgeArmoredCiphertext::from_trusted("encrypted".to_owned()),
            },
        );
        manager.vault.meta.sentinel_shares.insert(
            DeviceId::parse("fedcba9876543210")?,
            nook_core::SentinelShareEnvelope {
                version: nook_core::SentinelShareVersion::CURRENT,
                threshold: 2.into(),
                required_participants: 3.into(),
                share_index: 2.into(),
                ciphertext: AgeArmoredCiphertext::from_trusted("encrypted".to_owned()),
            },
        );
        assert!(manager.ensure_sentinel_architecture_from_shares().is_err());
        Ok(())
    }
}

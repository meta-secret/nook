//! Legacy vault import and authenticated epoch reconciliation.
use super::super::identity_dek_grant::IdentityVaultGrantReconciliation;
use super::*;
#[cfg(test)]
use crate::{IdentityVaultBinding, MemberLabelState};

impl IdentityRecord {
    pub fn reconcile_legacy_vault_member(
        mut self,
        request: IdentityLegacyVaultReconciliation<'_>,
    ) -> Result<Self, IdentityRecordRejection> {
        let IdentityLegacyVaultReconciliation {
            app_key,
            store_id,
            reconciliation,
        } = request;
        let result: MultiDeviceResult<()> = (|| {
            let existing = self
                .members
                .iter()
                .find(|member| member.app_id == *app_key.app_id())
                .ok_or(MultiDeviceError::IdentityEnrollmentRequired)?;
            if matches!(
                existing.binding_to_app_key(app_key),
                IdentityMemberKeyBinding::DifferentKeyMaterial
            ) {
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
            let vault_dek = self.vault_deks.get(vault_dek_index).ok_or_else(|| {
                MultiDeviceError::InvalidDeviceIdentity(
                    "identity does not own this legacy vault".to_owned(),
                )
            })?;
            let next_epoch = vault_dek.next_epoch(&reconciliation.epoch_update)?;
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
            if vault_dek.reconciliation_with(app_key, &authorized_members, &keys, &next_epoch)
                == IdentityVaultGrantReconciliation::Current
            {
                return Ok(());
            }
            let mut rewrapped =
                IdentityVaultDek::wrap_vault_keys_for_members(WrapVaultKeysForMembersRequest {
                    keys: &keys,
                    members: &authorized_members,
                    store_id: store_id.clone(),
                })?;
            rewrapped.key_epoch = next_epoch;
            if *vault_dek != rewrapped {
                let stored = self.vault_deks.get_mut(vault_dek_index).ok_or_else(|| {
                    MultiDeviceError::InvalidDeviceIdentity(
                        "identity does not own this legacy vault".to_owned(),
                    )
                })?;
                *stored = rewrapped;
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

    pub fn import_legacy_vault(
        mut self,
        request: IdentityLegacyVaultImport<'_>,
    ) -> Result<Self, IdentityRecordRejection> {
        let IdentityLegacyVaultImport {
            app_key,
            store_id,
            reconciliation,
        } = request;
        let result: MultiDeviceResult<()> = (|| {
            let existing = self
                .members
                .iter()
                .find(|member| member.app_id == *app_key.app_id())
                .ok_or(MultiDeviceError::IdentityEnrollmentRequired)?;
            if matches!(
                existing.binding_to_app_key(app_key),
                IdentityMemberKeyBinding::DifferentKeyMaterial
            ) {
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
            let mut vault_dek =
                IdentityVaultDek::wrap_vault_keys_for_members(WrapVaultKeysForMembersRequest {
                    keys: &keys,
                    members: &authorized_members,
                    store_id: store_id,
                })?;
            vault_dek.key_epoch = reconciliation.epoch_update.committed_epoch();
            self.vault_deks.push(vault_dek);
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
            control_epoch: IdentityControlEpoch::INITIAL,
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
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stale_dek_observation_cannot_overwrite_rotated_epoch() -> anyhow::Result<()> {
        let app_key = AppKey::generate()?;
        let mut identity =
            IdentityRecord::create_with_app_key("Personal", &app_key, MemberLabelState::Unnamed)?;
        let store = StoreId::parse("store_abcdefghijk")?;
        let opened_identity = identity.generate_vault_dek(store.clone())?;
        identity = opened_identity.identity;
        let original = opened_identity.keys;
        let previous = event_id('a')?;
        let current = event_id('b')?;
        let previous_checkpoint = event_id('c')?;
        let current_checkpoint = event_id('d')?;
        let rotated = crate::VaultKeys::generate()?;
        let rotated_reconciliation = reconciliation_for_keys(
            &app_key,
            &rotated,
            IdentityVaultDekEpochUpdate::Rotate {
                previous_key_epoch: previous.clone(),
                previous_checkpoint_ancestors: vec![previous_checkpoint.clone()],
                key_epoch: current.clone(),
                checkpoint: current_checkpoint,
            },
        )?;
        identity = identity.reconcile_legacy_vault_member(IdentityLegacyVaultReconciliation {
            app_key: &app_key,
            store_id: &store,
            reconciliation: &rotated_reconciliation,
        })?;
        let reconciled_control_epoch = identity.control_epoch;
        identity = identity.reconcile_legacy_vault_member(IdentityLegacyVaultReconciliation {
            app_key: &app_key,
            store_id: &store,
            reconciliation: &rotated_reconciliation,
        })?;
        assert_eq!(identity.control_epoch, reconciled_control_epoch);

        let stale = reconciliation_for_keys(
            &app_key,
            &original,
            IdentityVaultDekEpochUpdate::Observe {
                key_epoch: IdentityVaultDekEpoch::Known {
                    key_epoch: previous,
                    checkpoint: previous_checkpoint,
                },
                checkpoint_ancestors: Vec::new(),
            },
        )?;
        let rejected =
            match identity.reconcile_legacy_vault_member(IdentityLegacyVaultReconciliation {
                app_key: &app_key,
                store_id: &store,
                reconciliation: &stale,
            }) {
                Err(rejected) => rejected,
                Ok(_) => anyhow::bail!("Rejected identity transition unexpectedly succeeded"),
            };
        identity = rejected.identity;
        assert!(matches!(
            rejected.cause,
            MultiDeviceError::StaleVaultDekEpoch { .. }
        ));
        assert_eq!(
            identity.open_vault_dek(IdentityVaultKeyOpening {
                app_key: &app_key,
                store_id: store
            })?,
            rotated
        );
        Ok(())
    }

    #[test]
    fn reconciliation_excludes_identity_member_revoked_from_vault() -> anyhow::Result<()> {
        let active = AppKey::generate()?;
        let revoked = AppKey::generate()?;
        let mut identity =
            IdentityRecord::create_with_app_key("Personal", &active, MemberLabelState::Unnamed)?;
        identity = identity.add_member(IdentityMember {
            app_id: revoked.app_id().clone(),
            auth_id: revoked.auth_id(),
            public_key: revoked.public_key(),
            signing_public_key: DeviceSigningPublicKey::Unavailable,
            label: MemberLabelState::Unnamed,
        })?;
        let store = StoreId::parse("store_abcdefghijk")?;
        let opened_identity = identity.generate_vault_dek(store.clone())?;
        identity = opened_identity.identity;
        let rotated = crate::VaultKeys::generate()?;
        let mut reconciliation = reconciliation_for_keys(
            &active,
            &rotated,
            IdentityVaultDekEpochUpdate::Observe {
                key_epoch: IdentityVaultDekEpoch::LegacyUnknown,
                checkpoint_ancestors: Vec::new(),
            },
        )?;
        reconciliation.authorized_auth_ids = vec![active.auth_id()];

        identity = identity.reconcile_legacy_vault_member(IdentityLegacyVaultReconciliation {
            app_key: &active,
            store_id: &store,
            reconciliation: &reconciliation,
        })?;

        assert_eq!(
            identity.open_vault_dek(IdentityVaultKeyOpening {
                app_key: &active,
                store_id: store.clone()
            })?,
            rotated
        );
        assert!(
            identity
                .open_or_generate_vault_dek(IdentityVaultKeyOpening {
                    app_key: &revoked,
                    store_id: store
                })
                .is_err()
        );
        Ok(())
    }

    #[test]
    fn same_dek_epoch_accepts_an_advanced_event_checkpoint() -> anyhow::Result<()> {
        let app_key = AppKey::generate()?;
        let mut identity =
            IdentityRecord::create_with_app_key("Personal", &app_key, MemberLabelState::Unnamed)?;
        let store = StoreId::parse("store_abcdefghijk")?;
        let opened_identity = identity.generate_vault_dek(store.clone())?;
        identity = opened_identity.identity;
        let keys = opened_identity.keys;
        let key_epoch = event_id('a')?;
        let first_checkpoint = event_id('b')?;
        let advanced_checkpoint = event_id('c')?;
        let first = reconciliation_for_keys(
            &app_key,
            &keys,
            IdentityVaultDekEpochUpdate::Rotate {
                previous_key_epoch: key_epoch.clone(),
                previous_checkpoint_ancestors: vec![key_epoch.clone()],
                key_epoch: key_epoch.clone(),
                checkpoint: first_checkpoint.clone(),
            },
        )?;
        identity = identity.reconcile_legacy_vault_member(IdentityLegacyVaultReconciliation {
            app_key: &app_key,
            store_id: &store,
            reconciliation: &first,
        })?;

        let advanced = reconciliation_for_keys(
            &app_key,
            &keys,
            IdentityVaultDekEpochUpdate::Observe {
                key_epoch: IdentityVaultDekEpoch::Known {
                    key_epoch: key_epoch.clone(),
                    checkpoint: advanced_checkpoint.clone(),
                },
                checkpoint_ancestors: vec![first_checkpoint.clone()],
            },
        )?;
        identity = identity.reconcile_legacy_vault_member(IdentityLegacyVaultReconciliation {
            app_key: &app_key,
            store_id: &store,
            reconciliation: &advanced,
        })?;

        let stale = reconciliation_for_keys(
            &app_key,
            &keys,
            IdentityVaultDekEpochUpdate::Observe {
                key_epoch: IdentityVaultDekEpoch::Known {
                    key_epoch: key_epoch.clone(),
                    checkpoint: first_checkpoint,
                },
                checkpoint_ancestors: Vec::new(),
            },
        )?;
        let rejected =
            match identity.reconcile_legacy_vault_member(IdentityLegacyVaultReconciliation {
                app_key: &app_key,
                store_id: &store,
                reconciliation: &stale,
            }) {
                Err(rejected) => rejected,
                Ok(_) => anyhow::bail!("Rejected identity transition unexpectedly succeeded"),
            };
        identity = rejected.identity;
        assert!(matches!(
            rejected.cause,
            MultiDeviceError::StaleVaultDekEpoch { .. }
        ));

        let IdentityVaultBinding::Bound(dek) = identity.vault_dek(&store) else {
            anyhow::bail!("committed vault binding must remain")
        };
        assert_eq!(
            &dek.key_epoch,
            &IdentityVaultDekEpoch::Known {
                key_epoch,
                checkpoint: advanced_checkpoint,
            }
        );
        Ok(())
    }

    fn reconciliation_for_keys(
        app_key: &AppKey,
        keys: &VaultKeys,
        epoch_update: IdentityVaultDekEpochUpdate,
    ) -> anyhow::Result<IdentityVaultDekReconciliation> {
        Ok(IdentityVaultDekReconciliation {
            secrets_envelope: app_key
                .public_key()
                .seal_bytes(keys.secrets_key.as_str().as_bytes())?,
            members_envelope: app_key
                .public_key()
                .seal_bytes(keys.members_key.as_str().as_bytes())?,
            epoch_update,
            authorized_auth_ids: vec![app_key.auth_id()],
        })
    }

    fn event_id(fill: char) -> anyhow::Result<IdentityVaultEventId> {
        Ok(IdentityVaultEventId::parse(&format!(
            "sha256u:{}",
            fill.to_string().repeat(43)
        ))?)
    }
}

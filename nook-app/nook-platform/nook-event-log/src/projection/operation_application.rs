//! Application of one validated vault operation to materialized state.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use super::{
    ProjectedSecret, ProjectedSecretLifecycle, ProjectedSecretOrigin, ProjectedVaultName,
    VaultProjection,
};
use crate::canonical::EventId;
use crate::event::{EncryptedSecretPayload, VaultOperation};
use nook_auth2::SecretId;
use std::collections::BTreeMap;

impl VaultProjection {
    #[allow(clippy::too_many_lines)] // One exhaustive match keeps event projection behavior auditable.
    pub(super) fn apply_operation(
        &mut self,
        event_id: &EventId,
        operation: &VaultOperation,
        replacements_by_old: &mut BTreeMap<SecretId, Vec<(EventId, SecretId)>>,
    ) {
        match operation {
            VaultOperation::VaultImported { secrets, .. } => {
                for secret in secrets {
                    self.insert_secret(event_id, secret, ProjectedSecretOrigin::Created);
                }
            }
            VaultOperation::EpochCheckpoint {
                secrets,
                vault_name,
                ..
            } => {
                self.secrets.clear();
                // The checkpoint carries the name under the new key; a name
                // under the retired key could not be read after the rotation.
                self.vault_name = match vault_name {
                    crate::EpochVaultName::Named(name) => ProjectedVaultName::Named(name.clone()),
                    crate::EpochVaultName::Unnamed => ProjectedVaultName::Unnamed,
                };
                for secret in secrets {
                    self.insert_secret(event_id, secret, ProjectedSecretOrigin::Created);
                }
            }
            VaultOperation::SecretCreated { secret } => {
                self.insert_secret(event_id, secret, ProjectedSecretOrigin::Created);
            }
            VaultOperation::SecretDeleted { secret_id } => {
                if let Some(entry) = self.secrets.get_mut(secret_id) {
                    entry.lifecycle = ProjectedSecretLifecycle::Deleted {
                        by: event_id.clone(),
                    };
                }
            }
            VaultOperation::SecretReplaced { old_id, new_secret } => {
                if let Some(entry) = self.secrets.get_mut(old_id) {
                    entry.lifecycle = ProjectedSecretLifecycle::Deleted {
                        by: event_id.clone(),
                    };
                }
                self.insert_secret(
                    event_id,
                    new_secret,
                    ProjectedSecretOrigin::Replacement {
                        from: old_id.clone(),
                    },
                );
                replacements_by_old
                    .entry(old_id.clone())
                    .or_default()
                    .push((event_id.clone(), new_secret.id.clone()));
            }
            VaultOperation::SecretConflictResolved {
                old_id,
                chosen_secret_id,
                rejected_secret_ids,
            } => {
                for rejected in rejected_secret_ids {
                    if let Some(entry) = self.secrets.get_mut(rejected) {
                        entry.lifecycle = ProjectedSecretLifecycle::Deleted {
                            by: event_id.clone(),
                        };
                    }
                }
                replacements_by_old.remove(old_id);
                self.replacement_conflicts.remove(old_id);
                if let Some(chosen) = self.secrets.get(chosen_secret_id) {
                    let _ = chosen;
                }
            }
            VaultOperation::VaultNamed { name } => {
                self.vault_name = ProjectedVaultName::Named(name.clone());
            }
            VaultOperation::VaultCleared => {
                self.cleared = true;
                self.secrets.clear();
            }
            VaultOperation::JoinRequested { .. }
            | VaultOperation::JoinApproved { .. }
            | VaultOperation::SentinelParticipantEnrolled { .. }
            | VaultOperation::SentinelSharesIssued { .. }
            | VaultOperation::JoinDenied { .. }
            | VaultOperation::MemberRenamed { .. }
            | VaultOperation::DeviceRevoked { .. } => {}
        }
    }

    fn insert_secret(
        &mut self,
        event_id: &EventId,
        secret: &EncryptedSecretPayload,
        origin: ProjectedSecretOrigin,
    ) {
        self.secrets.insert(
            secret.id.clone(),
            ProjectedSecret {
                record: secret.to_stored(),
                identity_fingerprint: secret.identity_fingerprint.clone(),
                fingerprint: secret.fingerprint.clone(),
                created_by: event_id.clone(),
                lifecycle: ProjectedSecretLifecycle::Live,
                origin,
            },
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::SecretFingerprint;
    use nook_auth2::{OpaqueCiphertext, SecretType, Sha256Hex};

    impl EventId {
        fn projection_fixture() -> crate::EventResult<Self> {
            EventId::parse("sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo")
        }
    }

    impl EncryptedSecretPayload {
        fn projection_fixture(value: &str) -> Self {
            EncryptedSecretPayload {
                id: SecretId::from_vault_record(value),
                secret_type: SecretType::ApiKey,
                ciphertext: OpaqueCiphertext::from_trusted(format!("cipher-{value}")),
                identity_fingerprint: SecretFingerprint::from_trusted(format!("identity-{value}")),
                fingerprint: SecretFingerprint::from_trusted(format!("version-{value}")),
            }
        }
    }

    #[test]
    fn secret_lifecycle_operations_update_records_and_replacement_history() -> anyhow::Result<()> {
        let mut projection = VaultProjection::default();
        let mut replacements = BTreeMap::new();
        let creator = EventId::projection_fixture()?;
        let original_id = SecretId::from_vault_record("secret_original1");

        projection.apply_operation(
            &creator,
            &VaultOperation::SecretCreated {
                secret: EncryptedSecretPayload::projection_fixture("secret_original1"),
            },
            &mut replacements,
        );
        let original = projection
            .secrets
            .get(&original_id)
            .ok_or_else(|| anyhow::anyhow!("created secret must be projected"))?;
        assert!(matches!(original.lifecycle, ProjectedSecretLifecycle::Live));

        let replacement_id = SecretId::from_vault_record("secret_replaced1");
        projection.apply_operation(
            &creator,
            &VaultOperation::SecretReplaced {
                old_id: original_id.clone(),
                new_secret: EncryptedSecretPayload::projection_fixture("secret_replaced1"),
            },
            &mut replacements,
        );
        let original = projection
            .secrets
            .get(&original_id)
            .ok_or_else(|| anyhow::anyhow!("replaced secret must retain its tombstone"))?;
        assert!(matches!(
            original.lifecycle,
            ProjectedSecretLifecycle::Deleted { .. }
        ));
        let replacement = projection
            .secrets
            .get(&replacement_id)
            .ok_or_else(|| anyhow::anyhow!("replacement secret must be projected"))?;
        assert_eq!(
            replacement.origin,
            ProjectedSecretOrigin::Replacement {
                from: original_id.clone()
            }
        );
        let replacement_history = replacements
            .get(&original_id)
            .ok_or_else(|| anyhow::anyhow!("replacement history must retain the original"))?;
        let first_replacement = replacement_history
            .first()
            .ok_or_else(|| anyhow::anyhow!("replacement history must contain the new secret"))?;
        assert_eq!(first_replacement.1, replacement_id);

        projection.apply_operation(
            &creator,
            &VaultOperation::SecretDeleted {
                secret_id: SecretId::from_vault_record("secret_replaced1"),
            },
            &mut replacements,
        );
        let replacement = projection
            .secrets
            .get(&SecretId::from_vault_record("secret_replaced1"))
            .ok_or_else(|| anyhow::anyhow!("deleted replacement must retain its tombstone"))?;
        assert!(matches!(
            replacement.lifecycle,
            ProjectedSecretLifecycle::Deleted { .. }
        ));
        Ok(())
    }

    #[test]
    fn import_materializes_state_and_clear_removes_it() -> anyhow::Result<()> {
        let mut projection = VaultProjection::default();
        let mut replacements = BTreeMap::new();
        let importer = EventId::projection_fixture()?;
        projection.apply_operation(
            &importer,
            &VaultOperation::VaultImported {
                source_content_hash: Sha256Hex::from_trusted("deadbeef".repeat(8)),
                secrets: vec![EncryptedSecretPayload::projection_fixture(
                    "secret_imported1",
                )],
            },
            &mut replacements,
        );
        assert!(
            projection
                .secrets
                .contains_key(&SecretId::from_vault_record("secret_imported1"))
        );

        projection.apply_operation(&importer, &VaultOperation::VaultCleared, &mut replacements);
        assert!(projection.cleared);
        assert!(projection.secrets.is_empty());
        Ok(())
    }

    #[test]
    fn epoch_checkpoint_replaces_secret_snapshot() -> anyhow::Result<()> {
        let mut projection = VaultProjection::default();
        let old_event = EventId::projection_fixture()?;
        projection.insert_secret(
            &old_event,
            &EncryptedSecretPayload::projection_fixture("secret_oldrecord1"),
            ProjectedSecretOrigin::Created,
        );
        let replacement = EncryptedSecretPayload::projection_fixture("secret_newrecord1");

        projection.apply_operation(
            &EventId::projection_fixture()?,
            &VaultOperation::EpochCheckpoint {
                vault_name: crate::EpochVaultName::Unnamed,
                secrets: vec![replacement.clone()],
                members_checkpoint_hash: Sha256Hex::from_trusted("deadbeef".repeat(8)),
                rotated_meta_records: crate::EpochMetadataState::Replace(Vec::new()),
            },
            &mut BTreeMap::new(),
        );

        assert_eq!(projection.secrets.len(), 1);
        assert!(
            !projection
                .secrets
                .contains_key(&SecretId::from_vault_record("secret_oldrecord1"))
        );
        assert!(projection.secrets.contains_key(&replacement.id));
        Ok(())
    }

    #[test]
    fn the_latest_name_wins_and_each_checkpoint_carries_it_forward() -> anyhow::Result<()> {
        let mut projection = VaultProjection::default();
        let mut replacements = BTreeMap::new();
        let event = EventId::projection_fixture()?;
        let name = |ciphertext: &str| OpaqueCiphertext::from_trusted(ciphertext.to_owned());
        let checkpoint = |vault_name| VaultOperation::EpochCheckpoint {
            secrets: Vec::new(),
            members_checkpoint_hash: Sha256Hex::from_trusted("deadbeef".repeat(8)),
            rotated_meta_records: crate::EpochMetadataState::Replace(Vec::new()),
            vault_name,
        };
        assert_eq!(projection.vault_name, ProjectedVaultName::Unnamed);

        for ciphertext in ["cipher-personal", "cipher-family"] {
            projection.apply_operation(
                &event,
                &VaultOperation::VaultNamed {
                    name: name(ciphertext),
                },
                &mut replacements,
            );
        }
        assert_eq!(
            projection.vault_name,
            ProjectedVaultName::Named(name("cipher-family"))
        );

        projection.apply_operation(
            &event,
            &checkpoint(crate::EpochVaultName::Named(name(
                "cipher-family-next-epoch",
            ))),
            &mut replacements,
        );
        assert_eq!(
            projection.vault_name,
            ProjectedVaultName::Named(name("cipher-family-next-epoch"))
        );

        // A name under the retired key is unreadable in the new epoch.
        projection.apply_operation(
            &event,
            &checkpoint(crate::EpochVaultName::Unnamed),
            &mut replacements,
        );
        assert_eq!(projection.vault_name, ProjectedVaultName::Unnamed);
        Ok(())
    }
}

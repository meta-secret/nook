//! Application of one validated vault operation to materialized state.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use super::{ProjectedSecret, ProjectedSecretLifecycle, ProjectedSecretOrigin, VaultProjection};
use crate::PasswordUnlockEntry;
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
            VaultOperation::VaultImported {
                secrets,
                password_entries,
                ..
            } => {
                for secret in secrets {
                    self.insert_secret(event_id, secret, ProjectedSecretOrigin::Created);
                }
                self.password_entries.clone_from(password_entries);
            }
            VaultOperation::EpochCheckpoint {
                secrets,
                password_entries,
                ..
            } => {
                self.secrets.clear();
                for secret in secrets {
                    self.insert_secret(event_id, secret, ProjectedSecretOrigin::Created);
                }
                if let crate::EpochPasswordState::Replace(password_entries) = password_entries {
                    self.password_entries.clone_from(password_entries);
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
            VaultOperation::VaultCleared => {
                self.cleared = true;
                self.secrets.clear();
                self.password_entries.clear();
            }
            VaultOperation::PasswordAdded {
                entry_id,
                label,
                created_at,
                envelope,
            } => {
                self.upsert_password_entry(PasswordUnlockEntry {
                    id: entry_id.as_str().to_owned(),
                    label: label.to_owned(),
                    created_at: created_at.as_str().to_owned(),
                    envelope: envelope.clone(),
                });
            }
            VaultOperation::PasswordRotated { entry_id, envelope }
            | VaultOperation::PasswordEnvelopeUpgraded { entry_id, envelope } => {
                if let Some(entry) = self
                    .password_entries
                    .iter_mut()
                    .find(|entry| entry.id == entry_id.as_str())
                {
                    entry.envelope.clone_from(envelope);
                }
            }
            VaultOperation::PasswordRemoved { entry_id } => {
                self.password_entries
                    .retain(|entry| entry.id != entry_id.as_str());
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

    fn upsert_password_entry(&mut self, entry: PasswordUnlockEntry) {
        if let Some(existing) = self
            .password_entries
            .iter_mut()
            .find(|existing| existing.id == entry.id)
        {
            *existing = entry;
            return;
        }
        self.password_entries.push(entry);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{PasswordEnvelope, SecretFingerprint};
    use nook_auth2::{IsoTimestamp, OpaqueCiphertext, PasswordEntryId, SecretType, Sha256Hex};

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

    struct PasswordEnvelopeFixture<'a>(&'a str);

    impl PasswordEnvelopeFixture<'_> {
        fn into_envelope(self) -> PasswordEnvelope {
            PasswordEnvelope {
                version: crate::PasswordEnvelopeVersion::LEGACY,
                kdf: "scrypt".to_owned(),
                work_factor: 10.into(),
                recipient: String::new(),
                wrapped_keys: String::new(),
                ciphertext: self.0.to_owned(),
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
        assert!(matches!(
            projection.secrets[&original_id].lifecycle,
            ProjectedSecretLifecycle::Live
        ));

        let replacement_id = SecretId::from_vault_record("secret_replaced1");
        projection.apply_operation(
            &creator,
            &VaultOperation::SecretReplaced {
                old_id: original_id.clone(),
                new_secret: EncryptedSecretPayload::projection_fixture("secret_replaced1"),
            },
            &mut replacements,
        );
        assert!(matches!(
            projection.secrets[&original_id].lifecycle,
            ProjectedSecretLifecycle::Deleted { .. }
        ));
        assert_eq!(
            projection.secrets[&replacement_id].origin,
            ProjectedSecretOrigin::Replacement {
                from: original_id.clone()
            }
        );
        assert_eq!(replacements[&original_id][0].1, replacement_id);

        projection.apply_operation(
            &creator,
            &VaultOperation::SecretDeleted {
                secret_id: SecretId::from_vault_record("secret_replaced1"),
            },
            &mut replacements,
        );
        assert!(matches!(
            projection.secrets[&SecretId::from_vault_record("secret_replaced1")].lifecycle,
            ProjectedSecretLifecycle::Deleted { .. }
        ));
        Ok(())
    }

    #[test]
    fn import_materializes_state_and_clear_removes_it() -> anyhow::Result<()> {
        let mut projection = VaultProjection::default();
        let mut replacements = BTreeMap::new();
        let importer = EventId::projection_fixture()?;
        let imported_entry = PasswordUnlockEntry {
            id: "pwdentry001".to_owned(),
            label: "Travel recovery".to_owned(),
            created_at: "2026-06-28T00:00:00Z".to_owned(),
            envelope: PasswordEnvelopeFixture("imported").into_envelope(),
        };

        projection.apply_operation(
            &importer,
            &VaultOperation::VaultImported {
                source_content_hash: Sha256Hex::from_trusted("deadbeef".repeat(8)),
                secrets: vec![EncryptedSecretPayload::projection_fixture(
                    "secret_imported1",
                )],
                password_entries: vec![imported_entry.clone()],
            },
            &mut replacements,
        );
        assert!(
            projection
                .secrets
                .contains_key(&SecretId::from_vault_record("secret_imported1"))
        );
        assert_eq!(projection.password_entries, vec![imported_entry]);

        projection.apply_operation(&importer, &VaultOperation::VaultCleared, &mut replacements);
        assert!(projection.cleared);
        assert!(projection.secrets.is_empty());
        assert!(projection.password_entries.is_empty());
        Ok(())
    }

    #[test]
    fn password_operations_add_rotate_and_remove() -> anyhow::Result<()> {
        let mut projection = VaultProjection::default();
        let mut replacements = BTreeMap::new();
        let entry_id = PasswordEntryId::parse("pwdentry001")?;
        let actor = EventId::projection_fixture()?;

        projection.apply_operation(
            &actor,
            &VaultOperation::PasswordAdded {
                entry_id: entry_id.clone(),
                label: "Primary recovery".to_owned(),
                created_at: IsoTimestamp::from_trusted("2026-06-28T00:00:01Z".to_owned()),
                envelope: PasswordEnvelopeFixture("initial").into_envelope(),
            },
            &mut replacements,
        );
        assert_eq!(projection.password_entries.len(), 1);
        assert_eq!(projection.password_entries[0].label, "Primary recovery");

        projection.apply_operation(
            &actor,
            &VaultOperation::PasswordRotated {
                entry_id: entry_id.clone(),
                envelope: PasswordEnvelopeFixture("rotated").into_envelope(),
            },
            &mut replacements,
        );
        assert_eq!(
            projection.password_entries[0].envelope.ciphertext,
            "rotated"
        );
        projection.apply_operation(
            &actor,
            &VaultOperation::PasswordEnvelopeUpgraded {
                entry_id: entry_id.clone(),
                envelope: PasswordEnvelopeFixture("upgraded").into_envelope(),
            },
            &mut replacements,
        );
        assert_eq!(
            projection.password_entries[0].envelope.ciphertext,
            "upgraded"
        );

        projection.apply_operation(
            &actor,
            &VaultOperation::PasswordRemoved { entry_id },
            &mut replacements,
        );
        assert!(projection.password_entries.is_empty());
        Ok(())
    }

    #[test]
    fn epoch_checkpoint_replaces_password_entries() -> anyhow::Result<()> {
        let mut projection = VaultProjection {
            password_entries: vec![PasswordUnlockEntry {
                id: "pwdentry001".to_owned(),
                label: "Old".to_owned(),
                created_at: "2026-06-28T00:00:00Z".to_owned(),
                envelope: PasswordEnvelopeFixture("old-keys").into_envelope(),
            }],
            ..VaultProjection::default()
        };
        let replacement = PasswordUnlockEntry {
            id: "pwdentry002".to_owned(),
            label: "Survivor".to_owned(),
            created_at: "2026-06-28T00:00:01Z".to_owned(),
            envelope: PasswordEnvelopeFixture("new-keys").into_envelope(),
        };

        projection.apply_operation(
            &EventId::projection_fixture()?,
            &VaultOperation::EpochCheckpoint {
                secrets: Vec::new(),
                members_checkpoint_hash: Sha256Hex::from_trusted("deadbeef".repeat(8)),
                rotated_meta_records: crate::EpochMetadataState::Replace(Vec::new()),
                password_entries: crate::EpochPasswordState::Replace(vec![replacement.clone()]),
            },
            &mut BTreeMap::new(),
        );

        assert_eq!(projection.password_entries, vec![replacement]);
        Ok(())
    }

    #[test]
    fn legacy_checkpoint_preserves_passwords_while_replacing_secrets() -> anyhow::Result<()> {
        let retained = PasswordUnlockEntry {
            id: "pwdentry001".to_owned(),
            label: "Retained".to_owned(),
            created_at: "2026-06-28T00:00:00Z".to_owned(),
            envelope: PasswordEnvelopeFixture("retained-keys").into_envelope(),
        };
        let mut projection = VaultProjection {
            password_entries: vec![retained.clone()],
            ..VaultProjection::default()
        };
        let event = EventId::projection_fixture()?;
        let old = EncryptedSecretPayload::projection_fixture("secret_oldrecord1");
        projection.insert_secret(&event, &old, ProjectedSecretOrigin::Created);
        let replacement = EncryptedSecretPayload::projection_fixture("secret_newrecord1");
        projection.apply_operation(
            &event,
            &VaultOperation::EpochCheckpoint {
                secrets: vec![replacement.clone()],
                members_checkpoint_hash: Sha256Hex::from_trusted("deadbeef".repeat(8)),
                rotated_meta_records: crate::EpochMetadataState::LegacyRetain,
                password_entries: crate::EpochPasswordState::LegacyRetain,
            },
            &mut BTreeMap::new(),
        );
        assert_eq!(projection.password_entries, vec![retained]);
        assert_eq!(projection.secrets.len(), 1);
        assert!(!projection.secrets.contains_key(&old.id));
        assert_eq!(
            projection.secrets[&replacement.id].record,
            replacement.to_stored()
        );
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
                secrets: vec![replacement.clone()],
                members_checkpoint_hash: Sha256Hex::from_trusted("deadbeef".repeat(8)),
                rotated_meta_records: crate::EpochMetadataState::Replace(Vec::new()),
                password_entries: crate::EpochPasswordState::Replace(Vec::new()),
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
}

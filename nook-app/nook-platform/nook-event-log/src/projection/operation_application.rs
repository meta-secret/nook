//! Application of one validated vault operation to materialized state.

use super::{ProjectedSecret, ProjectedSecretLifecycle, ProjectedSecretOrigin, VaultProjection};
use crate::PasswordUnlockEntry;
use crate::canonical::EventId;
use crate::event::{EncryptedSecretPayload, VaultOperation};
use nook_auth2::SecretId;
use std::collections::BTreeMap;

#[allow(clippy::too_many_lines)] // One exhaustive match keeps event projection behavior auditable.
pub(super) fn apply_operation(
    projection: &mut VaultProjection,
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
                insert_secret(projection, event_id, secret, ProjectedSecretOrigin::Created);
            }
            projection.password_entries.clone_from(password_entries);
        }
        VaultOperation::EpochCheckpoint {
            secrets,
            password_entries,
            ..
        } => {
            for secret in secrets {
                insert_secret(projection, event_id, secret, ProjectedSecretOrigin::Created);
            }
            if let crate::EpochPasswordState::Replace(password_entries) = password_entries {
                projection.password_entries.clone_from(password_entries);
            }
        }
        VaultOperation::SecretCreated { secret } => {
            insert_secret(projection, event_id, secret, ProjectedSecretOrigin::Created);
        }
        VaultOperation::SecretDeleted { secret_id } => {
            if let Some(entry) = projection.secrets.get_mut(secret_id) {
                entry.lifecycle = ProjectedSecretLifecycle::Deleted {
                    by: event_id.clone(),
                };
            }
        }
        VaultOperation::SecretReplaced { old_id, new_secret } => {
            if let Some(entry) = projection.secrets.get_mut(old_id) {
                entry.lifecycle = ProjectedSecretLifecycle::Deleted {
                    by: event_id.clone(),
                };
            }
            insert_secret(
                projection,
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
                if let Some(entry) = projection.secrets.get_mut(rejected) {
                    entry.lifecycle = ProjectedSecretLifecycle::Deleted {
                        by: event_id.clone(),
                    };
                }
            }
            replacements_by_old.remove(old_id);
            projection.replacement_conflicts.remove(old_id);
            if let Some(chosen) = projection.secrets.get(chosen_secret_id) {
                let _ = chosen;
            }
        }
        VaultOperation::VaultCleared => {
            projection.cleared = true;
            projection.secrets.clear();
            projection.password_entries.clear();
        }
        VaultOperation::PasswordAdded {
            entry_id,
            label,
            created_at,
            envelope,
        } => {
            upsert_password_entry(
                projection,
                PasswordUnlockEntry {
                    id: entry_id.as_str().to_owned(),
                    label: label.to_owned(),
                    created_at: created_at.as_str().to_owned(),
                    envelope: envelope.clone(),
                },
            );
        }
        VaultOperation::PasswordRotated { entry_id, envelope }
        | VaultOperation::PasswordEnvelopeUpgraded { entry_id, envelope } => {
            if let Some(entry) = projection
                .password_entries
                .iter_mut()
                .find(|entry| entry.id == entry_id.as_str())
            {
                entry.envelope.clone_from(envelope);
            }
        }
        VaultOperation::PasswordRemoved { entry_id } => {
            projection
                .password_entries
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
    projection: &mut VaultProjection,
    event_id: &EventId,
    secret: &EncryptedSecretPayload,
    origin: ProjectedSecretOrigin,
) {
    projection.secrets.insert(
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

fn upsert_password_entry(projection: &mut VaultProjection, entry: PasswordUnlockEntry) {
    if let Some(existing) = projection
        .password_entries
        .iter_mut()
        .find(|existing| existing.id == entry.id)
    {
        *existing = entry;
        return;
    }
    projection.password_entries.push(entry);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{PasswordEnvelope, SecretFingerprint};
    use nook_auth2::{IsoTimestamp, OpaqueCiphertext, PasswordEntryId, SecretType, Sha256Hex};

    fn event_id() -> crate::EventResult<EventId> {
        EventId::parse("sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo")
    }

    fn secret_id(value: &str) -> SecretId {
        SecretId::from_vault_record(value)
    }

    fn secret(value: &str) -> EncryptedSecretPayload {
        EncryptedSecretPayload {
            id: secret_id(value),
            secret_type: SecretType::ApiKey,
            ciphertext: OpaqueCiphertext::from_trusted(format!("cipher-{value}")),
            identity_fingerprint: SecretFingerprint::from_trusted(format!("identity-{value}")),
            fingerprint: SecretFingerprint::from_trusted(format!("version-{value}")),
        }
    }

    fn password_envelope(ciphertext: &str) -> PasswordEnvelope {
        PasswordEnvelope {
            version: 1,
            kdf: "scrypt".to_owned(),
            work_factor: 10,
            recipient: String::new(),
            wrapped_keys: String::new(),
            ciphertext: ciphertext.to_owned(),
        }
    }

    #[test]
    fn secret_lifecycle_operations_update_records_and_replacement_history() -> anyhow::Result<()> {
        let mut projection = VaultProjection::default();
        let mut replacements = BTreeMap::new();
        let creator = event_id()?;
        let original_id = secret_id("secret_original1");

        apply_operation(
            &mut projection,
            &creator,
            &VaultOperation::SecretCreated {
                secret: secret("secret_original1"),
            },
            &mut replacements,
        );
        assert!(matches!(
            projection.secrets[&original_id].lifecycle,
            ProjectedSecretLifecycle::Live
        ));

        let replacement_id = secret_id("secret_replaced1");
        apply_operation(
            &mut projection,
            &creator,
            &VaultOperation::SecretReplaced {
                old_id: original_id.clone(),
                new_secret: secret("secret_replaced1"),
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

        apply_operation(
            &mut projection,
            &creator,
            &VaultOperation::SecretDeleted {
                secret_id: secret_id("secret_replaced1"),
            },
            &mut replacements,
        );
        assert!(matches!(
            projection.secrets[&secret_id("secret_replaced1")].lifecycle,
            ProjectedSecretLifecycle::Deleted { .. }
        ));
        Ok(())
    }

    #[test]
    fn import_materializes_state_and_clear_removes_it() -> anyhow::Result<()> {
        let mut projection = VaultProjection::default();
        let mut replacements = BTreeMap::new();
        let importer = event_id()?;
        let imported_entry = PasswordUnlockEntry {
            id: "pwdentry001".to_owned(),
            label: "Travel recovery".to_owned(),
            created_at: "2026-06-28T00:00:00Z".to_owned(),
            envelope: password_envelope("imported"),
        };

        apply_operation(
            &mut projection,
            &importer,
            &VaultOperation::VaultImported {
                source_content_hash: Sha256Hex::from_trusted("deadbeef".repeat(8)),
                secrets: vec![secret("secret_imported1")],
                password_entries: vec![imported_entry.clone()],
            },
            &mut replacements,
        );
        assert!(
            projection
                .secrets
                .contains_key(&secret_id("secret_imported1"))
        );
        assert_eq!(projection.password_entries, vec![imported_entry]);

        apply_operation(
            &mut projection,
            &importer,
            &VaultOperation::VaultCleared,
            &mut replacements,
        );
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
        let actor = event_id()?;

        apply_operation(
            &mut projection,
            &actor,
            &VaultOperation::PasswordAdded {
                entry_id: entry_id.clone(),
                label: "Primary recovery".to_owned(),
                created_at: IsoTimestamp::from_trusted("2026-06-28T00:00:01Z".to_owned()),
                envelope: password_envelope("initial"),
            },
            &mut replacements,
        );
        assert_eq!(projection.password_entries.len(), 1);
        assert_eq!(projection.password_entries[0].label, "Primary recovery");

        apply_operation(
            &mut projection,
            &actor,
            &VaultOperation::PasswordRotated {
                entry_id: entry_id.clone(),
                envelope: password_envelope("rotated"),
            },
            &mut replacements,
        );
        assert_eq!(
            projection.password_entries[0].envelope.ciphertext,
            "rotated"
        );
        apply_operation(
            &mut projection,
            &actor,
            &VaultOperation::PasswordEnvelopeUpgraded {
                entry_id: entry_id.clone(),
                envelope: password_envelope("upgraded"),
            },
            &mut replacements,
        );
        assert_eq!(
            projection.password_entries[0].envelope.ciphertext,
            "upgraded"
        );

        apply_operation(
            &mut projection,
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
                envelope: password_envelope("old-keys"),
            }],
            ..VaultProjection::default()
        };
        let replacement = PasswordUnlockEntry {
            id: "pwdentry002".to_owned(),
            label: "Survivor".to_owned(),
            created_at: "2026-06-28T00:00:01Z".to_owned(),
            envelope: password_envelope("new-keys"),
        };

        apply_operation(
            &mut projection,
            &event_id()?,
            &VaultOperation::EpochCheckpoint {
                secrets: Vec::new(),
                members_checkpoint_hash: Sha256Hex::from_trusted("deadbeef".repeat(8)),
                rotated_meta_records: Vec::new(),
                password_entries: crate::EpochPasswordState::Replace(vec![replacement.clone()]),
            },
            &mut BTreeMap::new(),
        );

        assert_eq!(projection.password_entries, vec![replacement]);
        Ok(())
    }
}

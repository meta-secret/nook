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
        VaultOperation::EpochCheckpoint { secrets, .. } => {
            for secret in secrets {
                insert_secret(projection, event_id, secret, ProjectedSecretOrigin::Created);
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
        VaultOperation::PasswordRotated { entry_id, envelope } => {
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

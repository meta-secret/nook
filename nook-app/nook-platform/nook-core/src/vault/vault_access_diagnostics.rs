//! Safe vault-access diagnostics for encrypted records and key epochs.
//!
//! This module intentionally reports only metadata: ids, statuses, epochs, and
//! explanations. It verifies decryptability by using the same auth envelopes and
//! age ciphertext parser as normal unlock, but it never returns plaintext keys,
//! private device material, or decrypted secret values.

use crate::EventId;
use crate::ProjectionEpoch;
use crate::errors::VaultResult;
use crate::secret_types::StoredSecretRecord;
use crate::vault_ids::{AuthKeyId, SecretId};
use crate::vault_wire::AgeArmoredCiphertext;
use crate::{
    DeviceIdentity, VaultCrypto, VaultMetaRecord, is_auth_id, parse_auth_envelopes,
    pending_join_for_device, resolve_members_key, resolve_secrets_key,
};
use crate::{VaultEvent, VaultEventSchemaVersion, VaultOperation};
use std::collections::{BTreeMap, BTreeSet};

mod model;

pub use model::*;

#[derive(Debug, Clone, Copy)]
enum SecretEpochRef<'a> {
    Unknown,
    Known(&'a EventId),
}

#[derive(Debug, Clone)]
enum ResolvedSecretsKey {
    Unavailable,
    Available(crate::SymmetricKey),
}

struct EpochIndex {
    current: ProjectionEpochIndex,
    known: BTreeSet<EventId>,
    secret_epochs: BTreeMap<SecretId, EventId>,
}

enum ProjectionEpochIndex {
    BeforeGenesis,
    Current(EventId),
}

impl EpochIndex {
    fn from_projection(
        projection: ProjectionDiagnosticInput<'_>,
        events: &[VaultEvent],
    ) -> VaultResult<Self> {
        let mut secret_epochs = BTreeMap::new();
        let mut event_epochs = BTreeMap::new();
        for event in events {
            event_epochs.insert(event.id()?, event.body.key_epoch.clone());
        }
        if let ProjectionDiagnosticInput::Available(projection) = projection {
            for (secret_id, projected) in &projection.secrets {
                if let Some(epoch) = event_epochs.get(&projected.created_by) {
                    secret_epochs.insert(secret_id.clone(), epoch.clone());
                }
            }
        }
        let current = match projection {
            ProjectionDiagnosticInput::Unavailable => ProjectionEpochIndex::BeforeGenesis,
            ProjectionDiagnosticInput::Available(projection) => match &projection.epoch {
                ProjectionEpoch::BeforeGenesis => ProjectionEpochIndex::BeforeGenesis,
                ProjectionEpoch::Current(epoch) => {
                    ProjectionEpochIndex::Current(epoch.as_event_id().clone())
                }
            },
        };
        let mut known = match projection {
            ProjectionDiagnosticInput::Unavailable => BTreeSet::new(),
            ProjectionDiagnosticInput::Available(projection) => projection
                .epoch_history
                .iter()
                .map(|record| record.epoch.as_event_id().clone())
                .collect(),
        };
        if let ProjectionEpochIndex::Current(epoch) = &current {
            known.insert(epoch.clone());
        }
        Ok(Self {
            current,
            known,
            secret_epochs,
        })
    }

    fn classify(&self, epoch: SecretEpochRef<'_>) -> VaultEpochDiagnosticStatus {
        let epoch = match epoch {
            SecretEpochRef::Unknown => return VaultEpochDiagnosticStatus::UnknownEpoch,
            SecretEpochRef::Known(epoch) => epoch,
        };
        if matches!(&self.current, ProjectionEpochIndex::Current(current) if current == epoch) {
            return VaultEpochDiagnosticStatus::CurrentEpoch;
        }
        if self.known.contains(epoch) {
            return VaultEpochDiagnosticStatus::OlderEpoch;
        }
        VaultEpochDiagnosticStatus::UnknownEpoch
    }
}

#[must_use]
fn key_status_explanation(status: VaultKeyAccessDiagnosticStatus) -> &'static str {
    match status {
        VaultKeyAccessDiagnosticStatus::EnrolledDecryptable => {
            "This device has a decryptable auth envelope for the current vault keys."
        }
        VaultKeyAccessDiagnosticStatus::AuthRowMissing => {
            "No auth envelope is available for this device."
        }
        VaultKeyAccessDiagnosticStatus::JoinPending => {
            "This device has a pending join request and is waiting for approval."
        }
        VaultKeyAccessDiagnosticStatus::DeviceIdentityMismatch => {
            "Vault auth rows exist, but none match this local device identity. The local passkey or device identity may have been regenerated."
        }
        VaultKeyAccessDiagnosticStatus::EnvelopeDecryptFailed => {
            "The matching auth envelope exists, but this local device identity could not decrypt the vault keys."
        }
        VaultKeyAccessDiagnosticStatus::UnsupportedEpoch => {
            "The vault contains key-epoch metadata this build does not support."
        }
        VaultKeyAccessDiagnosticStatus::CorruptCiphertext => {
            "The matching auth row is malformed or contains invalid ciphertext metadata."
        }
    }
}

fn key_access_status(
    records: &[StoredSecretRecord],
    identity: &DeviceIdentity,
    projection: ProjectionDiagnosticInput<'_>,
) -> VaultKeyAccessDiagnosticStatus {
    if matches!(
        projection,
        ProjectionDiagnosticInput::Available(projection) if projection.unresolved_schema
    ) {
        return VaultKeyAccessDiagnosticStatus::UnsupportedEpoch;
    }
    if pending_join_for_device(records, identity.device_id()).is_some() {
        return VaultKeyAccessDiagnosticStatus::JoinPending;
    }
    let auth_id = identity.auth_id();
    let auth_rows: Vec<&StoredSecretRecord> = records
        .iter()
        .filter(|record| is_auth_id(record.key.as_str()))
        .collect();
    let Some(auth_record) = auth_rows
        .iter()
        .find(|record| record.key.as_str() == auth_id.as_str())
    else {
        return if auth_rows.is_empty() {
            VaultKeyAccessDiagnosticStatus::AuthRowMissing
        } else {
            VaultKeyAccessDiagnosticStatus::DeviceIdentityMismatch
        };
    };
    if parse_auth_envelopes(auth_record.value.as_str()).is_err() {
        return VaultKeyAccessDiagnosticStatus::CorruptCiphertext;
    }
    if resolve_secrets_key(records, identity).is_err()
        || resolve_members_key(records, identity).is_err()
    {
        return VaultKeyAccessDiagnosticStatus::EnvelopeDecryptFailed;
    }
    VaultKeyAccessDiagnosticStatus::EnrolledDecryptable
}

fn record_status_from_key_status(
    status: VaultKeyAccessDiagnosticStatus,
) -> VaultRecordDecryptabilityStatus {
    match status {
        VaultKeyAccessDiagnosticStatus::EnrolledDecryptable => {
            VaultRecordDecryptabilityStatus::Decryptable
        }
        VaultKeyAccessDiagnosticStatus::AuthRowMissing => {
            VaultRecordDecryptabilityStatus::AuthRowMissing
        }
        VaultKeyAccessDiagnosticStatus::JoinPending => VaultRecordDecryptabilityStatus::JoinPending,
        VaultKeyAccessDiagnosticStatus::DeviceIdentityMismatch => {
            VaultRecordDecryptabilityStatus::DeviceIdentityMismatch
        }
        VaultKeyAccessDiagnosticStatus::EnvelopeDecryptFailed => {
            VaultRecordDecryptabilityStatus::EnvelopeDecryptFailed
        }
        VaultKeyAccessDiagnosticStatus::UnsupportedEpoch => {
            VaultRecordDecryptabilityStatus::UnsupportedEpoch
        }
        VaultKeyAccessDiagnosticStatus::CorruptCiphertext => {
            VaultRecordDecryptabilityStatus::CorruptCiphertext
        }
    }
}

#[must_use]
fn secret_status_explanation(status: VaultRecordDecryptabilityStatus) -> &'static str {
    match status {
        VaultRecordDecryptabilityStatus::Decryptable => {
            "This device can decrypt the secret payload with the resolved secrets_key."
        }
        VaultRecordDecryptabilityStatus::AuthRowMissing => {
            "This device cannot test the secret because its auth envelope is missing."
        }
        VaultRecordDecryptabilityStatus::JoinPending => {
            "This device cannot test the secret until its join request is approved."
        }
        VaultRecordDecryptabilityStatus::DeviceIdentityMismatch => {
            "This device cannot test the secret because local identity no longer matches any vault auth row."
        }
        VaultRecordDecryptabilityStatus::EnvelopeDecryptFailed => {
            "This device found its auth row but could not unwrap the vault keys."
        }
        VaultRecordDecryptabilityStatus::UnsupportedEpoch => {
            "This record belongs to key-epoch metadata this build does not support."
        }
        VaultRecordDecryptabilityStatus::UnknownEpoch => {
            "This record has no known key-epoch metadata in the current projection."
        }
        VaultRecordDecryptabilityStatus::CorruptCiphertext => {
            "The secret payload is malformed or could not be decrypted with the resolved secrets_key."
        }
    }
}

fn encrypted_payload_count(operation: &VaultOperation) -> usize {
    match operation {
        VaultOperation::VaultImported {
            secrets,
            password_entries,
            ..
        } => secrets.len() + password_entries.len(),
        VaultOperation::EpochCheckpoint {
            secrets,
            password_entries,
            ..
        } => {
            secrets.len()
                + match password_entries {
                    crate::EpochPasswordState::LegacyRetain => 0,
                    crate::EpochPasswordState::Replace(entries) => entries.len(),
                }
        }
        VaultOperation::SecretCreated { .. }
        | VaultOperation::SecretReplaced { .. }
        | VaultOperation::PasswordAdded { .. }
        | VaultOperation::PasswordRotated { .. }
        | VaultOperation::PasswordEnvelopeUpgraded { .. } => 1,
        VaultOperation::JoinApproved { .. } => 2,
        VaultOperation::SentinelSharesIssued { shares } => shares.len(),
        VaultOperation::SecretDeleted { .. }
        | VaultOperation::SecretConflictResolved { .. }
        | VaultOperation::JoinRequested { .. }
        | VaultOperation::SentinelParticipantEnrolled { .. }
        | VaultOperation::JoinDenied { .. }
        | VaultOperation::MemberRenamed { .. }
        | VaultOperation::DeviceRevoked { .. }
        | VaultOperation::PasswordRemoved { .. }
        | VaultOperation::VaultCleared => 0,
    }
}

fn auth_key_ids(records: &[StoredSecretRecord]) -> Vec<AuthKeyId> {
    let mut auth_key_ids: Vec<AuthKeyId> = records
        .iter()
        .filter(|record| is_auth_id(record.key.as_str()))
        .filter_map(|record| AuthKeyId::parse(record.key.as_str()).ok())
        .collect();
    auth_key_ids.sort();
    auth_key_ids.dedup();
    auth_key_ids
}

fn diagnose_secret_records(
    records: &[StoredSecretRecord],
    key_status: VaultKeyAccessDiagnosticStatus,
    secrets_key: &ResolvedSecretsKey,
    epoch_index: &EpochIndex,
) -> Vec<VaultSecretAccessDiagnostic> {
    let crypto = match secrets_key {
        ResolvedSecretsKey::Unavailable => None,
        ResolvedSecretsKey::Available(key) => VaultCrypto::new(key).ok(),
    };
    let mut secrets = Vec::new();
    for record in records {
        let VaultMetaRecord::Secret(secret_id, secret_type, payload) =
            VaultMetaRecord::classify(record)
        else {
            continue;
        };
        let epoch = match epoch_index.secret_epochs.get(&secret_id) {
            Some(epoch) => SecretEpochRef::Known(epoch),
            None => SecretEpochRef::Unknown,
        };
        let mut status = record_status_from_key_status(key_status);
        if status == VaultRecordDecryptabilityStatus::Decryptable {
            status = match (
                AgeArmoredCiphertext::parse(payload.as_str()),
                crypto.as_ref(),
            ) {
                (Ok(armored), Some(crypto)) if crypto.decrypt_value(&armored).is_ok() => {
                    VaultRecordDecryptabilityStatus::Decryptable
                }
                _ => VaultRecordDecryptabilityStatus::CorruptCiphertext,
            };
        }
        secrets.push(VaultSecretAccessDiagnostic {
            secret_id,
            secret_type,
            status,
            epoch_status: epoch_index.classify(epoch),
            epoch: match epoch {
                SecretEpochRef::Unknown => DiagnosticEpoch::Unknown,
                SecretEpochRef::Known(epoch) => DiagnosticEpoch::Known(epoch.as_str().to_owned()),
            },
            explanation: secret_status_explanation(status).to_owned(),
        });
    }
    secrets.sort_by(|left, right| left.secret_id.cmp(&right.secret_id));
    secrets
}

fn epoch_history_diagnostics(
    projection: ProjectionDiagnosticInput<'_>,
) -> Vec<VaultEpochHistoryDiagnostic> {
    match projection {
        ProjectionDiagnosticInput::Unavailable => Vec::new(),
        ProjectionDiagnosticInput::Available(projection) => projection
            .epoch_history
            .iter()
            .map(|record| VaultEpochHistoryDiagnostic {
                epoch_id: record.epoch.as_str().to_owned(),
                started_by: record.started_by.as_str().to_owned(),
                reason: record.reason.as_str().to_owned(),
            })
            .collect(),
    }
}

fn event_epoch_explanation(status: VaultEpochDiagnosticStatus) -> &'static str {
    match status {
        VaultEpochDiagnosticStatus::CurrentEpoch => {
            "Event encrypted payloads are tagged with the current key epoch."
        }
        VaultEpochDiagnosticStatus::OlderEpoch => {
            "Event encrypted payloads are tagged with a known older key epoch."
        }
        VaultEpochDiagnosticStatus::UnknownEpoch => {
            "Event encrypted payloads reference an epoch missing from the projected epoch history."
        }
        VaultEpochDiagnosticStatus::UnsupportedEpoch => {
            "Event encrypted payloads use unsupported schema or epoch metadata."
        }
    }
}

fn diagnose_event_payloads(
    events: &[VaultEvent],
    epoch_index: &EpochIndex,
    projection_unresolved: bool,
) -> VaultResult<Vec<VaultEventPayloadAccessDiagnostic>> {
    let mut diagnostics = Vec::new();
    for event in events {
        let event_id = event.id()?;
        let encrypted_payloads = event
            .body
            .operations
            .iter()
            .map(encrypted_payload_count)
            .sum();
        let epoch_status = if projection_unresolved
            || event.body.schema_version != VaultEventSchemaVersion::CURRENT
        {
            VaultEpochDiagnosticStatus::UnsupportedEpoch
        } else {
            epoch_index.classify(SecretEpochRef::Known(&event.body.key_epoch))
        };
        diagnostics.push(VaultEventPayloadAccessDiagnostic {
            event_id: event_id.as_str().to_owned(),
            key_epoch: event.body.key_epoch.as_str().to_owned(),
            epoch_status,
            encrypted_payloads,
            explanation: event_epoch_explanation(epoch_status).to_owned(),
        });
    }
    diagnostics.sort_by(|left, right| left.event_id.cmp(&right.event_id));
    Ok(diagnostics)
}

/// Build a safe diagnostic report for the current device and encrypted vault state.
pub fn diagnose_vault_access(
    records: &[StoredSecretRecord],
    identity: &DeviceIdentity,
    projection: ProjectionDiagnosticInput<'_>,
    events: &[VaultEvent],
) -> VaultResult<VaultAccessDiagnosticsReport> {
    let epoch_index = EpochIndex::from_projection(projection, events)?;
    let projection_unresolved = matches!(
        projection,
        ProjectionDiagnosticInput::Available(projection) if projection.unresolved_schema
    );
    let key_status = key_access_status(records, identity, projection);
    let key_access = VaultKeyAccessDiagnostic {
        status: key_status,
        device_id: identity.device_id().clone(),
        auth_id: identity.auth_id(),
        explanation: key_status_explanation(key_status).to_owned(),
    };
    let secrets_key = if key_status == VaultKeyAccessDiagnosticStatus::EnrolledDecryptable {
        match resolve_secrets_key(records, identity) {
            Ok(key) => ResolvedSecretsKey::Available(key),
            Err(_) => ResolvedSecretsKey::Unavailable,
        }
    } else {
        ResolvedSecretsKey::Unavailable
    };

    let current_epoch = match &epoch_index.current {
        ProjectionEpochIndex::BeforeGenesis => DiagnosticEpoch::Unknown,
        ProjectionEpochIndex::Current(event_id) => {
            DiagnosticEpoch::Known(event_id.as_str().to_owned())
        }
    };

    Ok(VaultAccessDiagnosticsReport {
        key_access,
        auth_key_ids: auth_key_ids(records),
        current_epoch,
        epoch_history: epoch_history_diagnostics(projection),
        secrets: diagnose_secret_records(records, key_status, &secrets_key, &epoch_index),
        events: diagnose_event_payloads(events, &epoch_index, projection_unresolved)?,
        warnings: Vec::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        ApiKeySecret, EncryptedSecretPayload, GenesisImportPayload, IsoTimestamp, KeyEpoch,
        PasswordEntryId, PasswordEnvelope, PasswordUnlockEntry, SecretType, SecretValue, Sha256Hex,
        SigningIdentity, StoreId, StoredRecordPayload, VaultProjection, VaultResult,
        build_genesis_import_event, generate_vault_keys, genesis_auth_record,
    };
    use ed25519_dalek::SigningKey;

    fn signing_key() -> SigningKey {
        SigningKey::from_bytes(&[11_u8; 32])
    }

    fn encrypted_secret(
        id: &str,
        crypto: &VaultCrypto,
        value: &str,
    ) -> VaultResult<StoredSecretRecord> {
        Ok(StoredSecretRecord {
            key: SecretId::from_vault_record(id),
            secret_type: Some(SecretType::ApiKey),
            value: StoredRecordPayload::from_age_armored(
                crypto.encrypt_value(
                    SecretValue::ApiKey(ApiKeySecret {
                        website_url: "https://example.com".to_owned(),
                        key: value.to_owned(),
                        expires_at: String::new(),
                    })
                    .to_yaml()?,
                )?,
            ),
        })
    }

    fn password_envelope() -> PasswordEnvelope {
        PasswordEnvelope {
            version: 1,
            kdf: "scrypt".to_owned(),
            work_factor: 15,
            recipient: String::new(),
            wrapped_keys: String::new(),
            ciphertext: "age encrypted vault keys".to_owned(),
        }
    }

    fn password_unlock_entry(id: &str) -> PasswordUnlockEntry {
        PasswordUnlockEntry {
            id: id.to_owned(),
            label: "Recovery".to_owned(),
            created_at: "2026-07-06T00:00:00Z".to_owned(),
            envelope: password_envelope(),
        }
    }

    #[test]
    fn enrolled_device_reports_decryptable_secret() -> VaultResult<()> {
        let identity = DeviceIdentity::generate()?;
        let keys = generate_vault_keys()?;
        let crypto = VaultCrypto::new(&keys.secrets_key)?;
        let mut records = vec![genesis_auth_record(
            &identity,
            &keys.secrets_key,
            &keys.members_key,
        )?];
        records.push(encrypted_secret("secret_diag001", &crypto, "token")?);

        let report = diagnose_vault_access(
            &records,
            &identity,
            ProjectionDiagnosticInput::Unavailable,
            &[],
        )?;

        assert_eq!(
            report.key_access.status,
            VaultKeyAccessDiagnosticStatus::EnrolledDecryptable
        );
        assert_eq!(
            report.secrets[0].status,
            VaultRecordDecryptabilityStatus::Decryptable
        );
        Ok(())
    }

    #[test]
    fn wrong_device_identity_reports_mismatch() -> VaultResult<()> {
        let enrolled = DeviceIdentity::generate()?;
        let current = DeviceIdentity::generate()?;
        let keys = generate_vault_keys()?;
        let records = vec![genesis_auth_record(
            &enrolled,
            &keys.secrets_key,
            &keys.members_key,
        )?];

        let report = diagnose_vault_access(
            &records,
            &current,
            ProjectionDiagnosticInput::Unavailable,
            &[],
        )?;

        assert_eq!(
            report.key_access.status,
            VaultKeyAccessDiagnosticStatus::DeviceIdentityMismatch
        );
        Ok(())
    }

    #[test]
    fn missing_auth_rows_report_auth_row_missing() -> VaultResult<()> {
        let identity = DeviceIdentity::generate()?;

        let report =
            diagnose_vault_access(&[], &identity, ProjectionDiagnosticInput::Unavailable, &[])?;

        assert_eq!(
            report.key_access.status,
            VaultKeyAccessDiagnosticStatus::AuthRowMissing
        );
        Ok(())
    }

    #[test]
    fn corrupt_secret_ciphertext_is_reported_without_plaintext() -> VaultResult<()> {
        let identity = DeviceIdentity::generate()?;
        let keys = generate_vault_keys()?;
        let mut records = vec![genesis_auth_record(
            &identity,
            &keys.secrets_key,
            &keys.members_key,
        )?];
        records.push(StoredSecretRecord {
            key: SecretId::from_vault_record("secret_corrupt01"),
            secret_type: Some(SecretType::ApiKey),
            value: StoredRecordPayload::from_trusted("not age".to_owned()),
        });

        let report = diagnose_vault_access(
            &records,
            &identity,
            ProjectionDiagnosticInput::Unavailable,
            &[],
        )?;

        assert_eq!(
            report.secrets[0].status,
            VaultRecordDecryptabilityStatus::CorruptCiphertext
        );
        Ok(())
    }

    #[test]
    fn unresolved_projection_schema_reports_unsupported_epoch() -> VaultResult<()> {
        let identity = DeviceIdentity::generate()?;
        let projection = VaultProjection {
            unresolved_schema: true,
            ..VaultProjection::default()
        };

        let report = diagnose_vault_access(
            &[],
            &identity,
            ProjectionDiagnosticInput::Available(&projection),
            &[],
        )?;

        assert_eq!(
            report.key_access.status,
            VaultKeyAccessDiagnosticStatus::UnsupportedEpoch
        );
        Ok(())
    }

    #[test]
    fn event_payload_diagnostics_report_current_epoch() -> VaultResult<()> {
        let identity = DeviceIdentity::generate()?;
        let signing_key = signing_key();
        let actor_id = SigningIdentity::actor_id_for_verifying_key(&signing_key.verifying_key())?;
        let store_id = StoreId::parse("store_diagstore11")?;
        let epoch = EventId::parse("sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo")?;
        let event = build_genesis_import_event(
            &store_id,
            &actor_id,
            &epoch,
            GenesisImportPayload {
                source_content_hash: Sha256Hex::from_trusted("deadbeef".repeat(8)),
                secrets: vec![EncryptedSecretPayload {
                    id: SecretId::from_vault_record("secret_eventdiag"),
                    secret_type: SecretType::ApiKey,
                    ciphertext: crate::OpaqueCiphertext::from_trusted("cipher".to_owned()),
                    identity_fingerprint: crate::SecretFingerprint::from_trusted(
                        "test:diagnostic-identity".to_owned(),
                    ),
                    fingerprint: crate::SecretFingerprint::from_trusted(
                        "test:diagnostic-version".to_owned(),
                    ),
                }],
                password_entries: Vec::new(),
            },
            &IsoTimestamp::from_trusted("2026-07-06T00:00:00Z".to_owned()),
            &signing_key,
        )?;
        let mut projection = VaultProjection {
            epoch: ProjectionEpoch::Current(KeyEpoch(epoch)),
            ..VaultProjection::default()
        };
        projection.store_id = store_id;

        let report = diagnose_vault_access(
            &[],
            &identity,
            ProjectionDiagnosticInput::Available(&projection),
            &[event],
        )?;

        assert_eq!(report.events.len(), 1);
        assert_eq!(
            report.events[0].epoch_status,
            VaultEpochDiagnosticStatus::CurrentEpoch
        );
        assert_eq!(report.events[0].encrypted_payloads, 1);
        Ok(())
    }

    #[test]
    fn encrypted_payload_count_includes_password_envelopes() {
        let secret = EncryptedSecretPayload {
            id: SecretId::from_vault_record("secret_payload01"),
            secret_type: SecretType::ApiKey,
            ciphertext: crate::OpaqueCiphertext::from_trusted("cipher".to_owned()),
            identity_fingerprint: crate::SecretFingerprint::from_trusted(
                "test:payload-identity".to_owned(),
            ),
            fingerprint: crate::SecretFingerprint::from_trusted("test:payload-version".to_owned()),
        };

        assert_eq!(
            encrypted_payload_count(&VaultOperation::VaultImported {
                source_content_hash: Sha256Hex::from_trusted("deadbeef".repeat(8)),
                secrets: vec![secret],
                password_entries: vec![password_unlock_entry("entry-1")],
            }),
            2
        );
        assert_eq!(
            encrypted_payload_count(&VaultOperation::PasswordAdded {
                entry_id: PasswordEntryId::from_trusted("entry-2".to_owned()),
                label: "Recovery".to_owned(),
                created_at: IsoTimestamp::from_trusted("2026-07-06T00:00:00Z".to_owned()),
                envelope: password_envelope(),
            }),
            1
        );
        assert_eq!(
            encrypted_payload_count(&VaultOperation::PasswordRotated {
                entry_id: PasswordEntryId::from_trusted("entry-3".to_owned()),
                envelope: password_envelope(),
            }),
            1
        );
        assert_eq!(
            encrypted_payload_count(&VaultOperation::PasswordRemoved {
                entry_id: PasswordEntryId::from_trusted("entry-4".to_owned()),
            }),
            0
        );
    }

    #[test]
    fn unresolved_projection_schema_marks_event_payload_epoch_unsupported() -> VaultResult<()> {
        let identity = DeviceIdentity::generate()?;
        let signing_key = signing_key();
        let actor_id = SigningIdentity::actor_id_for_verifying_key(&signing_key.verifying_key())?;
        let store_id = StoreId::parse("store_diagstore12")?;
        let epoch = EventId::parse("sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo")?;
        let event = build_genesis_import_event(
            &store_id,
            &actor_id,
            &epoch,
            GenesisImportPayload {
                source_content_hash: Sha256Hex::from_trusted("deadbeef".repeat(8)),
                secrets: Vec::new(),
                password_entries: Vec::new(),
            },
            &IsoTimestamp::from_trusted("2026-07-06T00:00:00Z".to_owned()),
            &signing_key,
        )?;
        let projection = VaultProjection {
            store_id,
            epoch: ProjectionEpoch::Current(KeyEpoch(epoch)),
            unresolved_schema: true,
            ..VaultProjection::default()
        };

        let report = diagnose_vault_access(
            &[],
            &identity,
            ProjectionDiagnosticInput::Available(&projection),
            &[event],
        )?;

        assert_eq!(
            report.events[0].epoch_status,
            VaultEpochDiagnosticStatus::UnsupportedEpoch
        );
        Ok(())
    }
}

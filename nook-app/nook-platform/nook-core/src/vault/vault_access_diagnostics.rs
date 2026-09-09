#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]

//! Safe vault-access diagnostics for encrypted records and key epochs.
//!
//! This module intentionally reports only metadata: ids, statuses, epochs, and
//! explanations. It verifies decryptability by using the same auth envelopes and
//! age ciphertext parser as normal unlock, but it never returns plaintext keys,
//! private device material, or decrypted secret values.

use crate::{EpochPasswordState, EventId, ProjectionEpoch};
use nook_auth2::{PendingJoinForDeviceRequest, VaultMetaState};
use nook_event_log::GenesisImportRequest;

use crate::errors::VaultResult;
use crate::secret_types::StoredSecretRecord;
use crate::vault_ids::{AuthKeyId, SecretId};
use crate::vault_wire::AgeArmoredCiphertext;
use crate::{
    AuthEnvelopes, DeviceIdentity, SymmetricKey, VaultCrypto, VaultMetaRecord, VaultRecordView,
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
    Available(SymmetricKey),
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
    fn from_projection(request: &VaultAccessDiagnosticRequest<'_>) -> VaultResult<Self> {
        let projection = request.projection;
        let events = request.events;
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

impl VaultAccessDiagnosticRequest<'_> {
    fn key_status(&self) -> VaultResult<VaultKeyAccessDiagnosticStatus> {
        let Self {
            records,
            identity,
            projection,
            ..
        } = *self;

        if matches!(
            projection,
            ProjectionDiagnosticInput::Available(projection) if projection.unresolved_schema
        ) {
            return Ok(VaultKeyAccessDiagnosticStatus::UnsupportedEpoch);
        }
        if VaultMetaState::pending_join_for_device(PendingJoinForDeviceRequest {
            records: records,
            device_id: identity.device_id(),
        })?
        .is_some()
        {
            return Ok(VaultKeyAccessDiagnosticStatus::JoinPending);
        }
        let auth_id = identity.auth_id();
        let auth_rows: Vec<&StoredSecretRecord> = records
            .iter()
            .filter(|record| crate::AuthKeyId::is_valid(record.key.as_str()))
            .collect();
        let Some(auth_record) = auth_rows
            .iter()
            .find(|record| record.key.as_str() == auth_id.as_str())
        else {
            return Ok(if auth_rows.is_empty() {
                VaultKeyAccessDiagnosticStatus::AuthRowMissing
            } else {
                VaultKeyAccessDiagnosticStatus::DeviceIdentityMismatch
            });
        };
        if AuthEnvelopes::parse(auth_record.value.as_str()).is_err() {
            return Ok(VaultKeyAccessDiagnosticStatus::CorruptCiphertext);
        }
        if VaultRecordView::new(records).secrets_key(identity).is_err()
            || VaultRecordView::new(records).members_key(identity).is_err()
        {
            return Ok(VaultKeyAccessDiagnosticStatus::EnvelopeDecryptFailed);
        }
        Ok(VaultKeyAccessDiagnosticStatus::EnrolledDecryptable)
    }
}

impl EncryptedOperationDiagnostic<'_> {
    fn payload_count(self) -> usize {
        let operation = self.0;

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
                        EpochPasswordState::LegacyRetain => 0,
                        EpochPasswordState::Replace(entries) => entries.len(),
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
}

impl VaultAccessDiagnosticRequest<'_> {
    fn auth_key_ids(&self) -> Vec<AuthKeyId> {
        let records = self.records;

        let mut auth_key_ids: Vec<AuthKeyId> = records
            .iter()
            .filter(|record| crate::AuthKeyId::is_valid(record.key.as_str()))
            .filter_map(|record| AuthKeyId::parse(record.key.as_str()).ok())
            .collect();
        auth_key_ids.sort();
        auth_key_ids.dedup();
        auth_key_ids
    }
}

impl EvaluatedVaultAccess<'_> {
    fn secret_records(&self) -> VaultResult<Vec<VaultSecretAccessDiagnostic>> {
        let records = self.request.records;
        let key_status = self.key_access.status;
        let secrets_key = &self.secrets_key;
        let epoch_index = &self.epoch_index;

        let crypto = match secrets_key {
            ResolvedSecretsKey::Unavailable => None,
            ResolvedSecretsKey::Available(key) => VaultCrypto::new(key).ok(),
        };
        let mut secrets = Vec::new();
        for record in records {
            let VaultMetaRecord::Secret(secret_id, secret_type, payload) = (record).classify()?
            else {
                continue;
            };
            let epoch = match epoch_index.secret_epochs.get(&secret_id) {
                Some(epoch) => SecretEpochRef::Known(epoch),
                None => SecretEpochRef::Unknown,
            };
            let mut status = key_status.record_status();
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
                    SecretEpochRef::Known(epoch) => {
                        DiagnosticEpoch::Known(epoch.as_str().to_owned())
                    }
                },
                explanation: status.explanation().to_owned(),
            });
        }
        secrets.sort_by(|left, right| left.secret_id.cmp(&right.secret_id));
        Ok(secrets)
    }
}

impl EvaluatedVaultAccess<'_> {
    fn event_payloads(&self) -> VaultResult<Vec<VaultEventPayloadAccessDiagnostic>> {
        let events = self.request.events;
        let epoch_index = &self.epoch_index;
        let projection_unresolved = matches!(self.request.projection, ProjectionDiagnosticInput::Available(projection) if projection.unresolved_schema);

        let mut diagnostics = Vec::new();
        for event in events {
            let event_id = event.id()?;
            let encrypted_payloads = event
                .body
                .operations
                .iter()
                .map(EncryptedOperationDiagnostic)
                .map(EncryptedOperationDiagnostic::payload_count)
                .sum::<usize>()
                .into();
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
                explanation: epoch_status.explanation().to_owned(),
            });
        }
        diagnostics.sort_by(|left, right| left.event_id.cmp(&right.event_id));
        Ok(diagnostics)
    }
}

/// Build a safe diagnostic report for the current device and encrypted vault state.
///
/// Evaluation is local diagnostic evidence, not authorization to access a vault.
///
/// ```
/// use nook_core::{DeviceIdentity, ProjectionDiagnosticInput, VaultAccessDiagnosticRequest};
/// let identity = DeviceIdentity::generate()?;
/// let report = VaultAccessDiagnosticRequest {
///     records: &[], identity: &identity,
///     projection: ProjectionDiagnosticInput::Unavailable, events: &[],
/// }.diagnose()?;
/// assert!(report.secrets.is_empty());
/// # Ok::<(), nook_core::VaultError>(())
/// ```
///
/// Callers cannot obtain or manufacture the internal evaluated state:
/// ```compile_fail
/// use nook_core::{DeviceIdentity, ProjectionDiagnosticInput, VaultAccessDiagnosticRequest};
/// let identity = DeviceIdentity::generate()?;
/// let request = VaultAccessDiagnosticRequest {
///     records: &[], identity: &identity,
///     projection: ProjectionDiagnosticInput::Unavailable, events: &[],
/// };
/// request.evaluate()?;
/// # Ok::<(), nook_core::VaultError>(())
/// ```
///
/// Reporting consumes the request:
/// ```compile_fail
/// use nook_core::{DeviceIdentity, ProjectionDiagnosticInput, VaultAccessDiagnosticRequest};
/// let identity = DeviceIdentity::generate()?;
/// let request = VaultAccessDiagnosticRequest {
///     records: &[], identity: &identity,
///     projection: ProjectionDiagnosticInput::Unavailable, events: &[],
/// };
/// let first = request.diagnose()?;
/// let second = request.diagnose()?;
/// # Ok::<(), nook_core::VaultError>(())
/// ```
pub struct VaultAccessDiagnosticRequest<'a> {
    pub records: &'a [StoredSecretRecord],
    pub identity: &'a DeviceIdentity,
    pub projection: ProjectionDiagnosticInput<'a>,
    pub events: &'a [VaultEvent],
}
struct EvaluatedVaultAccess<'a> {
    request: VaultAccessDiagnosticRequest<'a>,
    epoch_index: EpochIndex,
    key_access: VaultKeyAccessDiagnostic,
    secrets_key: ResolvedSecretsKey,
}
struct EncryptedOperationDiagnostic<'a>(&'a VaultOperation);
impl<'a> VaultAccessDiagnosticRequest<'a> {
    pub fn diagnose(self) -> VaultResult<VaultAccessDiagnosticsReport> {
        self.evaluate()?.report()
    }
    fn evaluate(self) -> VaultResult<EvaluatedVaultAccess<'a>> {
        let records = self.records;
        let identity = self.identity;

        let epoch_index = EpochIndex::from_projection(&self)?;
        let key_status = self.key_status()?;
        let key_access = VaultKeyAccessDiagnostic {
            status: key_status,
            device_id: identity.device_id().clone(),
            auth_id: identity.auth_id(),
            explanation: key_status.explanation().to_owned(),
        };
        let secrets_key = if key_status == VaultKeyAccessDiagnosticStatus::EnrolledDecryptable {
            match VaultRecordView::new(records).secrets_key(identity) {
                Ok(key) => ResolvedSecretsKey::Available(key),
                Err(_) => ResolvedSecretsKey::Unavailable,
            }
        } else {
            ResolvedSecretsKey::Unavailable
        };

        Ok(EvaluatedVaultAccess {
            request: self,
            epoch_index,
            key_access,
            secrets_key,
        })
    }
}
impl EvaluatedVaultAccess<'_> {
    fn report(self) -> VaultResult<VaultAccessDiagnosticsReport> {
        let current_epoch = match &self.epoch_index.current {
            ProjectionEpochIndex::BeforeGenesis => DiagnosticEpoch::Unknown,
            ProjectionEpochIndex::Current(event_id) => {
                DiagnosticEpoch::Known(event_id.as_str().to_owned())
            }
        };

        let auth_key_ids = self.request.auth_key_ids();
        let epoch_history = self.request.projection.epoch_history();
        let secrets = self.secret_records()?;
        let events = self.event_payloads()?;
        Ok(VaultAccessDiagnosticsReport {
            key_access: self.key_access,
            auth_key_ids,
            current_epoch,
            epoch_history,
            secrets,
            events,
            warnings: Vec::new(),
        })
    }
}

#[cfg(test)]
mod tests {
    struct EncryptedSecretFixture<'a> {
        id: &'a str,
        crypto: &'a VaultCrypto,
        value: &'a str,
    }
    struct PasswordDiagnosticFixture<'a> {
        id: &'a str,
    }

    use crate::{OpaqueCiphertext, SecretFingerprint};

    use super::*;
    use crate::{
        ApiKeySecret, EncryptedSecretPayload, GenesisImportPayload, IsoTimestamp, KeyEpoch,
        PasswordEntryId, PasswordEnvelope, PasswordEnvelopeVersion, PasswordUnlockEntry,
        SecretType, SecretValue, SigningIdentity, StoreId, StoredRecordPayload, VaultKeys,
        VaultProjection, VaultResult,
    };
    use ed25519_dalek::SigningKey;
    use std::ptr;

    #[test]
    fn encrypted_payload_count_preserves_scalar_json() -> serde_json::Result<()> {
        let count = VaultEncryptedPayloadCount::from(3);
        assert_eq!(serde_json::to_string(&count)?, "3");
        assert_eq!(
            serde_json::from_str::<VaultEncryptedPayloadCount>("3")?,
            count
        );
        Ok(())
    }

    impl EncryptedSecretFixture<'_> {
        fn record(self) -> VaultResult<StoredSecretRecord> {
            let Self { id, crypto, value } = self;

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
    }

    impl PasswordDiagnosticFixture<'_> {
        fn entry(self) -> PasswordUnlockEntry {
            let id = self.id;

            PasswordUnlockEntry {
                id: id.to_owned(),
                label: "Recovery".to_owned(),
                created_at: "2026-07-06T00:00:00Z".to_owned(),
                envelope: PasswordEnvelope {
                    version: PasswordEnvelopeVersion::LEGACY,
                    kdf: "scrypt".to_owned(),
                    work_factor: 15.into(),
                    recipient: String::new(),
                    wrapped_keys: String::new(),
                    ciphertext: "age encrypted vault keys".to_owned(),
                },
            }
        }
    }

    #[test]
    fn enrolled_device_reports_decryptable_secret() -> VaultResult<()> {
        let identity = DeviceIdentity::generate()?;
        let keys = VaultKeys::generate()?;
        let crypto = VaultCrypto::new(&keys.secrets_key)?;
        let mut records = vec![identity.auth_record(&keys.secrets_key, &keys.members_key)?];
        records.push(
            EncryptedSecretFixture {
                id: "secret_diag001",
                crypto: &crypto,
                value: "token",
            }
            .record()?,
        );

        let report = VaultAccessDiagnosticRequest {
            records: &records,
            identity: &identity,
            projection: ProjectionDiagnosticInput::Unavailable,
            events: &[],
        }
        .diagnose()?;

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
        let keys = VaultKeys::generate()?;
        let records = vec![enrolled.auth_record(&keys.secrets_key, &keys.members_key)?];

        let report = VaultAccessDiagnosticRequest {
            records: &records,
            identity: &current,
            projection: ProjectionDiagnosticInput::Unavailable,
            events: &[],
        }
        .diagnose()?;

        assert_eq!(
            report.key_access.status,
            VaultKeyAccessDiagnosticStatus::DeviceIdentityMismatch
        );
        Ok(())
    }

    #[test]
    fn missing_auth_rows_report_auth_row_missing() -> VaultResult<()> {
        let identity = DeviceIdentity::generate()?;

        let report = VaultAccessDiagnosticRequest {
            records: &[],
            identity: &identity,
            projection: ProjectionDiagnosticInput::Unavailable,
            events: &[],
        }
        .diagnose()?;

        assert_eq!(
            report.key_access.status,
            VaultKeyAccessDiagnosticStatus::AuthRowMissing
        );
        Ok(())
    }

    #[test]
    fn evaluation_binds_records_and_returns_sorted_metadata_without_mutation() -> anyhow::Result<()>
    {
        let identity = DeviceIdentity::generate()?;
        let keys = VaultKeys::generate()?;
        let crypto = VaultCrypto::new(&keys.secrets_key)?;
        let auth = identity.auth_record(&keys.secrets_key, &keys.members_key)?;
        let mut records = vec![auth.clone(), auth];
        for id in ["secret_diagzz", "secret_diagaa"] {
            records.push(
                EncryptedSecretFixture {
                    id,
                    crypto: &crypto,
                    value: "diagnostic-private-sentinel",
                }
                .record()?,
            );
        }
        let original = records.clone();
        let evaluated = VaultAccessDiagnosticRequest {
            records: &records,
            identity: &identity,
            projection: ProjectionDiagnosticInput::Unavailable,
            events: &[],
        }
        .evaluate()?;
        assert!(ptr::eq(
            evaluated.request.records.as_ptr(),
            records.as_ptr()
        ));
        let report = evaluated.report()?;
        assert_eq!(records, original);
        assert_eq!(report.auth_key_ids, vec![identity.auth_id()]);
        assert_eq!(
            report
                .secrets
                .iter()
                .map(|secret| secret.secret_id.as_str())
                .collect::<Vec<_>>(),
            vec!["secret_diagaa", "secret_diagzz"]
        );
        let encoded = serde_json::to_string(&report)?;
        assert!(!encoded.contains("diagnostic-private-sentinel"));
        assert_eq!(
            serde_json::from_str::<VaultAccessDiagnosticsReport>(&encoded)?,
            report
        );
        Ok(())
    }

    #[test]
    fn unsupported_projection_precedes_corrupt_auth_envelope() -> VaultResult<()> {
        let identity = DeviceIdentity::generate()?;
        let keys = VaultKeys::generate()?;
        let mut auth = identity.auth_record(&keys.secrets_key, &keys.members_key)?;
        auth.value = StoredRecordPayload::from_trusted("malformed auth".to_owned());
        let records = [auth];
        let projection = VaultProjection {
            unresolved_schema: true,
            ..VaultProjection::default()
        };
        let report = VaultAccessDiagnosticRequest {
            records: &records,
            identity: &identity,
            projection: ProjectionDiagnosticInput::Available(&projection),
            events: &[],
        }
        .diagnose()?;
        assert_eq!(
            report.key_access.status,
            VaultKeyAccessDiagnosticStatus::UnsupportedEpoch
        );
        let report = VaultAccessDiagnosticRequest {
            records: &records,
            identity: &identity,
            projection: ProjectionDiagnosticInput::Unavailable,
            events: &[],
        }
        .diagnose()?;
        assert_eq!(
            report.key_access.status,
            VaultKeyAccessDiagnosticStatus::CorruptCiphertext
        );
        Ok(())
    }

    #[test]
    fn corrupt_secret_ciphertext_is_reported_without_plaintext() -> VaultResult<()> {
        let identity = DeviceIdentity::generate()?;
        let keys = VaultKeys::generate()?;
        let mut records = vec![identity.auth_record(&keys.secrets_key, &keys.members_key)?];
        records.push(StoredSecretRecord {
            key: SecretId::from_vault_record("secret_corrupt01"),
            secret_type: Some(SecretType::ApiKey),
            value: StoredRecordPayload::from_trusted("not age".to_owned()),
        });

        let report = VaultAccessDiagnosticRequest {
            records: &records,
            identity: &identity,
            projection: ProjectionDiagnosticInput::Unavailable,
            events: &[],
        }
        .diagnose()?;

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

        let report = VaultAccessDiagnosticRequest {
            records: &[],
            identity: &identity,
            projection: ProjectionDiagnosticInput::Available(&projection),
            events: &[],
        }
        .diagnose()?;

        assert_eq!(
            report.key_access.status,
            VaultKeyAccessDiagnosticStatus::UnsupportedEpoch
        );
        Ok(())
    }

    #[test]
    fn event_payload_diagnostics_report_current_epoch() -> VaultResult<()> {
        let identity = DeviceIdentity::generate()?;
        let signing_key = SigningKey::from_bytes(&[11_u8; 32]);
        let actor_id = SigningIdentity::actor_id_for_verifying_key(&signing_key.verifying_key())?;
        let store_id = StoreId::parse("store_diagstore11")?;
        let epoch = EventId::parse("sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo")?;
        let event = VaultEvent::build_genesis_import_event(GenesisImportRequest {
            store_id: &store_id,
            actor_id: &actor_id,
            key_epoch: &epoch,
            payload: GenesisImportPayload {
                source_content_hash: nook_auth2::Sha256Hex::from_trusted("deadbeef".repeat(8)),
                secrets: vec![EncryptedSecretPayload {
                    id: SecretId::from_vault_record("secret_eventdiag"),
                    secret_type: SecretType::ApiKey,
                    ciphertext: OpaqueCiphertext::from_trusted("cipher".to_owned()),
                    identity_fingerprint: SecretFingerprint::from_trusted(
                        "test:diagnostic-identity".to_owned(),
                    ),
                    fingerprint: SecretFingerprint::from_trusted(
                        "test:diagnostic-version".to_owned(),
                    ),
                }],
                password_entries: Vec::new(),
            },
            created_at: &IsoTimestamp::from_trusted("2026-07-06T00:00:00Z".to_owned()),
            signing_key: &signing_key,
        })?;
        let mut projection = VaultProjection {
            epoch: ProjectionEpoch::Current(KeyEpoch(epoch)),
            ..VaultProjection::default()
        };
        projection.store_id = store_id;

        let report = VaultAccessDiagnosticRequest {
            records: &[],
            identity: &identity,
            projection: ProjectionDiagnosticInput::Available(&projection),
            events: &[event],
        }
        .diagnose()?;

        assert_eq!(report.events.len(), 1);
        assert_eq!(
            report.events[0].epoch_status,
            VaultEpochDiagnosticStatus::CurrentEpoch
        );
        assert_eq!(usize::from(report.events[0].encrypted_payloads), 1);
        Ok(())
    }

    #[test]
    fn encrypted_payload_count_includes_password_envelopes() {
        let secret = EncryptedSecretPayload {
            id: SecretId::from_vault_record("secret_payload01"),
            secret_type: SecretType::ApiKey,
            ciphertext: OpaqueCiphertext::from_trusted("cipher".to_owned()),
            identity_fingerprint: SecretFingerprint::from_trusted(
                "test:payload-identity".to_owned(),
            ),
            fingerprint: SecretFingerprint::from_trusted("test:payload-version".to_owned()),
        };

        assert_eq!(
            EncryptedOperationDiagnostic(&VaultOperation::VaultImported {
                source_content_hash: nook_auth2::Sha256Hex::from_trusted("deadbeef".repeat(8)),
                secrets: vec![secret],
                password_entries: vec![PasswordDiagnosticFixture { id: "entry-1" }.entry()],
            })
            .payload_count(),
            2
        );
        assert_eq!(
            EncryptedOperationDiagnostic(&VaultOperation::PasswordAdded {
                entry_id: PasswordEntryId::from_trusted("entry-2".to_owned()),
                label: "Recovery".to_owned(),
                created_at: IsoTimestamp::from_trusted("2026-07-06T00:00:00Z".to_owned()),
                envelope: PasswordDiagnosticFixture { id: "diagnostic" }
                    .entry()
                    .envelope,
            })
            .payload_count(),
            1
        );
        assert_eq!(
            EncryptedOperationDiagnostic(&VaultOperation::PasswordRotated {
                entry_id: PasswordEntryId::from_trusted("entry-3".to_owned()),
                envelope: PasswordDiagnosticFixture { id: "diagnostic" }
                    .entry()
                    .envelope,
            })
            .payload_count(),
            1
        );
        assert_eq!(
            EncryptedOperationDiagnostic(&VaultOperation::PasswordRemoved {
                entry_id: PasswordEntryId::from_trusted("entry-4".to_owned()),
            })
            .payload_count(),
            0
        );
    }

    #[test]
    fn unresolved_projection_schema_marks_event_payload_epoch_unsupported() -> VaultResult<()> {
        let identity = DeviceIdentity::generate()?;
        let signing_key = SigningKey::from_bytes(&[11_u8; 32]);
        let actor_id = SigningIdentity::actor_id_for_verifying_key(&signing_key.verifying_key())?;
        let store_id = StoreId::parse("store_diagstore12")?;
        let epoch = EventId::parse("sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo")?;
        let event = VaultEvent::build_genesis_import_event(GenesisImportRequest {
            store_id: &store_id,
            actor_id: &actor_id,
            key_epoch: &epoch,
            payload: GenesisImportPayload {
                source_content_hash: nook_auth2::Sha256Hex::from_trusted("deadbeef".repeat(8)),
                secrets: Vec::new(),
                password_entries: Vec::new(),
            },
            created_at: &IsoTimestamp::from_trusted("2026-07-06T00:00:00Z".to_owned()),
            signing_key: &signing_key,
        })?;
        let projection = VaultProjection {
            store_id,
            epoch: ProjectionEpoch::Current(KeyEpoch(epoch)),
            unresolved_schema: true,
            ..VaultProjection::default()
        };

        let report = VaultAccessDiagnosticRequest {
            records: &[],
            identity: &identity,
            projection: ProjectionDiagnosticInput::Available(&projection),
            events: &[event],
        }
        .diagnose()?;

        assert_eq!(
            report.events[0].epoch_status,
            VaultEpochDiagnosticStatus::UnsupportedEpoch
        );
        Ok(())
    }
}

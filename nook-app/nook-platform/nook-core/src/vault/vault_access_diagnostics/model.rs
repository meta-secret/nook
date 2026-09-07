use crate::VaultProjection;
use crate::secret_types::SecretType;
use crate::vault_ids::{AuthKeyId, DeviceId, SecretId};
use serde::{Deserialize, Serialize};

/// Number of encrypted payloads carried by one vault event.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct VaultEncryptedPayloadCount(usize);

impl From<usize> for VaultEncryptedPayloadCount {
    fn from(value: usize) -> Self {
        Self(value)
    }
}

impl From<VaultEncryptedPayloadCount> for usize {
    fn from(value: VaultEncryptedPayloadCount) -> Self {
        value.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VaultKeyAccessDiagnosticStatus {
    EnrolledDecryptable,
    AuthRowMissing,
    JoinPending,
    DeviceIdentityMismatch,
    EnvelopeDecryptFailed,
    UnsupportedEpoch,
    CorruptCiphertext,
}

impl VaultKeyAccessDiagnosticStatus {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::EnrolledDecryptable => "enrolled_decryptable",
            Self::AuthRowMissing => "auth_row_missing",
            Self::JoinPending => "join_pending",
            Self::DeviceIdentityMismatch => "device_identity_mismatch",
            Self::EnvelopeDecryptFailed => "envelope_decrypt_failed",
            Self::UnsupportedEpoch => "unsupported_epoch",
            Self::CorruptCiphertext => "corrupt_ciphertext",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VaultRecordDecryptabilityStatus {
    Decryptable,
    AuthRowMissing,
    JoinPending,
    DeviceIdentityMismatch,
    EnvelopeDecryptFailed,
    UnsupportedEpoch,
    UnknownEpoch,
    CorruptCiphertext,
}

impl VaultRecordDecryptabilityStatus {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Decryptable => "decryptable",
            Self::AuthRowMissing => "auth_row_missing",
            Self::JoinPending => "join_pending",
            Self::DeviceIdentityMismatch => "device_identity_mismatch",
            Self::EnvelopeDecryptFailed => "envelope_decrypt_failed",
            Self::UnsupportedEpoch => "unsupported_epoch",
            Self::UnknownEpoch => "unknown_epoch",
            Self::CorruptCiphertext => "corrupt_ciphertext",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VaultEpochDiagnosticStatus {
    CurrentEpoch,
    OlderEpoch,
    UnknownEpoch,
    UnsupportedEpoch,
}

impl VaultEpochDiagnosticStatus {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::CurrentEpoch => "current_epoch",
            Self::OlderEpoch => "older_epoch",
            Self::UnknownEpoch => "unknown_epoch",
            Self::UnsupportedEpoch => "unsupported_epoch",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultKeyAccessDiagnostic {
    pub status: VaultKeyAccessDiagnosticStatus,
    pub device_id: DeviceId,
    pub auth_id: AuthKeyId,
    pub explanation: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultSecretAccessDiagnostic {
    pub secret_id: SecretId,
    pub secret_type: SecretType,
    pub status: VaultRecordDecryptabilityStatus,
    pub epoch_status: VaultEpochDiagnosticStatus,
    pub epoch: DiagnosticEpoch,
    pub explanation: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultEpochHistoryDiagnostic {
    pub epoch_id: String,
    pub started_by: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultEventPayloadAccessDiagnostic {
    pub event_id: String,
    pub key_epoch: String,
    pub epoch_status: VaultEpochDiagnosticStatus,
    pub encrypted_payloads: VaultEncryptedPayloadCount,
    pub explanation: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultAccessDiagnosticsReport {
    pub key_access: VaultKeyAccessDiagnostic,
    pub auth_key_ids: Vec<AuthKeyId>,
    pub current_epoch: DiagnosticEpoch,
    pub epoch_history: Vec<VaultEpochHistoryDiagnostic>,
    pub secrets: Vec<VaultSecretAccessDiagnostic>,
    pub events: Vec<VaultEventPayloadAccessDiagnostic>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", content = "epochId", rename_all = "snake_case")]
pub enum DiagnosticEpoch {
    Unknown,
    Known(String),
}

#[derive(Debug, Clone, Copy)]
pub enum ProjectionDiagnosticInput<'a> {
    Unavailable,
    Available(&'a VaultProjection),
}

impl VaultKeyAccessDiagnosticStatus {
    pub(super) fn explanation(self) -> &'static str {
        let status = self;

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
}

impl VaultKeyAccessDiagnosticStatus {
    pub(super) fn record_status(self) -> VaultRecordDecryptabilityStatus {
        let status = self;

        match status {
            VaultKeyAccessDiagnosticStatus::EnrolledDecryptable => {
                VaultRecordDecryptabilityStatus::Decryptable
            }
            VaultKeyAccessDiagnosticStatus::AuthRowMissing => {
                VaultRecordDecryptabilityStatus::AuthRowMissing
            }
            VaultKeyAccessDiagnosticStatus::JoinPending => {
                VaultRecordDecryptabilityStatus::JoinPending
            }
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
}

impl VaultRecordDecryptabilityStatus {
    pub(super) fn explanation(self) -> &'static str {
        let status = self;

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
}

impl VaultEpochDiagnosticStatus {
    pub(super) fn explanation(self) -> &'static str {
        let status = self;

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
}

impl ProjectionDiagnosticInput<'_> {
    pub(super) fn epoch_history(self) -> Vec<VaultEpochHistoryDiagnostic> {
        let projection = self;

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
}

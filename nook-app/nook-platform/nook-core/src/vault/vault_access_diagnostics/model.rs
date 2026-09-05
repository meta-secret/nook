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

//! Cryptographic key epochs for password rotation and device revocation.

use crate::event_canonical::EventId;
use crate::vault_event::VaultOperation;

/// Identifies the epoch protecting private event payloads.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct KeyEpoch(pub EventId);

impl KeyEpoch {
    #[must_use]
    pub fn as_event_id(&self) -> &EventId {
        &self.0
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        self.0.as_str()
    }
}

/// Why a new key epoch was started.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EpochRotationReason {
    Genesis,
    PasswordRotated,
    PasswordRemoved,
    DeviceRevoked,
}

impl EpochRotationReason {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Genesis => "genesis",
            Self::PasswordRotated => "password-rotated",
            Self::PasswordRemoved => "password-removed",
            Self::DeviceRevoked => "device-revoked",
        }
    }
}

/// Record of an epoch transition in the projection.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EpochRecord {
    pub epoch: KeyEpoch,
    pub started_by: EventId,
    pub reason: EpochRotationReason,
}

/// Detect whether an operation starts a new key epoch.
#[must_use]
pub fn operation_starts_epoch(operation: &VaultOperation) -> Option<EpochRotationReason> {
    match operation {
        VaultOperation::VaultImported { .. } => Some(EpochRotationReason::Genesis),
        VaultOperation::PasswordRotated { .. } => Some(EpochRotationReason::PasswordRotated),
        VaultOperation::PasswordRemoved { .. } => Some(EpochRotationReason::PasswordRemoved),
        VaultOperation::DeviceRevoked { .. } => Some(EpochRotationReason::DeviceRevoked),
        VaultOperation::EpochCheckpoint { .. }
        | VaultOperation::SecretCreated { .. }
        | VaultOperation::SecretDeleted { .. }
        | VaultOperation::SecretReplaced { .. }
        | VaultOperation::SecretConflictResolved { .. }
        | VaultOperation::JoinRequested { .. }
        | VaultOperation::JoinApproved { .. }
        | VaultOperation::NexusParticipantEnrolled { .. }
        | VaultOperation::NexusSharesIssued { .. }
        | VaultOperation::JoinDenied { .. }
        | VaultOperation::MemberRenamed { .. }
        | VaultOperation::PasswordAdded { .. }
        | VaultOperation::VaultCleared => None,
    }
}

/// Whether two epoch-starting events are a security conflict when concurrent.
#[must_use]
pub fn concurrent_epoch_rotations_conflict(
    left: EpochRotationReason,
    right: EpochRotationReason,
) -> bool {
    matches!(
        (left, right),
        (
            EpochRotationReason::PasswordRotated
                | EpochRotationReason::PasswordRemoved
                | EpochRotationReason::DeviceRevoked,
            EpochRotationReason::PasswordRotated
                | EpochRotationReason::PasswordRemoved
                | EpochRotationReason::DeviceRevoked
        )
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn password_and_revoke_rotations_conflict_when_concurrent() {
        assert!(concurrent_epoch_rotations_conflict(
            EpochRotationReason::PasswordRotated,
            EpochRotationReason::DeviceRevoked
        ));
        assert!(!concurrent_epoch_rotations_conflict(
            EpochRotationReason::Genesis,
            EpochRotationReason::PasswordRotated
        ));
    }

    #[test]
    fn password_removed_and_rotated_conflict_when_concurrent() {
        assert!(concurrent_epoch_rotations_conflict(
            EpochRotationReason::PasswordRemoved,
            EpochRotationReason::PasswordRotated
        ));
    }

    #[test]
    fn concurrent_revokes_conflict() {
        assert!(concurrent_epoch_rotations_conflict(
            EpochRotationReason::DeviceRevoked,
            EpochRotationReason::DeviceRevoked
        ));
    }

    #[test]
    fn operation_starts_epoch_maps_security_ops() {
        assert_eq!(
            operation_starts_epoch(&VaultOperation::VaultImported {
                source_content_hash: crate::Sha256Hex::from_trusted("0".repeat(64)),
                secrets: Vec::new(),
                password_entries: Vec::new(),
            }),
            Some(EpochRotationReason::Genesis)
        );
        assert_eq!(
            operation_starts_epoch(&VaultOperation::PasswordRotated {
                entry_id: crate::PasswordEntryId::from_trusted("pwdentry001".to_owned()),
                envelope: crate::PasswordEnvelope {
                    version: 1,
                    kdf: "scrypt".to_owned(),
                    work_factor: 10,
                    ciphertext: "c".to_owned()
                },
            }),
            Some(EpochRotationReason::PasswordRotated)
        );
        assert_eq!(
            operation_starts_epoch(&VaultOperation::SecretCreated {
                secret: crate::vault_event::EncryptedSecretPayload {
                    id: crate::SecretId::from_vault_record("s"),
                    secret_type: crate::SecretType::ApiKey,
                    ciphertext: crate::OpaqueCiphertext::from_trusted("c".to_owned()),
                },
            }),
            None
        );
        assert_eq!(
            operation_starts_epoch(&VaultOperation::NexusParticipantEnrolled {
                device_id: crate::DeviceId::parse("0123456789abcdef").unwrap(),
                encryption_public_key: crate::DevicePublicKey::from_trusted(
                    "age-public-key".to_owned(),
                ),
                signing_public_key: crate::DeviceSigningPublicKey::from_trusted("a".repeat(64)),
                label: crate::MemberLabel::from_trusted("Phone".to_owned()),
            }),
            None
        );
        assert_eq!(
            operation_starts_epoch(&VaultOperation::NexusSharesIssued { shares: Vec::new() }),
            None
        );
    }
}

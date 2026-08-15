//! Cryptographic key epochs for password rotation and device revocation.

use crate::canonical::EventId;
use crate::event::VaultOperation;

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
    AccessGrant,
    ConcurrentVaultMutation,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EpochTransition {
    Unchanged,
    Rotated(EpochRotationReason),
}

impl EpochRotationReason {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Genesis => "genesis",
            Self::PasswordRotated => "password-rotated",
            Self::PasswordRemoved => "password-removed",
            Self::DeviceRevoked => "device-revoked",
            Self::AccessGrant => "access-grant",
            Self::ConcurrentVaultMutation => "concurrent-vault-mutation",
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
pub fn operation_starts_epoch(operation: &VaultOperation) -> EpochTransition {
    match operation {
        VaultOperation::VaultImported { .. } => {
            EpochTransition::Rotated(EpochRotationReason::Genesis)
        }
        VaultOperation::PasswordRotated { .. } => {
            EpochTransition::Rotated(EpochRotationReason::PasswordRotated)
        }
        VaultOperation::PasswordRemoved { .. } => {
            EpochTransition::Rotated(EpochRotationReason::PasswordRemoved)
        }
        VaultOperation::DeviceRevoked { .. } => {
            EpochTransition::Rotated(EpochRotationReason::DeviceRevoked)
        }
        VaultOperation::EpochCheckpoint { .. }
        | VaultOperation::SecretCreated { .. }
        | VaultOperation::SecretDeleted { .. }
        | VaultOperation::SecretReplaced { .. }
        | VaultOperation::SecretConflictResolved { .. }
        | VaultOperation::JoinRequested { .. }
        | VaultOperation::JoinApproved { .. }
        | VaultOperation::SentinelParticipantEnrolled { .. }
        | VaultOperation::SentinelSharesIssued { .. }
        | VaultOperation::JoinDenied { .. }
        | VaultOperation::MemberRenamed { .. }
        | VaultOperation::PasswordAdded { .. }
        | VaultOperation::VaultCleared => EpochTransition::Unchanged,
    }
}

/// Whether two epoch-starting events are a security conflict when concurrent.
#[must_use]
pub fn concurrent_epoch_rotations_conflict(
    left: EpochRotationReason,
    right: EpochRotationReason,
) -> bool {
    let left_rotates_access = matches!(
        left,
        EpochRotationReason::PasswordRotated
            | EpochRotationReason::PasswordRemoved
            | EpochRotationReason::DeviceRevoked
    );
    let right_rotates_access = matches!(
        right,
        EpochRotationReason::PasswordRotated
            | EpochRotationReason::PasswordRemoved
            | EpochRotationReason::DeviceRevoked
    );
    let left_mutates_access = matches!(
        left,
        EpochRotationReason::AccessGrant | EpochRotationReason::ConcurrentVaultMutation
    );
    let right_mutates_access = matches!(
        right,
        EpochRotationReason::AccessGrant | EpochRotationReason::ConcurrentVaultMutation
    );

    (left_rotates_access && (right_rotates_access || right_mutates_access))
        || (right_rotates_access && left_mutates_access)
}

#[cfg(test)]
#[allow(clippy::unnecessary_wraps)]
mod tests {
    use super::*;

    #[test]
    fn password_and_revoke_rotations_conflict_when_concurrent() -> anyhow::Result<()> {
        assert!(concurrent_epoch_rotations_conflict(
            EpochRotationReason::PasswordRotated,
            EpochRotationReason::DeviceRevoked
        ));
        assert!(!concurrent_epoch_rotations_conflict(
            EpochRotationReason::Genesis,
            EpochRotationReason::PasswordRotated
        ));
        Ok(())
    }

    #[test]
    fn password_removed_and_rotated_conflict_when_concurrent() -> anyhow::Result<()> {
        assert!(concurrent_epoch_rotations_conflict(
            EpochRotationReason::PasswordRemoved,
            EpochRotationReason::PasswordRotated
        ));
        Ok(())
    }

    #[test]
    fn concurrent_revokes_conflict() -> anyhow::Result<()> {
        assert!(concurrent_epoch_rotations_conflict(
            EpochRotationReason::DeviceRevoked,
            EpochRotationReason::DeviceRevoked
        ));
        Ok(())
    }

    #[test]
    fn concurrent_access_grant_and_rotation_conflict() {
        assert!(concurrent_epoch_rotations_conflict(
            EpochRotationReason::AccessGrant,
            EpochRotationReason::DeviceRevoked
        ));
        assert!(!concurrent_epoch_rotations_conflict(
            EpochRotationReason::AccessGrant,
            EpochRotationReason::AccessGrant
        ));
        assert!(concurrent_epoch_rotations_conflict(
            EpochRotationReason::ConcurrentVaultMutation,
            EpochRotationReason::PasswordRemoved
        ));
    }

    #[test]
    fn operation_starts_epoch_maps_security_ops() -> anyhow::Result<()> {
        assert_eq!(
            operation_starts_epoch(&VaultOperation::VaultImported {
                source_content_hash: crate::Sha256Hex::from_trusted("0".repeat(64)),
                secrets: Vec::new(),
                password_entries: Vec::new(),
            }),
            EpochTransition::Rotated(EpochRotationReason::Genesis)
        );
        assert_eq!(
            operation_starts_epoch(&VaultOperation::PasswordRotated {
                entry_id: crate::PasswordEntryId::from_trusted("pwdentry001".to_owned()),
                envelope: crate::PasswordEnvelope {
                    version: 1,
                    kdf: "scrypt".to_owned(),
                    work_factor: 10,
                    recipient: String::new(),
                    wrapped_keys: String::new(),
                    ciphertext: "c".to_owned()
                },
            }),
            EpochTransition::Rotated(EpochRotationReason::PasswordRotated)
        );
        assert_eq!(
            operation_starts_epoch(&VaultOperation::SecretCreated {
                secret: crate::event::EncryptedSecretPayload {
                    id: crate::SecretId::from_vault_record("s"),
                    secret_type: crate::SecretType::ApiKey,
                    ciphertext: crate::OpaqueCiphertext::from_trusted("c".to_owned()),
                    identity_fingerprint: crate::SecretFingerprint::from_trusted(
                        "test-identity".to_owned(),
                    ),
                    fingerprint: crate::SecretFingerprint::from_trusted("test-version".to_owned(),),
                },
            }),
            EpochTransition::Unchanged
        );
        assert_eq!(
            operation_starts_epoch(&VaultOperation::SentinelParticipantEnrolled {
                device_id: crate::DeviceId::parse("0123456789abcdef")?,
                encryption_public_key: crate::DevicePublicKey::from_trusted(
                    "age-public-key".to_owned(),
                ),
                signing_public_key: crate::DeviceSigningPublicKey::from_trusted("a".repeat(64)),
                label: crate::MemberLabel::from_trusted("Phone".to_owned()),
            }),
            EpochTransition::Unchanged
        );
        assert_eq!(
            operation_starts_epoch(&VaultOperation::SentinelSharesIssued { shares: Vec::new() }),
            EpochTransition::Unchanged
        );
        Ok(())
    }
}

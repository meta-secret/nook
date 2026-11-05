//! Cryptographic key epochs for device revocation and access changes.

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
    DeviceRevoked,
    AccessGrant,
    ConcurrentVaultMutation,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EpochTransition {
    Unchanged,
    Rotated(EpochRotationReason),
}

/// Named values required by `EpochRotationReason::concurrent_epoch_rotations_conflict`.
#[derive(Clone, Copy)]
pub struct ConcurrentEpochRotations {
    pub left: EpochRotationReason,
    pub right: EpochRotationReason,
}

impl EpochRotationReason {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Genesis => "genesis",
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
impl VaultOperation {
    #[must_use]
    pub fn operation_starts_epoch(operation: &VaultOperation) -> EpochTransition {
        match operation {
            VaultOperation::VaultImported { .. } => {
                EpochTransition::Rotated(EpochRotationReason::Genesis)
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
            | VaultOperation::VaultCleared
            | VaultOperation::VaultNamed { .. } => EpochTransition::Unchanged,
        }
    }
}

/// Whether two epoch-starting events are a security conflict when concurrent.
impl EpochRotationReason {
    #[must_use]
    pub fn concurrent_epoch_rotations_conflict(request: ConcurrentEpochRotations) -> bool {
        let ConcurrentEpochRotations { left, right } = request;
        let left_rotates_access = matches!(left, EpochRotationReason::DeviceRevoked);
        let right_rotates_access = matches!(right, EpochRotationReason::DeviceRevoked);
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
}

#[cfg(test)]
#[allow(clippy::unnecessary_wraps)]
mod tests {
    use super::*;
    use crate::event;

    #[test]
    fn genesis_and_revoke_rotations_do_not_conflict() {
        assert!(!EpochRotationReason::concurrent_epoch_rotations_conflict(
            ConcurrentEpochRotations {
                left: EpochRotationReason::Genesis,
                right: EpochRotationReason::DeviceRevoked
            }
        ));
    }

    #[test]
    fn concurrent_revokes_conflict() -> anyhow::Result<()> {
        assert!(EpochRotationReason::concurrent_epoch_rotations_conflict(
            ConcurrentEpochRotations {
                left: EpochRotationReason::DeviceRevoked,
                right: EpochRotationReason::DeviceRevoked
            }
        ));
        Ok(())
    }

    #[test]
    fn concurrent_access_grant_and_rotation_conflict() {
        assert!(EpochRotationReason::concurrent_epoch_rotations_conflict(
            ConcurrentEpochRotations {
                left: EpochRotationReason::AccessGrant,
                right: EpochRotationReason::DeviceRevoked
            }
        ));
        assert!(!EpochRotationReason::concurrent_epoch_rotations_conflict(
            ConcurrentEpochRotations {
                left: EpochRotationReason::AccessGrant,
                right: EpochRotationReason::AccessGrant
            }
        ));
        assert!(EpochRotationReason::concurrent_epoch_rotations_conflict(
            ConcurrentEpochRotations {
                left: EpochRotationReason::ConcurrentVaultMutation,
                right: EpochRotationReason::DeviceRevoked
            }
        ));
    }

    #[test]
    fn operation_starts_epoch_maps_security_ops() -> anyhow::Result<()> {
        assert_eq!(
            VaultOperation::operation_starts_epoch(&VaultOperation::VaultImported {
                source_content_hash: nook_auth2::Sha256Hex::from_trusted("0".repeat(64)),
                secrets: Vec::new(),
            }),
            EpochTransition::Rotated(EpochRotationReason::Genesis)
        );
        assert_eq!(
            VaultOperation::operation_starts_epoch(&VaultOperation::DeviceRevoked {
                device_id: crate::DeviceId::parse("0123456789abcdef")?,
            }),
            EpochTransition::Rotated(EpochRotationReason::DeviceRevoked)
        );
        assert_eq!(
            VaultOperation::operation_starts_epoch(&VaultOperation::SecretCreated {
                secret: event::EncryptedSecretPayload {
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
            VaultOperation::operation_starts_epoch(&VaultOperation::SentinelParticipantEnrolled {
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
            VaultOperation::operation_starts_epoch(&VaultOperation::SentinelSharesIssued {
                shares: Vec::new()
            }),
            EpochTransition::Unchanged
        );
        Ok(())
    }
}

//! Owned actions for replaying and projecting vault metadata.

use crate::{EpochMetadataState, EventGraph, MemberLabel, SymmetricKey, VaultOperation};
use nook_auth2::{
    AuthEnvelopes, AuthKeyId, DeviceId, DevicePublicKey, DeviceSigningPublicKey, IsoTimestamp,
    JoinRequest, MultiDeviceError, MultiDeviceResult, SentinelParticipantEntry,
    SentinelShareEnvelope, VaultMember, VaultMetaState, build_members_records,
};

use std::collections::BTreeMap;

/// Inputs for applying one event-log operation to a metadata projection.
pub struct VaultMetaOperationRequest<'a> {
    pub operation: &'a VaultOperation,
    pub requested_at: &'a IsoTimestamp,
}

/// Owns the mutable metadata projection while event-log operations are replayed.
pub struct VaultMetaOperationApplier<'a> {
    state: &'a mut VaultMetaState,
}

impl<'a> VaultMetaOperationApplier<'a> {
    pub fn new(state: &'a mut VaultMetaState) -> Self {
        Self { state }
    }

    /// Apply one core event-log metadata operation.
    pub fn apply(&mut self, request: &VaultMetaOperationRequest<'_>) -> MultiDeviceResult<()> {
        let operation = request.operation;
        let requested_at = request.requested_at;
        match operation {
            VaultOperation::JoinRequested {
                device_id,
                encryption_public_key,
                signing_public_key,
                ..
            } => self.record_pending_join(&PendingJoinRequest {
                device_id,
                encryption_public_key,
                signing_public_key,
                requested_at: requested_at.as_str(),
            }),
            VaultOperation::JoinApproved {
                device_id,
                encryption_public_key,
                signing_public_key,
                secrets_key_ciphertext,
                members_key_ciphertext,
                ..
            } => self.apply_join_approved(&JoinApprovedReplay {
                device_id,
                encryption_public_key,
                signing_public_key,
                secrets_key_ciphertext,
                members_key_ciphertext,
                requested_at: requested_at.as_str(),
            })?,
            VaultOperation::SentinelParticipantEnrolled {
                device_id,
                encryption_public_key,
                signing_public_key,
                label,
            } => self.record_sentinel_participant(&SentinelParticipantRequest {
                device_id,
                encryption_public_key,
                signing_public_key,
                label,
                requested_at: requested_at.as_str(),
            }),
            VaultOperation::JoinDenied { device_id } => {
                self.state.joins.remove(device_id);
            }
            VaultOperation::SentinelSharesIssued { shares } => {
                self.apply_sentinel_shares(shares);
            }
            VaultOperation::MemberRenamed { device_id, label } => {
                if let Some(participant) = self.state.sentinel_participants.get_mut(device_id) {
                    label.as_str().clone_into(&mut participant.label);
                }
            }
            VaultOperation::DeviceRevoked { device_id } => {
                self.state.sentinel_participants.remove(device_id);
                self.state.sentinel_shares.remove(device_id);
                self.state.enrolled_devices.remove(device_id);
            }
            VaultOperation::EpochCheckpoint {
                rotated_meta_records: EpochMetadataState::Replace(rotated_meta_records),
                ..
            } => {
                let mut replacement = self.state.clone();
                replacement.auth.clear();
                replacement.members.clear();
                replacement.enrolled_devices.clear();
                for record in rotated_meta_records {
                    replacement.apply_record(record)?;
                }
                *self.state = replacement;
            }
            VaultOperation::VaultImported { .. }
            | VaultOperation::SecretCreated { .. }
            | VaultOperation::SecretDeleted { .. }
            | VaultOperation::SecretReplaced { .. }
            | VaultOperation::SecretConflictResolved { .. }
            | VaultOperation::PasswordAdded { .. }
            | VaultOperation::PasswordRotated { .. }
            | VaultOperation::PasswordEnvelopeUpgraded { .. }
            | VaultOperation::PasswordRemoved { .. }
            | VaultOperation::VaultCleared
            | VaultOperation::EpochCheckpoint {
                rotated_meta_records: EpochMetadataState::LegacyRetain,
                ..
            } => {}
        }
        Ok(())
    }

    fn record_pending_join(&mut self, request: &PendingJoinRequest<'_>) {
        self.state.joins.insert(
            request.device_id.clone(),
            JoinRequest {
                device_id: request.device_id.clone(),
                public_key: request.encryption_public_key.clone(),
                signing_public_key: request.signing_public_key.clone(),
                requested_at: request.requested_at.to_owned(),
            },
        );
    }

    fn record_sentinel_participant(&mut self, request: &SentinelParticipantRequest<'_>) {
        self.state.joins.remove(request.device_id);
        self.state.sentinel_participants.insert(
            request.device_id.clone(),
            SentinelParticipantEntry {
                device_id: request.device_id.clone(),
                encryption_public_key: request.encryption_public_key.clone(),
                signing_public_key: request.signing_public_key.clone(),
                label: request.label.as_str().to_owned(),
                enrolled_at: request.requested_at.to_owned(),
            },
        );
    }

    fn apply_join_approved(&mut self, approved: &JoinApprovedReplay<'_>) -> MultiDeviceResult<()> {
        self.state.joins.remove(approved.device_id);
        self.state.enrolled_devices.insert(
            approved.device_id.clone(),
            JoinRequest {
                device_id: approved.device_id.clone(),
                public_key: approved.encryption_public_key.clone(),
                signing_public_key: approved.signing_public_key.clone(),
                requested_at: approved.requested_at.to_owned(),
            },
        );
        let auth_id = approved.encryption_public_key.auth_id()?;
        self.state.auth.insert(
            auth_id,
            AuthEnvelopes {
                secrets_key: approved.secrets_key_ciphertext.clone(),
                members_key: approved.members_key_ciphertext.clone(),
            },
        );
        Ok(())
    }

    fn apply_sentinel_shares(&mut self, shares: &[crate::SentinelShareIssuedPayload]) {
        for share in shares {
            self.state.sentinel_shares.insert(
                share.device_id.clone(),
                SentinelShareEnvelope {
                    version: share.version,
                    threshold: share.threshold,
                    required_participants: share.required_participants,
                    share_index: share.share_index,
                    ciphertext: share.ciphertext.clone(),
                },
            );
        }
    }
}

struct JoinApprovedReplay<'a> {
    device_id: &'a DeviceId,
    encryption_public_key: &'a DevicePublicKey,
    signing_public_key: &'a DeviceSigningPublicKey,
    secrets_key_ciphertext: &'a crate::AgeArmoredCiphertext,
    members_key_ciphertext: &'a crate::AgeArmoredCiphertext,
    requested_at: &'a str,
}

struct PendingJoinRequest<'a> {
    device_id: &'a DeviceId,
    encryption_public_key: &'a DevicePublicKey,
    signing_public_key: &'a DeviceSigningPublicKey,
    requested_at: &'a str,
}

struct SentinelParticipantRequest<'a> {
    device_id: &'a DeviceId,
    encryption_public_key: &'a DevicePublicKey,
    signing_public_key: &'a DeviceSigningPublicKey,
    label: &'a MemberLabel,
    requested_at: &'a str,
}

/// Owns event-graph replay into a disposable vault metadata projection.
pub struct VaultMetaGraphProjection<'a> {
    graph: &'a EventGraph,
}

impl<'a> VaultMetaGraphProjection<'a> {
    #[must_use]
    pub fn new(graph: &'a EventGraph) -> Self {
        Self { graph }
    }

    /// Rebuild graph-owned metadata while retaining the existing secret projection.
    pub fn materialize(&self, state: &mut VaultMetaState) -> MultiDeviceResult<()> {
        let mut rebuilt = VaultMetaState {
            secrets: state.secrets.clone(),
            ..VaultMetaState::default()
        };
        let order = self
            .graph
            .topological_order()
            .map_err(|error| MultiDeviceError::InvalidDeviceIdentity(error.to_string()))?;
        let mut applier = VaultMetaOperationApplier::new(&mut rebuilt);
        for event_id in order {
            let event = self.graph.get(&event_id).ok_or_else(|| {
                MultiDeviceError::InvalidDeviceIdentity(format!(
                    "Missing event {event_id} in graph."
                ))
            })?;
            for operation in &event.body.operations {
                applier.apply(&VaultMetaOperationRequest {
                    operation,
                    requested_at: &event.body.created_at,
                })?;
            }
        }
        *state = rebuilt;
        Ok(())
    }
}

/// Identifies the exact device key tuple whose active graph grant is queried.
pub struct EventGraphDeviceAccessRequest<'a> {
    pub expected_device_id: &'a DeviceId,
    pub expected_public_key: &'a DevicePublicKey,
    pub expected_signing_public_key: &'a DeviceSigningPublicKey,
}

/// Owns graph-based authorization queries for one event log.
pub struct EventGraphDeviceAccess<'a> {
    graph: &'a EventGraph,
}

impl<'a> EventGraphDeviceAccess<'a> {
    #[must_use]
    pub fn new(graph: &'a EventGraph) -> Self {
        Self { graph }
    }

    pub fn has_access(
        &self,
        request: &EventGraphDeviceAccessRequest<'_>,
    ) -> MultiDeviceResult<bool> {
        Ok(self.active_envelopes(request)?.is_some())
    }

    /// Return DEK envelopes only for the exact active device key tuple.
    pub fn active_envelopes(
        &self,
        request: &EventGraphDeviceAccessRequest<'_>,
    ) -> MultiDeviceResult<Option<AuthEnvelopes>> {
        let derived_device_id = request.expected_public_key.try_app_id()?;
        if &derived_device_id != request.expected_device_id {
            return Err(MultiDeviceError::InvalidDeviceIdentity(
                "Extension device_id does not match its encryption public key.".to_owned(),
            ));
        }
        let expected_auth_id = request.expected_public_key.auth_id()?;

        let mut active = None;
        let order = self
            .graph
            .topological_order()
            .map_err(|error| MultiDeviceError::InvalidDeviceIdentity(error.to_string()))?;
        for event_id in order {
            let event = self.graph.get(&event_id).ok_or_else(|| {
                MultiDeviceError::InvalidDeviceIdentity(format!(
                    "Missing event {event_id} in graph."
                ))
            })?;
            for operation in &event.body.operations {
                match operation {
                    VaultOperation::JoinApproved {
                        device_id,
                        encryption_public_key,
                        signing_public_key,
                        secrets_key_ciphertext,
                        members_key_ciphertext,
                        ..
                    } if device_id == request.expected_device_id => {
                        active = (encryption_public_key == request.expected_public_key
                            && signing_public_key == request.expected_signing_public_key)
                            .then(|| AuthEnvelopes {
                                secrets_key: secrets_key_ciphertext.clone(),
                                members_key: members_key_ciphertext.clone(),
                            });
                    }
                    VaultOperation::DeviceRevoked { device_id }
                        if device_id == request.expected_device_id =>
                    {
                        active = None;
                    }
                    VaultOperation::EpochCheckpoint {
                        rotated_meta_records: EpochMetadataState::Replace(records),
                        ..
                    } if active.is_some() => {
                        let checkpoint_meta = VaultMetaState::from_stored_records(records)?;
                        active = checkpoint_meta.auth.get(&expected_auth_id).cloned();
                    }
                    _ => {}
                }
            }
        }
        Ok(active)
    }
}

/// Owns the active authorization-recipient projection for an event graph.
pub struct EventGraphAuthorizationProjection<'a> {
    graph: &'a EventGraph,
}

impl<'a> EventGraphAuthorizationProjection<'a> {
    #[must_use]
    pub fn new(graph: &'a EventGraph) -> Self {
        Self { graph }
    }

    pub fn active_auth_ids(&self) -> MultiDeviceResult<Vec<AuthKeyId>> {
        let mut active = BTreeMap::<DeviceId, AuthKeyId>::new();
        let order = self
            .graph
            .topological_order()
            .map_err(|error| MultiDeviceError::InvalidDeviceIdentity(error.to_string()))?;
        for event_id in order {
            let event = self.graph.get(&event_id).ok_or_else(|| {
                MultiDeviceError::InvalidDeviceIdentity(format!(
                    "Missing event {event_id} in graph."
                ))
            })?;
            for operation in &event.body.operations {
                match operation {
                    VaultOperation::JoinApproved {
                        device_id,
                        encryption_public_key,
                        ..
                    } => {
                        let derived_device_id = encryption_public_key.try_app_id()?;
                        if &derived_device_id != device_id {
                            return Err(MultiDeviceError::InvalidDeviceIdentity(
                                "Approved device id does not match its encryption public key."
                                    .to_owned(),
                            ));
                        }
                        active.insert(device_id.clone(), encryption_public_key.auth_id()?);
                    }
                    VaultOperation::DeviceRevoked { device_id } => {
                        active.remove(device_id);
                    }
                    _ => {}
                }
            }
        }
        let mut auth_ids = active.into_values().collect::<Vec<_>>();
        auth_ids.sort();
        auth_ids.dedup();
        Ok(auth_ids)
    }
}

/// Inputs for reconstructing encrypted member records from a public roster.
pub struct SentinelMemberRecordProjectionRequest<'a> {
    pub state: &'a VaultMetaState,
    pub members_key: &'a SymmetricKey,
}

/// Owns the Sentinel member-record projection after quorum unlock.
pub struct SentinelMemberRecordProjection<'a> {
    state: &'a VaultMetaState,
    members_key: &'a SymmetricKey,
}

impl<'a> SentinelMemberRecordProjection<'a> {
    #[must_use]
    pub fn new(request: &SentinelMemberRecordProjectionRequest<'a>) -> Self {
        Self {
            state: request.state,
            members_key: request.members_key,
        }
    }

    /// Rebuild encrypted `members:` rows while preserving deterministic roster order.
    pub fn build(&self) -> MultiDeviceResult<Vec<crate::StoredSecretRecord>> {
        let mut roster = self
            .state
            .sentinel_participants
            .values()
            .map(|participant| {
                Ok(VaultMember {
                    auth_id: participant.encryption_public_key.auth_id()?,
                    device_id: participant.device_id.clone(),
                    public_key: participant.encryption_public_key.clone(),
                    enrolled_at: participant.enrolled_at.clone(),
                    label: (!participant.label.is_empty()).then(|| participant.label.clone()),
                })
            })
            .collect::<MultiDeviceResult<Vec<_>>>()?;
        roster.sort_by(|left, right| left.auth_id.cmp(&right.auth_id));
        build_members_records(&roster, self.members_key)
    }
}

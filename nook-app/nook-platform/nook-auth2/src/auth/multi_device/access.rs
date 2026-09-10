use super::{DeviceIdentity, JoinRequest, VaultMetaState, VaultRecordView};
use crate::errors::MultiDeviceResult;
use crate::{
    BuildMembersRecordsRequest, GenesisMembersRecordsRequest, MemberFromIdentityRequest,
    ReplaceMemberRecordsRequest, ResolveMemberRosterRequest, RosterAddMemberRequest, VaultMember,
};
use crate::{DeviceId, StoredSecretRecord, SymmetricKey};

/// If this device holds `members_key` but has no roster row, add itself (fallback when approver missed it).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SelfRosterSync {
    Current,
    Updated(Vec<StoredSecretRecord>),
}

/// Named values required by VaultMetaState::ensure_self_in_roster.
pub struct EnsureSelfInRosterRequest<'a> {
    pub records: &'a [StoredSecretRecord],
    pub identity: &'a DeviceIdentity,
    pub members_key: &'a SymmetricKey,
}

/// Named values required by VaultMetaState::assess_connect_access.
pub struct AssessConnectAccessRequest<'a> {
    pub records: &'a [StoredSecretRecord],
    pub identity: &'a DeviceIdentity,
}

/// Named values required by VaultMetaState::device_is_enrolled.
pub struct DeviceIsEnrolledRequest<'a> {
    pub records: &'a [StoredSecretRecord],
    pub identity: &'a DeviceIdentity,
}

/// A device has either requested enrollment or has no pending request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DeviceJoinStatus {
    Pending(JoinRequest),
    NotRequested,
}

/// Named values required by VaultMetaState::pending_join_for_device.
pub struct PendingJoinForDeviceRequest<'a> {
    pub records: &'a [StoredSecretRecord],
    pub device_id: &'a DeviceId,
}

impl VaultMetaState {
    pub fn ensure_self_in_roster(
        request: EnsureSelfInRosterRequest<'_>,
    ) -> MultiDeviceResult<SelfRosterSync> {
        let EnsureSelfInRosterRequest {
            records,
            identity,
            members_key,
        } = request;
        let roster = VaultMember::resolve_member_roster(ResolveMemberRosterRequest {
            records: records,
            members_key: members_key,
        })?;
        if roster.iter().any(|m| m.auth_id == identity.auth_id()) {
            return Ok(SelfRosterSync::Current);
        }
        let updated = VaultMember::roster_add_member(RosterAddMemberRequest {
            roster: roster,
            member: VaultMember::member_from_identity(MemberFromIdentityRequest {
                identity: identity,
                enrolled_at: "self-sync",
            }),
        });
        Ok(SelfRosterSync::Updated(VaultMember::build_members_records(
            BuildMembersRecordsRequest {
                roster: &updated,
                members_key: members_key,
            },
        )?))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectAccessStatus {
    Ready,
    NeedsEnrollment,
    JoinPending,
}

impl VaultMetaState {
    pub fn assess_connect_access(
        request: AssessConnectAccessRequest<'_>,
    ) -> MultiDeviceResult<ConnectAccessStatus> {
        let AssessConnectAccessRequest { records, identity } = request;
        let state = VaultMetaState::from_stored_records(records)?;
        if state.auth.contains_key(&identity.auth_id())
            || state.members.contains_key(&identity.auth_id())
            || state.sentinel_shares.contains_key(identity.device_id())
        {
            Ok(ConnectAccessStatus::Ready)
        } else if state.joins.contains_key(identity.device_id()) {
            Ok(ConnectAccessStatus::JoinPending)
        } else {
            Ok(ConnectAccessStatus::NeedsEnrollment)
        }
    }
}

impl VaultMetaState {
    pub fn device_is_enrolled(request: DeviceIsEnrolledRequest<'_>) -> MultiDeviceResult<bool> {
        let DeviceIsEnrolledRequest { records, identity } = request;
        Ok(
            VaultMetaState::assess_connect_access(AssessConnectAccessRequest {
                records: records,
                identity: identity,
            })? == ConnectAccessStatus::Ready,
        )
    }
}

impl VaultMetaState {
    pub fn pending_join_for_device(
        request: PendingJoinForDeviceRequest<'_>,
    ) -> MultiDeviceResult<DeviceJoinStatus> {
        let PendingJoinForDeviceRequest { records, device_id } = request;
        VaultRecordView::new(records)
            .list_join_requests()
            .map(
                |joins| match joins.into_iter().find(|join| join.device_id == *device_id) {
                    Some(join) => DeviceJoinStatus::Pending(join),
                    None => DeviceJoinStatus::NotRequested,
                },
            )
    }
}

#[cfg(test)]
mod tests {
    use std::io;

    use super::super::{
        JoinRequestApproval, JoinRequestIssuance, VaultKeys, VaultRecordView,
        genesis_members_records, replace_member_records,
    };
    use super::*;

    const ENROLLED_AT: &str = "2026-06-21T00:00:00Z";

    fn genesis_vault(
        keys: &VaultKeys,
    ) -> anyhow::Result<(DeviceIdentity, Vec<StoredSecretRecord>)> {
        let genesis = DeviceIdentity::generate()?;
        let mut records = vec![genesis.auth_record(&keys.secrets_key, &keys.members_key)?];
        records.extend(VaultMember::genesis_members_records(
            GenesisMembersRecordsRequest {
                identity: &genesis,
                members_key: &keys.members_key,
                enrolled_at: ENROLLED_AT,
            },
        )?);
        Ok((genesis, records))
    }

    fn approve_pending_join(
        keys: &VaultKeys,
        approver: &DeviceIdentity,
        records: &mut Vec<StoredSecretRecord>,
        joiner: &DeviceIdentity,
    ) -> anyhow::Result<()> {
        let join = match VaultMetaState::pending_join_for_device(PendingJoinForDeviceRequest {
            records: records,
            device_id: joiner.device_id(),
        })? {
            DeviceJoinStatus::Pending(join) => join,
            DeviceJoinStatus::NotRequested => {
                return Err(io::Error::other("pending join fixture must exist").into());
            }
        };
        let (auth_record, join_key, member_records) = JoinRequestApproval::new(
            &keys.secrets_key,
            &keys.members_key,
            &join,
            approver,
            records,
        )
        .approve()?;
        records.retain(|record| record.key.as_str() != join_key);
        records.push(auth_record);
        VaultMember::replace_member_records(ReplaceMemberRecordsRequest {
            records: records,
            member_records: member_records,
        })?;
        Ok(())
    }

    #[test]
    fn sentinel_member_row_without_auth_counts_as_enrolled() -> anyhow::Result<()> {
        let keys = VaultKeys::generate()?;
        let participant = DeviceIdentity::generate()?;
        let members = VaultMember::genesis_members_records(GenesisMembersRecordsRequest {
            identity: &participant,
            members_key: &keys.members_key,
            enrolled_at: ENROLLED_AT,
        })?;
        assert!(VaultMetaState::device_is_enrolled(
            DeviceIsEnrolledRequest {
                records: &members,
                identity: &participant
            }
        )?);
        assert_eq!(
            VaultMetaState::assess_connect_access(AssessConnectAccessRequest {
                records: &members,
                identity: &participant
            })?,
            ConnectAccessStatus::Ready
        );
        assert!(
            VaultRecordView::new(&members)
                .secrets_key(&participant)
                .is_err()
        );
        Ok(())
    }

    #[test]
    fn connect_access_status_distinguishes_ready_pending_and_unenrolled_devices()
    -> anyhow::Result<()> {
        let keys = VaultKeys::generate()?;
        let (genesis, mut records) = genesis_vault(&keys)?;
        let pending = DeviceIdentity::generate()?;
        let stranger = DeviceIdentity::generate()?;

        records.push(JoinRequestIssuance::new(&pending, ENROLLED_AT).issue()?);

        assert_eq!(
            VaultMetaState::assess_connect_access(AssessConnectAccessRequest {
                records: &records,
                identity: &genesis
            })?,
            ConnectAccessStatus::Ready
        );
        assert_eq!(
            VaultMetaState::assess_connect_access(AssessConnectAccessRequest {
                records: &records,
                identity: &pending
            })?,
            ConnectAccessStatus::JoinPending
        );
        assert_eq!(
            VaultMetaState::assess_connect_access(AssessConnectAccessRequest {
                records: &records,
                identity: &stranger
            })?,
            ConnectAccessStatus::NeedsEnrollment
        );
        Ok(())
    }

    #[test]
    fn ensure_self_in_roster_adds_missing_current_identity_once() -> anyhow::Result<()> {
        let keys = VaultKeys::generate()?;
        let (genesis, mut records) = genesis_vault(&keys)?;
        let joiner = DeviceIdentity::generate()?;
        records.push(JoinRequestIssuance::new(&joiner, ENROLLED_AT).issue()?);
        approve_pending_join(&keys, &genesis, &mut records, &joiner)?;

        let mut missing_joiner_roster = records
            .iter()
            .filter(|record| record.key.as_str() != joiner.auth_id().member_record_key())
            .cloned()
            .collect::<Vec<_>>();
        let SelfRosterSync::Updated(repaired) =
            VaultMetaState::ensure_self_in_roster(EnsureSelfInRosterRequest {
                records: &missing_joiner_roster,
                identity: &joiner,
                members_key: &keys.members_key,
            })?
        else {
            panic!("missing roster member should produce an update");
        };
        VaultMember::replace_member_records(ReplaceMemberRecordsRequest {
            records: &mut missing_joiner_roster,
            member_records: repaired,
        })?;

        let roster = VaultMember::resolve_member_roster(ResolveMemberRosterRequest {
            records: &missing_joiner_roster,
            members_key: &keys.members_key,
        })?;
        assert_eq!(roster.len(), 2);
        assert!(
            roster
                .iter()
                .any(|member| member.auth_id == joiner.auth_id())
        );
        assert_eq!(
            VaultMetaState::ensure_self_in_roster(EnsureSelfInRosterRequest {
                records: &missing_joiner_roster,
                identity: &joiner,
                members_key: &keys.members_key
            })?,
            SelfRosterSync::Current
        );
        Ok(())
    }
}

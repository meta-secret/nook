use super::{
    DeviceIdentity, JoinRequest, VaultMetaState, VaultRecordView, build_members_records,
    member_from_identity, resolve_member_roster, roster_add_member,
};
use crate::errors::MultiDeviceResult;
use crate::{DeviceId, StoredSecretRecord, SymmetricKey};

/// If this device holds `members_key` but has no roster row, add itself (fallback when approver missed it).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SelfRosterSync {
    Current,
    Updated(Vec<StoredSecretRecord>),
}

pub fn ensure_self_in_roster(
    records: &[StoredSecretRecord],
    identity: &DeviceIdentity,
    members_key: &SymmetricKey,
) -> MultiDeviceResult<SelfRosterSync> {
    let roster = resolve_member_roster(records, members_key)?;
    if roster.iter().any(|m| m.auth_id == identity.auth_id()) {
        return Ok(SelfRosterSync::Current);
    }
    let updated = roster_add_member(roster, member_from_identity(identity, "self-sync"));
    Ok(SelfRosterSync::Updated(build_members_records(
        &updated,
        members_key,
    )?))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectAccessStatus {
    Ready,
    NeedsEnrollment,
    JoinPending,
}

pub fn assess_connect_access(
    records: &[StoredSecretRecord],
    identity: &DeviceIdentity,
) -> MultiDeviceResult<ConnectAccessStatus> {
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

pub fn device_is_enrolled(
    records: &[StoredSecretRecord],
    identity: &DeviceIdentity,
) -> MultiDeviceResult<bool> {
    Ok(assess_connect_access(records, identity)? == ConnectAccessStatus::Ready)
}

pub fn pending_join_for_device(
    records: &[StoredSecretRecord],
    device_id: &DeviceId,
) -> MultiDeviceResult<Option<JoinRequest>> {
    VaultRecordView::new(records)
        .list_join_requests()
        .map(|joins| joins.into_iter().find(|join| join.device_id == *device_id))
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
        records.extend(genesis_members_records(
            &genesis,
            &keys.members_key,
            ENROLLED_AT,
        )?);
        Ok((genesis, records))
    }

    fn approve_pending_join(
        keys: &VaultKeys,
        approver: &DeviceIdentity,
        records: &mut Vec<StoredSecretRecord>,
        joiner: &DeviceIdentity,
    ) -> anyhow::Result<()> {
        let join = pending_join_for_device(records, joiner.device_id())?
            .ok_or_else(|| io::Error::other("pending join fixture must exist"))?;
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
        replace_member_records(records, member_records)?;
        Ok(())
    }

    #[test]
    fn sentinel_member_row_without_auth_counts_as_enrolled() -> anyhow::Result<()> {
        let keys = VaultKeys::generate()?;
        let participant = DeviceIdentity::generate()?;
        let members = genesis_members_records(&participant, &keys.members_key, ENROLLED_AT)?;
        assert!(device_is_enrolled(&members, &participant)?);
        assert_eq!(
            assess_connect_access(&members, &participant)?,
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
            assess_connect_access(&records, &genesis)?,
            ConnectAccessStatus::Ready
        );
        assert_eq!(
            assess_connect_access(&records, &pending)?,
            ConnectAccessStatus::JoinPending
        );
        assert_eq!(
            assess_connect_access(&records, &stranger)?,
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
            ensure_self_in_roster(&missing_joiner_roster, &joiner, &keys.members_key)?
        else {
            panic!("missing roster member should produce an update");
        };
        replace_member_records(&mut missing_joiner_roster, repaired)?;

        let roster = resolve_member_roster(&missing_joiner_roster, &keys.members_key)?;
        assert_eq!(roster.len(), 2);
        assert!(
            roster
                .iter()
                .any(|member| member.auth_id == joiner.auth_id())
        );
        assert_eq!(
            ensure_self_in_roster(&missing_joiner_roster, &joiner, &keys.members_key)?,
            SelfRosterSync::Current
        );
        Ok(())
    }
}

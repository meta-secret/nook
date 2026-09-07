#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use super::{
    AuthRecordIssuance, DeviceIdentity, DeviceSigningPublicKey, JoinRequest, StoredRecordPayload,
    StoredSecretRecord, SymmetricKey, build_members_records, genesis_members_records,
    member_from_identity, member_from_join, resolve_member_roster, roster_add_member,
};
use crate::errors::{MultiDeviceError, MultiDeviceResult};
use crate::{DeviceId, SecretId};

/// Borrowed identity data awaiting one consuming join-request record issuance.
pub struct JoinRequestIssuance<'a> {
    identity: &'a DeviceIdentity,
    requested_at: &'a str,
    signing_public_key: DeviceSigningPublicKey,
}

impl<'a> JoinRequestIssuance<'a> {
    #[must_use]
    pub fn new(identity: &'a DeviceIdentity, requested_at: &'a str) -> Self {
        Self::with_signing_key(
            identity,
            requested_at,
            &DeviceSigningPublicKey::from_trusted(String::new()),
        )
    }

    #[must_use]
    pub fn with_signing_key(
        identity: &'a DeviceIdentity,
        requested_at: &'a str,
        signing_public_key: &DeviceSigningPublicKey,
    ) -> Self {
        Self {
            identity,
            requested_at,
            signing_public_key: signing_public_key.clone(),
        }
    }

    /// Consume the issuance state into one stored join request.
    pub fn issue(self) -> MultiDeviceResult<StoredSecretRecord> {
        let request = JoinRequest {
            device_id: self.identity.device_id().to_owned(),
            public_key: self.identity.public_key(),
            signing_public_key: self.signing_public_key,
            requested_at: self.requested_at.to_owned(),
        };
        Ok(StoredSecretRecord {
            key: SecretId::from_vault_record(self.identity.device_id().as_str()),
            secret_type: None,
            value: StoredRecordPayload::from_trusted(
                serde_json::to_string(&request).map_err(MultiDeviceError::JoinRequestSerialize)?,
            ),
        })
    }
}

/// Borrowed vault state and pending request awaiting consuming approval.
pub struct JoinRequestApproval<'a> {
    secrets_key: &'a SymmetricKey,
    members_key: &'a SymmetricKey,
    join: &'a JoinRequest,
    approver: &'a DeviceIdentity,
    records: &'a [StoredSecretRecord],
}

impl<'a> JoinRequestApproval<'a> {
    #[must_use]
    pub fn new(
        secrets_key: &'a SymmetricKey,
        members_key: &'a SymmetricKey,
        join: &'a JoinRequest,
        approver: &'a DeviceIdentity,
        records: &'a [StoredSecretRecord],
    ) -> Self {
        Self {
            secrets_key,
            members_key,
            join,
            approver,
            records,
        }
    }

    /// Consume the approval state into the auth row, removed join key, and member rows.
    pub fn approve(
        self,
    ) -> MultiDeviceResult<(StoredSecretRecord, String, Vec<StoredSecretRecord>)> {
        let pk_id = self.join.public_key.auth_id()?;
        let auth_record = AuthRecordIssuance::new(
            &pk_id,
            self.secrets_key,
            self.members_key,
            &self.join.public_key,
        )
        .issue()?;
        let new_member = member_from_join(self.join)?;
        let roster = match resolve_member_roster(self.records, self.members_key) {
            Ok(existing) => roster_add_member(existing, new_member),
            Err(_) => vec![
                member_from_identity(self.approver, &self.join.requested_at),
                new_member,
            ],
        };
        let member_records = build_members_records(&roster, self.members_key)?;
        Ok((auth_record, self.join.device_id.to_string(), member_records))
    }
}

/// Borrowed stored records and device identifier awaiting consuming denial.
pub struct JoinRequestDenial<'a> {
    records: &'a [StoredSecretRecord],
    join_device_id: &'a DeviceId,
}

impl<'a> JoinRequestDenial<'a> {
    #[must_use]
    pub fn new(records: &'a [StoredSecretRecord], join_device_id: &'a DeviceId) -> Self {
        Self {
            records,
            join_device_id,
        }
    }

    #[must_use]
    pub fn apply(self) -> Vec<StoredSecretRecord> {
        let join_key = self.join_device_id.to_string();
        self.records
            .iter()
            .filter(|record| record.key.as_str() != join_key)
            .cloned()
            .collect()
    }
}

enum EnrollmentKeys<'a> {
    Separate {
        secrets_key: &'a SymmetricKey,
        members_key: &'a SymmetricKey,
    },
    Shared(SymmetricKey),
}

/// Borrowed identity and key material awaiting consuming enrollment.
pub struct DeviceEnrollment<'a> {
    keys: EnrollmentKeys<'a>,
    identity: &'a DeviceIdentity,
    enrolled_at: &'a str,
}

impl<'a> DeviceEnrollment<'a> {
    #[must_use]
    pub fn with_keys(
        secrets_key: &'a SymmetricKey,
        members_key: &'a SymmetricKey,
        identity: &'a DeviceIdentity,
        enrolled_at: &'a str,
    ) -> Self {
        Self {
            keys: EnrollmentKeys::Separate {
                secrets_key,
                members_key,
            },
            identity,
            enrolled_at,
        }
    }

    pub fn with_shared_secret(
        shared_secret: &str,
        identity: &'a DeviceIdentity,
        enrolled_at: &'a str,
    ) -> MultiDeviceResult<Self> {
        Ok(Self {
            keys: EnrollmentKeys::Shared(
                SymmetricKey::parse(shared_secret).map_err(MultiDeviceError::Validation)?,
            ),
            identity,
            enrolled_at,
        })
    }

    /// Consume the enrollment state into the auth row and member rows.
    pub fn enroll(self) -> MultiDeviceResult<(StoredSecretRecord, Vec<StoredSecretRecord>)> {
        match self.keys {
            EnrollmentKeys::Separate {
                secrets_key,
                members_key,
            } => {
                let auth = self.identity.auth_record(secrets_key, members_key)?;
                let members =
                    genesis_members_records(self.identity, members_key, self.enrolled_at)?;
                Ok((auth, members))
            }
            EnrollmentKeys::Shared(shared) => {
                let auth = self.identity.auth_record(&shared, &shared)?;
                let members = genesis_members_records(self.identity, &shared, self.enrolled_at)?;
                Ok((auth, members))
            }
        }
    }
}

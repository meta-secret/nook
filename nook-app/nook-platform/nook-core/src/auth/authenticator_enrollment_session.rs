use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use tsify::Tsify;

pub const MAX_ENROLLMENT_AUTHORIZATIONS: usize = 128;
pub const MAX_ENROLLMENT_AUTHORIZATION_TTL_MILLIS: u64 = 5 * 60 * 1_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EnrollmentAuthorizationState {
    Authorized,
    Committing,
    Committed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct EnrollmentAuthorization {
    state: EnrollmentAuthorizationState,
    expires_at_millis: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum EnrollmentAuthorizeOutcome {
    Authorized,
    Invalid,
    Exists,
    Capacity,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum EnrollmentClaimOutcome {
    Claimed,
    Missing,
    Committing,
    Committed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum EnrollmentCommitOutcome {
    Committed,
    Missing,
    Authorized,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum EnrollmentFailOutcome {
    Removed,
    Missing,
    Committed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum EnrollmentRevokeOutcome {
    Revoked,
    Missing,
    Committing,
    Committed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum EnrollmentPurgeOutcome {
    Unchanged,
    Purged,
}

#[derive(Debug, Default)]
pub struct AuthenticatorEnrollmentSession {
    authorizations: BTreeMap<String, EnrollmentAuthorization>,
}

impl AuthenticatorEnrollmentSession {
    pub fn authorize(
        &mut self,
        id: &str,
        expires_at_millis: u64,
        now_millis: u64,
    ) -> EnrollmentAuthorizeOutcome {
        self.purge_expired(now_millis);
        if id.trim().is_empty()
            || id.len() > 128
            || expires_at_millis <= now_millis
            || expires_at_millis
                > now_millis.saturating_add(MAX_ENROLLMENT_AUTHORIZATION_TTL_MILLIS)
        {
            return EnrollmentAuthorizeOutcome::Invalid;
        }
        if self.authorizations.contains_key(id) {
            return EnrollmentAuthorizeOutcome::Exists;
        }
        if self.authorizations.len() >= MAX_ENROLLMENT_AUTHORIZATIONS {
            return EnrollmentAuthorizeOutcome::Capacity;
        }
        self.authorizations.insert(
            id.to_owned(),
            EnrollmentAuthorization {
                state: EnrollmentAuthorizationState::Authorized,
                expires_at_millis,
            },
        );
        EnrollmentAuthorizeOutcome::Authorized
    }

    pub fn claim(&mut self, id: &str, now_millis: u64) -> EnrollmentClaimOutcome {
        self.purge_expired(now_millis);
        let Some(authorization) = self.authorizations.get_mut(id) else {
            return EnrollmentClaimOutcome::Missing;
        };
        match authorization.state {
            EnrollmentAuthorizationState::Authorized => {
                authorization.state = EnrollmentAuthorizationState::Committing;
                EnrollmentClaimOutcome::Claimed
            }
            EnrollmentAuthorizationState::Committing => EnrollmentClaimOutcome::Committing,
            EnrollmentAuthorizationState::Committed => EnrollmentClaimOutcome::Committed,
        }
    }

    pub fn commit(&mut self, id: &str, now_millis: u64) -> EnrollmentCommitOutcome {
        self.purge_expired(now_millis);
        let Some(authorization) = self.authorizations.get_mut(id) else {
            return EnrollmentCommitOutcome::Missing;
        };
        match authorization.state {
            EnrollmentAuthorizationState::Committing => {
                authorization.state = EnrollmentAuthorizationState::Committed;
                EnrollmentCommitOutcome::Committed
            }
            EnrollmentAuthorizationState::Committed => EnrollmentCommitOutcome::Committed,
            EnrollmentAuthorizationState::Authorized => EnrollmentCommitOutcome::Authorized,
        }
    }

    pub fn fail(&mut self, id: &str, now_millis: u64) -> EnrollmentFailOutcome {
        self.purge_expired(now_millis);
        match self.authorizations.get(id).map(|entry| entry.state) {
            Some(EnrollmentAuthorizationState::Committed) => EnrollmentFailOutcome::Committed,
            Some(_) => {
                self.authorizations.remove(id);
                EnrollmentFailOutcome::Removed
            }
            None => EnrollmentFailOutcome::Missing,
        }
    }

    pub fn revoke(&mut self, id: &str, now_millis: u64) -> EnrollmentRevokeOutcome {
        self.purge_expired(now_millis);
        match self.authorizations.get(id).map(|entry| entry.state) {
            Some(EnrollmentAuthorizationState::Authorized) => {
                self.authorizations.remove(id);
                EnrollmentRevokeOutcome::Revoked
            }
            Some(EnrollmentAuthorizationState::Committing) => EnrollmentRevokeOutcome::Committing,
            Some(EnrollmentAuthorizationState::Committed) => EnrollmentRevokeOutcome::Committed,
            None => EnrollmentRevokeOutcome::Missing,
        }
    }

    pub fn purge(&mut self, now_millis: u64) -> EnrollmentPurgeOutcome {
        if self.purge_expired(now_millis) == 0 {
            EnrollmentPurgeOutcome::Unchanged
        } else {
            EnrollmentPurgeOutcome::Purged
        }
    }

    fn purge_expired(&mut self, now_millis: u64) -> usize {
        let previous_len = self.authorizations.len();
        self.authorizations.retain(|_, authorization| {
            authorization.state == EnrollmentAuthorizationState::Committing
                || authorization.expires_at_millis > now_millis
        });
        previous_len - self.authorizations.len()
    }

    pub fn clear(&mut self) {
        self.authorizations.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use EnrollmentAuthorizeOutcome as A;
    use EnrollmentRevokeOutcome as R;

    #[test]
    fn enrollment_authorization_lifecycle_is_bounded_and_expiry_bound() {
        let mut session = AuthenticatorEnrollmentSession::default();
        assert_eq!(session.authorize("", 20, 10), A::Invalid);
        assert_eq!(session.authorize(&"a".repeat(129), 20, 10), A::Invalid);
        assert_eq!(session.authorize("late", 10, 10), A::Invalid);
        assert_eq!(
            session.authorize("long", MAX_ENROLLMENT_AUTHORIZATION_TTL_MILLIS + 11, 10),
            A::Invalid
        );
        assert_eq!(session.authorize("stage", 20, 10), A::Authorized);
        assert_eq!(session.authorize("stage", 20, 10), A::Exists);
        assert_eq!(session.claim("stage", 11), EnrollmentClaimOutcome::Claimed);
        assert_eq!(session.revoke("stage", 12), R::Committing);
        assert_eq!(
            session.commit("stage", 13),
            EnrollmentCommitOutcome::Committed
        );
        assert_eq!(session.revoke("stage", 14), R::Committed);
        assert_eq!(session.fail("stage", 15), EnrollmentFailOutcome::Committed);
        assert_eq!(session.revoke("stage", 20), R::Missing);
    }

    #[test]
    fn failure_capacity_purge_and_clear_fail_closed() {
        let mut session = AuthenticatorEnrollmentSession::default();
        for index in 0..MAX_ENROLLMENT_AUTHORIZATIONS {
            assert_eq!(session.authorize(&index.to_string(), 20, 10), A::Authorized);
        }
        assert_eq!(session.authorize("overflow", 20, 10), A::Capacity);
        assert_eq!(session.fail("0", 11), EnrollmentFailOutcome::Removed);
        assert_eq!(session.purge(20), EnrollmentPurgeOutcome::Purged);
        assert_eq!(session.authorize("next", 30, 20), A::Authorized);
        session.clear();
        assert_eq!(session.claim("next", 21), EnrollmentClaimOutcome::Missing);
    }
}

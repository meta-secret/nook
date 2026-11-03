//! Where connect opens a vault while this browser joins an identity: through
//! the first sync row of the join, or through the draft being set up.

use serde::de::{self, Deserializer};
use serde::ser::Serializer;
use serde::{Deserialize, Serialize};
use tsify::Tsify;

use super::{JoinEnrollmentState, VaultAuthenticationState};
use crate::{StorageConnection, StorageProvider};

/// The session facts and sync rows that decide where connect reads from.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JoinConnectRequest {
    pub authentication: VaultAuthenticationState,
    #[tsify(type = "JoinEnrollmentState")]
    pub join_state: JoinConnectEnrollment,
    pub sync_providers: Vec<StorageProvider>,
}

/// The join state, carried on the wire as the existing numeric
/// `JoinEnrollmentState` the page already holds.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct JoinConnectEnrollment(pub JoinEnrollmentState);

/// Where connect reads the vault from.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Tsify)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum JoinConnectSource {
    /// The draft the person is setting up.
    Draft,
    /// A join in progress connects through the first sync row.
    JoinProvider { connection: StorageConnection },
}

impl JoinConnectRequest {
    /// A session that is not signed in, joins an identity, and has a sync
    /// row connects through the first one; anything else reads the draft.
    #[must_use]
    pub fn source(&self) -> JoinConnectSource {
        match (
            self.authentication,
            self.join_state.0,
            self.sync_providers.first(),
        ) {
            (
                VaultAuthenticationState::Unauthenticated,
                JoinEnrollmentState::NeedsRequest | JoinEnrollmentState::Pending,
                Some(first),
            ) => JoinConnectSource::JoinProvider {
                connection: first.storage_connection(),
            },
            (VaultAuthenticationState::Authenticated, _, _)
            | (_, JoinEnrollmentState::None, _)
            | (_, _, None) => JoinConnectSource::Draft,
        }
    }
}

impl Serialize for JoinConnectEnrollment {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_u32(match self.0 {
            JoinEnrollmentState::None => 0,
            JoinEnrollmentState::NeedsRequest => 1,
            JoinEnrollmentState::Pending => 2,
        })
    }
}

impl<'de> Deserialize<'de> for JoinConnectEnrollment {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        match u32::deserialize(deserializer)? {
            0 => Ok(Self(JoinEnrollmentState::None)),
            1 => Ok(Self(JoinEnrollmentState::NeedsRequest)),
            2 => Ok(Self(JoinEnrollmentState::Pending)),
            other => Err(de::Error::custom(format!(
                "join enrollment state {other} is unknown"
            ))),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{GithubProvider, StoredProvider};

    fn row(repo: &str) -> anyhow::Result<StorageProvider> {
        Ok(StorageProvider::fixture(
            &format!("github-{repo}"),
            StoredProvider::Github(GithubProvider::fixture(repo, "TEST-ONLY-github-token")?),
        ))
    }

    fn request(
        authentication: VaultAuthenticationState,
        join_state: JoinEnrollmentState,
        sync_providers: Vec<StorageProvider>,
    ) -> JoinConnectRequest {
        JoinConnectRequest {
            authentication,
            join_state: JoinConnectEnrollment(join_state),
            sync_providers,
        }
    }

    #[test]
    fn a_join_without_a_session_connects_through_the_first_sync_row() -> anyhow::Result<()> {
        let rows = vec![row("first")?, row("second")?];
        let expected = rows
            .first()
            .map(StorageProvider::storage_connection)
            .ok_or_else(|| anyhow::anyhow!("fixture rows"))?;
        for join_state in [
            JoinEnrollmentState::NeedsRequest,
            JoinEnrollmentState::Pending,
        ] {
            assert_eq!(
                request(
                    VaultAuthenticationState::Unauthenticated,
                    join_state,
                    rows.clone()
                )
                .source(),
                JoinConnectSource::JoinProvider {
                    connection: expected.clone()
                }
            );
        }
        Ok(())
    }

    #[test]
    fn a_session_no_join_or_no_row_reads_the_draft() -> anyhow::Result<()> {
        let rows = vec![row("first")?];
        assert_eq!(
            request(
                VaultAuthenticationState::Authenticated,
                JoinEnrollmentState::Pending,
                rows.clone()
            )
            .source(),
            JoinConnectSource::Draft
        );
        assert_eq!(
            request(
                VaultAuthenticationState::Unauthenticated,
                JoinEnrollmentState::None,
                rows
            )
            .source(),
            JoinConnectSource::Draft
        );
        assert_eq!(
            request(
                VaultAuthenticationState::Unauthenticated,
                JoinEnrollmentState::Pending,
                Vec::new()
            )
            .source(),
            JoinConnectSource::Draft
        );
        Ok(())
    }

    #[test]
    fn the_join_state_keeps_its_numeric_wire_form() -> anyhow::Result<()> {
        let wire = serde_json::json!({
            "authentication": "unauthenticated",
            "joinState": 2,
            "syncProviders": [],
        });
        let decoded: JoinConnectRequest = serde_json::from_value(wire.clone())?;
        assert_eq!(
            decoded.join_state,
            JoinConnectEnrollment(JoinEnrollmentState::Pending)
        );
        assert_eq!(serde_json::to_value(&decoded)?, wire);
        assert!(
            serde_json::from_value::<JoinConnectRequest>(serde_json::json!({
                "authentication": "unauthenticated",
                "joinState": 7,
                "syncProviders": [],
            }))
            .is_err()
        );
        Ok(())
    }
}

//! Personal-data fill session request contracts.
//!
//! The service worker lists one record group's list metadata for a paired
//! vault grant, and reveals the planned kinds of one explicitly selected
//! record. Neither request carries a personal value; the reveal response is
//! owned by the vault manager's personal fill projection.

#![allow(dead_code)] // Serde reads the private wire fields during concrete decoding.

use super::queue::QueueDisposition;
use crate::{PersonalFieldGroup, PersonalFieldKind};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use tsify::Tsify;

/// Grant-bound request for the list metadata of one personal record group.
/// Camel-case grant keys preserve the established extension transport contract.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PersonalRecordsGrantPayload {
    vault_store_id: String,
    device_id: String,
    device_public_key: String,
    device_signing_public_key: String,
    #[tsify(type = "keyof typeof PersonalFieldGroup")]
    group: PersonalFieldGroup,
    queue: QueueDisposition,
}

/// Planned kinds of one fill: at least one, each at most once.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize, Tsify)]
#[serde(try_from = "Vec<PersonalFieldKind>")]
#[tsify(type = "(keyof typeof PersonalFieldKind)[]")]
pub struct PersonalFillKinds(Vec<PersonalFieldKind>);

impl PersonalFillKinds {
    /// The number of distinct personal field kinds.
    const MAXIMUM: usize = 24;

    #[must_use]
    pub fn as_slice(&self) -> &[PersonalFieldKind] {
        let Self(kinds) = self;
        kinds
    }
}

impl TryFrom<Vec<PersonalFieldKind>> for PersonalFillKinds {
    type Error = String;

    fn try_from(kinds: Vec<PersonalFieldKind>) -> Result<Self, Self::Error> {
        let distinct = kinds.iter().collect::<HashSet<_>>().len();
        match (kinds.len(), distinct == kinds.len()) {
            (0, _) => Err("personal fill requires at least one kind".to_owned()),
            (count, _) if count > Self::MAXIMUM => {
                Err("personal fill lists too many kinds".to_owned())
            }
            (_, false) => Err("personal fill repeats a kind".to_owned()),
            (_, true) => Ok(Self(kinds)),
        }
    }
}

/// Grant-bound reveal of one selected record's planned kinds.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PersonalFillGrantPayload {
    vault_store_id: String,
    device_id: String,
    device_public_key: String,
    device_signing_public_key: String,
    secret_id: String,
    #[tsify(type = "keyof typeof PersonalFieldGroup")]
    group: PersonalFieldGroup,
    kinds: PersonalFillKinds,
    queue: QueueDisposition,
}

#[cfg(test)]
mod tests {
    use super::super::request::{ExtensionSessionRequest, ExtensionSessionRequestValidation};
    use super::*;

    const LIST: &str = r#"{"type":"nook:extension-session-list-personal-records","payload":{"vaultStoreId":"vault","deviceId":"device","devicePublicKey":"public","deviceSigningPublicKey":"signing","group":"Address","queue":{"kind":"message-default"}}}"#;
    const REVEAL: &str = r#"{"type":"nook:extension-session-reveal-personal-fill","payload":{"vaultStoreId":"vault","deviceId":"device","devicePublicKey":"public","deviceSigningPublicKey":"signing","secretId":"secret","group":"Person","kinds":["GivenName","FamilyName","Email"],"queue":{"kind":"message-default"}}}"#;

    fn validation(serialized: &str) -> ExtensionSessionRequestValidation {
        ExtensionSessionRequestValidation::validate_extension_session_request_json(serialized)
    }

    #[test]
    fn personal_requests_round_trip_their_group_and_kinds() -> anyhow::Result<()> {
        for serialized in [LIST, REVEAL] {
            let decoded: ExtensionSessionRequest = serde_json::from_str(serialized)?;
            let encoded = serde_json::to_string(&decoded)?;
            assert_eq!(
                serde_json::from_str::<ExtensionSessionRequest>(&encoded)?,
                decoded
            );
        }
        let reveal: ExtensionSessionRequest = serde_json::from_str(REVEAL)?;
        let ExtensionSessionRequest::RevealPersonalFill(payload) = reveal else {
            anyhow::bail!("expected a personal fill reveal");
        };
        assert_eq!(payload.group, PersonalFieldGroup::Person);
        assert_eq!(
            payload.kinds.as_slice(),
            [
                PersonalFieldKind::GivenName,
                PersonalFieldKind::FamilyName,
                PersonalFieldKind::Email
            ]
        );
        Ok(())
    }

    #[test]
    fn personal_requests_require_their_grant_group_and_known_vocabulary() {
        assert_eq!(
            validation(LIST),
            ExtensionSessionRequestValidation::Accepted
        );
        assert_eq!(
            validation(REVEAL),
            ExtensionSessionRequestValidation::Accepted
        );
        for rejected in [
            LIST.replace(r#""vaultStoreId":"vault","#, ""),
            LIST.replace(r#""group":"Address""#, r#""group":"Passport""#),
            LIST.replace(r#""group":"Address","#, ""),
            REVEAL.replace(r#""secretId":"secret","#, ""),
            REVEAL.replace(r#""GivenName""#, r#""Password""#),
            REVEAL.replace(r#""queue""#, r#""origin":"https://example.com","queue""#),
        ] {
            assert_eq!(
                validation(&rejected),
                ExtensionSessionRequestValidation::Rejected,
                "{rejected} should be rejected"
            );
        }
    }

    #[test]
    fn personal_fill_kinds_are_present_distinct_and_bounded() {
        assert_eq!(
            validation(&REVEAL.replace(r#"["GivenName","FamilyName","Email"]"#, "[]")),
            ExtensionSessionRequestValidation::Rejected
        );
        assert_eq!(
            validation(&REVEAL.replace(r#""FamilyName""#, r#""GivenName""#)),
            ExtensionSessionRequestValidation::Rejected
        );
        let oversized = vec![PersonalFieldKind::GivenName; PersonalFillKinds::MAXIMUM + 1];
        assert!(PersonalFillKinds::try_from(oversized).is_err());
    }
}

//! Whether a Google sign-in's token still serves a request, or needs a fresh
//! sign-in first. Rust owns the margin and the comparison; the browser
//! supplies only its clock.

use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use time::format_description::well_known::Rfc3339;
use time::{Duration, OffsetDateTime};
use tsify::Tsify;

use super::GoogleDriveAuthorization;
use crate::IsoTimestamp;
use crate::errors::{ValidationError, ValidationResult};

/// One Google authorization and the browser's current time.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GoogleDriveAuthorizationCheck {
    pub authorization: GoogleDriveAuthorization,
    pub now: IsoTimestamp,
}

/// Whether the token serves a request now.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub enum GoogleDriveAuthorizationFreshness {
    Current,
    RefreshDue,
}

impl GoogleDriveAuthorizationCheck {
    /// A token is refreshed this long before it expires, so no request carries
    /// one that lapses in flight.
    const REFRESH_MARGIN: Duration = Duration::minutes(1);

    /// `RefreshDue` from one minute before the token expires. A timestamp
    /// that is not RFC 3339 fails instead of reading as current.
    pub fn freshness(&self) -> ValidationResult<GoogleDriveAuthorizationFreshness> {
        let expires = Self::instant(&self.authorization.expires_at)?;
        let now = Self::instant(&self.now)?;
        Ok(match (now + Self::REFRESH_MARGIN).cmp(&expires) {
            Ordering::Less => GoogleDriveAuthorizationFreshness::Current,
            Ordering::Equal | Ordering::Greater => GoogleDriveAuthorizationFreshness::RefreshDue,
        })
    }

    fn instant(timestamp: &IsoTimestamp) -> ValidationResult<OffsetDateTime> {
        OffsetDateTime::parse(timestamp.as_str(), &Rfc3339)
            .map_err(|_| ValidationError::IsoTimestampInvalid)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ProviderSecretText;

    fn check(expires_at: &str, now: &str) -> anyhow::Result<GoogleDriveAuthorizationCheck> {
        Ok(GoogleDriveAuthorizationCheck {
            authorization: GoogleDriveAuthorization {
                access_token: ProviderSecretText::try_from("TEST-ONLY-drive-token".to_owned())?,
                expires_at: IsoTimestamp::parse(expires_at)?,
            },
            now: IsoTimestamp::parse(now)?,
        })
    }

    #[test]
    fn a_token_is_current_until_one_minute_before_it_expires() -> anyhow::Result<()> {
        let expires = "2030-01-01T12:00:00Z";
        assert_eq!(
            check(expires, "2030-01-01T11:58:59.999Z")?.freshness()?,
            GoogleDriveAuthorizationFreshness::Current
        );
        for now in [
            "2030-01-01T11:59:00Z",
            "2030-01-01T11:59:30Z",
            "2030-01-01T12:00:00Z",
            "2030-01-01T13:00:00+01:00",
            "2031-01-01T00:00:00Z",
        ] {
            assert_eq!(
                check(expires, now)?.freshness()?,
                GoogleDriveAuthorizationFreshness::RefreshDue
            );
        }
        Ok(())
    }

    #[test]
    fn a_timestamp_that_is_not_rfc_3339_fails() -> anyhow::Result<()> {
        assert!(
            check("2030-01-01 12:00", "2030-01-01T11:00:00Z")?
                .freshness()
                .is_err()
        );
        assert!(
            check("2030-01-01T12:00:00Z", "tomorrow 1")?
                .freshness()
                .is_err()
        );
        Ok(())
    }

    #[test]
    fn the_check_and_answer_keep_their_wire_shapes() -> anyhow::Result<()> {
        let wire = serde_json::json!({
            "authorization": {
                "accessToken": "TEST-ONLY-drive-token",
                "expiresAt": "2030-01-01T12:00:00Z",
            },
            "now": "2030-01-01T11:00:00Z",
        });
        let decoded: GoogleDriveAuthorizationCheck = serde_json::from_value(wire)?;
        assert_eq!(
            serde_json::to_value(decoded.freshness()?)?,
            serde_json::json!("current")
        );
        assert_eq!(
            serde_json::to_value(GoogleDriveAuthorizationFreshness::RefreshDue)?,
            serde_json::json!("refreshDue")
        );
        Ok(())
    }
}

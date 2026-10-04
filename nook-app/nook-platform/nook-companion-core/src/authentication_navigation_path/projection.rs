//! Pathname-only bounded projection for non-authorizing outcome evidence.
use super::AuthenticationNavigationPath;
use serde::{Deserialize, Serialize};
use tsify::Tsify;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(try_from = "String", into = "String")]
#[tsify(type = "string")]
pub struct AuthenticationOutcomePathname {
    segments: Vec<AuthenticationOutcomePathSegment>,
}
#[derive(Debug, Clone, PartialEq, Eq)]
struct AuthenticationOutcomePathSegment(String);
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum AuthenticationOutcomePathnameError {
    #[error("pathname exceeds the supported UTF-8 bound")]
    TooLong,
    #[error("pathname must contain only an absolute path without query or fragment")]
    NotPathname,
}
impl AuthenticationOutcomePathname {
    const MAX_BYTES: usize = 4096;
}
impl TryFrom<String> for AuthenticationOutcomePathname {
    type Error = AuthenticationOutcomePathnameError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        match value.len() {
            0..=Self::MAX_BYTES => {}
            _ => return Err(AuthenticationOutcomePathnameError::TooLong),
        }
        if !value.starts_with('/') || value.contains(['?', '#']) {
            return Err(AuthenticationOutcomePathnameError::NotPathname);
        }
        Ok(Self {
            segments: value
                .split('/')
                .map(|segment| AuthenticationOutcomePathSegment(segment.to_owned()))
                .collect(),
        })
    }
}
impl From<AuthenticationOutcomePathname> for String {
    fn from(value: AuthenticationOutcomePathname) -> Self {
        value
            .segments
            .into_iter()
            .map(|segment| segment.0)
            .collect::<Vec<_>>()
            .join("/")
    }
}
#[derive(Serialize, Deserialize, Tsify)]
#[serde(deny_unknown_fields)]
pub struct AuthenticationNavigationPathRequest {
    pathname: AuthenticationOutcomePathname,
}
#[derive(Debug, Serialize, Deserialize, Tsify, PartialEq, Eq)]
pub enum AuthenticationNavigationPathObservation {
    Authentication,
    Unrelated,
}
impl From<bool> for AuthenticationNavigationPathObservation {
    fn from(value: bool) -> Self {
        if value {
            Self::Authentication
        } else {
            Self::Unrelated
        }
    }
}
#[derive(Debug, Serialize, Deserialize, Tsify, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct AuthenticationNavigationPathProjection {
    observation: AuthenticationNavigationPathObservation,
}
impl AuthenticationNavigationPathRequest {
    #[must_use]
    pub fn project(self) -> AuthenticationNavigationPathProjection {
        let pathname: String = self.pathname.into();
        AuthenticationNavigationPathProjection {
            observation: AuthenticationNavigationPath::from(pathname.as_str())
                .has_authentication_segment()
                .into(),
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn action_projection_navigation_preserves_segment_classification() -> anyhow::Result<()> {
        for (pathname, expected) in [
            (
                "/account/login",
                AuthenticationNavigationPathObservation::Authentication,
            ),
            (
                "/account/login-more",
                AuthenticationNavigationPathObservation::Unrelated,
            ),
            ("/", AuthenticationNavigationPathObservation::Unrelated),
        ] {
            let request = AuthenticationNavigationPathRequest {
                pathname: pathname.to_owned().try_into()?,
            };
            let decoded: AuthenticationNavigationPathRequest =
                serde_json::from_str(&serde_json::to_string(&request)?)?;
            assert_eq!(decoded.project().observation, expected);
        }
        Ok(())
    }
    #[test]
    fn action_projection_navigation_rejects_oversize_utf8_query_and_fragment() {
        let exact = format!("/{}a", "é".repeat(2047));
        assert_eq!(exact.len(), 4096);
        assert!(AuthenticationOutcomePathname::try_from(exact.clone()).is_ok());
        assert!(AuthenticationOutcomePathname::try_from(format!("{exact}x")).is_err());
        for pathname in [
            "/login?next=home",
            "/login#fragment",
            "https://example.test/login",
            "login",
            "",
        ] {
            assert!(AuthenticationOutcomePathname::try_from(pathname.to_owned()).is_err());
        }
        assert!(
            serde_json::from_str::<AuthenticationNavigationPathRequest>(r#"{"pathname":17}"#)
                .is_err()
        );
        assert!(
            serde_json::from_str::<AuthenticationNavigationPathRequest>(
                r#"{"pathname":"/","query":"login"}"#
            )
            .is_err()
        );
    }
}

//! Non-secret browser scope and capture-time baseline for an ephemeral save offer.
use super::outcome::{LoginAuthFieldPresence, LoginControlLabel};
use crate::LoginSubmissionOrigin;
use crate::{AuthenticationWorkflowKind, CompanionEpochMilliseconds};
use serde::{Deserialize, Serialize};
use tsify::Tsify;
use url::Url;

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum LoginSaveContextError {
    #[error("login save sender context is invalid")]
    InvalidSender,
    #[error("login capture URL is invalid")]
    InvalidUrl,
    #[error("login capture baseline is invalid")]
    InvalidBaseline,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(try_from = "i32", into = "i32")]
#[tsify(type = "number")]
pub struct LoginSaveTabId(i32);

impl TryFrom<i32> for LoginSaveTabId {
    type Error = LoginSaveContextError;
    fn try_from(value: i32) -> Result<Self, Self::Error> {
        match value {
            0.. => Ok(Self(value)),
            _ => Err(LoginSaveContextError::InvalidSender),
        }
    }
}
impl From<LoginSaveTabId> for i32 {
    fn from(id: LoginSaveTabId) -> Self {
        let LoginSaveTabId(value) = id;
        value
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(try_from = "i32", into = "i32")]
#[tsify(type = "number")]
pub struct LoginSaveFrameId(i32);

impl TryFrom<i32> for LoginSaveFrameId {
    type Error = LoginSaveContextError;
    fn try_from(value: i32) -> Result<Self, Self::Error> {
        match value {
            0.. => Ok(Self(value)),
            _ => Err(LoginSaveContextError::InvalidSender),
        }
    }
}
impl From<LoginSaveFrameId> for i32 {
    fn from(id: LoginSaveFrameId) -> Self {
        let LoginSaveFrameId(value) = id;
        value
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(deny_unknown_fields)]
pub struct LoginSaveSenderContext {
    pub tab_id: LoginSaveTabId,
    pub frame_id: LoginSaveFrameId,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
pub enum LoginSaveScopeMatch {
    SameScope,
    DifferentScope,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
pub enum LoginSaveCaptureSource {
    SubmittedLogin,
    ExplicitAuthentication,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "kind", deny_unknown_fields)]
pub enum LoginSaveCommitEvidence {
    SubmittedLogin {
        observation: crate::LoginSaveOutcomeObservation,
    },
    ExplicitAuthentication {
        observation: crate::AuthenticationOutcomeObservation,
    },
}

impl LoginSaveSenderContext {
    #[must_use]
    pub fn compare_scope(self, other: Self) -> LoginSaveScopeMatch {
        let true = self == other else {
            return LoginSaveScopeMatch::DifferentScope;
        };
        LoginSaveScopeMatch::SameScope
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(try_from = "String", into = "String")]
#[tsify(type = "string")]
pub struct LoginSubmissionPageUrl(Url);

impl TryFrom<String> for LoginSubmissionPageUrl {
    type Error = LoginSaveContextError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        let false = value.len() > crate::MAX_AUTHENTICATION_DESTINATION_TEXT_BYTES else {
            return Err(LoginSaveContextError::InvalidUrl);
        };
        let parsed = Url::parse(&value).map_err(|_| LoginSaveContextError::InvalidUrl)?;
        match parsed.scheme() {
            "https" | "http" => {}
            _ => return Err(LoginSaveContextError::InvalidUrl),
        }
        let true =
            (parsed.has_host() && parsed.username().is_empty() && parsed.password().is_none())
        else {
            return Err(LoginSaveContextError::InvalidUrl);
        };
        Ok(Self(parsed))
    }
}
impl From<LoginSubmissionPageUrl> for String {
    fn from(page: LoginSubmissionPageUrl) -> Self {
        let LoginSubmissionPageUrl(url) = page;
        url.into()
    }
}

impl LoginSubmissionPageUrl {
    #[must_use]
    pub fn compare_origin(&self, other: &Self) -> crate::LoginSubmissionOrigin {
        let true = self.0.origin() == other.0.origin() else {
            return LoginSubmissionOrigin::ChangedOrigin;
        };
        LoginSubmissionOrigin::SameOrigin
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Tsify)]
#[serde(try_from = "LoginSaveCaptureBaselineWire")]
pub struct LoginSaveCaptureBaseline {
    pub source: LoginSaveCaptureSource,
    pub submitted_at: CompanionEpochMilliseconds,
    pub submitted_url: LoginSubmissionPageUrl,
    pub captured_workflow: AuthenticationWorkflowKind,
    pub initial_auth_fields: LoginAuthFieldPresence,
    pub controls: Vec<LoginControlLabel>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LoginSaveCaptureBaselineWire {
    source: LoginSaveCaptureSource,
    submitted_at: CompanionEpochMilliseconds,
    submitted_url: LoginSubmissionPageUrl,
    captured_workflow: AuthenticationWorkflowKind,
    initial_auth_fields: LoginAuthFieldPresence,
    controls: Vec<LoginControlLabel>,
}

impl TryFrom<LoginSaveCaptureBaselineWire> for LoginSaveCaptureBaseline {
    type Error = LoginSaveContextError;
    fn try_from(wire: LoginSaveCaptureBaselineWire) -> Result<Self, Self::Error> {
        wire.submitted_at
            .validate()
            .map_err(|_| LoginSaveContextError::InvalidBaseline)?;
        match wire.source {
            LoginSaveCaptureSource::SubmittedLogin => match wire.captured_workflow {
                AuthenticationWorkflowKind::Login => {}
                AuthenticationWorkflowKind::Signup
                | AuthenticationWorkflowKind::PasswordChange
                | AuthenticationWorkflowKind::TotpChallenge
                | AuthenticationWorkflowKind::TotpEnrollment
                | AuthenticationWorkflowKind::Manual => {
                    return Err(LoginSaveContextError::InvalidBaseline);
                }
            },
            LoginSaveCaptureSource::ExplicitAuthentication => match wire.captured_workflow {
                AuthenticationWorkflowKind::Login
                | AuthenticationWorkflowKind::Signup
                | AuthenticationWorkflowKind::PasswordChange => {}
                AuthenticationWorkflowKind::TotpChallenge
                | AuthenticationWorkflowKind::TotpEnrollment
                | AuthenticationWorkflowKind::Manual => {
                    return Err(LoginSaveContextError::InvalidBaseline);
                }
            },
        }
        match wire.initial_auth_fields {
            LoginAuthFieldPresence::Present => {}
            LoginAuthFieldPresence::Absent => return Err(LoginSaveContextError::InvalidBaseline),
        }
        match wire.controls.len() {
            0..=64 => Ok(Self {
                source: wire.source,
                submitted_at: wire.submitted_at,
                submitted_url: wire.submitted_url,
                captured_workflow: wire.captured_workflow,
                initial_auth_fields: wire.initial_auth_fields,
                controls: wire.controls,
            }),
            65.. => Err(LoginSaveContextError::InvalidBaseline),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sender_scope_is_exact_and_negative_browser_ids_are_rejected() -> anyhow::Result<()> {
        let sender = LoginSaveSenderContext {
            tab_id: LoginSaveTabId::try_from(1)?,
            frame_id: LoginSaveFrameId::try_from(0)?,
        };
        assert_eq!(sender.compare_scope(sender), LoginSaveScopeMatch::SameScope);
        assert_eq!(
            sender.compare_scope(LoginSaveSenderContext {
                tab_id: LoginSaveTabId::try_from(2)?,
                ..sender
            }),
            LoginSaveScopeMatch::DifferentScope
        );
        assert_eq!(
            LoginSaveFrameId::try_from(-1),
            Err(LoginSaveContextError::InvalidSender)
        );
        assert_eq!(
            LoginSaveTabId::try_from(-1),
            Err(LoginSaveContextError::InvalidSender)
        );
        Ok(())
    }
    #[test]
    fn submitted_url_rejects_credentials_foreign_schemes_and_oversized_input() {
        for url in [
            "https://user:password@example.test",
            "javascript:alert(1)",
            "file:///tmp/login",
            "not a URL",
        ] {
            assert_eq!(
                LoginSubmissionPageUrl::try_from(url.to_owned()),
                Err(LoginSaveContextError::InvalidUrl)
            );
        }
        assert_eq!(
            LoginSubmissionPageUrl::try_from(
                "x".repeat(crate::MAX_AUTHENTICATION_DESTINATION_TEXT_BYTES + 1)
            ),
            Err(LoginSaveContextError::InvalidUrl)
        );
    }
}

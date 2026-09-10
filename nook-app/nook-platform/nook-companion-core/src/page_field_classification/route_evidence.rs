//! Semantic route evidence admitted from browser boolean observations.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthenticationRouteControlPresence {
    Absent,
    Present,
}
impl From<bool> for AuthenticationRouteControlPresence {
    fn from(present: bool) -> Self {
        if present { Self::Present } else { Self::Absent }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthenticationRouteUsernamePresence {
    Absent,
    Present,
}
impl From<bool> for AuthenticationRouteUsernamePresence {
    fn from(present: bool) -> Self {
        if present { Self::Present } else { Self::Absent }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthenticationRouteScope {
    Unrelated,
    LocalAuthentication,
}
impl From<bool> for AuthenticationRouteScope {
    fn from(present: bool) -> Self {
        if present {
            Self::LocalAuthentication
        } else {
            Self::Unrelated
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthenticationRoutePasswordPresence {
    Absent,
    Present,
}
impl From<bool> for AuthenticationRoutePasswordPresence {
    fn from(present: bool) -> Self {
        if present { Self::Present } else { Self::Absent }
    }
}

/// Boolean serialization preserves the HTML-observation transport contract.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(from = "bool", into = "bool")]
pub enum PageLoginContext {
    Unrelated,
    Authentication,
}
impl From<bool> for PageLoginContext {
    fn from(authentication: bool) -> Self {
        if authentication {
            Self::Authentication
        } else {
            Self::Unrelated
        }
    }
}
impl From<PageLoginContext> for bool {
    fn from(context: PageLoginContext) -> Self {
        matches!(context, PageLoginContext::Authentication)
    }
}

#[derive(Debug, serde::Deserialize, tsify::Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(from_wasm_abi)]
pub struct AuthenticationControlTransportability {
    pub submission_method: crate::PageControlSubmissionMethod,
    pub username_field_count: crate::AuthenticationFieldCount,
}
impl AuthenticationControlTransportability {
    #[must_use]
    pub fn is_transportable(self) -> bool {
        match self.submission_method {
            crate::PageControlSubmissionMethod::Dialog => false,
            crate::PageControlSubmissionMethod::Get => self.username_field_count.is_single(),
            _ => true,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::AuthenticationControlTransportability;
    use crate::PageControlSubmissionMethod;

    #[test]
    fn transport_admission_obeys_submission_method_and_username_count() {
        for count in [0, 1, 2] {
            for (method, expected) in [
                (PageControlSubmissionMethod::Dialog, false),
                (PageControlSubmissionMethod::Get, count == 1),
                (PageControlSubmissionMethod::Post, true),
                (PageControlSubmissionMethod::Absent, true),
            ] {
                assert_eq!(
                    AuthenticationControlTransportability {
                        submission_method: method,
                        username_field_count: count.into(),
                    }
                    .is_transportable(),
                    expected,
                    "method {method:?}, usernames {count}"
                );
            }
        }
    }
}

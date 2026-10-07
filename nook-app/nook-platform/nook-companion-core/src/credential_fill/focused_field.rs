//! One live field's credential eligibility, without workflow or submit authority.

use super::{CredentialKind, Plan, field};
use crate::PageInputFieldObservation;
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FocusedCredentialOpportunity {
    Unavailable,
    Username,
    CurrentPassword,
}

/// Canonical credential selection supplied by Rust after focused recognition.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, tsify::Tsify)]
pub struct FocusedCredentialSelection {
    #[tsify(type = "keyof typeof CredentialKind")]
    pub credential: CredentialKind,
}

#[derive(Debug, thiserror::Error)]
#[error("an unavailable focused field has no credential selection")]
pub struct FocusedCredentialSelectionUnavailable;

impl FocusedCredentialOpportunity {
    pub fn credential_selection(
        self,
    ) -> Result<FocusedCredentialSelection, FocusedCredentialSelectionUnavailable> {
        match self {
            Self::Unavailable => Err(FocusedCredentialSelectionUnavailable),
            Self::Username => Ok(FocusedCredentialSelection {
                credential: CredentialKind::Username,
            }),
            Self::CurrentPassword => Ok(FocusedCredentialSelection {
                credential: CredentialKind::CurrentPassword,
            }),
        }
    }
    #[must_use]
    pub fn from_page_input(input: &PageInputFieldObservation) -> Self {
        let field::Classification::Observed(observed) =
            field::Classification::from_page_input(field::Index::ZERO, input)
        else {
            return Self::Unavailable;
        };
        let Ok(plan) = Plan::from_fields(&[observed.observation]) else {
            return Self::Unavailable;
        };
        match plan.assignments.as_slice() {
            [assignment] => match assignment.credential {
                CredentialKind::Username => Self::Username,
                CredentialKind::CurrentPassword => Self::CurrentPassword,
            },
            [] | [_, _, ..] => Self::Unavailable,
        }
    }

    /// Revalidate against the retained target's current browser metadata.
    #[must_use]
    pub fn revalidate(self, input: &PageInputFieldObservation) -> Self {
        match self {
            Self::Unavailable => Self::Unavailable,
            Self::Username => match Self::from_page_input(input) {
                Self::Username => Self::Username,
                Self::CurrentPassword | Self::Unavailable => Self::Unavailable,
            },
            Self::CurrentPassword => match Self::from_page_input(input) {
                Self::CurrentPassword => Self::CurrentPassword,
                Self::Username | Self::Unavailable => Self::Unavailable,
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{PageInputType, PageLoginContext};

    #[test]
    fn selector_uses_canonical_credential_and_rejects_unavailable() -> anyhow::Result<()> {
        let username = FocusedCredentialOpportunity::from_page_input(&InputFixture::username())
            .credential_selection()?;
        let password = FocusedCredentialOpportunity::from_page_input(&InputFixture::password())
            .credential_selection()?;
        assert_eq!(username.credential, CredentialKind::Username);
        assert_eq!(password.credential, CredentialKind::CurrentPassword);
        assert_eq!(
            serde_json::to_string(&username)?,
            r#"{"credential":"Username"}"#
        );
        assert_eq!(
            serde_json::to_string(&password)?,
            r#"{"credential":"CurrentPassword"}"#
        );
        assert!(
            FocusedCredentialOpportunity::Unavailable
                .credential_selection()
                .is_err()
        );
        Ok(())
    }

    struct InputFixture;

    impl InputFixture {
        fn username() -> PageInputFieldObservation {
            PageInputFieldObservation {
                input_type: PageInputType::Text,
                disabled: false,
                read_only: false,
                autocomplete_tokens: vec!["username".to_owned()],
                identity_text: "account email".to_owned(),
                login_context: PageLoginContext::from(false),
            }
        }

        fn password() -> PageInputFieldObservation {
            PageInputFieldObservation {
                input_type: PageInputType::Password,
                autocomplete_tokens: vec!["current-password".to_owned()],
                identity_text: "password".to_owned(),
                ..Self::username()
            }
        }
    }

    #[test]
    fn recognizes_one_writable_credential_without_workflow_authority() {
        assert_eq!(
            FocusedCredentialOpportunity::from_page_input(&InputFixture::username()),
            FocusedCredentialOpportunity::Username
        );
        assert_eq!(
            FocusedCredentialOpportunity::from_page_input(&InputFixture::password()),
            FocusedCredentialOpportunity::CurrentPassword
        );
        let generic = PageInputFieldObservation {
            autocomplete_tokens: Vec::new(),
            ..InputFixture::password()
        };
        assert_eq!(
            FocusedCredentialOpportunity::from_page_input(&generic),
            FocusedCredentialOpportunity::CurrentPassword
        );
    }

    #[test]
    fn excludes_unrelated_nonwritable_and_unsafe_roles() {
        for field in [
            PageInputFieldObservation {
                disabled: true,
                ..InputFixture::username()
            },
            PageInputFieldObservation {
                read_only: true,
                ..InputFixture::username()
            },
            PageInputFieldObservation {
                read_only: true,
                ..InputFixture::password()
            },
            PageInputFieldObservation {
                autocomplete_tokens: vec!["new-password".to_owned()],
                ..InputFixture::password()
            },
            PageInputFieldObservation {
                autocomplete_tokens: vec!["one-time-code".to_owned()],
                ..InputFixture::password()
            },
            PageInputFieldObservation {
                autocomplete_tokens: Vec::new(),
                identity_text: "newsletter email".to_owned(),
                input_type: PageInputType::Email,
                ..InputFixture::username()
            },
            PageInputFieldObservation {
                autocomplete_tokens: Vec::new(),
                identity_text: "search".to_owned(),
                ..InputFixture::username()
            },
            PageInputFieldObservation {
                autocomplete_tokens: Vec::new(),
                identity_text: String::new(),
                ..InputFixture::username()
            },
        ] {
            assert_eq!(
                FocusedCredentialOpportunity::from_page_input(&field),
                FocusedCredentialOpportunity::Unavailable
            );
        }
    }

    #[test]
    fn revalidation_requires_the_same_live_credential_role() {
        let username = FocusedCredentialOpportunity::Username;
        assert_eq!(username.revalidate(&InputFixture::username()), username);
        assert_eq!(
            username.revalidate(&InputFixture::password()),
            FocusedCredentialOpportunity::Unavailable
        );
        assert_eq!(
            FocusedCredentialOpportunity::CurrentPassword.revalidate(&InputFixture::password()),
            FocusedCredentialOpportunity::CurrentPassword
        );
        assert_eq!(
            FocusedCredentialOpportunity::Unavailable.revalidate(&InputFixture::username()),
            FocusedCredentialOpportunity::Unavailable
        );
        let disabled = PageInputFieldObservation {
            disabled: true,
            ..InputFixture::username()
        };
        assert_eq!(
            username.revalidate(&disabled),
            FocusedCredentialOpportunity::Unavailable
        );
    }
}

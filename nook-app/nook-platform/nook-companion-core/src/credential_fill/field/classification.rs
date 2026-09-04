use super::{
    Credential, CredentialRole, Editability, Index, NewPassword, Observation, OneTimeCode, Password,
};
use crate::page_field_classification;
use serde::{Deserialize, Serialize};

/// Owned observation produced for one classified page input.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Observed {
    pub observation: Observation,
}

impl From<Observation> for Observed {
    fn from(observation: Observation) -> Self {
        Self { observation }
    }
}

/// Identity retained for one page input excluded from credential filling.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Ignored {
    pub field_index: Index,
}

impl From<Index> for Ignored {
    fn from(field_index: Index) -> Self {
        Self { field_index }
    }
}

/// Credential-fill classification of one page input.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Classification {
    Ignored(Ignored),
    Observed(Observed),
}

impl From<Observation> for Classification {
    fn from(observation: Observation) -> Self {
        Self::Observed(observation.into())
    }
}

impl Classification {
    #[must_use]
    pub const fn outcome(self) -> super::super::CredentialFillFieldClassificationOutcome {
        match self {
            Self::Ignored(_) => super::super::CredentialFillFieldClassificationOutcome::Ignored,
            Self::Observed(_) => super::super::CredentialFillFieldClassificationOutcome::Observed,
        }
    }

    /// Classify one browser-observed page input for credential-fill planning.
    #[must_use]
    pub fn from_page_input(field_index: Index, field: &crate::PageInputFieldObservation) -> Self {
        if field.disabled {
            return Self::Ignored(field_index.into());
        }
        match page_field_classification::classify_authentication_input_role(field) {
            page_field_classification::AuthenticationInputRole::OneTimeCode(_) => {
                Observation::from(OneTimeCode::from(field_index)).into()
            }
            page_field_classification::AuthenticationInputRole::Username(_) => {
                let editability = if field.read_only {
                    Editability::Readonly
                } else {
                    Editability::Writable
                };
                Observation::from(Credential {
                    field_index,
                    role: CredentialRole::Username,
                    editability,
                })
                .into()
            }
            page_field_classification::AuthenticationInputRole::NonAuthentication(_) => {
                Self::Ignored(field_index.into())
            }
            page_field_classification::AuthenticationInputRole::Unrelated(_) => {
                if field.input_type != crate::PageInputType::Password {
                    return Self::Ignored(field_index.into());
                }
                if page_field_classification::has_autocomplete_token(
                    &field.autocomplete_tokens,
                    "new-password",
                ) {
                    return Observation::from(NewPassword::from(field_index)).into();
                }
                let password = if page_field_classification::has_autocomplete_token(
                    &field.autocomplete_tokens,
                    "current-password",
                ) {
                    Password::Current
                } else {
                    Password::Generic
                };
                let editability = if field.read_only {
                    Editability::Readonly
                } else {
                    Editability::Writable
                };
                Observation::from(Credential {
                    field_index,
                    role: CredentialRole::Password(password),
                    editability,
                })
                .into()
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture;

    impl Fixture {
        fn page_input(
            input_type: crate::PageInputType,
            autocomplete_tokens: &[&str],
            identity_text: &str,
        ) -> crate::PageInputFieldObservation {
            crate::PageInputFieldObservation {
                input_type,
                disabled: false,
                read_only: false,
                autocomplete_tokens: autocomplete_tokens
                    .iter()
                    .map(ToString::to_string)
                    .collect(),
                identity_text: identity_text.to_owned(),
                login_context: true,
            }
        }
    }

    #[test]
    fn serialization_preserves_source_names_and_payload_boundaries() -> anyhow::Result<()> {
        let observation = Observation::from(Credential {
            field_index: Index::ZERO,
            role: CredentialRole::Username,
            editability: Editability::Writable,
        });
        assert_eq!(
            serde_json::to_string(&Classification::from(observation))?,
            r#"{"Observed":{"observation":{"Credential":{"field_index":{"value":0},"role":"Username","editability":"Writable"}}}}"#
        );
        assert_eq!(
            serde_json::to_string(&Classification::Ignored(Index::THREE.into()))?,
            r#"{"Ignored":{"field_index":{"value":3}}}"#
        );
        Ok(())
    }

    #[test]
    fn classifies_page_inputs_into_owned_credential_fill_observations() {
        let cases = [
            (
                Fixture::page_input(
                    crate::PageInputType::Email,
                    &["one-time-code", "username", "cc-csc"],
                    "account email",
                ),
                Classification::from(Observation::from(OneTimeCode::from(Index::ZERO))),
            ),
            (
                Fixture::page_input(
                    crate::PageInputType::Text,
                    &["username"],
                    "verification code",
                ),
                Classification::from(Observation::from(Credential {
                    field_index: Index::ZERO,
                    role: CredentialRole::Username,
                    editability: Editability::Writable,
                })),
            ),
            (
                Fixture::page_input(
                    crate::PageInputType::Text,
                    &[],
                    "username verification code",
                ),
                Classification::from(Observation::from(OneTimeCode::from(Index::ZERO))),
            ),
            (
                Fixture::page_input(crate::PageInputType::Password, &["one-time-code"], ""),
                Classification::from(Observation::from(OneTimeCode::from(Index::ZERO))),
            ),
            (
                Fixture::page_input(
                    crate::PageInputType::Password,
                    &["one-time-code"],
                    "credit card security code",
                ),
                Classification::from(Observation::from(OneTimeCode::from(Index::ZERO))),
            ),
            (
                Fixture::page_input(
                    crate::PageInputType::Password,
                    &["one-time-code", "current-password"],
                    "otp verification code",
                ),
                Classification::from(Observation::from(OneTimeCode::from(Index::ZERO))),
            ),
            (
                Fixture::page_input(
                    crate::PageInputType::Password,
                    &["new-password", "current-password"],
                    "new password",
                ),
                Classification::from(Observation::from(NewPassword::from(Index::ZERO))),
            ),
            (
                Fixture::page_input(
                    crate::PageInputType::Password,
                    &["current-password"],
                    "password",
                ),
                Classification::from(Observation::from(Credential {
                    field_index: Index::ZERO,
                    role: CredentialRole::Password(Password::Current),
                    editability: Editability::Writable,
                })),
            ),
            (
                Fixture::page_input(crate::PageInputType::Password, &[], "password"),
                Classification::from(Observation::from(Credential {
                    field_index: Index::ZERO,
                    role: CredentialRole::Password(Password::Generic),
                    editability: Editability::Writable,
                })),
            ),
            (
                Fixture::page_input(
                    crate::PageInputType::Text,
                    &["username"],
                    "account identity",
                ),
                Classification::from(Observation::from(Credential {
                    field_index: Index::ZERO,
                    role: CredentialRole::Username,
                    editability: Editability::Writable,
                })),
            ),
        ];

        for (field, expected) in cases {
            assert_eq!(
                Classification::from_page_input(Index::ZERO, &field),
                expected
            );
            assert_eq!(
                expected.outcome(),
                super::super::super::CredentialFillFieldClassificationOutcome::Observed
            );
        }
    }

    #[test]
    fn carries_readonly_credential_editability_but_preserves_unsafe_variants() {
        let mut password = Fixture::page_input(
            crate::PageInputType::Password,
            &["current-password"],
            "password",
        );
        password.read_only = true;
        assert_eq!(
            Classification::from_page_input(Index::ZERO, &password),
            Observation::from(Credential {
                field_index: Index::ZERO,
                role: CredentialRole::Password(Password::Current),
                editability: Editability::Readonly,
            })
            .into()
        );

        let mut username =
            Fixture::page_input(crate::PageInputType::Text, &["username"], "identity");
        username.read_only = true;
        assert_eq!(
            Classification::from_page_input(Index::ONE, &username),
            Observation::from(Credential {
                field_index: Index::ONE,
                role: CredentialRole::Username,
                editability: Editability::Readonly,
            })
            .into()
        );

        let mut otp = Fixture::page_input(
            crate::PageInputType::Password,
            &["one-time-code", "current-password"],
            "verification code",
        );
        otp.read_only = true;
        assert_eq!(
            Classification::from_page_input(Index::TWO, &otp),
            Observation::from(OneTimeCode::from(Index::TWO)).into()
        );

        let mut new_password = Fixture::page_input(
            crate::PageInputType::Password,
            &["new-password", "current-password"],
            "new password",
        );
        new_password.read_only = true;
        assert_eq!(
            Classification::from_page_input(Index::THREE, &new_password),
            Observation::from(NewPassword::from(Index::THREE)).into()
        );
    }

    #[test]
    fn password_autocomplete_tokens_do_not_override_input_type() {
        for token in ["current-password", "new-password"] {
            let field = Fixture::page_input(crate::PageInputType::Text, &[token], "search");
            assert_eq!(
                Classification::from_page_input(Index::ZERO, &field),
                Classification::Ignored(Index::ZERO.into())
            );
        }
    }

    #[test]
    fn ignores_disabled_and_unrelated_page_inputs() {
        for field in [
            {
                let mut field = Fixture::page_input(
                    crate::PageInputType::Password,
                    &["one-time-code", "new-password", "current-password"],
                    "verification code",
                );
                field.disabled = true;
                field
            },
            Fixture::page_input(
                crate::PageInputType::Text,
                &["username", "cc-csc"],
                "account email",
            ),
            Fixture::page_input(crate::PageInputType::Password, &["cc-csc"], ""),
            Fixture::page_input(crate::PageInputType::Password, &[], "card security code"),
            Fixture::page_input(crate::PageInputType::Text, &[], "search"),
        ] {
            let classification = Classification::from_page_input(Index::ZERO, &field);
            assert_eq!(classification, Classification::Ignored(Index::ZERO.into()));
            assert_eq!(
                classification.outcome(),
                super::super::super::CredentialFillFieldClassificationOutcome::Ignored
            );
        }
    }
}

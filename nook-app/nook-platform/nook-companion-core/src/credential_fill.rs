//! Portable credential-fill planning from validated field observations.
//!
//! The browser adapter reports only structural, non-secret field facts and
//! receives a typed fill plan in return. DOM lookup, value assignment, focus,
//! and submission stay in the host adapter; this module owns which field
//! receives which credential kind and which plans are safe to execute.
//!
//! Deterministic zero-vault tests apply fake credentials to this plan entirely
//! inside the test harness, so production Rust and WASM remain credential-free.
//! Serialized and generated contract names remain identical to their Rust
//! source names.

use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::wasm_bindgen;

/// Credential kind assigned to one field in a fill plan.
#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CredentialKind {
    Username,
    CurrentPassword,
}

/// Structural facts about fields in one observed authentication scope.
pub mod field {
    use serde::{Deserialize, Serialize};

    /// Host-assigned identity for one field inside the observed scope.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
    pub struct Index {
        pub value: u32,
    }

    impl Index {
        pub const ZERO: Self = Self { value: 0 };
        pub const ONE: Self = Self { value: 1 };
        pub const TWO: Self = Self { value: 2 };
        pub const THREE: Self = Self { value: 3 };
    }

    impl From<u32> for Index {
        fn from(value: u32) -> Self {
            Self { value }
        }
    }

    /// Number of fields in an observed authentication scope.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
    pub struct Count {
        pub value: u32,
    }

    impl From<u32> for Count {
        fn from(value: u32) -> Self {
            Self { value }
        }
    }

    /// Credential role observed for a field that can receive a saved login value.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
    pub enum CredentialRole {
        Username,
        Password(Password),
    }

    /// Password semantics observed for a credential field.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
    pub enum Password {
        Current,
        Generic,
    }

    /// Whether the host observed a credential field as writable.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
    pub enum Editability {
        Writable,
        Readonly,
    }

    /// Facts carried only by a field that can receive a saved login value.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
    pub struct Credential {
        pub field_index: Index,
        pub role: CredentialRole,
        pub editability: Editability,
    }

    /// Facts carried only by a new-password field.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
    pub struct NewPassword {
        pub field_index: Index,
    }

    impl From<Index> for NewPassword {
        fn from(field_index: Index) -> Self {
            Self { field_index }
        }
    }

    /// Facts carried only by a one-time-code field.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
    pub struct OneTimeCode {
        pub field_index: Index,
    }

    impl From<Index> for OneTimeCode {
        fn from(field_index: Index) -> Self {
            Self { field_index }
        }
    }

    /// Host-observed field with variant-specific authentication semantics.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
    pub enum Observation {
        Credential(Credential),
        NewPassword(NewPassword),
        OneTimeCode(OneTimeCode),
    }

    impl From<Credential> for Observation {
        fn from(field: Credential) -> Self {
            Self::Credential(field)
        }
    }

    impl From<NewPassword> for Observation {
        fn from(field: NewPassword) -> Self {
            Self::NewPassword(field)
        }
    }

    impl From<OneTimeCode> for Observation {
        fn from(field: OneTimeCode) -> Self {
            Self::OneTimeCode(field)
        }
    }

    impl Observation {
        #[must_use]
        pub const fn field_index(self) -> Index {
            match self {
                Self::Credential(field) => field.field_index,
                Self::NewPassword(field) => field.field_index,
                Self::OneTimeCode(field) => field.field_index,
            }
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn variant_payloads_preserve_their_field_index() {
            for observation in [
                Observation::from(Credential {
                    field_index: Index::ONE,
                    role: CredentialRole::Username,
                    editability: Editability::Writable,
                }),
                Observation::from(NewPassword::from(Index::ONE)),
                Observation::from(OneTimeCode::from(Index::ONE)),
            ] {
                assert_eq!(observation.field_index(), Index::ONE);
            }
        }

        #[test]
        fn serialization_preserves_source_names_and_payload_boundaries() -> anyhow::Result<()> {
            assert_eq!(serde_json::to_string(&Count::from(64))?, r#"{"value":64}"#);
            let credential = Observation::from(Credential {
                field_index: Index::ZERO,
                role: CredentialRole::Username,
                editability: Editability::Writable,
            });
            assert_eq!(
                serde_json::to_string(&credential)?,
                r#"{"Credential":{"field_index":{"value":0},"role":"Username","editability":"Writable"}}"#
            );
            assert_eq!(
                serde_json::to_string(&Observation::from(NewPassword::from(Index::ONE)))?,
                r#"{"NewPassword":{"field_index":{"value":1}}}"#
            );
            assert_eq!(
                serde_json::to_string(&Observation::from(OneTimeCode::from(Index::TWO)))?,
                r#"{"OneTimeCode":{"field_index":{"value":2}}}"#
            );
            Ok(())
        }
    }
}

/// Why a fill plan cannot be produced for the observed fields.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error, Serialize, Deserialize)]
pub enum Error {
    /// The host supplied more field observations than the portable boundary permits.
    #[error("the observed scope exceeds the field-count limit")]
    TooManyObservedFields,
    /// Two observations claim the same host field identity.
    #[error("the observed scope contains a duplicate field index")]
    DuplicateFieldIndex,
    /// Password reset and signup fields are outside login credential fill.
    #[error("the observed scope contains a new-password field")]
    NewPasswordFieldPresent,
    /// One-time-code fields require a separate second-factor operation.
    #[error("the observed scope contains a one-time-code field")]
    OneTimeCodeFieldPresent,
    /// No field in the observed scope can receive credentials.
    #[error("no field in the observed scope can receive credentials")]
    NoCredentialField,
    /// Every password field is read-only, so credential disclosure is blocked.
    #[error("every password field is read-only, so credential disclosure is blocked")]
    PasswordFieldsReadonly,
    /// The scope contains multiple password fields that cannot be resolved
    /// into one current-password target.
    #[error("the observed scope has multiple login-password fields")]
    AmbiguousPasswordField,
    /// The scope contains multiple writable username targets.
    #[error("the observed scope has multiple writable username fields")]
    AmbiguousUsernameField,
}

/// Rust-owned decision for which field receives which credential kind.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Assignment {
    pub field_index: field::Index,
    pub credential: CredentialKind,
}

/// A complete, host-executable fill plan.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Plan {
    pub assignments: Vec<Assignment>,
}

/// Plan which observed fields receive the username and current password.
///
/// Mirrors the host's fill contract: fill the first username field, then a
/// sole current-password or generic-password field. A scope with only a
/// username field still plans a username fill; every other shape fails closed.
pub fn plan(fields: &[field::Observation]) -> Result<Plan, Error> {
    let maximum_field_count = field::Count::from(crate::MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT);
    if fields.len() > maximum_field_count.value as usize {
        return Err(Error::TooManyObservedFields);
    }
    let mut observed_field_indices = std::collections::HashSet::with_capacity(fields.len());
    for field in fields {
        if !observed_field_indices.insert(field.field_index()) {
            return Err(Error::DuplicateFieldIndex);
        }
    }
    if fields
        .iter()
        .any(|field| matches!(field, field::Observation::NewPassword(_)))
    {
        return Err(Error::NewPasswordFieldPresent);
    }
    if fields
        .iter()
        .any(|field| matches!(field, field::Observation::OneTimeCode(_)))
    {
        return Err(Error::OneTimeCodeFieldPresent);
    }

    let writable_username_fields = fields
        .iter()
        .filter_map(|field| {
            let field::Observation::Credential(credential) = field else {
                return None;
            };
            if !matches!(credential.role, field::CredentialRole::Username)
                || !matches!(credential.editability, field::Editability::Writable)
            {
                return None;
            }
            Some(credential.field_index)
        })
        .collect::<Vec<_>>();
    let password_fields = fields
        .iter()
        .filter_map(|field| {
            let field::Observation::Credential(credential) = field else {
                return None;
            };
            if !matches!(credential.role, field::CredentialRole::Password(_)) {
                return None;
            }
            Some((credential.field_index, credential.editability))
        })
        .collect::<Vec<_>>();

    if writable_username_fields.len() > 1 {
        return Err(Error::AmbiguousUsernameField);
    }
    let username_field_index = writable_username_fields.first().copied();
    if username_field_index.is_none() && password_fields.is_empty() {
        return Err(Error::NoCredentialField);
    }
    if password_fields.len() > 1 {
        return Err(Error::AmbiguousPasswordField);
    }
    let password_field = password_fields.first().copied();
    if password_field
        .is_some_and(|(_, editability)| matches!(editability, field::Editability::Readonly))
    {
        return Err(Error::PasswordFieldsReadonly);
    }

    let mut assignments = Vec::new();
    if let Some(field_index) = username_field_index {
        assignments.push(Assignment {
            field_index,
            credential: CredentialKind::Username,
        });
    }
    if let Some((field_index, _)) = password_field {
        assignments.push(Assignment {
            field_index,
            credential: CredentialKind::CurrentPassword,
        });
    }
    Ok(Plan { assignments })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Debug, PartialEq, Eq)]
    struct TestCredentials {
        username: &'static str,
        password: &'static str,
    }

    #[derive(Debug, PartialEq, Eq)]
    struct TestFilledField {
        field_index: field::Index,
        value: &'static str,
    }

    fn field(field_index: field::Index, role: field::CredentialRole) -> field::Observation {
        field::Credential {
            field_index,
            role,
            editability: field::Editability::Writable,
        }
        .into()
    }

    fn readonly_field(
        field_index: field::Index,
        role: field::CredentialRole,
    ) -> field::Observation {
        field::Credential {
            field_index,
            role,
            editability: field::Editability::Readonly,
        }
        .into()
    }

    fn new_password_field(field_index: field::Index) -> field::Observation {
        field::NewPassword::from(field_index).into()
    }

    fn one_time_code_field(field_index: field::Index) -> field::Observation {
        field::OneTimeCode::from(field_index).into()
    }

    fn login_form() -> Vec<field::Observation> {
        vec![
            field(field::Index::ZERO, field::CredentialRole::Username),
            field(
                field::Index::ONE,
                field::CredentialRole::Password(field::Password::Current),
            ),
        ]
    }

    #[test]
    fn plans_username_first_then_current_password() -> anyhow::Result<()> {
        let plan = plan(&login_form())?;
        assert_eq!(
            plan.assignments,
            vec![
                Assignment {
                    field_index: field::Index::ZERO,
                    credential: CredentialKind::Username,
                },
                Assignment {
                    field_index: field::Index::ONE,
                    credential: CredentialKind::CurrentPassword,
                },
            ]
        );
        Ok(())
    }

    #[test]
    fn plans_username_only_fill_for_identifier_step() -> anyhow::Result<()> {
        let username_only = vec![field(field::Index::TWO, field::CredentialRole::Username)];
        let plan = plan(&username_only)?;
        assert_eq!(
            plan.assignments,
            vec![Assignment {
                field_index: field::Index::TWO,
                credential: CredentialKind::Username,
            }]
        );
        Ok(())
    }

    #[test]
    fn plans_password_only_fill_for_password_step() -> anyhow::Result<()> {
        let password_only = vec![field(
            field::Index::ZERO,
            field::CredentialRole::Password(field::Password::Current),
        )];
        let plan = plan(&password_only)?;
        assert_eq!(
            plan.assignments,
            vec![Assignment {
                field_index: field::Index::ZERO,
                credential: CredentialKind::CurrentPassword,
            }]
        );
        Ok(())
    }

    #[test]
    fn plans_a_single_generic_password_as_a_login_password() -> anyhow::Result<()> {
        let generic_login = vec![
            field(field::Index::ZERO, field::CredentialRole::Username),
            field(
                field::Index::ONE,
                field::CredentialRole::Password(field::Password::Generic),
            ),
        ];
        let plan = plan(&generic_login)?;
        assert_eq!(
            plan.assignments,
            vec![
                Assignment {
                    field_index: field::Index::ZERO,
                    credential: CredentialKind::Username,
                },
                Assignment {
                    field_index: field::Index::ONE,
                    credential: CredentialKind::CurrentPassword,
                },
            ]
        );
        Ok(())
    }

    #[test]
    fn fails_closed_without_credential_fields() {
        assert_eq!(plan(&[]), Err(Error::NoCredentialField));
        let otp_only = vec![one_time_code_field(field::Index::ZERO)];
        assert_eq!(plan(&otp_only), Err(Error::OneTimeCodeFieldPresent));
        let new_password_only = vec![new_password_field(field::Index::ZERO)];
        assert_eq!(
            plan(&new_password_only),
            Err(Error::NewPasswordFieldPresent)
        );
    }

    #[test]
    fn fails_closed_when_all_password_fields_are_readonly() {
        let readonly_password = vec![readonly_field(
            field::Index::ZERO,
            field::CredentialRole::Password(field::Password::Current),
        )];
        assert_eq!(plan(&readonly_password), Err(Error::PasswordFieldsReadonly));
    }

    #[test]
    fn fails_closed_on_multiple_current_password_fields() {
        let ambiguous = vec![
            field(
                field::Index::ZERO,
                field::CredentialRole::Password(field::Password::Current),
            ),
            field(
                field::Index::ONE,
                field::CredentialRole::Password(field::Password::Current),
            ),
        ];
        assert_eq!(plan(&ambiguous), Err(Error::AmbiguousPasswordField));
    }

    #[test]
    fn fails_closed_on_mixed_or_multiple_login_password_fields() {
        for ambiguous in [
            vec![
                field(
                    field::Index::ZERO,
                    field::CredentialRole::Password(field::Password::Current),
                ),
                field(
                    field::Index::ONE,
                    field::CredentialRole::Password(field::Password::Generic),
                ),
            ],
            vec![
                field(
                    field::Index::ZERO,
                    field::CredentialRole::Password(field::Password::Generic),
                ),
                field(
                    field::Index::ONE,
                    field::CredentialRole::Password(field::Password::Generic),
                ),
            ],
        ] {
            assert_eq!(plan(&ambiguous), Err(Error::AmbiguousPasswordField));
        }
    }

    #[test]
    fn fails_closed_on_duplicate_field_indices() {
        let duplicate = vec![
            field(4.into(), field::CredentialRole::Username),
            field(
                4.into(),
                field::CredentialRole::Password(field::Password::Current),
            ),
        ];
        assert_eq!(plan(&duplicate), Err(Error::DuplicateFieldIndex));
    }

    #[test]
    fn fails_closed_before_scanning_an_oversized_scope() {
        let fields = vec![
            field(field::Index::ZERO, field::CredentialRole::Username);
            crate::MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT as usize + 1
        ];
        assert_eq!(plan(&fields), Err(Error::TooManyObservedFields));
    }

    #[test]
    fn fails_closed_on_multiple_writable_username_fields() {
        let ambiguous = vec![
            field(field::Index::ZERO, field::CredentialRole::Username),
            field(field::Index::ONE, field::CredentialRole::Username),
        ];
        assert_eq!(plan(&ambiguous), Err(Error::AmbiguousUsernameField));
    }

    #[test]
    fn rejects_unsafe_scope_before_planning_username_only_fill() {
        for (unsafe_field, expected) in [
            (
                new_password_field(field::Index::ONE),
                Error::NewPasswordFieldPresent,
            ),
            (
                one_time_code_field(field::Index::ONE),
                Error::OneTimeCodeFieldPresent,
            ),
        ] {
            let fields = vec![
                field(field::Index::ZERO, field::CredentialRole::Username),
                unsafe_field,
            ];
            assert_eq!(plan(&fields), Err(expected));
        }
    }

    #[test]
    fn skips_readonly_username_but_still_plans_password_fill() -> anyhow::Result<()> {
        let fields = vec![
            readonly_field(field::Index::ZERO, field::CredentialRole::Username),
            field(
                field::Index::ONE,
                field::CredentialRole::Password(field::Password::Current),
            ),
        ];
        let plan = plan(&fields)?;
        assert_eq!(
            plan.assignments,
            vec![Assignment {
                field_index: field::Index::ONE,
                credential: CredentialKind::CurrentPassword,
            }]
        );
        Ok(())
    }

    #[test]
    fn test_harness_applies_fake_credentials_to_the_plan() -> anyhow::Result<()> {
        let credentials = TestCredentials {
            username: "test-user@example.test",
            password: "correct-horse-battery-staple-1",
        };
        let plan = plan(&login_form())?;
        let simulated = plan
            .assignments
            .iter()
            .map(|assignment| TestFilledField {
                field_index: assignment.field_index,
                value: match assignment.credential {
                    CredentialKind::Username => credentials.username,
                    CredentialKind::CurrentPassword => credentials.password,
                },
            })
            .collect::<Vec<_>>();
        assert_eq!(
            simulated,
            vec![
                TestFilledField {
                    field_index: field::Index::ZERO,
                    value: credentials.username,
                },
                TestFilledField {
                    field_index: field::Index::ONE,
                    value: credentials.password,
                },
            ]
        );
        Ok(())
    }

    #[test]
    fn contract_serialization_preserves_rust_source_names() -> anyhow::Result<()> {
        for (value, expected) in [
            (CredentialKind::Username, r#""Username""#),
            (CredentialKind::CurrentPassword, r#""CurrentPassword""#),
        ] {
            assert_eq!(serde_json::to_string(&value)?, expected);
        }
        for (value, expected) in [
            (field::CredentialRole::Username, r#""Username""#),
            (
                field::CredentialRole::Password(field::Password::Current),
                r#"{"Password":"Current"}"#,
            ),
            (
                field::CredentialRole::Password(field::Password::Generic),
                r#"{"Password":"Generic"}"#,
            ),
        ] {
            assert_eq!(serde_json::to_string(&value)?, expected);
        }
        for (value, expected) in [
            (field::Editability::Writable, r#""Writable""#),
            (field::Editability::Readonly, r#""Readonly""#),
        ] {
            assert_eq!(serde_json::to_string(&value)?, expected);
        }
        for (value, expected) in [
            (Error::TooManyObservedFields, r#""TooManyObservedFields""#),
            (Error::DuplicateFieldIndex, r#""DuplicateFieldIndex""#),
            (
                Error::NewPasswordFieldPresent,
                r#""NewPasswordFieldPresent""#,
            ),
            (
                Error::OneTimeCodeFieldPresent,
                r#""OneTimeCodeFieldPresent""#,
            ),
            (Error::NoCredentialField, r#""NoCredentialField""#),
            (Error::PasswordFieldsReadonly, r#""PasswordFieldsReadonly""#),
            (Error::AmbiguousPasswordField, r#""AmbiguousPasswordField""#),
            (Error::AmbiguousUsernameField, r#""AmbiguousUsernameField""#),
        ] {
            assert_eq!(serde_json::to_string(&value)?, expected);
        }

        let observation = field(field::Index::ZERO, field::CredentialRole::Username);
        assert_eq!(
            serde_json::to_string(&field::Index::ZERO)?,
            r#"{"value":0}"#
        );
        assert_eq!(
            serde_json::to_string(&observation)?,
            r#"{"Credential":{"field_index":{"value":0},"role":"Username","editability":"Writable"}}"#
        );
        assert_eq!(
            serde_json::to_string(&new_password_field(field::Index::ONE))?,
            r#"{"NewPassword":{"field_index":{"value":1}}}"#
        );
        assert_eq!(
            serde_json::to_string(&one_time_code_field(field::Index::TWO))?,
            r#"{"OneTimeCode":{"field_index":{"value":2}}}"#
        );
        let plan = plan(&login_form())?;
        let serialized = serde_json::to_string(&plan)?;
        assert_eq!(
            serialized,
            r#"{"assignments":[{"field_index":{"value":0},"credential":"Username"},{"field_index":{"value":1},"credential":"CurrentPassword"}]}"#
        );
        let roundtrip: Plan = serde_json::from_str(&serialized)?;
        assert_eq!(roundtrip, plan);
        Ok(())
    }
}

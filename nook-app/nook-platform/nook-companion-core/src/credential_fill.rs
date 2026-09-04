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

/// Credential kind assigned to one field in a fill plan.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AuthenticationCredentialKind {
    Username,
    CurrentPassword,
}

/// Exactly one semantic role observed for a candidate field.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AuthenticationFillFieldRole {
    Username,
    CurrentPassword,
    GenericPassword,
    NewPassword,
    OneTimeCode,
}

/// Whether the host observed a candidate field as writable.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AuthenticationFillFieldEditability {
    Writable,
    Readonly,
}

/// Host-assigned identity for one field inside the observed scope.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuthenticationFillFieldIndex {
    pub value: u32,
}

impl AuthenticationFillFieldIndex {
    #[must_use]
    pub const fn new(value: u32) -> Self {
        Self { value }
    }
}

/// Host-observed identity for one candidate fill field.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuthenticationFillFieldObservation {
    /// Zero-based field index inside the observed scope, assigned by the host.
    pub field_index: AuthenticationFillFieldIndex,
    pub role: AuthenticationFillFieldRole,
    pub editability: AuthenticationFillFieldEditability,
}

/// Why a fill plan cannot be produced for the observed fields.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error, Serialize, Deserialize)]
pub enum AuthenticationCredentialFillError {
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
pub struct AuthenticationCredentialFillAssignment {
    pub field_index: AuthenticationFillFieldIndex,
    pub credential: AuthenticationCredentialKind,
}

/// A complete, host-executable fill plan.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuthenticationCredentialFillPlan {
    pub assignments: Vec<AuthenticationCredentialFillAssignment>,
}

impl AuthenticationFillFieldObservation {
    #[must_use]
    pub const fn is_credential_field(self) -> bool {
        matches!(
            self.role,
            AuthenticationFillFieldRole::Username
                | AuthenticationFillFieldRole::CurrentPassword
                | AuthenticationFillFieldRole::GenericPassword
        )
    }

    const fn is_writable(self) -> bool {
        matches!(
            self.editability,
            AuthenticationFillFieldEditability::Writable
        )
    }
}

/// Plan which observed fields receive the username and current password.
///
/// Mirrors the host's fill contract: fill the first username field, then a
/// sole current-password or generic-password field. A scope with only a
/// username field still plans a username fill; every other shape fails closed.
pub fn plan_authentication_credential_fill(
    fields: &[AuthenticationFillFieldObservation],
) -> Result<AuthenticationCredentialFillPlan, AuthenticationCredentialFillError> {
    if fields.len() > crate::MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT as usize {
        return Err(AuthenticationCredentialFillError::TooManyObservedFields);
    }
    for (offset, field) in fields.iter().enumerate() {
        if fields[..offset]
            .iter()
            .any(|candidate| candidate.field_index == field.field_index)
        {
            return Err(AuthenticationCredentialFillError::DuplicateFieldIndex);
        }
    }
    if fields
        .iter()
        .any(|field| matches!(field.role, AuthenticationFillFieldRole::NewPassword))
    {
        return Err(AuthenticationCredentialFillError::NewPasswordFieldPresent);
    }
    if fields
        .iter()
        .any(|field| matches!(field.role, AuthenticationFillFieldRole::OneTimeCode))
    {
        return Err(AuthenticationCredentialFillError::OneTimeCodeFieldPresent);
    }

    let writable_username_fields = fields
        .iter()
        .filter(|field| {
            matches!(field.role, AuthenticationFillFieldRole::Username) && field.is_writable()
        })
        .collect::<Vec<_>>();
    let password_fields: Vec<&AuthenticationFillFieldObservation> = fields
        .iter()
        .filter(|field| {
            matches!(
                field.role,
                AuthenticationFillFieldRole::CurrentPassword
                    | AuthenticationFillFieldRole::GenericPassword
            )
        })
        .collect();

    if writable_username_fields.len() > 1 {
        return Err(AuthenticationCredentialFillError::AmbiguousUsernameField);
    }
    let username_field = writable_username_fields.first().copied();
    if username_field.is_none() && password_fields.is_empty() {
        return Err(AuthenticationCredentialFillError::NoCredentialField);
    }
    if password_fields.len() > 1 {
        return Err(AuthenticationCredentialFillError::AmbiguousPasswordField);
    }
    let password_field = password_fields.first().copied();
    if password_field.is_some_and(|field| !field.is_writable()) {
        return Err(AuthenticationCredentialFillError::PasswordFieldsReadonly);
    }

    let mut assignments = Vec::new();
    if let Some(username) = username_field {
        assignments.push(AuthenticationCredentialFillAssignment {
            field_index: username.field_index,
            credential: AuthenticationCredentialKind::Username,
        });
    }
    if let Some(password) = password_field {
        assignments.push(AuthenticationCredentialFillAssignment {
            field_index: password.field_index,
            credential: AuthenticationCredentialKind::CurrentPassword,
        });
    }
    Ok(AuthenticationCredentialFillPlan { assignments })
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
        field_index: AuthenticationFillFieldIndex,
        value: &'static str,
    }

    fn field(
        field_index: u32,
        role: AuthenticationFillFieldRole,
    ) -> AuthenticationFillFieldObservation {
        AuthenticationFillFieldObservation {
            field_index: AuthenticationFillFieldIndex::new(field_index),
            role,
            editability: AuthenticationFillFieldEditability::Writable,
        }
    }

    fn readonly_field(
        field_index: u32,
        role: AuthenticationFillFieldRole,
    ) -> AuthenticationFillFieldObservation {
        AuthenticationFillFieldObservation {
            field_index: AuthenticationFillFieldIndex::new(field_index),
            role,
            editability: AuthenticationFillFieldEditability::Readonly,
        }
    }

    fn login_form() -> Vec<AuthenticationFillFieldObservation> {
        vec![
            field(0, AuthenticationFillFieldRole::Username),
            field(1, AuthenticationFillFieldRole::CurrentPassword),
        ]
    }

    #[test]
    fn plans_username_first_then_current_password() -> anyhow::Result<()> {
        let plan = plan_authentication_credential_fill(&login_form())?;
        assert_eq!(
            plan.assignments,
            vec![
                AuthenticationCredentialFillAssignment {
                    field_index: AuthenticationFillFieldIndex::new(0),
                    credential: AuthenticationCredentialKind::Username,
                },
                AuthenticationCredentialFillAssignment {
                    field_index: AuthenticationFillFieldIndex::new(1),
                    credential: AuthenticationCredentialKind::CurrentPassword,
                },
            ]
        );
        Ok(())
    }

    #[test]
    fn plans_username_only_fill_for_identifier_step() -> anyhow::Result<()> {
        let username_only = vec![field(2, AuthenticationFillFieldRole::Username)];
        let plan = plan_authentication_credential_fill(&username_only)?;
        assert_eq!(
            plan.assignments,
            vec![AuthenticationCredentialFillAssignment {
                field_index: AuthenticationFillFieldIndex::new(2),
                credential: AuthenticationCredentialKind::Username,
            }]
        );
        Ok(())
    }

    #[test]
    fn plans_password_only_fill_for_password_step() -> anyhow::Result<()> {
        let password_only = vec![field(0, AuthenticationFillFieldRole::CurrentPassword)];
        let plan = plan_authentication_credential_fill(&password_only)?;
        assert_eq!(
            plan.assignments,
            vec![AuthenticationCredentialFillAssignment {
                field_index: AuthenticationFillFieldIndex::new(0),
                credential: AuthenticationCredentialKind::CurrentPassword,
            }]
        );
        Ok(())
    }

    #[test]
    fn plans_a_single_generic_password_as_a_login_password() -> anyhow::Result<()> {
        let generic_login = vec![
            field(0, AuthenticationFillFieldRole::Username),
            field(1, AuthenticationFillFieldRole::GenericPassword),
        ];
        let plan = plan_authentication_credential_fill(&generic_login)?;
        assert_eq!(
            plan.assignments,
            vec![
                AuthenticationCredentialFillAssignment {
                    field_index: AuthenticationFillFieldIndex::new(0),
                    credential: AuthenticationCredentialKind::Username,
                },
                AuthenticationCredentialFillAssignment {
                    field_index: AuthenticationFillFieldIndex::new(1),
                    credential: AuthenticationCredentialKind::CurrentPassword,
                },
            ]
        );
        Ok(())
    }

    #[test]
    fn fails_closed_without_credential_fields() {
        assert_eq!(
            plan_authentication_credential_fill(&[]),
            Err(AuthenticationCredentialFillError::NoCredentialField)
        );
        let otp_only = vec![field(0, AuthenticationFillFieldRole::OneTimeCode)];
        assert_eq!(
            plan_authentication_credential_fill(&otp_only),
            Err(AuthenticationCredentialFillError::OneTimeCodeFieldPresent)
        );
        let new_password_only = vec![field(0, AuthenticationFillFieldRole::NewPassword)];
        assert_eq!(
            plan_authentication_credential_fill(&new_password_only),
            Err(AuthenticationCredentialFillError::NewPasswordFieldPresent)
        );
    }

    #[test]
    fn fails_closed_when_all_password_fields_are_readonly() {
        let readonly_password = vec![readonly_field(
            0,
            AuthenticationFillFieldRole::CurrentPassword,
        )];
        assert_eq!(
            plan_authentication_credential_fill(&readonly_password),
            Err(AuthenticationCredentialFillError::PasswordFieldsReadonly)
        );
    }

    #[test]
    fn fails_closed_on_multiple_current_password_fields() {
        let ambiguous = vec![
            field(0, AuthenticationFillFieldRole::CurrentPassword),
            field(1, AuthenticationFillFieldRole::CurrentPassword),
        ];
        assert_eq!(
            plan_authentication_credential_fill(&ambiguous),
            Err(AuthenticationCredentialFillError::AmbiguousPasswordField)
        );
    }

    #[test]
    fn fails_closed_on_mixed_or_multiple_login_password_fields() {
        for ambiguous in [
            vec![
                field(0, AuthenticationFillFieldRole::CurrentPassword),
                field(1, AuthenticationFillFieldRole::GenericPassword),
            ],
            vec![
                field(0, AuthenticationFillFieldRole::GenericPassword),
                field(1, AuthenticationFillFieldRole::GenericPassword),
            ],
        ] {
            assert_eq!(
                plan_authentication_credential_fill(&ambiguous),
                Err(AuthenticationCredentialFillError::AmbiguousPasswordField)
            );
        }
    }

    #[test]
    fn fails_closed_on_duplicate_field_indices() {
        let duplicate = vec![
            field(4, AuthenticationFillFieldRole::Username),
            field(4, AuthenticationFillFieldRole::CurrentPassword),
        ];
        assert_eq!(
            plan_authentication_credential_fill(&duplicate),
            Err(AuthenticationCredentialFillError::DuplicateFieldIndex)
        );
    }

    #[test]
    fn fails_closed_before_scanning_an_oversized_scope() {
        let fields = vec![
            field(0, AuthenticationFillFieldRole::Username);
            crate::MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT as usize + 1
        ];
        assert_eq!(
            plan_authentication_credential_fill(&fields),
            Err(AuthenticationCredentialFillError::TooManyObservedFields)
        );
    }

    #[test]
    fn fails_closed_on_multiple_writable_username_fields() {
        let ambiguous = vec![
            field(0, AuthenticationFillFieldRole::Username),
            field(1, AuthenticationFillFieldRole::Username),
        ];
        assert_eq!(
            plan_authentication_credential_fill(&ambiguous),
            Err(AuthenticationCredentialFillError::AmbiguousUsernameField)
        );
    }

    #[test]
    fn rejects_unsafe_scope_before_planning_username_only_fill() {
        for (role, expected) in [
            (
                AuthenticationFillFieldRole::NewPassword,
                AuthenticationCredentialFillError::NewPasswordFieldPresent,
            ),
            (
                AuthenticationFillFieldRole::OneTimeCode,
                AuthenticationCredentialFillError::OneTimeCodeFieldPresent,
            ),
        ] {
            let fields = vec![
                field(0, AuthenticationFillFieldRole::Username),
                field(1, role),
            ];
            assert_eq!(plan_authentication_credential_fill(&fields), Err(expected));
        }
    }

    #[test]
    fn skips_readonly_username_but_still_plans_password_fill() -> anyhow::Result<()> {
        let fields = vec![
            readonly_field(0, AuthenticationFillFieldRole::Username),
            field(1, AuthenticationFillFieldRole::CurrentPassword),
        ];
        let plan = plan_authentication_credential_fill(&fields)?;
        assert_eq!(
            plan.assignments,
            vec![AuthenticationCredentialFillAssignment {
                field_index: AuthenticationFillFieldIndex::new(1),
                credential: AuthenticationCredentialKind::CurrentPassword,
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
        let plan = plan_authentication_credential_fill(&login_form())?;
        let simulated = plan
            .assignments
            .iter()
            .map(|assignment| TestFilledField {
                field_index: assignment.field_index,
                value: match assignment.credential {
                    AuthenticationCredentialKind::Username => credentials.username,
                    AuthenticationCredentialKind::CurrentPassword => credentials.password,
                },
            })
            .collect::<Vec<_>>();
        assert_eq!(
            simulated,
            vec![
                TestFilledField {
                    field_index: AuthenticationFillFieldIndex::new(0),
                    value: credentials.username,
                },
                TestFilledField {
                    field_index: AuthenticationFillFieldIndex::new(1),
                    value: credentials.password,
                },
            ]
        );
        Ok(())
    }

    #[test]
    fn contract_serialization_preserves_rust_source_names() -> anyhow::Result<()> {
        for (value, expected) in [
            (AuthenticationCredentialKind::Username, r#""Username""#),
            (
                AuthenticationCredentialKind::CurrentPassword,
                r#""CurrentPassword""#,
            ),
        ] {
            assert_eq!(serde_json::to_string(&value)?, expected);
        }
        for (value, expected) in [
            (AuthenticationFillFieldRole::Username, r#""Username""#),
            (
                AuthenticationFillFieldRole::CurrentPassword,
                r#""CurrentPassword""#,
            ),
            (
                AuthenticationFillFieldRole::GenericPassword,
                r#""GenericPassword""#,
            ),
            (AuthenticationFillFieldRole::NewPassword, r#""NewPassword""#),
            (AuthenticationFillFieldRole::OneTimeCode, r#""OneTimeCode""#),
        ] {
            assert_eq!(serde_json::to_string(&value)?, expected);
        }
        for (value, expected) in [
            (
                AuthenticationFillFieldEditability::Writable,
                r#""Writable""#,
            ),
            (
                AuthenticationFillFieldEditability::Readonly,
                r#""Readonly""#,
            ),
        ] {
            assert_eq!(serde_json::to_string(&value)?, expected);
        }
        for (value, expected) in [
            (
                AuthenticationCredentialFillError::TooManyObservedFields,
                r#""TooManyObservedFields""#,
            ),
            (
                AuthenticationCredentialFillError::DuplicateFieldIndex,
                r#""DuplicateFieldIndex""#,
            ),
            (
                AuthenticationCredentialFillError::NewPasswordFieldPresent,
                r#""NewPasswordFieldPresent""#,
            ),
            (
                AuthenticationCredentialFillError::OneTimeCodeFieldPresent,
                r#""OneTimeCodeFieldPresent""#,
            ),
            (
                AuthenticationCredentialFillError::NoCredentialField,
                r#""NoCredentialField""#,
            ),
            (
                AuthenticationCredentialFillError::PasswordFieldsReadonly,
                r#""PasswordFieldsReadonly""#,
            ),
            (
                AuthenticationCredentialFillError::AmbiguousPasswordField,
                r#""AmbiguousPasswordField""#,
            ),
            (
                AuthenticationCredentialFillError::AmbiguousUsernameField,
                r#""AmbiguousUsernameField""#,
            ),
        ] {
            assert_eq!(serde_json::to_string(&value)?, expected);
        }

        let observation = field(0, AuthenticationFillFieldRole::Username);
        assert_eq!(
            serde_json::to_string(&AuthenticationFillFieldIndex::new(0))?,
            r#"{"value":0}"#
        );
        assert_eq!(
            serde_json::to_string(&observation)?,
            r#"{"field_index":{"value":0},"role":"Username","editability":"Writable"}"#
        );
        let plan = plan_authentication_credential_fill(&login_form())?;
        let serialized = serde_json::to_string(&plan)?;
        assert_eq!(
            serialized,
            r#"{"assignments":[{"field_index":{"value":0},"credential":"Username"},{"field_index":{"value":1},"credential":"CurrentPassword"}]}"#
        );
        let roundtrip: AuthenticationCredentialFillPlan = serde_json::from_str(&serialized)?;
        assert_eq!(roundtrip, plan);
        Ok(())
    }
}

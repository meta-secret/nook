//! Portable credential-fill planning from validated field observations.
//!
//! The browser adapter reports only structural, non-secret field facts and
//! receives a typed fill plan in return. DOM lookup, value assignment, focus,
//! and submission stay in the host adapter; this module owns which field
//! receives which credential kind and which plans are safe to execute.
//!
//! `simulate_authentication_credential_fill` consumes the same observations
//! through the same planner, so deterministic zero-vault simulations exercise
//! the exact fill decision the extension performs on a live page.

use serde::{Deserialize, Serialize};
use tsify::Tsify;

/// Credential kind assigned to one field in a fill plan.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum AuthenticationCredentialKind {
    Username,
    CurrentPassword,
}

/// Exactly one semantic role observed for a candidate field.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum AuthenticationFillFieldRole {
    Username,
    CurrentPassword,
    GenericPassword,
    NewPassword,
    OneTimeCode,
}

/// Whether the host observed a candidate field as writable.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum AuthenticationFillFieldEditability {
    Writable,
    Readonly,
}

/// Host-observed identity for one candidate fill field.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct AuthenticationFillFieldObservation {
    /// Zero-based field index inside the observed scope, assigned by the host.
    pub field_index: u32,
    pub role: AuthenticationFillFieldRole,
    pub editability: AuthenticationFillFieldEditability,
}

/// Why a fill plan cannot be produced for the observed fields.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum AuthenticationCredentialFillError {
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
}

/// Rust-owned decision for which field receives which credential kind.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct AuthenticationCredentialFillAssignment {
    pub field_index: u32,
    pub credential: AuthenticationCredentialKind,
}

/// A complete, host-executable fill plan.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
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

    let username_field = fields.iter().find(|field| {
        matches!(field.role, AuthenticationFillFieldRole::Username) && field.is_writable()
    });
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

/// Caller-supplied credentials for deterministic zero-vault simulations.
///
/// Tests supply fake values so simulations and host wiring can be exercised
/// without a vault. Production credential disclosure continues to flow through
/// the extension's vault runtime messages.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct SimulatedAuthenticationCredentials {
    pub username: String,
    pub password: String,
}

/// One simulated field state after a deterministic fill.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct SimulatedAuthenticationFieldState {
    pub field_index: u32,
    pub filled_with: String,
}

/// The outcome of one simulated credential fill.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct SimulatedAuthenticationFill {
    pub assignments: Vec<SimulatedAuthenticationFieldState>,
}

impl SimulatedAuthenticationCredentials {
    fn value_for(&self, credential: AuthenticationCredentialKind) -> &str {
        match credential {
            AuthenticationCredentialKind::Username => &self.username,
            AuthenticationCredentialKind::CurrentPassword => &self.password,
        }
    }
}

/// Deterministically apply supplied credentials to the planned fields.
///
/// Returns the assignment values in plan order. The simulation caller supplies
/// its own credentials so fill behavior can be verified with hardcoded fake
/// values and no vault.
pub fn simulate_authentication_credential_fill(
    fields: &[AuthenticationFillFieldObservation],
    credentials: &SimulatedAuthenticationCredentials,
) -> Result<SimulatedAuthenticationFill, AuthenticationCredentialFillError> {
    let plan = plan_authentication_credential_fill(fields)?;
    let assignments = plan
        .assignments
        .iter()
        .map(|assignment| SimulatedAuthenticationFieldState {
            field_index: assignment.field_index,
            filled_with: credentials.value_for(assignment.credential).to_owned(),
        })
        .collect();
    Ok(SimulatedAuthenticationFill { assignments })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn field(
        field_index: u32,
        role: AuthenticationFillFieldRole,
    ) -> AuthenticationFillFieldObservation {
        AuthenticationFillFieldObservation {
            field_index,
            role,
            editability: AuthenticationFillFieldEditability::Writable,
        }
    }

    fn readonly_field(
        field_index: u32,
        role: AuthenticationFillFieldRole,
    ) -> AuthenticationFillFieldObservation {
        AuthenticationFillFieldObservation {
            field_index,
            role,
            editability: AuthenticationFillFieldEditability::Readonly,
        }
    }

    fn fixture_credentials() -> SimulatedAuthenticationCredentials {
        SimulatedAuthenticationCredentials {
            username: "test-user@example.test".to_owned(),
            password: "correct-horse-battery-staple-1".to_owned(),
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
                    field_index: 0,
                    credential: AuthenticationCredentialKind::Username,
                },
                AuthenticationCredentialFillAssignment {
                    field_index: 1,
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
                field_index: 2,
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
                field_index: 0,
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
                    field_index: 0,
                    credential: AuthenticationCredentialKind::Username,
                },
                AuthenticationCredentialFillAssignment {
                    field_index: 1,
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
                field_index: 1,
                credential: AuthenticationCredentialKind::CurrentPassword,
            }]
        );
        Ok(())
    }

    #[test]
    fn simulation_applies_fixture_credentials_in_plan_order() -> anyhow::Result<()> {
        let credentials = fixture_credentials();
        let simulated = simulate_authentication_credential_fill(&login_form(), &credentials)?;
        assert_eq!(
            simulated.assignments,
            vec![
                SimulatedAuthenticationFieldState {
                    field_index: 0,
                    filled_with: credentials.username.clone(),
                },
                SimulatedAuthenticationFieldState {
                    field_index: 1,
                    filled_with: credentials.password.clone(),
                },
            ]
        );
        Ok(())
    }

    #[test]
    fn simulation_propagates_planner_failures() {
        assert_eq!(
            simulate_authentication_credential_fill(&[], &fixture_credentials()),
            Err(AuthenticationCredentialFillError::NoCredentialField)
        );
    }

    #[test]
    fn simulation_reflects_custom_credentials() -> anyhow::Result<()> {
        let credentials = SimulatedAuthenticationCredentials {
            username: "custom-user".to_owned(),
            password: "custom-password".to_owned(),
        };
        let simulated =
            simulate_authentication_credential_fill(&login_form().clone(), &credentials)?;
        assert_eq!(simulated.assignments[0].filled_with, "custom-user");
        assert_eq!(simulated.assignments[1].filled_with, "custom-password");
        Ok(())
    }

    #[test]
    fn plan_roundtrips_through_serialization() -> anyhow::Result<()> {
        let plan = plan_authentication_credential_fill(&login_form())?;
        let serialized = serde_json::to_string(&plan)?;
        let roundtrip: AuthenticationCredentialFillPlan = serde_json::from_str(&serialized)?;
        assert_eq!(roundtrip, plan);
        Ok(())
    }
}

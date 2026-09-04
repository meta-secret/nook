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

/// Host-observed identity for one candidate fill field.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
#[allow(clippy::struct_excessive_bools)] // Typed WASM policy boundary mirrors the browser field facts.
pub struct AuthenticationFillFieldObservation {
    /// Zero-based field index inside the observed scope, assigned by the host.
    pub field_index: u32,
    pub username: bool,
    pub current_password: bool,
    pub new_password: bool,
    pub one_time_code: bool,
    pub readonly: bool,
}

/// Why a fill plan cannot be produced for the observed fields.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum AuthenticationCredentialFillError {
    /// No field in the observed scope can receive credentials.
    #[error("no field in the observed scope can receive credentials")]
    NoCredentialField,
    /// Every password field is read-only, so credential disclosure is blocked.
    #[error("every password field is read-only, so credential disclosure is blocked")]
    PasswordFieldsReadonly,
    /// The scope contains multiple password fields that cannot be resolved
    /// into one current-password target.
    #[error("the observed scope has multiple current-password fields")]
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
        self.username || self.current_password
    }
}

/// Plan which observed fields receive the username and current password.
///
/// Mirrors the host's fill contract: fill the first username field, then the
/// first current-password field; a scope with only a username field still
/// plans a username fill; every other shape fails closed.
pub fn plan_authentication_credential_fill(
    fields: &[AuthenticationFillFieldObservation],
) -> Result<AuthenticationCredentialFillPlan, AuthenticationCredentialFillError> {
    let username_field = fields
        .iter()
        .find(|field| field.username && !field.readonly);
    let password_fields: Vec<&AuthenticationFillFieldObservation> = fields
        .iter()
        .filter(|field| field.current_password)
        .collect();
    let readonly_password_fields = password_fields
        .iter()
        .filter(|field| field.readonly)
        .count();
    let writable_password_fields = password_fields.len() - readonly_password_fields;
    let current_password_fields = password_fields
        .iter()
        .filter(|field| !field.readonly)
        .collect::<Vec<_>>();

    if username_field.is_none() && password_fields.is_empty() {
        return Err(AuthenticationCredentialFillError::NoCredentialField);
    }
    if !password_fields.is_empty() && writable_password_fields == 0 {
        return Err(AuthenticationCredentialFillError::PasswordFieldsReadonly);
    }
    if current_password_fields.len() > 1 {
        return Err(AuthenticationCredentialFillError::AmbiguousPasswordField);
    }

    let mut assignments = Vec::new();
    if let Some(username) = username_field {
        assignments.push(AuthenticationCredentialFillAssignment {
            field_index: username.field_index,
            credential: AuthenticationCredentialKind::Username,
        });
    }
    if let Some(password) = current_password_fields.first() {
        assignments.push(AuthenticationCredentialFillAssignment {
            field_index: password.field_index,
            credential: AuthenticationCredentialKind::CurrentPassword,
        });
    }
    Ok(AuthenticationCredentialFillPlan { assignments })
}

/// Non-secret fixture credentials for deterministic zero-vault simulations.
///
/// The values are fake and exist only so simulations and host wiring can be
/// exercised without a vault; production credential disclosure continues to
/// flow through the extension's vault runtime messages.
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
    /// Build the canonical deterministic simulation credential pair.
    #[must_use]
    pub fn fixture() -> Self {
        Self {
            username: "test-user@example.test".to_owned(),
            password: "correct-horse-battery-staple-1".to_owned(),
        }
    }

    fn value_for(&self, credential: AuthenticationCredentialKind) -> &str {
        match credential {
            AuthenticationCredentialKind::Username => &self.username,
            AuthenticationCredentialKind::CurrentPassword => &self.password,
        }
    }
}

/// Deterministically apply fixture credentials to the planned fields.
///
/// Returns the assignment values in plan order. The caller supplies its own
/// credentials in production; the simulation path exists so fill behavior can
/// be verified with hardcoded fake values and no vault.
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

    fn field(field_index: u32) -> AuthenticationFillFieldObservation {
        AuthenticationFillFieldObservation {
            field_index,
            ..Default::default()
        }
    }

    fn login_form() -> Vec<AuthenticationFillFieldObservation> {
        vec![
            AuthenticationFillFieldObservation {
                field_index: 0,
                username: true,
                ..field(0)
            },
            AuthenticationFillFieldObservation {
                field_index: 1,
                current_password: true,
                ..field(1)
            },
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
        let username_only = vec![AuthenticationFillFieldObservation {
            field_index: 2,
            username: true,
            ..field(2)
        }];
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
        let password_only = vec![AuthenticationFillFieldObservation {
            field_index: 0,
            current_password: true,
            ..field(0)
        }];
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
    fn fails_closed_without_credential_fields() {
        assert_eq!(
            plan_authentication_credential_fill(&[]),
            Err(AuthenticationCredentialFillError::NoCredentialField)
        );
        let otp_only = vec![AuthenticationFillFieldObservation {
            field_index: 0,
            one_time_code: true,
            ..field(0)
        }];
        assert_eq!(
            plan_authentication_credential_fill(&otp_only),
            Err(AuthenticationCredentialFillError::NoCredentialField)
        );
        let new_password_only = vec![AuthenticationFillFieldObservation {
            field_index: 0,
            new_password: true,
            ..field(0)
        }];
        assert_eq!(
            plan_authentication_credential_fill(&new_password_only),
            Err(AuthenticationCredentialFillError::NoCredentialField)
        );
    }

    #[test]
    fn fails_closed_when_all_password_fields_are_readonly() {
        let readonly_password = vec![AuthenticationFillFieldObservation {
            field_index: 0,
            current_password: true,
            readonly: true,
            ..field(0)
        }];
        assert_eq!(
            plan_authentication_credential_fill(&readonly_password),
            Err(AuthenticationCredentialFillError::PasswordFieldsReadonly)
        );
    }

    #[test]
    fn fails_closed_on_multiple_current_password_fields() {
        let ambiguous = vec![
            AuthenticationFillFieldObservation {
                field_index: 0,
                current_password: true,
                ..field(0)
            },
            AuthenticationFillFieldObservation {
                field_index: 1,
                current_password: true,
                ..field(1)
            },
        ];
        assert_eq!(
            plan_authentication_credential_fill(&ambiguous),
            Err(AuthenticationCredentialFillError::AmbiguousPasswordField)
        );
    }

    #[test]
    fn skips_readonly_username_but_still_plans_password_fill() -> anyhow::Result<()> {
        let fields = vec![
            AuthenticationFillFieldObservation {
                field_index: 0,
                username: true,
                readonly: true,
                ..field(0)
            },
            AuthenticationFillFieldObservation {
                field_index: 1,
                current_password: true,
                ..field(1)
            },
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
        let credentials = SimulatedAuthenticationCredentials::fixture();
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
            simulate_authentication_credential_fill(&[], &SimulatedAuthenticationCredentials::fixture()),
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

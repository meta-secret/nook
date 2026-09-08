use super::*;
use crate::credential_fill::{self, field};

#[test]
fn preflight_rejects_fresh_field_drift() -> anyhow::Result<()> {
    let initial = OmittedMethodDisclosureScenario::facts(PageControlActionability::Inert);
    let fields = OmittedMethodDisclosureScenario::fields();
    let mutations: &[fn(&mut Vec<field::Observation>)] = &[
        // Username became readonly.
        |value| {
            value[0] = OmittedMethodDisclosureScenario::field(
                field::Index::ZERO,
                field::CredentialRole::Username,
                field::Editability::Readonly,
            );
        },
        // Username role changed.
        |value| {
            value[0] = OmittedMethodDisclosureScenario::field(
                field::Index::ZERO,
                field::CredentialRole::Password(field::Password::Current),
                field::Editability::Writable,
            );
        },
        // Username index changed.
        |value| {
            value[0] = OmittedMethodDisclosureScenario::field(
                field::Index::TWO,
                field::CredentialRole::Username,
                field::Editability::Writable,
            );
        },
        // Username and password indices swapped.
        |value| {
            value[0] = OmittedMethodDisclosureScenario::field(
                field::Index::ONE,
                field::CredentialRole::Username,
                field::Editability::Writable,
            );
            value[1] = OmittedMethodDisclosureScenario::field(
                field::Index::ZERO,
                field::CredentialRole::Password(field::Password::Current),
                field::Editability::Writable,
            );
        },
        // Password reused the username index.
        |value| {
            value[1] = OmittedMethodDisclosureScenario::field(
                field::Index::ZERO,
                field::CredentialRole::Password(field::Password::Current),
                field::Editability::Writable,
            );
        },
        // Password field disappeared.
        |value| {
            value.pop();
        },
        // An extra username field appeared.
        |value| {
            value.push(OmittedMethodDisclosureScenario::field(
                field::Index::TWO,
                field::CredentialRole::Username,
                field::Editability::Writable,
            ));
        },
    ];
    for mutation in mutations {
        let mut changed = fields.to_vec();
        mutation(&mut changed);
        assert!(matches!(
            OmittedMethodDisclosureScenario::planned()?.preflight(
                &AuthenticationCredentialDisclosurePreflightRequest {
                    fresh_facts: &initial,
                    fields: &changed,
                }
            ),
            Err(
                AuthenticationCredentialDisclosureRejection::CredentialFieldsRejected(_)
                    | AuthenticationCredentialDisclosureRejection::CredentialFieldsNotExact
                    | AuthenticationCredentialDisclosureRejection::CredentialAssignmentsChanged
            )
        ));
    }
    Ok(())
}

#[test]
fn duplicate_field_failure_preserves_typed_source() -> anyhow::Result<()> {
    let initial = OmittedMethodDisclosureScenario::facts(PageControlActionability::Inert);
    let fields = OmittedMethodDisclosureScenario::fields();
    let duplicate = [
        fields[0],
        OmittedMethodDisclosureScenario::field(
            field::Index::ZERO,
            field::CredentialRole::Password(field::Password::Current),
            field::Editability::Writable,
        ),
    ];
    assert!(matches!(
        OmittedMethodDisclosureScenario::planned()?.preflight(
            &AuthenticationCredentialDisclosurePreflightRequest {
                fresh_facts: &initial,
                fields: &duplicate,
            }
        ),
        Err(
            AuthenticationCredentialDisclosureRejection::CredentialFieldsRejected(
                credential_fill::CredentialFillRejection::DuplicateFieldIndex
            )
        )
    ));
    Ok(())
}

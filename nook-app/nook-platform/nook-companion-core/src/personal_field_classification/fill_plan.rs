//! Scope-wide personal fill planning anchored on the focused field.
//!
//! The host adds every input of the focused field's form scope in document
//! order; the position of each addition is its [`field::Index`]. Rust
//! classifies every field, selects the focused field's record group, and
//! returns the fields of that group. A kind recognized only from identity
//! words joins a plan at most once; explicitly tokenized fields always join.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use tsify::Tsify;

use super::{
    ClassifiedPersonalField, PersonalFieldClassification, PersonalFieldEvidence,
    PersonalFieldGroup, PersonalFieldKind,
};
use crate::PageInputFieldObservation;
use crate::credential_fill::field;

/// One planned field and the personal value it receives.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
pub struct PersonalFillField {
    #[tsify(type = "{ value: number }")]
    pub index: field::Index,
    #[tsify(type = "keyof typeof PersonalFieldKind")]
    pub kind: PersonalFieldKind,
}

/// Host-executable personal fill plan for one record group.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
pub struct PersonalFillPlan {
    #[tsify(type = "keyof typeof PersonalFieldGroup")]
    pub group: PersonalFieldGroup,
    pub fields: Vec<PersonalFillField>,
}

/// Why the focused field offers no personal fill.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
pub enum PersonalFillUnavailability {
    /// The host marked no field of the scope as focused.
    FocusedFieldMissing,
    /// The host marked more than one field of the scope as focused.
    MultipleFocusedFields,
    /// The scope exceeds the portable observed-field limit.
    TooManyObservedFields,
    /// The focused field accepts no personal value.
    FocusedFieldUnclassified,
}

/// Whether the focused field offers a personal fill, and its plan.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
pub enum PersonalFillOpportunity {
    Unavailable(PersonalFillUnavailability),
    Available(PersonalFillPlan),
}

/// Whether the host reported a scope field as the focused field.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FieldFocus {
    Focused,
    Unfocused,
}

/// One observed scope field and its focus.
#[derive(Debug, Clone, PartialEq, Eq)]
struct ScopeField {
    observation: PageInputFieldObservation,
    focus: FieldFocus,
}

/// Observed inputs of the focused field's form scope, in document order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PersonalFillScope {
    fields: Vec<ScopeField>,
}

impl Default for PersonalFillScope {
    fn default() -> Self {
        Self::new()
    }
}

/// A classified scope field with its host index.
struct IndexedPersonalField {
    index: field::Index,
    field: ClassifiedPersonalField,
}

impl PersonalFillScope {
    #[must_use]
    pub const fn new() -> Self {
        Self { fields: Vec::new() }
    }

    /// Add the next unfocused scope field.
    #[must_use]
    pub fn with_field(mut self, observation: PageInputFieldObservation) -> Self {
        self.fields.push(ScopeField {
            observation,
            focus: FieldFocus::Unfocused,
        });
        self
    }

    /// Add the next scope field and mark it as the focused field.
    #[must_use]
    pub fn with_focused_field(mut self, observation: PageInputFieldObservation) -> Self {
        self.fields.push(ScopeField {
            observation,
            focus: FieldFocus::Focused,
        });
        self
    }

    /// Plan the focused field's record group across the scope.
    #[must_use]
    pub fn plan(&self) -> PersonalFillOpportunity {
        match u32::try_from(self.fields.len()) {
            Ok(count) if count <= u32::from(field::Count::MAXIMUM) => {}
            Ok(_) | Err(_) => {
                return PersonalFillOpportunity::Unavailable(
                    PersonalFillUnavailability::TooManyObservedFields,
                );
            }
        }
        let focused_indices = self
            .fields
            .iter()
            .zip(0_u32..)
            .filter_map(|(scope_field, position)| match scope_field.focus {
                FieldFocus::Focused => Some(field::Index::from(position)),
                FieldFocus::Unfocused => None,
            })
            .collect::<Vec<_>>();
        let focused_index = match focused_indices.as_slice() {
            [index] => *index,
            [] => {
                return PersonalFillOpportunity::Unavailable(
                    PersonalFillUnavailability::FocusedFieldMissing,
                );
            }
            [_, _, ..] => {
                return PersonalFillOpportunity::Unavailable(
                    PersonalFillUnavailability::MultipleFocusedFields,
                );
            }
        };
        let classified = self.classified_fields();
        let Some(focused) = classified
            .iter()
            .find(|candidate| candidate.index == focused_index)
            .map(|candidate| candidate.field)
        else {
            return PersonalFillOpportunity::Unavailable(
                PersonalFillUnavailability::FocusedFieldUnclassified,
            );
        };
        PersonalFillOpportunity::Available(PersonalFillPlan::from_group_fields(GroupFields {
            focused_index,
            focused,
            classified,
        }))
    }

    fn classified_fields(&self) -> Vec<IndexedPersonalField> {
        self.fields
            .iter()
            .zip(0_u32..)
            .filter_map(
                |(scope_field, position)| match PersonalFieldClassification::from_page_input(
                    &scope_field.observation,
                ) {
                    PersonalFieldClassification::Classified(field) => Some(IndexedPersonalField {
                        index: field::Index::from(position),
                        field,
                    }),
                    PersonalFieldClassification::Unclassified => None,
                },
            )
            .collect()
    }
}

/// Classified scope fields anchored on the focused field.
struct GroupFields {
    focused_index: field::Index,
    focused: ClassifiedPersonalField,
    classified: Vec<IndexedPersonalField>,
}

impl PersonalFillPlan {
    fn from_group_fields(scope: GroupFields) -> Self {
        let GroupFields {
            focused_index,
            focused,
            classified,
        } = scope;
        let group = focused.group;
        let group_fields = classified
            .into_iter()
            .filter(|candidate| candidate.field.group == group)
            .collect::<Vec<_>>();
        let mut claimed_kinds = group_fields
            .iter()
            .filter_map(|candidate| match candidate.field.evidence {
                PersonalFieldEvidence::Autocomplete => Some(candidate.field.kind),
                PersonalFieldEvidence::IdentityText => None,
            })
            .collect::<HashSet<_>>();
        claimed_kinds.insert(focused.kind);
        let fields = group_fields
            .into_iter()
            .filter(|candidate| {
                match (candidate.index == focused_index, candidate.field.evidence) {
                    (true, _) | (false, PersonalFieldEvidence::Autocomplete) => true,
                    (false, PersonalFieldEvidence::IdentityText) => {
                        claimed_kinds.insert(candidate.field.kind)
                    }
                }
            })
            .map(|candidate| PersonalFillField {
                index: candidate.index,
                kind: candidate.field.kind,
            })
            .collect();
        Self { group, fields }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{OneTimeCodeEntryEvidence, PageInputType, PageLoginContext};

    struct InputFixture;

    impl InputFixture {
        fn text(identity_text: &str) -> PageInputFieldObservation {
            PageInputFieldObservation {
                input_type: PageInputType::Text,
                disabled: false,
                read_only: false,
                autocomplete_tokens: Vec::new(),
                identity_text: identity_text.to_owned(),
                login_context: PageLoginContext::Unrelated,
                one_time_code_entry: OneTimeCodeEntryEvidence::Unobserved,
            }
        }

        fn tokens(tokens: &[&str]) -> PageInputFieldObservation {
            PageInputFieldObservation {
                autocomplete_tokens: tokens.iter().map(|token| (*token).to_owned()).collect(),
                ..Self::text("field")
            }
        }

        fn password() -> PageInputFieldObservation {
            PageInputFieldObservation {
                input_type: PageInputType::Password,
                ..Self::tokens(&["new-password"])
            }
        }
    }

    fn planned(index: u32, kind: PersonalFieldKind) -> PersonalFillField {
        PersonalFillField {
            index: field::Index::from(index),
            kind,
        }
    }

    fn available(plan: PersonalFillPlan) -> PersonalFillOpportunity {
        PersonalFillOpportunity::Available(plan)
    }

    #[test]
    fn sign_up_form_plans_person_fields_and_skips_credentials() {
        let scope = PersonalFillScope::new()
            .with_focused_field(InputFixture::text("First name"))
            .with_field(InputFixture::text("Last name"))
            .with_field(PageInputFieldObservation {
                input_type: PageInputType::Email,
                ..InputFixture::tokens(&["email"])
            })
            .with_field(InputFixture::tokens(&["username"]))
            .with_field(InputFixture::password())
            .with_field(InputFixture::tokens(&["tel"]))
            .with_field(InputFixture::tokens(&["postal-code"]))
            .with_field(InputFixture::tokens(&["bday"]));
        assert_eq!(
            scope.plan(),
            available(PersonalFillPlan {
                group: PersonalFieldGroup::Person,
                fields: vec![
                    planned(0, PersonalFieldKind::GivenName),
                    planned(1, PersonalFieldKind::FamilyName),
                    planned(2, PersonalFieldKind::Email),
                    planned(5, PersonalFieldKind::Phone),
                    planned(7, PersonalFieldKind::BirthDate),
                ],
            })
        );
    }

    #[test]
    fn address_form_plans_only_the_focused_group() {
        let scope = PersonalFillScope::new()
            .with_field(InputFixture::tokens(&["name"]))
            .with_field(InputFixture::tokens(&["shipping", "address-line1"]))
            .with_focused_field(InputFixture::tokens(&["shipping", "address-line2"]))
            .with_field(InputFixture::text("City"))
            .with_field(InputFixture::text("State / Province"))
            .with_field(InputFixture::text("ZIP code"))
            .with_field(InputFixture::tokens(&["country"]))
            .with_field(InputFixture::tokens(&["cc-number"]));
        assert_eq!(
            scope.plan(),
            available(PersonalFillPlan {
                group: PersonalFieldGroup::Address,
                fields: vec![
                    planned(1, PersonalFieldKind::AddressLine1),
                    planned(2, PersonalFieldKind::AddressLine2),
                    planned(3, PersonalFieldKind::AddressLevel2),
                    planned(4, PersonalFieldKind::AddressLevel1),
                    planned(5, PersonalFieldKind::PostalCode),
                    planned(6, PersonalFieldKind::CountryCode),
                ],
            })
        );
    }

    #[test]
    fn card_form_plans_card_fields() {
        let scope = PersonalFillScope::new()
            .with_field(InputFixture::tokens(&["cc-name"]))
            .with_focused_field(InputFixture::tokens(&["cc-number"]))
            .with_field(InputFixture::tokens(&["cc-exp-month"]))
            .with_field(InputFixture::tokens(&["cc-exp-year"]))
            .with_field(InputFixture::text("CVC"))
            .with_field(InputFixture::tokens(&["billing", "postal-code"]));
        assert_eq!(
            scope.plan(),
            available(PersonalFillPlan {
                group: PersonalFieldGroup::Card,
                fields: vec![
                    planned(0, PersonalFieldKind::CardholderName),
                    planned(1, PersonalFieldKind::CardNumber),
                    planned(2, PersonalFieldKind::CardExpirationMonth),
                    planned(3, PersonalFieldKind::CardExpirationYear),
                    planned(4, PersonalFieldKind::CardSecurityCode),
                ],
            })
        );
    }

    #[test]
    fn identity_word_kinds_join_at_most_once_but_explicit_tokens_repeat() {
        let scope = PersonalFillScope::new()
            .with_field(InputFixture::text("Phone"))
            .with_field(InputFixture::text("Phone"))
            .with_focused_field(InputFixture::text("Email"))
            .with_field(InputFixture::text("Confirm email"))
            .with_field(InputFixture::tokens(&["home", "tel"]))
            .with_field(InputFixture::tokens(&["work", "tel"]));
        assert_eq!(
            scope.plan(),
            available(PersonalFillPlan {
                group: PersonalFieldGroup::Person,
                fields: vec![
                    planned(2, PersonalFieldKind::Email),
                    planned(4, PersonalFieldKind::Phone),
                    planned(5, PersonalFieldKind::Phone),
                ],
            })
        );
    }

    #[test]
    fn focused_identity_word_field_claims_its_kind_first() {
        let scope = PersonalFillScope::new()
            .with_field(InputFixture::text("City"))
            .with_focused_field(InputFixture::text("Town"));
        assert_eq!(
            scope.plan(),
            available(PersonalFillPlan {
                group: PersonalFieldGroup::Address,
                fields: vec![planned(1, PersonalFieldKind::AddressLevel2)],
            })
        );
    }

    #[test]
    fn unclassified_focus_yields_an_explicit_unavailable_result() {
        for focused in [
            InputFixture::text("Message"),
            InputFixture::password(),
            InputFixture::tokens(&["username"]),
            PageInputFieldObservation {
                disabled: true,
                ..InputFixture::tokens(&["given-name"])
            },
            PageInputFieldObservation {
                read_only: true,
                ..InputFixture::tokens(&["cc-number"])
            },
            PageInputFieldObservation {
                login_context: PageLoginContext::Authentication,
                ..InputFixture::tokens(&["email"])
            },
        ] {
            let scope = PersonalFillScope::new()
                .with_field(InputFixture::tokens(&["given-name"]))
                .with_focused_field(focused);
            assert_eq!(
                scope.plan(),
                PersonalFillOpportunity::Unavailable(
                    PersonalFillUnavailability::FocusedFieldUnclassified
                )
            );
        }
    }

    #[test]
    fn malformed_scopes_fail_closed() {
        assert_eq!(
            PersonalFillScope::new()
                .with_field(InputFixture::tokens(&["given-name"]))
                .plan(),
            PersonalFillOpportunity::Unavailable(PersonalFillUnavailability::FocusedFieldMissing)
        );
        assert_eq!(
            PersonalFillScope::default()
                .with_focused_field(InputFixture::tokens(&["given-name"]))
                .with_focused_field(InputFixture::tokens(&["family-name"]))
                .plan(),
            PersonalFillOpportunity::Unavailable(PersonalFillUnavailability::MultipleFocusedFields)
        );
        let oversized = (0..u32::from(field::Count::MAXIMUM)).fold(
            PersonalFillScope::new().with_focused_field(InputFixture::tokens(&["given-name"])),
            |scope, _| scope.with_field(InputFixture::tokens(&["family-name"])),
        );
        assert_eq!(
            oversized.plan(),
            PersonalFillOpportunity::Unavailable(PersonalFillUnavailability::TooManyObservedFields)
        );
    }

    #[test]
    fn maximum_scope_still_plans() {
        let scope = (1..u32::from(field::Count::MAXIMUM)).fold(
            PersonalFillScope::new().with_focused_field(InputFixture::tokens(&["given-name"])),
            |scope, _| scope.with_field(InputFixture::text("Message")),
        );
        assert_eq!(
            scope.plan(),
            available(PersonalFillPlan {
                group: PersonalFieldGroup::Person,
                fields: vec![planned(0, PersonalFieldKind::GivenName)],
            })
        );
    }

    #[test]
    fn serialization_preserves_source_names() -> anyhow::Result<()> {
        let plan = available(PersonalFillPlan {
            group: PersonalFieldGroup::Card,
            fields: vec![planned(3, PersonalFieldKind::CardNumber)],
        });
        assert_eq!(
            serde_json::to_string(&plan)?,
            r#"{"Available":{"group":"Card","fields":[{"index":{"value":3},"kind":"CardNumber"}]}}"#
        );
        assert_eq!(
            serde_json::to_string(&PersonalFillOpportunity::Unavailable(
                PersonalFillUnavailability::FocusedFieldUnclassified
            ))?,
            r#"{"Unavailable":"FocusedFieldUnclassified"}"#
        );
        Ok(())
    }
}

use super::transaction::AuthenticationCredentialDisclosureRejection;
use crate::authentication_workflow::observation_facts::AuthenticationFieldObservationFacts;
use crate::page_field_classification::{
    AuthenticationAdvanceControlObservation, AuthenticationUsernameEvidence,
    PageControlActionability, PageControlOwnership, PageControlSemantics,
    PageControlSubmissionDestinationSource, PageControlSubmissionMethod,
    canonicalize_control_destination, expand_identity_text,
};
use crate::{AuthenticationFieldCount, MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT};
use serde::{Deserialize, Serialize};
use tsify::Tsify;
use url::Url;

/// Version of the security-sensitive authentication-disclosure observation wire.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "number")]
pub struct AuthenticationDisclosureObservationSchemaVersion(u32);

impl AuthenticationDisclosureObservationSchemaVersion {
    pub const CURRENT: Self = Self(1);

    #[must_use]
    pub const fn is_supported(self) -> bool {
        self.0 == Self::CURRENT.0
    }
}

impl From<u32> for AuthenticationDisclosureObservationSchemaVersion {
    fn from(value: u32) -> Self {
        Self(value)
    }
}

impl From<AuthenticationDisclosureObservationSchemaVersion> for u32 {
    fn from(value: AuthenticationDisclosureObservationSchemaVersion) -> Self {
        value.0
    }
}

/// Inputs owned by the current disclosure-observation writer.
pub struct CurrentAuthenticationDisclosureControlRequest {
    pub observation: AuthenticationAdvanceControlObservation,
    pub generic_password_field_count: AuthenticationFieldCount,
}

/// Versioned control facts used only by exceptional credential disclosure.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct VersionedAuthenticationDisclosureControlObservation {
    pub schema_version: AuthenticationDisclosureObservationSchemaVersion,
    pub observation: AuthenticationAdvanceControlObservation,
    pub generic_password_field_count: AuthenticationFieldCount,
}

/// Typed classification of a versioned disclosure-control observation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum AuthenticationDisclosureControlDecision {
    AdvancesAuthentication,
    DoesNotAdvanceAuthentication,
    UnsupportedVersion,
}

impl VersionedAuthenticationDisclosureControlObservation {
    #[must_use]
    pub fn current(request: CurrentAuthenticationDisclosureControlRequest) -> Self {
        Self {
            schema_version: AuthenticationDisclosureObservationSchemaVersion::CURRENT,
            observation: request.observation,
            generic_password_field_count: request.generic_password_field_count,
        }
    }

    #[must_use]
    pub fn classify(&self) -> AuthenticationDisclosureControlDecision {
        if !self.schema_version.is_supported() {
            return AuthenticationDisclosureControlDecision::UnsupportedVersion;
        }
        if !self.is_bounded() {
            return AuthenticationDisclosureControlDecision::DoesNotAdvanceAuthentication;
        }
        if self.is_exact_owned_omitted_method_login_activation() {
            return AuthenticationDisclosureControlDecision::AdvancesAuthentication;
        }
        AuthenticationDisclosureControlDecision::DoesNotAdvanceAuthentication
    }

    fn is_bounded(&self) -> bool {
        self.observation.is_bounded()
            && self.generic_password_field_count.raw() <= MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT
            && self.generic_password_field_count.raw()
                <= self.observation.password_field_count.raw()
    }

    fn is_exact_owned_omitted_method_login_activation(&self) -> bool {
        let control = &self.observation;
        let secure_source =
            Url::parse(control.source_origin.trim()).is_ok_and(|origin| origin.scheme() == "https");
        let secure_destination = Url::parse(control.destination_identity.trim())
            .is_ok_and(|destination| destination.scheme() == "https");
        if !secure_source
            || !secure_destination
            || !self.schema_version.is_supported()
            || !matches!(control.actionability, PageControlActionability::Actionable)
            || !matches!(control.ownership, PageControlOwnership::OwnedForm)
            || !matches!(control.semantics, PageControlSemantics::Activation)
            || !matches!(
                control.authentication_username,
                AuthenticationUsernameEvidence::Explicit
            )
            || control.password_field_count.raw() != 1
            || self.generic_password_field_count.raw() != 0
            || control.new_password_field_count.raw() != 0
            || control.one_time_code_field_count.raw() != 0
            || control.semantic_submit_control_count.raw() != 0
            || !control.form_identity.is_empty()
            || !control.machine_identity.is_empty()
            || expand_identity_text(&control.label) != "sign in"
            || !matches!(
                control.submission_method,
                PageControlSubmissionMethod::Absent
            )
            || !matches!(
                control.submission_destination_source,
                PageControlSubmissionDestinationSource::Omitted
            )
        {
            return false;
        }
        canonicalize_control_destination(&control.source_origin, &control.destination_identity)
            .is_some_and(|destination| {
                destination.path_identity == "/login" && destination.route_identity == "/login"
            })
    }

    fn is_exact_inert_planning_control(&self) -> bool {
        if !matches!(
            self.observation.actionability,
            PageControlActionability::Inert
        ) {
            return false;
        }
        let mut actionable = self.clone();
        actionable.observation.actionability = PageControlActionability::Actionable;
        actionable.is_exact_owned_omitted_method_login_activation()
    }

    fn fields_match(&self, fields: AuthenticationFieldObservationFacts) -> bool {
        fields.is_compatible_with_detailed_control(&self.observation)
            && fields.username_field_count.raw() == 1
            && fields.generic_password_field_count == self.generic_password_field_count
            && fields.current_password_field_count.raw() == 1
            && fields.actionable_password_field_count.raw() == 1
            && fields.readonly_password_field_count.raw() == 0
    }
}

/// Optional versioned evidence dedicated to exceptional disclosure planning.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, Tsify)]
#[serde(tag = "kind", content = "observations", rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum AuthenticationCredentialDisclosureControlObservation {
    #[default]
    Absent,
    Observed(Vec<VersionedAuthenticationDisclosureControlObservation>),
}

impl AuthenticationCredentialDisclosureControlObservation {
    pub(in crate::authentication_workflow::observation_facts) fn is_bounded(&self) -> bool {
        matches!(self, Self::Absent)
            || matches!(self, Self::Observed(observations)
            if !observations.is_empty()
                && observations.len() <= MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT as usize
                && observations.iter().all(
                    VersionedAuthenticationDisclosureControlObservation::is_bounded
                ))
    }

    pub(in crate::authentication_workflow::observation_facts) fn has_planning_evidence(
        &self,
        fields: AuthenticationFieldObservationFacts,
    ) -> bool {
        matches!(self, Self::Observed(observations)
            if observations.len() == 1
                && observations[0].fields_match(fields)
                && observations[0].is_exact_inert_planning_control())
    }

    pub(super) fn reader_rejection(&self) -> Option<AuthenticationCredentialDisclosureRejection> {
        let Self::Observed(observations) = self else {
            return Some(AuthenticationCredentialDisclosureRejection::ControlObservationAbsent);
        };
        let [observation] = observations.as_slice() else {
            return Some(AuthenticationCredentialDisclosureRejection::MalformedControlObservation);
        };
        if !observation.schema_version.is_supported() {
            return Some(
                AuthenticationCredentialDisclosureRejection::UnsupportedVersion(
                    observation.schema_version,
                ),
            );
        }
        (!observation.is_bounded())
            .then_some(AuthenticationCredentialDisclosureRejection::MalformedControlObservation)
    }

    pub(super) fn has_actionable_consumption_evidence(
        &self,
        fields: AuthenticationFieldObservationFacts,
    ) -> bool {
        matches!(self, Self::Observed(observations)
            if observations.len() == 1
                && observations[0].fields_match(fields)
                && observations[0].is_exact_owned_omitted_method_login_activation())
    }

    pub(super) fn normalize_expected_actionability(&mut self) {
        if let Self::Observed(observations) = self {
            for observation in observations {
                observation.observation.actionability = PageControlActionability::Inert;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::page_field_classification::MAX_AUTHENTICATION_CONTROL_TEXT_BYTES;

    struct ExactDisclosureControlScenario;

    impl ExactDisclosureControlScenario {
        fn control(
            actionability: PageControlActionability,
        ) -> VersionedAuthenticationDisclosureControlObservation {
            VersionedAuthenticationDisclosureControlObservation::current(
                CurrentAuthenticationDisclosureControlRequest {
                    observation: AuthenticationAdvanceControlObservation {
                        actionability,
                        ownership: PageControlOwnership::OwnedForm,
                        semantics: PageControlSemantics::Activation,
                        authentication_username: AuthenticationUsernameEvidence::Explicit,
                        password_field_count: 1.into(),
                        new_password_field_count: 0.into(),
                        one_time_code_field_count: 0.into(),
                        semantic_submit_control_count: 0.into(),
                        source_origin: "https://login.example.test".to_owned(),
                        form_identity: String::new(),
                        destination_identity: "https://login.example.test/login".to_owned(),
                        label: "Sign in".to_owned(),
                        machine_identity: String::new(),
                        submission_method: PageControlSubmissionMethod::Absent,
                        submission_destination_source:
                            PageControlSubmissionDestinationSource::Omitted,
                    },
                    generic_password_field_count: 0.into(),
                },
            )
        }

        fn fields(username_count: u32) -> AuthenticationFieldObservationFacts {
            AuthenticationFieldObservationFacts {
                username_field_count: username_count.into(),
                current_password_field_count: 1.into(),
                actionable_password_field_count: 1.into(),
                ..Default::default()
            }
        }
    }

    #[test]
    fn exact_activation_requires_https_and_rejects_hostile_variants() {
        let exact = ExactDisclosureControlScenario::control(PageControlActionability::Actionable);
        assert_eq!(
            exact.classify(),
            AuthenticationDisclosureControlDecision::AdvancesAuthentication
        );
        let mutations: &[fn(&mut VersionedAuthenticationDisclosureControlObservation)] = &[
            |value| value.observation.source_origin = "http://login.example.test".to_owned(),
            |value| {
                value.observation.destination_identity =
                    "http://login.example.test/login".to_owned();
            },
            |value| {
                value.observation.destination_identity =
                    "https://attacker.example/login".to_owned();
            },
            |value| {
                value.observation.destination_identity =
                    "https://login.example.test/recover".to_owned();
            },
            |value| value.observation.label = "Sign in with Google".to_owned(),
            |value| value.observation.form_identity = "signup".to_owned(),
            |value| value.observation.machine_identity = "provider".to_owned(),
            |value| {
                value.observation.authentication_username = AuthenticationUsernameEvidence::Strong;
            },
            |value| value.observation.semantics = PageControlSemantics::SemanticSubmit,
            |value| value.observation.submission_method = PageControlSubmissionMethod::Get,
            |value| {
                value.observation.submission_destination_source =
                    PageControlSubmissionDestinationSource::Authored;
            },
            |value| value.observation.ownership = PageControlOwnership::Unowned,
            |value| value.observation.actionability = PageControlActionability::Inert,
            |value| value.observation.password_field_count = 2.into(),
            |value| value.generic_password_field_count = 1.into(),
            |value| value.observation.new_password_field_count = 1.into(),
            |value| value.observation.one_time_code_field_count = 1.into(),
            |value| value.observation.semantic_submit_control_count = 1.into(),
            |value| {
                value.observation.source_origin =
                    "x".repeat(MAX_AUTHENTICATION_CONTROL_TEXT_BYTES + 1);
            },
        ];
        for mutation in mutations {
            let mut rejected = exact.clone();
            mutation(&mut rejected);
            assert_eq!(
                rejected.classify(),
                AuthenticationDisclosureControlDecision::DoesNotAdvanceAuthentication
            );
        }
    }

    #[test]
    fn planning_evidence_requires_exactly_one_username() {
        let observation = AuthenticationCredentialDisclosureControlObservation::Observed(vec![
            ExactDisclosureControlScenario::control(PageControlActionability::Inert),
        ]);
        assert!(observation.has_planning_evidence(ExactDisclosureControlScenario::fields(1)));
        assert!(!observation.has_planning_evidence(ExactDisclosureControlScenario::fields(0)));
        assert!(!observation.has_planning_evidence(ExactDisclosureControlScenario::fields(2)));
    }

    #[test]
    fn unsupported_version_is_typed_and_round_trips() -> anyhow::Result<()> {
        let mut observation =
            ExactDisclosureControlScenario::control(PageControlActionability::Actionable);
        observation.schema_version = 2.into();
        assert_eq!(
            observation.classify(),
            AuthenticationDisclosureControlDecision::UnsupportedVersion
        );
        let encoded = serde_json::to_string(&observation)?;
        assert_eq!(
            serde_json::from_str::<VersionedAuthenticationDisclosureControlObservation>(&encoded)?,
            observation
        );
        Ok(())
    }

    #[test]
    fn version_and_generic_password_count_are_required_wire_fields() -> anyhow::Result<()> {
        let observation = ExactDisclosureControlScenario::control(PageControlActionability::Inert);
        for field_name in ["schemaVersion", "genericPasswordFieldCount"] {
            let mut encoded = serde_json::to_value(&observation)?;
            let serde_json::Value::Object(fields) = &mut encoded else {
                anyhow::bail!("versioned disclosure control must encode as an object");
            };
            fields
                .remove(field_name)
                .ok_or_else(|| anyhow::anyhow!("expected wire field {field_name}"))?;
            assert!(
                serde_json::from_value::<VersionedAuthenticationDisclosureControlObservation>(
                    encoded
                )
                .is_err()
            );
        }
        Ok(())
    }
}

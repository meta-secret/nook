use crate::page_field_classification::{
    AuthenticationAdvanceControlObservation, AuthenticationUsernameEvidence,
    PageControlActionability, PageControlOwnership, PageControlSemantics,
    PageControlSubmissionDestinationSource, PageControlSubmissionMethod,
    canonicalize_control_destination, expand_identity_text,
};
use crate::{
    AuthenticationFieldCount, AuthenticationSemanticSubmitControlCount,
    MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT,
};
use serde::de::Error as _;
use serde::{Deserialize, Deserializer, Serialize};
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
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(
    type = "{ schemaVersion: 1; observation: AuthenticationAdvanceControlObservation; genericPasswordFieldCount: number }",
    into_wasm_abi,
    from_wasm_abi
)]
pub struct VersionedAuthenticationDisclosureControlObservation {
    schema_version: AuthenticationDisclosureObservationSchemaVersion,
    #[serde(flatten)]
    body: AuthenticationDisclosureControlObservationBody,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(untagged)]
enum AuthenticationDisclosureControlObservationBody {
    Current(CurrentAuthenticationDisclosureControlObservationBody),
    Unsupported(UnsupportedAuthenticationDisclosureControlObservationBody),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct CurrentAuthenticationDisclosureControlObservationBody {
    observation: AuthenticationAdvanceControlObservation,
    generic_password_field_count: AuthenticationFieldCount,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
struct UnsupportedAuthenticationDisclosureControlObservationBody {}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuthenticationDisclosureObservationEnvelope {
    schema_version: AuthenticationDisclosureObservationSchemaVersion,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RequiredVersionOneAuthenticationDisclosureControlObservation {
    schema_version: AuthenticationDisclosureObservationSchemaVersion,
    observation: RequiredAuthenticationAdvanceControlObservation,
    generic_password_field_count: AuthenticationFieldCount,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RequiredAuthenticationAdvanceControlObservation {
    actionability: PageControlActionability,
    ownership: PageControlOwnership,
    semantics: PageControlSemantics,
    authentication_username: AuthenticationUsernameEvidence,
    password_field_count: AuthenticationFieldCount,
    new_password_field_count: AuthenticationFieldCount,
    one_time_code_field_count: AuthenticationFieldCount,
    semantic_submit_control_count: AuthenticationSemanticSubmitControlCount,
    source_origin: String,
    form_identity: String,
    destination_identity: String,
    label: String,
    machine_identity: String,
    submission_method: PageControlSubmissionMethod,
    submission_destination_source: PageControlSubmissionDestinationSource,
}

/// Decodes untrusted observation envelopes before the current generated DTO is considered.
struct AuthenticationDisclosureControlUntrustedWireDecoder;

impl AuthenticationDisclosureControlUntrustedWireDecoder {
    fn decode(
        encoded: serde_json::Value,
    ) -> serde_json::Result<VersionedAuthenticationDisclosureControlObservation> {
        let envelope = AuthenticationDisclosureObservationEnvelope::deserialize(&encoded)?;
        if !envelope.schema_version.is_supported() {
            return Ok(VersionedAuthenticationDisclosureControlObservation {
                schema_version: envelope.schema_version,
                body: AuthenticationDisclosureControlObservationBody::Unsupported(
                    UnsupportedAuthenticationDisclosureControlObservationBody {},
                ),
            });
        }
        let current = serde_json::from_value::<
            RequiredVersionOneAuthenticationDisclosureControlObservation,
        >(encoded)?;
        Ok(VersionedAuthenticationDisclosureControlObservation {
            schema_version: current.schema_version,
            body: AuthenticationDisclosureControlObservationBody::Current(
                CurrentAuthenticationDisclosureControlObservationBody {
                    observation: current.observation.into(),
                    generic_password_field_count: current.generic_password_field_count,
                },
            ),
        })
    }
}

impl From<RequiredAuthenticationAdvanceControlObservation>
    for AuthenticationAdvanceControlObservation
{
    fn from(required: RequiredAuthenticationAdvanceControlObservation) -> Self {
        Self {
            actionability: required.actionability,
            ownership: required.ownership,
            semantics: required.semantics,
            authentication_username: required.authentication_username,
            password_field_count: required.password_field_count,
            new_password_field_count: required.new_password_field_count,
            one_time_code_field_count: required.one_time_code_field_count,
            semantic_submit_control_count: required.semantic_submit_control_count,
            source_origin: required.source_origin,
            form_identity: required.form_identity,
            destination_identity: required.destination_identity,
            label: required.label,
            machine_identity: required.machine_identity,
            submission_method: required.submission_method,
            submission_destination_source: required.submission_destination_source,
        }
    }
}

impl<'de> Deserialize<'de> for VersionedAuthenticationDisclosureControlObservation {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let encoded = serde_json::Value::deserialize(deserializer)?;
        AuthenticationDisclosureControlUntrustedWireDecoder::decode(encoded)
            .map_err(D::Error::custom)
    }
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
            body: AuthenticationDisclosureControlObservationBody::Current(
                CurrentAuthenticationDisclosureControlObservationBody {
                    observation: request.observation,
                    generic_password_field_count: request.generic_password_field_count,
                },
            ),
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

    #[must_use]
    pub const fn schema_version(&self) -> AuthenticationDisclosureObservationSchemaVersion {
        self.schema_version
    }

    fn is_bounded(&self) -> bool {
        let AuthenticationDisclosureControlObservationBody::Current(body) = &self.body else {
            return false;
        };
        body.observation.is_bounded()
            && body.generic_password_field_count.raw() <= MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT
            && body.generic_password_field_count.raw()
                <= body.observation.password_field_count.raw()
    }

    fn is_exact_owned_omitted_method_login_activation(&self) -> bool {
        let AuthenticationDisclosureControlObservationBody::Current(body) = &self.body else {
            return false;
        };
        let control = &body.observation;
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
            || body.generic_password_field_count.raw() != 0
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

    #[cfg(test)]
    fn current_observation_mut(&mut self) -> &mut AuthenticationAdvanceControlObservation {
        let AuthenticationDisclosureControlObservationBody::Current(body) = &mut self.body else {
            unreachable!("current test observations always carry the version-one body");
        };
        &mut body.observation
    }

    #[cfg(test)]
    fn set_generic_password_field_count(&mut self, count: AuthenticationFieldCount) {
        let AuthenticationDisclosureControlObservationBody::Current(body) = &mut self.body else {
            unreachable!("current test observations always carry the version-one body");
        };
        body.generic_password_field_count = count;
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

        fn assert_exact_activation_requires_https_and_rejects_hostile_variants() {
            let exact = Self::control(PageControlActionability::Actionable);
            assert_eq!(
                exact.classify(),
                AuthenticationDisclosureControlDecision::AdvancesAuthentication
            );
            let mutations: &[fn(&mut VersionedAuthenticationDisclosureControlObservation)] = &[
                |value| {
                    value.current_observation_mut().source_origin =
                        "http://login.example.test".to_owned();
                },
                |value| {
                    value.current_observation_mut().destination_identity =
                        "http://login.example.test/login".to_owned();
                },
                |value| {
                    value.current_observation_mut().destination_identity =
                        "https://attacker.example/login".to_owned();
                },
                |value| {
                    value.current_observation_mut().destination_identity =
                        "https://login.example.test/recover".to_owned();
                },
                |value| value.current_observation_mut().label = "Sign in with Google".to_owned(),
                |value| value.current_observation_mut().form_identity = "signup".to_owned(),
                |value| value.current_observation_mut().machine_identity = "provider".to_owned(),
                |value| {
                    value.current_observation_mut().authentication_username =
                        AuthenticationUsernameEvidence::Strong;
                },
                |value| {
                    value.current_observation_mut().semantics =
                        PageControlSemantics::SemanticSubmit;
                },
                |value| {
                    value.current_observation_mut().submission_method =
                        PageControlSubmissionMethod::Get;
                },
                |value| {
                    value
                        .current_observation_mut()
                        .submission_destination_source =
                        PageControlSubmissionDestinationSource::Authored;
                },
                |value| value.current_observation_mut().ownership = PageControlOwnership::Unowned,
                |value| {
                    value.current_observation_mut().actionability = PageControlActionability::Inert;
                },
                |value| value.current_observation_mut().password_field_count = 2.into(),
                |value| value.set_generic_password_field_count(1.into()),
                |value| value.current_observation_mut().new_password_field_count = 1.into(),
                |value| value.current_observation_mut().one_time_code_field_count = 1.into(),
                |value| {
                    value
                        .current_observation_mut()
                        .semantic_submit_control_count = 1.into();
                },
                |value| {
                    value.current_observation_mut().source_origin =
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

        fn assert_unsupported_version_is_typed_and_round_trips() -> anyhow::Result<()> {
            let observation = serde_json::from_value::<
                VersionedAuthenticationDisclosureControlObservation,
            >(serde_json::json!({ "schemaVersion": 2 }))?;
            assert_eq!(
                observation.classify(),
                AuthenticationDisclosureControlDecision::UnsupportedVersion
            );
            let encoded = serde_json::to_string(&observation)?;
            let decoded = serde_json::from_str::<
                VersionedAuthenticationDisclosureControlObservation,
            >(&encoded)?;
            assert_eq!(
                decoded.classify(),
                AuthenticationDisclosureControlDecision::UnsupportedVersion
            );
            assert_eq!(u32::from(decoded.schema_version()), 2);
            Ok(())
        }

        fn assert_future_version_body_is_not_decoded_as_version_one() -> anyhow::Result<()> {
            for encoded in [
                serde_json::json!({ "schemaVersion": 2 }),
                serde_json::json!({
                    "schemaVersion": 2,
                    "futureObservation": { "renamedControl": true }
                }),
            ] {
                let decoded = serde_json::from_value::<
                    VersionedAuthenticationDisclosureControlObservation,
                >(encoded)?;
                assert_eq!(
                    decoded.classify(),
                    AuthenticationDisclosureControlDecision::UnsupportedVersion
                );
                assert_eq!(u32::from(decoded.schema_version()), 2);
            }
            Ok(())
        }

        fn assert_required_current_wire_fields() -> anyhow::Result<()> {
            let observation = Self::control(PageControlActionability::Inert);
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

        fn assert_every_nested_v1_control_field_is_required() -> anyhow::Result<()> {
            let observation = Self::control(PageControlActionability::Inert);
            for field_name in [
                "actionability",
                "ownership",
                "semantics",
                "authenticationUsername",
                "passwordFieldCount",
                "newPasswordFieldCount",
                "oneTimeCodeFieldCount",
                "semanticSubmitControlCount",
                "sourceOrigin",
                "formIdentity",
                "destinationIdentity",
                "label",
                "machineIdentity",
                "submissionMethod",
                "submissionDestinationSource",
            ] {
                let mut encoded = serde_json::to_value(&observation)?;
                let Some(fields) = encoded
                    .get_mut("observation")
                    .and_then(serde_json::Value::as_object_mut)
                else {
                    anyhow::bail!("versioned disclosure control lacks nested observation");
                };
                fields
                    .remove(field_name)
                    .ok_or_else(|| anyhow::anyhow!("expected nested wire field {field_name}"))?;
                assert!(
                    serde_json::from_value::<VersionedAuthenticationDisclosureControlObservation>(
                        encoded
                    )
                    .is_err()
                );
            }
            Ok(())
        }

        fn assert_unknown_v1_fields_are_rejected() -> anyhow::Result<()> {
            let mut encoded =
                serde_json::to_value(Self::control(PageControlActionability::Inert))?;
            let serde_json::Value::Object(fields) = &mut encoded else {
                anyhow::bail!("versioned disclosure control must encode as an object");
            };
            fields.insert("futurePolicy".to_owned(), serde_json::json!(true));
            assert!(
                serde_json::from_value::<VersionedAuthenticationDisclosureControlObservation>(
                    encoded,
                )
                .is_err()
            );

            let mut encoded =
                serde_json::to_value(Self::control(PageControlActionability::Inert))?;
            let Some(fields) = encoded
                .get_mut("observation")
                .and_then(serde_json::Value::as_object_mut)
            else {
                anyhow::bail!("versioned disclosure control lacks nested observation");
            };
            fields.insert("futureControl".to_owned(), serde_json::json!(true));
            assert!(
                serde_json::from_value::<VersionedAuthenticationDisclosureControlObservation>(
                    encoded,
                )
                .is_err()
            );
            Ok(())
        }
    }

    #[test]
    fn exact_activation_requires_https_and_rejects_hostile_variants() {
        ExactDisclosureControlScenario::assert_exact_activation_requires_https_and_rejects_hostile_variants();
    }

    #[test]
    fn unsupported_version_is_typed_and_round_trips() -> anyhow::Result<()> {
        ExactDisclosureControlScenario::assert_unsupported_version_is_typed_and_round_trips()
    }

    #[test]
    fn future_version_body_is_not_decoded_as_version_one() -> anyhow::Result<()> {
        ExactDisclosureControlScenario::assert_future_version_body_is_not_decoded_as_version_one()
    }

    #[test]
    fn version_and_generic_password_count_are_required_wire_fields() -> anyhow::Result<()> {
        ExactDisclosureControlScenario::assert_required_current_wire_fields()
    }

    #[test]
    fn every_nested_v1_control_field_is_required() -> anyhow::Result<()> {
        ExactDisclosureControlScenario::assert_every_nested_v1_control_field_is_required()
    }

    #[test]
    fn unknown_v1_fields_are_rejected() -> anyhow::Result<()> {
        ExactDisclosureControlScenario::assert_unknown_v1_fields_are_rejected()
    }
}

//! Versioned wire transport for authentication page observations.

use super::{AuthenticationPageObservationFacts, AuthenticationPageObservationFactsBatch};
use crate::{
    AuthenticationAuthenticatorObservationFacts, AuthenticationCeremonyObservationFacts,
    AuthenticationCredentialDisclosureControlObservation,
    AuthenticationCredentialSubmissionObservation,
    AuthenticationDetailedAdvanceControlObservation, AuthenticationFieldObservationFacts,
    AuthenticationWorkflowMatch,
};
use serde::de::Error as _;
use serde::{Deserialize, Deserializer, Serialize};
use tsify::Tsify;

/// Version of the authentication page-observation wire contract.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "number")]
pub struct AuthenticationPageObservationFactsSchemaVersion(u32);

impl AuthenticationPageObservationFactsSchemaVersion {
    pub const CURRENT: Self = Self(1);

    const fn is_supported(self) -> bool {
        self.0 == Self::CURRENT.0
    }
}

impl From<u32> for AuthenticationPageObservationFactsSchemaVersion {
    fn from(value: u32) -> Self {
        Self(value)
    }
}

impl From<AuthenticationPageObservationFactsSchemaVersion> for u32 {
    fn from(value: AuthenticationPageObservationFactsSchemaVersion) -> Self {
        value.0
    }
}

/// Inputs owned by the current page-observation writer.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[tsify(from_wasm_abi)]
pub struct CurrentAuthenticationPageObservationFactsRequest {
    pub facts: CurrentAuthenticationPageObservationFactsWireFacts,
    pub credential_disclosure_control: AuthenticationCredentialDisclosureControlObservation,
}

/// Exact generated DTO emitted by the current version-one writer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(
    type = "{ schemaVersion: 1; facts: { fields: AuthenticationFieldObservationFacts; ceremony: AuthenticationCeremonyObservationFacts; authenticator: AuthenticationAuthenticatorObservationFacts; credentialSubmission: AuthenticationCredentialSubmissionObservation; detailedAdvanceControl: AuthenticationDetailedAdvanceControlObservation }; credentialDisclosureControl: AuthenticationCredentialDisclosureControlObservation }",
    into_wasm_abi
)]
pub struct CurrentAuthenticationPageObservationFactsWire {
    schema_version: AuthenticationPageObservationFactsSchemaVersion,
    facts: CurrentAuthenticationPageObservationFactsWireFacts,
    credential_disclosure_control: AuthenticationCredentialDisclosureControlObservation,
}

impl CurrentAuthenticationPageObservationFactsWire {
    #[must_use]
    pub fn new(request: CurrentAuthenticationPageObservationFactsRequest) -> Self {
        Self {
            schema_version: AuthenticationPageObservationFactsSchemaVersion::CURRENT,
            facts: request.facts,
            credential_disclosure_control: request.credential_disclosure_control,
        }
    }
}

/// One versioned authentication page observation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionedAuthenticationPageObservationFacts {
    schema_version: AuthenticationPageObservationFactsSchemaVersion,
    facts: AuthenticationPageObservationFacts,
    #[serde(flatten)]
    body: AuthenticationPageObservationFactsBody,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(untagged)]
enum AuthenticationPageObservationFactsBody {
    Current(CurrentAuthenticationPageObservationFactsBody),
    Unsupported(UnsupportedAuthenticationPageObservationFactsBody),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct CurrentAuthenticationPageObservationFactsBody {
    credential_disclosure_control: AuthenticationCredentialDisclosureControlObservation,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
struct UnsupportedAuthenticationPageObservationFactsBody {}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuthenticationPageObservationFactsEnvelope {
    schema_version: AuthenticationPageObservationFactsSchemaVersion,
    facts: CurrentAuthenticationPageObservationFactsWireFacts,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RequiredCurrentAuthenticationPageObservationFacts {
    schema_version: AuthenticationPageObservationFactsSchemaVersion,
    facts: CurrentAuthenticationPageObservationFactsWireFacts,
    credential_disclosure_control: AuthenticationCredentialDisclosureControlObservation,
}

/// Exact required common facts shared by current and future page-observation envelopes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct CurrentAuthenticationPageObservationFactsWireFacts {
    pub fields: AuthenticationFieldObservationFacts,
    pub ceremony: AuthenticationCeremonyObservationFacts,
    pub authenticator: AuthenticationAuthenticatorObservationFacts,
    pub credential_submission: AuthenticationCredentialSubmissionObservation,
    pub detailed_advance_control: AuthenticationDetailedAdvanceControlObservation,
}

impl From<CurrentAuthenticationPageObservationFactsWireFacts>
    for AuthenticationPageObservationFacts
{
    fn from(required: CurrentAuthenticationPageObservationFactsWireFacts) -> Self {
        Self {
            fields: required.fields,
            ceremony: required.ceremony,
            authenticator: required.authenticator,
            credential_submission: required.credential_submission,
            detailed_advance_control: required.detailed_advance_control,
        }
    }
}

impl From<AuthenticationPageObservationFacts>
    for CurrentAuthenticationPageObservationFactsWireFacts
{
    fn from(facts: AuthenticationPageObservationFacts) -> Self {
        Self {
            fields: facts.fields,
            ceremony: facts.ceremony,
            authenticator: facts.authenticator,
            credential_submission: facts.credential_submission,
            detailed_advance_control: facts.detailed_advance_control,
        }
    }
}

struct AuthenticationPageObservationFactsUntrustedWireDecoder;

impl AuthenticationPageObservationFactsUntrustedWireDecoder {
    fn decode(
        encoded: serde_json::Value,
    ) -> serde_json::Result<VersionedAuthenticationPageObservationFacts> {
        let envelope = AuthenticationPageObservationFactsEnvelope::deserialize(&encoded)?;
        if !envelope.schema_version.is_supported() {
            return Ok(VersionedAuthenticationPageObservationFacts {
                schema_version: envelope.schema_version,
                facts: envelope.facts.into(),
                body: AuthenticationPageObservationFactsBody::Unsupported(
                    UnsupportedAuthenticationPageObservationFactsBody {},
                ),
            });
        }
        let current = serde_json::from_value::<RequiredCurrentAuthenticationPageObservationFacts>(
            encoded,
        )?;
        Ok(VersionedAuthenticationPageObservationFacts {
            schema_version: current.schema_version,
            facts: current.facts.into(),
            body: AuthenticationPageObservationFactsBody::Current(
                CurrentAuthenticationPageObservationFactsBody {
                    credential_disclosure_control: current.credential_disclosure_control,
                },
            ),
        })
    }
}

impl<'de> Deserialize<'de> for VersionedAuthenticationPageObservationFacts {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let encoded = serde_json::Value::deserialize(deserializer)?;
        AuthenticationPageObservationFactsUntrustedWireDecoder::decode(encoded)
            .map_err(D::Error::custom)
    }
}

impl VersionedAuthenticationPageObservationFacts {
    #[must_use]
    pub fn current(request: CurrentAuthenticationPageObservationFactsRequest) -> Self {
        CurrentAuthenticationPageObservationFactsWire::new(request).into()
    }

    #[must_use]
    pub const fn schema_version(&self) -> AuthenticationPageObservationFactsSchemaVersion {
        self.schema_version
    }

    fn common_facts_are_bounded(&self) -> bool {
        self.facts.is_bounded()
    }

    fn current_body_is_bounded(&self) -> bool {
        match &self.body {
            AuthenticationPageObservationFactsBody::Current(body) => {
                body.credential_disclosure_control
                    .supported_observations_are_bounded()
            }
            AuthenticationPageObservationFactsBody::Unsupported(_) => true,
        }
    }

    fn unsupported_version(
        &self,
    ) -> Option<AuthenticationPageObservationFactsUnsupportedSchemaVersion> {
        if !self.schema_version.is_supported() {
            return Some(
                AuthenticationPageObservationFactsUnsupportedSchemaVersion::PageFacts {
                    version: self.schema_version,
                },
            );
        }
        let AuthenticationPageObservationFactsBody::Current(body) = &self.body else {
            return None;
        };
        body.credential_disclosure_control
            .first_unsupported_version()
            .map(|version| {
                AuthenticationPageObservationFactsUnsupportedSchemaVersion::DisclosureControl {
                    version,
                }
            })
    }
}

impl From<CurrentAuthenticationPageObservationFactsWire>
    for VersionedAuthenticationPageObservationFacts
{
    fn from(current: CurrentAuthenticationPageObservationFactsWire) -> Self {
        Self {
            schema_version: current.schema_version,
            facts: current.facts.into(),
            body: AuthenticationPageObservationFactsBody::Current(
                CurrentAuthenticationPageObservationFactsBody {
                    credential_disclosure_control: current.credential_disclosure_control,
                },
            ),
        }
    }
}

/// A bounded batch of versioned page-observation facts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionedAuthenticationPageObservationFactsBatch {
    pub observations: Vec<VersionedAuthenticationPageObservationFacts>,
}

/// Schema namespace and version that the current reader does not support.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "schema", rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum AuthenticationPageObservationFactsUnsupportedSchemaVersion {
    PageFacts {
        version: AuthenticationPageObservationFactsSchemaVersion,
    },
    DisclosureControl {
        version: crate::AuthenticationDisclosureObservationSchemaVersion,
    },
}

/// Typed result of classifying a versioned observation batch.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "kind", content = "value", rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum AuthenticationPageObservationFactsClassificationOutcome {
    Classified(AuthenticationWorkflowMatch),
    UnsupportedVersion(AuthenticationPageObservationFactsUnsupportedSchemaVersion),
}

impl VersionedAuthenticationPageObservationFactsBatch {
    #[must_use]
    pub fn classify(&self) -> AuthenticationPageObservationFactsClassificationOutcome {
        if self.observations.is_empty()
            || self.observations.len() > crate::MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS
            || self
                .observations
                .iter()
                .any(|observation| !observation.common_facts_are_bounded())
            || self.observations.iter().any(|observation| {
                observation.schema_version.is_supported() && !observation.current_body_is_bounded()
            })
        {
            return AuthenticationPageObservationFactsClassificationOutcome::Classified(
                AuthenticationWorkflowMatch::Rejected,
            );
        }
        if let Some(unsupported) = self
            .observations
            .iter()
            .find_map(VersionedAuthenticationPageObservationFacts::unsupported_version)
        {
            return AuthenticationPageObservationFactsClassificationOutcome::UnsupportedVersion(
                unsupported,
            );
        }
        AuthenticationPageObservationFactsClassificationOutcome::Classified(
            AuthenticationPageObservationFactsBatch {
                observations: self
                    .observations
                    .iter()
                    .map(|observation| observation.facts.clone())
                    .collect(),
            }
            .classify(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct VersionedPageObservationScenario;

    impl VersionedPageObservationScenario {
        fn current() -> VersionedAuthenticationPageObservationFacts {
            VersionedAuthenticationPageObservationFacts::current(
                CurrentAuthenticationPageObservationFactsRequest {
                    facts: AuthenticationPageObservationFacts::default().into(),
                    credential_disclosure_control:
                        AuthenticationCredentialDisclosureControlObservation::Absent,
                },
            )
        }

        fn encoded_current() -> anyhow::Result<serde_json::Value> {
            Ok(serde_json::to_value(Self::current())?)
        }

        fn object_mut(
            value: &mut serde_json::Value,
        ) -> anyhow::Result<&mut serde_json::Map<String, serde_json::Value>> {
            let serde_json::Value::Object(object) = value else {
                anyhow::bail!("versioned observation must encode as an object");
            };
            Ok(object)
        }

        fn future() -> anyhow::Result<VersionedAuthenticationPageObservationFacts> {
            let mut encoded = Self::encoded_current()?;
            let object = Self::object_mut(&mut encoded)?;
            object.insert("schemaVersion".to_owned(), serde_json::json!(2));
            object.remove("credentialDisclosureControl");
            object.insert("renamedFutureBody".to_owned(), serde_json::json!({"safe": true}));
            Ok(serde_json::from_value(encoded)?)
        }

        fn malformed_current() -> anyhow::Result<VersionedAuthenticationPageObservationFacts> {
            let mut encoded = Self::encoded_current()?;
            Self::object_mut(&mut encoded)?.insert(
                "credentialDisclosureControl".to_owned(),
                serde_json::json!({"kind": "observed", "observations": []}),
            );
            Ok(serde_json::from_value(encoded)?)
        }

        fn assert_current_writer_and_round_trip_are_strict() -> anyhow::Result<()> {
            let encoded = Self::encoded_current()?;
            assert_eq!(encoded.get("schemaVersion"), Some(&serde_json::json!(1)));
            assert_eq!(
                encoded.get("credentialDisclosureControl"),
                Some(&serde_json::json!({"kind": "absent"}))
            );
            let decoded = serde_json::from_value::<VersionedAuthenticationPageObservationFacts>(
                encoded.clone(),
            )?;
            assert_eq!(decoded, Self::current());

            for field in ["schemaVersion", "facts", "credentialDisclosureControl"] {
                let mut missing = encoded.clone();
                Self::object_mut(&mut missing)?.remove(field);
                assert!(
                    serde_json::from_value::<VersionedAuthenticationPageObservationFacts>(missing)
                        .is_err()
                );
            }
            let mut unknown = encoded;
            Self::object_mut(&mut unknown)?
                .insert("unknownV1Field".to_owned(), serde_json::json!(true));
            assert!(
                serde_json::from_value::<VersionedAuthenticationPageObservationFacts>(unknown)
                    .is_err()
            );
            assert!(
                CurrentAuthenticationPageObservationFactsWire::DECL.contains("schemaVersion: 1")
            );
            assert!(CurrentAuthenticationPageObservationFactsWire::DECL.contains(
                "credentialDisclosureControl: AuthenticationCredentialDisclosureControlObservation"
            ));
            assert!(!CurrentAuthenticationPageObservationFactsWire::DECL
                .contains("credentialDisclosureControl?:"));
            assert!(CurrentAuthenticationPageObservationFactsRequest::DECL.contains(
                "credentialDisclosureControl: AuthenticationCredentialDisclosureControlObservation"
            ));
            assert!(!CurrentAuthenticationPageObservationFactsRequest::DECL
                .contains("credentialDisclosureControl?:"));
            Ok(())
        }

        fn assert_every_common_fact_is_required() -> anyhow::Result<()> {
            let encoded = Self::encoded_current()?;
            for field in [
                "fields",
                "ceremony",
                "authenticator",
                "credentialSubmission",
                "detailedAdvanceControl",
            ] {
                let mut missing = encoded.clone();
                let Some(facts) = Self::object_mut(&mut missing)?.get_mut("facts") else {
                    anyhow::bail!("current writer must emit common facts");
                };
                Self::object_mut(facts)?.remove(field);
                assert!(
                    serde_json::from_value::<VersionedAuthenticationPageObservationFacts>(missing)
                        .is_err()
                );
            }
            Ok(())
        }

        fn assert_future_body_is_opaque_but_common_facts_are_not() -> anyhow::Result<()> {
            let future = Self::future()?;
            assert_eq!(u32::from(future.schema_version()), 2);

            let mut malformed = serde_json::to_value(future)?;
            let Some(facts) = Self::object_mut(&mut malformed)?.get_mut("facts") else {
                anyhow::bail!("future writer must retain common facts");
            };
            Self::object_mut(facts)?.remove("fields");
            assert!(
                serde_json::from_value::<VersionedAuthenticationPageObservationFacts>(malformed)
                    .is_err()
            );
            Ok(())
        }

        fn nested_future() -> anyhow::Result<VersionedAuthenticationPageObservationFacts> {
            let mut encoded = Self::encoded_current()?;
            Self::object_mut(&mut encoded)?.insert(
                "credentialDisclosureControl".to_owned(),
                serde_json::json!({
                    "kind": "observed",
                    "observations": [{"schemaVersion": 2}]
                }),
            );
            Ok(serde_json::from_value(encoded)?)
        }

        fn assert_classification_precedence() -> anyhow::Result<()> {
            let current = Self::current();
            let future = Self::future()?;
            assert_eq!(
                (VersionedAuthenticationPageObservationFactsBatch {
                    observations: vec![current.clone()],
                })
                .classify(),
                AuthenticationPageObservationFactsClassificationOutcome::Classified(
                    AuthenticationWorkflowMatch::NoMatch
                )
            );
            for observations in [vec![future.clone()], vec![current.clone(), future.clone()]] {
                assert_eq!(
                    (VersionedAuthenticationPageObservationFactsBatch { observations }).classify(),
                    AuthenticationPageObservationFactsClassificationOutcome::UnsupportedVersion(
                        AuthenticationPageObservationFactsUnsupportedSchemaVersion::PageFacts {
                            version: 2.into()
                        }
                    )
                );
            }
            assert_eq!(
                (VersionedAuthenticationPageObservationFactsBatch {
                    observations: vec![Self::nested_future()?],
                })
                .classify(),
                AuthenticationPageObservationFactsClassificationOutcome::UnsupportedVersion(
                    AuthenticationPageObservationFactsUnsupportedSchemaVersion::DisclosureControl {
                        version: 2.into()
                    }
                )
            );

            let mut malformed_common = Self::future()?;
            malformed_common.facts.fields.username_field_count =
                (crate::MAX_AUTHENTICATION_OBSERVED_FIELD_COUNT + 1).into();
            assert_eq!(
                (VersionedAuthenticationPageObservationFactsBatch {
                    observations: vec![malformed_common],
                })
                .classify(),
                AuthenticationPageObservationFactsClassificationOutcome::Classified(
                    AuthenticationWorkflowMatch::Rejected
                )
            );

            let malformed = Self::malformed_current()?;
            for observations in [
                vec![malformed.clone(), future.clone()],
                vec![future, malformed],
            ] {
                assert_eq!(
                    (VersionedAuthenticationPageObservationFactsBatch { observations }).classify(),
                    AuthenticationPageObservationFactsClassificationOutcome::Classified(
                        AuthenticationWorkflowMatch::Rejected
                    )
                );
            }
            Ok(())
        }

        fn assert_batch_bounds() {
            assert_eq!(
                (VersionedAuthenticationPageObservationFactsBatch {
                    observations: Vec::new(),
                })
                .classify(),
                AuthenticationPageObservationFactsClassificationOutcome::Classified(
                    AuthenticationWorkflowMatch::Rejected
                )
            );
            assert_eq!(
                (VersionedAuthenticationPageObservationFactsBatch {
                    observations: vec![
                        Self::current();
                        crate::MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS + 1
                    ],
                })
                .classify(),
                AuthenticationPageObservationFactsClassificationOutcome::Classified(
                    AuthenticationWorkflowMatch::Rejected
                )
            );
        }
    }

    #[test]
    fn current_writer_and_round_trip_are_strict() -> anyhow::Result<()> {
        VersionedPageObservationScenario::assert_current_writer_and_round_trip_are_strict()
    }

    #[test]
    fn every_common_fact_is_required() -> anyhow::Result<()> {
        VersionedPageObservationScenario::assert_every_common_fact_is_required()
    }

    #[test]
    fn future_body_is_opaque_but_common_facts_are_not() -> anyhow::Result<()> {
        VersionedPageObservationScenario::assert_future_body_is_opaque_but_common_facts_are_not()
    }

    #[test]
    fn classification_validates_supported_entries_before_future_versions() -> anyhow::Result<()> {
        VersionedPageObservationScenario::assert_classification_precedence()
    }

    #[test]
    fn empty_and_oversized_batches_are_rejected() {
        VersionedPageObservationScenario::assert_batch_bounds();
    }
}

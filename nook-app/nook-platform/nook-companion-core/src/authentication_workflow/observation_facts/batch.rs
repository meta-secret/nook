//! Bounded classification for one browser page's authentication fact candidates.

use super::AuthenticationPageObservationFacts;
use crate::{
    AuthenticationPageObservation, AuthenticationPageObservations, AuthenticationWorkflowMatch,
};
use serde::{Deserialize, Serialize};
use tsify::Tsify;

mod wire;

pub use wire::{
    AuthenticationPageObservationFactsClassificationOutcome,
    AuthenticationPageObservationFactsSchemaVersion,
    AuthenticationPageObservationFactsUnsupportedSchemaVersion,
    CurrentAuthenticationPageObservationFactsRequest,
    CurrentAuthenticationPageObservationFactsWire,
    CurrentAuthenticationPageObservationFactsWireFacts,
    VersionedAuthenticationPageObservationFacts,
    VersionedAuthenticationPageObservationFactsBatch,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct AuthenticationPageObservationFactsBatch {
    pub observations: Vec<AuthenticationPageObservationFacts>,
}

impl AuthenticationPageObservationFactsBatch {
    pub(in crate::authentication_workflow) fn is_valid_binding(&self) -> bool {
        !self.observations.is_empty()
            && self.observations.len() <= crate::MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS
            && self
                .observations
                .iter()
                .all(AuthenticationPageObservationFacts::is_bounded)
    }

    #[must_use]
    pub fn classify(&self) -> AuthenticationWorkflowMatch {
        if self.observations.len() > crate::MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS
            || self
                .observations
                .iter()
                .any(|observation| !observation.is_bounded())
        {
            return AuthenticationWorkflowMatch::Rejected;
        }
        let observations = AuthenticationPageObservations {
            observations: self
                .observations
                .iter()
                .cloned()
                .map(|observation| {
                    if observation.has_progression() {
                        observation.into_observation()
                    } else {
                        AuthenticationPageObservation::default()
                    }
                })
                .collect(),
        };
        super::super::classify_authentication_workflow_candidates(&observations.observations)
    }
}

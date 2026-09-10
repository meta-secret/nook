//! Closed result boundary for authentication-workflow classification.

use super::AuthenticationWorkflowSnapshot;
use serde::{Deserialize, Serialize};
use tsify::Tsify;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "kind", content = "snapshot", rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum AuthenticationWorkflowMatch {
    NoMatch,
    Rejected,
    Matched(AuthenticationWorkflowSnapshot),
}

impl AuthenticationWorkflowMatch {
    pub const fn snapshot(
        self,
    ) -> Result<AuthenticationWorkflowSnapshot, AuthenticationWorkflowSnapshotError> {
        match self {
            Self::NoMatch => Err(AuthenticationWorkflowSnapshotError::NotDetected),
            Self::Rejected => Err(AuthenticationWorkflowSnapshotError::Rejected),
            Self::Matched(snapshot) => Ok(snapshot),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum AuthenticationWorkflowSnapshotError {
    #[error("authentication workflow was not detected")]
    NotDetected,
    #[error("authentication workflow observations were rejected")]
    Rejected,
}

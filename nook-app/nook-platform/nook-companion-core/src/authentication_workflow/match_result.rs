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
    UnsupportedVersion,
    Matched(AuthenticationWorkflowSnapshot),
}

impl AuthenticationWorkflowMatch {
    pub const fn snapshot(
        self,
    ) -> Result<AuthenticationWorkflowSnapshot, AuthenticationWorkflowSnapshotError> {
        match self {
            Self::NoMatch => Err(AuthenticationWorkflowSnapshotError::NotDetected),
            Self::Rejected => Err(AuthenticationWorkflowSnapshotError::Rejected),
            Self::UnsupportedVersion => {
                Err(AuthenticationWorkflowSnapshotError::UnsupportedVersion)
            }
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
    #[error("authentication workflow observation version is unsupported")]
    UnsupportedVersion,
}

#[cfg(test)]
mod tests {
    use super::*;

    struct AuthenticationWorkflowMatchScenario;

    impl AuthenticationWorkflowMatchScenario {
        fn assert_unsupported_version_remains_typed() -> anyhow::Result<()> {
            let outcome = AuthenticationWorkflowMatch::UnsupportedVersion;
            let encoded = serde_json::to_string(&outcome)?;
            let decoded = serde_json::from_str::<AuthenticationWorkflowMatch>(&encoded)?;
            assert_eq!(decoded, outcome);
            assert_eq!(
                decoded.snapshot(),
                Err(AuthenticationWorkflowSnapshotError::UnsupportedVersion)
            );
            assert_eq!(encoded, r#"{"kind":"unsupported-version"}"#);
            Ok(())
        }
    }

    #[test]
    fn unsupported_version_remains_a_typed_wire_outcome() -> anyhow::Result<()> {
        AuthenticationWorkflowMatchScenario::assert_unsupported_version_remains_typed()
    }
}

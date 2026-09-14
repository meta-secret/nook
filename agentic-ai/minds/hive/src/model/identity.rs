use super::ModelError;
use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct TaskId(String);

impl TryFrom<String> for TaskId {
    type Error = ModelError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        if value.trim().is_empty() {
            return Err(ModelError::EmptyId { kind: "TaskId" });
        }
        Ok(Self(value))
    }
}
impl TryFrom<&str> for TaskId {
    type Error = ModelError;
    fn try_from(value: &str) -> Result<Self, Self::Error> {
        Self::try_from(value.to_owned())
    }
}
impl From<TaskId> for String {
    fn from(value: TaskId) -> Self {
        value.0
    }
}
impl TaskId {
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for TaskId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct AgentId(String);

impl TryFrom<String> for AgentId {
    type Error = ModelError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        if value.trim().is_empty() {
            return Err(ModelError::EmptyId { kind: "AgentId" });
        }
        Ok(Self(value))
    }
}
impl TryFrom<&str> for AgentId {
    type Error = ModelError;
    fn try_from(value: &str) -> Result<Self, Self::Error> {
        Self::try_from(value.to_owned())
    }
}
impl From<AgentId> for String {
    fn from(value: AgentId) -> Self {
        value.0
    }
}
impl AgentId {
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for AgentId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct AttemptId(String);

impl TryFrom<String> for AttemptId {
    type Error = ModelError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        if value.trim().is_empty() {
            return Err(ModelError::EmptyId { kind: "AttemptId" });
        }
        Ok(Self(value))
    }
}
impl TryFrom<&str> for AttemptId {
    type Error = ModelError;
    fn try_from(value: &str) -> Result<Self, Self::Error> {
        Self::try_from(value.to_owned())
    }
}
impl From<AttemptId> for String {
    fn from(value: AttemptId) -> Self {
        value.0
    }
}
impl AttemptId {
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for AttemptId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct LeaseToken(String);

impl TryFrom<String> for LeaseToken {
    type Error = ModelError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        if value.trim().is_empty() {
            return Err(ModelError::EmptyId { kind: "LeaseToken" });
        }
        Ok(Self(value))
    }
}
impl TryFrom<&str> for LeaseToken {
    type Error = ModelError;
    fn try_from(value: &str) -> Result<Self, Self::Error> {
        Self::try_from(value.to_owned())
    }
}
impl From<LeaseToken> for String {
    fn from(value: LeaseToken) -> Self {
        value.0
    }
}
impl LeaseToken {
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for LeaseToken {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct GitSha(String);

impl TryFrom<String> for GitSha {
    type Error = ModelError;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        if value.len() != 40 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(ModelError::InvalidGitSha);
        }
        Ok(Self(value.to_ascii_lowercase()))
    }
}

impl TryFrom<&str> for GitSha {
    type Error = ModelError;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        Self::try_from(value.to_owned())
    }
}

impl From<GitSha> for String {
    fn from(value: GitSha) -> Self {
        value.0
    }
}

impl GitSha {
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for GitSha {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

/// The canonical feature branch selected by Gizmo Prime.
///
/// Hive may observe the branch's current head, but it never accepts a caller
/// supplied commit as the branch identity. Keeping the branch name typed also
/// prevents delivery helpers from accidentally using a temporary Hive branch.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct FeatureBranch(String);

impl TryFrom<String> for FeatureBranch {
    type Error = ModelError;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        let segments = value.strip_prefix("codex/").and_then(|branch| {
            if branch.is_empty() || branch.ends_with('/') {
                None
            } else {
                Some(branch.split('/').collect::<Vec<_>>())
            }
        });
        let valid = value.len() <= 120
            && segments.is_some_and(|segments| {
                match segments.as_slice() {
                    // Prime's published feature branch is the exact two-segment
                    // form. Child branches use the fully qualified form below.
                    [feature] => {
                        Self::is_kebab_segment(feature, 10, 20)
                            || Self::is_canonical_machine_branch(&segments)
                    }
                    [feature, team, role, work] => {
                        Self::is_kebab_segment(feature, 10, 20)
                            && Self::is_canonical_team(team)
                            && Self::is_canonical_role(team, role)
                            && Self::is_kebab_segment(work, 20, 50)
                            && *work != "cleanup"
                    }
                    _ => Self::is_canonical_machine_branch(&segments),
                }
            });
        if !valid {
            return Err(ModelError::InvalidFeatureBranch);
        }
        Ok(Self(value))
    }
}

impl TryFrom<&str> for FeatureBranch {
    type Error = ModelError;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        Self::try_from(value.to_owned())
    }
}

impl From<FeatureBranch> for String {
    fn from(value: FeatureBranch) -> Self {
        value.0
    }
}

impl FeatureBranch {
    fn is_kebab_segment(segment: &str, minimum: usize, maximum: usize) -> bool {
        let bytes = segment.as_bytes();
        !bytes.is_empty()
            && bytes.len() >= minimum
            && bytes.len() <= maximum
            && !segment.starts_with('-')
            && !segment.ends_with('-')
            && !segment.contains("--")
            && bytes
                .iter()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || *byte == b'-')
    }

    fn is_canonical_team(team: &str) -> bool {
        matches!(
            team,
            "ai" | "dev-core" | "security" | "sre" | "web-dev" | "delivery-pipeline"
        )
    }

    fn is_canonical_role(team: &str, role: &str) -> bool {
        match team {
            "ai" => matches!(role, "gizmo" | "loom-specialist" | "cortex-specialist"),
            "dev-core" => {
                matches!(
                    role,
                    "gizmo" | "rust-core-developer" | "rust-auth2-developer"
                )
            }
            "security" => matches!(
                role,
                "gizmo" | "cryptography-specialist" | "security-review-specialist"
            ),
            "sre" => matches!(role, "gizmo" | "provisioning" | "cloud-native"),
            "web-dev" => matches!(
                role,
                "gizmo" | "typescript-specialist" | "svelte-specialist"
            ),
            "delivery-pipeline" => matches!(role, "gizmo" | "dev-manager" | "pr-lifecycle"),
            _ => false,
        }
    }

    fn is_canonical_machine_branch(segments: &[&str]) -> bool {
        if segments.len() != 1 {
            return false;
        }
        let Some(suffix) = segments
            .first()
            .and_then(|segment| segment.strip_prefix("hive-"))
        else {
            return false;
        };
        !suffix.is_empty()
            && !suffix.contains("--")
            && suffix
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
            && !suffix.starts_with('-')
            && !suffix.ends_with('-')
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for FeatureBranch {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

#[cfg(test)]
mod tests {
    use super::{AgentId, AttemptId, FeatureBranch, GitSha, LeaseToken, TaskId};
    #[test]
    fn decoding_rejects_empty_identifiers() {
        for encoded in [r#""""#, r#""   ""#] {
            assert!(serde_json::from_str::<TaskId>(encoded).is_err());
            assert!(serde_json::from_str::<AgentId>(encoded).is_err());
            assert!(serde_json::from_str::<AttemptId>(encoded).is_err());
            assert!(serde_json::from_str::<LeaseToken>(encoded).is_err());
        }
    }
    #[test]
    fn conversion_preserves_exact_identifier_text() -> crate::HiveResult<()> {
        let id = TaskId::try_from(" task-1 ")?;
        assert_eq!(id.as_str(), " task-1 ");
        assert_eq!(serde_json::to_string(&id)?, r#"" task-1 ""#);
        assert_eq!(String::from(id), " task-1 ");
        Ok(())
    }

    #[test]
    fn git_sha_requires_a_full_hex_object_id() -> crate::HiveResult<()> {
        assert!(GitSha::try_from("not-a-sha").is_err());
        let sha = GitSha::try_from("ABCDEF0123456789ABCDEF0123456789ABCDEF01")?;
        assert_eq!(sha.as_str(), "abcdef0123456789abcdef0123456789abcdef01");
        assert_eq!(
            String::from(sha),
            "abcdef0123456789abcdef0123456789abcdef01"
        );
        Ok(())
    }

    #[test]
    fn feature_branch_requires_a_canonical_codex_ref() -> crate::HiveResult<()> {
        let branch = FeatureBranch::try_from("codex/repair-cache")?;
        assert_eq!(branch.as_str(), "codex/repair-cache");
        let child = FeatureBranch::try_from(
            "codex/agent-branching/sre/provisioning/fix-hive-branch-compile",
        )?;
        assert_eq!(
            child.as_str(),
            "codex/agent-branching/sre/provisioning/fix-hive-branch-compile"
        );
        let machine = FeatureBranch::try_from("codex/hive-main-failure-abc-run-42-attempt-1")?;
        assert_eq!(
            machine.as_str(),
            "codex/hive-main-failure-abc-run-42-attempt-1"
        );
        for invalid in [
            "main",
            "codex/",
            "codex/repair",
            "codex/../main",
            "codex/Repair-cache",
            "codex/agent-branching/sre/provisioning/short",
            "codex/agent-branching/web-dev/provisioning/fix-hive-branch-compile",
            "codex/hive-",
            "codex/hive-main--failure",
        ] {
            assert!(FeatureBranch::try_from(invalid).is_err());
        }
        Ok(())
    }
}

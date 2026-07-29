use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum ModelError {
    #[error("{kind} must not be empty")]
    EmptyId { kind: &'static str },
    #[error("no task was claimable")]
    NoClaimableTask,
    #[error("task kind must not be empty")]
    EmptyTaskKind,
    #[error("task prompt must not be empty")]
    EmptyTaskPrompt,
    #[error("source_commit must be a full 40-character Git object id")]
    InvalidSourceCommit,
    #[error("max_attempts must be at least one")]
    InvalidMaxAttempts,
    #[error("a task cannot depend on itself")]
    SelfDependency,
    #[error("terminal result summary must not be empty")]
    EmptyTerminalSummary,
    #[error("terminal result changed_files entries must not be empty")]
    EmptyTerminalChangedFile,
    #[error("terminal result tests entries must not be empty")]
    EmptyTerminalTest,
    #[error("a completed terminal result must not report a blocker")]
    CompletedWithBlocker,
    #[error("an absent blocker must have empty id, title, and prompt")]
    AbsentBlockerHasDetails,
    #[error("a blocked terminal result must report a blocker")]
    BlockedWithoutBlocker,
    #[error("a present blocker must include a title")]
    EmptyBlockerTitle,
    #[error("a present blocker must include a prompt")]
    EmptyBlockerPrompt,
}

macro_rules! string_id {
    ($name:ident) => {
        #[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(String);

        impl $name {
            pub fn new(value: impl Into<String>) -> Result<Self, ModelError> {
                let value = value.into();
                if value.trim().is_empty() {
                    return Err(ModelError::EmptyId {
                        kind: stringify!($name),
                    });
                }
                Ok(Self(value))
            }

            pub fn as_str(&self) -> &str {
                &self.0
            }
        }

        impl std::fmt::Display for $name {
            fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str(&self.0)
            }
        }
    };
}

string_id!(TaskId);
string_id!(AgentId);
string_id!(AttemptId);
string_id!(LeaseToken);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActivityKind {
    Started,
    Action,
    Result,
    Edit,
    Warning,
    Retry,
    Report,
    Error,
}

impl ActivityKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Started => "started",
            Self::Action => "action",
            Self::Result => "result",
            Self::Edit => "edit",
            Self::Warning => "warning",
            Self::Retry => "retry",
            Self::Report => "report",
            Self::Error => "error",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TaskActivity {
    pub kind: ActivityKind,
    pub message: String,
    pub detail: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CancellationTarget {
    pub task_id: TaskId,
    pub pod_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Artifact {
    pub id: String,
    pub kind: String,
    pub uri: String,
    pub digest: String,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", content = "artifact", rename_all = "snake_case")]
pub enum CompletionArtifact {
    NotProduced,
    Produced(Artifact),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClaimedTask {
    pub id: TaskId,
    pub kind: String,
    pub prompt: String,
    pub source_commit: String,
    pub attempt_id: AttemptId,
    pub attempt_number: i64,
    pub lease_token: LeaseToken,
    pub dependency_context: Vec<DependencyResult>,
    pub dependency_artifacts: Vec<Artifact>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ActivityLease {
    pub task_id: TaskId,
    pub attempt_id: AttemptId,
    pub lease_token: LeaseToken,
}

impl From<&ClaimedTask> for ActivityLease {
    fn from(task: &ClaimedTask) -> Self {
        Self {
            task_id: task.id.clone(),
            attempt_id: task.attempt_id.clone(),
            lease_token: task.lease_token.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", content = "task", rename_all = "snake_case")]
pub enum ClaimOutcome {
    NoTask,
    Claimed(ClaimedTask),
}

impl ClaimOutcome {
    #[must_use]
    pub const fn is_idle(&self) -> bool {
        matches!(self, Self::NoTask)
    }

    pub fn into_claimed(self) -> Result<ClaimedTask, ModelError> {
        match self {
            Self::Claimed(task) => Ok(task),
            Self::NoTask => Err(ModelError::NoClaimableTask),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DependencyResult {
    pub id: TaskId,
    pub summary: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TaskTrigger {
    AgentDependency,
    GitHubMainFailure,
    ManualCli,
}

impl TaskTrigger {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::AgentDependency => "agent-dependency",
            Self::GitHubMainFailure => "github-main-failure",
            Self::ManualCli => "manual-cli",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EnqueueTask {
    pub id: TaskId,
    pub kind: String,
    pub trigger: TaskTrigger,
    pub prompt: String,
    pub source_commit: String,
    pub priority: i64,
    pub max_attempts: i64,
    pub dependencies: Vec<TaskId>,
}

impl EnqueueTask {
    pub fn validate(&self) -> Result<(), ModelError> {
        if self.kind.trim().is_empty() {
            return Err(ModelError::EmptyTaskKind);
        }
        if self.prompt.trim().is_empty() {
            return Err(ModelError::EmptyTaskPrompt);
        }
        if self.source_commit.len() != 40
            || !self
                .source_commit
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit())
        {
            return Err(ModelError::InvalidSourceCommit);
        }
        if self.max_attempts < 1 {
            return Err(ModelError::InvalidMaxAttempts);
        }
        if self
            .dependencies
            .iter()
            .any(|dependency| dependency == &self.id)
        {
            return Err(ModelError::SelfDependency);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BlockerRequest {
    pub id: TaskId,
    pub title: String,
    pub prompt: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TerminalResult {
    Completed {
        summary: String,
        changed_files: Vec<String>,
        tests: Vec<String>,
    },
    Blocked {
        summary: String,
        changed_files: Vec<String>,
        tests: Vec<String>,
        blocker: BlockerRequest,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
enum WireTerminalStatus {
    Completed,
    Blocked,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct WireBlockerResult {
    present: bool,
    id: String,
    title: String,
    prompt: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct WireTerminalResult {
    status: WireTerminalStatus,
    summary: String,
    changed_files: Vec<String>,
    tests: Vec<String>,
    blocker: WireBlockerResult,
}

impl TryFrom<WireTerminalResult> for TerminalResult {
    type Error = ModelError;

    fn try_from(wire: WireTerminalResult) -> Result<Self, Self::Error> {
        if wire.summary.trim().is_empty() {
            return Err(ModelError::EmptyTerminalSummary);
        }
        if wire.changed_files.iter().any(|path| path.trim().is_empty()) {
            return Err(ModelError::EmptyTerminalChangedFile);
        }
        if wire.tests.iter().any(|test| test.trim().is_empty()) {
            return Err(ModelError::EmptyTerminalTest);
        }

        let WireTerminalResult {
            status,
            summary,
            changed_files,
            tests,
            blocker,
        } = wire;
        match status {
            WireTerminalStatus::Completed => {
                if blocker.present {
                    return Err(ModelError::CompletedWithBlocker);
                }
                if !blocker.id.is_empty() || !blocker.title.is_empty() || !blocker.prompt.is_empty()
                {
                    return Err(ModelError::AbsentBlockerHasDetails);
                }
                Ok(Self::Completed {
                    summary,
                    changed_files,
                    tests,
                })
            }
            WireTerminalStatus::Blocked => {
                if !blocker.present {
                    return Err(ModelError::BlockedWithoutBlocker);
                }
                if blocker.title.trim().is_empty() {
                    return Err(ModelError::EmptyBlockerTitle);
                }
                if blocker.prompt.trim().is_empty() {
                    return Err(ModelError::EmptyBlockerPrompt);
                }
                Ok(Self::Blocked {
                    summary,
                    changed_files,
                    tests,
                    blocker: BlockerRequest {
                        id: TaskId::new(blocker.id)?,
                        title: blocker.title,
                        prompt: blocker.prompt,
                    },
                })
            }
        }
    }
}

impl<'de> Deserialize<'de> for TerminalResult {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let wire = WireTerminalResult::deserialize(deserializer)?;
        Self::try_from(wire).map_err(serde::de::Error::custom)
    }
}

impl TerminalResult {
    pub fn summary(&self) -> &str {
        match self {
            Self::Completed { summary, .. } | Self::Blocked { summary, .. } => summary,
        }
    }

    pub fn changed_files(&self) -> &[String] {
        match self {
            Self::Completed { changed_files, .. } | Self::Blocked { changed_files, .. } => {
                changed_files
            }
        }
    }

    pub fn tests(&self) -> &[String] {
        match self {
            Self::Completed { tests, .. } | Self::Blocked { tests, .. } => tests,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{EnqueueTask, ModelError, TaskId, TaskTrigger, TerminalResult};

    #[test]
    fn enqueue_rejects_self_dependency() -> crate::HiveResult<()> {
        let task_id = TaskId::new("task-1")?;
        let task = EnqueueTask {
            id: task_id.clone(),
            kind: "code".to_owned(),
            trigger: TaskTrigger::ManualCli,
            prompt: "Implement it".to_owned(),
            source_commit: "0123456789abcdef0123456789abcdef01234567".to_owned(),
            priority: 1,
            max_attempts: 2,
            dependencies: vec![task_id],
        };

        assert_eq!(task.validate(), Err(ModelError::SelfDependency));
        Ok(())
    }

    #[test]
    fn terminal_result_validates_wire_status_and_blocker_state() -> crate::HiveResult<()> {
        let completed = serde_json::json!({
            "status": "completed",
            "summary": "Implemented the change",
            "changed_files": ["src/model.rs"],
            "tests": ["cargo test"],
            "blocker": {
                "present": false,
                "id": "",
                "title": "",
                "prompt": ""
            }
        });
        assert!(matches!(
            serde_json::from_value::<TerminalResult>(completed)?,
            TerminalResult::Completed { .. }
        ));

        let completed_with_blocker = serde_json::json!({
            "status": "completed",
            "summary": "Implemented the change",
            "changed_files": [],
            "tests": [],
            "blocker": {
                "present": true,
                "id": "repair-cache",
                "title": "Repair cache",
                "prompt": "Restore the cache invariant"
            }
        });
        let error = match serde_json::from_value::<TerminalResult>(completed_with_blocker) {
            Ok(_) => crate::hive_bail!("completed result with a blocker was accepted"),
            Err(error) => error,
        };
        assert!(error.to_string().contains("must not report a blocker"));

        let blocked_without_blocker = serde_json::json!({
            "status": "blocked",
            "summary": "Waiting for prerequisite",
            "changed_files": [],
            "tests": [],
            "blocker": {
                "present": false,
                "id": "",
                "title": "",
                "prompt": ""
            }
        });
        let error = match serde_json::from_value::<TerminalResult>(blocked_without_blocker) {
            Ok(_) => crate::hive_bail!("blocked result without a blocker was accepted"),
            Err(error) => error,
        };
        assert!(error.to_string().contains("must report a blocker"));

        Ok(())
    }

    #[test]
    fn terminal_result_rejects_empty_content_entries() -> crate::HiveResult<()> {
        let terminal_result = serde_json::json!({
            "status": "completed",
            "summary": " ",
            "changed_files": [" "],
            "tests": [" "],
            "blocker": {
                "present": false,
                "id": "",
                "title": "",
                "prompt": ""
            }
        });

        let error = match serde_json::from_value::<TerminalResult>(terminal_result) {
            Ok(_) => crate::hive_bail!("empty terminal content was accepted"),
            Err(error) => error,
        };
        assert!(error.to_string().contains("summary must not be empty"));
        Ok(())
    }
}

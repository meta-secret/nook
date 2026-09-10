use std::fmt::{Display, Formatter, Result as FormatResult};

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(from = "String", into = "String")]
pub enum ObservedTaskState {
    Ready,
    Running,
    Completed,
    Failed,
    Blocked,
    Cancelling,
    Cancelled,
    Other(String),
}
impl From<String> for ObservedTaskState {
    fn from(value: String) -> Self {
        match value.as_str() {
            "READY" => Self::Ready,
            "RUNNING" => Self::Running,
            "COMPLETED" => Self::Completed,
            "FAILED" => Self::Failed,
            "BLOCKED" => Self::Blocked,
            "CANCELLING" => Self::Cancelling,
            "CANCELLED" => Self::Cancelled,
            _ => Self::Other(value),
        }
    }
}
impl From<&str> for ObservedTaskState {
    fn from(value: &str) -> Self {
        Self::from(value.to_owned())
    }
}
impl ObservedTaskState {
    pub fn as_str(&self) -> &str {
        match self {
            Self::Ready => "READY",
            Self::Running => "RUNNING",
            Self::Completed => "COMPLETED",
            Self::Failed => "FAILED",
            Self::Blocked => "BLOCKED",
            Self::Cancelling => "CANCELLING",
            Self::Cancelled => "CANCELLED",
            Self::Other(value) => value,
        }
    }
}
impl From<ObservedTaskState> for String {
    fn from(value: ObservedTaskState) -> Self {
        match value {
            ObservedTaskState::Other(value) => value,
            value => value.as_str().to_owned(),
        }
    }
}
impl Display for ObservedTaskState {
    fn fmt(&self, f: &mut Formatter<'_>) -> FormatResult {
        f.write_str(self.as_str())
    }
}
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(from = "String", into = "String")]
pub enum ObservedTaskTrigger {
    AgentDependency,
    GitHubMainFailure,
    ManualCli,
    Other(String),
}
impl From<String> for ObservedTaskTrigger {
    fn from(value: String) -> Self {
        match value.as_str() {
            "agent-dependency" => Self::AgentDependency,
            "github-main-failure" => Self::GitHubMainFailure,
            "manual-cli" => Self::ManualCli,
            _ => Self::Other(value),
        }
    }
}
impl From<&str> for ObservedTaskTrigger {
    fn from(value: &str) -> Self {
        Self::from(value.to_owned())
    }
}
impl ObservedTaskTrigger {
    pub fn as_str(&self) -> &str {
        match self {
            Self::AgentDependency => "agent-dependency",
            Self::GitHubMainFailure => "github-main-failure",
            Self::ManualCli => "manual-cli",
            Self::Other(value) => value,
        }
    }
}
impl From<ObservedTaskTrigger> for String {
    fn from(value: ObservedTaskTrigger) -> Self {
        match value {
            ObservedTaskTrigger::Other(value) => value,
            value => value.as_str().to_owned(),
        }
    }
}
impl Display for ObservedTaskTrigger {
    fn fmt(&self, f: &mut Formatter<'_>) -> FormatResult {
        f.write_str(self.as_str())
    }
}
impl Default for ObservedTaskTrigger {
    fn default() -> Self {
        Self::Other(String::new())
    }
}

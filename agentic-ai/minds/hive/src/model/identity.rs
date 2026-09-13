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

#[cfg(test)]
mod tests {
    use super::{AgentId, AttemptId, LeaseToken, TaskId};
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
}

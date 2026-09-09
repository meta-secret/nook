#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(from = "String", into = "String")]
pub enum CheckExecution {
    Completed,
    Other(String),
}
impl From<String> for CheckExecution {
    fn from(value: String) -> Self {
        match value.as_str() {
            "COMPLETED" => Self::Completed,
            _ => Self::Other(value),
        }
    }
}
impl From<&str> for CheckExecution {
    fn from(value: &str) -> Self {
        Self::from(value.to_owned())
    }
}
impl CheckExecution {
    pub fn as_str(&self) -> &str {
        match self {
            Self::Completed => "COMPLETED",
            Self::Other(value) => value,
        }
    }
}
impl From<CheckExecution> for String {
    fn from(value: CheckExecution) -> Self {
        match value {
            CheckExecution::Other(value) => value,
            value => value.as_str().to_owned(),
        }
    }
}
impl std::fmt::Display for CheckExecution {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(from = "String", into = "String")]
pub enum CheckConclusion {
    Success,
    Cancelled,
    Skipped,
    Neutral,
    Other(String),
}
impl From<String> for CheckConclusion {
    fn from(value: String) -> Self {
        match value.as_str() {
            "SUCCESS" => Self::Success,
            "CANCELLED" => Self::Cancelled,
            "SKIPPED" => Self::Skipped,
            "NEUTRAL" => Self::Neutral,
            _ => Self::Other(value),
        }
    }
}
impl From<&str> for CheckConclusion {
    fn from(value: &str) -> Self {
        Self::from(value.to_owned())
    }
}
impl CheckConclusion {
    pub fn as_str(&self) -> &str {
        match self {
            Self::Success => "SUCCESS",
            Self::Cancelled => "CANCELLED",
            Self::Skipped => "SKIPPED",
            Self::Neutral => "NEUTRAL",
            Self::Other(value) => value,
        }
    }
}
impl From<CheckConclusion> for String {
    fn from(value: CheckConclusion) -> Self {
        match value {
            CheckConclusion::Other(value) => value,
            value => value.as_str().to_owned(),
        }
    }
}
impl std::fmt::Display for CheckConclusion {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}
impl Default for CheckExecution {
    fn default() -> Self {
        Self::Other(String::new())
    }
}
impl Default for CheckConclusion {
    fn default() -> Self {
        Self::Other(String::new())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(from = "String", into = "String")]
pub enum RunExecution {
    Completed,
    Other(String),
}
impl From<String> for RunExecution {
    fn from(value: String) -> Self {
        match value.as_str() {
            "completed" => Self::Completed,
            _ => Self::Other(value),
        }
    }
}
impl From<&str> for RunExecution {
    fn from(value: &str) -> Self {
        Self::from(value.to_owned())
    }
}
impl RunExecution {
    pub fn as_str(&self) -> &str {
        match self {
            Self::Completed => "completed",
            Self::Other(value) => value,
        }
    }
}
impl From<RunExecution> for String {
    fn from(value: RunExecution) -> Self {
        match value {
            RunExecution::Other(value) => value,
            value => value.as_str().to_owned(),
        }
    }
}
impl std::fmt::Display for RunExecution {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(from = "String", into = "String")]
pub enum RunConclusion {
    Success,
    Cancelled,
    Skipped,
    Neutral,
    Other(String),
}
impl From<String> for RunConclusion {
    fn from(value: String) -> Self {
        match value.as_str() {
            "success" => Self::Success,
            "cancelled" => Self::Cancelled,
            "skipped" => Self::Skipped,
            "neutral" => Self::Neutral,
            _ => Self::Other(value),
        }
    }
}
impl From<&str> for RunConclusion {
    fn from(value: &str) -> Self {
        Self::from(value.to_owned())
    }
}
impl RunConclusion {
    pub fn as_str(&self) -> &str {
        match self {
            Self::Success => "success",
            Self::Cancelled => "cancelled",
            Self::Skipped => "skipped",
            Self::Neutral => "neutral",
            Self::Other(value) => value,
        }
    }
}
impl From<RunConclusion> for String {
    fn from(value: RunConclusion) -> Self {
        match value {
            RunConclusion::Other(value) => value,
            value => value.as_str().to_owned(),
        }
    }
}
impl std::fmt::Display for RunConclusion {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

#[cfg(test)]
mod tests {
    use super::{CheckConclusion, CheckExecution, RunConclusion};
    #[test]
    fn unknown_states_keep_their_exact_diagnostic_representation() -> serde_json::Result<()> {
        let value: CheckConclusion = serde_json::from_str(r#""new-result""#)?;
        assert!(matches!(&value, CheckConclusion::Other(_)));
        assert_eq!(value.to_string(), "new-result");
        assert_eq!(serde_json::to_string(&value)?, r#""new-result""#);
        assert!(matches!(
            CheckExecution::from("completed"),
            CheckExecution::Other(_)
        ));
        assert!(matches!(
            RunConclusion::from("SUCCESS"),
            RunConclusion::Other(_)
        ));
        Ok(())
    }
}

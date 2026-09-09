#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(from = "String", into = "String")]
pub enum TaskKind {
    MainRepair,
    Blocker,
    Other(String),
}
impl From<String> for TaskKind {
    fn from(value: String) -> Self {
        match value.as_str() {
            "main-repair" => Self::MainRepair,
            "blocker" => Self::Blocker,
            _ => Self::Other(value),
        }
    }
}
impl From<&str> for TaskKind {
    fn from(value: &str) -> Self {
        Self::from(value.to_owned())
    }
}
impl TaskKind {
    pub fn as_str(&self) -> &str {
        match self {
            Self::MainRepair => "main-repair",
            Self::Blocker => "blocker",
            Self::Other(value) => value,
        }
    }
}
impl From<TaskKind> for String {
    fn from(value: TaskKind) -> Self {
        match value {
            TaskKind::Other(value) => value,
            value => value.as_str().to_owned(),
        }
    }
}
impl std::fmt::Display for TaskKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl TaskKind {
    pub fn is_main_repair(&self) -> bool {
        matches!(self, Self::MainRepair)
    }
    pub fn is_blocker(&self) -> bool {
        matches!(self, Self::Blocker)
    }
    pub fn allows_prerequisite(&self) -> bool {
        !self.is_blocker()
    }
    pub fn prerequisite_priority(&self) -> i64 {
        match self {
            Self::MainRepair => 200,
            Self::Blocker | Self::Other(_) => 10,
        }
    }
    pub fn is_empty(&self) -> bool {
        self.as_str().trim().is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::TaskKind;
    #[test]
    fn task_kind_owns_prerequisite_policy() {
        assert!(!TaskKind::Blocker.allows_prerequisite());
        assert_eq!(TaskKind::MainRepair.prerequisite_priority(), 200);
        assert_eq!(TaskKind::from("custom").prerequisite_priority(), 10);
    }
    #[test]
    fn custom_kind_roundtrips_without_normalization() -> serde_json::Result<()> {
        let value: TaskKind = serde_json::from_str(r#"" custom-kind ""#)?;
        assert_eq!(value.as_str(), " custom-kind ");
        assert_eq!(serde_json::to_string(&value)?, r#"" custom-kind ""#);
        assert!(TaskKind::from("  ").is_empty());
        Ok(())
    }
}

impl TaskKind {
    pub fn completion_relevance(
        &self,
        reported: super::CompletionRelevance,
    ) -> super::CompletionRelevance {
        match self {
            Self::Blocker => reported,
            Self::MainRepair | Self::Other(_) => super::CompletionRelevance::Current,
        }
    }
}

use serde::{Deserialize, Serialize};

macro_rules! string_id {
    ($name:ident) => {
        #[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(String);

        impl $name {
            pub fn new(value: impl Into<String>) -> Result<Self, String> {
                let value = value.into();
                if value.trim().is_empty() {
                    return Err(concat!(stringify!($name), " must not be empty").to_owned());
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Artifact {
    pub id: String,
    pub kind: String,
    pub uri: String,
    pub digest: String,
    pub content: String,
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
pub struct DependencyResult {
    pub id: TaskId,
    pub summary: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EnqueueTask {
    pub id: TaskId,
    pub kind: String,
    pub prompt: String,
    pub source_commit: String,
    pub priority: i64,
    pub max_attempts: i64,
    pub dependencies: Vec<TaskId>,
}

impl EnqueueTask {
    pub fn validate(&self) -> Result<(), String> {
        if self.kind.trim().is_empty() {
            return Err("task kind must not be empty".to_owned());
        }
        if self.prompt.trim().is_empty() {
            return Err("task prompt must not be empty".to_owned());
        }
        if self.source_commit.len() != 40
            || !self
                .source_commit
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit())
        {
            return Err("source_commit must be a full 40-character Git object id".to_owned());
        }
        if self.max_attempts < 1 {
            return Err("max_attempts must be at least one".to_owned());
        }
        if self
            .dependencies
            .iter()
            .any(|dependency| dependency == &self.id)
        {
            return Err("a task cannot depend on itself".to_owned());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TerminalResult {
    pub status: TerminalStatus,
    pub summary: String,
    pub changed_files: Vec<String>,
    pub tests: Vec<String>,
    pub blocker: BlockerResult,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BlockerResult {
    pub present: bool,
    pub id: String,
    pub title: String,
    pub prompt: String,
}

impl BlockerResult {
    pub fn none() -> Self {
        Self {
            present: false,
            id: String::new(),
            title: String::new(),
            prompt: String::new(),
        }
    }

    pub fn into_request(self) -> Result<Option<BlockerRequest>, String> {
        if !self.present {
            if self.id.is_empty() && self.title.is_empty() && self.prompt.is_empty() {
                return Ok(None);
            }
            return Err("an absent blocker must have empty id, title, and prompt".to_owned());
        }
        if self.title.trim().is_empty() || self.prompt.trim().is_empty() {
            return Err("a present blocker must include a title and prompt".to_owned());
        }
        Ok(Some(BlockerRequest {
            id: TaskId::new(self.id)?,
            title: self.title,
            prompt: self.prompt,
        }))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BlockerRequest {
    pub id: TaskId,
    pub title: String,
    pub prompt: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TerminalStatus {
    Completed,
    Blocked,
}

#[cfg(test)]
mod tests {
    use super::{BlockerResult, EnqueueTask, TaskId, TerminalResult, TerminalStatus};

    #[test]
    fn enqueue_rejects_self_dependency() {
        let task_id = TaskId::new("task-1").expect("valid id");
        let task = EnqueueTask {
            id: task_id.clone(),
            kind: "code".to_owned(),
            prompt: "Implement it".to_owned(),
            source_commit: "0123456789abcdef0123456789abcdef01234567".to_owned(),
            priority: 1,
            max_attempts: 2,
            dependencies: vec![task_id],
        };

        assert_eq!(
            task.validate().expect_err("self dependency must fail"),
            "a task cannot depend on itself"
        );
    }

    #[test]
    fn blocker_result_has_one_strict_object_shape() {
        assert_eq!(
            BlockerResult::none()
                .into_request()
                .expect("absent blocker"),
            None
        );
        assert!(
            BlockerResult {
                present: false,
                id: "unexpected".to_owned(),
                title: String::new(),
                prompt: String::new(),
            }
            .into_request()
            .expect_err("absent blocker details must be empty")
            .contains("absent blocker")
        );
        let blocker = BlockerResult {
            present: true,
            id: "repair-cache".to_owned(),
            title: "Repair the cache".to_owned(),
            prompt: "Restore the cache invariant".to_owned(),
        }
        .into_request()
        .expect("valid blocker")
        .expect("present blocker");
        assert_eq!(blocker.id.as_str(), "repair-cache");
    }

    #[test]
    fn terminal_results_decode_completed_and_blocked_shapes() {
        let completed: TerminalResult = serde_json::from_str(
            r#"{
              "status":"completed",
              "summary":"done",
              "changed_files":[],
              "tests":[],
              "blocker":{"present":false,"id":"","title":"","prompt":""}
            }"#,
        )
        .expect("completed terminal result");
        assert_eq!(completed.status, TerminalStatus::Completed);
        assert_eq!(
            completed
                .blocker
                .into_request()
                .expect("completed blocker shape"),
            None
        );

        let blocked: TerminalResult = serde_json::from_str(
            r#"{
              "status":"blocked",
              "summary":"needs cache repair",
              "changed_files":[],
              "tests":[],
              "blocker":{
                "present":true,
                "id":"repair-cache",
                "title":"Repair cache",
                "prompt":"Restore the cache invariant"
              }
            }"#,
        )
        .expect("blocked terminal result");
        assert_eq!(blocked.status, TerminalStatus::Blocked);
        assert_eq!(
            blocked
                .blocker
                .into_request()
                .expect("blocked blocker shape")
                .expect("present blocker")
                .id
                .as_str(),
            "repair-cache"
        );
    }
}

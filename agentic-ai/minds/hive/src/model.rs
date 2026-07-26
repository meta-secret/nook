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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClaimedTask {
    pub id: TaskId,
    pub kind: String,
    pub prompt: String,
    pub attempt_id: AttemptId,
    pub attempt_number: i64,
    pub lease_token: LeaseToken,
    pub dependency_context: Vec<DependencyResult>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DependencyResult {
    pub id: TaskId,
    pub summary: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnqueueTask {
    pub id: TaskId,
    pub kind: String,
    pub prompt: String,
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
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TerminalStatus {
    Completed,
    Blocked,
}

#[cfg(test)]
mod tests {
    use super::{EnqueueTask, TaskId};

    #[test]
    fn enqueue_rejects_self_dependency() {
        let task_id = TaskId::new("task-1").expect("valid id");
        let task = EnqueueTask {
            id: task_id.clone(),
            kind: "code".to_owned(),
            prompt: "Implement it".to_owned(),
            priority: 1,
            max_attempts: 2,
            dependencies: vec![task_id],
        };

        assert_eq!(
            task.validate().expect_err("self dependency must fail"),
            "a task cannot depend on itself"
        );
    }
}

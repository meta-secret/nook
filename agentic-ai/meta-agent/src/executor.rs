use std::collections::BTreeMap;
use std::fmt::Display;
use std::fs;
use std::future::Future;
use std::path::{Path, PathBuf};

use futures::future::join_all;
use serde::Deserialize;
use thiserror::Error;

use crate::artifact::{ArtifactError, load_feature};
use crate::codex::{CodexError, InProcessCodexRunner};
use crate::model::{FeaturePlan, Task};

pub trait ExecutionAgent: Sync {
    type Error: Display + Send + Sync;

    fn run_assignment<'a>(
        &'a self,
        task_id: &'a str,
        prompt: &'a str,
    ) -> impl Future<Output = Result<String, Self::Error>> + Send + 'a;
}

impl ExecutionAgent for InProcessCodexRunner {
    type Error = CodexError;

    fn run_assignment<'a>(
        &'a self,
        task_id: &'a str,
        prompt: &'a str,
    ) -> impl Future<Output = Result<String, Self::Error>> + Send + 'a {
        self.execute_task(task_id, prompt)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExecutionEvent {
    BatchStarted {
        index: usize,
        total: usize,
        tasks: Vec<String>,
    },
    TaskCompleted {
        task_id: String,
        summary: String,
    },
    TaskFailed {
        task_id: String,
        message: String,
    },
    BatchCompleted {
        index: usize,
        total: usize,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExecutionReport {
    pub feature_id: String,
    pub batches: Vec<Vec<String>>,
    pub outcomes: BTreeMap<String, TaskOutcome>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TaskOutcome {
    pub status: TaskStatus,
    pub summary: String,
    pub changed_files: Vec<String>,
    pub tests: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TaskStatus {
    Completed,
    Blocked,
}

#[derive(Debug, Error)]
pub enum ExecutorError {
    #[error(transparent)]
    Artifact(#[from] ArtifactError),
    #[error("failed to read task issue `{path}`: {source}")]
    ReadTaskIssue {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("execution batch {batch} failed: {failures}")]
    BatchFailed { batch: usize, failures: String },
}

#[derive(Debug)]
pub struct Executor<A> {
    agent: A,
}

impl<A: ExecutionAgent> Executor<A> {
    pub fn new(agent: A) -> Self {
        Self { agent }
    }

    pub async fn execute<F>(
        &self,
        feature_path: &Path,
        observe: &F,
    ) -> Result<ExecutionReport, ExecutorError>
    where
        F: Fn(ExecutionEvent) + Sync,
    {
        let plan = load_feature(feature_path)?;
        let feature_directory = feature_directory(feature_path);
        let batches = plan.execution_batches().map_err(ArtifactError::from)?;
        let mut outcomes = BTreeMap::new();

        for (batch_offset, batch) in batches.iter().enumerate() {
            let batch_index = batch_offset + 1;
            observe(ExecutionEvent::BatchStarted {
                index: batch_index,
                total: batches.len(),
                tasks: batch.clone(),
            });

            let assignments = batch
                .iter()
                .map(|task_id| assignment(&plan, &feature_directory, task_id))
                .collect::<Result<Vec<_>, _>>()?;
            let runs = assignments.iter().map(|assignment| async {
                let result = self
                    .agent
                    .run_assignment(&assignment.task_id, &assignment.prompt)
                    .await
                    .map_err(|error| error.to_string())
                    .and_then(|response| parse_outcome(&assignment.task_id, &response));

                match &result {
                    Ok(outcome) if outcome.status == TaskStatus::Completed => {
                        observe(ExecutionEvent::TaskCompleted {
                            task_id: assignment.task_id.clone(),
                            summary: outcome.summary.clone(),
                        });
                    }
                    Ok(outcome) => observe(ExecutionEvent::TaskFailed {
                        task_id: assignment.task_id.clone(),
                        message: outcome.summary.clone(),
                    }),
                    Err(message) => observe(ExecutionEvent::TaskFailed {
                        task_id: assignment.task_id.clone(),
                        message: message.clone(),
                    }),
                }
                (assignment.task_id.clone(), result)
            });

            let results = join_all(runs).await;
            let mut failures = Vec::new();
            for (task_id, result) in results {
                match result {
                    Ok(outcome) if outcome.status == TaskStatus::Completed => {
                        outcomes.insert(task_id, outcome);
                    }
                    Ok(outcome) => failures.push(format!("{task_id}: {}", outcome.summary)),
                    Err(message) => failures.push(format!("{task_id}: {message}")),
                }
            }

            if !failures.is_empty() {
                return Err(ExecutorError::BatchFailed {
                    batch: batch_index,
                    failures: failures.join("; "),
                });
            }

            observe(ExecutionEvent::BatchCompleted {
                index: batch_index,
                total: batches.len(),
            });
        }

        Ok(ExecutionReport {
            feature_id: plan.feature.id,
            batches,
            outcomes,
        })
    }
}

struct Assignment {
    task_id: String,
    prompt: String,
}

fn assignment(
    plan: &FeaturePlan,
    feature_directory: &Path,
    task_id: &str,
) -> Result<Assignment, ExecutorError> {
    let task = &plan.tasks[task_id];
    let issue_path = feature_directory.join(&task.issue);
    let issue = fs::read_to_string(&issue_path).map_err(|source| ExecutorError::ReadTaskIssue {
        path: issue_path,
        source,
    })?;
    Ok(Assignment {
        task_id: task_id.to_owned(),
        prompt: execution_prompt(plan, task_id, task, &issue),
    })
}

fn feature_directory(feature_path: &Path) -> PathBuf {
    if feature_path.is_dir() {
        feature_path.to_owned()
    } else {
        feature_path
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .to_owned()
    }
}

fn parse_outcome(task_id: &str, response: &str) -> Result<TaskOutcome, String> {
    serde_json::from_str(response)
        .map_err(|error| format!("invalid completion JSON for task `{task_id}`: {error}"))
}

fn execution_prompt(plan: &FeaturePlan, task_id: &str, task: &Task, issue: &str) -> String {
    format!(
        r#"You are an implementation agent executing exactly one task from a validated feature DAG. Work directly in the current repository and complete the task, including focused tests.

Read and obey every applicable AGENTS.md and repository instruction before editing.

Concurrency contract:
- Other implementation agents may be changing disjoint files at the same time.
- Modify only the declared write scope below. Reads may extend beyond the declared read scope when needed for understanding.
- Do not run repository-wide formatters or commands that rewrite files outside the write scope.
- Never revert, overwrite, or clean up changes made by another agent.
- Do not create commits, branches, worktrees, stashes, or mutate Git metadata.
- Do not spawn additional agents.
- If completion requires writing outside the declared scope, return `blocked` and explain the missing scope instead of making that change.

Completion contract:
- Implement every acceptance criterion in the task issue.
- Preserve existing behavior outside the task.
- Run the narrowest relevant tests for the changed behavior.
- Return only the JSON object required by the supplied output schema.
- Use `completed` only when implementation and relevant tests are complete; otherwise use `blocked`.
- Report repository-relative changed file paths and the test commands/results.

Feature: {feature_title}
Feature summary: {feature_summary}
Feature acceptance criteria:
{feature_acceptance}

Task ID: {task_id}
Completed dependencies:
{dependencies}

Declared read scope:
{read_scope}

Declared write scope:
{write_scope}

Canonical task issue:
<task-issue>
{issue}
</task-issue>
"#,
        feature_title = plan.feature.title,
        feature_summary = plan.feature.summary,
        feature_acceptance = bullets(&plan.feature.acceptance_criteria),
        dependencies = bullets(&task.depends_on),
        read_scope = bullets(&task.resources.read),
        write_scope = bullets(&task.resources.write),
    )
}

fn bullets(values: &[String]) -> String {
    if values.is_empty() {
        "- none".to_owned()
    } else {
        values
            .iter()
            .map(|value| format!("- {value}"))
            .collect::<Vec<_>>()
            .join("\n")
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::convert::Infallible;
    use std::sync::{Arc, Mutex};

    use tokio::sync::Barrier;
    use tokio::time::{Duration, timeout};

    use super::*;
    use crate::artifact::write_feature;
    use crate::model::{
        DEPENDENCY_SEMANTICS, Defaults, Feature, Priority, RESOURCE_SEMANTICS, Resources, Semantics,
    };

    struct FakeAgent {
        events: Arc<Mutex<Vec<String>>>,
        roots_ready: Arc<Barrier>,
        blocked_task: Option<String>,
    }

    impl ExecutionAgent for FakeAgent {
        type Error = Infallible;

        async fn run_assignment<'a>(
            &'a self,
            task_id: &'a str,
            prompt: &'a str,
        ) -> Result<String, Self::Error> {
            assert!(prompt.contains(&format!("Task ID: {task_id}")));
            assert!(prompt.contains("Do not create commits"));
            self.events.lock().unwrap().push(format!("start:{task_id}"));
            if matches!(task_id, "core" | "ui") {
                self.roots_ready.wait().await;
            }
            self.events
                .lock()
                .unwrap()
                .push(format!("finish:{task_id}"));
            let status = if self.blocked_task.as_deref() == Some(task_id) {
                "blocked"
            } else {
                "completed"
            };
            Ok(format!(
                r#"{{"status":"{status}","summary":"{task_id} {status}","changed_files":[],"tests":["ok"]}}"#
            ))
        }
    }

    fn task(depends_on: &[&str], writes: &[&str]) -> Task {
        Task {
            title: "Task".into(),
            description: "Implement task".into(),
            priority: Priority::High,
            depends_on: depends_on.iter().map(ToString::to_string).collect(),
            resources: Resources {
                read: Vec::new(),
                write: writes.iter().map(ToString::to_string).collect(),
            },
            acceptance_criteria: vec!["Behavior works".into()],
            issue: String::new(),
        }
    }

    fn plan() -> FeaturePlan {
        let mut tasks = BTreeMap::from([
            ("core".into(), task(&[], &["core/**"])),
            ("ui".into(), task(&[], &["ui/**"])),
            (
                "integration".into(),
                task(&["core", "ui"], &["integration/**"]),
            ),
        ]);
        for (id, task) in &mut tasks {
            task.issue = format!("{id}.md");
        }
        FeaturePlan {
            version: 1,
            feature: Feature {
                id: "feature-one".into(),
                title: "Feature one".into(),
                summary: "Build a feature".into(),
                issue: "feature.md".into(),
                acceptance_criteria: vec!["Feature works".into()],
            },
            semantics: Semantics {
                depends_on: DEPENDENCY_SEMANTICS.into(),
                resources: RESOURCE_SEMANTICS.into(),
            },
            defaults: Defaults {
                priority: Priority::Medium,
            },
            tasks,
        }
    }

    fn fixture() -> (tempfile::TempDir, PathBuf) {
        let root = tempfile::tempdir().unwrap();
        let feature = write_feature(root.path(), &plan(), "Build it").unwrap();
        (root, feature)
    }

    #[tokio::test]
    async fn runs_ready_tasks_concurrently_then_unlocks_dependents() {
        let (_root, feature) = fixture();
        let events = Arc::new(Mutex::new(Vec::new()));
        let agent = FakeAgent {
            events: Arc::clone(&events),
            roots_ready: Arc::new(Barrier::new(2)),
            blocked_task: None,
        };
        let executor = Executor::new(agent);

        let report = timeout(Duration::from_secs(1), executor.execute(&feature, &|_| {}))
            .await
            .expect("parallel roots should meet at the barrier")
            .unwrap();

        assert_eq!(
            report.batches,
            vec![
                vec!["core".to_owned(), "ui".to_owned()],
                vec!["integration".to_owned()]
            ]
        );
        let events = events.lock().unwrap();
        let integration_start = events
            .iter()
            .position(|event| event == "start:integration")
            .unwrap();
        assert!(events[..integration_start].contains(&"finish:core".to_owned()));
        assert!(events[..integration_start].contains(&"finish:ui".to_owned()));
    }

    #[tokio::test]
    async fn failed_batch_blocks_dependent_tasks() {
        let (_root, feature) = fixture();
        let events = Arc::new(Mutex::new(Vec::new()));
        let agent = FakeAgent {
            events: Arc::clone(&events),
            roots_ready: Arc::new(Barrier::new(2)),
            blocked_task: Some("core".into()),
        };
        let executor = Executor::new(agent);

        let error = executor.execute(&feature, &|_| {}).await.unwrap_err();

        assert!(matches!(error, ExecutorError::BatchFailed { batch: 1, .. }));
        assert!(
            !events
                .lock()
                .unwrap()
                .contains(&"start:integration".to_owned())
        );
    }
}

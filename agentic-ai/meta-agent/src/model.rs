use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const DEPENDENCY_SEMANTICS: &str =
    "Every referenced task must complete successfully before this task becomes runnable.";
pub const RESOURCE_SEMANTICS: &str = "Tasks with overlapping write scopes must not run concurrently; resource conflicts do not imply a logical dependency.";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FeaturePlan {
    pub version: u32,
    pub feature: Feature,
    pub semantics: Semantics,
    pub defaults: Defaults,
    pub tasks: BTreeMap<String, Task>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Feature {
    pub id: String,
    pub title: String,
    pub summary: String,
    pub issue: String,
    pub acceptance_criteria: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Semantics {
    pub depends_on: String,
    pub resources: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Defaults {
    pub priority: Priority,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Task {
    pub title: String,
    pub description: String,
    pub priority: Priority,
    pub depends_on: Vec<String>,
    pub resources: Resources,
    pub acceptance_criteria: Vec<String>,
    pub issue: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Resources {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub read: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub write: Vec<String>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Priority {
    Low,
    #[default]
    Medium,
    High,
    Critical,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum PlanError {
    #[error("unsupported feature schema version {0}; expected 1")]
    UnsupportedVersion(u32),
    #[error("feature id `{0}` is not a stable kebab-case id")]
    InvalidFeatureId(String),
    #[error("feature must contain at least one task")]
    NoTasks,
    #[error("task id `{0}` is not a stable kebab-case id")]
    InvalidTaskId(String),
    #[error("task `{task}` depends on missing task `{dependency}`")]
    MissingDependency { task: String, dependency: String },
    #[error("task `{0}` cannot depend on itself")]
    SelfDependency(String),
    #[error("task graph contains a cycle involving: {0}")]
    Cycle(String),
    #[error("task `{task}` has unsafe issue filename `{issue}`")]
    InvalidIssueFilename { task: String, issue: String },
    #[error("feature has unsafe issue filename `{0}`")]
    InvalidFeatureIssueFilename(String),
    #[error("feature has an empty {0}")]
    EmptyFeatureValue(&'static str),
    #[error("task `{task}` has an empty {field}")]
    MissingTaskValue { task: String, field: &'static str },
    #[error("task `{task}` contains an empty {field} value")]
    EmptyTaskValue { task: String, field: &'static str },
}

impl FeaturePlan {
    pub fn validate(&self) -> Result<(), PlanError> {
        if self.version != 1 {
            return Err(PlanError::UnsupportedVersion(self.version));
        }
        if !is_stable_id(&self.feature.id) {
            return Err(PlanError::InvalidFeatureId(self.feature.id.clone()));
        }
        if self.feature.issue != "feature.md" {
            return Err(PlanError::InvalidFeatureIssueFilename(
                self.feature.issue.clone(),
            ));
        }
        for (field, value) in [
            ("title", self.feature.title.as_str()),
            ("summary", self.feature.summary.as_str()),
        ] {
            if value.trim().is_empty() {
                return Err(PlanError::EmptyFeatureValue(field));
            }
        }
        if self.feature.acceptance_criteria.is_empty() {
            return Err(PlanError::EmptyFeatureValue("acceptance criteria"));
        }
        if self.tasks.is_empty() {
            return Err(PlanError::NoTasks);
        }

        for (id, task) in &self.tasks {
            if !is_stable_id(id) {
                return Err(PlanError::InvalidTaskId(id.clone()));
            }
            if task.issue != format!("{id}.md") {
                return Err(PlanError::InvalidIssueFilename {
                    task: id.clone(),
                    issue: task.issue.clone(),
                });
            }
            validate_task_values(id, task)?;
            for dependency in &task.depends_on {
                if dependency == id {
                    return Err(PlanError::SelfDependency(id.clone()));
                }
                if !self.tasks.contains_key(dependency) {
                    return Err(PlanError::MissingDependency {
                        task: id.clone(),
                        dependency: dependency.clone(),
                    });
                }
            }
        }

        self.dependency_waves().map(|_| ())
    }

    pub fn dependency_waves(&self) -> Result<Vec<Vec<String>>, PlanError> {
        let mut completed = BTreeSet::new();
        let mut remaining = self.tasks.keys().cloned().collect::<BTreeSet<_>>();
        let mut waves = Vec::new();

        while !remaining.is_empty() {
            let ready = remaining
                .iter()
                .filter(|id| {
                    self.tasks[*id]
                        .depends_on
                        .iter()
                        .all(|dependency| completed.contains(dependency))
                })
                .cloned()
                .collect::<Vec<_>>();

            if ready.is_empty() {
                return Err(PlanError::Cycle(
                    remaining.iter().cloned().collect::<Vec<_>>().join(", "),
                ));
            }

            for id in &ready {
                remaining.remove(id);
                completed.insert(id.clone());
            }
            waves.push(ready);
        }

        Ok(waves)
    }

    /// Returns deterministic batches that honor both dependencies and write-scope conflicts.
    pub fn execution_batches(&self) -> Result<Vec<Vec<String>>, PlanError> {
        self.validate_graph_only()?;
        let mut completed = BTreeSet::new();
        let mut remaining = self.tasks.keys().cloned().collect::<BTreeSet<_>>();
        let mut batches = Vec::new();

        while !remaining.is_empty() {
            let ready = remaining
                .iter()
                .filter(|id| {
                    self.tasks[*id]
                        .depends_on
                        .iter()
                        .all(|dependency| completed.contains(dependency))
                })
                .cloned()
                .collect::<Vec<_>>();

            if ready.is_empty() {
                return Err(PlanError::Cycle(
                    remaining.iter().cloned().collect::<Vec<_>>().join(", "),
                ));
            }

            let mut batch = Vec::new();
            for candidate in ready {
                if batch.iter().all(|selected| {
                    !write_scopes_overlap(
                        &self.tasks[&candidate].resources.write,
                        &self.tasks[selected].resources.write,
                    )
                }) {
                    batch.push(candidate);
                }
            }

            for id in &batch {
                remaining.remove(id);
                completed.insert(id.clone());
            }
            batches.push(batch);
        }

        Ok(batches)
    }

    fn validate_graph_only(&self) -> Result<(), PlanError> {
        for (id, task) in &self.tasks {
            for dependency in &task.depends_on {
                if dependency == id {
                    return Err(PlanError::SelfDependency(id.clone()));
                }
                if !self.tasks.contains_key(dependency) {
                    return Err(PlanError::MissingDependency {
                        task: id.clone(),
                        dependency: dependency.clone(),
                    });
                }
            }
        }
        Ok(())
    }
}

fn validate_task_values(id: &str, task: &Task) -> Result<(), PlanError> {
    for (field, value) in [
        ("title", task.title.as_str()),
        ("description", task.description.as_str()),
    ] {
        if value.trim().is_empty() {
            return Err(PlanError::MissingTaskValue {
                task: id.to_owned(),
                field,
            });
        }
    }
    if task.acceptance_criteria.is_empty() {
        return Err(PlanError::MissingTaskValue {
            task: id.to_owned(),
            field: "acceptance criteria",
        });
    }
    for (field, values) in [
        ("dependency", &task.depends_on),
        ("read resource", &task.resources.read),
        ("write resource", &task.resources.write),
        ("acceptance criterion", &task.acceptance_criteria),
    ] {
        if values.iter().any(|value| value.trim().is_empty()) {
            return Err(PlanError::EmptyTaskValue {
                task: id.to_owned(),
                field,
            });
        }
    }
    Ok(())
}

pub fn is_stable_id(value: &str) -> bool {
    let mut segments = value.split('-');
    let Some(first) = segments.next() else {
        return false;
    };
    if first.is_empty()
        || !first
            .bytes()
            .enumerate()
            .all(|(index, byte)| byte.is_ascii_lowercase() || (index > 0 && byte.is_ascii_digit()))
    {
        return false;
    }
    segments.all(|segment| {
        !segment.is_empty()
            && segment
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
    })
}

fn write_scopes_overlap(left: &[String], right: &[String]) -> bool {
    left.iter().any(|left_scope| {
        right
            .iter()
            .any(|right_scope| scopes_may_overlap(left_scope, right_scope))
    })
}

fn scopes_may_overlap(left: &str, right: &str) -> bool {
    let left = scope_root(left);
    let right = scope_root(right);
    left.is_empty()
        || right.is_empty()
        || left == right
        || is_path_prefix(left, right)
        || is_path_prefix(right, left)
}

fn scope_root(scope: &str) -> &str {
    let wildcard = scope.find(['*', '?', '[', '{']).unwrap_or(scope.len());
    scope[..wildcard].trim_end_matches('/')
}

fn is_path_prefix(parent: &str, child: &str) -> bool {
    child
        .strip_prefix(parent)
        .is_some_and(|suffix| suffix.starts_with('/'))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn task(depends_on: &[&str], writes: &[&str]) -> Task {
        Task {
            title: "Task".into(),
            description: "Do the work".into(),
            priority: Priority::Medium,
            depends_on: depends_on.iter().map(ToString::to_string).collect(),
            resources: Resources {
                read: Vec::new(),
                write: writes.iter().map(ToString::to_string).collect(),
            },
            acceptance_criteria: vec!["It works".into()],
            issue: String::new(),
        }
    }

    fn plan(mut tasks: BTreeMap<String, Task>) -> FeaturePlan {
        for (id, task) in &mut tasks {
            task.issue = format!("{id}.md");
        }
        FeaturePlan {
            version: 1,
            feature: Feature {
                id: "feature-one".into(),
                title: "Feature one".into(),
                summary: "Summary".into(),
                issue: "feature.md".into(),
                acceptance_criteria: vec!["Complete".into()],
            },
            semantics: Semantics {
                depends_on: DEPENDENCY_SEMANTICS.into(),
                resources: RESOURCE_SEMANTICS.into(),
            },
            defaults: Defaults::default(),
            tasks,
        }
    }

    impl Default for Defaults {
        fn default() -> Self {
            Self {
                priority: Priority::Medium,
            }
        }
    }

    #[test]
    fn derives_parallel_dependency_waves() {
        let feature = plan(BTreeMap::from([
            ("design".into(), task(&[], &["docs/**"])),
            ("server".into(), task(&["design"], &["server/**"])),
            ("client".into(), task(&["design"], &["client/**"])),
            (
                "integration".into(),
                task(&["server", "client"], &["tests/**"]),
            ),
        ]));

        assert_eq!(
            feature.dependency_waves().unwrap(),
            vec![
                vec!["design"],
                vec!["client", "server"],
                vec!["integration"],
            ]
        );
    }

    #[test]
    fn serializes_overlapping_write_scopes_without_fake_dependencies() {
        let feature = plan(BTreeMap::from([
            ("server".into(), task(&[], &["crates/protocol/**"])),
            (
                "client".into(),
                task(&[], &["crates/protocol/src/client.rs"]),
            ),
            ("docs".into(), task(&[], &["docs/**"])),
        ]));

        assert_eq!(
            feature.execution_batches().unwrap(),
            vec![vec!["client", "docs"], vec!["server"]]
        );
        assert!(feature.tasks["client"].depends_on.is_empty());
        assert!(feature.tasks["server"].depends_on.is_empty());
    }

    #[test]
    fn rejects_missing_dependencies_and_cycles() {
        let missing = plan(BTreeMap::from([(
            "build".into(),
            task(&["generate"], &["src/**"]),
        )]));
        assert_eq!(
            missing.validate().unwrap_err(),
            PlanError::MissingDependency {
                task: "build".into(),
                dependency: "generate".into(),
            }
        );

        let cycle = plan(BTreeMap::from([
            ("first".into(), task(&["second"], &["a/**"])),
            ("second".into(), task(&["first"], &["b/**"])),
        ]));
        assert_eq!(
            cycle.validate().unwrap_err(),
            PlanError::Cycle("first, second".into())
        );
    }

    #[test]
    fn validates_stable_ids() {
        for valid in ["design", "design-api", "task2", "task-2"] {
            assert!(is_stable_id(valid), "expected {valid} to be valid");
        }
        for invalid in ["", "Design", "2task", "design_api", "design--api"] {
            assert!(!is_stable_id(invalid), "expected {invalid} to be invalid");
        }
    }

    #[test]
    fn rejects_tasks_without_verifiable_acceptance_criteria() {
        let mut feature = plan(BTreeMap::from([(
            "implementation".into(),
            task(&[], &["src/**"]),
        )]));
        feature
            .tasks
            .get_mut("implementation")
            .unwrap()
            .acceptance_criteria = Vec::new();

        assert_eq!(
            feature.validate().unwrap_err(),
            PlanError::MissingTaskValue {
                task: "implementation".into(),
                field: "acceptance criteria",
            }
        );
    }
}

use std::collections::{BTreeMap, BTreeSet};

use serde::Deserialize;
use thiserror::Error;

use crate::codex::{CodexError, CodexRunner};
use crate::model::{
    DEPENDENCY_SEMANTICS, Defaults, Feature, FeaturePlan, PlanError, Priority, RESOURCE_SEMANTICS,
    Resources, Semantics, Task,
};

#[derive(Debug)]
pub struct Planner<R> {
    runner: R,
}

impl<R: CodexRunner> Planner<R> {
    pub fn new(runner: R) -> Self {
        Self { runner }
    }

    pub fn plan(
        &self,
        developer_prompt: &str,
        feature_id_override: Option<&str>,
    ) -> Result<FeaturePlan, PlannerError> {
        if developer_prompt.trim().is_empty() {
            return Err(PlannerError::EmptyPrompt);
        }

        let response = self.runner.run(&planning_prompt(developer_prompt))?;
        let output: PlannerOutput = serde_json::from_str(&response)
            .map_err(|source| PlannerError::InvalidResponse { source, response })?;
        output.into_plan(feature_id_override)
    }
}

#[derive(Debug, Error)]
pub enum PlannerError {
    #[error("developer prompt cannot be empty")]
    EmptyPrompt,
    #[error(transparent)]
    Codex(#[from] CodexError),
    #[error("Codex returned invalid planner JSON: {source}; response: {response}")]
    InvalidResponse {
        source: serde_json::Error,
        response: String,
    },
    #[error("Codex returned duplicate task id `{0}`")]
    DuplicateTaskId(String),
    #[error(transparent)]
    InvalidPlan(#[from] PlanError),
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct PlannerOutput {
    feature: PlannerFeature,
    tasks: Vec<PlannerTask>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct PlannerFeature {
    id: String,
    title: String,
    summary: String,
    acceptance_criteria: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct PlannerTask {
    id: String,
    title: String,
    description: String,
    priority: Priority,
    depends_on: Vec<String>,
    resources: Resources,
    acceptance_criteria: Vec<String>,
}

impl PlannerOutput {
    fn into_plan(self, feature_id_override: Option<&str>) -> Result<FeaturePlan, PlannerError> {
        let mut tasks = BTreeMap::new();
        for task in self.tasks {
            let id = task.id.trim().to_owned();
            let entry = Task {
                title: task.title.trim().to_owned(),
                description: task.description.trim().to_owned(),
                priority: task.priority,
                depends_on: normalized(task.depends_on),
                resources: Resources {
                    read: normalized(task.resources.read),
                    write: normalized(task.resources.write),
                },
                acceptance_criteria: normalized_preserving_order(task.acceptance_criteria),
                issue: format!("{id}.md"),
            };
            if tasks.insert(id.clone(), entry).is_some() {
                return Err(PlannerError::DuplicateTaskId(id));
            }
        }

        let feature_id = feature_id_override
            .unwrap_or(&self.feature.id)
            .trim()
            .to_owned();
        let plan = FeaturePlan {
            version: 1,
            feature: Feature {
                id: feature_id,
                title: self.feature.title.trim().to_owned(),
                summary: self.feature.summary.trim().to_owned(),
                issue: "feature.md".into(),
                acceptance_criteria: normalized_preserving_order(self.feature.acceptance_criteria),
            },
            semantics: Semantics {
                depends_on: DEPENDENCY_SEMANTICS.into(),
                resources: RESOURCE_SEMANTICS.into(),
            },
            defaults: Defaults {
                priority: Priority::Medium,
            },
            tasks,
        };
        plan.validate()?;
        Ok(plan)
    }
}

fn normalized(values: Vec<String>) -> Vec<String> {
    values
        .into_iter()
        .map(|value| value.trim().to_owned())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn normalized_preserving_order(values: Vec<String>) -> Vec<String> {
    let mut seen = BTreeSet::new();
    values
        .into_iter()
        .map(|value| value.trim().to_owned())
        .filter(|value| seen.insert(value.clone()))
        .collect()
}

fn planning_prompt(developer_prompt: &str) -> String {
    format!(
        r#"You are the planning stage of a coding meta-agent. Inspect the current repository and its AGENTS.md/project instructions before decomposing the requested feature. Do not edit files, create GitHub issues, or implement the feature.

Return only the JSON object required by the supplied output schema.

Planning rules:
- Create stable lowercase kebab-case IDs. IDs are permanent references.
- Make each task independently deliverable and behavior-focused.
- `depends_on` contains only real logical prerequisites. `A depends_on B` means B must complete successfully before A can start.
- Never add a dependency merely to avoid merge conflicts.
- Put anticipated repository-relative glob paths in `resources.read` and `resources.write`.
- Minimize overlapping write scopes so independent Codex agents can run concurrently.
- If independent tasks must touch the same files, retain logical independence and record the overlapping write scopes; the scheduler will serialize them.
- Put domain/business logic in the repository's owning core layer and include behavior-focused tests in the same task.
- Include integration/audit tasks only when they have concrete deliverables and acceptance criteria.
- Every task must have at least one objective, verifiable acceptance criterion.
- The feature acceptance criteria describe the complete developer-visible outcome.

Developer feature prompt follows between delimiters:

<developer-feature>
{developer_prompt}
</developer-feature>
"#
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    struct FakeRunner {
        response: String,
    }

    impl CodexRunner for FakeRunner {
        fn run(&self, prompt: &str) -> Result<String, CodexError> {
            assert!(prompt.contains("<developer-feature>\nBuild sync\n</developer-feature>"));
            Ok(self.response.clone())
        }
    }

    fn response(tasks: &str) -> String {
        format!(
            r#"{{
              "feature": {{
                "id": "sync-vault",
                "title": "Sync vault",
                "summary": "Synchronize vault replicas.",
                "acceptance_criteria": ["Replicas converge"]
              }},
              "tasks": [{tasks}]
            }}"#
        )
    }

    #[test]
    fn converts_structured_codex_output_to_canonical_mapping() {
        let runner = FakeRunner {
            response: response(
                r#"{
                  "id": "design-protocol",
                  "title": "Design protocol",
                  "description": "Define messages.",
                  "priority": "high",
                  "depends_on": [],
                  "resources": {"read": ["README.md"], "write": ["docs/**"]},
                  "acceptance_criteria": ["Messages are documented"]
                }"#,
            ),
        };

        let plan = Planner::new(runner)
            .plan("Build sync", Some("custom-sync"))
            .unwrap();

        assert_eq!(plan.feature.id, "custom-sync");
        assert_eq!(plan.tasks.len(), 1);
        assert_eq!(plan.tasks["design-protocol"].issue, "design-protocol.md");
        assert_eq!(plan.tasks["design-protocol"].priority, Priority::High);
    }

    #[test]
    fn rejects_duplicate_task_ids() {
        let task = r#"{
          "id": "same-task",
          "title": "Task",
          "description": "Work.",
          "priority": "medium",
          "depends_on": [],
          "resources": {"read": [], "write": []},
          "acceptance_criteria": ["Done"]
        }"#;
        let runner = FakeRunner {
            response: response(&format!("{task},{task}")),
        };

        let error = Planner::new(runner).plan("Build sync", None).unwrap_err();
        assert!(matches!(error, PlannerError::DuplicateTaskId(id) if id == "same-task"));
    }
}

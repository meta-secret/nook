use std::fs;
use std::path::{Path, PathBuf};

use tempfile::Builder;
use thiserror::Error;

use crate::model::{FeaturePlan, PlanError, Priority, Task};

#[derive(Debug, Error)]
pub enum ArtifactError {
    #[error("feature output already exists: {0}")]
    AlreadyExists(PathBuf),
    #[error("failed to create feature output root `{path}`: {source}")]
    CreateRoot {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("failed to stage feature output below `{path}`: {source}")]
    CreateStaging {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("failed to serialize feature YAML: {0}")]
    Serialize(#[from] serde_yaml_ng::Error),
    #[error("failed to write `{path}`: {source}")]
    Write {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("failed to publish staged feature output to `{path}`: {source}")]
    Publish {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("failed to read `{path}`: {source}")]
    Read {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("feature artifact is missing issue file `{0}`")]
    MissingIssue(PathBuf),
    #[error(transparent)]
    InvalidPlan(#[from] PlanError),
}

pub fn write_feature(
    output_root: &Path,
    plan: &FeaturePlan,
    developer_prompt: &str,
) -> Result<PathBuf, ArtifactError> {
    plan.validate()?;
    fs::create_dir_all(output_root).map_err(|source| ArtifactError::CreateRoot {
        path: output_root.to_owned(),
        source,
    })?;

    let target = output_root.join(&plan.feature.id);
    if target.exists() {
        return Err(ArtifactError::AlreadyExists(target));
    }

    let staging = Builder::new()
        .prefix(".meta-agent-")
        .tempdir_in(output_root)
        .map_err(|source| ArtifactError::CreateStaging {
            path: output_root.to_owned(),
            source,
        })?;

    let yaml = serde_yaml_ng::to_string(plan)?;
    write(staging.path().join("feature.yaml"), &yaml)?;
    write(
        staging.path().join(&plan.feature.issue),
        &render_feature_issue(plan, developer_prompt),
    )?;
    for (id, task) in &plan.tasks {
        write(
            staging.path().join(&task.issue),
            &render_task_issue(id, task),
        )?;
    }

    let staged_path = staging.keep();
    fs::rename(&staged_path, &target).map_err(|source| {
        let _ = fs::remove_dir_all(&staged_path);
        ArtifactError::Publish {
            path: target.clone(),
            source,
        }
    })?;
    Ok(target)
}

pub fn load_feature(path: &Path) -> Result<FeaturePlan, ArtifactError> {
    let yaml_path = if path.is_dir() {
        path.join("feature.yaml")
    } else {
        path.to_owned()
    };
    let directory = yaml_path.parent().unwrap_or_else(|| Path::new("."));
    let yaml = fs::read_to_string(&yaml_path).map_err(|source| ArtifactError::Read {
        path: yaml_path.clone(),
        source,
    })?;
    let plan: FeaturePlan = serde_yaml_ng::from_str(&yaml)?;
    plan.validate()?;

    for issue in
        std::iter::once(&plan.feature.issue).chain(plan.tasks.values().map(|task| &task.issue))
    {
        let issue_path = directory.join(issue);
        if !issue_path.is_file() {
            return Err(ArtifactError::MissingIssue(issue_path));
        }
    }
    Ok(plan)
}

fn write(path: PathBuf, contents: &str) -> Result<(), ArtifactError> {
    fs::write(&path, contents).map_err(|source| ArtifactError::Write { path, source })
}

fn render_feature_issue(plan: &FeaturePlan, developer_prompt: &str) -> String {
    let mut output = format!(
        "# {}\n\n{}\n\n## Acceptance criteria\n\n{}\n\n## Tasks\n\n",
        plan.feature.title,
        plan.feature.summary,
        bullets(&plan.feature.acceptance_criteria),
    );
    for (id, task) in &plan.tasks {
        output.push_str(&format!("- [ ] [{}]({})\n", task.title, task.issue));
        if !task.depends_on.is_empty() {
            output.push_str(&format!(
                "  - Depends on: {}\n",
                linked_dependencies(&task.depends_on)
            ));
        }
        output.push_str(&format!("  - Task ID: `{id}`\n"));
    }
    output.push_str("\n## Developer prompt\n\n");
    for line in developer_prompt.trim().lines() {
        output.push_str("> ");
        output.push_str(line);
        output.push('\n');
    }
    output
}

fn render_task_issue(id: &str, task: &Task) -> String {
    format!(
        "# {}\n\n{}\n\n- Task ID: `{id}`\n- Priority: `{}`\n- Depends on: {}\n\n## Resource scope\n\n### Read\n\n{}\n\n### Write\n\n{}\n\n## Acceptance criteria\n\n{}\n",
        task.title,
        task.description,
        priority_name(task.priority),
        if task.depends_on.is_empty() {
            "none".into()
        } else {
            linked_dependencies(&task.depends_on)
        },
        code_bullets(&task.resources.read),
        code_bullets(&task.resources.write),
        bullets(&task.acceptance_criteria),
    )
}

fn bullets(values: &[String]) -> String {
    if values.is_empty() {
        return "- None specified.".into();
    }
    values
        .iter()
        .map(|value| format!("- {value}"))
        .collect::<Vec<_>>()
        .join("\n")
}

fn code_bullets(values: &[String]) -> String {
    if values.is_empty() {
        return "- None.".into();
    }
    values
        .iter()
        .map(|value| format!("- `{value}`"))
        .collect::<Vec<_>>()
        .join("\n")
}

fn linked_dependencies(values: &[String]) -> String {
    values
        .iter()
        .map(|dependency| format!("[`{dependency}`]({dependency}.md)"))
        .collect::<Vec<_>>()
        .join(", ")
}

fn priority_name(priority: Priority) -> &'static str {
    match priority {
        Priority::Low => "low",
        Priority::Medium => "medium",
        Priority::High => "high",
        Priority::Critical => "critical",
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;
    use crate::model::{
        DEPENDENCY_SEMANTICS, Defaults, Feature, RESOURCE_SEMANTICS, Resources, Semantics,
    };

    fn example_plan() -> FeaturePlan {
        FeaturePlan {
            version: 1,
            feature: Feature {
                id: "sync-vault".into(),
                title: "Sync vault".into(),
                summary: "Synchronize replicas safely.".into(),
                issue: "feature.md".into(),
                acceptance_criteria: vec!["Replicas converge.".into()],
            },
            semantics: Semantics {
                depends_on: DEPENDENCY_SEMANTICS.into(),
                resources: RESOURCE_SEMANTICS.into(),
            },
            defaults: Defaults {
                priority: Priority::Medium,
            },
            tasks: BTreeMap::from([(
                "design-protocol".into(),
                Task {
                    title: "Design protocol".into(),
                    description: "Define messages and retries.".into(),
                    priority: Priority::High,
                    depends_on: Vec::new(),
                    resources: Resources {
                        read: vec!["README.md".into()],
                        write: vec!["docs/protocol.md".into()],
                    },
                    acceptance_criteria: vec!["Messages are documented.".into()],
                    issue: "design-protocol.md".into(),
                },
            )]),
        }
    }

    #[test]
    fn writes_and_reloads_complete_feature_directory() {
        let root = tempfile::tempdir().unwrap();
        let target = write_feature(root.path(), &example_plan(), "Build vault sync").unwrap();

        assert!(target.join("feature.yaml").is_file());
        assert!(target.join("feature.md").is_file());
        assert!(target.join("design-protocol.md").is_file());
        assert_eq!(load_feature(&target).unwrap(), example_plan());

        let yaml = fs::read_to_string(target.join("feature.yaml")).unwrap();
        assert!(yaml.contains("tasks:\n  design-protocol:"));
        assert!(yaml.contains("depends_on: []"));
        assert!(!yaml.contains("- id: design-protocol"));

        let feature = fs::read_to_string(target.join("feature.md")).unwrap();
        assert!(feature.contains("[Design protocol](design-protocol.md)"));
        assert!(feature.contains("> Build vault sync"));
    }

    #[test]
    fn refuses_to_replace_an_existing_feature() {
        let root = tempfile::tempdir().unwrap();
        write_feature(root.path(), &example_plan(), "First").unwrap();

        let error = write_feature(root.path(), &example_plan(), "Second").unwrap_err();
        assert!(matches!(error, ArtifactError::AlreadyExists(_)));
    }

    #[test]
    fn loader_requires_every_issue_file() {
        let root = tempfile::tempdir().unwrap();
        let target = write_feature(root.path(), &example_plan(), "Build vault sync").unwrap();
        fs::remove_file(target.join("design-protocol.md")).unwrap();

        let error = load_feature(&target).unwrap_err();
        assert!(matches!(error, ArtifactError::MissingIssue(_)));
    }
}

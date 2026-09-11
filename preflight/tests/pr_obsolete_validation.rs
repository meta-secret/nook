use std::{
    env, fs,
    ops::Deref,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};

struct RepositoryFixture {
    path: PathBuf,
}
impl RepositoryFixture {
    fn repository_root() -> Self {
        Self {
            path: env::var_os("NOOK_REPO_ROOT").map_or_else(
                || PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."),
                PathBuf::from,
            ),
        }
    }
}
impl Deref for RepositoryFixture {
    type Target = PathBuf;
    fn deref(&self) -> &PathBuf {
        &self.path
    }
}
impl AsRef<Path> for RepositoryFixture {
    fn as_ref(&self) -> &Path {
        &self.path
    }
}

impl RepositoryFixture {
    fn read(&self, path: &str) -> Result<String> {
        fs::read_to_string(self.join(path)).with_context(|| format!("failed to read {path}"))
    }
}

#[test]
fn head_transition_marker_and_stabilization_routes_are_absent() -> Result<()> {
    let workflow_name = ["pr-head", "stabilization.yml"].join("-");
    assert!(
        !RepositoryFixture::repository_root()
            .join(".github/workflows")
            .join(&workflow_name)
            .exists(),
        "the head-stabilization workflow must remain removed"
    );

    let forbidden = [
        ["pr-head", "stabilization"].join("-"),
        ["nook-head", "transition"].join("-"),
    ];
    for relative_root in [".github/workflows", ".github/scripts", ".task"] {
        let mut pending = vec![RepositoryFixture::repository_root().join(relative_root)];
        while let Some(directory) = pending.pop() {
            for entry in fs::read_dir(&directory)? {
                let entry = entry?;
                if entry.file_type()?.is_dir() {
                    pending.push(entry.path());
                    continue;
                }
                let Ok(source) = fs::read_to_string(entry.path()) else {
                    continue;
                };
                for marker in &forbidden {
                    assert!(
                        !source.contains(marker),
                        "{} must not support removed head-transition state: {marker}",
                        entry.path().display()
                    );
                }
            }
        }
    }
    Ok(())
}

#[test]
fn obsolete_validation_cancellation_is_marker_free_and_head_bound() -> Result<()> {
    let root = RepositoryFixture::repository_root();
    assert!(
        !root.join(".github/workflows/pr-obsolete-validation.yml").exists(),
        "native workflow concurrency must replace the cancellation worker"
    );
    for path in [".github/workflows/pr.yml", ".github/workflows/rust-ecosystem.yml"] {
        let workflow = root.read(path)?;
        for required in [
            "types: [labeled, synchronize, edited]",
            "cancel-in-progress: true",
            "github.event.changes.base.ref.from != ''",
            "if: github.event",
            "github.event.label.name == 'ci:validate'",
        ] {
            assert!(workflow.contains(required), "{path} is missing {required}");
        }
        assert!(
            !workflow.contains("github.rest.actions.cancelWorkflowRun"),
            "{path} must use native concurrency"
        );
    }
    Ok(())
}

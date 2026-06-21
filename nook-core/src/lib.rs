use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct WorkspaceProject {
    pub name: &'static str,
    pub purpose: &'static str,
    pub language: &'static str,
}

const PROJECTS: &[WorkspaceProject] = &[
    WorkspaceProject {
        name: "nook-core",
        purpose: "Core logic shared by every Nook runtime.",
        language: "Rust",
    },
    WorkspaceProject {
        name: "nook-wasm",
        purpose: "Wasm bindings that expose nook-core to JavaScript.",
        language: "Rust + wasm-bindgen",
    },
    WorkspaceProject {
        name: "nook-web",
        purpose: "Bun and Svelte front end that consumes nook-wasm.",
        language: "TypeScript + Svelte",
    },
];

#[must_use]
pub const fn workspace_projects() -> &'static [WorkspaceProject] {
    PROJECTS
}

#[must_use]
pub fn project_summary() -> String {
    format!(
        "Nook is a monorepo with {} projects: core logic, wasm bindings, and a web UI.",
        PROJECTS.len()
    )
}

#[cfg(test)]
mod tests {
    use super::{project_summary, workspace_projects};

    #[test]
    fn summary_names_workspace_shape() {
        assert!(project_summary().contains("3 projects"));
    }

    #[test]
    fn projects_are_ordered_by_dependency_direction() {
        let names: Vec<_> = workspace_projects()
            .iter()
            .map(|project| project.name)
            .collect();

        assert_eq!(names, ["nook-core", "nook-wasm", "nook-web"]);
    }
}

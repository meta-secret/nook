//! Task dependency graph derived from `graph.yaml`.
//!
//! Plain, explicit Rust structs with self-orchestrating task execution.

use crate::{Prompt, Task};

/// Task: `architecture` (depends_on: [])
#[derive(Debug, Clone, Copy, Default)]
pub struct ArchitectureTask;

impl Task for ArchitectureTask {
    fn execute(&self, prompt: &Prompt) {
        println!("[Task: architecture] Executing prompt: {}", prompt.text);
    }
}

/// Task: `unit_test` (depends_on: [])
#[derive(Debug, Clone, Copy, Default)]
pub struct UnitTestTask;

impl Task for UnitTestTask {
    fn execute(&self, prompt: &Prompt) {
        println!("[Task: unit_test] Executing prompt: {}", prompt.text);
    }
}

/// Prerequisites required for `backend` task
#[derive(Debug, Clone, Copy, Default)]
pub struct BackendDeps {
    pub architecture: ArchitectureTask,
    pub unit_test: UnitTestTask,
}

/// Task: `backend` (depends_on: [architecture, unit_test])
#[derive(Debug, Clone, Copy, Default)]
pub struct BackendTask {
    pub deps: BackendDeps,
}

impl Task for BackendTask {
    fn execute(&self, prompt: &Prompt) {
        self.deps.architecture.execute(prompt);
        self.deps.unit_test.execute(prompt);
        println!(
            "[Task: backend] Executing after prerequisites with prompt: {}",
            prompt.text
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_plain_struct_task_graph() {
        let prompt = Prompt {
            text: "Build minds graph with plain structs".to_string(),
        };

        let backend = BackendTask::default();
        backend.execute(&prompt);
    }
}

//! Task dependency graph derived from updated `graph.yaml`.
//!
//! Sequence: Architecture -> Backend -> UnitTest
//! Each task executes its prerequisites first, then invokes the AI Agent with the prompt.

use crate::{Agent, Prompt, Task};

/// Task: `architecture` (depends_on: [])
#[derive(Debug, Clone, Copy, Default)]
pub struct ArchitectureTask;

impl Task for ArchitectureTask {
    fn execute(&self, prompt: &Prompt) {
        println!("[Task: architecture] Executing architecture design...");
        Agent.call(prompt);
    }
}

/// Prerequisites required for `backend` task
#[derive(Debug, Clone, Copy, Default)]
pub struct BackendDeps {
    pub architecture: ArchitectureTask,
}

/// Task: `backend` (depends_on: [architecture])
#[derive(Debug, Clone, Copy, Default)]
pub struct BackendTask {
    pub deps: BackendDeps,
}

impl Task for BackendTask {
    fn execute(&self, prompt: &Prompt) {
        self.deps.architecture.execute(prompt);
        println!("[Task: backend] Executing backend development...");
        Agent.call(prompt);
    }
}

/// Prerequisites required for `unit_test` task
#[derive(Debug, Clone, Copy, Default)]
pub struct UnitTestDeps {
    pub backend: BackendTask,
}

/// Task: `unit_test` (depends_on: [backend])
#[derive(Debug, Clone, Copy, Default)]
pub struct UnitTestTask {
    pub deps: UnitTestDeps,
}

impl Task for UnitTestTask {
    fn execute(&self, prompt: &Prompt) {
        self.deps.backend.execute(prompt);
        println!("[Task: unit_test] Running unit tests after backend...");
        Agent.call(prompt);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_task_graph_execution() {
        let prompt = Prompt {
            text: "Develop feature and test".to_string(),
        };

        // Terminal task is unit_test (which depends on backend -> architecture)
        let unit_test_task = UnitTestTask::default();
        unit_test_task.execute(&prompt);
    }
}

//! Auto-generated task dependency graph from YAML.
pub mod architecture {
    use crate::{Agent, Prompt, RetriableTask, Task, TaskResult};
    #[derive(Debug, Clone, Default)]
    pub struct ArchitectureOutput {
        pub design_doc: String,
    }
    ///Design the architecture of the system.
    #[derive(Debug, Clone, Copy, Default)]
    pub struct ArchitectureTask;
    impl Task for ArchitectureTask {
        type Output = ArchitectureOutput;
        fn execute(&self, prompt: &Prompt) -> TaskResult<Self::Output> {
            println!(
                concat!(
                    "[Task: ",
                    stringify!(ArchitectureTask),
                    "] Executing prompt: {}"
                ),
                prompt.text
            );
            Agent.call(prompt);
            Ok(ArchitectureOutput::default())
        }
    }
    impl RetriableTask for ArchitectureTask {
        fn max_retries(&self) -> usize {
            1usize
        }
    }
}
pub mod backend {
    use crate::{Agent, Prompt, RetriableTask, Task, TaskResult};
    #[derive(Debug, Clone, Default)]
    pub struct BackendOutput {
        pub source_code: String,
    }
    #[derive(Debug, Clone, Copy, Default)]
    pub struct BackendDeps {
        pub architecture: super::architecture::ArchitectureTask,
    }
    ///Implement backend services based on architecture design.
    #[derive(Debug, Clone, Copy, Default)]
    pub struct BackendTask {
        pub deps: BackendDeps,
    }
    impl Task for BackendTask {
        type Output = BackendOutput;
        fn execute(&self, prompt: &Prompt) -> TaskResult<Self::Output> {
            let _ = self.deps.architecture.execute(prompt)?;
            println!(
                concat!("[Task: ", stringify!(BackendTask), "] Executing prompt: {}"),
                prompt.text
            );
            Agent.call(prompt);
            Ok(BackendOutput::default())
        }
    }
    impl RetriableTask for BackendTask {
        fn max_retries(&self) -> usize {
            1usize
        }
    }
}
pub mod unit_test {
    use crate::{Agent, Prompt, RetriableTask, Task, TaskResult};
    #[derive(Debug, Clone, Default)]
    pub struct UnitTestOutput {
        pub test_logs: String,
        pub passed: bool,
    }
    #[derive(Debug, Clone, Default)]
    pub struct UnitTestError {
        pub failed_test_count: u32,
        pub error_log: String,
    }
    #[derive(Debug, Clone, Copy, Default)]
    pub struct UnitTestDeps {
        pub backend: super::backend::BackendTask,
    }
    ///Run unit test suite against backend code.
    #[derive(Debug, Clone, Copy, Default)]
    pub struct UnitTestTask {
        pub deps: UnitTestDeps,
    }
    impl Task for UnitTestTask {
        type Output = UnitTestOutput;
        fn execute(&self, prompt: &Prompt) -> TaskResult<Self::Output> {
            let _ = self.deps.backend.execute(prompt)?;
            println!(
                concat!(
                    "[Task: ",
                    stringify!(UnitTestTask),
                    "] Executing prompt: {}"
                ),
                prompt.text
            );
            Agent.call(prompt);
            Ok(UnitTestOutput::default())
        }
    }
    impl RetriableTask for UnitTestTask {
        fn max_retries(&self) -> usize {
            3usize
        }
    }
}

//! Lace: Task processing graph for Minds.

pub mod generator;
pub mod graph;

#[derive(Debug, Clone)]
pub struct TaskError {
    pub message: String,
    pub log: String,
}

pub type TaskResult<T> = Result<T, TaskError>;

pub trait Task {
    type Output;
    fn execute(&self, prompt: &Prompt) -> TaskResult<Self::Output>;
}

/// Trait extension providing automatic retry loops with feedback propagation.
pub trait RetriableTask: Task {
    /// Number of execution attempts allowed (default: 1)
    fn max_retries(&self) -> usize {
        1
    }

    /// Executes the task with automatic retries and prompt feedback propagation.
    fn execute_with_retries(&self, prompt: &Prompt) -> TaskResult<Self::Output> {
        let mut current_prompt = prompt.clone();
        let mut last_err = TaskError {
            message: "No execution attempts made".to_string(),
            log: String::new(),
        };

        let max = self.max_retries();
        for attempt in 1..=max {
            match self.execute(&current_prompt) {
                Ok(output) => return Ok(output),
                Err(err) => {
                    println!(
                        "[RetriableTask] Attempt {}/{} failed: {}. Retrying...",
                        attempt, max, err.message
                    );
                    current_prompt.text = format!(
                        "{}\n\n[Retry Feedback Attempt {}]:\n{}",
                        prompt.text, attempt, err.log
                    );
                    last_err = err;
                }
            }
        }

        Err(TaskError {
            message: format!("Task failed after {} attempts", max),
            log: last_err.log,
        })
    }
}

pub struct Agent;

impl Agent {
    pub fn call(&self, _prompt: &Prompt) {}
}

#[derive(Debug, Clone)]
pub struct Prompt {
    pub text: String,
}

#[cfg(test)]
mod tests {
    use std::cell::{Cell, RefCell};

    use super::{Prompt, RetriableTask, Task, TaskError, TaskResult};
    use crate::graph::{
        architecture::ArchitectureTask, backend::BackendTask, unit_test::UnitTestTask,
    };

    struct ScriptedTask {
        attempts: Cell<usize>,
        prompts: RefCell<Vec<String>>,
        failures: usize,
        max_attempts: usize,
    }

    impl Task for ScriptedTask {
        type Output = usize;

        fn execute(&self, prompt: &Prompt) -> TaskResult<Self::Output> {
            self.prompts.borrow_mut().push(prompt.text.clone());
            let attempt = self.attempts.get() + 1;
            self.attempts.set(attempt);
            if attempt <= self.failures {
                return Err(TaskError {
                    message: format!("attempt {attempt} failed"),
                    log: format!("diagnostic {attempt}"),
                });
            }
            Ok(attempt)
        }
    }

    impl RetriableTask for ScriptedTask {
        fn max_retries(&self) -> usize {
            self.max_attempts
        }
    }

    #[test]
    fn retries_propagate_latest_feedback_and_stop_after_success() -> TaskResult<()> {
        let task = ScriptedTask {
            attempts: Cell::new(0),
            prompts: RefCell::new(Vec::new()),
            failures: 1,
            max_attempts: 3,
        };

        let output = task.execute_with_retries(&Prompt {
            text: "build it".into(),
        })?;
        assert_eq!(output, 2);
        assert_eq!(task.attempts.get(), 2);
        assert_eq!(
            task.prompts.borrow().as_slice(),
            [
                "build it",
                "build it\n\n[Retry Feedback Attempt 1]:\ndiagnostic 1"
            ]
        );
        Ok(())
    }

    #[test]
    fn retries_return_the_last_diagnostic_after_exhaustion() -> TaskResult<()> {
        let task = ScriptedTask {
            attempts: Cell::new(0),
            prompts: RefCell::new(Vec::new()),
            failures: 3,
            max_attempts: 2,
        };

        let Err(error) = task.execute_with_retries(&Prompt {
            text: "test".into(),
        }) else {
            return Err(TaskError {
                message: "both scripted attempts unexpectedly succeeded".into(),
                log: String::new(),
            });
        };
        assert_eq!(error.message, "Task failed after 2 attempts");
        assert_eq!(error.log, "diagnostic 2");
        assert_eq!(task.attempts.get(), 2);
        Ok(())
    }

    #[test]
    fn generated_graph_executes_dependencies_and_declared_retry_policy() -> TaskResult<()> {
        let prompt = Prompt {
            text: "deliver the graph".into(),
        };

        assert!(ArchitectureTask.execute(&prompt).is_ok());
        assert!(BackendTask::default().execute(&prompt).is_ok());
        let output = UnitTestTask::default().execute_with_retries(&prompt)?;
        assert!(!output.passed);
        assert!(output.test_logs.is_empty());
        assert_eq!(UnitTestTask::default().max_retries(), 3);
        Ok(())
    }
}

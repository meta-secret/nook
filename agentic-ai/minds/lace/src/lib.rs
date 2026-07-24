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

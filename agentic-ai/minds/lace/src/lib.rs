//! Lace: Task processing graph for Minds.

use crate::backend::BackendTask;
use crate::unit_test::UnitTestTask;

trait Task {
    fn execute(&self, prompt: &Prompt);
}

struct Agent;
impl Agent {
    fn call(&self, prompt: &Prompt) {}
}

struct Prompt {
    text: String,
}

mod backend {
    use crate::{Agent, Prompt, Task};
    use crate::unit_test::UnitTestTask;

    pub struct BackendTask {
        pub agent: Agent,
        pub unit_test: UnitTestTask,
    }

    impl Task for BackendTask {
        fn execute(&self, prompt: &Prompt) {
            self.agent.call(prompt);
            self.unit_test.execute(prompt);
        }
    }
}

mod unit_test{
    use crate::{Agent, Prompt, Task};

    pub struct UnitTestTask {
        pub agent: Agent,
        pub id: String
    }

    impl Task for UnitTestTask {
        fn execute(&self, prompt: &Prompt) {
            self.agent.call(prompt);
        }
    }
}

fn main() {
    let unit_test = UnitTestTask {
        agent: Agent,
        id: "1".to_string(),
    };

    let backend = BackendTask {
        agent: Agent,
        unit_test,
    };
}
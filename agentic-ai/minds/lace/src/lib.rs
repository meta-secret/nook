//! Lace: Task processing graph for Minds.

pub mod generator;
pub mod graph;


pub trait Task {
    fn execute(&self, prompt: &Prompt);
}

pub struct Agent;

impl Agent {
    pub fn call(&self, _prompt: &Prompt) {}
}

pub struct Prompt {
    pub text: String,
}


use std::io::{self, Write};

/// State checkpoints are interleaved with output, so a partial write retains
/// precisely the state reached before that failed operation.
pub(super) struct ProgressPlan<S> {
    initial: S,
    pub(super) state: S,
    actions: Vec<ProgressAction<S>>,
}
enum ProgressAction<S> {
    State(S),
    Write(String),
    Flush,
}
impl<S: Clone> ProgressPlan<S> {
    pub(super) fn new(state: S) -> Self {
        Self {
            initial: state.clone(),
            state,
            actions: Vec::new(),
        }
    }
    pub(super) fn checkpoint(mut self, state: S) -> Self {
        self.state = state.clone();
        self.actions.push(ProgressAction::State(state));
        self
    }
    pub(super) fn write(mut self, text: String) -> Self {
        self.actions.push(ProgressAction::Write(text));
        self
    }
    pub(super) fn flush(mut self) -> Self {
        self.actions.push(ProgressAction::Flush);
        self
    }
    pub(super) fn output<W: Write>(self, writer: W) -> (S, W, io::Result<()>) {
        let mut state = self.initial;
        let mut output = ProgressWriter(writer);
        for action in self.actions {
            let outcome;
            match action {
                ProgressAction::State(next) => {
                    state = next;
                    continue;
                }
                ProgressAction::Write(text) => (output, outcome) = output.write(&text),
                ProgressAction::Flush => (output, outcome) = output.flush(),
            }
            if let Err(error) = outcome {
                return (state, output.0, Err(error));
            }
        }
        (state, output.0, Ok(()))
    }
}
/// The only mutable borrow belongs to the foreign Write capability.
struct ProgressWriter<W>(W);
impl<W: Write> ProgressWriter<W> {
    fn write(mut self, text: &str) -> (Self, io::Result<()>) {
        let outcome = self.0.write_all(text.as_bytes());
        (self, outcome)
    }
    fn flush(mut self) -> (Self, io::Result<()>) {
        let outcome = self.0.flush();
        (self, outcome)
    }
}

#[derive(Debug, PartialEq, Eq)]
pub(super) enum InspectionHints {
    NoHints,
    Files(String),
}
pub(super) enum ProgressDetail<'a> {
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "summary-only phases are exercised by output tests"
        )
    )]
    Summary,
    Detail(&'a str),
}
use super::progress_output::ProgressPlan;
use super::*;

pub(super) struct TaskProgressLabel<'a> {
    pub(super) task_id: &'a str,
}
pub(super) struct ProgressText<'a> {
    pub(super) message: &'a str,
}

pub(super) enum TurnProgress<W> {
    Planning(ProgressReporter<W>),
    Task(TaskProgressReporter<W>),
}
impl<W: Write> TurnProgress<W> {
    pub(super) fn observe(self, event: &EventMsg) -> (Self, io::Result<()>) {
        match self {
            Self::Planning(progress) => {
                let (progress, outcome) = progress.observe(event);
                (Self::Planning(progress), outcome)
            }
            Self::Task(progress) => {
                let (progress, outcome) = progress.observe(event);
                (Self::Task(progress), outcome)
            }
        }
    }
}
#[derive(Clone, Copy)]
pub(super) enum Announcement {
    Pending,
    Announced,
}
#[derive(Clone, Copy)]
enum ReasoningLine {
    Closed,
    Open,
}
#[derive(Clone, Copy)]
enum ReasoningEvidence {
    None,
    Seen,
}
#[derive(Clone)]
struct TaskProgressState {
    decorate: ProgressDecoration,
    task_id: String,
    step: usize,
    finalizing: Announcement,
}
pub(super) struct TaskProgressReporter<W> {
    pub(super) writer: W,
    state: TaskProgressState,
}
impl<W: Write> TaskProgressReporter<W> {
    pub(super) fn new(request: TaskProgressOutput<W>) -> Self {
        Self {
            writer: request.output.writer,
            state: TaskProgressState {
                decorate: request.output.decoration,
                task_id: request.task_id,
                step: 0,
                finalizing: Announcement::Pending,
            },
        }
    }
    fn output(self, plan: ProgressPlan<TaskProgressState>) -> (Self, io::Result<()>) {
        let (state, writer, outcome) = plan.output(self.writer);
        (Self { writer, state }, outcome)
    }
    pub(super) fn observe(self, event: &EventMsg) -> (Self, io::Result<()>) {
        let plan = ProgressPlan::new(self.state.clone());
        let plan = match event {
            EventMsg::TurnStarted(_) => plan.task_line("36", "●", "start", "Agent started"),
            EventMsg::ExecCommandBegin(_) => {
                let state = TaskProgressState {
                    step: plan.state.step + 1,
                    ..plan.state.clone()
                };
                let message = format!("{:02} Running repository command", state.step);
                plan.checkpoint(state)
                    .task_line("36", "↳", "action", &message)
            }
            EventMsg::ExecCommandEnd(event) => plan.command_finished(
                &event.command,
                event.exit_code,
                event.duration.as_secs_f64(),
            ),
            EventMsg::PatchApplyBegin(_) => {
                plan.task_line("35", "✎", "edit", "Applying repository changes")
            }
            EventMsg::PatchApplyEnd(event) if !event.success => {
                plan.task_line("31", "✗", "edit", "Code patch failed")
            }
            EventMsg::Warning(_) | EventMsg::GuardianWarning(_) => {
                plan.task_line("33", "!", "warning", "Embedded turn reported a warning")
            }
            EventMsg::StreamError(_) => {
                plan.task_line("33", "↻", "retry", "Embedded turn connection retry")
            }
            EventMsg::ModelReroute(_) => {
                plan.task_line("36", "↪", "model", "Embedded turn model rerouted")
            }
            EventMsg::AgentMessageContentDelta(_) => plan.announce_finalizing(),
            EventMsg::Error(_) => plan.task_line("31", "✗", "error", "Embedded turn failed"),
            EventMsg::TurnAborted(_) => {
                plan.task_line("31", "✗", "aborted", "Embedded turn aborted")
            }
            _ => plan,
        };
        self.output(plan)
    }
    #[cfg(test)]
    pub(super) fn paint(&self, code: &str, text: &str) -> String {
        self.state.decorate.paint(code, text)
    }
    #[cfg(test)]
    pub(super) fn command_finished(
        self,
        command: &[String],
        exit_code: i32,
        duration_seconds: f64,
    ) -> (Self, io::Result<()>) {
        let plan = ProgressPlan::new(self.state.clone()).command_finished(
            command,
            exit_code,
            duration_seconds,
        );
        self.output(plan)
    }
    #[cfg(test)]
    pub(super) fn announce_finalizing(self) -> (Self, io::Result<()>) {
        let plan = ProgressPlan::new(self.state.clone()).announce_finalizing();
        self.output(plan)
    }
    #[cfg(test)]
    pub(super) fn line(
        self,
        color: &str,
        symbol: &str,
        kind: &str,
        message: &str,
    ) -> (Self, io::Result<()>) {
        let plan = ProgressPlan::new(self.state.clone()).task_line(color, symbol, kind, message);
        self.output(plan)
    }
}
impl ProgressPlan<TaskProgressState> {
    fn command_finished(self, command: &[String], exit_code: i32, duration: f64) -> Self {
        if exit_code != 0 {
            return self.task_line(
                "31",
                "✗",
                "failed",
                &format!("Repository command exited with status {exit_code}"),
            );
        }
        if InspectionSummary::is_verification_command(command) {
            return self.task_line(
                "32",
                "✓",
                "result",
                &format!("{duration:.1}s · verification completed"),
            );
        }
        self
    }
    fn announce_finalizing(self) -> Self {
        if matches!(self.state.finalizing, Announcement::Announced) {
            return self;
        }
        let state = TaskProgressState {
            finalizing: Announcement::Announced,
            ..self.state.clone()
        };
        self.checkpoint(state)
            .task_line("36", "◆", "report", "Finalizing task result")
    }
    fn task_line(self, color: &str, symbol: &str, kind: &str, message: &str) -> Self {
        let decoration = self.state.decorate;
        let symbol = decoration.paint(color, symbol);
        let label = TaskProgressLabel {
            task_id: &self.state.task_id,
        };
        let task_id = decoration.paint(
            label.agent_color(),
            &format!("{:<30}", label.compact_task_id()),
        );
        let kind = decoration.paint("2", &format!("{kind:<7}"));
        let message = ProgressText { message }.compact_text(140);
        self.write(format!("    {symbol}  {task_id} {kind} · {message}\n"))
            .flush()
    }
}
#[derive(Clone, Copy)]
struct PlanningProgressState {
    decorate: ProgressDecoration,
    inspection_step: usize,
    reasoning: ReasoningLine,
    evidence: ReasoningEvidence,
    plan_output: Announcement,
}
pub(super) struct ProgressReporter<W> {
    pub(super) writer: W,
    state: PlanningProgressState,
}
impl<W: Write> ProgressReporter<W> {
    pub(super) fn new(output: ProgressOutput<W>) -> Self {
        Self {
            writer: output.writer,
            state: PlanningProgressState {
                decorate: output.decoration,
                inspection_step: 0,
                reasoning: ReasoningLine::Closed,
                evidence: ReasoningEvidence::None,
                plan_output: Announcement::Pending,
            },
        }
    }
    fn output(self, plan: ProgressPlan<PlanningProgressState>) -> (Self, io::Result<()>) {
        let (state, writer, outcome) = plan.output(self.writer);
        (Self { writer, state }, outcome)
    }
    pub(super) fn observe(self, event: &EventMsg) -> (Self, io::Result<()>) {
        let plan = ProgressPlan::new(self.state);
        let plan = match event {
            EventMsg::TurnStarted(_) => plan.phase(
                "●",
                "Planning started",
                ProgressDetail::Detail("Loading repository instructions and project context"),
            ),
            EventMsg::ReasoningContentDelta(event) => plan.reasoning_delta(&event.delta),
            EventMsg::AgentReasoning(event)
                if matches!(plan.state.evidence, ReasoningEvidence::None) =>
            {
                plan.note(event.text.trim())
            }
            EventMsg::AgentReasoningSectionBreak(_) => plan.finish_reasoning(),
            EventMsg::ExecCommandBegin(event) => plan.inspection(&event.command),
            EventMsg::ExecCommandEnd(event) if event.exit_code != 0 => {
                plan.failed_inspection(event.exit_code, &event.command)
            }
            EventMsg::AgentMessageContentDelta(_) => plan.announce_plan_output(),
            EventMsg::Warning(event) | EventMsg::GuardianWarning(event) => {
                plan.alert("!", "Warning", &event.message, "33")
            }
            EventMsg::StreamError(event) => {
                plan.alert("↻", "Connection retry", &event.message, "33")
            }
            EventMsg::ModelReroute(event) => plan.phase(
                "↪",
                "Model rerouted",
                ProgressDetail::Detail(&format!("{} → {}", event.from_model, event.to_model)),
            ),
            EventMsg::TurnComplete(_) => plan.phase(
                "✓",
                "Plan ready",
                ProgressDetail::Detail("Validating tasks and DAG dependencies"),
            ),
            _ => plan,
        };
        self.output(plan)
    }
    #[cfg(test)]
    pub(super) fn reasoning_delta(self, delta: &str) -> (Self, io::Result<()>) {
        let plan = ProgressPlan::new(self.state).reasoning_delta(delta);
        self.output(plan)
    }
    #[cfg(test)]
    pub(super) fn announce_plan_output(self) -> (Self, io::Result<()>) {
        let plan = ProgressPlan::new(self.state).announce_plan_output();
        self.output(plan)
    }
    #[cfg(test)]
    pub(super) fn inspection(self, command: &[String]) -> (Self, io::Result<()>) {
        let plan = ProgressPlan::new(self.state).inspection(command);
        self.output(plan)
    }
    #[cfg(test)]
    pub(super) fn failed_inspection(self, code: i32, command: &[String]) -> (Self, io::Result<()>) {
        let plan = ProgressPlan::new(self.state).failed_inspection(code, command);
        self.output(plan)
    }
    #[cfg(test)]
    pub(super) fn phase(
        self,
        symbol: &str,
        title: &str,
        detail: ProgressDetail<'_>,
    ) -> (Self, io::Result<()>) {
        let plan = ProgressPlan::new(self.state).phase(symbol, title, detail);
        self.output(plan)
    }
    #[cfg(test)]
    pub(super) fn note(self, message: &str) -> (Self, io::Result<()>) {
        let plan = ProgressPlan::new(self.state).note(message);
        self.output(plan)
    }
    #[cfg(test)]
    pub(super) fn alert(
        self,
        symbol: &str,
        title: &str,
        detail: &str,
        color: &str,
    ) -> (Self, io::Result<()>) {
        let plan = ProgressPlan::new(self.state).alert(symbol, title, detail, color);
        self.output(plan)
    }
    #[cfg(test)]
    pub(super) fn finish_reasoning(self) -> (Self, io::Result<()>) {
        let plan = ProgressPlan::new(self.state).finish_reasoning();
        self.output(plan)
    }
    #[cfg(test)]
    pub(super) fn plan_output_announced(&self) -> Announcement {
        self.state.plan_output
    }
}
impl ProgressPlan<PlanningProgressState> {
    fn reasoning_delta(self, delta: &str) -> Self {
        let state = PlanningProgressState {
            evidence: ReasoningEvidence::Seen,
            ..self.state
        };
        let mut plan = self.checkpoint(state);
        for part in delta.split_inclusive('\n') {
            if matches!(plan.state.reasoning, ReasoningLine::Closed) {
                let prefix = plan.state.decorate.paint("2", "  ↳ ");
                let state = PlanningProgressState {
                    reasoning: ReasoningLine::Open,
                    ..plan.state
                };
                plan = plan.write(prefix).checkpoint(state);
            }
            plan = plan.write(part.to_owned());
            if part.ends_with('\n') {
                let state = PlanningProgressState {
                    reasoning: ReasoningLine::Closed,
                    ..plan.state
                };
                plan = plan.checkpoint(state);
            }
        }
        plan.flush()
    }
    fn finish_reasoning(self) -> Self {
        if matches!(self.state.reasoning, ReasoningLine::Closed) {
            return self;
        }
        let state = PlanningProgressState {
            reasoning: ReasoningLine::Closed,
            ..self.state
        };
        self.write("\n".to_owned()).checkpoint(state)
    }
    fn announce_plan_output(self) -> Self {
        if matches!(self.state.plan_output, Announcement::Announced) {
            return self;
        }
        let state = PlanningProgressState {
            plan_output: Announcement::Announced,
            ..self.state
        };
        self.checkpoint(state).phase(
            "◆",
            "Building feature plan",
            ProgressDetail::Detail("Writing structured tasks and dependencies"),
        )
    }
    fn inspection(self, command: &[String]) -> Self {
        let plan = self.finish_reasoning();
        let state = PlanningProgressState {
            inspection_step: plan.state.inspection_step + 1,
            ..plan.state
        };
        let plan = plan.checkpoint(state);
        let summary = InspectionSummary::summarize_inspection(command);
        let number = state
            .decorate
            .paint("36", &format!("{:02}", state.inspection_step));
        let title = state.decorate.paint("1", summary.title);
        let mut plan = plan.write(format!("  {number}  {title}\n"));
        if let InspectionHints::Files(detail) = summary.detail {
            plan = plan.write(format!(
                "{}\n",
                state.decorate.paint("2", &format!("      {detail}"))
            ));
        }
        plan.flush()
    }
    fn failed_inspection(self, exit_code: i32, command: &[String]) -> Self {
        let plan = self.finish_reasoning();
        let decoration = plan.state.decorate;
        let symbol = decoration.paint("31", "✗");
        let title = decoration.paint("1;31", "Repository inspection failed");
        let command = decoration.paint("2", &format!("     {}", command.join(" ")));
        plan.write(format!("  {symbol}  {title} (exit {exit_code})\n"))
            .write(format!("{command}\n"))
            .flush()
    }
    fn phase(self, symbol: &str, title: &str, detail: ProgressDetail<'_>) -> Self {
        let plan = self.finish_reasoning();
        let decoration = plan.state.decorate;
        let symbol = decoration.paint(if symbol == "✓" { "32" } else { "36" }, symbol);
        let title = decoration.paint("1", title);
        let mut plan = plan.write(format!("  {symbol}  {title}\n"));
        if let ProgressDetail::Detail(detail) = detail {
            plan = plan.write(format!(
                "{}\n",
                decoration.paint("2", &format!("     {detail}"))
            ));
        }
        plan.flush()
    }
    fn note(self, message: &str) -> Self {
        let mut plan = self.finish_reasoning();
        for line in message.lines().filter(|line| !line.trim().is_empty()) {
            let line = plan
                .state
                .decorate
                .paint("2", &format!("  ↳ {}", line.trim()));
            plan = plan.write(format!("{line}\n"));
        }
        plan.flush()
    }
    fn alert(self, symbol: &str, title: &str, detail: &str, color: &str) -> Self {
        let plan = self.finish_reasoning();
        let decoration = plan.state.decorate;
        let symbol = decoration.paint(color, symbol);
        let title = decoration.paint(&format!("1;{color}"), title);
        let detail = decoration.paint("2", &format!("     {detail}"));
        plan.write(format!("  {symbol}  {title}\n"))
            .write(format!("{detail}\n"))
            .flush()
    }
}
impl ProgressDecoration {
    fn paint(self, code: &str, text: &str) -> String {
        if matches!(self, Self::Ansi) {
            format!("\u{1b}[{code}m{text}\u{1b}[0m")
        } else {
            text.to_owned()
        }
    }
}
impl TaskProgressLabel<'_> {
    pub(super) fn compact_task_id(&self) -> String {
        let task_id = self.task_id;
        const WIDTH: usize = 30;
        if task_id.chars().count() <= WIDTH {
            return task_id.to_owned();
        }
        let prefix = task_id.chars().take(WIDTH - 1).collect::<String>();
        format!("{prefix}…")
    }
}

impl TaskProgressLabel<'_> {
    pub(super) fn agent_color(&self) -> &'static str {
        let task_id = self.task_id;
        const COLORS: [&str; 4] = ["36", "35", "34", "33"];
        let index = task_id
            .bytes()
            .fold(0usize, |hash, byte| hash.wrapping_mul(31) + byte as usize)
            % COLORS.len();
        COLORS[index]
    }
}

impl ProgressText<'_> {
    pub(super) fn compact_text(&self, limit: usize) -> String {
        let message = self.message;
        let normalized = message.split_whitespace().collect::<Vec<_>>().join(" ");
        if normalized.chars().count() <= limit {
            return normalized;
        }
        let prefix = normalized
            .chars()
            .take(limit.saturating_sub(1))
            .collect::<String>();
        format!("{prefix}…")
    }
}

impl InspectionSummary {
    pub(super) fn is_verification_command(command: &[String]) -> bool {
        let command = command.join(" ").to_ascii_lowercase();
        [
            "cargo test",
            "cargo clippy",
            "cargo fmt",
            "task ",
            "bun test",
            "bun run test",
            "npm test",
            "npm run test",
            "pytest",
            "go test",
        ]
        .iter()
        .any(|marker| command.contains(marker))
    }
}

pub(super) struct InspectionSummary {
    title: &'static str,
    detail: InspectionHints,
}

impl InspectionSummary {
    pub(super) fn summarize_inspection(command: &[String]) -> InspectionSummary {
        let command_text = command.join(" ");
        let title = if command_text.contains("AGENTS.md") {
            "Discovering project instructions"
        } else if command_text.contains(".cortex/") {
            "Reading architecture and project guidance"
        } else if command_text.contains("rg -n") || command_text.contains("rg --line-number") {
            "Searching implementation"
        } else if command_text.contains("rg --files") {
            "Mapping repository structure"
        } else if command_text.contains("sed -n") {
            "Reading implementation context"
        } else if command_text.contains("cargo ") || command_text.contains("task ") {
            "Checking repository behavior"
        } else {
            "Inspecting repository"
        };

        InspectionSummary {
            title,
            detail: InspectionSummary::inspection_file_hints(&command_text),
        }
    }
}

impl InspectionSummary {
    pub(super) fn inspection_file_hints(command: &str) -> InspectionHints {
        let mut files = Vec::new();
        for token in command.split_whitespace() {
            let token = token.trim_matches(|character: char| {
                matches!(character, '\'' | '"' | ';' | ',' | '(' | ')' | ':' | '\\')
            });
            let looks_like_file = [".md", ".rs", ".ts", ".svelte", ".yml", ".yaml", ".toml"]
                .iter()
                .any(|extension| token.ends_with(extension));
            if looks_like_file
                && !token.starts_with('!')
                && !token.contains('*')
                && !files.contains(&token)
            {
                files.push(token);
            }
            if files.len() == 3 {
                break;
            }
        }

        if files.is_empty() {
            InspectionHints::NoHints
        } else {
            InspectionHints::Files(files.join(" · "))
        }
    }
}

#[derive(Clone, Copy)]
pub(super) enum ProgressDecoration {
    Plain,
    Ansi,
}

pub(super) struct ProgressOutput<W> {
    pub(super) writer: W,
    pub(super) decoration: ProgressDecoration,
}
pub(super) struct TaskProgressOutput<W> {
    pub(super) output: ProgressOutput<W>,
    pub(super) task_id: String,
}

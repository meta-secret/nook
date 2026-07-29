use super::*;

pub(super) enum TurnProgress<W> {
    Planning(ProgressReporter<W>),
    Task(TaskProgressReporter<W>),
}

impl<W: Write> TurnProgress<W> {
    pub(super) fn observe(&mut self, event: &EventMsg) -> io::Result<()> {
        match self {
            Self::Planning(progress) => progress.observe(event),
            Self::Task(progress) => progress.observe(event),
        }
    }
}

pub(super) struct TaskProgressReporter<W> {
    pub(super) writer: W,
    decorate: bool,
    task_id: String,
    step: usize,
    finalizing_announced: bool,
}

impl<W: Write> TaskProgressReporter<W> {
    pub(super) fn new(writer: W, decorate: bool, task_id: String) -> Self {
        Self {
            writer,
            decorate,
            task_id,
            step: 0,
            finalizing_announced: false,
        }
    }

    pub(super) fn observe(&mut self, event: &EventMsg) -> io::Result<()> {
        match event {
            EventMsg::TurnStarted(_) => self.line("36", "●", "start", "Agent started"),
            EventMsg::ExecCommandBegin(_) => {
                self.step += 1;
                let message = format!("{:02} Running repository command", self.step);
                self.line("36", "↳", "action", &message)
            }
            EventMsg::ExecCommandEnd(event) => self.command_finished(
                &event.command,
                event.exit_code,
                event.duration.as_secs_f64(),
            ),
            EventMsg::PatchApplyBegin(_) => {
                self.line("35", "✎", "edit", "Applying repository changes")
            }
            EventMsg::PatchApplyEnd(event) if !event.success => {
                self.line("31", "✗", "edit", "Code patch failed")
            }
            EventMsg::Warning(_) | EventMsg::GuardianWarning(_) => {
                self.line("33", "!", "warning", "Embedded turn reported a warning")
            }
            EventMsg::StreamError(_) => {
                self.line("33", "↻", "retry", "Embedded turn connection retry")
            }
            EventMsg::ModelReroute(_) => {
                self.line("36", "↪", "model", "Embedded turn model rerouted")
            }
            EventMsg::AgentMessageContentDelta(_) => self.announce_finalizing(),
            EventMsg::Error(_) => self.line("31", "✗", "error", "Embedded turn failed"),
            EventMsg::TurnAborted(_) => self.line("31", "✗", "aborted", "Embedded turn aborted"),
            _ => Ok(()),
        }
    }

    pub(super) fn command_finished(
        &mut self,
        command: &[String],
        exit_code: i32,
        duration_seconds: f64,
    ) -> io::Result<()> {
        if exit_code != 0 {
            return self.line(
                "31",
                "✗",
                "failed",
                &format!("Repository command exited with status {exit_code}"),
            );
        }
        if is_verification_command(command) {
            return self.line(
                "32",
                "✓",
                "result",
                &format!("{duration_seconds:.1}s · verification completed"),
            );
        }
        Ok(())
    }

    pub(super) fn announce_finalizing(&mut self) -> io::Result<()> {
        if self.finalizing_announced {
            return Ok(());
        }
        self.finalizing_announced = true;
        self.line("36", "◆", "report", "Finalizing task result")
    }

    pub(super) fn line(
        &mut self,
        color: &str,
        symbol: &str,
        kind: &str,
        message: &str,
    ) -> io::Result<()> {
        let symbol = self.paint(color, symbol);
        let task_id = compact_task_id(&self.task_id);
        let task_id = self.paint(agent_color(&self.task_id), &format!("{task_id:<30}"));
        let kind = self.paint("2", &format!("{kind:<7}"));
        let message = compact_text(message, 140);
        writeln!(self.writer, "    {symbol}  {task_id} {kind} · {message}")?;
        self.writer.flush()
    }

    pub(super) fn paint(&self, code: &str, text: &str) -> String {
        if self.decorate {
            format!("\u{1b}[{code}m{text}\u{1b}[0m")
        } else {
            text.to_owned()
        }
    }
}

pub(super) fn compact_task_id(task_id: &str) -> String {
    const WIDTH: usize = 30;
    if task_id.chars().count() <= WIDTH {
        return task_id.to_owned();
    }
    let prefix = task_id.chars().take(WIDTH - 1).collect::<String>();
    format!("{prefix}…")
}

pub(super) fn agent_color(task_id: &str) -> &'static str {
    const COLORS: [&str; 4] = ["36", "35", "34", "33"];
    let index = task_id
        .bytes()
        .fold(0usize, |hash, byte| hash.wrapping_mul(31) + byte as usize)
        % COLORS.len();
    COLORS[index]
}

pub(super) fn compact_text(message: &str, limit: usize) -> String {
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

pub(super) struct ProgressReporter<W> {
    pub(super) writer: W,
    decorate: bool,
    inspection_step: usize,
    reasoning_open: bool,
    saw_reasoning_delta: bool,
    pub(super) plan_output_announced: bool,
}

impl<W: Write> ProgressReporter<W> {
    pub(super) fn new(writer: W, decorate: bool) -> Self {
        Self {
            writer,
            decorate,
            inspection_step: 0,
            reasoning_open: false,
            saw_reasoning_delta: false,
            plan_output_announced: false,
        }
    }

    pub(super) fn observe(&mut self, event: &EventMsg) -> io::Result<()> {
        match event {
            EventMsg::TurnStarted(_) => self.phase(
                "●",
                "Planning started",
                Some("Loading repository instructions and project context"),
            ),
            EventMsg::ReasoningContentDelta(event) => self.reasoning_delta(&event.delta),
            EventMsg::AgentReasoning(event) if !self.saw_reasoning_delta => {
                self.note(event.text.trim())
            }
            EventMsg::AgentReasoningSectionBreak(_) => self.finish_reasoning(),
            EventMsg::ExecCommandBegin(event) => self.inspection(&event.command),
            EventMsg::ExecCommandEnd(event) if event.exit_code != 0 => {
                self.failed_inspection(event.exit_code, &event.command)
            }
            EventMsg::AgentMessageContentDelta(_) => self.announce_plan_output(),
            EventMsg::Warning(event) | EventMsg::GuardianWarning(event) => {
                self.alert("!", "Warning", &event.message, "33")
            }
            EventMsg::StreamError(event) => {
                self.alert("↻", "Connection retry", &event.message, "33")
            }
            EventMsg::ModelReroute(event) => self.phase(
                "↪",
                "Model rerouted",
                Some(&format!("{} → {}", event.from_model, event.to_model)),
            ),
            EventMsg::TurnComplete(_) => self.phase(
                "✓",
                "Plan ready",
                Some("Validating tasks and DAG dependencies"),
            ),
            _ => Ok(()),
        }
    }

    pub(super) fn reasoning_delta(&mut self, delta: &str) -> io::Result<()> {
        self.saw_reasoning_delta = true;
        for part in delta.split_inclusive('\n') {
            if !self.reasoning_open {
                let prefix = self.paint("2", "  ↳ ");
                write!(self.writer, "{prefix}")?;
                self.reasoning_open = true;
            }
            write!(self.writer, "{part}")?;
            if part.ends_with('\n') {
                self.reasoning_open = false;
            }
        }
        self.writer.flush()
    }

    pub(super) fn announce_plan_output(&mut self) -> io::Result<()> {
        if self.plan_output_announced {
            return Ok(());
        }
        self.plan_output_announced = true;
        self.phase(
            "◆",
            "Building feature plan",
            Some("Writing structured tasks and dependencies"),
        )
    }

    pub(super) fn inspection(&mut self, command: &[String]) -> io::Result<()> {
        self.finish_reasoning()?;
        self.inspection_step += 1;
        let summary = summarize_inspection(command);
        let number = self.paint("36", &format!("{:02}", self.inspection_step));
        let title = self.paint("1", summary.title);
        writeln!(self.writer, "  {number}  {title}")?;
        if let Some(detail) = summary.detail {
            let detail = self.paint("2", &format!("      {detail}"));
            writeln!(self.writer, "{detail}")?;
        }
        self.writer.flush()
    }

    pub(super) fn failed_inspection(
        &mut self,
        exit_code: i32,
        command: &[String],
    ) -> io::Result<()> {
        self.finish_reasoning()?;
        let symbol = self.paint("31", "✗");
        let title = self.paint("1;31", "Repository inspection failed");
        writeln!(self.writer, "  {symbol}  {title} (exit {exit_code})")?;
        let command = self.paint("2", &format!("     {}", command.join(" ")));
        writeln!(self.writer, "{command}")?;
        self.writer.flush()
    }

    pub(super) fn phase(
        &mut self,
        symbol: &str,
        title: &str,
        detail: Option<&str>,
    ) -> io::Result<()> {
        self.finish_reasoning()?;
        let color = if symbol == "✓" { "32" } else { "36" };
        let symbol = self.paint(color, symbol);
        let title = self.paint("1", title);
        writeln!(self.writer, "  {symbol}  {title}")?;
        if let Some(detail) = detail {
            let detail = self.paint("2", &format!("     {detail}"));
            writeln!(self.writer, "{detail}")?;
        }
        self.writer.flush()
    }

    pub(super) fn note(&mut self, message: &str) -> io::Result<()> {
        self.finish_reasoning()?;
        for line in message.lines().filter(|line| !line.trim().is_empty()) {
            let line = self.paint("2", &format!("  ↳ {}", line.trim()));
            writeln!(self.writer, "{line}")?;
        }
        self.writer.flush()
    }

    pub(super) fn alert(
        &mut self,
        symbol: &str,
        title: &str,
        detail: &str,
        color: &str,
    ) -> io::Result<()> {
        self.finish_reasoning()?;
        let symbol = self.paint(color, symbol);
        let title = self.paint(&format!("1;{color}"), title);
        writeln!(self.writer, "  {symbol}  {title}")?;
        let detail = self.paint("2", &format!("     {detail}"));
        writeln!(self.writer, "{detail}")?;
        self.writer.flush()
    }

    pub(super) fn paint(&self, code: &str, text: &str) -> String {
        if self.decorate {
            format!("\u{1b}[{code}m{text}\u{1b}[0m")
        } else {
            text.to_owned()
        }
    }

    pub(super) fn finish_reasoning(&mut self) -> io::Result<()> {
        if self.reasoning_open {
            writeln!(self.writer)?;
            self.reasoning_open = false;
        }
        Ok(())
    }
}

pub(super) struct InspectionSummary {
    title: &'static str,
    detail: Option<String>,
}

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
        detail: inspection_file_hints(&command_text),
    }
}

pub(super) fn inspection_file_hints(command: &str) -> Option<String> {
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

    (!files.is_empty()).then(|| files.join(" · "))
}

use std::fs;
use std::io::{self, IsTerminal, Read};
use std::path::{Path, PathBuf};

use anyhow::{Result, bail};
use clap::{Args, Parser, Subcommand};
use codex::Arg0DispatchPaths;
use nook_meta_agent::{
    CodexOptions, DEFAULT_CODEX_MODEL, DEFAULT_CODEX_REASONING_EFFORT, ExecutionEvent, Executor,
    InProcessCodexRunner, Planner, load_feature, write_feature,
};

#[derive(Debug, Parser)]
#[command(
    name = "meta-agent",
    version,
    about = "Plan coding features as validated DAGs for parallel Codex execution"
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Ask Codex to inspect a repository and create a feature DAG directory.
    Plan(PlanArgs),
    /// Validate an existing feature directory or feature.yaml file.
    Validate {
        /// Feature directory or path to feature.yaml.
        path: PathBuf,
    },
    /// Execute a feature DAG with parallel embedded Codex agents.
    Execute(ExecuteArgs),
}

#[derive(Debug, Args)]
struct PlanArgs {
    /// Feature request. Reads stdin when omitted.
    #[arg(conflicts_with = "prompt_file")]
    prompt: Option<String>,

    /// Read the feature request from a UTF-8 file.
    #[arg(long, value_name = "FILE")]
    prompt_file: Option<PathBuf>,

    /// Repository Codex should inspect.
    #[arg(long, default_value = ".")]
    repo_root: PathBuf,

    /// Parent directory for generated feature directories, relative to repo-root by default.
    #[arg(long, default_value = "agentic-ai/meta-agent/target/features")]
    output_root: PathBuf,

    /// Override the model-generated stable feature ID.
    #[arg(long)]
    feature_id: Option<String>,

    /// Override the Codex model; defaults to gpt-5.6-luna.
    #[arg(long)]
    model: Option<String>,

    /// Override reasoning effort; defaults to low (lighter reasoning).
    #[arg(long)]
    reasoning_effort: Option<String>,
}

#[derive(Debug, Args)]
struct ExecuteArgs {
    /// Feature directory or path to feature.yaml.
    feature: PathBuf,

    /// Repository the agents should modify.
    #[arg(long, default_value = ".")]
    repo_root: PathBuf,

    /// Override the Codex model; defaults to gpt-5.6-luna.
    #[arg(long)]
    model: Option<String>,

    /// Override reasoning effort; defaults to low (lighter reasoning).
    #[arg(long)]
    reasoning_effort: Option<String>,
}

fn main() -> Result<()> {
    codex::arg0_dispatch_or_else(run_main)
}

async fn run_main(arg0_paths: Arg0DispatchPaths) -> Result<()> {
    match Cli::parse().command {
        Command::Plan(args) => run_plan(args, arg0_paths).await,
        Command::Validate { path } => {
            let plan = load_feature(&path)?;
            print_schedule(&plan)?;
            Ok(())
        }
        Command::Execute(args) => run_execute(args, arg0_paths).await,
    }
}

async fn run_execute(args: ExecuteArgs, arg0_paths: Arg0DispatchPaths) -> Result<()> {
    let repo_root = absolute(&args.repo_root)?;
    let feature_path = absolute(&args.feature)?;
    let plan = load_feature(&feature_path)?;
    let mut options = CodexOptions::new(repo_root).with_workspace_write();
    if let Some(model) = args.model {
        options.model = Some(model);
    }
    if let Some(reasoning_effort) = args.reasoning_effort {
        options.reasoning_effort = reasoning_effort;
    }
    options.arg0_paths = arg0_paths;
    print_execute_header(&options, &feature_path, &plan);

    let decorate = io::stderr().is_terminal() && std::env::var_os("NO_COLOR").is_none();
    let observe = |event| print_execution_event(event, decorate);
    let report = Executor::new(InProcessCodexRunner::new(options))
        .execute(&feature_path, &observe)
        .await?;

    let decorate = io::stdout().is_terminal() && std::env::var_os("NO_COLOR").is_none();
    println!();
    println!(
        "  {}  {}",
        paint(decorate, "32", "✓"),
        paint(decorate, "1;32", "Feature execution complete")
    );
    println!(
        "     {} · {} tasks · {} safe batches",
        report.feature_id,
        report.outcomes.len(),
        report.batches.len()
    );
    Ok(())
}

async fn run_plan(args: PlanArgs, arg0_paths: Arg0DispatchPaths) -> Result<()> {
    let prompt = resolve_prompt(&args)?;
    let repo_root = absolute(&args.repo_root)?;
    let output_root = if args.output_root.is_absolute() {
        args.output_root.clone()
    } else {
        repo_root.join(&args.output_root)
    };

    let mut options = CodexOptions::new(repo_root);
    if let Some(model) = args.model {
        options.model = Some(model);
    }
    if let Some(reasoning_effort) = args.reasoning_effort {
        options.reasoning_effort = reasoning_effort;
    }
    options.arg0_paths = arg0_paths;
    print_run_header(&options);
    let plan = Planner::new(InProcessCodexRunner::new(options))
        .plan(&prompt, args.feature_id.as_deref())
        .await?;
    let target = write_feature(&output_root, &plan, &prompt)?;

    let decorate = io::stdout().is_terminal() && std::env::var_os("NO_COLOR").is_none();
    println!();
    println!(
        "  {}  {}",
        paint(decorate, "32", "✓"),
        paint(decorate, "1;32", "Feature plan created")
    );
    println!("     {}", target.display());
    println!();
    print_schedule(&plan)?;
    Ok(())
}

fn print_run_header(options: &CodexOptions) {
    let decorate = io::stderr().is_terminal() && std::env::var_os("NO_COLOR").is_none();
    let model = options.model.as_deref().unwrap_or(DEFAULT_CODEX_MODEL);
    let reasoning = if options.reasoning_effort.is_empty() {
        DEFAULT_CODEX_REASONING_EFFORT
    } else {
        &options.reasoning_effort
    };
    eprintln!();
    eprintln!(
        "{}",
        paint(decorate, "1;36", "╭─ Meta-agent ─────────────────────────")
    );
    eprintln!(
        "{} {} {}",
        paint(decorate, "36", "│"),
        paint(decorate, "2", &format!("{:<11}", "Repository")),
        options.repo_root.display()
    );
    eprintln!(
        "{} {} {}",
        paint(decorate, "36", "│"),
        paint(decorate, "2", &format!("{:<11}", "Model")),
        model
    );
    eprintln!(
        "{} {} {}",
        paint(decorate, "36", "│"),
        paint(decorate, "2", &format!("{:<11}", "Reasoning")),
        reasoning
    );
    eprintln!(
        "{}",
        paint(decorate, "36", "╰──────────────────────────────────────")
    );
    eprintln!();
}

fn print_execute_header(
    options: &CodexOptions,
    feature_path: &Path,
    plan: &nook_meta_agent::FeaturePlan,
) {
    let decorate = io::stderr().is_terminal() && std::env::var_os("NO_COLOR").is_none();
    let model = options.model.as_deref().unwrap_or(DEFAULT_CODEX_MODEL);
    let reasoning = if options.reasoning_effort.is_empty() {
        DEFAULT_CODEX_REASONING_EFFORT
    } else {
        &options.reasoning_effort
    };
    let feature_path = feature_path.display().to_string();
    let repo_root = options.repo_root.display().to_string();

    eprintln!();
    eprintln!(
        "{}",
        paint(decorate, "1;36", "╭─ Meta-agent execute ─────────────────")
    );
    for (label, value) in [
        ("Feature", plan.feature.id.as_str()),
        ("DAG", feature_path.as_str()),
        ("Repository", repo_root.as_str()),
        ("Model", model),
        ("Reasoning", reasoning),
    ] {
        eprintln!(
            "{} {} {}",
            paint(decorate, "36", "│"),
            paint(decorate, "2", &format!("{label:<11}")),
            value
        );
    }
    eprintln!(
        "{}",
        paint(decorate, "36", "╰──────────────────────────────────────")
    );
    eprintln!();
}

fn print_execution_event(event: ExecutionEvent, decorate: bool) {
    match event {
        ExecutionEvent::BatchStarted {
            index,
            total,
            tasks,
        } => {
            eprintln!(
                "  {}  {}",
                paint(decorate, "36", "◆"),
                paint(
                    decorate,
                    "1",
                    &format!(
                        "Wave {index}/{total} · {} agent{}",
                        tasks.len(),
                        if tasks.len() == 1 { "" } else { "s" }
                    )
                )
            );
            for task in tasks {
                eprintln!("     {}  {task}", paint(decorate, "36", "●"));
            }
        }
        ExecutionEvent::TaskCompleted { task_id, summary } => eprintln!(
            "     {}  {} · {}",
            paint(decorate, "32", "✓"),
            paint(decorate, "1", &task_id),
            summary
        ),
        ExecutionEvent::TaskFailed { task_id, message } => eprintln!(
            "     {}  {} · {}",
            paint(decorate, "31", "✗"),
            paint(decorate, "1;31", &task_id),
            message
        ),
        ExecutionEvent::BatchCompleted { index, total } => {
            eprintln!(
                "     {}  Wave {index}/{total} complete",
                paint(decorate, "32", "✓")
            );
            eprintln!();
        }
    }
}

fn resolve_prompt(args: &PlanArgs) -> Result<String> {
    if let Some(prompt) = &args.prompt {
        return Ok(prompt.clone());
    }
    if let Some(path) = &args.prompt_file {
        return Ok(fs::read_to_string(path)?);
    }
    if io::stdin().is_terminal() {
        bail!("provide a prompt argument, --prompt-file, or pipe the prompt on stdin");
    }

    let mut prompt = String::new();
    io::stdin().read_to_string(&mut prompt)?;
    Ok(prompt)
}

fn absolute(path: &Path) -> Result<PathBuf, io::Error> {
    if path.is_absolute() {
        return Ok(path.to_owned());
    }
    Ok(std::env::current_dir()?.join(path))
}

fn print_schedule(plan: &nook_meta_agent::FeaturePlan) -> Result<()> {
    let batches = plan.execution_batches()?;
    let decorate = io::stdout().is_terminal() && std::env::var_os("NO_COLOR").is_none();
    println!(
        "  {}  {}",
        paint(decorate, "36", "◆"),
        paint(decorate, "1", "Execution plan")
    );
    println!(
        "     {} · {} tasks · {} safe parallel batches",
        plan.feature.id,
        plan.tasks.len(),
        batches.len()
    );
    for (index, batch) in batches.iter().enumerate() {
        println!(
            "     {}  {}",
            paint(decorate, "36", &format!("{:02}", index + 1)),
            batch.join("  ·  ")
        );
    }
    Ok(())
}

fn paint(enabled: bool, code: &str, text: &str) -> String {
    if enabled {
        format!("\u{1b}[{code}m{text}\u{1b}[0m")
    } else {
        text.to_owned()
    }
}

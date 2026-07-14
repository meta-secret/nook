use std::fs;
use std::io::{self, IsTerminal, Read};
use std::path::{Path, PathBuf};

use anyhow::{Result, bail};
use clap::{Args, Parser, Subcommand};
use codex::Arg0DispatchPaths;
use nook_meta_agent::{
    CodexOptions, DEFAULT_CODEX_MODEL, DEFAULT_CODEX_REASONING_EFFORT, InProcessCodexRunner,
    Planner, load_feature, write_feature,
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
    }
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
    eprintln!(
        "Inspecting {} with Codex (model: {}, effort: {})...",
        options.repo_root.display(),
        options.model.as_deref().unwrap_or(DEFAULT_CODEX_MODEL),
        if options.reasoning_effort.is_empty() {
            DEFAULT_CODEX_REASONING_EFFORT
        } else {
            &options.reasoning_effort
        }
    );
    let plan = Planner::new(InProcessCodexRunner::new(options))
        .plan(&prompt, args.feature_id.as_deref())
        .await?;
    let target = write_feature(&output_root, &plan, &prompt)?;

    println!("Created {}", target.display());
    print_schedule(&plan)?;
    Ok(())
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
    println!(
        "Valid feature `{}`: {} tasks in {} safe execution batches",
        plan.feature.id,
        plan.tasks.len(),
        batches.len()
    );
    for (index, batch) in batches.iter().enumerate() {
        println!("  Batch {}: {}", index + 1, batch.join(", "));
    }
    Ok(())
}

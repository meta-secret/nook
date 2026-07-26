use std::path::PathBuf;

use anyhow::Context;
use clap::{Parser, Subcommand};
use hive::model::{AgentId, EnqueueTask, TaskId};
use hive::{Neo4jTaskStore, TaskStore, Worker, WorkerConfig};

#[derive(Debug, Parser)]
#[command(name = "hive", about = "Run isolated Nook coding agents")]
struct Cli {
    #[arg(
        long,
        env = "NEO4J_URI",
        default_value = "neo4j://hive-neo4j.hive-data.svc.cluster.local:7687"
    )]
    neo4j_uri: String,
    #[arg(long, env = "NEO4J_USERNAME", default_value = "neo4j")]
    neo4j_username: String,
    #[arg(long, env = "NEO4J_PASSWORD", hide_env_values = true)]
    neo4j_password: String,
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    Worker {
        #[arg(long, env = "HIVE_AGENT_ID")]
        agent_id: String,
        #[arg(long, env = "HOSTNAME")]
        pod_name: String,
        #[arg(
            long,
            env = "HIVE_REPOSITORY_URL",
            default_value = "https://github.com/meta-secret/nook.git"
        )]
        repository_url: String,
        #[arg(long, env = "HIVE_WORKSPACE", default_value = "/workspace")]
        workspace: PathBuf,
        #[arg(long, env = "HIVE_LEASE_SECONDS", default_value_t = 300)]
        lease_seconds: i64,
        #[arg(long, env = "HIVE_HEARTBEAT_SECONDS", default_value_t = 60)]
        heartbeat_seconds: u64,
        #[arg(long, env = "HIVE_TASK_TIMEOUT_SECONDS", default_value_t = 3600)]
        task_timeout_seconds: u64,
        #[arg(long, env = "HIVE_POLL_MIN_SECONDS", default_value_t = 5)]
        poll_min_seconds: u64,
        #[arg(long, env = "HIVE_POLL_MAX_SECONDS", default_value_t = 15)]
        poll_max_seconds: u64,
        #[arg(long, env = "HIVE_CODEX_MODEL")]
        model: Option<String>,
        #[arg(long, env = "HIVE_CODEX_REASONING_EFFORT", default_value = "medium")]
        reasoning_effort: String,
    },
    Migrate,
    Enqueue {
        #[arg(long)]
        id: String,
        #[arg(long, default_value = "code")]
        kind: String,
        #[arg(long)]
        prompt: String,
        #[arg(long, default_value_t = 0)]
        priority: i64,
        #[arg(long, default_value_t = 3)]
        max_attempts: i64,
        #[arg(long, value_delimiter = ',')]
        depends_on: Vec<String>,
    },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    let store =
        Neo4jTaskStore::connect(&cli.neo4j_uri, &cli.neo4j_username, &cli.neo4j_password).await?;

    match cli.command {
        Command::Worker {
            agent_id,
            pod_name,
            repository_url,
            workspace,
            lease_seconds,
            heartbeat_seconds,
            task_timeout_seconds,
            poll_min_seconds,
            poll_max_seconds,
            model,
            reasoning_effort,
        } => {
            if heartbeat_seconds == 0 || i64::try_from(heartbeat_seconds)? >= lease_seconds {
                anyhow::bail!("heartbeat interval must be positive and shorter than the lease");
            }
            if poll_min_seconds == 0 || poll_min_seconds > poll_max_seconds {
                anyhow::bail!("poll interval must be positive and ordered");
            }
            Worker::new(
                store,
                WorkerConfig {
                    agent_id: AgentId::new(agent_id).map_err(anyhow::Error::msg)?,
                    pod_name,
                    repository_url,
                    workspace,
                    lease_seconds,
                    heartbeat_seconds,
                    task_timeout_seconds,
                    poll_min_seconds,
                    poll_max_seconds,
                    model,
                    reasoning_effort,
                },
            )
            .run()
            .await
        }
        Command::Migrate => store.migrate().await,
        Command::Enqueue {
            id,
            kind,
            prompt,
            priority,
            max_attempts,
            depends_on,
        } => {
            store.migrate().await?;
            let dependencies = depends_on
                .into_iter()
                .map(|value| TaskId::new(value).map_err(anyhow::Error::msg))
                .collect::<anyhow::Result<Vec<_>>>()
                .context("invalid dependency id")?;
            store
                .enqueue(&EnqueueTask {
                    id: TaskId::new(id).map_err(anyhow::Error::msg)?,
                    kind,
                    prompt,
                    priority,
                    max_attempts,
                    dependencies,
                })
                .await
        }
    }
}

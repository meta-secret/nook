use std::path::PathBuf;

use anyhow::Context;
use clap::{Parser, Subcommand};
use codex::{Arg0DispatchPaths, arg0_dispatch_or_else};
use hive::auth::run_auth_broker;
use hive::codex::{DEFAULT_CODEX_MODEL, DEFAULT_CODEX_REASONING_EFFORT};
use hive::coordinator::run_coordinator;
use hive::dispatcher::run_workbench_dispatcher;
use hive::model::{AgentId, EnqueueTask, TaskId};
use hive::publication::{GitHubRequest, run_publication_broker, run_publication_client};
use hive::{
    CoordinatorTaskStore, Neo4jTaskStore, TaskStore, Worker, WorkerConfig,
    install_rustls_crypto_provider,
};

#[derive(Debug, Parser)]
#[command(name = "hive", about = "Run isolated Nook coding agents")]
struct Cli {
    #[arg(
        long,
        env = "NEO4J_URI",
        default_value = "neo4j+s://hive-neo4j.hive-data.svc.cluster.local:7687"
    )]
    neo4j_uri: String,
    #[arg(long, env = "NEO4J_USERNAME", default_value = "neo4j")]
    neo4j_username: String,
    #[arg(long, env = "NEO4J_PASSWORD", hide_env_values = true)]
    neo4j_password: Option<String>,
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
        #[arg(long, env = "HIVE_TASK_TIMEOUT_SECONDS", default_value_t = 21600)]
        task_timeout_seconds: u64,
        #[arg(long, env = "HIVE_POLL_MIN_SECONDS", default_value_t = 5)]
        poll_min_seconds: u64,
        #[arg(long, env = "HIVE_POLL_MAX_SECONDS", default_value_t = 15)]
        poll_max_seconds: u64,
        #[arg(
            long,
            env = "HIVE_CODEX_MODEL",
            default_value = DEFAULT_CODEX_MODEL
        )]
        model: Option<String>,
        #[arg(
            long,
            env = "HIVE_CODEX_REASONING_EFFORT",
            default_value = DEFAULT_CODEX_REASONING_EFFORT
        )]
        reasoning_effort: String,
        #[arg(
            long,
            env = "HIVE_AUTH_SOCKET",
            default_value = "/run/hive-auth/broker.sock"
        )]
        auth_socket: PathBuf,
        #[arg(
            long,
            env = "HIVE_PUBLICATION_SOCKET",
            default_value = "/run/hive-publication/broker.sock"
        )]
        publication_socket: PathBuf,
        #[arg(
            long,
            env = "HIVE_COORDINATOR_SOCKET",
            default_value = "/run/hive-coordinator/coordinator.sock"
        )]
        coordinator_socket: PathBuf,
    },
    Coordinator {
        #[arg(
            long,
            env = "HIVE_COORDINATOR_SOCKET",
            default_value = "/run/hive-coordinator/coordinator.sock"
        )]
        socket: PathBuf,
    },
    WorkbenchDispatcher {
        #[arg(
            long,
            env = "HIVE_WORKBENCH_CONTENTS_URL",
            default_value = "https://api.github.com/repos/meta-secret/nook-workbench/contents/issues/hive-isolated-agent-platform?ref=main"
        )]
        contents_url: String,
        #[arg(long, env = "HIVE_WORKBENCH_POLL_SECONDS", default_value_t = 120)]
        poll_seconds: u64,
    },
    AuthBroker {
        #[arg(
            long,
            env = "HIVE_AUTH_SOCKET",
            default_value = "/run/hive-auth/broker.sock"
        )]
        socket: PathBuf,
        #[arg(
            long,
            env = "HIVE_AUTH_SOURCE",
            default_value = "/run/secrets/codex/auth.json"
        )]
        auth_source: PathBuf,
        #[arg(long, env = "HIVE_AUTH_HOME", default_value = "/var/lib/hive-auth")]
        auth_home: PathBuf,
    },
    PublicationBroker {
        #[arg(
            long,
            env = "HIVE_PUBLICATION_SOCKET",
            default_value = "/run/hive-publication/broker.sock"
        )]
        socket: PathBuf,
        #[arg(
            long,
            env = "HIVE_GITHUB_TOKEN_FILE",
            default_value = "/run/secrets/github/token"
        )]
        token_file: PathBuf,
        #[arg(long, env = "HIVE_WORKSPACE", default_value = "/workspace")]
        workspace: PathBuf,
        #[arg(
            long,
            env = "HIVE_PUBLICATION_HOME",
            default_value = "/var/lib/hive-publication"
        )]
        private_home: PathBuf,
    },
    Github {
        #[arg(
            long,
            env = "HIVE_PUBLICATION_SOCKET",
            default_value = "/run/hive-publication/broker.sock"
        )]
        socket: PathBuf,
        #[command(subcommand)]
        action: GitHubAction,
    },
    Queue {
        #[command(subcommand)]
        action: QueueAction,
    },
    Migrate,
    Enqueue {
        #[arg(long)]
        id: String,
        #[arg(long, default_value = "code")]
        kind: String,
        #[arg(long)]
        prompt: String,
        #[arg(long)]
        source_commit: String,
        #[arg(long, default_value_t = 0)]
        priority: i64,
        #[arg(long, default_value_t = 3)]
        max_attempts: i64,
        #[arg(long, value_delimiter = ',')]
        depends_on: Vec<String>,
    },
}

#[derive(Debug, Subcommand)]
enum GitHubAction {
    Publish {
        #[arg(long)]
        title: String,
        #[arg(long)]
        body: String,
    },
    Inspect,
    ReplyThread {
        #[arg(long)]
        thread_id: String,
        #[arg(long)]
        body: String,
    },
    ReplyFeedback {
        #[arg(long)]
        feedback_id: String,
        #[arg(long)]
        body: String,
    },
    ResolveThread {
        #[arg(long)]
        thread_id: String,
    },
    Merge {
        #[arg(long)]
        expected_head: String,
    },
    VerifyMain {
        #[arg(long)]
        merge_commit: String,
    },
}

#[derive(Debug, Subcommand)]
enum QueueAction {
    Status {
        #[arg(long, default_value_t = 50)]
        limit: i64,
    },
    RetryFailedMain {
        #[arg(long)]
        task_id: String,
    },
}

fn main() -> anyhow::Result<()> {
    install_rustls_crypto_provider()?;
    arg0_dispatch_or_else(run_main)
}

async fn run_main(arg0_paths: Arg0DispatchPaths) -> anyhow::Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Command::AuthBroker {
            socket,
            auth_source,
            auth_home,
        } => run_auth_broker(socket, auth_source, auth_home).await,
        Command::PublicationBroker {
            socket,
            token_file,
            workspace,
            private_home,
        } => run_publication_broker(socket, workspace, token_file, private_home).await,
        Command::Github { socket, action } => {
            let request = match action {
                GitHubAction::Publish { title, body } => GitHubRequest::Publish { title, body },
                GitHubAction::Inspect => GitHubRequest::Inspect,
                GitHubAction::ReplyThread { thread_id, body } => {
                    GitHubRequest::ReplyThread { thread_id, body }
                }
                GitHubAction::ReplyFeedback { feedback_id, body } => {
                    GitHubRequest::ReplyFeedback { feedback_id, body }
                }
                GitHubAction::ResolveThread { thread_id } => {
                    GitHubRequest::ResolveThread { thread_id }
                }
                GitHubAction::Merge { expected_head } => GitHubRequest::Merge { expected_head },
                GitHubAction::VerifyMain { merge_commit } => {
                    GitHubRequest::VerifyMain { merge_commit }
                }
            };
            run_publication_client(&socket, request).await
        }
        Command::Queue { action } => {
            let neo4j_password = cli
                .neo4j_password
                .as_deref()
                .context("NEO4J_PASSWORD is required for queue operations")?;
            let store =
                Neo4jTaskStore::connect(&cli.neo4j_uri, &cli.neo4j_username, neo4j_password)
                    .await?;
            store.migrate().await?;
            match action {
                QueueAction::Status { limit } => {
                    println!(
                        "{}",
                        serde_json::to_string_pretty(&store.queue_status(limit).await?)?
                    );
                    Ok(())
                }
                QueueAction::RetryFailedMain { task_id } => {
                    let task_id = TaskId::new(task_id).map_err(anyhow::Error::msg)?;
                    if !store.retry_failed_main_task(&task_id).await? {
                        anyhow::bail!("task {task_id} is not a retryable failed Main-repair task");
                    }
                    println!("requeued {task_id} with 3 additional attempts");
                    Ok(())
                }
            }
        }
        Command::Coordinator { socket } => {
            let neo4j_password = cli
                .neo4j_password
                .as_deref()
                .context("NEO4J_PASSWORD is required for the coordinator")?;
            let store =
                Neo4jTaskStore::connect(&cli.neo4j_uri, &cli.neo4j_username, neo4j_password)
                    .await?;
            run_coordinator(socket, store).await
        }
        Command::WorkbenchDispatcher {
            contents_url,
            poll_seconds,
        } => {
            let neo4j_password = cli
                .neo4j_password
                .as_deref()
                .context("NEO4J_PASSWORD is required for the Workbench dispatcher")?;
            let store =
                Neo4jTaskStore::connect(&cli.neo4j_uri, &cli.neo4j_username, neo4j_password)
                    .await?;
            run_workbench_dispatcher(store, &contents_url, poll_seconds).await
        }
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
            auth_socket,
            publication_socket,
            coordinator_socket,
        } => {
            let store = CoordinatorTaskStore::connect(&coordinator_socket).await?;
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
                    arg0_paths,
                    auth_socket,
                    publication_socket,
                },
            )
            .run()
            .await
        }
        Command::Migrate => {
            let neo4j_password = cli
                .neo4j_password
                .as_deref()
                .context("NEO4J_PASSWORD is required for migration")?;
            Neo4jTaskStore::connect(&cli.neo4j_uri, &cli.neo4j_username, neo4j_password)
                .await?
                .migrate()
                .await
        }
        Command::Enqueue {
            id,
            kind,
            prompt,
            source_commit,
            priority,
            max_attempts,
            depends_on,
        } => {
            let neo4j_password = cli
                .neo4j_password
                .as_deref()
                .context("NEO4J_PASSWORD is required for enqueue")?;
            let store =
                Neo4jTaskStore::connect(&cli.neo4j_uri, &cli.neo4j_username, neo4j_password)
                    .await?;
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
                    source_commit,
                    priority,
                    max_attempts,
                    dependencies,
                })
                .await
        }
    }
}

#[cfg(test)]
mod tests {
    use super::install_rustls_crypto_provider;

    #[test]
    fn production_tls_crypto_provider_is_available() {
        install_rustls_crypto_provider().expect("AWS-LC provider should install");

        let _client = rustls::ClientConfig::builder()
            .with_root_certificates(rustls::RootCertStore::empty())
            .with_no_client_auth();
    }
}

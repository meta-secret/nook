use std::net::SocketAddr;
use std::path::PathBuf;

use clap::{Parser, Subcommand};
use codex::{Arg0DispatchPaths, arg0_dispatch_or_else};
use hive::HiveContext;
use hive::auth::run_auth_broker;
use hive::codex::{DEFAULT_CODEX_MODEL, DEFAULT_CODEX_REASONING_EFFORT};
use hive::coordinator::run_coordinator;
use hive::dispatcher::{
    check_workbench_dispatcher_health, check_workbench_dispatcher_progress,
    prepare_dispatcher_health, run_workbench_dispatcher,
};
use hive::model::{AgentId, EnqueueTask, TaskId, TaskTrigger};
use hive::observer::{ObserverCoordinatorStore, run_observer, run_observer_coordinator};
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
        model: String,
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
            env = "HIVE_COORDINATOR_SOCKET",
            default_value = "/run/hive-coordinator/coordinator.sock"
        )]
        coordinator_socket: PathBuf,
        #[arg(long, env = "HIVE_CODEX_LINUX_SANDBOX_EXE")]
        codex_linux_sandbox_exe: Option<PathBuf>,
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
            env = "HIVE_WORKBENCH_REPOSITORY_URL",
            default_value = "https://github.com/meta-secret/nook-workbench.git"
        )]
        repository_url: String,
        #[arg(
            long,
            env = "HIVE_WORKBENCH_CHECKOUT",
            default_value = "/tmp/nook-workbench"
        )]
        checkout: PathBuf,
        #[arg(
            long,
            env = "HIVE_WORKBENCH_HEALTH_PATH",
            default_value = "/tmp/hive-workbench-dispatcher-health"
        )]
        health_path: PathBuf,
        #[arg(long, env = "HIVE_WORKBENCH_POLL_SECONDS", default_value_t = 120)]
        poll_seconds: u64,
    },
    WorkbenchDispatcherHealth {
        #[arg(
            long,
            env = "HIVE_WORKBENCH_HEALTH_PATH",
            default_value = "/tmp/hive-workbench-dispatcher-health"
        )]
        health_path: PathBuf,
        #[arg(
            long,
            env = "HIVE_WORKBENCH_HEALTH_MAX_AGE_SECONDS",
            default_value_t = 600
        )]
        max_age_seconds: u64,
        #[arg(long)]
        progress: bool,
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
    Queue {
        #[command(subcommand)]
        action: QueueAction,
    },
    Observer {
        #[arg(long, env = "HIVE_OBSERVER_ADDRESS", default_value = "0.0.0.0:8080")]
        address: SocketAddr,
        #[arg(
            long,
            env = "HIVE_DASHBOARD_PATH",
            default_value = "/usr/local/share/hive-console"
        )]
        dashboard: PathBuf,
        #[arg(
            long,
            env = "HIVE_COORDINATOR_SOCKET",
            default_value = "/run/hive-coordinator/coordinator.sock"
        )]
        coordinator_socket: PathBuf,
    },
    ObserverCoordinator {
        #[arg(
            long,
            env = "HIVE_COORDINATOR_SOCKET",
            default_value = "/run/hive-coordinator/coordinator.sock"
        )]
        socket: PathBuf,
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
enum QueueAction {
    Status {
        #[arg(long, default_value_t = 50)]
        limit: i64,
    },
    RetryFailedMain {
        #[arg(long)]
        task_id: String,
        #[arg(long)]
        release_id: String,
    },
    Cancel {
        #[arg(long)]
        task_id: String,
        #[arg(long)]
        reason: String,
    },
}

fn main() -> hive::HiveResult<()> {
    install_rustls_crypto_provider()?;
    arg0_dispatch_or_else(|paths| async move { run_main(paths).await.map_err(Into::into) })
        .map_err(|error| hive::HiveError::message(error.to_string()))
}

async fn run_main(arg0_paths: Arg0DispatchPaths) -> hive::HiveResult<()> {
    let cli = Cli::parse();

    match cli.command {
        Command::AuthBroker {
            socket,
            auth_source,
            auth_home,
        } => run_auth_broker(socket, auth_source, auth_home).await,
        Command::Queue { action } => {
            let neo4j_password = cli
                .neo4j_password
                .as_deref()
                .hive_context("NEO4J_PASSWORD is required for queue operations")?;
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
                QueueAction::RetryFailedMain {
                    task_id,
                    release_id,
                } => {
                    let task_id = TaskId::new(task_id)?;
                    if !store.retry_failed_main_task(&task_id, &release_id).await? {
                        return Err(hive::HiveError::message(format!(
                            "task {task_id} is not a retryable failed Main-repair task"
                        )));
                    }
                    println!(
                        "requeued failed chain for {task_id} with at least 3 remaining attempts per runnable member on {release_id}"
                    );
                    Ok(())
                }
                QueueAction::Cancel { task_id, reason } => {
                    let task_id = TaskId::new(task_id)?;
                    if !store.cancel(&task_id, &reason).await? {
                        return Err(hive::HiveError::message(format!(
                            "task {task_id} is not an active cancellable Hive task"
                        )));
                    }
                    println!("cancelled {task_id}");
                    Ok(())
                }
            }
        }
        Command::Observer {
            address,
            dashboard,
            coordinator_socket,
        } => {
            let store = ObserverCoordinatorStore::connect(&coordinator_socket).await?;
            run_observer(store, address, dashboard).await
        }
        Command::ObserverCoordinator { socket } => {
            let neo4j_password = cli
                .neo4j_password
                .as_deref()
                .hive_context("NEO4J_PASSWORD is required for the observer coordinator")?;
            let store =
                Neo4jTaskStore::connect(&cli.neo4j_uri, &cli.neo4j_username, neo4j_password)
                    .await?;
            run_observer_coordinator(socket, store).await
        }
        Command::Coordinator { socket } => {
            let neo4j_password = cli
                .neo4j_password
                .as_deref()
                .hive_context("NEO4J_PASSWORD is required for the coordinator")?;
            let store =
                Neo4jTaskStore::connect(&cli.neo4j_uri, &cli.neo4j_username, neo4j_password)
                    .await?;
            run_coordinator(socket, store).await
        }
        Command::WorkbenchDispatcher {
            repository_url,
            checkout,
            health_path,
            poll_seconds,
        } => {
            prepare_dispatcher_health(&health_path).await?;
            let neo4j_password = cli
                .neo4j_password
                .as_deref()
                .hive_context("NEO4J_PASSWORD is required for the Workbench dispatcher")?;
            let store = tokio::time::timeout(
                std::time::Duration::from_secs(300),
                Neo4jTaskStore::connect(&cli.neo4j_uri, &cli.neo4j_username, neo4j_password),
            )
            .await
            .map_err(|_| {
                hive::HiveError::message(
                    "Workbench dispatcher Neo4j connection exceeded 300 seconds",
                )
            })??;
            run_workbench_dispatcher(
                store,
                &repository_url,
                &checkout,
                &health_path,
                poll_seconds,
            )
            .await
        }
        Command::WorkbenchDispatcherHealth {
            health_path,
            max_age_seconds,
            progress,
        } => {
            let max_age = std::time::Duration::from_secs(max_age_seconds);
            if progress {
                check_workbench_dispatcher_progress(&health_path, max_age)
            } else {
                check_workbench_dispatcher_health(&health_path, max_age)
            }
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
            coordinator_socket,
            codex_linux_sandbox_exe,
        } => {
            let store = CoordinatorTaskStore::connect(&coordinator_socket).await?;
            if heartbeat_seconds == 0 || i64::try_from(heartbeat_seconds)? >= lease_seconds {
                return Err(hive::HiveError::message(
                    "heartbeat interval must be positive and shorter than the lease",
                ));
            }
            if poll_min_seconds == 0 || poll_min_seconds > poll_max_seconds {
                return Err(hive::HiveError::message(
                    "poll interval must be positive and ordered",
                ));
            }
            let arg0_paths = with_linux_sandbox_override(arg0_paths, codex_linux_sandbox_exe);
            Worker::new(
                store,
                WorkerConfig {
                    agent_id: AgentId::new(agent_id)?,
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
                },
            )
            .run()
            .await
        }
        Command::Migrate => {
            let neo4j_password = cli
                .neo4j_password
                .as_deref()
                .hive_context("NEO4J_PASSWORD is required for migration")?;
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
                .hive_context("NEO4J_PASSWORD is required for enqueue")?;
            let store =
                Neo4jTaskStore::connect(&cli.neo4j_uri, &cli.neo4j_username, neo4j_password)
                    .await?;
            store.migrate().await?;
            let dependencies = depends_on
                .into_iter()
                .map(TaskId::new)
                .collect::<Result<Vec<_>, _>>()
                .hive_context("invalid dependency id")?;
            store
                .enqueue(&EnqueueTask {
                    id: TaskId::new(id)?,
                    kind,
                    trigger: TaskTrigger::ManualCli,
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

fn with_linux_sandbox_override(
    mut arg0_paths: Arg0DispatchPaths,
    override_path: Option<PathBuf>,
) -> Arg0DispatchPaths {
    if let Some(path) = override_path {
        arg0_paths.codex_linux_sandbox_exe = Some(path);
    }
    arg0_paths
}

#[cfg(test)]
mod tests {
    use clap::Parser;

    use super::{
        Arg0DispatchPaths, Cli, Command, PathBuf, QueueAction, install_rustls_crypto_provider,
    };

    fn parse(arguments: &[&str]) -> hive::HiveResult<Cli> {
        Cli::try_parse_from(arguments).map_err(|error| hive::HiveError::message(error.to_string()))
    }

    #[test]
    fn production_tls_crypto_provider_is_available() -> hive::HiveResult<()> {
        install_rustls_crypto_provider()?;

        let _client = rustls::ClientConfig::builder()
            .with_root_certificates(rustls::RootCertStore::empty())
            .with_no_client_auth();
        Ok(())
    }

    #[test]
    fn worker_can_override_the_embedded_codex_linux_sandbox() {
        let original = PathBuf::from("/tmp/codex-linux-sandbox");
        let replacement = PathBuf::from("/usr/local/bin/hive-codex-linux-sandbox");
        let paths = super::with_linux_sandbox_override(
            Arg0DispatchPaths {
                codex_linux_sandbox_exe: Some(original),
                ..Arg0DispatchPaths::default()
            },
            Some(replacement.clone()),
        );

        assert_eq!(paths.codex_linux_sandbox_exe, Some(replacement));
    }

    #[test]
    fn worker_and_service_commands_preserve_explicit_and_default_configuration()
    -> hive::HiveResult<()> {
        let worker = parse(&[
            "hive",
            "worker",
            "--agent-id",
            "agent-7",
            "--pod-name",
            "pod-7",
            "--workspace",
            "/tmp/worker",
            "--lease-seconds",
            "90",
            "--heartbeat-seconds",
            "30",
            "--poll-min-seconds",
            "2",
            "--poll-max-seconds",
            "4",
            "--codex-linux-sandbox-exe",
            "/bin/sandbox",
        ])?;
        let Command::Worker {
            agent_id,
            pod_name,
            repository_url,
            workspace,
            lease_seconds,
            heartbeat_seconds,
            poll_min_seconds,
            poll_max_seconds,
            codex_linux_sandbox_exe,
            ..
        } = worker.command
        else {
            return Err(hive::HiveError::message(
                "worker command parsed as another variant",
            ));
        };
        assert_eq!(agent_id, "agent-7");
        assert_eq!(pod_name, "pod-7");
        assert_eq!(repository_url, "https://github.com/meta-secret/nook.git");
        assert_eq!(workspace, PathBuf::from("/tmp/worker"));
        assert_eq!((lease_seconds, heartbeat_seconds), (90, 30));
        assert_eq!((poll_min_seconds, poll_max_seconds), (2, 4));
        assert_eq!(codex_linux_sandbox_exe, Some(PathBuf::from("/bin/sandbox")));

        let coordinator = parse(&["hive", "coordinator", "--socket", "/tmp/coordinator"])?;
        assert!(matches!(
            coordinator.command,
            Command::Coordinator { socket } if socket.as_path() == std::path::Path::new("/tmp/coordinator")
        ));
        let observer = parse(&[
            "hive",
            "observer",
            "--address",
            "127.0.0.1:8081",
            "--dashboard",
            "/tmp/dashboard",
            "--coordinator-socket",
            "/tmp/observer-coordinator",
        ])?;
        assert!(matches!(
            observer.command,
            Command::Observer { address, dashboard, coordinator_socket }
                if address.to_string() == "127.0.0.1:8081"
                    && dashboard.as_path() == std::path::Path::new("/tmp/dashboard")
                    && coordinator_socket.as_path() == std::path::Path::new("/tmp/observer-coordinator")
        ));
        let observer_coordinator = parse(&[
            "hive",
            "observer-coordinator",
            "--socket",
            "/tmp/observer-store",
        ])?;
        assert!(matches!(
            observer_coordinator.command,
            Command::ObserverCoordinator { socket } if socket.as_path() == std::path::Path::new("/tmp/observer-store")
        ));
        Ok(())
    }

    #[test]
    fn dispatcher_auth_and_queue_commands_keep_their_typed_actions() -> hive::HiveResult<()> {
        let dispatcher = parse(&[
            "hive",
            "workbench-dispatcher",
            "--repository-url",
            "https://example.invalid/workbench.git",
            "--checkout",
            "/tmp/workbench",
            "--health-path",
            "/tmp/health",
            "--poll-seconds",
            "45",
        ])?;
        assert!(matches!(
            dispatcher.command,
            Command::WorkbenchDispatcher {
                repository_url,
                checkout,
                health_path,
                poll_seconds: 45,
            } if repository_url == "https://example.invalid/workbench.git"
                && checkout.as_path() == std::path::Path::new("/tmp/workbench")
                && health_path.as_path() == std::path::Path::new("/tmp/health")
        ));
        let health = parse(&[
            "hive",
            "workbench-dispatcher-health",
            "--health-path",
            "/tmp/health",
            "--max-age-seconds",
            "120",
            "--progress",
        ])?;
        assert!(matches!(
            health.command,
            Command::WorkbenchDispatcherHealth {
                health_path,
                max_age_seconds: 120,
                progress: true,
            } if health_path.as_path() == std::path::Path::new("/tmp/health")
        ));
        let broker = parse(&[
            "hive",
            "auth-broker",
            "--socket",
            "/tmp/auth.sock",
            "--auth-source",
            "/tmp/source.json",
            "--auth-home",
            "/tmp/auth-home",
        ])?;
        assert!(matches!(
            broker.command,
            Command::AuthBroker { socket, auth_source, auth_home }
                if socket.as_path() == std::path::Path::new("/tmp/auth.sock")
                    && auth_source.as_path() == std::path::Path::new("/tmp/source.json")
                    && auth_home.as_path() == std::path::Path::new("/tmp/auth-home")
        ));

        for (arguments, expected) in [
            (
                vec!["hive", "queue", "status", "--limit", "17"],
                QueueAction::Status { limit: 17 },
            ),
            (
                vec![
                    "hive",
                    "queue",
                    "retry-failed-main",
                    "--task-id",
                    "task-1",
                    "--release-id",
                    "release-1",
                ],
                QueueAction::RetryFailedMain {
                    task_id: "task-1".into(),
                    release_id: "release-1".into(),
                },
            ),
            (
                vec![
                    "hive",
                    "queue",
                    "cancel",
                    "--task-id",
                    "task-2",
                    "--reason",
                    "obsolete",
                ],
                QueueAction::Cancel {
                    task_id: "task-2".into(),
                    reason: "obsolete".into(),
                },
            ),
        ] {
            let queue = parse(&arguments)?;
            match (queue.command, expected) {
                (Command::Queue { action }, QueueAction::Status { limit }) => {
                    assert!(
                        matches!(action, QueueAction::Status { limit: actual } if actual == limit)
                    );
                }
                (
                    Command::Queue { action },
                    QueueAction::RetryFailedMain {
                        task_id,
                        release_id,
                    },
                ) => {
                    assert!(
                        matches!(action, QueueAction::RetryFailedMain { task_id: actual_task, release_id: actual_release } if actual_task == task_id && actual_release == release_id)
                    );
                }
                (Command::Queue { action }, QueueAction::Cancel { task_id, reason }) => {
                    assert!(
                        matches!(action, QueueAction::Cancel { task_id: actual_task, reason: actual_reason } if actual_task == task_id && actual_reason == reason)
                    );
                }
                _ => return Err(hive::HiveError::message("queue action parsed incorrectly")),
            }
        }
        assert!(matches!(
            parse(&["hive", "migrate"])?.command,
            Command::Migrate
        ));
        Ok(())
    }

    #[test]
    fn enqueue_command_parses_dependency_and_attempt_contracts() -> hive::HiveResult<()> {
        let enqueue = parse(&[
            "hive",
            "enqueue",
            "--id",
            "task-9",
            "--kind",
            "main-repair",
            "--prompt",
            "repair main",
            "--source-commit",
            "0123456789abcdef0123456789abcdef01234567",
            "--priority",
            "100",
            "--max-attempts",
            "5",
            "--depends-on",
            "task-1,task-2",
        ])?;
        let Command::Enqueue {
            id,
            kind,
            prompt,
            source_commit,
            priority,
            max_attempts,
            depends_on,
        } = enqueue.command
        else {
            return Err(hive::HiveError::message(
                "enqueue parsed as another variant",
            ));
        };
        assert_eq!(id, "task-9");
        assert_eq!(kind, "main-repair");
        assert_eq!(prompt, "repair main");
        assert_eq!(source_commit.len(), 40);
        assert_eq!((priority, max_attempts), (100, 5));
        assert_eq!(depends_on, vec!["task-1".to_owned(), "task-2".to_owned()]);
        assert!(
            Cli::try_parse_from([
                "hive",
                "worker",
                "--agent-id",
                "agent-1",
                "--pod-name",
                "pod-1",
                "--lease-seconds",
                "not-a-number",
            ])
            .is_err()
        );
        Ok(())
    }
}

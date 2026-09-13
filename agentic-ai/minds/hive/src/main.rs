mod cli_authentication;
mod cli_sandbox;
use cli_authentication::Neo4jAuthentication;
use cli_sandbox::SandboxExecutable;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::time;
use tokio::time as async_time;

use clap::{Parser, Subcommand};
use codex::{Arg0DispatchPaths, arg0_dispatch_or_else};
use hive::HiveContext;
use hive::auth::AuthBroker;
use hive::codex::{DEFAULT_CODEX_MODEL, DEFAULT_CODEX_REASONING_EFFORT};
use hive::coordinator::CoordinatorServer;
use hive::dispatcher::{DispatcherHealth, WorkbenchDispatcher};
use hive::model::{AgentId, EnqueueTask, TaskId, TaskTrigger};
use hive::observer::{ObserverCoordinator, ObserverCoordinatorStore, ObserverServer};
use hive::{
    CoordinatorTaskStore, HIVE_TLS_PROVIDER, Neo4jTaskStore, TaskStore, Worker, WorkerConfig,
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
    #[command(flatten)]
    neo4j_password: Neo4jAuthentication,
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
        #[command(flatten)]
        codex_linux_sandbox_exe: SandboxExecutable,
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
    HIVE_TLS_PROVIDER.install()?;
    arg0_dispatch_or_else(|paths| async move { Cli::run_main(paths).await.map_err(Into::into) })
        .map_err(|error| hive::HiveError::message(error.to_string()))
}

struct CliInvocation {
    arg0_paths: Arg0DispatchPaths,
    neo4j_uri: String,
    neo4j_username: String,
    neo4j_password: Neo4jAuthentication,
}

struct WorkbenchDispatcherRequest {
    repository_url: String,
    checkout: PathBuf,
    health_path: PathBuf,
    poll_seconds: u64,
}

struct WorkerRequest {
    agent_id: String,
    pod_name: String,
    repository_url: String,
    workspace: PathBuf,
    lease_seconds: i64,
    heartbeat_seconds: u64,
    task_timeout_seconds: u64,
    poll_min_seconds: u64,
    poll_max_seconds: u64,
    model: String,
    reasoning_effort: String,
    auth_socket: PathBuf,
    coordinator_socket: PathBuf,
    codex_linux_sandbox_exe: SandboxExecutable,
}

struct EnqueueRequest {
    id: String,
    kind: String,
    prompt: String,
    source_commit: String,
    priority: i64,
    max_attempts: i64,
    depends_on: Vec<String>,
}

struct ObserverRequest {
    address: SocketAddr,
    dashboard: PathBuf,
    coordinator_socket: PathBuf,
}

struct DispatcherHealthRequest {
    health_path: PathBuf,
    max_age_seconds: u64,
    progress: bool,
}

enum CliCommand {
    AuthBroker(AuthBroker),
    Queue(QueueAction),
    Observer(ObserverRequest),
    ObserverCoordinator(PathBuf),
    Coordinator(PathBuf),
    WorkbenchDispatcher(WorkbenchDispatcherRequest),
    WorkbenchDispatcherHealth(DispatcherHealthRequest),
    Worker(WorkerRequest),
    Migrate,
    Enqueue(EnqueueRequest),
}

impl From<Command> for CliCommand {
    fn from(command: Command) -> Self {
        match command {
            Command::AuthBroker {
                socket,
                auth_source,
                auth_home,
            } => Self::AuthBroker(AuthBroker {
                socket_path: socket,
                auth_source,
                auth_home,
            }),
            Command::Queue { action } => Self::Queue(action),
            Command::Observer {
                address,
                dashboard,
                coordinator_socket,
            } => Self::Observer(ObserverRequest {
                address,
                dashboard,
                coordinator_socket,
            }),
            Command::ObserverCoordinator { socket } => Self::ObserverCoordinator(socket),
            Command::Coordinator { socket } => Self::Coordinator(socket),
            Command::WorkbenchDispatcher {
                repository_url,
                checkout,
                health_path,
                poll_seconds,
            } => Self::WorkbenchDispatcher(WorkbenchDispatcherRequest {
                repository_url,
                checkout,
                health_path,
                poll_seconds,
            }),
            Command::WorkbenchDispatcherHealth {
                health_path,
                max_age_seconds,
                progress,
            } => Self::WorkbenchDispatcherHealth(DispatcherHealthRequest {
                health_path,
                max_age_seconds,
                progress,
            }),
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
            } => Self::Worker(WorkerRequest {
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
            }),
            Command::Migrate => Self::Migrate,
            Command::Enqueue {
                id,
                kind,
                prompt,
                source_commit,
                priority,
                max_attempts,
                depends_on,
            } => Self::Enqueue(EnqueueRequest {
                id,
                kind,
                prompt,
                source_commit,
                priority,
                max_attempts,
                depends_on,
            }),
        }
    }
}

impl CliInvocation {
    async fn run(self, command: CliCommand) -> hive::HiveResult<()> {
        match command {
            CliCommand::AuthBroker(broker) => self.run_auth_broker(broker).await,
            CliCommand::Queue(action) => self.run_queue(action).await,
            CliCommand::Observer(request) => self.run_observer(request).await,
            CliCommand::ObserverCoordinator(socket) => self.run_observer_coordinator(socket).await,
            CliCommand::Coordinator(socket) => self.run_coordinator(socket).await,
            CliCommand::WorkbenchDispatcher(request) => {
                self.run_workbench_dispatcher(request).await
            }
            CliCommand::WorkbenchDispatcherHealth(request) => Self::run_dispatcher_health(request),
            CliCommand::Worker(request) => self.run_worker(request).await,
            CliCommand::Migrate => self.run_migrate().await,
            CliCommand::Enqueue(request) => self.run_enqueue(request).await,
        }
    }

    async fn run_auth_broker(self, broker: AuthBroker) -> hive::HiveResult<()> {
        broker.run_auth_broker().await
    }

    async fn run_queue(self, action: QueueAction) -> hive::HiveResult<()> {
        let neo4j_password = self
            .neo4j_password
            .require_password("NEO4J_PASSWORD is required for queue operations")?;
        let store =
            Neo4jTaskStore::connect(&self.neo4j_uri, &self.neo4j_username, neo4j_password).await?;
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
                let task_id = TaskId::try_from(task_id)?;
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
                let task_id = TaskId::try_from(task_id)?;
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

    async fn run_observer_coordinator(self, socket: PathBuf) -> hive::HiveResult<()> {
        let neo4j_password = self
            .neo4j_password
            .require_password("NEO4J_PASSWORD is required for the observer coordinator")?;
        let store =
            Neo4jTaskStore::connect(&self.neo4j_uri, &self.neo4j_username, neo4j_password).await?;
        (ObserverCoordinator { socket, store })
            .run_observer_coordinator()
            .await
    }

    async fn run_observer(self, request: ObserverRequest) -> hive::HiveResult<()> {
        let ObserverRequest {
            address,
            dashboard,
            coordinator_socket,
        } = request;
        let store = ObserverCoordinatorStore::connect(&coordinator_socket).await?;
        (ObserverServer {
            store,
            address,
            dashboard,
        })
        .run_observer()
        .await
    }

    fn run_dispatcher_health(request: DispatcherHealthRequest) -> hive::HiveResult<()> {
        let DispatcherHealthRequest {
            health_path,
            max_age_seconds,
            progress,
        } = request;
        let max_age = time::Duration::from_secs(max_age_seconds);
        if progress {
            DispatcherHealth::check_workbench_dispatcher_progress(&health_path, max_age)
        } else {
            DispatcherHealth::check_workbench_dispatcher_health(&health_path, max_age)
        }
    }

    async fn run_coordinator(self, socket: PathBuf) -> hive::HiveResult<()> {
        let neo4j_password = self
            .neo4j_password
            .require_password("NEO4J_PASSWORD is required for the coordinator")?;
        let store =
            Neo4jTaskStore::connect(&self.neo4j_uri, &self.neo4j_username, neo4j_password).await?;
        (CoordinatorServer { socket, store })
            .run_coordinator()
            .await
    }

    async fn run_workbench_dispatcher(
        self,
        request: WorkbenchDispatcherRequest,
    ) -> hive::HiveResult<()> {
        let WorkbenchDispatcherRequest {
            repository_url,
            checkout,
            health_path,
            poll_seconds,
        } = request;
        (DispatcherHealth {
            health_path: &health_path,
        })
        .prepare_dispatcher_health()
        .await?;
        let neo4j_password = self
            .neo4j_password
            .require_password("NEO4J_PASSWORD is required for the Workbench dispatcher")?;
        let store = async_time::timeout(
            time::Duration::from_mins(5),
            Neo4jTaskStore::connect(&self.neo4j_uri, &self.neo4j_username, neo4j_password),
        )
        .await
        .map_err(|_| {
            hive::HiveError::message("Workbench dispatcher Neo4j connection exceeded 300 seconds")
        })??;
        (WorkbenchDispatcher {
            store,
            repository_url: &repository_url,
            checkout: &checkout,
            health_path: &health_path,
            poll_seconds,
        })
        .run_workbench_dispatcher()
        .await
    }

    async fn run_worker(self, request: WorkerRequest) -> hive::HiveResult<()> {
        let WorkerRequest {
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
        } = request;
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
        let arg0_paths = Cli::with_linux_sandbox_override(self.arg0_paths, codex_linux_sandbox_exe);
        Worker::new(
            store,
            WorkerConfig {
                agent_id: AgentId::try_from(agent_id)?,
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

    async fn run_migrate(self) -> hive::HiveResult<()> {
        let neo4j_password = self
            .neo4j_password
            .require_password("NEO4J_PASSWORD is required for migration")?;
        Neo4jTaskStore::connect(&self.neo4j_uri, &self.neo4j_username, neo4j_password)
            .await?
            .migrate()
            .await
    }

    async fn run_enqueue(self, request: EnqueueRequest) -> hive::HiveResult<()> {
        let EnqueueRequest {
            id,
            kind,
            prompt,
            source_commit,
            priority,
            max_attempts,
            depends_on,
        } = request;
        let neo4j_password = self
            .neo4j_password
            .require_password("NEO4J_PASSWORD is required for enqueue")?;
        let store =
            Neo4jTaskStore::connect(&self.neo4j_uri, &self.neo4j_username, neo4j_password).await?;
        store.migrate().await?;
        let dependencies = depends_on
            .into_iter()
            .map(TaskId::try_from)
            .collect::<Result<Vec<_>, _>>()
            .hive_context("invalid dependency id")?;
        store
            .enqueue(&EnqueueTask {
                id: TaskId::try_from(id)?,
                kind: kind.into(),
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

impl Cli {
    async fn run_main(arg0_paths: Arg0DispatchPaths) -> hive::HiveResult<()> {
        let Cli {
            neo4j_uri,
            neo4j_username,
            neo4j_password,
            command,
        } = Cli::parse();
        let invocation = CliInvocation {
            arg0_paths,
            neo4j_uri,
            neo4j_username,
            neo4j_password,
        };
        invocation.run(CliCommand::from(command)).await
    }
}

impl Cli {
    fn with_linux_sandbox_override(
        mut arg0_paths: Arg0DispatchPaths,
        override_path: SandboxExecutable,
    ) -> Arg0DispatchPaths {
        if let SandboxExecutable::Override(path) = override_path {
            arg0_paths.codex_linux_sandbox_exe = Some(path);
        }
        arg0_paths
    }
}

#[cfg(test)]
mod tests {
    use clap::Parser;
    use std::path;

    use super::{Arg0DispatchPaths, Cli, Command, HIVE_TLS_PROVIDER, PathBuf, QueueAction};

    fn parse(arguments: &[&str]) -> hive::HiveResult<Cli> {
        Cli::try_parse_from(arguments).map_err(|error| hive::HiveError::message(error.to_string()))
    }

    #[test]
    fn production_tls_crypto_provider_is_available() -> hive::HiveResult<()> {
        HIVE_TLS_PROVIDER.install()?;

        let _client = rustls::ClientConfig::builder()
            .with_root_certificates(rustls::RootCertStore::empty())
            .with_no_client_auth();
        Ok(())
    }

    #[test]
    fn worker_can_override_the_embedded_codex_linux_sandbox() {
        let original = PathBuf::from("/tmp/codex-linux-sandbox");
        let replacement = PathBuf::from("/usr/local/bin/hive-codex-linux-sandbox");
        let paths = Cli::with_linux_sandbox_override(
            Arg0DispatchPaths {
                codex_linux_sandbox_exe: Some(original),
                ..Arg0DispatchPaths::default()
            },
            super::SandboxExecutable::Override(replacement.clone()),
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
        assert_eq!(
            codex_linux_sandbox_exe,
            super::SandboxExecutable::Override(PathBuf::from("/bin/sandbox"))
        );

        let coordinator = parse(&["hive", "coordinator", "--socket", "/tmp/coordinator"])?;
        assert!(matches!(
            coordinator.command,
            Command::Coordinator { socket } if socket.as_path() == path::Path::new("/tmp/coordinator")
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
                    && dashboard.as_path() == path::Path::new("/tmp/dashboard")
                    && coordinator_socket.as_path() == path::Path::new("/tmp/observer-coordinator")
        ));
        let observer_coordinator = parse(&[
            "hive",
            "observer-coordinator",
            "--socket",
            "/tmp/observer-store",
        ])?;
        assert!(matches!(
            observer_coordinator.command,
            Command::ObserverCoordinator { socket } if socket.as_path() == path::Path::new("/tmp/observer-store")
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
                && checkout.as_path() == path::Path::new("/tmp/workbench")
                && health_path.as_path() == path::Path::new("/tmp/health")
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
            } if health_path.as_path() == path::Path::new("/tmp/health")
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
                if socket.as_path() == path::Path::new("/tmp/auth.sock")
                    && auth_source.as_path() == path::Path::new("/tmp/source.json")
                    && auth_home.as_path() == path::Path::new("/tmp/auth-home")
        ));
        Ok(())
    }

    #[test]
    fn queue_commands_keep_their_typed_actions() -> hive::HiveResult<()> {
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

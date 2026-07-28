use std::sync::OnceLock;

pub mod auth;
pub mod codex;
pub mod coordinator;
pub mod dispatcher;
pub mod model;
pub mod neo4j;
pub mod observer;
pub mod store;
pub mod worker;

pub use coordinator::CoordinatorTaskStore;
pub use model::{ClaimedTask, EnqueueTask, TaskId};
pub use neo4j::Neo4jTaskStore;
pub use store::TaskStore;
pub use worker::{Worker, WorkerConfig};

static RUSTLS_PROVIDER_INSTALL: OnceLock<Result<(), &'static str>> = OnceLock::new();

pub fn install_rustls_crypto_provider() -> anyhow::Result<()> {
    match RUSTLS_PROVIDER_INSTALL.get_or_init(|| {
        rustls::crypto::aws_lc_rs::default_provider()
            .install_default()
            .map_err(|_| "failed to install the AWS-LC rustls crypto provider")
    }) {
        Ok(()) => Ok(()),
        Err(message) => Err(anyhow::anyhow!(*message)),
    }
}

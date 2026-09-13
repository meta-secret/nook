use rustls::crypto::aws_lc_rs;
use std::sync::OnceLock;
#[cfg(test)]
use tokio::sync as async_sync;

pub mod auth;
pub mod codex;
pub mod coordinator;
mod delivery;
pub mod dispatcher;
pub mod error;
pub mod model;
pub mod neo4j;
pub mod observer;
pub mod store;
pub mod worker;

pub use coordinator::CoordinatorTaskStore;
pub use error::{HiveContext, HiveError, HiveResult};
pub use model::{ClaimedTask, EnqueueTask, TaskId};
pub use neo4j::Neo4jTaskStore;
pub use store::TaskStore;
pub use worker::{Worker, WorkerConfig};

pub struct HiveTlsProvider {
    installation: OnceLock<Result<(), &'static str>>,
}
pub static HIVE_TLS_PROVIDER: HiveTlsProvider = HiveTlsProvider {
    installation: OnceLock::new(),
};

#[cfg(test)]
pub(crate) static GIT_PROCESS_TEST_LOCK: async_sync::Mutex<()> = async_sync::Mutex::const_new(());

impl HiveTlsProvider {
    /// Installs the process-wide AWS-LC rustls provider once.
    ///
    /// # Errors
    ///
    /// Returns an error when AWS-LC rejects installation.
    pub fn install(&self) -> HiveResult<()> {
        match self.installation.get_or_init(|| {
            aws_lc_rs::default_provider()
                .install_default()
                .map_err(|_| "failed to install the AWS-LC rustls crypto provider")
        }) {
            Ok(()) => Ok(()),
            Err(message) => Err(HiveError::message(*message)),
        }
    }
}

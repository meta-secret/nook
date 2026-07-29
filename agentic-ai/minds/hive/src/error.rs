use std::error::Error;

use thiserror::Error;

pub type HiveResult<T> = Result<T, HiveError>;

#[derive(Debug, Error)]
pub enum HiveError {
    #[error("{message}")]
    Message { message: String },
    #[error("{context}: {source}")]
    Context {
        context: String,
        #[source]
        source: Box<dyn Error + Send + Sync>,
    },
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Neo4j(#[from] neo4rs::Error),
    #[error(transparent)]
    Neo4jDecode(#[from] neo4rs::DeError),
    #[error(transparent)]
    Model(#[from] crate::model::ModelError),
    #[error(transparent)]
    Codex(#[from] crate::codex::CodexError),
    #[error(transparent)]
    Utf8(#[from] std::string::FromUtf8Error),
    #[error(transparent)]
    IntegerConversion(#[from] std::num::TryFromIntError),
    #[error(transparent)]
    TimeFormat(#[from] time::error::Format),
    #[error("worker interrupted for rollout")]
    WorkerInterrupted,
    #[error("worker persisted a blocking dependency")]
    WorkerBlocked,
    #[error("worker cancellation requested")]
    WorkerCancellationRequested,
}

impl HiveError {
    pub fn message(message: impl Into<String>) -> Self {
        Self::Message {
            message: message.into(),
        }
    }

    pub fn msg(message: String) -> Self {
        Self::message(message)
    }
}

pub trait HiveContext<T> {
    fn hive_context(self, context: impl Into<String>) -> HiveResult<T>;

    fn with_hive_context<F>(self, context: F) -> HiveResult<T>
    where
        F: FnOnce() -> String;
}

impl<T, E> HiveContext<T> for Result<T, E>
where
    E: Error + Send + Sync + 'static,
{
    fn hive_context(self, context: impl Into<String>) -> HiveResult<T> {
        self.map_err(|source| HiveError::Context {
            context: context.into(),
            source: Box::new(source),
        })
    }

    fn with_hive_context<F>(self, context: F) -> HiveResult<T>
    where
        F: FnOnce() -> String,
    {
        self.map_err(|source| HiveError::Context {
            context: context(),
            source: Box::new(source),
        })
    }
}

impl<T> HiveContext<T> for Option<T> {
    fn hive_context(self, context: impl Into<String>) -> HiveResult<T> {
        self.ok_or_else(|| HiveError::message(context))
    }

    fn with_hive_context<F>(self, context: F) -> HiveResult<T>
    where
        F: FnOnce() -> String,
    {
        self.ok_or_else(|| HiveError::message(context()))
    }
}

#[macro_export]
macro_rules! hive_error {
    ($($argument:tt)*) => {
        $crate::error::HiveError::message(format!($($argument)*))
    };
}

#[macro_export]
macro_rules! hive_bail {
    ($($argument:tt)*) => {
        return Err($crate::hive_error!($($argument)*))
    };
}

#[macro_export]
macro_rules! hive_ensure {
    ($condition:expr, $($argument:tt)*) => {
        if !$condition {
            $crate::hive_bail!($($argument)*);
        }
    };
}

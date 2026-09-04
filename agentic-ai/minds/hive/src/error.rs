use thiserror::Error;

pub type HiveResult<T> = Result<T, HiveError>;

#[derive(Debug, Error)]
pub enum HiveError {
    #[error("{message}")]
    Message { message: String },
    #[error("{operation}: {source}")]
    IoOperation {
        operation: String,
        #[source]
        source: std::io::Error,
    },
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("{operation}: {source}")]
    JsonOperation {
        operation: String,
        #[source]
        source: serde_json::Error,
    },
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error("{operation}: {source}")]
    Neo4jOperation {
        operation: String,
        #[source]
        source: neo4rs::Error,
    },
    #[error(transparent)]
    Neo4j(#[from] neo4rs::Error),
    #[error("{operation}: {source}")]
    Neo4jDecodeOperation {
        operation: String,
        #[source]
        source: neo4rs::DeError,
    },
    #[error(transparent)]
    Neo4jDecode(#[from] neo4rs::DeError),
    #[error("{operation}: {source}")]
    ModelOperation {
        operation: String,
        #[source]
        source: crate::model::ModelError,
    },
    #[error(transparent)]
    Model(#[from] crate::model::ModelError),
    #[error("{operation}: {source}")]
    CodexOperation {
        operation: String,
        #[source]
        source: crate::codex::CodexError,
    },
    #[error(transparent)]
    Codex(#[from] crate::codex::CodexError),
    #[error("{operation}: {source}")]
    Utf8Operation {
        operation: String,
        #[source]
        source: std::string::FromUtf8Error,
    },
    #[error(transparent)]
    Utf8(#[from] std::string::FromUtf8Error),
    #[error("{operation}: {source}")]
    IntegerConversionOperation {
        operation: String,
        #[source]
        source: std::num::TryFromIntError,
    },
    #[error(transparent)]
    IntegerConversion(#[from] std::num::TryFromIntError),
    #[error("{operation}: {source}")]
    IntegerParseOperation {
        operation: String,
        #[source]
        source: std::num::ParseIntError,
    },
    #[error(transparent)]
    IntegerParse(#[from] std::num::ParseIntError),
    #[error("{operation}: {source}")]
    EnvironmentVariableOperation {
        operation: String,
        #[source]
        source: std::env::VarError,
    },
    #[error(transparent)]
    EnvironmentVariable(#[from] std::env::VarError),
    #[error("{operation}: {source}")]
    WatchReceiveOperation {
        operation: String,
        #[source]
        source: tokio::sync::watch::error::RecvError,
    },
    #[error(transparent)]
    WatchReceive(#[from] tokio::sync::watch::error::RecvError),
    #[error("{operation}: {source}")]
    TaskJoinOperation {
        operation: String,
        #[source]
        source: tokio::task::JoinError,
    },
    #[error(transparent)]
    TaskJoin(#[from] tokio::task::JoinError),
    #[error("{operation}: {source}")]
    TimeFormatOperation {
        operation: String,
        #[source]
        source: time::error::Format,
    },
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

    fn at_operation(self, operation: String) -> Self {
        match self {
            Self::Message { message } => Self::Message {
                message: format!("{operation}: {message}"),
            },
            Self::Io(source) => Self::IoOperation { operation, source },
            Self::IoOperation {
                operation: previous,
                source,
            } => Self::IoOperation {
                operation: format!("{operation}: {previous}"),
                source,
            },
            Self::Json(source) => Self::JsonOperation { operation, source },
            Self::JsonOperation {
                operation: previous,
                source,
            } => Self::JsonOperation {
                operation: format!("{operation}: {previous}"),
                source,
            },
            Self::Neo4j(source) => Self::Neo4jOperation { operation, source },
            Self::Neo4jOperation {
                operation: previous,
                source,
            } => Self::Neo4jOperation {
                operation: format!("{operation}: {previous}"),
                source,
            },
            Self::Neo4jDecode(source) => Self::Neo4jDecodeOperation { operation, source },
            Self::Neo4jDecodeOperation {
                operation: previous,
                source,
            } => Self::Neo4jDecodeOperation {
                operation: format!("{operation}: {previous}"),
                source,
            },
            Self::Model(source) => Self::ModelOperation { operation, source },
            Self::ModelOperation {
                operation: previous,
                source,
            } => Self::ModelOperation {
                operation: format!("{operation}: {previous}"),
                source,
            },
            Self::Codex(source) => Self::CodexOperation { operation, source },
            Self::CodexOperation {
                operation: previous,
                source,
            } => Self::CodexOperation {
                operation: format!("{operation}: {previous}"),
                source,
            },
            Self::Utf8(source) => Self::Utf8Operation { operation, source },
            Self::Utf8Operation {
                operation: previous,
                source,
            } => Self::Utf8Operation {
                operation: format!("{operation}: {previous}"),
                source,
            },
            Self::IntegerConversion(source) => {
                Self::IntegerConversionOperation { operation, source }
            }
            Self::IntegerConversionOperation {
                operation: previous,
                source,
            } => Self::IntegerConversionOperation {
                operation: format!("{operation}: {previous}"),
                source,
            },
            Self::IntegerParse(source) => Self::IntegerParseOperation { operation, source },
            Self::IntegerParseOperation {
                operation: previous,
                source,
            } => Self::IntegerParseOperation {
                operation: format!("{operation}: {previous}"),
                source,
            },
            Self::EnvironmentVariable(source) => {
                Self::EnvironmentVariableOperation { operation, source }
            }
            Self::EnvironmentVariableOperation {
                operation: previous,
                source,
            } => Self::EnvironmentVariableOperation {
                operation: format!("{operation}: {previous}"),
                source,
            },
            Self::WatchReceive(source) => Self::WatchReceiveOperation { operation, source },
            Self::WatchReceiveOperation {
                operation: previous,
                source,
            } => Self::WatchReceiveOperation {
                operation: format!("{operation}: {previous}"),
                source,
            },
            Self::TaskJoin(source) => Self::TaskJoinOperation { operation, source },
            Self::TaskJoinOperation {
                operation: previous,
                source,
            } => Self::TaskJoinOperation {
                operation: format!("{operation}: {previous}"),
                source,
            },
            Self::TimeFormat(source) => Self::TimeFormatOperation { operation, source },
            Self::TimeFormatOperation {
                operation: previous,
                source,
            } => Self::TimeFormatOperation {
                operation: format!("{operation}: {previous}"),
                source,
            },
            domain_error => domain_error,
        }
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
    HiveError: From<E>,
{
    fn hive_context(self, context: impl Into<String>) -> HiveResult<T> {
        self.map_err(|source| HiveError::from(source).at_operation(context.into()))
    }

    fn with_hive_context<F>(self, context: F) -> HiveResult<T>
    where
        F: FnOnce() -> String,
    {
        self.map_err(|source| HiveError::from(source).at_operation(context()))
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

#[cfg(test)]
mod tests {
    use super::{HiveContext, HiveError};

    #[tokio::test]
    async fn context_preserves_typed_sources_and_accumulates_operations() -> crate::HiveResult<()> {
        let Err(json_error) = serde_json::from_str::<serde_json::Value>("{") else {
            return Err(HiveError::message("invalid JSON fixture parsed"));
        };
        let Err(model_error) = crate::model::TaskId::new("") else {
            return Err(HiveError::message("empty identifier fixture was accepted"));
        };
        let Err(utf8_error) = String::from_utf8(vec![0xff]) else {
            return Err(HiveError::message("invalid UTF-8 fixture decoded"));
        };
        let Err(integer_conversion_error) = u8::try_from(300) else {
            return Err(HiveError::message("oversized integer fixture converted"));
        };
        let Err(integer_parse_error) = "invalid".parse::<u64>() else {
            return Err(HiveError::message("invalid integer fixture parsed"));
        };
        let Err(environment_error) = std::env::var("NOOK_TEST_VARIABLE_THAT_MUST_NOT_EXIST") else {
            return Err(HiveError::message("absent fixture variable was present"));
        };
        let cases = [
            HiveError::from(std::io::Error::other("disk unavailable")),
            HiveError::from(json_error),
            HiveError::from(model_error),
            HiveError::from(crate::codex::CodexError::Run("turn failed".into())),
            HiveError::from(utf8_error),
            HiveError::from(integer_conversion_error),
            HiveError::from(integer_parse_error),
            HiveError::from(environment_error),
        ];
        for error in cases {
            let contextual = error
                .at_operation("inner operation".into())
                .at_operation("outer operation".into());
            let rendered = contextual.to_string();
            assert!(rendered.starts_with("outer operation: inner operation:"));
        }

        let (sender, mut receiver) = tokio::sync::watch::channel(false);
        drop(sender);
        let Err(watch) = receiver.changed().await else {
            return Err(HiveError::message("closed watch unexpectedly changed"));
        };
        assert!(
            HiveError::from(watch)
                .at_operation("watch".into())
                .to_string()
                .starts_with("watch:")
        );
        let Err(joined) = tokio::spawn(async {
            assert!(
                !std::hint::black_box(true),
                "expected test panic for JoinError conversion"
            );
        })
        .await
        else {
            return Err(HiveError::message("panicking task joined successfully"));
        };
        assert!(
            HiveError::from(joined)
                .at_operation("join".into())
                .to_string()
                .starts_with("join:")
        );

        let missing: Option<()> = None;
        let Err(missing) = missing.hive_context("required state") else {
            return Err(HiveError::message("missing option produced a value"));
        };
        assert_eq!(missing.to_string(), "required state");
        Ok(())
    }
}

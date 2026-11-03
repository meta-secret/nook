//! What kind of failure stopped a provider operation, safe to log.
//!
//! A native provider error message can carry file names or response bodies,
//! so hosts never log it. This keeps only its category: the HTTP status class
//! a provider answered with, a network failure, a busy vault engine, or the
//! layer that failed.
//!
//! A failure the web must tell apart carries a stable [`ProviderFailureCode`],
//! classified here from the message every WASM export rejects with.

use http::StatusCode;
use nook_app_common::i18n_keys;
use serde::{Deserialize, Serialize};
use tsify::Tsify;
use wasm_bindgen::prelude::wasm_bindgen;

/// The stable code of a provider failure the web tells apart from others.
#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProviderFailureCode {
    /// GitHub rejected this device's token.
    GitHubTokenRejected,
    /// The S3 server refused this device's key.
    S3KeyAccessDenied,
    /// Any other failure; its message says what happened.
    Unclassified,
}

impl ProviderFailureCode {
    /// Classify a caught failure by its message. Each refusal's message is
    /// its translation key, which every export rejects with unchanged.
    #[must_use]
    pub fn classify(message: &str) -> Self {
        if message.contains(i18n_keys::AUTH_STORAGE_GITHUB_TOKEN_REJECTED) {
            Self::GitHubTokenRejected
        } else if message.contains(i18n_keys::ERRORS_S3_KEY_ACCESS_DENIED) {
            Self::S3KeyAccessDenied
        } else {
            Self::Unclassified
        }
    }

    /// The message a failure shows: a refusal names what to fix, and any
    /// other failure says what its operation could not do.
    #[must_use]
    pub const fn translation_key(self, operation_failed: &str) -> &str {
        match self {
            Self::GitHubTokenRejected => i18n_keys::AUTH_STORAGE_GITHUB_TOKEN_REJECTED,
            Self::S3KeyAccessDenied => i18n_keys::ERRORS_S3_KEY_ACCESS_DENIED,
            Self::Unclassified => operation_failed,
        }
    }
}

/// One caught failure and the translation key of its operation's own
/// failure message.
#[derive(Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProviderFailureMessageRequest {
    pub message: String,
    pub operation_failed_key: String,
}

impl ProviderFailureMessageRequest {
    /// The key of the message this failure shows.
    #[must_use]
    pub fn translation_key(&self) -> &str {
        ProviderFailureCode::classify(&self.message).translation_key(&self.operation_failed_key)
    }
}

/// The category of one failed provider operation.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProviderFailureCause {
    /// The provider rejected the credentials (HTTP 401).
    Unauthorized,
    /// The provider refused the operation (HTTP 403).
    Forbidden,
    /// The provider has no such file or folder (HTTP 404).
    NotFound,
    /// The provider throttled requests (HTTP 429).
    RateLimited,
    /// The provider failed on its side (HTTP 5xx).
    ProviderError,
    /// The request never got an answer.
    Network,
    /// Another call held the vault engine.
    EngineBusy,
    /// A vault payload could not be decrypted.
    Decryption,
    /// The browser's local database failed.
    LocalDatabase,
    /// Nothing above matched.
    Other,
}

impl ProviderFailureCause {
    /// Classify a provider failure message without retaining it. A rejected
    /// GitHub token is unauthorized and a refused S3 key forbidden, whatever
    /// their status lines say.
    #[must_use]
    pub fn classify(message: &str) -> Self {
        match ProviderFailureCode::classify(message) {
            ProviderFailureCode::GitHubTokenRejected => Self::Unauthorized,
            ProviderFailureCode::S3KeyAccessDenied => Self::Forbidden,
            ProviderFailureCode::Unclassified => Self::classify_described(message),
        }
    }

    fn classify_described(message: &str) -> Self {
        let normalized = message.to_ascii_lowercase();
        match ReportedStatus::read(&normalized) {
            ReportedStatus::Reported(status) => Self::from(status),
            ReportedStatus::Unreported => Self::classify_layer(&normalized),
        }
    }

    /// A failure that reports no HTTP answer keeps the layer that failed.
    fn classify_layer(normalized: &str) -> Self {
        if normalized.contains("recursive use of an object") {
            Self::EngineBusy
        } else if normalized.contains("network request failed")
            || normalized.contains("error sending request")
            || normalized.contains("failed to fetch")
        {
            Self::Network
        } else if normalized.starts_with("decryption failed") {
            Self::Decryption
        } else if normalized.starts_with("indexeddb error") {
            Self::LocalDatabase
        } else {
            Self::Other
        }
    }

    /// The label hosts write into logs.
    #[must_use]
    pub const fn label(self) -> &'static str {
        match self {
            Self::Unauthorized => "unauthorized",
            Self::Forbidden => "forbidden",
            Self::NotFound => "not-found",
            Self::RateLimited => "rate-limited",
            Self::ProviderError => "provider-error",
            Self::Network => "network",
            Self::EngineBusy => "engine-busy",
            Self::Decryption => "decryption",
            Self::LocalDatabase => "local-database",
            Self::Other => "other",
        }
    }
}

/// The one status table: what each HTTP answer a provider gave means.
impl From<StatusCode> for ProviderFailureCause {
    fn from(status: StatusCode) -> Self {
        match status.as_u16() {
            401 => Self::Unauthorized,
            403 => Self::Forbidden,
            404 => Self::NotFound,
            429 => Self::RateLimited,
            500..=599 => Self::ProviderError,
            _ => Self::Other,
        }
    }
}

/// Whether a failure message reports the HTTP status a provider answered.
enum ReportedStatus {
    Reported(StatusCode),
    Unreported,
}

impl ReportedStatus {
    /// The three-digit status after the first "status" in the message.
    fn read(normalized: &str) -> Self {
        let Some((_, after)) = normalized.split_once("status") else {
            return Self::Unreported;
        };
        let digits = after
            .trim_start_matches(|character: char| !character.is_ascii_digit())
            .chars()
            .take_while(char::is_ascii_digit)
            .collect::<String>();
        match (digits.len(), StatusCode::from_bytes(digits.as_bytes())) {
            (3, Ok(status)) => Self::Reported(status),
            _ => Self::Unreported,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_answers_are_classified_by_their_status() {
        for (message, cause) in [
            (
                "Drive error: Google Drive API responded with status 403 Forbidden{\"error\":{}}",
                ProviderFailureCause::Forbidden,
            ),
            (
                "Drive error: Google Drive namespace lookup failed with status 401 Unauthorized",
                ProviderFailureCause::Unauthorized,
            ),
            (
                "GitHub error: request failed with status 429",
                ProviderFailureCause::RateLimited,
            ),
            (
                "Drive error: Drive list events failed: status 503",
                ProviderFailureCause::ProviderError,
            ),
            (
                "Drive error: Drive lookup event failed: status 404",
                ProviderFailureCause::NotFound,
            ),
        ] {
            assert_eq!(ProviderFailureCause::classify(message), cause, "{message}");
        }
    }

    #[test]
    fn refusals_have_stable_codes_and_log_by_their_status() {
        for (refused, code, cause) in [
            (
                i18n_keys::ERRORS_S3_KEY_ACCESS_DENIED,
                ProviderFailureCode::S3KeyAccessDenied,
                ProviderFailureCause::Forbidden,
            ),
            (
                i18n_keys::AUTH_STORAGE_GITHUB_TOKEN_REJECTED,
                ProviderFailureCode::GitHubTokenRejected,
                ProviderFailureCause::Unauthorized,
            ),
        ] {
            assert_eq!(ProviderFailureCode::classify(refused), code);
            assert_eq!(ProviderFailureCause::classify(refused), cause);
            // A message a host wrapped still names the refusal.
            assert_eq!(
                ProviderFailureCode::classify(&format!("Database error: {refused}")),
                code
            );
        }
        for other in ["S3 request failed with status 503", "GitHub error: 500", ""] {
            assert_eq!(
                ProviderFailureCode::classify(other),
                ProviderFailureCode::Unclassified,
                "{other}"
            );
        }
    }

    #[test]
    fn a_refusal_shows_what_to_fix_and_any_other_failure_its_operation() -> anyhow::Result<()> {
        let operation_failed = i18n_keys::PROVIDER_SETUP_S3_LIST_FAILED;
        for (message, shown) in [
            (
                i18n_keys::ERRORS_S3_KEY_ACCESS_DENIED,
                i18n_keys::ERRORS_S3_KEY_ACCESS_DENIED,
            ),
            (
                i18n_keys::AUTH_STORAGE_GITHUB_TOKEN_REJECTED,
                i18n_keys::AUTH_STORAGE_GITHUB_TOKEN_REJECTED,
            ),
            ("S3 request failed with status 503", operation_failed),
            ("", operation_failed),
        ] {
            let request: ProviderFailureMessageRequest =
                serde_json::from_value(serde_json::json!({
                    "message": format!("Database error: {message}"),
                    "operationFailedKey": operation_failed,
                }))?;
            assert_eq!(request.translation_key(), shown, "{message}");
        }
        assert!(
            serde_json::from_value::<ProviderFailureMessageRequest>(serde_json::json!({
                "message": "",
                "operationFailedKey": operation_failed,
                "fallbackKey": operation_failed,
            }))
            .is_err()
        );
        Ok(())
    }

    #[test]
    fn one_status_table_classifies_answers_and_reported_statuses() -> anyhow::Result<()> {
        for (status, cause) in [
            (401, ProviderFailureCause::Unauthorized),
            (403, ProviderFailureCause::Forbidden),
            (404, ProviderFailureCause::NotFound),
            (429, ProviderFailureCause::RateLimited),
            (500, ProviderFailureCause::ProviderError),
            (599, ProviderFailureCause::ProviderError),
            (301, ProviderFailureCause::Other),
            (412, ProviderFailureCause::Other),
        ] {
            assert_eq!(
                ProviderFailureCause::from(StatusCode::from_u16(status)?),
                cause
            );
            assert_eq!(
                ProviderFailureCause::classify(&format!("GitHub error: status {status}")),
                cause
            );
        }
        // A message without a three-digit status keeps the layer that failed.
        for (message, cause) in [
            (
                "failed to fetch, status unknown",
                ProviderFailureCause::Network,
            ),
            ("status 4040 failed to fetch", ProviderFailureCause::Network),
            ("no status here", ProviderFailureCause::Other),
        ] {
            assert_eq!(ProviderFailureCause::classify(message), cause, "{message}");
        }
        Ok(())
    }

    #[test]
    fn other_failures_keep_only_their_layer() {
        for (message, cause) in [
            (
                "Network request failed: error sending request for url",
                ProviderFailureCause::Network,
            ),
            (
                "recursive use of an object detected which would lead to unsafe aliasing in rust",
                ProviderFailureCause::EngineBusy,
            ),
            (
                "Decryption failed: no matching keys",
                ProviderFailureCause::Decryption,
            ),
            (
                "IndexedDB error: quota exceeded",
                ProviderFailureCause::LocalDatabase,
            ),
            ("something unexpected", ProviderFailureCause::Other),
            // A status that is not three digits is no HTTP answer.
            ("status 40", ProviderFailureCause::Other),
        ] {
            assert_eq!(ProviderFailureCause::classify(message), cause, "{message}");
        }
        assert_eq!(ProviderFailureCause::RateLimited.label(), "rate-limited");
    }
}

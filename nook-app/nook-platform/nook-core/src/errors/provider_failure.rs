//! What kind of failure stopped a provider operation, safe to log.
//!
//! A native provider error message can carry file names or response bodies,
//! so hosts never log it. This keeps only its category: the HTTP status class
//! a provider answered with, a network failure, a busy vault engine, or the
//! layer that failed.

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
    /// Classify a provider failure message without retaining it.
    #[must_use]
    pub fn classify(message: &str) -> Self {
        let normalized = message.to_ascii_lowercase();
        if let Some(status) = Self::http_status(&normalized) {
            return match status {
                401 => Self::Unauthorized,
                403 => Self::Forbidden,
                404 => Self::NotFound,
                429 => Self::RateLimited,
                500..=599 => Self::ProviderError,
                _ => Self::Other,
            };
        }
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

    /// The three-digit status after the first "status" in the message.
    fn http_status(normalized: &str) -> Option<u16> {
        let (_, after) = normalized.split_once("status")?;
        let digits = after
            .trim_start_matches(|character: char| !character.is_ascii_digit())
            .chars()
            .take_while(char::is_ascii_digit)
            .collect::<String>();
        (digits.len() == 3).then(|| digits.parse().ok()).flatten()
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

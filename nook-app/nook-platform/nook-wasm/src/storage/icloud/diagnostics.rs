//! `CloudKit` request credentials, logging and error bodies. Credentials
//! never reach a log: error bodies are redacted before they are previewed.

#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use super::{
    ICLOUD_API_TOKEN, ICLOUD_CONTAINER_ID, ICLOUD_ENVIRONMENT, ICLOUD_LOG_BODY_PREVIEW_CHARS,
    ICloudEventStore,
};
use crate::NookError;

impl ICloudEventStore<'_> {
    pub(super) fn icloud_auth_query(web_auth_token: &str) -> [(&'static str, String); 2] {
        [
            ("ckAPIToken", ICLOUD_API_TOKEN.to_owned()),
            ("ckWebAuthToken", web_auth_token.trim().to_owned()),
        ]
    }

    pub(super) fn web_auth_token_len(web_auth_token: &str) -> usize {
        web_auth_token.trim().len()
    }

    pub(super) fn log_icloud_request_start(operation: &str, path: &str, web_auth_token: &str) {
        tracing::info!(
            scope = "wasm-icloud",
            operation,
            path,
            container = ICLOUD_CONTAINER_ID,
            environment = ICLOUD_ENVIRONMENT,
            api_token_len = ICLOUD_API_TOKEN.len(),
            web_auth_token_len = Self::web_auth_token_len(web_auth_token),
            "CloudKit request started"
        );
    }

    pub(super) fn log_icloud_response(operation: &str, path: &str, status: reqwest::StatusCode) {
        tracing::info!(
            scope = "wasm-icloud",
            operation,
            path,
            status = %status,
            "CloudKit response received"
        );
    }

    pub(super) fn log_icloud_error_body(
        operation: &str,
        path: &str,
        status: reqwest::StatusCode,
        body: &str,
        web_auth_token: &str,
    ) {
        let body_preview = CloudKitErrorBody {
            body,
            web_auth_token,
        }
        .sanitize();
        tracing::warn!(
            scope = "wasm-icloud",
            operation,
            path,
            status = %status,
            body_len = body.len(),
            body_preview = %body_preview,
            "CloudKit request failed"
        );
    }

    pub(super) fn icloud_error(status: reqwest::StatusCode, body: &str) -> NookError {
        NookError::ICloud(format!(
            "CloudKit API responded with status {status}{}",
            if body.is_empty() {
                String::new()
            } else {
                format!(" — {body}")
            }
        ))
    }
}

struct CloudKitErrorBody<'a> {
    body: &'a str,
    web_auth_token: &'a str,
}

impl CloudKitErrorBody<'_> {
    fn truncate_chars(value: &str, max_chars: usize) -> String {
        let mut chars = value.chars();
        let truncated = chars.by_ref().take(max_chars).collect::<String>();
        if chars.next().is_some() {
            format!("{truncated}...")
        } else {
            truncated
        }
    }

    fn redact_query_param_values(input: &str, name: &str) -> String {
        let needle = format!("{name}=");
        let mut output = String::with_capacity(input.len());
        let mut rest = input;
        while let Some(index) = rest.find(&needle) {
            let (prefix, after_prefix) = rest.split_at(index + needle.len());
            output.push_str(prefix);
            output.push_str("[redacted]");
            let value_end = after_prefix
                .find(['&', '"', '\'', ' ', '\n', '\r', '\t'])
                .unwrap_or(after_prefix.len());
            let Some(remaining) = after_prefix.get(value_end..) else {
                break;
            };
            rest = remaining;
        }
        output.push_str(rest);
        output
    }

    fn sanitize(self) -> String {
        let mut sanitized = self
            .body
            .replace(ICLOUD_API_TOKEN, "[redacted-ck-api-token]");
        let trimmed_token = self.web_auth_token.trim();
        if !trimmed_token.is_empty() {
            sanitized = sanitized.replace(trimmed_token, "[redacted-ck-web-auth-token]");
        }
        sanitized = Self::redact_query_param_values(&sanitized, "ckAPIToken");
        sanitized = Self::redact_query_param_values(&sanitized, "ckWebAuthToken");
        Self::truncate_chars(&sanitized, ICLOUD_LOG_BODY_PREVIEW_CHARS)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test callback"
        )
    )]
    fn error_body_redaction_preserves_unicode_and_removes_credentials() {
        let body = format!("é ckAPIToken={ICLOUD_API_TOKEN}&ckWebAuthToken=secret-token next");
        let sanitized = CloudKitErrorBody {
            body: &body,
            web_auth_token: " secret-token ",
        }
        .sanitize();
        assert_eq!(
            sanitized,
            "é ckAPIToken=[redacted]&ckWebAuthToken=[redacted] next"
        );
        assert_eq!(CloudKitErrorBody::truncate_chars("é水😀x", 3), "é水😀...");
        assert_eq!(CloudKitErrorBody::truncate_chars("é水😀", 3), "é水😀");
    }

    #[wasm_bindgen_test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test callback"
        )
    )]
    fn icloud_error_and_redaction_helpers_cover_empty_and_repeated_values() {
        let empty = ICloudEventStore::icloud_error(reqwest::StatusCode::NOT_FOUND, "");
        assert!(
            matches!(empty, NookError::ICloud(message) if message == "CloudKit API responded with status 404 Not Found")
        );
        let with_body = ICloudEventStore::icloud_error(reqwest::StatusCode::BAD_REQUEST, "bad");
        assert!(matches!(with_body, NookError::ICloud(message) if message.ends_with(" — bad")));
        assert_eq!(
            CloudKitErrorBody::redact_query_param_values(
                "ckWebAuthToken=one&x=1 ckWebAuthToken=two",
                "ckWebAuthToken",
            ),
            "ckWebAuthToken=[redacted]&x=1 ckWebAuthToken=[redacted]"
        );
        assert_eq!(
            CloudKitErrorBody {
                body: "plain body",
                web_auth_token: "   ",
            }
            .sanitize(),
            "plain body"
        );
    }
}

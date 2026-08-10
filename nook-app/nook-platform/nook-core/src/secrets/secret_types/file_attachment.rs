use crate::errors::{SecretPayloadError, SecretPayloadResult};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use std::fmt;
use zeroize::Zeroize;

/// Maximum decoded file size stored in a file-attachment secret (1 MiB).
pub const FILE_ATTACHMENT_MAX_BYTES: usize = 1_048_576;
const FILE_ATTACHMENT_MAX_TITLE_CHARS: usize = 256;
const FILE_ATTACHMENT_MAX_FILE_NAME_CHARS: usize = 255;
const FILE_ATTACHMENT_MAX_MIME_TYPE_CHARS: usize = 127;

/// Encrypted file blob stored as a vault secret.
///
/// Binary content is standard base64 so the browser can round-trip
/// `File` / `Blob` bytes without a custom codec. List projections expose only
/// metadata — never `content_base64`.
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileAttachmentSecret {
    pub title: String,
    pub file_name: String,
    pub mime_type: String,
    pub size_bytes: u64,
    pub content_base64: String,
}

impl fmt::Debug for FileAttachmentSecret {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("FileAttachmentSecret")
            .field("title", &self.title)
            .field("file_name", &self.file_name)
            .field("mime_type", &self.mime_type)
            .field("size_bytes", &self.size_bytes)
            .field("content_base64", &"[REDACTED]")
            .finish()
    }
}

impl FileAttachmentSecret {
    pub fn validate(&self) -> SecretPayloadResult<()> {
        let title = self.title.trim();
        let file_name = self.file_name.trim();
        let mime_type = self.mime_type.trim();
        if title.is_empty() {
            return invalid_file_attachment("title is required");
        }
        if title.chars().count() > FILE_ATTACHMENT_MAX_TITLE_CHARS {
            return invalid_file_attachment("title is too long");
        }
        if title.chars().any(char::is_control) {
            return invalid_file_attachment("title contains control characters");
        }
        if file_name.is_empty() {
            return invalid_file_attachment("file name is required");
        }
        if file_name.chars().count() > FILE_ATTACHMENT_MAX_FILE_NAME_CHARS {
            return invalid_file_attachment("file name is too long");
        }
        if file_name.contains('/') || file_name.contains('\\') || file_name.contains('\0') {
            return invalid_file_attachment("file name must not contain path separators");
        }
        if file_name.chars().any(char::is_control) {
            return invalid_file_attachment("file name contains control characters");
        }
        if mime_type.is_empty() {
            return invalid_file_attachment("mime type is required");
        }
        if mime_type.chars().count() > FILE_ATTACHMENT_MAX_MIME_TYPE_CHARS {
            return invalid_file_attachment("mime type is too long");
        }
        if mime_type.chars().any(char::is_control) {
            return invalid_file_attachment("mime type contains control characters");
        }
        if !mime_type
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'/' | b'-' | b'+' | b'.'))
        {
            return invalid_file_attachment("mime type has an invalid format");
        }
        let decoded = STANDARD.decode(&self.content_base64).map_err(|_| {
            SecretPayloadError::InvalidFileAttachment {
                reason: "content is not valid standard base64".to_owned(),
            }
        })?;
        if decoded.is_empty() {
            return invalid_file_attachment("file content is empty");
        }
        if decoded.len() > FILE_ATTACHMENT_MAX_BYTES {
            return invalid_file_attachment(format!(
                "file exceeds the {FILE_ATTACHMENT_MAX_BYTES}-byte limit"
            ));
        }
        if u64::try_from(decoded.len()).unwrap_or(u64::MAX) != self.size_bytes {
            return invalid_file_attachment("sizeBytes does not match decoded content length");
        }
        if STANDARD.encode(&decoded) != self.content_base64 {
            return invalid_file_attachment("content is not canonical standard base64");
        }
        Ok(())
    }

    pub fn zeroize_plaintext(&mut self) {
        self.title.zeroize();
        self.file_name.zeroize();
        self.mime_type.zeroize();
        self.size_bytes.zeroize();
        self.content_base64.zeroize();
    }
}

impl Zeroize for FileAttachmentSecret {
    fn zeroize(&mut self) {
        self.zeroize_plaintext();
    }
}

fn invalid_file_attachment<T>(reason: impl Into<String>) -> SecretPayloadResult<T> {
    Err(SecretPayloadError::InvalidFileAttachment {
        reason: reason.into(),
    })
}

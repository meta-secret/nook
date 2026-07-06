//! Backend-specific storage adapters used by the session manager.
//!
//! Each submodule fronts one of the providers the web layer can pick via
//! `nook_core::StorageMode`. New backends (S3, IPFS, …) become new
//! submodules with the same async function shape.

use crate::NookError;
use nook_core::{EventId, VaultEvent, parse_remote_event_storage_bytes};

pub(crate) mod auth_providers;
pub(crate) mod drive;
pub(crate) mod drive_events;
pub(crate) mod event_db;
pub(crate) mod github;
pub(crate) mod github_events;
pub(crate) mod icloud;
pub(crate) mod indexed_db;
pub(crate) mod local_folder;
pub(crate) mod session;

pub(crate) fn parse_expected_event_storage_bytes(
    bytes: &[u8],
    event_id: &EventId,
    provider: &str,
) -> Result<VaultEvent, NookError> {
    let event = parse_remote_event_storage_bytes(bytes)
        .map_err(|e| NookError::Serialization(format!("{provider} event parse: {e}")))?;
    let actual = event.id()?;
    if actual != *event_id {
        return Err(NookError::Serialization(format!(
            "{provider} event id mismatch: expected {}, got {}",
            event_id.as_str(),
            actual.as_str()
        )));
    }
    Ok(event)
}

#[must_use]
pub(crate) fn event_storage_matches_expected(bytes: &[u8], expected: &VaultEvent) -> bool {
    parse_remote_event_storage_bytes(bytes).is_ok_and(|event| &event == expected)
}

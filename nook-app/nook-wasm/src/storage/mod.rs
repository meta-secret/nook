//! Backend-specific storage adapters used by the session manager.
//!
//! Each submodule fronts one of the providers the web layer can pick via
//! `nook_core::StorageMode`. New backends (S3, IPFS, …) become new
//! submodules with the same async function shape.

use crate::NookError;
use nook_core::{EventId, VaultEvent, parse_remote_event_storage_bytes};
use std::{cell::RefCell, rc::Rc};

pub(crate) mod auth_providers;
pub(crate) mod drive;
pub(crate) mod drive_events;
pub(crate) mod drive_shared;
pub(crate) mod event_db;
pub(crate) mod extension_state;
pub(crate) mod github;
pub(crate) mod github_events;
pub(crate) mod icloud;
pub(crate) mod indexed_db;
pub(crate) mod local_folder;
pub(crate) mod session;

thread_local! {
    /// IndexedDB can dispatch a queued version-change callback after an async
    /// opener resolves. Keep cold-start handles alive so wasm-bindgen never
    /// receives that callback after its Rust closure has been dropped.
    static NOOK_DATABASE_CONNECTIONS: RefCell<Vec<Rc<rexie::Rexie>>> = const {
        RefCell::new(Vec::new())
    };
}

pub(crate) async fn open_nook_database() -> Result<Rc<rexie::Rexie>, NookError> {
    if let Some(connection) =
        NOOK_DATABASE_CONNECTIONS.with(|connections| connections.borrow().first().cloned())
        && connection
            .transaction(&["vault"], rexie::TransactionMode::ReadOnly)
            .is_ok()
    {
        return Ok(connection);
    }

    let connection = Rc::new(
        rexie::Rexie::builder("nook_db")
            .version(2)
            .add_object_store(rexie::ObjectStore::new("vault"))
            .add_object_store(rexie::ObjectStore::new("events"))
            .add_object_store(rexie::ObjectStore::new("projections"))
            .add_object_store(rexie::ObjectStore::new("provider_receipts"))
            .add_object_store(rexie::ObjectStore::new("outbox"))
            .build()
            .await
            .map_err(|error| NookError::IndexedDb(format!("IndexedDB build error: {error:?}")))?,
    );
    let connection = NOOK_DATABASE_CONNECTIONS.with(|connections| {
        let mut connections = connections.borrow_mut();
        connections.retain(|existing| {
            existing
                .transaction(&["vault"], rexie::TransactionMode::ReadOnly)
                .is_ok()
        });
        if let Some(existing) = connections.first().cloned() {
            connections.push(connection);
            existing
        } else {
            connections.push(connection.clone());
            connection
        }
    });
    Ok(connection)
}

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

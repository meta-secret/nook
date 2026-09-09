//! Backend-specific storage adapters used by the session manager.
//!
//! Each submodule fronts one of the providers the web layer can pick via
//! `nook_core::StorageMode`. New backends (S3, IPFS, …) become new
//! submodules with the same async function shape.

use rexie::{ObjectStore, Rexie, TransactionMode};

use crate::NookError;
use std::{cell::RefCell, ops::Deref, rc::Rc};

pub(crate) mod auth_providers;
mod checked_event_write;
pub(crate) mod device_access;
pub(crate) mod drive;
pub(crate) mod drive_events;
pub(crate) mod drive_shared;
pub(crate) mod event_db;
pub(crate) mod extension_state;
pub(crate) mod github;
pub(crate) mod github_events;
pub(crate) mod icloud;
pub(crate) mod identity_record;
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

/// Open database capability. The retained connection owns transaction access.
#[derive(Clone)]
pub(crate) struct NookDatabase {
    connection: Rc<Rexie>,
}

impl Deref for NookDatabase {
    type Target = Rexie;
    fn deref(&self) -> &Self::Target {
        &self.connection
    }
}

impl NookDatabase {
    pub(crate) async fn open_nook_database() -> Result<NookDatabase, NookError> {
        if let Some(connection) =
            NOOK_DATABASE_CONNECTIONS.with(|connections| connections.borrow().first().cloned())
            && connection
                .transaction(&["vault"], TransactionMode::ReadOnly)
                .is_ok()
        {
            return Ok(NookDatabase { connection });
        }

        let connection = Rc::new(
            Rexie::builder("nook_db")
                .version(2)
                .add_object_store(ObjectStore::new("vault"))
                .add_object_store(ObjectStore::new("events"))
                .add_object_store(ObjectStore::new("projections"))
                .add_object_store(ObjectStore::new("provider_receipts"))
                .add_object_store(ObjectStore::new("outbox"))
                .build()
                .await
                .map_err(|error| {
                    NookError::IndexedDb(format!("IndexedDB build error: {error:?}"))
                })?,
        );
        let connection = NOOK_DATABASE_CONNECTIONS.with(|connections| {
            let mut connections = connections.borrow_mut();
            connections.retain(|existing| {
                existing
                    .transaction(&["vault"], TransactionMode::ReadOnly)
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
        Ok(NookDatabase { connection })
    }
}

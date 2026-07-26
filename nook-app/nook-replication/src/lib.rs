#![allow(
    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::uninlined_format_args
)]

//! Portable, provider-neutral replication mechanics for Nook.
//!
//! This crate owns causal ordering and append-only replica bookkeeping. It does
//! not know about vault operations, authorization, projections, provider
//! credentials, browser storage, or network transports.

mod causal_graph;
mod replica_store;

pub use causal_graph::{CausalGraph, CausalGraphError, CausalInsertStatus};
pub use replica_store::{RemoteEventLogClassification, ReplicaStore};

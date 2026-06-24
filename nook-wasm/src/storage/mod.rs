//! Backend-specific storage adapters used by the session manager.
//!
//! Each submodule fronts one of the providers the web layer can pick via
//! `nook_core::StorageMode`. New backends (S3, IPFS, …) become new
//! submodules with the same async function shape.

pub(crate) mod github;
pub(crate) mod indexed_db;

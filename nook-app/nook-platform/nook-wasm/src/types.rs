//! Typed values exported across the wasm-bindgen boundary (no untyped JavaScript bags).

use crate::NookError;
use crate::NookSecretListItem;
use crate::NookSecretRecord;
use crate::NookVaultManager;
use gloo_utils::window;
use wasm_bindgen::prelude::wasm_bindgen;

mod access;
mod authentication;
mod conflicts;
mod core;
mod diagnostics;
mod oauth;
mod runtime;
mod runtime_policy;
mod secret_data;
mod sentinel;
mod sync;
mod sync_state;

pub use access::*;
pub use authentication::*;
pub use conflicts::*;
pub use core::*;
pub use diagnostics::*;
pub use oauth::*;
pub use runtime::*;
pub use runtime_policy::*;
pub use secret_data::*;
pub use sentinel::*;
pub use sync::*;
pub use sync_state::*;

pub(crate) use access::password_entries_to_vec;
pub(crate) use conflicts::{replacement_conflicts_to_vec, security_conflicts_to_vec};
pub(crate) use secret_data::{joins_to_vec, members_to_vec, records_to_vec};

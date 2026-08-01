//! Typed values exported across the wasm-bindgen boundary (no untyped JavaScript bags).

use crate::NookError;
use crate::NookSecretListItem;
use crate::NookSecretRecord;
use crate::NookVaultManager;
use gloo_utils::window;
use wasm_bindgen::prelude::wasm_bindgen;

mod authentication;
mod conflicts;
mod core;
mod oauth;
mod runtime;
mod sync;
mod sync_state;

pub use authentication::*;
pub use conflicts::*;
pub use core::*;
pub use oauth::*;
pub use runtime::*;
pub use sync::*;
pub use sync_state::*;

pub(crate) use conflicts::{replacement_conflicts_to_vec, security_conflicts_to_vec};
pub(crate) use runtime::password_entries_to_vec;
pub(crate) use sync::{joins_to_vec, members_to_vec, records_to_vec};

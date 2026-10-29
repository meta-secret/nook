//! Typed values exported across the wasm-bindgen boundary (no untyped JavaScript bags).

use crate::secret_api::NookSecretRecord;
use crate::{NookError, NookSecretListItem, NookVaultManager};
use gloo_utils::window;
use wasm_bindgen::prelude::wasm_bindgen;

mod access;
mod authentication;
mod conflicts;
mod core;
mod diagnostics;
mod passkey_details;
mod personal_fill;
mod runtime;
mod runtime_policy;
mod secret_data;
mod secret_history;
mod sentinel;
mod store_id;
mod sync;
mod sync_state;

pub use access::*;
pub use authentication::*;
pub use conflicts::*;
pub use core::*;
pub use diagnostics::*;
pub use passkey_details::{NookPasskeyDetails, NookPasskeyNameState};
pub use personal_fill::{NookPersonalFillRequest, NookPersonalFillResponse};
pub use runtime::*;
pub use runtime_policy::*;
pub use secret_data::*;
pub use secret_history::{NookSecretHistory, NookSecretOriginDeviceState, NookSecretRevisionState};
pub use sentinel::*;
pub use store_id::*;
pub use sync::*;
pub use sync_state::*;

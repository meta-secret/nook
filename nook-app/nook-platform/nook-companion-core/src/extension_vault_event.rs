//! Complete encrypted vault-event ingress for browser-extension sessions.

use serde::{Deserialize, Serialize};
use tsify::Tsify;
/// A complete encrypted vault event crossing the extension session boundary.
///
/// Rust deserializes the existing event-log domain type. The TypeScript declaration follows the canonical event schema directly.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize, Tsify)]
#[serde(transparent)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct ExtensionVaultEventPayload(nook_event_log::VaultEvent);

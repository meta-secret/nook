//! Complete encrypted vault-event ingress for browser-extension sessions.

use serde::Deserialize;
use tsify::Tsify;
/// A complete encrypted vault event crossing the extension session boundary.
///
/// Rust deserializes the existing event-log domain type. The TypeScript declaration follows the canonical event schema directly.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(transparent)]
pub struct ExtensionVaultEventPayload(nook_event_log::VaultEvent);

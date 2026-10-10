//! Complete encrypted vault-event ingress for browser-extension sessions.

use serde::{Deserialize, Serialize};
use tsify::Tsify;
/// A complete encrypted vault event crossing the extension session boundary.
///
/// Rust deserializes the existing event-log domain type. The TypeScript declaration follows the canonical event schema directly.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize, Tsify, derive_more::From)]
#[serde(transparent)]
pub struct ExtensionVaultEventPayload(nook_event_log::VaultEvent);

impl ExtensionVaultEventPayload {
    #[must_use]
    pub fn store_id(&self) -> &nook_auth2::StoreId {
        let Self(event) = self;
        &event.body.store_id
    }
}

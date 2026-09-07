//! Authorship of browser-observed authentication submission destinations.

use serde::{Deserialize, Serialize};
use tsify::Tsify;

/// Whether HTML explicitly authors the effective submission destination.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum PageControlSubmissionDestinationSource {
    Omitted,
    Authored,
}

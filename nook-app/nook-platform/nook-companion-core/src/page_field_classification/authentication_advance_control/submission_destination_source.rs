//! Authorship of browser-observed authentication submission destinations.

use serde::{Deserialize, Serialize};
use tsify::Tsify;

/// Whether HTML explicitly authors the effective submission destination.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
pub enum PageControlSubmissionDestinationSource {
    /// Neither the submitter nor its owned form authored a destination, so the
    /// browser resolved the document's current address as the effective action.
    Omitted,
    /// The submitter or its owned form explicitly authored the destination.
    Authored,
}

//! Capabilities that select local-key replacement paths.
use nook_core::AppId;

pub(crate) enum PreviousLocalSelection {
    Unselected,
    Selected(AppId),
}

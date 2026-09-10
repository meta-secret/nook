//! Outcome of reading content-addressed event bytes from a provider.
use nook_core::EventStorageBytes;

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum RemoteEventRead {
    Unavailable,
    Retrieved(EventStorageBytes),
}

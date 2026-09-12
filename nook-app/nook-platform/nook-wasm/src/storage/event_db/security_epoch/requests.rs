use nook_core::{EventId, VaultEvent};

/// One admitted event and its exact serialized storage bytes.
#[derive(Clone, Copy)]
pub(crate) struct EventAppend<'a> {
    pub(crate) event: &'a VaultEvent,
    pub(crate) bytes: &'a [u8],
}

/// Atomic trigger and checkpoint append for one security-epoch transition.
#[derive(Clone, Copy)]
pub(crate) struct EpochPairAppend<'a> {
    pub(crate) trigger: EventAppend<'a>,
    pub(crate) checkpoint: EventAppend<'a>,
}

/// Immutable remote event bytes admitted as one union operation.
#[derive(Clone, Copy)]
pub(crate) struct RemoteEventUnion<'a> {
    pub(crate) events: &'a [(EventId, Vec<u8>)],
}

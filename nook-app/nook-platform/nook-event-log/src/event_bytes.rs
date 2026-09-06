//! Typed byte representations owned by the signed event protocol.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CanonicalEventBodyBytes(Vec<u8>);

impl From<Vec<u8>> for CanonicalEventBodyBytes {
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "serialization boundary: captures canonical JSON bytes emitted by the event encoder"
        )
    )]
    fn from(value: Vec<u8>) -> Self {
        Self(value)
    }
}

impl AsRef<[u8]> for CanonicalEventBodyBytes {
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "serialization boundary: projects canonical event-body bytes for hashing and signing"
        )
    )]
    fn as_ref(&self) -> &[u8] {
        &self.0
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EventStorageBytes(Vec<u8>);

impl From<Vec<u8>> for EventStorageBytes {
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "database boundary: captures immutable serialized event bytes"
        )
    )]
    fn from(value: Vec<u8>) -> Self {
        Self(value)
    }
}

impl From<EventStorageBytes> for Vec<u8> {
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "database boundary: releases immutable serialized event bytes to a storage adapter"
        )
    )]
    fn from(value: EventStorageBytes) -> Self {
        value.0
    }
}

impl AsRef<[u8]> for EventStorageBytes {
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "database boundary: borrows immutable serialized event bytes for decoding"
        )
    )]
    fn as_ref(&self) -> &[u8] {
        &self.0
    }
}

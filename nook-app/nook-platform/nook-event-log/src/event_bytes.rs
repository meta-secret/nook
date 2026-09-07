//! Typed byte representations owned by the signed event protocol.

use crate::{EventError, EventResult};
use serde_json::{Map, Value};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CanonicalEventBodyBytes(Vec<u8>);

impl CanonicalEventBodyBytes {
    pub fn from_json(value: &Value) -> EventResult<Self> {
        let canonical = Self::canonical_value(value);
        serde_json::to_vec(&canonical)
            .map(Into::into)
            .map_err(EventError::from)
    }

    pub(crate) fn canonical_value(value: &Value) -> Value {
        Self::canonicalize_json(value)
    }

    fn canonicalize_json(value: &Value) -> Value {
        match value {
            Value::Object(map) => {
                let mut sorted = Map::new();
                let mut entries = map.iter().collect::<Vec<_>>();
                entries.sort_by_key(|(key, _)| *key);
                for (key, item) in entries {
                    sorted.insert(key.clone(), Self::canonicalize_json(item));
                }
                Value::Object(sorted)
            }
            Value::Array(items) => {
                Value::Array(items.iter().map(Self::canonicalize_json).collect())
            }
            Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => value.clone(),
        }
    }
}

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

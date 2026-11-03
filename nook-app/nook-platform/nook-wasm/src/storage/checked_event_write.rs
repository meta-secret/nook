//! Parsed local event bytes bound to their requested content address.
//! This does not establish signature validity or vault authorization.

#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use crate::NookError;
#[cfg(test)]
use nook_core::GenesisImportRequest;
use nook_core::{EventId, EventLogLocation, IdentityEvent, VaultEvent};

/// Event bytes parsed with the schema of the namespace they are stored in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum ParsedLogEvent {
    Vault(VaultEvent),
    Identity(IdentityEvent),
}

impl ParsedLogEvent {
    pub(super) fn parse(bytes: &[u8], location: &EventLogLocation) -> Result<Self, NookError> {
        let storage = bytes.to_vec().into();
        match location {
            EventLogLocation::Identity(_) => {
                IdentityEvent::parse_storage_bytes(&storage).map(Self::Identity)
            }
            EventLogLocation::Vault(_) => {
                VaultEvent::parse_remote_event_storage_bytes(&storage).map(Self::Vault)
            }
        }
        .map_err(NookError::from)
    }

    pub(super) fn id(&self) -> Result<EventId, NookError> {
        match self {
            Self::Vault(event) => event.id(),
            Self::Identity(event) => event.id(),
        }
        .map_err(NookError::from)
    }
}

pub(crate) struct CheckedEventWrite<'a> {
    event_id: &'a EventId,
    bytes: &'a [u8],
    location: &'a EventLogLocation,
    event: ParsedLogEvent,
}

/// Named values required to check one content-addressed write.
#[derive(Clone, Copy)]
pub(crate) struct CheckedEventWriteRequest<'a> {
    pub(crate) bytes: &'a [u8],
    pub(crate) event_id: &'a EventId,
    pub(crate) location: &'a EventLogLocation,
    pub(crate) provider: &'a str,
}

impl<'a> CheckedEventWrite<'a> {
    pub(crate) fn parse(request: CheckedEventWriteRequest<'a>) -> Result<Self, NookError> {
        let CheckedEventWriteRequest {
            bytes,
            event_id,
            location,
            provider,
        } = request;
        let event = ParsedLogEvent::parse(bytes, location)
            .map_err(|e| NookError::Serialization(format!("{provider} event parse: {e}")))?;
        let actual = event.id()?;
        if actual != *event_id {
            return Err(NookError::Serialization(format!(
                "{provider} event id mismatch: expected {}, got {}",
                event_id.as_str(),
                actual.as_str()
            )));
        }
        Ok(Self {
            event_id,
            bytes,
            location,
            event,
        })
    }

    #[must_use]
    pub(crate) fn event_id(&self) -> &EventId {
        self.event_id
    }

    #[must_use]
    pub(crate) fn bytes(&self) -> &[u8] {
        self.bytes
    }

    /// The log the event was checked for.
    #[must_use]
    pub(crate) fn location(&self) -> &EventLogLocation {
        self.location
    }

    #[must_use]
    pub(crate) fn matches(&self, bytes: &[u8]) -> bool {
        self.bytes == bytes
            || ParsedLogEvent::parse(bytes, self.location).is_ok_and(|event| event == self.event)
    }
}

#[cfg(test)]
pub(super) mod tests {
    use super::*;
    use nook_core::{
        Ed25519Signature, GenesisImportPayload, IsoTimestamp, SigningIdentity, StoreId,
    };
    use wasm_bindgen_test::wasm_bindgen_test;

    /// One signed vault event, shared by the provider adapter tests.
    pub(crate) struct EventFixture {
        pub(crate) event_id: EventId,
        pub(crate) event: VaultEvent,
        pub(crate) bytes: Vec<u8>,
    }

    impl EventFixture {
        pub(crate) fn new() -> anyhow::Result<Self> {
            let (identity, _) = SigningIdentity::generate()?;
            let event = VaultEvent::build_genesis_import_event(GenesisImportRequest {
                store_id: &StoreId::parse("store_testtoken11")?,
                actor_id: &identity.actor_id()?,
                key_epoch: &EventId::parse("sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo")?,
                payload: GenesisImportPayload {
                    source_content_hash: nook_auth2::Sha256Hex::from_trusted("deadbeef".repeat(8)),
                    secrets: vec![],
                    password_entries: vec![],
                },
                created_at: &IsoTimestamp::from_trusted("2026-06-28T00:00:00Z".to_owned()),
                signing_key: identity.signing_key(),
            })?;
            Ok(Self {
                event_id: event.id()?,
                bytes: VaultEvent::serialize_event_storage_yaml(&event)?.into(),
                event,
            })
        }

        /// The fixture as a checked write into one log.
        #[cfg(feature = "browser-wasm-tests")]
        pub(crate) fn checked<'a>(
            &'a self,
            location: &'a EventLogLocation,
        ) -> anyhow::Result<CheckedEventWrite<'a>> {
            Ok(CheckedEventWrite::parse(CheckedEventWriteRequest {
                bytes: &self.bytes,
                event_id: &self.event_id,
                location,
                provider: "Test",
            })?)
        }
    }

    #[wasm_bindgen_test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test callback"
        )
    )]
    fn checked_write_preserves_bytes_and_compares_the_complete_event() -> anyhow::Result<()> {
        let mut fixture = EventFixture::new()?;
        let location =
            nook_core::EventLogLocation::Vault(nook_core::StoreId::parse("store_abcdefghijk")?);
        let checked = CheckedEventWrite::parse(CheckedEventWriteRequest {
            bytes: &fixture.bytes,
            event_id: &fixture.event_id,
            location: &location,
            provider: "Fixture",
        })?;
        assert_eq!(checked.event_id(), &fixture.event_id);
        assert_eq!(checked.bytes(), fixture.bytes);
        let mut equivalent = fixture.bytes.clone();
        equivalent.extend_from_slice(b"\n");
        assert!(checked.matches(&equivalent));
        assert!(!checked.matches(b"invalid event"));
        fixture.event.signature =
            Ed25519Signature::from_trusted(format!("ed25519:{}", "11".repeat(64)));
        assert!(
            !checked.matches(VaultEvent::serialize_event_storage_yaml(&fixture.event)?.as_ref())
        );
        Ok(())
    }

    /// Every store write takes a checked event, so a malformed one is refused
    /// with its provider's label before any store, and any request, is
    /// reached.
    #[wasm_bindgen_test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test callback"
        )
    )]
    fn a_malformed_event_is_refused_with_its_provider_label() -> anyhow::Result<()> {
        let event_id = EventId::parse(&format!("sha256u:{}", "A".repeat(43)))?;
        let location = EventLogLocation::Vault(StoreId::parse("store_abcdefghijk")?);
        for provider in ["GitHub", "Drive", "CloudKit", "S3"] {
            for bytes in [&[0xff][..], b"invalid event"] {
                match CheckedEventWrite::parse(CheckedEventWriteRequest {
                    bytes,
                    event_id: &event_id,
                    location: &location,
                    provider,
                }) {
                    Err(NookError::Serialization(message)) => {
                        assert!(message.starts_with(&format!("{provider} event parse:")));
                    }
                    Err(_) => anyhow::bail!("unexpected admission error"),
                    Ok(_) => anyhow::bail!("a malformed event was admitted"),
                }
            }
        }
        Ok(())
    }

    #[wasm_bindgen_test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test callback"
        )
    )]
    fn checked_write_rejects_malformed_bytes_and_wrong_requested_id() -> anyhow::Result<()> {
        let fixture = EventFixture::new()?;
        let wrong_id = EventId::parse(&format!("sha256u:{}", "A".repeat(43)))?;
        for (bytes, requested, expected) in [
            (
                b"invalid event".as_slice(),
                &fixture.event_id,
                "Fixture event parse:".to_owned(),
            ),
            (
                fixture.bytes.as_slice(),
                &wrong_id,
                format!(
                    "Fixture event id mismatch: expected {}, got {}",
                    wrong_id, fixture.event_id
                ),
            ),
        ] {
            match CheckedEventWrite::parse(CheckedEventWriteRequest {
                bytes,
                event_id: requested,
                location: &nook_core::EventLogLocation::Vault(nook_core::StoreId::parse(
                    "store_abcdefghijk",
                )?),
                provider: "Fixture",
            }) {
                Err(NookError::Serialization(message)) => assert!(message.starts_with(&expected)),
                Err(_) => anyhow::bail!("unexpected checked-write error"),
                Ok(_) => anyhow::bail!("invalid event admitted"),
            }
        }
        Ok(())
    }
}

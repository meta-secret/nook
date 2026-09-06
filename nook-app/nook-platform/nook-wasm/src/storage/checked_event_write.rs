//! Parsed local event bytes bound to their requested content address.
//! This does not establish signature validity or vault authorization.

#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use crate::NookError;
use nook_core::{EventId, VaultEvent, parse_remote_event_storage_bytes};

pub(super) struct CheckedEventWrite<'a> {
    event_id: &'a EventId,
    bytes: &'a [u8],
    event: VaultEvent,
}

impl<'a> CheckedEventWrite<'a> {
    pub(super) fn parse(
        bytes: &'a [u8],
        event_id: &'a EventId,
        provider: &str,
    ) -> Result<Self, NookError> {
        let event = parse_remote_event_storage_bytes(bytes)
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
            event,
        })
    }

    #[must_use]
    pub(super) fn event_id(&self) -> &EventId {
        self.event_id
    }

    #[must_use]
    pub(super) fn bytes(&self) -> &[u8] {
        self.bytes
    }

    #[must_use]
    pub(super) fn matches(&self, bytes: &[u8]) -> bool {
        self.bytes == bytes || Self::matches_event(bytes, &self.event)
    }

    fn matches_event(bytes: &[u8], expected: &VaultEvent) -> bool {
        parse_remote_event_storage_bytes(bytes).is_ok_and(|event| &event == expected)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::{
        drive_events::DriveEventStore, github_events::GitHubEventStore, icloud::ICloudEventStore,
    };
    use nook_core::{
        DriveEventParent, Ed25519Signature, GenesisImportPayload, ICloudEventTarget, IsoTimestamp,
        Sha256Hex, SigningIdentity, StoreId, ValidationError, build_genesis_import_event,
        serialize_event_storage_yaml,
    };
    use wasm_bindgen_test::wasm_bindgen_test;

    struct EventFixture {
        event_id: EventId,
        event: VaultEvent,
        bytes: Vec<u8>,
    }

    impl EventFixture {
        fn new() -> anyhow::Result<Self> {
            let (identity, _) = SigningIdentity::generate()?;
            let event = build_genesis_import_event(
                &StoreId::parse("store_testtoken11")?,
                &identity.actor_id()?,
                &EventId::parse("sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo")?,
                GenesisImportPayload {
                    source_content_hash: Sha256Hex::from_trusted("deadbeef".repeat(8)),
                    secrets: vec![],
                    password_entries: vec![],
                },
                &IsoTimestamp::from_trusted("2026-06-28T00:00:00Z".to_owned()),
                identity.signing_key(),
            )?;
            Ok(Self {
                event_id: event.id()?,
                bytes: serialize_event_storage_yaml(&event)?,
                event,
            })
        }
    }

    #[test]
    fn checked_write_preserves_bytes_and_compares_the_complete_event() -> anyhow::Result<()> {
        let mut fixture = EventFixture::new()?;
        let checked = CheckedEventWrite::parse(&fixture.bytes, &fixture.event_id, "Fixture")?;
        assert_eq!(checked.event_id(), &fixture.event_id);
        assert_eq!(checked.bytes(), fixture.bytes);
        let mut equivalent = fixture.bytes.clone();
        equivalent.extend_from_slice(b"\n");
        assert!(checked.matches(&equivalent));
        assert!(!checked.matches(b"invalid event"));
        fixture.event.signature =
            Ed25519Signature::from_trusted(format!("ed25519:{}", "11".repeat(64)));
        assert!(!checked.matches(&serialize_event_storage_yaml(&fixture.event)?));
        Ok(())
    }

    #[test]
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
            match CheckedEventWrite::parse(bytes, requested, "Fixture") {
                Err(NookError::Serialization(message)) => assert!(message.starts_with(&expected)),
                Err(_) => anyhow::bail!("unexpected checked-write error"),
                Ok(_) => anyhow::bail!("invalid event admitted"),
            }
        }
        Ok(())
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
    )]
    async fn provider_admission_preserves_validation_order_before_network() -> anyhow::Result<()> {
        let event_id = EventId::parse(&format!("sha256u:{}", "A".repeat(43)))?;
        let github = GitHubEventStore { pat: "", repo: "" };
        let drive = DriveEventStore {
            token: "",
            parent: &DriveEventParent::AppDataFolder,
        };
        let cloud = ICloudEventStore {
            web_auth_token: "fixture-token",
            target: &ICloudEventTarget::Private,
        };
        for (result, prefix) in [
            (
                github.put_github_event_if_absent(&event_id, &[0xff]).await,
                "GitHub event parse:",
            ),
            (
                drive
                    .put_drive_event_if_absent(&event_id, &[0xff])
                    .await
                    .map(|_| ()),
                "Drive event parse:",
            ),
            (
                cloud.put_icloud_event_if_absent(&event_id, &[0xff]).await,
                "Event YAML must be UTF-8:",
            ),
            (
                cloud
                    .put_icloud_event_if_absent(&event_id, b"invalid event")
                    .await,
                "CloudKit event parse:",
            ),
        ] {
            match result {
                Err(NookError::Serialization(message)) => {
                    assert!(message.starts_with(prefix));
                }
                Err(_) => anyhow::bail!("unexpected provider admission error"),
                Ok(()) => anyhow::bail!("invalid event reached publication"),
            }
        }
        let no_token = ICloudEventStore {
            web_auth_token: " ",
            target: &ICloudEventTarget::Private,
        };
        match no_token
            .put_icloud_event_if_absent(&event_id, &[0xff])
            .await
        {
            Err(NookError::Database(message)) => {
                assert_eq!(message, ValidationError::OauthAccessTokenEmpty.to_string());
            }
            Err(_) => anyhow::bail!("token validation did not precede byte validation"),
            Ok(()) => anyhow::bail!("missing token admitted"),
        }
        Ok(())
    }
}

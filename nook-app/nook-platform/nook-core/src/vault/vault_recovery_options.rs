//! Safe recovery choices that can be shown before a vault is unlocked.
//!
//! The signed event log contains public membership identifiers. This
//! projection exposes only the identifiers and labels a person needs to choose
//! a recovery path. It never exposes a credential id, private key, or
//! decrypted vault value.

#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use crate::EventError;
use crate::EventLookup;

use crate::{DeviceId, EventGraph, StoreId, VaultOperation, VaultResult};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use tsify::Tsify;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct VaultRecoveryDevice {
    #[tsify(type = "string")]
    pub device_id: DeviceId,
    pub label: String,
    pub passkey_hint: String,
}

impl VaultRecoveryDevice {
    /// Format the device suffix written into Nook passkey display names.
    #[must_use]
    pub fn passkey_hint_for(device_id: &DeviceId) -> String {
        const PREFIX_LEN: usize = 6;
        const SUFFIX_LEN: usize = 4;

        let chars = device_id.as_str().chars().collect::<Vec<_>>();
        if chars.len() <= PREFIX_LEN + SUFFIX_LEN + 3 {
            return device_id.as_str().to_owned();
        }
        let prefix = chars.iter().take(PREFIX_LEN).collect::<String>();
        let suffix = chars
            .iter()
            .skip(chars.len() - SUFFIX_LEN)
            .collect::<String>();
        format!("{prefix}...{suffix}")
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VaultRecoveryOptions {
    pub devices: Vec<VaultRecoveryDevice>,
    pub requires_sentinel_quorum: bool,
}

/// Validated inputs for projecting recovery choices from a signed event graph.
pub struct VaultRecoveryProjectionRequest<'a> {
    pub graph: &'a EventGraph,
}

/// Safe, Rust-owned recovery DTO returned across the WASM boundary.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct VaultRecoverySummary {
    #[tsify(type = "StoreId")]
    pub store_id: StoreId,
    pub vault_name: String,
    pub devices: Vec<VaultRecoveryDevice>,
    pub requires_sentinel_quorum: bool,
}

impl VaultRecoverySummary {
    #[must_use]
    pub fn from_options(
        store_id: StoreId,
        vault_name: String,
        options: VaultRecoveryOptions,
    ) -> Self {
        Self {
            store_id,
            vault_name,
            devices: options.devices,
            requires_sentinel_quorum: options.requires_sentinel_quorum,
        }
    }
}

impl VaultRecoveryOptions {
    /// Project the recovery choices present in a signed vault event graph.
    pub fn from_request(request: &VaultRecoveryProjectionRequest<'_>) -> VaultResult<Self> {
        let graph = request.graph;
        let mut devices = BTreeMap::<DeviceId, String>::new();
        let mut requires_sentinel_quorum = false;

        for event_id in graph.topological_order()? {
            let event = match graph.get(&event_id) {
                EventLookup::Recorded(event) => event,
                EventLookup::UnknownEvent => {
                    return Err(EventError::MissingEvent {
                        event_id: event_id.as_str().to_owned(),
                    }
                    .into());
                }
            };
            for operation in &event.body.operations {
                match operation {
                    VaultOperation::JoinApproved {
                        device_id, label, ..
                    } => {
                        devices.insert(device_id.clone(), label.as_str().to_owned());
                    }
                    VaultOperation::SentinelParticipantEnrolled {
                        device_id, label, ..
                    } => {
                        requires_sentinel_quorum = true;
                        devices.insert(device_id.clone(), label.as_str().to_owned());
                    }
                    VaultOperation::MemberRenamed { device_id, label } => {
                        if let Some(current) = devices.get_mut(device_id) {
                            current.clone_from(&label.as_str().to_owned());
                        }
                    }
                    VaultOperation::DeviceRevoked { device_id } => {
                        devices.remove(device_id);
                    }
                    VaultOperation::SentinelSharesIssued { .. } => {
                        requires_sentinel_quorum = true;
                    }
                    _ => {}
                }
            }
        }

        Ok(Self {
            devices: devices
                .into_iter()
                .map(|(device_id, label)| VaultRecoveryDevice {
                    passkey_hint: VaultRecoveryDevice::passkey_hint_for(&device_id),
                    device_id,
                    label,
                })
                .collect(),
            requires_sentinel_quorum,
        })
    }
}

#[cfg(test)]
mod tests {
    struct FixtureGraphEvent {
        graph: EventGraph,
        event_id: EventId,
    }

    use crate::AgeArmoredCiphertext;

    use super::*;
    use crate::{
        DeviceIdentity, DeviceSigningPublicKey, EventId, GenesisImportPayload,
        GenesisImportRequest, IsoTimestamp, MemberLabel, SigningIdentity, StoreId, VaultEvent,
        VaultEventBody, VaultEventSchemaVersion,
    };

    const STORE_ID: &str = "store_recovery01x";

    struct Fixtures;

    impl Fixtures {
        fn timestamp(value: &str) -> anyhow::Result<IsoTimestamp> {
            Ok(IsoTimestamp::parse(value)?)
        }

        fn append_event(
            mut graph: EventGraph,
            signing: &SigningIdentity,
            parent: EventId,
            operations: Vec<VaultOperation>,
            created_at: &str,
        ) -> anyhow::Result<FixtureGraphEvent> {
            let body = VaultEventBody {
                schema_version: VaultEventSchemaVersion::CURRENT,
                store_id: StoreId::parse(STORE_ID)?,
                actor_id: signing.actor_id()?,
                actor_signing_public_key: signing.public_key(),
                parents: vec![parent],
                created_at: Fixtures::timestamp(created_at)?,
                key_epoch: EventId::from_sha256_hex(
                    nook_auth2::Sha256Hex::from_trusted("1".repeat(64)).as_str(),
                )?,
                operations,
            };
            let event = VaultEvent::sign(body, signing.signing_key())?;
            let id = event.id()?;
            match graph.insert(crate::EventGraphInsert {
                event,
                expected_store_id: STORE_ID,
            }) {
                Ok(inserted) => {
                    graph = inserted.graph;
                    Ok(inserted.status)
                }
                Err(rejected) => {
                    graph = rejected.graph;
                    Err(rejected.cause)
                }
            }?;
            Ok(FixtureGraphEvent {
                graph,
                event_id: id,
            })
        }
    }

    #[test]
    #[expect(
        clippy::too_many_lines,
        reason = "test scenario covers the complete recovery projection lifecycle"
    )]
    fn reports_only_active_devices_with_current_labels() -> anyhow::Result<()> {
        let signing = SigningIdentity::generate()?.0;
        let first = DeviceIdentity::generate()?;
        let second = DeviceIdentity::generate()?;
        let genesis = VaultEvent::build_genesis_import_event(GenesisImportRequest {
            store_id: &StoreId::parse(STORE_ID)?,
            actor_id: &signing.actor_id()?,
            key_epoch: &EventId::from_sha256_hex(
                nook_auth2::Sha256Hex::from_trusted("1".repeat(64)).as_str(),
            )?,
            payload: GenesisImportPayload {
                source_content_hash: nook_auth2::Sha256Hex::from_trusted("0".repeat(64)),
                secrets: vec![],
            },
            created_at: &Fixtures::timestamp("2026-07-22T00:00:00Z")?,
            signing_key: signing.signing_key(),
        })?;
        let genesis_id = genesis.id()?;
        let mut graph = EventGraph::new();
        match graph.insert(crate::EventGraphInsert {
            event: genesis,
            expected_store_id: STORE_ID,
        }) {
            Ok(inserted) => {
                graph = inserted.graph;
                Ok(inserted.status)
            }
            Err(rejected) => {
                graph = rejected.graph;
                Err(rejected.cause)
            }
        }?;

        let first_id = {
            let prepared = Fixtures::append_event(
                graph,
                &signing,
                genesis_id,
                vec![VaultOperation::JoinApproved {
                    device_id: first.device_id().clone(),
                    encryption_public_key: first.public_key(),
                    signing_public_key: DeviceSigningPublicKey::default(),
                    label: MemberLabel::from_trusted("Old laptop".to_owned()),
                    secrets_key_ciphertext: AgeArmoredCiphertext::from_trusted_armored(
                        "ciphertext-one".to_owned(),
                    ),
                    members_key_ciphertext: AgeArmoredCiphertext::from_trusted_armored(
                        "ciphertext-two".to_owned(),
                    ),
                }],
                "2026-07-22T00:00:01Z",
            )?;
            graph = prepared.graph;
            prepared.event_id
        };
        let second_id = {
            let prepared = Fixtures::append_event(
                graph,
                &signing,
                first_id,
                vec![VaultOperation::JoinApproved {
                    device_id: second.device_id().clone(),
                    encryption_public_key: second.public_key(),
                    signing_public_key: DeviceSigningPublicKey::default(),
                    label: MemberLabel::from_trusted("Phone".to_owned()),
                    secrets_key_ciphertext: AgeArmoredCiphertext::from_trusted_armored(
                        "ciphertext-three".to_owned(),
                    ),
                    members_key_ciphertext: AgeArmoredCiphertext::from_trusted_armored(
                        "ciphertext-four".to_owned(),
                    ),
                }],
                "2026-07-22T00:00:02Z",
            )?;
            graph = prepared.graph;
            prepared.event_id
        };
        {
            let prepared = Fixtures::append_event(
                graph,
                &signing,
                second_id,
                vec![
                    VaultOperation::MemberRenamed {
                        device_id: second.device_id().clone(),
                        label: MemberLabel::from_trusted("Current phone".to_owned()),
                    },
                    VaultOperation::DeviceRevoked {
                        device_id: first.device_id().clone(),
                    },
                ],
                "2026-07-22T00:00:03Z",
            )?;
            graph = prepared.graph;
            prepared.event_id
        };

        let options =
            VaultRecoveryOptions::from_request(&VaultRecoveryProjectionRequest { graph: &graph })?;
        assert_eq!(
            options.devices,
            vec![VaultRecoveryDevice {
                device_id: second.device_id().clone(),
                label: "Current phone".to_owned(),
                passkey_hint: VaultRecoveryDevice::passkey_hint_for(second.device_id()),
            }]
        );
        assert!(!options.requires_sentinel_quorum);
        Ok(())
    }

    #[test]
    fn sentinel_participants_require_quorum() -> anyhow::Result<()> {
        let signing = SigningIdentity::generate()?.0;
        let device = DeviceIdentity::generate()?;
        let genesis = VaultEvent::build_genesis_import_event(GenesisImportRequest {
            store_id: &StoreId::parse(STORE_ID)?,
            actor_id: &signing.actor_id()?,
            key_epoch: &EventId::from_sha256_hex(
                nook_auth2::Sha256Hex::from_trusted("1".repeat(64)).as_str(),
            )?,
            payload: GenesisImportPayload {
                source_content_hash: nook_auth2::Sha256Hex::from_trusted("0".repeat(64)),
                secrets: vec![],
            },
            created_at: &Fixtures::timestamp("2026-07-22T00:00:00Z")?,
            signing_key: signing.signing_key(),
        })?;
        let genesis_id = genesis.id()?;
        let mut graph = EventGraph::new();
        match graph.insert(crate::EventGraphInsert {
            event: genesis,
            expected_store_id: STORE_ID,
        }) {
            Ok(inserted) => {
                graph = inserted.graph;
                Ok(inserted.status)
            }
            Err(rejected) => {
                graph = rejected.graph;
                Err(rejected.cause)
            }
        }?;
        {
            let prepared = Fixtures::append_event(
                graph,
                &signing,
                genesis_id,
                vec![VaultOperation::SentinelParticipantEnrolled {
                    device_id: device.device_id().clone(),
                    encryption_public_key: device.public_key(),
                    signing_public_key: signing.public_key(),
                    label: MemberLabel::from_trusted("Sentinel owner".to_owned()),
                }],
                "2026-07-22T00:00:01Z",
            )?;
            graph = prepared.graph;
            prepared.event_id
        };

        let options =
            VaultRecoveryOptions::from_request(&VaultRecoveryProjectionRequest { graph: &graph })?;
        assert!(options.requires_sentinel_quorum);
        assert_eq!(options.devices.len(), 1);
        Ok(())
    }
}

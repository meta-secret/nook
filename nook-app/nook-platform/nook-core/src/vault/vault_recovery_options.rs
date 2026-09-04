//! Safe recovery choices that can be shown before a vault is unlocked.
//!
//! The signed event log contains public membership identifiers and encrypted
//! backup-password envelopes. This projection exposes only the identifiers and
//! labels a person needs to choose a recovery path. It never exposes an
//! envelope, credential id, private key, or decrypted vault value.

use crate::EventError;

use crate::{DeviceId, EventGraph, StoreId, VaultOperation, VaultResult, project_vault};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use tsify::Tsify;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct VaultRecoveryDevice {
    #[tsify(type = "string")]
    pub device_id: DeviceId,
    pub label: String,
    pub passkey_hint: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct VaultRecoveryPassword {
    pub id: String,
    pub label: String,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VaultRecoveryOptions {
    pub devices: Vec<VaultRecoveryDevice>,
    pub password_entries: Vec<VaultRecoveryPassword>,
    pub requires_sentinel_quorum: bool,
}

/// Safe, Rust-owned recovery DTO returned across the WASM boundary.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct VaultRecoverySummary {
    #[tsify(type = "StoreId")]
    pub store_id: StoreId,
    pub vault_name: String,
    pub devices: Vec<VaultRecoveryDevice>,
    pub password_entries: Vec<VaultRecoveryPassword>,
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
            password_entries: options.password_entries,
            requires_sentinel_quorum: options.requires_sentinel_quorum,
        }
    }
}

/// Project the recovery choices present in a signed vault event graph.
pub fn vault_recovery_options(
    graph: &EventGraph,
    store_id: &str,
) -> VaultResult<VaultRecoveryOptions> {
    let projection = project_vault(graph, store_id)?;
    let mut devices = BTreeMap::<DeviceId, String>::new();
    let mut requires_sentinel_quorum = false;

    for event_id in graph.topological_order()? {
        let event = graph
            .get(&event_id)
            .ok_or_else(|| EventError::MissingEvent {
                event_id: event_id.as_str().to_owned(),
            })?;
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

    Ok(VaultRecoveryOptions {
        devices: devices
            .into_iter()
            .map(|(device_id, label)| VaultRecoveryDevice {
                passkey_hint: recovery_device_id_hint(&device_id),
                device_id,
                label,
            })
            .collect(),
        password_entries: projection
            .password_entries
            .into_iter()
            .map(|entry| VaultRecoveryPassword {
                id: entry.id,
                label: entry.label,
                created_at: entry.created_at,
            })
            .collect(),
        requires_sentinel_quorum,
    })
}

/// Format the device suffix written into Nook passkey display names.
#[must_use]
pub fn recovery_device_id_hint(device_id: &DeviceId) -> String {
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

#[cfg(test)]
mod tests {
    use crate::AgeArmoredCiphertext;

    use super::*;
    use crate::{
        DeviceIdentity, DeviceSigningPublicKey, EventId, GenesisImportPayload, IsoTimestamp,
        MemberLabel, PasswordEntryId, Sha256Hex, SigningIdentity, StoreId, VaultEvent,
        VaultEventBody, VaultEventSchemaVersion, build_genesis_import_event,
        create_password_entry_with_work_factor,
    };

    const STORE_ID: &str = "store_recovery01x";

    fn timestamp(value: &str) -> anyhow::Result<IsoTimestamp> {
        Ok(IsoTimestamp::parse(value)?)
    }

    fn append_event(
        graph: &mut EventGraph,
        signing: &SigningIdentity,
        parent: EventId,
        operations: Vec<VaultOperation>,
        created_at: &str,
    ) -> anyhow::Result<EventId> {
        let body = VaultEventBody {
            schema_version: VaultEventSchemaVersion::CURRENT,
            store_id: StoreId::parse(STORE_ID)?,
            actor_id: signing.actor_id()?,
            actor_signing_public_key: signing.public_key(),
            parents: vec![parent],
            created_at: timestamp(created_at)?,
            key_epoch: EventId::from_sha256_hex(Sha256Hex::from_trusted("1".repeat(64)).as_str())?,
            operations,
        };
        let event = VaultEvent::sign(body, signing.signing_key())?;
        let id = event.id()?;
        graph.insert(event, STORE_ID)?;
        Ok(id)
    }

    #[test]
    fn reports_only_active_devices_and_current_password_labels() -> anyhow::Result<()> {
        let signing = SigningIdentity::generate()?.0;
        let first = DeviceIdentity::generate()?;
        let second = DeviceIdentity::generate()?;
        let password = create_password_entry_with_work_factor(
            &crate::generate_vault_keys()?,
            "pwdentry001",
            "Emergency kit",
            "2026-07-22T00:00:00Z",
            "correct horse battery staple",
            10,
        )?;
        let genesis = build_genesis_import_event(
            &StoreId::parse(STORE_ID)?,
            &signing.actor_id()?,
            &EventId::from_sha256_hex(Sha256Hex::from_trusted("1".repeat(64)).as_str())?,
            GenesisImportPayload {
                source_content_hash: Sha256Hex::from_trusted("0".repeat(64)),
                secrets: vec![],
                password_entries: vec![password.clone()],
            },
            &timestamp("2026-07-22T00:00:00Z")?,
            signing.signing_key(),
        )?;
        let genesis_id = genesis.id()?;
        let mut graph = EventGraph::new();
        graph.insert(genesis, STORE_ID)?;

        let first_id = append_event(
            &mut graph,
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
        let second_id = append_event(
            &mut graph,
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
        append_event(
            &mut graph,
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

        let options = vault_recovery_options(&graph, STORE_ID)?;
        assert_eq!(
            options.devices,
            vec![VaultRecoveryDevice {
                device_id: second.device_id().clone(),
                label: "Current phone".to_owned(),
                passkey_hint: recovery_device_id_hint(second.device_id()),
            }]
        );
        assert_eq!(
            options.password_entries,
            vec![VaultRecoveryPassword {
                id: password.id,
                label: password.label,
                created_at: password.created_at,
            }]
        );
        assert!(!options.requires_sentinel_quorum);
        Ok(())
    }

    #[test]
    fn sentinel_participants_require_quorum_and_never_offer_passwords() -> anyhow::Result<()> {
        let signing = SigningIdentity::generate()?.0;
        let device = DeviceIdentity::generate()?;
        let genesis = build_genesis_import_event(
            &StoreId::parse(STORE_ID)?,
            &signing.actor_id()?,
            &EventId::from_sha256_hex(Sha256Hex::from_trusted("1".repeat(64)).as_str())?,
            GenesisImportPayload {
                source_content_hash: Sha256Hex::from_trusted("0".repeat(64)),
                secrets: vec![],
                password_entries: vec![],
            },
            &timestamp("2026-07-22T00:00:00Z")?,
            signing.signing_key(),
        )?;
        let genesis_id = genesis.id()?;
        let mut graph = EventGraph::new();
        graph.insert(genesis, STORE_ID)?;
        append_event(
            &mut graph,
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

        let options = vault_recovery_options(&graph, STORE_ID)?;
        assert!(options.requires_sentinel_quorum);
        assert_eq!(options.devices.len(), 1);
        assert!(options.password_entries.is_empty());
        Ok(())
    }

    #[test]
    fn removed_password_is_not_reported() -> anyhow::Result<()> {
        let signing = SigningIdentity::generate()?.0;
        let password = create_password_entry_with_work_factor(
            &crate::generate_vault_keys()?,
            "pwdentry001",
            "Old recovery",
            "2026-07-22T00:00:00Z",
            "correct horse battery staple",
            10,
        )?;
        let genesis = build_genesis_import_event(
            &StoreId::parse(STORE_ID)?,
            &signing.actor_id()?,
            &EventId::from_sha256_hex(Sha256Hex::from_trusted("1".repeat(64)).as_str())?,
            GenesisImportPayload {
                source_content_hash: Sha256Hex::from_trusted("0".repeat(64)),
                secrets: vec![],
                password_entries: vec![password.clone()],
            },
            &timestamp("2026-07-22T00:00:00Z")?,
            signing.signing_key(),
        )?;
        let genesis_id = genesis.id()?;
        let mut graph = EventGraph::new();
        graph.insert(genesis, STORE_ID)?;
        append_event(
            &mut graph,
            &signing,
            genesis_id,
            vec![VaultOperation::PasswordRemoved {
                entry_id: PasswordEntryId::parse(&password.id)?,
            }],
            "2026-07-22T00:00:01Z",
        )?;

        let options = vault_recovery_options(&graph, STORE_ID)?;
        assert!(options.password_entries.is_empty());
        Ok(())
    }
}

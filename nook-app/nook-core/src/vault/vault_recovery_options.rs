//! Safe recovery choices that can be shown before a vault is unlocked.
//!
//! The signed event log contains public membership identifiers and encrypted
//! backup-password envelopes. This projection exposes only the identifiers and
//! labels a person needs to choose a recovery path. It never exposes an
//! envelope, credential id, private key, or decrypted vault value.

use crate::{
    DeviceId, EventGraph, PasswordUnlockEntry, VaultOperation, VaultResult, project_vault,
};
use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VaultRecoveryDevice {
    pub device_id: DeviceId,
    pub label: String,
    pub passkey_hint: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VaultRecoveryOptions {
    pub devices: Vec<VaultRecoveryDevice>,
    pub password_entries: Vec<PasswordUnlockEntry>,
    pub requires_sentinel_quorum: bool,
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
            .ok_or_else(|| crate::EventError::MissingEvent {
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
        password_entries: projection.password_entries,
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
    use super::*;
    use crate::{
        DeviceIdentity, DeviceSigningPublicKey, EventId, GenesisImportPayload, IsoTimestamp,
        MemberLabel, PasswordEntryId, Sha256Hex, SigningIdentity, StoreId, VaultEvent,
        VaultEventBody, VaultEventSchemaVersion, build_genesis_import_event,
        create_password_entry_with_work_factor,
    };

    const STORE_ID: &str = "store_recovery01x";

    fn timestamp(value: &str) -> IsoTimestamp {
        IsoTimestamp::parse(value).expect("timestamp")
    }

    fn append_event(
        graph: &mut EventGraph,
        signing: &SigningIdentity,
        parent: EventId,
        operations: Vec<VaultOperation>,
        created_at: &str,
    ) -> EventId {
        let body = VaultEventBody {
            schema_version: VaultEventSchemaVersion::CURRENT,
            store_id: StoreId::parse(STORE_ID).expect("store"),
            actor_id: signing.actor_id().expect("actor"),
            actor_signing_public_key: Some(signing.public_key()),
            parents: vec![parent],
            created_at: timestamp(created_at),
            key_epoch: EventId::from_sha256_hex(Sha256Hex::from_trusted("1".repeat(64)).as_str())
                .expect("epoch"),
            operations,
        };
        let event = VaultEvent::sign(body, signing.signing_key()).expect("signed event");
        let id = event.id().expect("event id");
        graph.insert(event, STORE_ID).expect("insert");
        id
    }

    #[test]
    fn reports_only_active_devices_and_current_password_labels() {
        let signing = SigningIdentity::generate().expect("signing").0;
        let first = DeviceIdentity::generate().expect("first device");
        let second = DeviceIdentity::generate().expect("second device");
        let password = create_password_entry_with_work_factor(
            &crate::generate_vault_keys().expect("vault keys"),
            "pwdentry001",
            "Emergency kit",
            "2026-07-22T00:00:00Z",
            "correct horse battery staple",
            10,
        )
        .expect("password entry");
        let genesis = build_genesis_import_event(
            &StoreId::parse(STORE_ID).expect("store"),
            &signing.actor_id().expect("actor"),
            &EventId::from_sha256_hex(Sha256Hex::from_trusted("1".repeat(64)).as_str())
                .expect("epoch"),
            GenesisImportPayload {
                source_content_hash: Sha256Hex::from_trusted("0".repeat(64)),
                secrets: vec![],
                password_entries: vec![password.clone()],
            },
            &timestamp("2026-07-22T00:00:00Z"),
            signing.signing_key(),
        )
        .expect("genesis");
        let genesis_id = genesis.id().expect("genesis id");
        let mut graph = EventGraph::new();
        graph.insert(genesis, STORE_ID).expect("insert genesis");

        let first_id = append_event(
            &mut graph,
            &signing,
            genesis_id,
            vec![VaultOperation::JoinApproved {
                device_id: first.device_id().clone(),
                encryption_public_key: first.public_key(),
                signing_public_key: DeviceSigningPublicKey::default(),
                label: MemberLabel::from_trusted("Old laptop".to_owned()),
                secrets_key_ciphertext: crate::AgeArmoredCiphertext::from_trusted_armored(
                    "ciphertext-one".to_owned(),
                ),
                members_key_ciphertext: crate::AgeArmoredCiphertext::from_trusted_armored(
                    "ciphertext-two".to_owned(),
                ),
            }],
            "2026-07-22T00:00:01Z",
        );
        let second_id = append_event(
            &mut graph,
            &signing,
            first_id,
            vec![VaultOperation::JoinApproved {
                device_id: second.device_id().clone(),
                encryption_public_key: second.public_key(),
                signing_public_key: DeviceSigningPublicKey::default(),
                label: MemberLabel::from_trusted("Phone".to_owned()),
                secrets_key_ciphertext: crate::AgeArmoredCiphertext::from_trusted_armored(
                    "ciphertext-three".to_owned(),
                ),
                members_key_ciphertext: crate::AgeArmoredCiphertext::from_trusted_armored(
                    "ciphertext-four".to_owned(),
                ),
            }],
            "2026-07-22T00:00:02Z",
        );
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
        );

        let options = vault_recovery_options(&graph, STORE_ID).expect("options");
        assert_eq!(
            options.devices,
            vec![VaultRecoveryDevice {
                device_id: second.device_id().clone(),
                label: "Current phone".to_owned(),
                passkey_hint: recovery_device_id_hint(second.device_id()),
            }]
        );
        assert_eq!(options.password_entries, vec![password]);
        assert!(!options.requires_sentinel_quorum);
    }

    #[test]
    fn sentinel_participants_require_quorum_and_never_offer_passwords() {
        let signing = SigningIdentity::generate().expect("signing").0;
        let device = DeviceIdentity::generate().expect("device");
        let genesis = build_genesis_import_event(
            &StoreId::parse(STORE_ID).expect("store"),
            &signing.actor_id().expect("actor"),
            &EventId::from_sha256_hex(Sha256Hex::from_trusted("1".repeat(64)).as_str())
                .expect("epoch"),
            GenesisImportPayload {
                source_content_hash: Sha256Hex::from_trusted("0".repeat(64)),
                secrets: vec![],
                password_entries: vec![],
            },
            &timestamp("2026-07-22T00:00:00Z"),
            signing.signing_key(),
        )
        .expect("genesis");
        let genesis_id = genesis.id().expect("genesis id");
        let mut graph = EventGraph::new();
        graph.insert(genesis, STORE_ID).expect("insert genesis");
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
        );

        let options = vault_recovery_options(&graph, STORE_ID).expect("options");
        assert!(options.requires_sentinel_quorum);
        assert_eq!(options.devices.len(), 1);
        assert!(options.password_entries.is_empty());
    }

    #[test]
    fn removed_password_is_not_reported() {
        let signing = SigningIdentity::generate().expect("signing").0;
        let password = create_password_entry_with_work_factor(
            &crate::generate_vault_keys().expect("vault keys"),
            "pwdentry001",
            "Old recovery",
            "2026-07-22T00:00:00Z",
            "correct horse battery staple",
            10,
        )
        .expect("password entry");
        let genesis = build_genesis_import_event(
            &StoreId::parse(STORE_ID).expect("store"),
            &signing.actor_id().expect("actor"),
            &EventId::from_sha256_hex(Sha256Hex::from_trusted("1".repeat(64)).as_str())
                .expect("epoch"),
            GenesisImportPayload {
                source_content_hash: Sha256Hex::from_trusted("0".repeat(64)),
                secrets: vec![],
                password_entries: vec![password.clone()],
            },
            &timestamp("2026-07-22T00:00:00Z"),
            signing.signing_key(),
        )
        .expect("genesis");
        let genesis_id = genesis.id().expect("genesis id");
        let mut graph = EventGraph::new();
        graph.insert(genesis, STORE_ID).expect("insert genesis");
        append_event(
            &mut graph,
            &signing,
            genesis_id,
            vec![VaultOperation::PasswordRemoved {
                entry_id: PasswordEntryId::parse(&password.id).expect("password id"),
            }],
            "2026-07-22T00:00:01Z",
        );

        let options = vault_recovery_options(&graph, STORE_ID).expect("options");
        assert!(options.password_entries.is_empty());
    }
}

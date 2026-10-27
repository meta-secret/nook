//! When and where a vault item entered the vault, derived from the signed event log.
//!
//! Every edit, including each passkey sign-in, replaces the item under a new
//! secret id. The projection links each version to the one it replaced, so the
//! first version's event is the item's origin and the current version's event
//! is its last modification. No timestamps are stored on the item itself.

use crate::i18n_keys;
use crate::{
    DeviceId, DeviceSigningPublicKey, EventId, IsoTimestamp, MemberLabelState, ProjectedSecret,
    ProjectedSecretOrigin, SecretId, VaultEvent, VaultMember, VaultOperation,
};
use std::collections::BTreeMap;

/// Why a secret history cannot be derived. Each case is a real inconsistency
/// between the projection and the event log; callers surface it as an error.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum SecretHistoryError {
    #[error("the vault item is not part of the vault projection")]
    UnknownSecret,
    #[error("a vault event that wrote this item is missing from the event log")]
    MissingEvent,
    #[error("the vault item's replacement chain is broken")]
    BrokenReplacementChain,
    #[error("no recorded vault operation wrote the item's first version")]
    UnrecordedOrigin,
}

/// The signing key this browser session writes vault events with, when known.
#[derive(Debug, Clone, Copy)]
pub enum SecretHistoryLocalSigner<'a> {
    Known(&'a DeviceSigningPublicKey),
    Unavailable,
}

/// Inputs for deriving one item's history.
pub struct SecretHistoryRequest<'a> {
    /// Every projected version, including deleted and replaced ones.
    pub secrets: &'a BTreeMap<SecretId, ProjectedSecret>,
    /// The applied vault events in causal (topological) order, as the
    /// projection replays them; quarantined events are excluded.
    pub events: &'a [(&'a EventId, &'a VaultEvent)],
    /// The decrypted vault member roster.
    pub roster: &'a [VaultMember],
    pub local_signer: SecretHistoryLocalSigner<'a>,
    /// The item's current secret id.
    pub secret_id: &'a SecretId,
}

/// How the first recorded version of an item was written.
enum OriginOperation {
    Created,
    Imported,
    CarriedForward,
}

/// The device that signed an event, as far as the vault records can tell.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SecretHistoryDevice {
    /// Signed with this browser session's own signing key.
    ThisDevice,
    /// A current vault member, matched through the signing key it joined with.
    Member {
        device_id: DeviceId,
        label: MemberLabelState,
    },
    /// A device that joined with this signing key but is no longer in the roster.
    FormerMember { device_id: DeviceId },
    /// The signing key was never declared by a join, for example the device
    /// that created the vault, seen from another device.
    Unrecorded,
}

impl SecretHistoryDevice {
    #[must_use]
    pub const fn translation_key(&self) -> &'static str {
        match self {
            Self::ThisDevice => i18n_keys::VAULT_FIELDS_HISTORY_DEVICE_THIS,
            Self::Member {
                label: MemberLabelState::Named(_),
                ..
            } => i18n_keys::VAULT_FIELDS_HISTORY_DEVICE_NAMED,
            Self::Member {
                label: MemberLabelState::Unnamed,
                ..
            } => i18n_keys::VAULT_FIELDS_HISTORY_DEVICE_UNNAMED,
            Self::FormerMember { .. } => i18n_keys::VAULT_FIELDS_HISTORY_DEVICE_REMOVED,
            Self::Unrecorded => i18n_keys::VAULT_FIELDS_HISTORY_DEVICE_UNRECORDED,
        }
    }

    /// The `{device}` replacement for [`Self::translation_key`].
    #[must_use]
    pub fn display_value(&self) -> String {
        match self {
            Self::Member {
                label: MemberLabelState::Named(label),
                ..
            } => label.clone(),
            Self::Member {
                device_id,
                label: MemberLabelState::Unnamed,
            }
            | Self::FormerMember { device_id } => device_id.as_str().to_owned(),
            Self::ThisDevice | Self::Unrecorded => String::new(),
        }
    }
}

/// How the item's first recorded version entered the vault.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SecretHistoryOrigin {
    /// Created in this vault: the true creation time and device.
    Created {
        at: IsoTimestamp,
        device: SecretHistoryDevice,
    },
    /// Arrived with a vault import; earlier history is outside this vault.
    Imported { at: IsoTimestamp },
    /// Re-recorded by a key-rotation checkpoint, which drops earlier history.
    /// The time is when the checkpoint ran, not when the item was created.
    CarriedForwardSince { at: IsoTimestamp },
}

impl SecretHistoryOrigin {
    #[must_use]
    pub const fn translation_key(&self) -> &'static str {
        match self {
            Self::Created { .. } => i18n_keys::VAULT_FIELDS_HISTORY_CREATED,
            Self::Imported { .. } => i18n_keys::VAULT_FIELDS_HISTORY_IMPORTED,
            Self::CarriedForwardSince { .. } => i18n_keys::VAULT_FIELDS_HISTORY_IN_VAULT_SINCE,
        }
    }

    #[must_use]
    pub fn at(&self) -> &IsoTimestamp {
        match self {
            Self::Created { at, .. } | Self::Imported { at } | Self::CarriedForwardSince { at } => {
                at
            }
        }
    }

    /// The creating device; known only for items created in this vault.
    #[must_use]
    pub fn device(&self) -> Option<&SecretHistoryDevice> {
        match self {
            Self::Created { device, .. } => Some(device),
            Self::Imported { .. } | Self::CarriedForwardSince { .. } => None,
        }
    }
}

/// Whether the item changed after its first recorded version.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SecretRevision {
    Original,
    Revised {
        at: IsoTimestamp,
        device: SecretHistoryDevice,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SecretHistory {
    pub origin: SecretHistoryOrigin,
    pub revision: SecretRevision,
}

impl SecretHistoryRequest<'_> {
    /// Walk the item's replacement chain back to its first recorded version.
    ///
    /// # Errors
    ///
    /// Returns a [`SecretHistoryError`] when the projection and event log do
    /// not agree; no partial or default history is produced.
    pub fn derive(&self) -> Result<SecretHistory, SecretHistoryError> {
        let current = self
            .secrets
            .get(self.secret_id)
            .ok_or(SecretHistoryError::UnknownSecret)?;
        let mut root_id = self.secret_id;
        let mut root = current;
        let mut steps = 0_usize;
        while let ProjectedSecretOrigin::Replacement { from } = &root.origin {
            steps += 1;
            if steps > self.secrets.len() {
                return Err(SecretHistoryError::BrokenReplacementChain);
            }
            root = self
                .secrets
                .get(from)
                .ok_or(SecretHistoryError::BrokenReplacementChain)?;
            root_id = from;
        }

        let root_event = self.event(&root.created_by)?;
        let at = root_event.body.created_at.clone();
        let origin = match SecretHistoryRequest::origin_operation(root_event, root_id)? {
            OriginOperation::Created => SecretHistoryOrigin::Created {
                at,
                device: self.device(root_event),
            },
            OriginOperation::Imported => SecretHistoryOrigin::Imported { at },
            OriginOperation::CarriedForward => SecretHistoryOrigin::CarriedForwardSince { at },
        };
        let revision = if root_id == self.secret_id {
            SecretRevision::Original
        } else {
            let current_event = self.event(&current.created_by)?;
            SecretRevision::Revised {
                at: current_event.body.created_at.clone(),
                device: self.device(current_event),
            }
        };
        Ok(SecretHistory { origin, revision })
    }

    fn event(&self, id: &EventId) -> Result<&VaultEvent, SecretHistoryError> {
        self.events
            .iter()
            .find_map(|(event_id, event)| (*event_id == id).then_some(*event))
            .ok_or(SecretHistoryError::MissingEvent)
    }

    /// The last operation in the event that wrote this version, matching
    /// projection order where a later operation overrides an earlier one.
    fn origin_operation(
        event: &VaultEvent,
        secret_id: &SecretId,
    ) -> Result<OriginOperation, SecretHistoryError> {
        let holds = |secrets: &[crate::EncryptedSecretPayload]| {
            secrets.iter().any(|secret| &secret.id == secret_id)
        };
        event
            .body
            .operations
            .iter()
            .rev()
            .find_map(|operation| match operation {
                VaultOperation::SecretCreated { secret } => {
                    (&secret.id == secret_id).then_some(OriginOperation::Created)
                }
                VaultOperation::VaultImported { secrets, .. } => {
                    holds(secrets).then_some(OriginOperation::Imported)
                }
                VaultOperation::EpochCheckpoint { secrets, .. } => {
                    holds(secrets).then_some(OriginOperation::CarriedForward)
                }
                VaultOperation::SecretDeleted { .. }
                | VaultOperation::SecretReplaced { .. }
                | VaultOperation::SecretConflictResolved { .. }
                | VaultOperation::VaultCleared
                | VaultOperation::VaultNamed { .. }
                | VaultOperation::PasswordAdded { .. }
                | VaultOperation::PasswordRotated { .. }
                | VaultOperation::PasswordEnvelopeUpgraded { .. }
                | VaultOperation::PasswordRemoved { .. }
                | VaultOperation::JoinRequested { .. }
                | VaultOperation::JoinApproved { .. }
                | VaultOperation::SentinelParticipantEnrolled { .. }
                | VaultOperation::SentinelSharesIssued { .. }
                | VaultOperation::JoinDenied { .. }
                | VaultOperation::MemberRenamed { .. }
                | VaultOperation::DeviceRevoked { .. } => None,
            })
            .ok_or(SecretHistoryError::UnrecordedOrigin)
    }

    fn device(&self, event: &VaultEvent) -> SecretHistoryDevice {
        let signer = &event.body.actor_signing_public_key;
        if let SecretHistoryLocalSigner::Known(local) = self.local_signer
            && local == signer
        {
            return SecretHistoryDevice::ThisDevice;
        }
        // The first applied declaration of this signing key, in causal order,
        // matching how the event graph authorizes actors.
        let joined_device = self.events.iter().find_map(|(_, candidate)| {
            candidate
                .body
                .operations
                .iter()
                .find_map(|operation| match operation {
                    VaultOperation::JoinApproved {
                        device_id,
                        signing_public_key,
                        ..
                    }
                    | VaultOperation::SentinelParticipantEnrolled {
                        device_id,
                        signing_public_key,
                        ..
                    } if !signing_public_key.is_empty() && signing_public_key == signer => {
                        Some(device_id)
                    }
                    _ => None,
                })
        });
        let Some(device_id) = joined_device else {
            return SecretHistoryDevice::Unrecorded;
        };
        match self
            .roster
            .iter()
            .find(|member| &member.device_id == device_id)
        {
            Some(member) => SecretHistoryDevice::Member {
                device_id: device_id.clone(),
                label: member.label.clone(),
            },
            None => SecretHistoryDevice::FormerMember {
                device_id: device_id.clone(),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        AgeArmoredCiphertext, DeviceIdentity, EncryptedSecretPayload, MemberLabel,
        OpaqueCiphertext, ProjectedSecretLifecycle, SecretFingerprint, SecretType, Sha256Hex,
        SigningIdentity, StoreId, VaultEventBody, VaultEventSchemaVersion,
    };
    use ed25519_dalek::SigningKey;

    struct HistoryFixture {
        secrets: BTreeMap<SecretId, ProjectedSecret>,
        events: Vec<(EventId, VaultEvent)>,
    }

    impl HistoryFixture {
        fn new() -> Self {
            Self {
                secrets: BTreeMap::new(),
                events: Vec::new(),
            }
        }

        fn signer(seed: u8) -> SigningKey {
            SigningKey::from_bytes(&[seed; 32])
        }

        fn public_key(signer: &SigningKey) -> DeviceSigningPublicKey {
            DeviceSigningPublicKey::from_trusted(hex::encode(signer.verifying_key().as_bytes()))
        }

        fn payload(id: &str) -> EncryptedSecretPayload {
            EncryptedSecretPayload {
                id: SecretId::from_vault_record(id),
                secret_type: SecretType::Passkey,
                ciphertext: OpaqueCiphertext::from_trusted(format!("cipher-{id}")),
                identity_fingerprint: SecretFingerprint::from_trusted(format!("identity-{id}")),
                fingerprint: SecretFingerprint::from_trusted(format!("version-{id}")),
            }
        }

        fn event_id(index: usize) -> EventId {
            EventId::from_trusted(format!("sha256u:event{index:038}"))
        }

        /// Record one event and return its id.
        fn event(
            &mut self,
            signer: &SigningKey,
            created_at: &str,
            operation: VaultOperation,
        ) -> anyhow::Result<EventId> {
            let id = HistoryFixture::event_id(self.events.len());
            let event = VaultEvent::sign(
                VaultEventBody {
                    schema_version: VaultEventSchemaVersion::CURRENT,
                    store_id: StoreId::parse("store_testtoken11")?,
                    actor_id: SigningIdentity::actor_id_for_verifying_key(&signer.verifying_key())?,
                    actor_signing_public_key: HistoryFixture::public_key(signer),
                    parents: Vec::new(),
                    created_at: IsoTimestamp::from_trusted(created_at.to_owned()),
                    key_epoch: HistoryFixture::event_id(999),
                    operations: vec![operation],
                },
                signer,
            )?;
            self.events.push((id.clone(), event));
            Ok(id)
        }

        fn version(&mut self, id: &str, created_by: EventId, origin: ProjectedSecretOrigin) {
            let payload = HistoryFixture::payload(id);
            self.secrets.insert(
                payload.id.clone(),
                ProjectedSecret {
                    record: payload.to_stored(),
                    identity_fingerprint: payload.identity_fingerprint.clone(),
                    fingerprint: payload.fingerprint.clone(),
                    created_by,
                    lifecycle: ProjectedSecretLifecycle::Live,
                    origin,
                },
            );
        }

        fn replace(
            &mut self,
            signer: &SigningKey,
            created_at: &str,
            ids: (&str, &str),
        ) -> anyhow::Result<()> {
            let (old_id, new_id) = ids;
            let event = self.event(
                signer,
                created_at,
                VaultOperation::SecretReplaced {
                    old_id: SecretId::from_vault_record(old_id),
                    new_secret: HistoryFixture::payload(new_id),
                },
            )?;
            self.version(
                new_id,
                event,
                ProjectedSecretOrigin::Replacement {
                    from: SecretId::from_vault_record(old_id),
                },
            );
            Ok(())
        }

        fn derive(
            &self,
            roster: &[VaultMember],
            local_signer: SecretHistoryLocalSigner<'_>,
            secret_id: &str,
        ) -> Result<SecretHistory, SecretHistoryError> {
            let events = self
                .events
                .iter()
                .map(|(id, event)| (id, event))
                .collect::<Vec<_>>();
            SecretHistoryRequest {
                secrets: &self.secrets,
                events: &events,
                roster,
                local_signer,
                secret_id: &SecretId::from_vault_record(secret_id),
            }
            .derive()
        }
    }

    #[test]
    fn created_then_replaced_twice_reports_first_creation_and_last_change() -> anyhow::Result<()> {
        let creator = HistoryFixture::signer(1);
        let editor = HistoryFixture::signer(2);
        let mut fixture = HistoryFixture::new();
        let created = fixture.event(
            &creator,
            "2026-01-02T03:04:05Z",
            VaultOperation::SecretCreated {
                secret: HistoryFixture::payload("secret_version1"),
            },
        )?;
        fixture.version("secret_version1", created, ProjectedSecretOrigin::Created);
        fixture.replace(
            &editor,
            "2026-02-01T00:00:00Z",
            ("secret_version1", "secret_version2"),
        )?;
        fixture.replace(
            &creator,
            "2026-03-01T00:00:00Z",
            ("secret_version2", "secret_version3"),
        )?;
        let creator_key = HistoryFixture::public_key(&creator);

        let history = fixture.derive(
            &[],
            SecretHistoryLocalSigner::Known(&creator_key),
            "secret_version3",
        )?;

        assert_eq!(
            history.origin,
            SecretHistoryOrigin::Created {
                at: IsoTimestamp::from_trusted("2026-01-02T03:04:05Z".to_owned()),
                device: SecretHistoryDevice::ThisDevice,
            }
        );
        assert_eq!(
            history.origin.translation_key(),
            i18n_keys::VAULT_FIELDS_HISTORY_CREATED
        );
        assert_eq!(
            history.revision,
            SecretRevision::Revised {
                at: IsoTimestamp::from_trusted("2026-03-01T00:00:00Z".to_owned()),
                device: SecretHistoryDevice::ThisDevice,
            }
        );
        Ok(())
    }

    #[test]
    fn unreplaced_item_is_original() -> anyhow::Result<()> {
        let creator = HistoryFixture::signer(1);
        let mut fixture = HistoryFixture::new();
        let created = fixture.event(
            &creator,
            "2026-01-02T03:04:05Z",
            VaultOperation::SecretCreated {
                secret: HistoryFixture::payload("secret_version1"),
            },
        )?;
        fixture.version("secret_version1", created, ProjectedSecretOrigin::Created);

        let history = fixture.derive(
            &[],
            SecretHistoryLocalSigner::Unavailable,
            "secret_version1",
        )?;

        assert_eq!(history.revision, SecretRevision::Original);
        assert_eq!(
            history.origin.device(),
            Some(&SecretHistoryDevice::Unrecorded)
        );
        Ok(())
    }

    #[test]
    fn checkpoint_rooted_chain_reports_carried_forward_not_created() -> anyhow::Result<()> {
        let rotator = HistoryFixture::signer(3);
        let mut fixture = HistoryFixture::new();
        let checkpoint = fixture.event(
            &rotator,
            "2026-05-05T00:00:00Z",
            VaultOperation::EpochCheckpoint {
                vault_name: None,
                secrets: vec![HistoryFixture::payload("secret_carried1")],
                members_checkpoint_hash: Sha256Hex::from_trusted("ab".repeat(32)),
                rotated_meta_records: crate::EpochMetadataState::LegacyRetain,
                password_entries: crate::EpochPasswordState::LegacyRetain,
            },
        )?;
        fixture.version(
            "secret_carried1",
            checkpoint,
            ProjectedSecretOrigin::Created,
        );
        fixture.replace(
            &rotator,
            "2026-06-06T00:00:00Z",
            ("secret_carried1", "secret_carried2"),
        )?;

        let history = fixture.derive(
            &[],
            SecretHistoryLocalSigner::Unavailable,
            "secret_carried2",
        )?;

        assert_eq!(
            history.origin,
            SecretHistoryOrigin::CarriedForwardSince {
                at: IsoTimestamp::from_trusted("2026-05-05T00:00:00Z".to_owned()),
            }
        );
        assert_eq!(history.origin.device(), None);
        assert_eq!(
            history.origin.translation_key(),
            i18n_keys::VAULT_FIELDS_HISTORY_IN_VAULT_SINCE
        );
        assert!(matches!(history.revision, SecretRevision::Revised { .. }));
        Ok(())
    }

    #[test]
    fn imported_item_reports_import_time_without_a_creating_device() -> anyhow::Result<()> {
        let importer = HistoryFixture::signer(4);
        let mut fixture = HistoryFixture::new();
        let import = fixture.event(
            &importer,
            "2026-04-04T00:00:00Z",
            VaultOperation::VaultImported {
                source_content_hash: Sha256Hex::from_trusted("cd".repeat(32)),
                secrets: vec![HistoryFixture::payload("secret_imported")],
                password_entries: Vec::new(),
            },
        )?;
        fixture.version("secret_imported", import, ProjectedSecretOrigin::Created);

        let history = fixture.derive(
            &[],
            SecretHistoryLocalSigner::Unavailable,
            "secret_imported",
        )?;

        assert_eq!(
            history.origin,
            SecretHistoryOrigin::Imported {
                at: IsoTimestamp::from_trusted("2026-04-04T00:00:00Z".to_owned()),
            }
        );
        assert_eq!(
            history.origin.translation_key(),
            i18n_keys::VAULT_FIELDS_HISTORY_IMPORTED
        );
        Ok(())
    }

    #[test]
    fn devices_resolve_through_join_signing_keys_and_the_roster() -> anyhow::Result<()> {
        let owner = HistoryFixture::signer(5);
        let laptop = HistoryFixture::signer(6);
        let removed = HistoryFixture::signer(7);
        let laptop_identity = DeviceIdentity::generate()?;
        let removed_identity = DeviceIdentity::generate()?;
        let mut fixture = HistoryFixture::new();
        // The last declaration re-binds the laptop key to another device; the
        // first declaration in causal order is the one that counts.
        for (signer, identity) in [
            (&laptop, &laptop_identity),
            (&removed, &removed_identity),
            (&laptop, &removed_identity),
        ] {
            fixture.event(
                &owner,
                "2026-01-01T00:00:00Z",
                VaultOperation::JoinApproved {
                    device_id: identity.app_id().clone(),
                    encryption_public_key: identity.public_key(),
                    signing_public_key: HistoryFixture::public_key(signer),
                    label: MemberLabel::from_trusted("join label".to_owned()),
                    secrets_key_ciphertext: AgeArmoredCiphertext::from_trusted_armored(
                        "armored".to_owned(),
                    ),
                    members_key_ciphertext: AgeArmoredCiphertext::from_trusted_armored(
                        "armored".to_owned(),
                    ),
                },
            )?;
        }
        let created = fixture.event(
            &laptop,
            "2026-01-02T00:00:00Z",
            VaultOperation::SecretCreated {
                secret: HistoryFixture::payload("secret_laptop1"),
            },
        )?;
        fixture.version("secret_laptop1", created, ProjectedSecretOrigin::Created);
        fixture.replace(
            &removed,
            "2026-01-03T00:00:00Z",
            ("secret_laptop1", "secret_laptop2"),
        )?;
        let roster = [VaultMember {
            auth_id: laptop_identity.auth_id(),
            device_id: laptop_identity.app_id().clone(),
            public_key: laptop_identity.public_key(),
            enrolled_at: "2026-01-01T00:00:00Z".to_owned(),
            label: MemberLabelState::Named("Work laptop".to_owned()),
        }];

        let history = fixture.derive(
            &roster,
            SecretHistoryLocalSigner::Unavailable,
            "secret_laptop2",
        )?;

        let created_on = history.origin.device().cloned();
        assert_eq!(
            created_on,
            Some(SecretHistoryDevice::Member {
                device_id: laptop_identity.app_id().clone(),
                label: MemberLabelState::Named("Work laptop".to_owned()),
            })
        );
        let Some(named) = created_on else {
            anyhow::bail!("a created item must report its creating device");
        };
        assert_eq!(
            named.translation_key(),
            i18n_keys::VAULT_FIELDS_HISTORY_DEVICE_NAMED
        );
        assert_eq!(named.display_value(), "Work laptop");
        let SecretRevision::Revised { device, .. } = history.revision else {
            anyhow::bail!("the replaced item must report a revision");
        };
        assert_eq!(
            device,
            SecretHistoryDevice::FormerMember {
                device_id: removed_identity.app_id().clone(),
            }
        );
        assert_eq!(
            device.translation_key(),
            i18n_keys::VAULT_FIELDS_HISTORY_DEVICE_REMOVED
        );
        assert_eq!(device.display_value(), removed_identity.app_id().as_str());
        let unnamed = SecretHistoryDevice::Member {
            device_id: laptop_identity.app_id().clone(),
            label: MemberLabelState::Unnamed,
        };
        assert_eq!(
            unnamed.translation_key(),
            i18n_keys::VAULT_FIELDS_HISTORY_DEVICE_UNNAMED
        );
        assert_eq!(unnamed.display_value(), laptop_identity.app_id().as_str());
        Ok(())
    }

    #[test]
    fn inconsistent_logs_fail_instead_of_guessing() -> anyhow::Result<()> {
        let creator = HistoryFixture::signer(1);
        let mut fixture = HistoryFixture::new();
        assert_eq!(
            fixture.derive(&[], SecretHistoryLocalSigner::Unavailable, "secret_absent1"),
            Err(SecretHistoryError::UnknownSecret)
        );

        fixture.version(
            "secret_orphan01",
            HistoryFixture::event_id(500),
            ProjectedSecretOrigin::Replacement {
                from: SecretId::from_vault_record("secret_gone0001"),
            },
        );
        assert_eq!(
            fixture.derive(
                &[],
                SecretHistoryLocalSigner::Unavailable,
                "secret_orphan01"
            ),
            Err(SecretHistoryError::BrokenReplacementChain)
        );

        fixture.version(
            "secret_noevent1",
            HistoryFixture::event_id(501),
            ProjectedSecretOrigin::Created,
        );
        assert_eq!(
            fixture.derive(
                &[],
                SecretHistoryLocalSigner::Unavailable,
                "secret_noevent1"
            ),
            Err(SecretHistoryError::MissingEvent)
        );

        let unrelated = fixture.event(
            &creator,
            "2026-01-02T03:04:05Z",
            VaultOperation::SecretCreated {
                secret: HistoryFixture::payload("secret_other001"),
            },
        )?;
        fixture.version("secret_mismatch", unrelated, ProjectedSecretOrigin::Created);
        assert_eq!(
            fixture.derive(
                &[],
                SecretHistoryLocalSigner::Unavailable,
                "secret_mismatch"
            ),
            Err(SecretHistoryError::UnrecordedOrigin)
        );
        Ok(())
    }
}

//! Read-only app inventory from local identity metadata and signed vault rosters.
//!
//! Vault roster observations describe access; they never enroll an app in the
//! identity directory or copy its private key into another installation.

use std::collections::BTreeMap;

use crate::{
    AppId, EventError, EventGraph, EventLookup, IdentityMember, IdentityRecord,
    IdentityVaultBinding, MemberLabel, MemberLabelState, MultiDeviceError, StoreId, VaultOperation,
};

#[derive(Debug, thiserror::Error)]
pub enum IdentityAppInventoryError {
    #[error(transparent)]
    Event(#[from] EventError),
    #[error(transparent)]
    Member(#[from] MultiDeviceError),
    #[error("App inventory requires complete vault history")]
    IncompleteHistory,
    #[error("Vault is not linked to this identity")]
    UnlinkedVault,
}

pub struct IdentityVaultAppInventoryRequest<'a> {
    pub store_id: &'a StoreId,
    pub graph: &'a EventGraph,
}

pub struct IdentityAppInventory<'a> {
    identity: &'a IdentityRecord,
    members: BTreeMap<AppId, IdentityMember>,
}

impl<'a> IdentityAppInventory<'a> {
    #[must_use]
    pub fn new(identity: &'a IdentityRecord) -> Self {
        Self {
            identity,
            members: identity
                .members
                .iter()
                .map(|member| (member.app_id.clone(), member.clone()))
                .collect(),
        }
    }

    /// Include active apps from a linked vault without changing identity grants.
    #[must_use = "Use the updated app inventory after including this vault"]
    pub fn include_vault(
        mut self,
        request: &IdentityVaultAppInventoryRequest<'_>,
    ) -> Result<Self, IdentityAppInventoryError> {
        match self.identity.vault_dek(request.store_id) {
            IdentityVaultBinding::Bound(_) => {}
            IdentityVaultBinding::Unbound => return Err(IdentityAppInventoryError::UnlinkedVault),
        }
        let roster = VaultAppRoster::from_graph(request)?;
        match roster.identity_link(self.identity) {
            VaultIdentityAppLink::Linked => {
                for member in roster.members.into_values() {
                    self.members.entry(member.app_id.clone()).or_insert(member);
                }
            }
            VaultIdentityAppLink::Unlinked => {}
        }
        Ok(self)
    }

    #[must_use]
    pub fn into_members(self) -> Vec<IdentityMember> {
        self.members.into_values().collect()
    }
}

enum VaultIdentityAppLink {
    Linked,
    Unlinked,
}

#[derive(Default)]
struct VaultAppRoster {
    members: BTreeMap<AppId, IdentityMember>,
}

impl VaultAppRoster {
    fn from_graph(
        request: &IdentityVaultAppInventoryRequest<'_>,
    ) -> Result<Self, IdentityAppInventoryError> {
        let graph = request.graph;
        match graph.pending_events().as_slice() {
            [] => {}
            [_, ..] => return Err(IdentityAppInventoryError::IncompleteHistory),
        }
        match graph.quarantined().values().next() {
            None => {}
            Some(_) => return Err(IdentityAppInventoryError::IncompleteHistory),
        }
        let mut roster = Self::default();
        for event_id in graph.topological_order()? {
            let EventLookup::Recorded(event) = graph.get(&event_id) else {
                return Err(EventError::MissingEvent {
                    event_id: event_id.to_string(),
                }
                .into());
            };
            event.validate_envelope(request.store_id)?;
            for operation in &event.body.operations {
                roster = roster.apply(operation)?;
            }
        }
        Ok(roster)
    }

    fn identity_link(&self, identity: &IdentityRecord) -> VaultIdentityAppLink {
        for member in &identity.members {
            match self.members.get(&member.app_id) {
                Some(observed) if member.public_key == observed.public_key => {
                    return VaultIdentityAppLink::Linked;
                }
                Some(_) | None => {}
            }
        }
        VaultIdentityAppLink::Unlinked
    }

    #[must_use = "Use the roster with the applied vault operation"]
    fn apply(mut self, operation: &VaultOperation) -> Result<Self, IdentityAppInventoryError> {
        match operation {
            VaultOperation::JoinApproved {
                device_id,
                encryption_public_key,
                signing_public_key,
                label,
                ..
            }
            | VaultOperation::SentinelParticipantEnrolled {
                device_id,
                encryption_public_key,
                signing_public_key,
                label,
            } => {
                match encryption_public_key.try_app_id()? {
                    observed if observed == *device_id => {}
                    _ => {
                        return Err(MultiDeviceError::InvalidDeviceIdentity(
                            "Vault app id does not match its public key".to_owned(),
                        )
                        .into());
                    }
                }
                self.members.insert(
                    device_id.clone(),
                    IdentityMember {
                        app_id: device_id.clone(),
                        auth_id: encryption_public_key.auth_id()?,
                        public_key: encryption_public_key.clone(),
                        signing_public_key: signing_public_key.clone(),
                        label: Self::observed_label(label),
                    },
                );
            }
            VaultOperation::MemberRenamed { device_id, label } => {
                if let Some(member) = self.members.get_mut(device_id) {
                    member.label = Self::observed_label(label);
                }
            }
            VaultOperation::DeviceRevoked { device_id } => {
                self.members.remove(device_id);
            }
            VaultOperation::JoinRequested { .. }
            | VaultOperation::JoinDenied { .. }
            | VaultOperation::VaultImported { .. }
            | VaultOperation::SecretCreated { .. }
            | VaultOperation::SecretDeleted { .. }
            | VaultOperation::SecretReplaced { .. }
            | VaultOperation::SecretConflictResolved { .. }
            | VaultOperation::PasswordAdded { .. }
            | VaultOperation::PasswordRotated { .. }
            | VaultOperation::PasswordEnvelopeUpgraded { .. }
            | VaultOperation::PasswordRemoved { .. }
            | VaultOperation::SentinelSharesIssued { .. }
            | VaultOperation::VaultCleared
            | VaultOperation::EpochCheckpoint { .. } => {}
        }
        Ok(self)
    }

    fn observed_label(label: &MemberLabel) -> MemberLabelState {
        match label.as_str() {
            "" => MemberLabelState::Unnamed,
            text => MemberLabelState::Named(text.to_owned()),
        }
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use crate::{
        AppKey, AuthEnvelopes, EventGraphInsert, EventGraphRejection, EventId,
        IdentityRecordRejection, IsoTimestamp, Sha256Hex, SigningIdentity, VaultEvent,
        VaultEventBody, VaultEventSchemaVersion, VaultKeys,
    };

    struct InventoryFixture {
        identity: IdentityRecord,
        browser: AppKey,
        extension: AppKey,
        signing: SigningIdentity,
        keys: VaultKeys,
        store_id: StoreId,
        graph: EventGraph,
    }

    impl InventoryFixture {
        fn new() -> anyhow::Result<Self> {
            let browser = AppKey::generate()?;
            let store_id = StoreId::generate()?;
            let identity = IdentityRecord::create_with_app_key(
                "Personal",
                &browser,
                MemberLabelState::Unnamed,
            )?
            .generate_vault_dek(store_id.clone())
            .map_err(IdentityRecordRejection::into_cause)?;
            let (signing, signing_seed) = SigningIdentity::generate()?;
            drop(signing_seed);
            let fixture = Self {
                identity: identity.identity,
                browser,
                extension: AppKey::generate()?,
                signing,
                keys: identity.keys,
                store_id,
                graph: EventGraph::new(),
            };
            let approval = fixture.approval(&fixture.browser)?;
            fixture.append(vec![
                VaultOperation::VaultImported {
                    source_content_hash: Sha256Hex::from_bytes(b"inventory fixture"),
                    secrets: Vec::new(),
                    password_entries: Vec::new(),
                },
                approval,
            ])
        }

        fn approval(&self, app: &AppKey) -> anyhow::Result<VaultOperation> {
            let record = app.auth_record(&self.keys.secrets_key, &self.keys.members_key)?;
            let envelopes = AuthEnvelopes::parse(record.value.as_str())?;
            Ok(VaultOperation::JoinApproved {
                device_id: app.app_id().clone(),
                encryption_public_key: app.public_key(),
                signing_public_key: self.signing.public_key(),
                label: MemberLabel::from_trusted("Nook browser extension".to_owned()),
                secrets_key_ciphertext: envelopes.secrets_key,
                members_key_ciphertext: envelopes.members_key,
            })
        }

        #[must_use = "Use the fixture with the appended signed event"]
        fn append(mut self, operations: Vec<VaultOperation>) -> anyhow::Result<Self> {
            let event = VaultEvent::sign(
                VaultEventBody {
                    schema_version: VaultEventSchemaVersion::CURRENT,
                    store_id: self.store_id.clone(),
                    actor_id: self.signing.actor_id()?,
                    actor_signing_public_key: self.signing.public_key(),
                    parents: self.graph.heads(),
                    created_at: IsoTimestamp::parse("2026-10-02T12:00:00Z")?,
                    key_epoch: EventId::from_sha256_hex(
                        Sha256Hex::from_bytes(self.store_id.as_str().as_bytes()).as_str(),
                    )?,
                    operations,
                },
                self.signing.signing_key(),
            )?;
            self.graph = self
                .graph
                .insert(EventGraphInsert {
                    event,
                    expected_store_id: self.store_id.as_str(),
                })
                .map_err(EventGraphRejection::into_cause)?
                .graph;
            Ok(self)
        }

        fn inventory(&self) -> Result<IdentityAppInventory<'_>, IdentityAppInventoryError> {
            IdentityAppInventory::new(&self.identity).include_vault(
                &IdentityVaultAppInventoryRequest {
                    store_id: &self.store_id,
                    graph: &self.graph,
                },
            )
        }
    }

    #[test]
    fn includes_vault_extension_without_enrolling_it_in_the_local_directory() -> anyhow::Result<()>
    {
        let fixture = InventoryFixture::new()?;
        let approval = fixture.approval(&fixture.extension)?;
        let fixture = fixture.append(vec![approval])?;
        let before = fixture.identity.clone();
        let inventory = fixture.inventory()?.into_members();
        assert_eq!(inventory.len(), 2);
        assert!(inventory.iter().any(|member| {
            member.app_id == *fixture.extension.app_id()
                && member.label == MemberLabelState::Named("Nook browser extension".to_owned())
        }));
        assert_eq!(fixture.identity, before);
        assert_eq!(fixture.identity.members.len(), 1);
        assert_eq!(fixture.identity.vault_deks.len(), 1);
        assert_eq!(
            fixture
                .inventory()?
                .include_vault(&IdentityVaultAppInventoryRequest {
                    store_id: &fixture.store_id,
                    graph: &fixture.graph,
                })?
                .into_members(),
            inventory
        );
        Ok(())
    }

    #[test]
    fn retains_local_protection_label_and_projects_peer_rename_and_revocation() -> anyhow::Result<()>
    {
        let fixture = InventoryFixture::new()?;
        let approval = fixture.approval(&fixture.extension)?;
        let rename = VaultOperation::MemberRenamed {
            device_id: fixture.extension.app_id().clone(),
            label: MemberLabel::from_trusted("Work extension".to_owned()),
        };
        let fixture = fixture.append(vec![approval, rename])?;
        let inventory = fixture.inventory()?.into_members();
        assert!(inventory.iter().any(|member| {
            member.app_id == *fixture.browser.app_id() && member.label == MemberLabelState::Unnamed
        }));
        assert!(inventory.iter().any(|member| {
            member.app_id == *fixture.extension.app_id()
                && member.label == MemberLabelState::Named("Work extension".to_owned())
        }));
        let revoke = VaultOperation::DeviceRevoked {
            device_id: fixture.extension.app_id().clone(),
        };
        let fixture = fixture.append(vec![revoke])?;
        assert_eq!(
            fixture.inventory()?.into_members(),
            fixture.identity.members
        );
        Ok(())
    }

    #[test]
    fn pending_join_is_not_an_enrolled_app() -> anyhow::Result<()> {
        let fixture = InventoryFixture::new()?;
        let request = VaultOperation::JoinRequested {
            device_id: fixture.extension.app_id().clone(),
            encryption_public_key: fixture.extension.public_key(),
            signing_public_key: fixture.signing.public_key(),
            label: MemberLabel::from_trusted("Pending extension".to_owned()),
        };
        let fixture = fixture.append(vec![request])?;
        assert_eq!(
            fixture.inventory()?.into_members(),
            fixture.identity.members
        );
        Ok(())
    }

    #[test]
    fn unrelated_identity_cannot_borrow_a_vault_roster() -> anyhow::Result<()> {
        let fixture = InventoryFixture::new()?;
        let unrelated = IdentityRecord::create_with_app_key(
            "Work",
            &fixture.extension,
            MemberLabelState::Unnamed,
        )?
        .generate_vault_dek(fixture.store_id.clone())
        .map_err(IdentityRecordRejection::into_cause)?;
        let inventory = IdentityAppInventory::new(&unrelated.identity)
            .include_vault(&IdentityVaultAppInventoryRequest {
                store_id: &fixture.store_id,
                graph: &fixture.graph,
            })?
            .into_members();
        assert_eq!(inventory, unrelated.identity.members);
        let other_store = StoreId::generate()?;
        assert!(matches!(
            fixture
                .inventory()?
                .include_vault(&IdentityVaultAppInventoryRequest {
                    store_id: &other_store,
                    graph: &fixture.graph,
                }),
            Err(IdentityAppInventoryError::UnlinkedVault)
        ));
        Ok(())
    }

    #[test]
    fn incomplete_history_does_not_hide_a_pending_roster_change() -> anyhow::Result<()> {
        let mut fixture = InventoryFixture::new()?;
        let unknown_parent =
            EventId::from_sha256_hex(Sha256Hex::from_bytes(b"missing parent").as_str())?;
        let pending = VaultEvent::sign(
            VaultEventBody {
                schema_version: VaultEventSchemaVersion::CURRENT,
                store_id: fixture.store_id.clone(),
                actor_id: fixture.signing.actor_id()?,
                actor_signing_public_key: fixture.signing.public_key(),
                parents: vec![unknown_parent],
                created_at: IsoTimestamp::parse("2026-10-02T12:01:00Z")?,
                key_epoch: EventId::from_sha256_hex(
                    Sha256Hex::from_bytes(fixture.store_id.as_str().as_bytes()).as_str(),
                )?,
                operations: vec![VaultOperation::DeviceRevoked {
                    device_id: fixture.browser.app_id().clone(),
                }],
            },
            fixture.signing.signing_key(),
        )?;
        fixture.graph = fixture
            .graph
            .insert(EventGraphInsert {
                event: pending,
                expected_store_id: fixture.store_id.as_str(),
            })
            .map_err(EventGraphRejection::into_cause)?
            .graph;
        assert!(matches!(
            fixture.inventory(),
            Err(IdentityAppInventoryError::IncompleteHistory)
        ));
        Ok(())
    }

    #[test]
    fn a_linked_vault_cannot_use_another_vaults_history() -> anyhow::Result<()> {
        let fixture = InventoryFixture::new()?;
        let other_store = StoreId::generate()?;
        let identity = fixture
            .identity
            .clone()
            .generate_vault_dek(other_store.clone())
            .map_err(IdentityRecordRejection::into_cause)?;
        assert!(matches!(
            IdentityAppInventory::new(&identity.identity).include_vault(
                &IdentityVaultAppInventoryRequest {
                    store_id: &other_store,
                    graph: &fixture.graph,
                }
            ),
            Err(IdentityAppInventoryError::Event(_))
        ));
        Ok(())
    }
}

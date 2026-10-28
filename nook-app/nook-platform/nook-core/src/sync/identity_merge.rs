//! Merging another identity's vaults into the identity in use.
//!
//! A passkey of the other identity re-derives one of its member app keys.
//! That key reads each vault's current DEK from the other identity's log,
//! and the identity in use registers every one of those vaults in its own
//! log, wrapped to its own members. The plan is all or nothing: a vault
//! whose key, events, or key epoch cannot be proven fails the whole merge.
//! The other identity's log is only read, so its devices keep their access.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use crate::errors::{IdentityMergeError, VaultResult};
use crate::vault_access_check::{CheckedVaultEvents, CheckedVaultSource};
use crate::{
    AppId, AppKey, IdentityControlLog, IdentityControlOperation, IdentityControlState,
    IdentityControlVault, IdentityDirectory, IdentityId, IdentityVaultDekLookup,
    IdentityVaultRegistration, LocalEventWrite, OpenedVaultDek, ProjectionEpoch,
    ProviderIdentityLogEvents, ProviderVaultName, StoreId, VaultKeys,
};

/// The identity in use, which another identity's vaults merge into.
pub struct IdentityMergeDestination<'a> {
    /// The identity in use's control log, as this browser stores it.
    pub log: &'a IdentityControlLog,
    /// This installation's app key, which signs the merge.
    pub signer: &'a AppId,
    /// This browser's identities. A vault belongs to one of them only.
    pub directory: &'a IdentityDirectory,
}

/// A merge the identity in use accepts, waiting for a passkey's proof.
pub struct IdentityMerge<'a> {
    destination: IdentityControlState,
    other: IdentityId,
    directory: &'a IdentityDirectory,
}

/// What a passkey of the other identity proves, and the source it is checked
/// against.
pub struct IdentityMergeProof<'a> {
    /// The app key the passkey re-derived, held in memory only.
    pub app_key: &'a AppKey,
    pub identity_logs: Vec<ProviderIdentityLogEvents>,
    pub vaults: Vec<CheckedVaultEvents>,
}

/// One vault the merge brings to the identity in use.
pub struct MergedVault {
    pub store_id: StoreId,
    /// Its name, decrypted with the key the other identity granted.
    pub name: ProviderVaultName,
    /// Its own log's events, as the source holds them.
    pub events: Vec<LocalEventWrite>,
}

/// Everything a merge writes, decided before anything is written.
pub struct IdentityMergePlan {
    /// Vaults to store on this browser, in the other identity's order.
    pub vaults: Vec<MergedVault>,
    /// Vaults the identity in use already keeps; nothing is written for them.
    pub already_kept: Vec<StoreId>,
    /// One `vault-registered` per merged vault, wrapped to every member of
    /// the identity in use. They belong in its log only.
    pub operations: Vec<IdentityControlOperation>,
}

impl<'a> IdentityMergeDestination<'a> {
    /// Accept another identity to merge, before any passkey is asked for.
    /// The identity in use needs a log this device signs for, and an identity
    /// never merges into itself.
    pub fn merging(&self, other: &IdentityId) -> VaultResult<IdentityMerge<'a>> {
        if self.log.is_empty() {
            return Err(IdentityMergeError::DestinationNotReplicated.into());
        }
        if self.log.identity_id() == other {
            return Err(IdentityMergeError::IntoItself.into());
        }
        let destination = IdentityControlState::project(self.log)?;
        if destination.member(self.signer).is_none() {
            return Err(IdentityMergeError::SignerNotMember.into());
        }
        Ok(IdentityMerge {
            destination,
            other: other.clone(),
            directory: self.directory,
        })
    }
}

impl IdentityMerge<'_> {
    /// Plan the merge with the passkey's app key. The key must be a member of
    /// the other identity's log, and each vault that log keeps must grant it
    /// the vault's current key, have its events in the source, and belong to
    /// no other identity on this browser. Otherwise nothing is planned.
    pub fn plan(&self, proof: IdentityMergeProof<'_>) -> VaultResult<IdentityMergePlan> {
        let IdentityMergeProof {
            app_key,
            identity_logs,
            mut vaults,
        } = proof;
        let other = self.other_state(identity_logs)?;
        let app_id = app_key.app_id();
        if other.member(app_id).is_none() {
            return Err(IdentityMergeError::PasskeyNotMember {
                identity_id: self.other.clone(),
            }
            .into());
        }
        let mut plan = IdentityMergePlan {
            vaults: Vec::new(),
            already_kept: Vec::new(),
            operations: Vec::new(),
        };
        for vault in &other.vaults {
            if self.destination.vault(&vault.store_id).is_some() {
                plan.already_kept.push(vault.store_id.clone());
                continue;
            }
            if let Some(owner) = self.directory.identities().iter().find(|record| {
                record.owns_vault(&vault.store_id)
                    && record.identity_id != self.destination.identity_id
            }) {
                return Err(IdentityMergeError::VaultKeptByAnotherLocalIdentity {
                    store_id: vault.store_id.clone(),
                    identity_id: owner.identity_id.clone(),
                }
                .into());
            }
            let IdentityVaultDekLookup::Granted(dek) = vault.current_dek_for(app_id) else {
                return Err(IdentityMergeError::VaultKeyNotGranted {
                    identity_id: self.other.clone(),
                    store_id: vault.store_id.clone(),
                }
                .into());
            };
            let keys = VaultKeys {
                secrets_key: app_key.decrypt_envelope(&dek.secrets_key_ciphertext)?,
                members_key: app_key.decrypt_envelope(&dek.members_key_ciphertext)?,
            };
            let events = Self::take_events(&mut vaults, &vault.store_id)?;
            let name = Self::proven_name(vault, &keys, &events)?;
            plan.operations
                .push(self.destination.vault_registration_operation(
                    IdentityVaultRegistration {
                        dek: OpenedVaultDek {
                            store_id: &vault.store_id,
                            key_epoch: &vault.current_key_epoch,
                            keys: &keys,
                        },
                    },
                )?);
            plan.vaults.push(MergedVault {
                store_id: vault.store_id.clone(),
                name,
                events,
            });
        }
        Ok(plan)
    }

    /// The other identity's state, from the log the source holds for it.
    fn other_state(
        &self,
        identity_logs: Vec<ProviderIdentityLogEvents>,
    ) -> VaultResult<IdentityControlState> {
        let listed = identity_logs
            .into_iter()
            .find(|listed| listed.identity_id == self.other && !listed.events.is_empty())
            .ok_or_else(|| IdentityMergeError::IdentityNotHeld {
                identity_id: self.other.clone(),
            })?;
        let log = IdentityControlLog::new(self.other.clone())
            .union_storage_bytes(&listed.events)
            .map_err(|rejection| rejection.cause)?;
        Ok(IdentityControlState::project(&log)?)
    }

    /// The source's events for one vault. A vault it does not hold, or files
    /// under two identities, fails.
    fn take_events(
        vaults: &mut Vec<CheckedVaultEvents>,
        store_id: &StoreId,
    ) -> VaultResult<Vec<LocalEventWrite>> {
        if vaults
            .iter()
            .filter(|vault| &vault.store_id == store_id)
            .count()
            > 1
        {
            return Err(IdentityMergeError::VaultFiledTwice {
                store_id: store_id.clone(),
            }
            .into());
        }
        let not_held = || IdentityMergeError::VaultEventsNotHeld {
            store_id: store_id.clone(),
        };
        let index = vaults
            .iter()
            .position(|vault| &vault.store_id == store_id)
            .ok_or_else(not_held)?;
        let events = vaults.swap_remove(index).events;
        if events.is_empty() {
            return Err(not_held().into());
        }
        Ok(events)
    }

    /// Prove the granted key is the vault's current key, and read the vault's
    /// name with it. The vault's own log must be at the epoch the identity
    /// grants, with no unresolved security conflict.
    fn proven_name(
        vault: &IdentityControlVault,
        keys: &VaultKeys,
        events: &[LocalEventWrite],
    ) -> VaultResult<ProviderVaultName> {
        let copies = events
            .iter()
            .map(|event| LocalEventWrite {
                event_id: event.event_id.clone(),
                bytes: event.bytes.clone(),
            })
            .collect();
        let source = CheckedVaultSource::load(&vault.store_id, copies)?;
        let projection = source.projection();
        if !projection.security_conflicts.is_empty() {
            return Err(IdentityMergeError::VaultConflicted {
                store_id: vault.store_id.clone(),
            }
            .into());
        }
        if !matches!(
            &projection.epoch,
            ProjectionEpoch::Current(epoch) if epoch.as_event_id() == &vault.current_key_epoch
        ) {
            return Err(IdentityMergeError::VaultKeyEpochMismatch {
                store_id: vault.store_id.clone(),
            }
            .into());
        }
        source.name(&keys.secrets_key)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::errors::VaultError;
    use crate::{
        EventId, GenesisImportPayload, GenesisImportRequest, IdentityEvent,
        IdentityEventInsertStatus, IdentityEventSigning, IdentityGenesisRequest,
        IdentityMemberKeys, IsoTimestamp, MemberLabel, OpaqueCiphertext, SigningIdentity,
        VaultCrypto, VaultEvent, VaultEventBody, VaultEventSchemaVersion, VaultOperation,
    };
    use crate::{IdentityCreation, IdentityVaultKeyOpening, MemberLabelState};

    /// One installation: its app key and the signer of its events.
    struct Device {
        app_key: AppKey,
        signer: SigningIdentity,
    }

    impl Device {
        fn new() -> anyhow::Result<Self> {
            Ok(Self {
                app_key: AppKey::generate()?,
                signer: SigningIdentity::generate()?.0,
            })
        }

        fn keys(&self) -> IdentityMemberKeys {
            IdentityMemberKeys {
                app_id: self.app_key.app_id().clone(),
                encryption_public_key: self.app_key.public_key(),
                signing_public_key: self.signer.public_key(),
                label: MemberLabel::from_trusted(String::new()),
            }
        }
    }

    /// One identity's control log, founded by one device.
    struct Identity {
        log: IdentityControlLog,
    }

    impl Identity {
        fn at() -> anyhow::Result<IsoTimestamp> {
            Ok(IsoTimestamp::parse("2026-10-27T17:28:00Z")?)
        }

        fn founded_by(founder: &Device) -> anyhow::Result<Self> {
            let identity_id = IdentityId::generate()?;
            let at = Self::at()?;
            let genesis = IdentityEvent::genesis(IdentityGenesisRequest {
                identity_id: &identity_id,
                founder: founder.keys(),
                signing: IdentityEventSigning {
                    signing_key: founder.signer.signing_key(),
                    created_at: &at,
                },
            })?;
            Ok(Self {
                log: IdentityControlLog::new(identity_id).insert(genesis)?.log,
            })
        }

        fn id(&self) -> IdentityId {
            self.log.identity_id().clone()
        }

        fn state(&self) -> anyhow::Result<IdentityControlState> {
            Ok(IdentityControlState::project(&self.log)?)
        }

        /// Sign operations as one device and add the event to the log.
        fn append(
            &mut self,
            by: &Device,
            operations: Vec<IdentityControlOperation>,
        ) -> anyhow::Result<IdentityEventInsertStatus> {
            let at = Self::at()?;
            let event = self.log.build_append(
                operations,
                &IdentityEventSigning {
                    signing_key: by.signer.signing_key(),
                    created_at: &at,
                },
            )?;
            let inserted = self.log.clone().insert(event)?;
            self.log = inserted.log;
            Ok(inserted.status)
        }

        /// Admit another device: it asks to join and the founder approves it
        /// without handing it any vault key.
        fn admit(&mut self, founder: &Device, joiner: &Device) -> anyhow::Result<()> {
            let asked = self.append(
                joiner,
                vec![IdentityControlOperation::MemberJoinRequested {
                    member: joiner.keys(),
                }],
            )?;
            let approved = self.append(
                founder,
                vec![IdentityControlOperation::MemberApproved {
                    member: joiner.keys(),
                    vault_deks: Vec::new(),
                }],
            )?;
            anyhow::ensure!(asked == IdentityEventInsertStatus::Applied);
            anyhow::ensure!(approved == IdentityEventInsertStatus::Applied);
            Ok(())
        }

        /// Register a vault, wrapped to every current member.
        fn register(&mut self, by: &Device, vault: &Vault) -> anyhow::Result<()> {
            let operation =
                self.state()?
                    .vault_registration_operation(IdentityVaultRegistration {
                        dek: OpenedVaultDek {
                            store_id: &vault.store_id,
                            key_epoch: &vault.epoch,
                            keys: &vault.keys,
                        },
                    })?;
            let status = self.append(by, vec![operation])?;
            anyhow::ensure!(status == IdentityEventInsertStatus::Applied);
            Ok(())
        }

        /// The log as a source lists it.
        fn listed(&self) -> anyhow::Result<ProviderIdentityLogEvents> {
            Ok(ProviderIdentityLogEvents {
                identity_id: self.id(),
                events: self
                    .log
                    .storage_bytes()?
                    .into_iter()
                    .map(|(_, bytes)| bytes)
                    .collect(),
            })
        }
    }

    /// A Simple vault whose own log names it.
    struct Vault {
        store_id: StoreId,
        keys: VaultKeys,
        epoch: EventId,
        events: Vec<LocalEventWrite>,
        head: EventId,
    }

    impl Vault {
        fn epoch(digit: char) -> anyhow::Result<EventId> {
            Ok(EventId::from_sha256_hex(
                nook_auth2::Sha256Hex::from_trusted(digit.to_string().repeat(64)).as_str(),
            )?)
        }

        fn named(name: &str, author: &Device) -> anyhow::Result<Self> {
            let store_id = StoreId::generate()?;
            let epoch = Self::epoch('1')?;
            let genesis = VaultEvent::build_genesis_import_event(GenesisImportRequest {
                store_id: &store_id,
                actor_id: &author.signer.actor_id()?,
                key_epoch: &epoch,
                payload: GenesisImportPayload {
                    source_content_hash: nook_auth2::Sha256Hex::from_trusted("0".repeat(64)),
                    secrets: vec![],
                    password_entries: vec![],
                },
                created_at: &Identity::at()?,
                signing_key: author.signer.signing_key(),
            })?;
            let head = genesis.id()?;
            let mut vault = Self {
                events: vec![LocalEventWrite {
                    event_id: head.clone(),
                    bytes: VaultEvent::serialize_event_storage_yaml(&genesis)?,
                }],
                store_id,
                keys: VaultKeys::generate()?,
                epoch: epoch.clone(),
                head,
            };
            vault.rename(name, author, &epoch)?;
            Ok(vault)
        }

        /// Name the vault in its own log, under a key epoch.
        fn rename(&mut self, name: &str, author: &Device, epoch: &EventId) -> anyhow::Result<()> {
            let sealed = VaultCrypto::new(&self.keys.secrets_key)?.encrypt_value(name)?;
            let event = VaultEvent::sign(
                VaultEventBody {
                    schema_version: VaultEventSchemaVersion::CURRENT,
                    store_id: self.store_id.clone(),
                    actor_id: author.signer.actor_id()?,
                    actor_signing_public_key: author.signer.public_key(),
                    parents: vec![self.head.clone()],
                    created_at: Identity::at()?,
                    key_epoch: epoch.clone(),
                    operations: vec![VaultOperation::VaultNamed {
                        name: OpaqueCiphertext::from_trusted(sealed.as_str().to_owned()),
                    }],
                },
                author.signer.signing_key(),
            )?;
            self.head = event.id()?;
            self.events.push(LocalEventWrite {
                event_id: self.head.clone(),
                bytes: VaultEvent::serialize_event_storage_yaml(&event)?,
            });
            Ok(())
        }

        /// The vault as a source holds it, filed under one identity.
        fn held(&self, filed_under: &IdentityId) -> CheckedVaultEvents {
            CheckedVaultEvents {
                store_id: self.store_id.clone(),
                filed_under: filed_under.clone(),
                events: self
                    .events
                    .iter()
                    .map(|event| LocalEventWrite {
                        event_id: event.event_id.clone(),
                        bytes: event.bytes.clone(),
                    })
                    .collect(),
            }
        }
    }

    /// The identity in use on two devices, and another identity whose
    /// founder keeps the vaults "Family" and "Taxes".
    struct Scene {
        here: Device,
        phone: Device,
        current: Identity,
        elsewhere: Device,
        other: Identity,
        family: Vault,
        taxes: Vault,
        /// This browser's identities; empty unless a test fills it.
        directory: IdentityDirectory,
    }

    impl Scene {
        fn new() -> anyhow::Result<Self> {
            let here = Device::new()?;
            let phone = Device::new()?;
            let mut current = Identity::founded_by(&here)?;
            current.admit(&here, &phone)?;
            let elsewhere = Device::new()?;
            let mut other = Identity::founded_by(&elsewhere)?;
            let family = Vault::named("Family", &elsewhere)?;
            let taxes = Vault::named("Taxes", &elsewhere)?;
            other.register(&elsewhere, &family)?;
            other.register(&elsewhere, &taxes)?;
            Ok(Self {
                here,
                phone,
                current,
                elsewhere,
                other,
                family,
                taxes,
                directory: IdentityDirectory::empty(),
            })
        }

        fn merge(&self) -> VaultResult<IdentityMerge<'_>> {
            IdentityMergeDestination {
                log: &self.current.log,
                signer: self.here.app_key.app_id(),
                directory: &self.directory,
            }
            .merging(&self.other.id())
        }

        /// Both vaults, as the source files them under the other identity.
        fn held(&self) -> Vec<CheckedVaultEvents> {
            vec![
                self.family.held(&self.other.id()),
                self.taxes.held(&self.other.id()),
            ]
        }

        fn plan(
            &self,
            passkey: &AppKey,
            vaults: Vec<CheckedVaultEvents>,
        ) -> anyhow::Result<VaultResult<IdentityMergePlan>> {
            Ok(self.merge()?.plan(IdentityMergeProof {
                app_key: passkey,
                identity_logs: vec![self.current.listed()?, self.other.listed()?],
                vaults,
            }))
        }

        /// The reason a merge was refused.
        fn refusal(result: VaultResult<IdentityMergePlan>) -> anyhow::Result<IdentityMergeError> {
            match result {
                Ok(_) => anyhow::bail!("the merge must be refused"),
                Err(VaultError::IdentityMerge(error)) => Ok(error),
                Err(other) => anyhow::bail!("unexpected failure: {other}"),
            }
        }

        fn store_ids(vaults: &[MergedVault]) -> Vec<StoreId> {
            let mut ids = vaults
                .iter()
                .map(|vault| vault.store_id.clone())
                .collect::<Vec<_>>();
            ids.sort();
            ids
        }
    }

    #[test]
    fn merging_registers_every_vault_of_the_other_identity_in_the_current_log() -> anyhow::Result<()>
    {
        let mut scene = Scene::new()?;
        let plan = scene.plan(&scene.elsewhere.app_key, scene.held())??;

        let mut expected = vec![scene.family.store_id.clone(), scene.taxes.store_id.clone()];
        expected.sort();
        assert_eq!(Scene::store_ids(&plan.vaults), expected);
        assert!(plan.already_kept.is_empty());
        for merged in &plan.vaults {
            let (vault, name) = if merged.store_id == scene.family.store_id {
                (&scene.family, "Family")
            } else {
                (&scene.taxes, "Taxes")
            };
            assert_eq!(merged.name, ProviderVaultName::named(name));
            assert_eq!(
                merged
                    .events
                    .iter()
                    .map(|event| event.event_id.clone())
                    .collect::<Vec<_>>(),
                vault
                    .events
                    .iter()
                    .map(|event| event.event_id.clone())
                    .collect::<Vec<_>>()
            );
        }

        // The device in use signs the registrations into its own log, and
        // every member of the identity in use opens each vault's key.
        let here = &scene.here;
        let status = scene.current.append(here, plan.operations)?;
        assert_eq!(status, IdentityEventInsertStatus::Applied);
        let state = scene.current.state()?;
        for vault in [&scene.family, &scene.taxes] {
            let registered = state
                .vault(&vault.store_id)
                .ok_or_else(|| anyhow::anyhow!("the vault must be registered"))?;
            assert_eq!(registered.current_key_epoch, vault.epoch);
            for member in [&scene.here, &scene.phone] {
                let IdentityVaultDekLookup::Granted(dek) =
                    registered.current_dek_for(member.app_key.app_id())
                else {
                    anyhow::bail!("every current member holds the vault's key");
                };
                let secrets = member
                    .app_key
                    .decrypt_envelope(&dek.secrets_key_ciphertext)?;
                let members = member
                    .app_key
                    .decrypt_envelope(&dek.members_key_ciphertext)?;
                assert_eq!(secrets, vault.keys.secrets_key);
                assert_eq!(members, vault.keys.members_key);
            }
        }
        Ok(())
    }

    #[test]
    fn a_passkey_that_is_not_a_member_merges_nothing() -> anyhow::Result<()> {
        let scene = Scene::new()?;
        let stranger = AppKey::generate()?;

        let refused = Scene::refusal(scene.plan(&stranger, scene.held())?)?;
        assert!(matches!(
            refused,
            IdentityMergeError::PasskeyNotMember { identity_id } if identity_id == scene.other.id()
        ));

        // A source without the other identity's log proves nothing either.
        let without_log = scene.merge()?.plan(IdentityMergeProof {
            app_key: &scene.elsewhere.app_key,
            identity_logs: vec![scene.current.listed()?],
            vaults: scene.held(),
        });
        assert!(matches!(
            Scene::refusal(without_log)?,
            IdentityMergeError::IdentityNotHeld { .. }
        ));
        Ok(())
    }

    #[test]
    fn merging_never_writes_the_other_identity_s_log() -> anyhow::Result<()> {
        let mut scene = Scene::new()?;
        let before = scene.other.listed()?.events;
        let plan = scene.plan(&scene.elsewhere.app_key, scene.held())??;

        // Every operation registers a vault for the members of the identity
        // in use only; none reaches the other identity's devices.
        let mut current_members = vec![scene.here.app_key.app_id(), scene.phone.app_key.app_id()];
        current_members.sort();
        assert_eq!(plan.operations.len(), 2);
        for operation in &plan.operations {
            let IdentityControlOperation::VaultRegistered { recipients, .. } = operation else {
                anyhow::bail!("a merge only registers vaults");
            };
            let mut wrapped = recipients.iter().map(|dek| &dek.app_id).collect::<Vec<_>>();
            wrapped.sort();
            assert_eq!(wrapped, current_members);
        }
        let here = &scene.here;
        scene.current.append(here, plan.operations)?;

        // The other identity's log is as it was, and its founder still opens
        // both vaults through it.
        assert_eq!(scene.other.listed()?.events, before);
        let other = scene.other.state()?;
        for vault in [&scene.family, &scene.taxes] {
            let kept = other
                .vault(&vault.store_id)
                .ok_or_else(|| anyhow::anyhow!("the other identity keeps the vault"))?;
            assert!(matches!(
                kept.current_dek_for(scene.elsewhere.app_key.app_id()),
                IdentityVaultDekLookup::Granted(_)
            ));
        }
        Ok(())
    }

    #[test]
    fn an_identity_never_merges_into_itself_or_without_a_signing_member() -> anyhow::Result<()> {
        let scene = Scene::new()?;
        let into_itself = IdentityMergeDestination {
            log: &scene.current.log,
            signer: scene.here.app_key.app_id(),
            directory: &scene.directory,
        }
        .merging(&scene.current.id());
        assert!(matches!(
            into_itself,
            Err(VaultError::IdentityMerge(IdentityMergeError::IntoItself))
        ));

        let stranger = AppKey::generate()?;
        let unsigned = IdentityMergeDestination {
            log: &scene.current.log,
            signer: stranger.app_id(),
            directory: &scene.directory,
        }
        .merging(&scene.other.id());
        assert!(matches!(
            unsigned,
            Err(VaultError::IdentityMerge(
                IdentityMergeError::SignerNotMember
            ))
        ));

        let empty = IdentityControlLog::new(scene.current.id());
        let unreplicated = IdentityMergeDestination {
            log: &empty,
            signer: scene.here.app_key.app_id(),
            directory: &scene.directory,
        }
        .merging(&scene.other.id());
        assert!(matches!(
            unreplicated,
            Err(VaultError::IdentityMerge(
                IdentityMergeError::DestinationNotReplicated
            ))
        ));
        Ok(())
    }

    #[test]
    fn a_vault_that_cannot_be_proven_fails_the_whole_merge() -> anyhow::Result<()> {
        let mut scene = Scene::new()?;

        // Its events are missing from the source.
        let missing = Scene::refusal(scene.plan(
            &scene.elsewhere.app_key,
            vec![scene.family.held(&scene.other.id())],
        )?)?;
        assert!(matches!(
            missing,
            IdentityMergeError::VaultEventsNotHeld { store_id } if store_id == scene.taxes.store_id
        ));

        // The source files it under two identities.
        let mut twice = scene.held();
        twice.push(scene.taxes.held(&scene.current.id()));
        assert!(matches!(
            Scene::refusal(scene.plan(&scene.elsewhere.app_key, twice)?)?,
            IdentityMergeError::VaultFiledTwice { .. }
        ));

        // Its own log moved to a key epoch the identity has not granted.
        let elsewhere = &scene.elsewhere;
        scene
            .taxes
            .rename("Taxes 2026", elsewhere, &Vault::epoch('2')?)?;
        assert!(matches!(
            Scene::refusal(scene.plan(&scene.elsewhere.app_key, scene.held())?)?,
            IdentityMergeError::VaultKeyEpochMismatch { store_id } if store_id == scene.taxes.store_id
        ));
        Ok(())
    }

    #[test]
    fn a_member_without_a_vault_s_key_merges_nothing() -> anyhow::Result<()> {
        let mut scene = Scene::new()?;
        let late = Device::new()?;
        let elsewhere = &scene.elsewhere;
        scene.other.admit(elsewhere, &late)?;

        let refused = Scene::refusal(scene.plan(&late.app_key, scene.held())?)?;
        assert!(matches!(
            refused,
            IdentityMergeError::VaultKeyNotGranted { .. }
        ));
        Ok(())
    }

    #[test]
    fn a_vault_the_identity_in_use_already_keeps_is_not_registered_again() -> anyhow::Result<()> {
        let mut scene = Scene::new()?;
        let here = &scene.here;
        scene.current.register(here, &scene.family)?;

        let plan = scene.plan(&scene.elsewhere.app_key, scene.held())??;
        assert_eq!(plan.already_kept, [scene.family.store_id.clone()]);
        assert_eq!(
            Scene::store_ids(&plan.vaults),
            [scene.taxes.store_id.clone()]
        );
        assert_eq!(plan.operations.len(), 1);
        Ok(())
    }

    #[test]
    fn a_vault_another_identity_on_this_browser_keeps_merges_nothing() -> anyhow::Result<()> {
        let mut scene = Scene::new()?;
        let work = AppKey::generate()?;
        let created = IdentityDirectory::empty().create_identity(IdentityCreation {
            label: "Work",
            app_key: &work,
            member_label: MemberLabelState::Unnamed,
        })?;
        scene.directory = created
            .directory
            .open_or_generate_vault_dek(IdentityVaultKeyOpening {
                app_key: &work,
                store_id: scene.taxes.store_id.clone(),
            })?
            .directory;

        let refused = Scene::refusal(scene.plan(&scene.elsewhere.app_key, scene.held())?)?;
        assert!(matches!(
            refused,
            IdentityMergeError::VaultKeptByAnotherLocalIdentity { store_id, identity_id }
                if store_id == scene.taxes.store_id && identity_id == created.identity_id
        ));
        Ok(())
    }
}

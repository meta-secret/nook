//! Add an identity a sync provider holds to this browser, proven by its
//! passkey.
//!
//! A checked passkey re-derives one app key. The identity is added only when
//! that key is an active member of the identity's control log at the source.
//! The directory then gains the identity under its original id, beside the
//! identities already here, with the members the log lists and the key's
//! grant for each vault at its current key epoch. The identity in use stays
//! selected. A key that is not a member, was revoked, or already belongs to
//! an identity here adds nothing.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use crate::errors::VaultResult;
use crate::{
    AppKey, DeviceSigningPublicKey, IdentityControlLog, IdentityControlState, IdentityDirectory,
    IdentityDirectoryRejection, IdentityId, IdentitySelection, MultiDeviceError,
    ProviderIdentityLogEvents, ReplicatedIdentityAddition, ReplicatedIdentityMembership,
    ReplicatedIdentityStanding, ReplicatedMembershipRequest, StoreId,
};

/// A checked passkey's app key, one identity a source holds, and this
/// browser's directory.
pub struct PasskeyIdentityAddition<'a> {
    pub app_key: &'a AppKey,
    pub identity_id: &'a IdentityId,
    /// The source's identity logs; only the named identity's is read.
    pub identity_logs: &'a [ProviderIdentityLogEvents],
    pub directory: &'a IdentityDirectory,
    /// The identity's name on this browser while its log carries none.
    pub label: &'a str,
}

/// Which identity is in use once the identity is added.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AddedIdentitySelection {
    /// No identity was in use, so the added one is.
    InUse,
    /// The identity in use stays selected; the user switches in Identities.
    BesideIdentityInUse,
}

/// What adding the identity changes on this browser.
#[derive(Debug)]
pub struct PasskeyIdentityAdded {
    /// The identity's control log as the source holds it, verified.
    pub log: IdentityControlLog,
    /// This browser's directory with the identity added.
    pub directory: IdentityDirectory,
    /// The identity's vaults whose current key the passkey's app key opens.
    pub vaults: Vec<StoreId>,
    pub selection: AddedIdentitySelection,
    /// The event signer the log lists for the passkey's member. A passkey
    /// re-derives the member's app key, not this signer.
    pub member_signer: DeviceSigningPublicKey,
}

impl PasskeyIdentityAddition<'_> {
    /// Decide the addition. The directory passed in is never changed; a
    /// refusal leaves nothing to write.
    pub fn add(&self) -> VaultResult<PasskeyIdentityAdded> {
        let not_found = || MultiDeviceError::IdentityNotFound {
            identity_id: self.identity_id.to_string(),
        };
        let listed = self
            .identity_logs
            .iter()
            .find(|listed| &listed.identity_id == self.identity_id)
            .filter(|listed| !listed.events.is_empty())
            .ok_or_else(not_found)?;
        let log = IdentityControlLog::new(self.identity_id.clone())
            .union_storage_bytes(&listed.events)
            .map_err(|rejection| rejection.cause)?;
        let state = IdentityControlState::project(&log)?;
        let app_id = self.app_key.app_id();
        let member = match ReplicatedIdentityStanding::of(&state, app_id) {
            ReplicatedIdentityStanding::ActiveMember => state.member(app_id).ok_or_else(not_found),
            ReplicatedIdentityStanding::Revoked => {
                Err(MultiDeviceError::AppKeyRevokedFromIdentity {
                    identity_id: self.identity_id.to_string(),
                })
            }
            ReplicatedIdentityStanding::PendingJoin | ReplicatedIdentityStanding::NotListed => {
                Err(MultiDeviceError::AppKeyNotIdentityMember {
                    identity_id: self.identity_id.to_string(),
                })
            }
        }?;
        let member_signer = member.keys.signing_public_key.clone();
        let name = match state.sealed_name_for(app_id) {
            Some(sealed) => self.app_key.open_utf8(sealed)?,
            None => String::new(),
        };
        let label = match name.trim() {
            "" => self.label,
            named => named,
        };
        let projection = ReplicatedMembershipRequest {
            state: &state,
            app_key: self.app_key,
        }
        .project()?;
        let vaults = projection
            .own_grants
            .iter()
            .map(|grant| grant.store_id.clone())
            .collect();
        let directory = self
            .directory
            .clone()
            .add_replicated_identity(&ReplicatedIdentityAddition {
                label,
                membership: ReplicatedIdentityMembership {
                    identity_id: self.identity_id,
                    app_key: self.app_key,
                    members: projection.members,
                    revoked: projection.revoked,
                    own_grants: projection.own_grants,
                    removed_vaults: projection.removed_vaults,
                },
            })
            .map_err(IdentityDirectoryRejection::into_cause)?;
        let selection = match self.directory.selection() {
            IdentitySelection::Empty => AddedIdentitySelection::InUse,
            IdentitySelection::Selected(_) => AddedIdentitySelection::BesideIdentityInUse,
        };
        Ok(PasskeyIdentityAdded {
            log,
            directory,
            vaults,
            selection,
            member_signer,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::errors::VaultError;
    use crate::{
        EventId, IdentityCreation, IdentityEvent, IdentityEventSigning, IdentityGenesisRequest,
        IdentityMemberKeys, IdentityNaming, IdentityVaultKeyOpening, IdentityVaultRegistration,
        IsoTimestamp, MemberLabel, MemberLabelState, OpenedVaultDek, SigningIdentity, VaultKeys,
    };

    /// An identity named "Family" on a provider, founded by a laptop whose
    /// passkey is checked, with one registered vault.
    struct ProviderIdentity {
        laptop: AppKey,
        signer: DeviceSigningPublicKey,
        identity_id: IdentityId,
        store_id: StoreId,
        keys: VaultKeys,
        identity_logs: Vec<ProviderIdentityLogEvents>,
    }

    impl ProviderIdentity {
        fn new() -> anyhow::Result<Self> {
            let laptop = AppKey::generate()?;
            let signer = SigningIdentity::generate()?.0;
            let at = IsoTimestamp::parse("2026-10-27T17:28:00Z")?;
            let signing = IdentityEventSigning {
                signing_key: signer.signing_key(),
                created_at: &at,
            };
            let identity_id = IdentityId::generate()?;
            let store_id = StoreId::generate()?;
            let keys = VaultKeys::generate()?;
            let epoch = EventId::from_sha256_hex(
                nook_auth2::Sha256Hex::from_trusted("1".repeat(64)).as_str(),
            )?;
            let log = IdentityControlLog::new(identity_id.clone())
                .insert(IdentityEvent::genesis(IdentityGenesisRequest {
                    identity_id: &identity_id,
                    founder: IdentityMemberKeys {
                        app_id: laptop.app_id().clone(),
                        encryption_public_key: laptop.public_key(),
                        signing_public_key: signer.public_key(),
                        label: MemberLabel::from_trusted("Laptop".to_owned()),
                    },
                    signing: IdentityEventSigning {
                        signing_key: signer.signing_key(),
                        created_at: &at,
                    },
                })?)?
                .log;
            let state = IdentityControlState::project(&log)?;
            let operations = vec![
                state.vault_registration_operation(IdentityVaultRegistration {
                    dek: OpenedVaultDek {
                        store_id: &store_id,
                        key_epoch: &epoch,
                        keys: &keys,
                    },
                })?,
                state.naming_operation(&IdentityNaming {
                    name: "Family",
                    joining: None,
                })?,
            ];
            let log = log
                .clone()
                .insert(log.build_append(operations, &signing)?)?
                .log;
            Ok(Self {
                signer: signer.public_key(),
                identity_logs: vec![ProviderIdentityLogEvents {
                    identity_id: identity_id.clone(),
                    events: log
                        .storage_bytes()?
                        .into_iter()
                        .map(|(_, bytes)| bytes)
                        .collect(),
                }],
                laptop,
                identity_id,
                store_id,
                keys,
            })
        }

        fn add_to(
            &self,
            directory: &IdentityDirectory,
            app_key: &AppKey,
        ) -> VaultResult<PasskeyIdentityAdded> {
            PasskeyIdentityAddition {
                app_key,
                identity_id: &self.identity_id,
                identity_logs: &self.identity_logs,
                directory,
                label: "Unnamed identity",
            }
            .add()
        }
    }

    /// This browser with the "Personal" identity in use.
    fn browser_with_personal() -> anyhow::Result<(IdentityDirectory, IdentityId)> {
        let created = IdentityDirectory::empty().create_identity(IdentityCreation {
            label: "Personal",
            app_key: &AppKey::generate()?,
            member_label: MemberLabelState::Unnamed,
        })?;
        Ok((created.directory, created.identity_id))
    }

    #[test]
    fn a_member_passkey_adds_its_identity_beside_the_one_in_use_under_its_original_id()
    -> anyhow::Result<()> {
        let family = ProviderIdentity::new()?;
        let (browser, personal) = browser_with_personal()?;

        let added = family.add_to(&browser, &family.laptop)?;

        assert_eq!(added.selection, AddedIdentitySelection::BesideIdentityInUse);
        assert_eq!(added.directory.selected()?.identity_id, personal);
        let record = added
            .directory
            .identities()
            .iter()
            .find(|record| record.identity_id == family.identity_id)
            .ok_or_else(|| anyhow::anyhow!("the identity keeps its original id"))?;
        assert_eq!(record.label, "Family");
        let [vault] = added.vaults.as_slice() else {
            anyhow::bail!("the identity keeps one vault");
        };
        assert_eq!(vault, &family.store_id);
        assert_eq!(
            added.directory.open_vault_dek(IdentityVaultKeyOpening {
                app_key: &family.laptop,
                store_id: family.store_id.clone(),
            })?,
            family.keys
        );
        assert_eq!(added.member_signer, family.signer);
        assert!(!added.log.is_empty());
        Ok(())
    }

    #[test]
    fn a_passkey_that_is_not_a_member_adds_nothing() -> anyhow::Result<()> {
        let family = ProviderIdentity::new()?;
        let (browser, _) = browser_with_personal()?;
        let before = browser.clone();

        let refused = family.add_to(&browser, &AppKey::generate()?);

        assert!(matches!(
            refused,
            Err(VaultError::MultiDevice(MultiDeviceError::AppKeyNotIdentityMember { identity_id }))
                if identity_id == family.identity_id.to_string()
        ));
        let elsewhere = PasskeyIdentityAddition {
            app_key: &family.laptop,
            identity_id: &IdentityId::generate()?,
            identity_logs: &family.identity_logs,
            directory: &browser,
            label: "Unnamed identity",
        }
        .add();
        assert!(matches!(
            elsewhere,
            Err(VaultError::MultiDevice(
                MultiDeviceError::IdentityNotFound { .. }
            ))
        ));
        assert_eq!(browser, before);
        Ok(())
    }

    #[test]
    fn the_identity_added_to_an_empty_browser_is_the_one_in_use() -> anyhow::Result<()> {
        let family = ProviderIdentity::new()?;

        let added = family.add_to(&IdentityDirectory::empty(), &family.laptop)?;

        assert_eq!(added.selection, AddedIdentitySelection::InUse);
        assert_eq!(added.directory.selected()?.identity_id, family.identity_id);
        Ok(())
    }

    #[test]
    fn an_identity_already_on_this_browser_is_not_added_again() -> anyhow::Result<()> {
        let family = ProviderIdentity::new()?;
        let (browser, _) = browser_with_personal()?;
        let added = family.add_to(&browser, &family.laptop)?;

        let again = family.add_to(&added.directory, &family.laptop);

        assert!(matches!(
            again,
            Err(VaultError::MultiDevice(
                MultiDeviceError::ReplicatedIdentityAlreadyLocal { .. }
            ))
        ));
        Ok(())
    }
}

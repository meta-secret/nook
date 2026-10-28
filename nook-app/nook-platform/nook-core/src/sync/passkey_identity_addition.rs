//! Add an identity a sync provider holds to this browser, proven by its
//! passkey.
//!
//! A checked passkey re-derives one app key and its member's event signer.
//! The identity is added only when that key is an active member of the
//! identity's control log at the source and the log lists that very signer
//! for it. The directory then gains the identity under its original id,
//! beside the identities already here, with the members the log lists and
//! the key's grant for each vault at its current key epoch. The identity in
//! use stays selected. Anything else adds nothing.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use serde::{Deserialize, Serialize};
use tsify::Tsify;

use crate::errors::VaultResult;
use crate::{
    AppKey, IdentityControlLog, IdentityControlState, IdentityDirectory,
    IdentityDirectoryRejection, IdentityId, IdentitySelection, IdentityWords, MultiDeviceError,
    ProviderIdentityLogEvents, ReplicatedIdentityAddition, ReplicatedIdentityMembership,
    ReplicatedIdentityStanding, ReplicatedMembershipRequest, SigningIdentity, SigningSeedHex,
    StoreId,
};

/// A checked passkey's app key and signer, one identity a source holds, and
/// this browser's directory.
pub struct PasskeyIdentityAddition<'a> {
    pub app_key: &'a AppKey,
    /// The member's event signer, derived from the same passkey.
    pub signer: &'a SigningSeedHex,
    pub identity_id: &'a IdentityId,
    /// The source's identity logs; only the named identity's is read.
    pub identity_logs: &'a [ProviderIdentityLogEvents],
    pub directory: &'a IdentityDirectory,
}

/// Which identity is in use once the identity is added.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
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
        // A member whose signer the passkey does not derive could not sign
        // here, so it is not added.
        let signer = SigningIdentity::from_seed_hex_stored(self.signer.as_str())?.public_key();
        if member.keys.signing_public_key != signer {
            return Err(MultiDeviceError::PasskeySignerNotListed {
                identity_id: self.identity_id.to_string(),
            }
            .into());
        }
        let name = match state.sealed_name_for(app_id) {
            Some(sealed) => self.app_key.open_utf8(sealed)?.trim().to_owned(),
            None => String::new(),
        };
        let label = if name.is_empty() {
            IdentityWords::of(self.identity_id).words().join(" ")
        } else {
            name
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
                label: &label,
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
        IsoTimestamp, MemberLabel, MemberLabelState, OpenedVaultDek, PasskeyDeviceProtectionMode,
        PasskeyMemberSigner, PasskeyRegistration, PasskeyRegistrationInput, VaultKeys,
        WebAuthnCredentialId, WebAuthnPrfInput, WebAuthnPrfOutput, WebAuthnUserHandle,
    };

    /// The laptop's passkey: its app key and the signer it derives.
    struct LaptopPasskey {
        app_key: AppKey,
        signer: SigningSeedHex,
    }

    impl LaptopPasskey {
        fn new() -> anyhow::Result<Self> {
            let material = PasskeyRegistration::new(PasskeyRegistrationInput {
                credential_id: &WebAuthnCredentialId::try_from(vec![7; 48])?,
                user_handle: &WebAuthnUserHandle::try_from(vec![8; 32])?,
                prf_input: &WebAuthnPrfInput::deterministic(),
                mode: PasskeyDeviceProtectionMode::Standard,
            })
            .complete(&WebAuthnPrfOutput::try_from(vec![10; 32])?)?;
            let PasskeyMemberSigner::Derived(signer) = material.signer().clone() else {
                anyhow::bail!("a passkey-derived app key derives its signer");
            };
            Ok(Self {
                app_key: AppKey::from_secret_str(material.identity_secret())?,
                signer,
            })
        }
    }

    /// How the provider's identity was founded by the laptop.
    struct Founding<'a> {
        /// The seed the founder signed with.
        signer: &'a SigningSeedHex,
        name: Option<&'a str>,
    }

    /// An identity on a provider, founded by the laptop, with one vault.
    struct ProviderIdentity {
        identity_id: IdentityId,
        store_id: StoreId,
        keys: VaultKeys,
        identity_logs: Vec<ProviderIdentityLogEvents>,
    }

    impl ProviderIdentity {
        fn new(laptop: &LaptopPasskey, founding: &Founding<'_>) -> anyhow::Result<Self> {
            let signer = SigningIdentity::from_seed_hex_stored(founding.signer.as_str())?;
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
                        app_id: laptop.app_key.app_id().clone(),
                        encryption_public_key: laptop.app_key.public_key(),
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
            let mut operations =
                vec![
                    state.vault_registration_operation(IdentityVaultRegistration {
                        dek: OpenedVaultDek {
                            store_id: &store_id,
                            key_epoch: &epoch,
                            keys: &keys,
                        },
                    })?,
                ];
            if let Some(name) = founding.name {
                operations.push(state.naming_operation(&IdentityNaming {
                    name,
                    joining: None,
                })?);
            }
            let log = log
                .clone()
                .insert(log.build_append(operations, &signing)?)?
                .log;
            Ok(Self {
                identity_logs: vec![ProviderIdentityLogEvents {
                    identity_id: identity_id.clone(),
                    events: log
                        .storage_bytes()?
                        .into_iter()
                        .map(|(_, bytes)| bytes)
                        .collect(),
                }],
                identity_id,
                store_id,
                keys,
            })
        }

        fn add_to(
            &self,
            directory: &IdentityDirectory,
            passkey: &LaptopPasskey,
        ) -> VaultResult<PasskeyIdentityAdded> {
            PasskeyIdentityAddition {
                app_key: &passkey.app_key,
                signer: &passkey.signer,
                identity_id: &self.identity_id,
                identity_logs: &self.identity_logs,
                directory,
            }
            .add()
        }
    }

    /// The laptop's identity named "Family", founded with its passkey signer.
    fn family(laptop: &LaptopPasskey) -> anyhow::Result<ProviderIdentity> {
        ProviderIdentity::new(
            laptop,
            &Founding {
                signer: &laptop.signer,
                name: Some("Family"),
            },
        )
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
        let laptop = LaptopPasskey::new()?;
        let family = family(&laptop)?;
        let (browser, personal) = browser_with_personal()?;

        let added = family.add_to(&browser, &laptop)?;

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
                app_key: &laptop.app_key,
                store_id: family.store_id.clone(),
            })?,
            family.keys
        );
        assert!(!added.log.is_empty());
        Ok(())
    }

    #[test]
    fn a_passkey_that_is_not_a_member_adds_nothing() -> anyhow::Result<()> {
        let family = family(&LaptopPasskey::new()?)?;
        let (browser, _) = browser_with_personal()?;
        let before = browser.clone();
        let stranger = LaptopPasskey {
            app_key: AppKey::generate()?,
            signer: SigningIdentity::generate()?.1,
        };

        let refused = family.add_to(&browser, &stranger);

        assert!(matches!(
            refused,
            Err(VaultError::MultiDevice(MultiDeviceError::AppKeyNotIdentityMember { identity_id }))
                if identity_id == family.identity_id.to_string()
        ));
        let elsewhere = ProviderIdentity {
            identity_id: IdentityId::generate()?,
            store_id: family.store_id.clone(),
            keys: family.keys.clone(),
            identity_logs: family.identity_logs.clone(),
        }
        .add_to(&browser, &LaptopPasskey::new()?);
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
    fn a_member_whose_listed_signer_was_not_passkey_derived_cannot_be_added() -> anyhow::Result<()>
    {
        let laptop = LaptopPasskey::new()?;
        let installation_signer = SigningIdentity::generate()?.1;
        let earlier = ProviderIdentity::new(
            &laptop,
            &Founding {
                signer: &installation_signer,
                name: Some("Family"),
            },
        )?;
        let (browser, _) = browser_with_personal()?;

        let refused = earlier.add_to(&browser, &laptop);

        assert!(matches!(
            refused,
            Err(VaultError::MultiDevice(
                MultiDeviceError::PasskeySignerNotListed { .. }
            ))
        ));
        Ok(())
    }

    #[test]
    fn the_identity_added_to_an_empty_browser_is_the_one_in_use_and_named_by_its_words()
    -> anyhow::Result<()> {
        let laptop = LaptopPasskey::new()?;
        let unnamed = ProviderIdentity::new(
            &laptop,
            &Founding {
                signer: &laptop.signer,
                name: None,
            },
        )?;

        let added = unnamed.add_to(&IdentityDirectory::empty(), &laptop)?;

        assert_eq!(added.selection, AddedIdentitySelection::InUse);
        let selected = added.directory.selected()?;
        assert_eq!(selected.identity_id, unnamed.identity_id);
        assert_eq!(
            selected.label,
            IdentityWords::of(&unnamed.identity_id).words().join(" ")
        );
        Ok(())
    }

    #[test]
    fn an_identity_already_on_this_browser_is_not_added_again() -> anyhow::Result<()> {
        let laptop = LaptopPasskey::new()?;
        let family = family(&laptop)?;
        let (browser, _) = browser_with_personal()?;
        let added = family.add_to(&browser, &laptop)?;

        let again = family.add_to(&added.directory, &laptop);

        assert!(matches!(
            again,
            Err(VaultError::MultiDevice(
                MultiDeviceError::ReplicatedIdentityAlreadyLocal { .. }
            ))
        ));
        Ok(())
    }
}

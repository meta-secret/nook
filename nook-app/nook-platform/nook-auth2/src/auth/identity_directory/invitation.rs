//! Which local app key joins an invited identity.
//!
//! The directory binds one app key to one local identity. A local identity
//! that has no vaults, no other members and no replicated log yet is still
//! fresh: it can take the invited identity's id. Once its identity is
//! replicated, joining a second identity needs a second app key, as a second
//! identity on the web app has its own key. A key that only holds vaults
//! paired one by one, with no identity log, keeps pairing vaults that way.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use super::{AppKeyIdentityMembership, IdentityDirectory};
use crate::errors::{MultiDeviceError, MultiDeviceResult};
use crate::{AppKey, IdentityId, IdentityRecord};

/// Whether the local identity already has a replicated control log.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LocalIdentityLog {
    Empty,
    Replicated,
}

/// An app key and the identity an invite asks it to join.
pub struct IdentityInvitationBindingRequest<'a> {
    pub app_key: &'a AppKey,
    pub invited: &'a IdentityId,
    /// The control log of the app key's current local identity.
    pub local_log: LocalIdentityLog,
}

/// What joining the invited identity does to the local directory.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IdentityInvitationBinding {
    /// The app key's local identity already is the invited identity.
    AlreadyBound,
    /// The app key's fresh local identity takes the invited identity's id.
    Adopt { local_identity_id: IdentityId },
}

/// Which app key connects this installation to one more identity.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdentityConnectionKey {
    /// The app key belongs to no replicated identity yet; it connects the
    /// next vault or identity itself.
    CurrentAppKey,
    /// The app key belongs to a replicated identity; the next identity needs
    /// its own app key.
    NewAppKey,
}

/// An app key and its local identity's log, to choose the connection key.
pub struct IdentityConnectionKeyRequest<'a> {
    pub app_key: &'a AppKey,
    pub local_log: LocalIdentityLog,
}

/// A name for the app key's local identity, given while it is still fresh.
pub struct FreshIdentityNaming<'a> {
    pub app_key: &'a AppKey,
    /// Already trimmed and checked by the caller.
    pub label: &'a str,
    /// The control log of the app key's current local identity.
    pub local_log: LocalIdentityLog,
}

/// How a name given during setup reaches the identity.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FreshIdentityNamed {
    /// The app key's local identity took the name now.
    Renamed(IdentityDirectory),
    /// The app key has no local identity yet, as a key the browser extension
    /// lends: the first vault's genesis creates it under the vault's name,
    /// which setup gives the same name. The directory is unchanged.
    AtFirstVault(IdentityDirectory),
}

impl IdentityRecord {
    /// Nothing ties this local identity to an identity yet, so its key can
    /// still take an approved identity's id. A provider listing asks the same
    /// question before it offers to finish a join.
    #[must_use]
    pub fn is_fresh_local_identity(&self, local_log: LocalIdentityLog) -> bool {
        local_log == LocalIdentityLog::Empty
            && self.vault_deks.is_empty()
            && self.members.len() == 1
    }
}

impl IdentityDirectory {
    fn local_identity_for_app_key(&self, app_key: &AppKey) -> MultiDeviceResult<&IdentityRecord> {
        let AppKeyIdentityMembership::Enrolled(identity_id) = self.identity_for_app_key(app_key)?
        else {
            return Err(MultiDeviceError::IdentityEnrollmentRequired);
        };
        self.identities
            .iter()
            .find(|record| record.identity_id == identity_id)
            .ok_or_else(|| MultiDeviceError::IdentityNotFound {
                identity_id: identity_id.to_string(),
            })
    }

    /// Decide how an app key joins the identity an invite names. The app key
    /// must already have a local identity; another identity it belongs to, or
    /// an invited identity another local app key already holds, refuses the
    /// join instead of merging identities.
    pub fn invitation_binding(
        &self,
        request: &IdentityInvitationBindingRequest<'_>,
    ) -> MultiDeviceResult<IdentityInvitationBinding> {
        let local = self.local_identity_for_app_key(request.app_key)?;
        if &local.identity_id == request.invited {
            return Ok(IdentityInvitationBinding::AlreadyBound);
        }
        if self
            .identities
            .iter()
            .any(|record| &record.identity_id == request.invited)
        {
            return Err(MultiDeviceError::ReplicatedIdentityAlreadyLocal {
                identity_id: request.invited.to_string(),
            });
        }
        if !local.is_fresh_local_identity(request.local_log) {
            return Err(MultiDeviceError::AppKeyBelongsToAnotherIdentity {
                identity_id: local.identity_id.to_string(),
            });
        }
        Ok(IdentityInvitationBinding::Adopt {
            local_identity_id: local.identity_id.clone(),
        })
    }

    /// Name the app key's local identity while nothing ties it to an identity
    /// yet, so its log seals that name when it is created. An identity with a
    /// log, a vault, or another member keeps the name it has. A key with no
    /// local identity yet is named by its first vault.
    pub fn name_fresh_identity(
        self,
        request: &FreshIdentityNaming<'_>,
    ) -> MultiDeviceResult<FreshIdentityNamed> {
        if request.label.trim().is_empty() {
            return Err(MultiDeviceError::IdentityLabelEmpty);
        }
        if self.identity_for_app_key(request.app_key)? == AppKeyIdentityMembership::Unenrolled {
            return Ok(FreshIdentityNamed::AtFirstVault(self));
        }
        let local = self.local_identity_for_app_key(request.app_key)?;
        if !local.is_fresh_local_identity(request.local_log) {
            return Err(MultiDeviceError::IdentityAlreadyInUse {
                identity_id: local.identity_id.to_string(),
            });
        }
        let identity_id = local.identity_id.clone();
        let mut named = self;
        for record in &mut named.identities {
            if record.identity_id == identity_id {
                request.label.clone_into(&mut record.label);
            }
        }
        Ok(FreshIdentityNamed::Renamed(named))
    }

    /// Choose the app key that connects this installation to one more
    /// identity. An app key with no local identity yet joins with its first.
    pub fn connection_key(
        &self,
        request: &IdentityConnectionKeyRequest<'_>,
    ) -> MultiDeviceResult<IdentityConnectionKey> {
        if self.identity_for_app_key(request.app_key)? == AppKeyIdentityMembership::Unenrolled {
            return Ok(IdentityConnectionKey::CurrentAppKey);
        }
        Ok(match request.local_log {
            LocalIdentityLog::Empty => IdentityConnectionKey::CurrentAppKey,
            LocalIdentityLog::Replicated => IdentityConnectionKey::NewAppKey,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        DeviceSigningPublicKey, IdentityCreation, IdentityMember, MemberLabelState,
        ReplicatedIdentityMembership, ReplicatedVaultGrant, StoreId, VaultKeys,
    };

    /// A browser with one local identity per app key it protects.
    struct Installation {
        directory: IdentityDirectory,
    }

    impl Installation {
        fn new() -> Self {
            Self {
                directory: IdentityDirectory::empty(),
            }
        }

        fn protect(mut self, app_key: &AppKey) -> anyhow::Result<(Self, IdentityId)> {
            let created = self.directory.create_identity(IdentityCreation {
                label: "Extension",
                app_key,
                member_label: MemberLabelState::Unnamed,
            })?;
            self.directory = created.directory;
            Ok((self, created.identity_id))
        }

        /// The identity log made the app key a member with a vault grant.
        fn join_with_vault(
            mut self,
            app_key: &AppKey,
            identity_id: &IdentityId,
        ) -> anyhow::Result<Self> {
            let other = AppKey::generate()?;
            let keys = VaultKeys::generate()?;
            let grant = ReplicatedVaultGrant {
                store_id: StoreId::generate()?,
                secrets_envelope: app_key
                    .public_key()
                    .seal_bytes(keys.secrets_key.as_str().as_bytes())?,
                members_envelope: app_key
                    .public_key()
                    .seal_bytes(keys.members_key.as_str().as_bytes())?,
            };
            self.directory =
                self.directory
                    .apply_replicated_membership(&ReplicatedIdentityMembership {
                        identity_id,
                        app_key,
                        members: vec![Self::member(app_key), Self::member(&other)],
                        revoked: Vec::new(),
                        own_grants: vec![grant],
                        removed_vaults: Vec::new(),
                    })?;
            Ok(self)
        }

        fn member(app_key: &AppKey) -> IdentityMember {
            IdentityMember {
                app_id: app_key.app_id().clone(),
                auth_id: app_key.auth_id(),
                public_key: app_key.public_key(),
                signing_public_key: DeviceSigningPublicKey::Unavailable,
                label: MemberLabelState::Unnamed,
            }
        }
    }

    fn binding(
        directory: &IdentityDirectory,
        app_key: &AppKey,
        invited: &IdentityId,
        local_log: LocalIdentityLog,
    ) -> MultiDeviceResult<IdentityInvitationBinding> {
        directory.invitation_binding(&IdentityInvitationBindingRequest {
            app_key,
            invited,
            local_log,
        })
    }

    fn connection(
        directory: &IdentityDirectory,
        app_key: &AppKey,
        local_log: LocalIdentityLog,
    ) -> MultiDeviceResult<IdentityConnectionKey> {
        directory.connection_key(&IdentityConnectionKeyRequest { app_key, local_log })
    }

    #[test]
    fn a_fresh_key_adopts_the_first_invited_identity() -> anyhow::Result<()> {
        let key = AppKey::generate()?;
        let (installation, local) = Installation::new().protect(&key)?;
        let invited = IdentityId::generate()?;

        assert_eq!(
            connection(&installation.directory, &key, LocalIdentityLog::Empty)?,
            IdentityConnectionKey::CurrentAppKey
        );
        assert_eq!(
            binding(
                &installation.directory,
                &key,
                &invited,
                LocalIdentityLog::Empty
            )?,
            IdentityInvitationBinding::Adopt {
                local_identity_id: local
            }
        );
        Ok(())
    }

    #[test]
    fn a_member_key_joining_its_own_identity_again_is_already_bound() -> anyhow::Result<()> {
        let key = AppKey::generate()?;
        let (installation, local) = Installation::new().protect(&key)?;
        let installation = installation.join_with_vault(&key, &local)?;

        assert_eq!(
            binding(
                &installation.directory,
                &key,
                &local,
                LocalIdentityLog::Replicated
            )?,
            IdentityInvitationBinding::AlreadyBound
        );
        Ok(())
    }

    #[test]
    fn a_key_of_one_identity_needs_a_new_key_for_the_next() -> anyhow::Result<()> {
        let key = AppKey::generate()?;
        let (installation, first) = Installation::new().protect(&key)?;
        let installation = installation.join_with_vault(&key, &first)?;
        let second = IdentityId::generate()?;

        assert_eq!(
            connection(&installation.directory, &key, LocalIdentityLog::Replicated)?,
            IdentityConnectionKey::NewAppKey
        );
        let refused = binding(
            &installation.directory,
            &key,
            &second,
            LocalIdentityLog::Replicated,
        );
        assert!(matches!(
            refused,
            Err(MultiDeviceError::AppKeyBelongsToAnotherIdentity { identity_id }) if identity_id == first.to_string()
        ));
        Ok(())
    }

    #[test]
    fn a_key_with_vaults_paired_one_by_one_keeps_pairing_them() -> anyhow::Result<()> {
        let key = AppKey::generate()?;
        let (installation, local) = Installation::new().protect(&key)?;
        let installation = installation.join_with_vault(&key, &local)?;

        assert_eq!(
            connection(&installation.directory, &key, LocalIdentityLog::Empty)?,
            IdentityConnectionKey::CurrentAppKey
        );
        // Its vaults belong to an identity already, so it cannot become
        // another identity's member.
        assert!(matches!(
            binding(
                &installation.directory,
                &key,
                &IdentityId::generate()?,
                LocalIdentityLog::Empty
            ),
            Err(MultiDeviceError::AppKeyBelongsToAnotherIdentity { .. })
        ));
        Ok(())
    }

    #[test]
    fn a_replicated_log_alone_ties_a_key_to_its_identity() -> anyhow::Result<()> {
        let key = AppKey::generate()?;
        let (installation, _) = Installation::new().protect(&key)?;

        assert_eq!(
            connection(&installation.directory, &key, LocalIdentityLog::Replicated)?,
            IdentityConnectionKey::NewAppKey
        );
        assert!(matches!(
            binding(
                &installation.directory,
                &key,
                &IdentityId::generate()?,
                LocalIdentityLog::Replicated
            ),
            Err(MultiDeviceError::AppKeyBelongsToAnotherIdentity { .. })
        ));
        Ok(())
    }

    #[test]
    fn a_second_key_joins_a_second_identity_beside_the_first() -> anyhow::Result<()> {
        let first_key = AppKey::generate()?;
        let (installation, first) = Installation::new().protect(&first_key)?;
        let installation = installation.join_with_vault(&first_key, &first)?;
        let second_key = AppKey::generate()?;
        let (installation, second_local) = installation.protect(&second_key)?;
        let second = IdentityId::generate()?;

        assert_eq!(
            connection(
                &installation.directory,
                &second_key,
                LocalIdentityLog::Empty
            )?,
            IdentityConnectionKey::CurrentAppKey
        );
        assert_eq!(
            binding(
                &installation.directory,
                &second_key,
                &second,
                LocalIdentityLog::Empty
            )?,
            IdentityInvitationBinding::Adopt {
                local_identity_id: second_local
            }
        );
        Ok(())
    }

    #[test]
    fn an_identity_another_local_key_holds_is_not_joined_twice() -> anyhow::Result<()> {
        let first_key = AppKey::generate()?;
        let (installation, first) = Installation::new().protect(&first_key)?;
        let installation = installation.join_with_vault(&first_key, &first)?;
        let second_key = AppKey::generate()?;
        let (installation, _) = installation.protect(&second_key)?;

        let refused = binding(
            &installation.directory,
            &second_key,
            &first,
            LocalIdentityLog::Empty,
        );
        assert!(matches!(
            refused,
            Err(MultiDeviceError::ReplicatedIdentityAlreadyLocal { identity_id }) if identity_id == first.to_string()
        ));
        Ok(())
    }

    #[test]
    fn a_key_without_a_local_identity_cannot_bind_an_invite() -> anyhow::Result<()> {
        let key = AppKey::generate()?;
        let directory = IdentityDirectory::empty();

        assert_eq!(
            connection(&directory, &key, LocalIdentityLog::Empty)?,
            IdentityConnectionKey::CurrentAppKey
        );
        assert!(matches!(
            binding(
                &directory,
                &key,
                &IdentityId::generate()?,
                LocalIdentityLog::Empty
            ),
            Err(MultiDeviceError::IdentityEnrollmentRequired)
        ));
        Ok(())
    }

    fn named(
        directory: IdentityDirectory,
        app_key: &AppKey,
        label: &str,
        local_log: LocalIdentityLog,
    ) -> MultiDeviceResult<FreshIdentityNamed> {
        directory.name_fresh_identity(&FreshIdentityNaming {
            app_key,
            label,
            local_log,
        })
    }

    fn label_of(directory: &IdentityDirectory, identity_id: &IdentityId) -> anyhow::Result<String> {
        directory
            .identities()
            .iter()
            .find(|record| &record.identity_id == identity_id)
            .map(|record| record.label.clone())
            .ok_or_else(|| anyhow::anyhow!("no identity {identity_id}"))
    }

    #[test]
    fn a_fresh_identity_takes_the_name_setup_gives_it() -> anyhow::Result<()> {
        let key = AppKey::generate()?;
        let (installation, local) = Installation::new().protect(&key)?;

        let FreshIdentityNamed::Renamed(directory) = named(
            installation.directory,
            &key,
            "Family",
            LocalIdentityLog::Empty,
        )?
        else {
            anyhow::bail!("a fresh local identity is renamed at once");
        };

        assert_eq!(label_of(&directory, &local)?, "Family");
        Ok(())
    }

    #[test]
    fn a_key_with_no_local_identity_yet_is_named_by_its_first_vault() -> anyhow::Result<()> {
        let lent = AppKey::generate()?;
        let directory = IdentityDirectory::empty();

        assert_eq!(
            named(directory.clone(), &lent, "Family", LocalIdentityLog::Empty)?,
            FreshIdentityNamed::AtFirstVault(directory)
        );
        Ok(())
    }

    #[test]
    fn an_identity_with_a_log_or_a_vault_keeps_its_name() -> anyhow::Result<()> {
        let key = AppKey::generate()?;
        let (installation, local) = Installation::new().protect(&key)?;

        let with_log = named(
            installation.directory.clone(),
            &key,
            "Family",
            LocalIdentityLog::Replicated,
        );
        assert!(matches!(
            with_log,
            Err(MultiDeviceError::IdentityAlreadyInUse { identity_id }) if identity_id == local.to_string()
        ));

        let installation = installation.join_with_vault(&key, &local)?;
        let with_vault = named(
            installation.directory,
            &key,
            "Family",
            LocalIdentityLog::Empty,
        );
        assert!(matches!(
            with_vault,
            Err(MultiDeviceError::IdentityAlreadyInUse { .. })
        ));
        Ok(())
    }

    #[test]
    fn a_blank_name_is_refused() -> anyhow::Result<()> {
        let key = AppKey::generate()?;
        let (installation, _) = Installation::new().protect(&key)?;

        assert!(matches!(
            named(installation.directory, &key, "   ", LocalIdentityLog::Empty),
            Err(MultiDeviceError::IdentityLabelEmpty)
        ));
        Ok(())
    }
}

//! Recovery passphrases as identity members.
//!
//! A member adds a recovery passphrase with `recovery-key-added`, wrapping
//! every vault DEK to it in the same event. On a new device the passphrase
//! unseals the recovery member's keys, and the recovery member approves the
//! device's fresh app key with every vault DEK, as any member approves a join.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use nook_auth2::{AppId, RecoverySealedSecret, RecoveryStrength};

use super::builder::OpenedVaultDek;
use super::projection::IdentityControlState;
use super::wire::{IdentityControlOperation, IdentityMemberKeys, MemberDevice};
use crate::{EventError, EventResult};

/// Named values a member needs to add a recovery passphrase.
pub struct IdentityRecoveryAddition<'a> {
    /// The recovery member's public keys and label.
    pub member: &'a IdentityMemberKeys,
    /// Its private keys, sealed under its words.
    pub sealed_secret: &'a RecoverySealedSecret,
    pub strength: RecoveryStrength,
    /// Every vault the identity owns, opened by the adding member at its
    /// current epoch.
    pub vaults: &'a [OpenedVaultDek<'a>],
}

/// Named values a recovery passphrase needs to approve a new app key.
pub struct IdentityRecoveryApproval<'a> {
    /// The recovery member that approves.
    pub recovery: &'a AppId,
    /// The new app key's public keys.
    pub member: &'a IdentityMemberKeys,
    /// Every vault the identity owns, opened by the recovery member at its
    /// current epoch.
    pub vaults: &'a [OpenedVaultDek<'a>],
}

impl IdentityControlState {
    /// Add a recovery passphrase as a member, and wrap every vault's current
    /// DEK to it in the same event.
    pub fn recovery_addition_operations(
        &self,
        addition: &IdentityRecoveryAddition<'_>,
    ) -> EventResult<Vec<IdentityControlOperation>> {
        let member = addition.member;
        if self.member(&member.app_id).is_some() {
            return Err(EventError::IdentityControlInvalid(format!(
                "app {} is already an identity member",
                member.app_id
            )));
        }
        member.signing_actor()?;
        self.require_every_vault(addition.vaults)?;
        let added = IdentityControlOperation::RecoveryKeyAdded {
            member: member.clone(),
            sealed_secret: addition.sealed_secret.clone(),
            strength: addition.strength,
        };
        let grants = addition
            .vaults
            .iter()
            .map(|opened| {
                Ok(IdentityControlOperation::VaultDekGranted {
                    store_id: opened.store_id.clone(),
                    key_epoch: opened.key_epoch.clone(),
                    recipients: vec![member.wrap_vault_keys(opened.keys)?],
                })
            })
            .collect::<EventResult<Vec<_>>>()?;
        Ok([added].into_iter().chain(grants).collect())
    }

    /// The recovery passphrase approves a new app key on the device it was
    /// typed on, with every vault's DEK at its current epoch.
    pub fn recovery_approval_operation(
        &self,
        approval: &IdentityRecoveryApproval<'_>,
    ) -> EventResult<IdentityControlOperation> {
        self.recovery_member(approval.recovery).ok_or_else(|| {
            EventError::IdentityControlInvalid(format!(
                "{} is not a recovery passphrase of this identity",
                approval.recovery
            ))
        })?;
        if self.member(&approval.member.app_id).is_some() {
            return Err(EventError::IdentityControlInvalid(format!(
                "app {} is already an identity member",
                approval.member.app_id
            )));
        }
        approval.member.signing_actor()?;
        self.require_every_vault(approval.vaults)?;
        Ok(IdentityControlOperation::MemberApproved {
            member: approval.member.clone(),
            vault_deks: approval.member.vault_dek_grants(approval.vaults)?,
            device: MemberDevice::Own,
        })
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::too_many_lines)]

    use super::*;
    use crate::identity_control::test_fixtures::*;
    use crate::{IdentityMemberApprover, IdentityMemberKind, SigningIdentity};
    use nook_auth2::{RecoveryPhrase, RecoverySecret};

    /// A recovery passphrase: its words, its unsealed keys, and its signer.
    struct Recovery {
        phrase: RecoveryPhrase,
        secret: RecoverySecret,
        signer: SigningKey,
    }

    impl Recovery {
        fn new() -> anyhow::Result<Self> {
            let secret = RecoverySecret::generate()?;
            let signer = SigningIdentity::from_seed_hex_stored(secret.signing_seed().as_str())?
                .signing_key()
                .clone();
            Ok(Self {
                phrase: RecoveryPhrase::generate(RecoveryStrength::Standard)?,
                secret,
                signer,
            })
        }

        fn keys(&self, label: &str) -> IdentityMemberKeys {
            IdentityMemberKeys {
                app_id: self.secret.app_key().app_id().clone(),
                encryption_public_key: self.secret.app_key().public_key(),
                signing_public_key: public_key(&self.signer),
                label: MemberLabel::from_trusted(label.to_owned()),
            }
        }

        fn app_id(&self) -> &nook_auth2::AppId {
            self.secret.app_key().app_id()
        }

        /// This passphrase acting as an identity member.
        fn installation(&self) -> Installation {
            Installation {
                app: self.secret.app_key().clone(),
                signer: self.signer.clone(),
            }
        }
    }

    /// One registered vault with its keys and epoch.
    struct Vault {
        store_id: StoreId,
        keys: VaultKeys,
        epoch: EventId,
    }

    impl Vault {
        fn register(fixture: &mut Fixture) -> anyhow::Result<Self> {
            let store_id = StoreId::generate()?;
            let keys = VaultKeys::generate()?;
            let epoch = fixture.register_vault(&keys, &store_id)?;
            Ok(Self {
                store_id,
                keys,
                epoch,
            })
        }

        fn opened(&self) -> OpenedVaultDek<'_> {
            OpenedVaultDek {
                store_id: &self.store_id,
                key_epoch: &self.epoch,
                keys: &self.keys,
            }
        }
    }

    fn add_recovery(
        fixture: &mut Fixture,
        recovery: &Recovery,
        vaults: &[OpenedVaultDek<'_>],
    ) -> anyhow::Result<IdentityEventInsertStatus> {
        let operations = fixture
            .state()?
            .recovery_addition_operations(&IdentityRecoveryAddition {
                member: &recovery.keys("Paper in the safe"),
                sealed_secret: &recovery.secret.seal(&recovery.phrase)?,
                strength: RecoveryStrength::Standard,
                vaults,
            })?;
        let founder = fixture.founder();
        Ok(fixture.append(&founder, operations)?.1)
    }

    /// The vault keys `app` opens from its identity envelope.
    fn opened_by(
        state: &IdentityControlState,
        app: &nook_auth2::AppKey,
        store_id: &StoreId,
    ) -> anyhow::Result<VaultKeys> {
        let vault = state
            .vault(store_id)
            .ok_or_else(|| anyhow::anyhow!("the vault stays registered"))?;
        let IdentityVaultDekLookup::Granted(dek) = vault.current_dek_for(app.app_id()) else {
            anyhow::bail!("{} holds no current DEK of {store_id}", app.app_id());
        };
        Ok(VaultKeys {
            secrets_key: app.decrypt_envelope(&dek.secrets_key_ciphertext)?,
            members_key: app.decrypt_envelope(&dek.members_key_ciphertext)?,
        })
    }

    #[test]
    fn a_recovery_passphrase_holds_every_vault_dek_including_later_ones() -> anyhow::Result<()> {
        let mut fixture = Fixture::new()?;
        let first = Vault::register(&mut fixture)?;
        let recovery = Recovery::new()?;
        // Every owned vault must be wrapped to it.
        assert!(matches!(
            fixture.state()?.recovery_addition_operations(&IdentityRecoveryAddition {
                member: &recovery.keys("Paper"),
                sealed_secret: &recovery.secret.seal(&recovery.phrase)?,
                strength: RecoveryStrength::Standard,
                vaults: &[],
            }),
            Err(EventError::IdentityApprovalIncomplete { .. })
        ));
        assert_eq!(
            add_recovery(&mut fixture, &recovery, &[first.opened()])?,
            IdentityEventInsertStatus::Applied
        );
        // A vault registered later wraps its DEK to every member, the
        // recovery passphrase included.
        let later = Vault::register(&mut fixture)?;
        let state = fixture.state()?;
        for vault in [&first, &later] {
            assert_eq!(
                opened_by(&state, recovery.secret.app_key(), &vault.store_id)?,
                vault.keys
            );
        }
        let (member, sealed) = state
            .recovery_member(recovery.app_id())
            .ok_or_else(|| anyhow::anyhow!("the passphrase is a recovery member"))?;
        assert_eq!(member.keys.label.as_str(), "Paper in the safe");
        assert_eq!(sealed.strength, RecoveryStrength::Standard);
        assert_eq!(
            member.approved_by,
            IdentityMemberApprover::App {
                app_id: fixture.founder.app.app_id().clone()
            }
        );
        // It is on no device, so it never protects the identity as one.
        assert_eq!(state.members.len(), 2);
        assert_eq!(state.device_members().count(), 1);
        // The sealed secret opens with its words only.
        let opened = sealed.sealed_secret.unseal(&recovery.phrase)?;
        assert_eq!(opened.app_key().app_id(), recovery.app_id());
        Ok(())
    }

    #[test]
    fn several_labelled_recovery_passphrases_coexist() -> anyhow::Result<()> {
        let mut fixture = Fixture::new()?;
        let vault = Vault::register(&mut fixture)?;
        let paper = Recovery::new()?;
        let drawer = Recovery::new()?;
        add_recovery(&mut fixture, &paper, &[vault.opened()])?;
        let operations = fixture
            .state()?
            .recovery_addition_operations(&IdentityRecoveryAddition {
                member: &drawer.keys("Desk drawer"),
                sealed_secret: &drawer.secret.seal(&drawer.phrase)?,
                strength: RecoveryStrength::High,
                vaults: &[vault.opened()],
            })?;
        let founder = fixture.founder();
        fixture.append(&founder, operations)?;
        let state = fixture.state()?;
        let listed = state
            .recovery_members()
            .map(|(member, recovery)| (member.keys.label.as_str().to_owned(), recovery.strength))
            .collect::<Vec<_>>();
        assert_eq!(listed.len(), 2);
        assert!(listed.contains(&("Paper in the safe".to_owned(), RecoveryStrength::Standard)));
        assert!(listed.contains(&("Desk drawer".to_owned(), RecoveryStrength::High)));
        assert_eq!(state.device_members().count(), 1);
        for recovery in [&paper, &drawer] {
            opened_by(&state, recovery.secret.app_key(), &vault.store_id)?;
        }
        Ok(())
    }

    #[test]
    fn a_recovery_passphrase_approves_a_new_app_key_that_opens_every_vault() -> anyhow::Result<()>
    {
        let mut fixture = Fixture::new()?;
        let first = Vault::register(&mut fixture)?;
        let second = Vault::register(&mut fixture)?;
        let recovery = Recovery::new()?;
        add_recovery(&mut fixture, &recovery, &[first.opened(), second.opened()])?;

        // Every device is lost. A new one opens the vaults with the recovery
        // member's keys and approves its own fresh app key with them.
        let state = fixture.state()?;
        let opened = [&first, &second]
            .iter()
            .map(|vault| opened_by(&state, recovery.secret.app_key(), &vault.store_id))
            .collect::<anyhow::Result<Vec<_>>>()?;
        let vaults = [&first, &second]
            .iter()
            .zip(opened.iter())
            .map(|(vault, keys)| OpenedVaultDek {
                store_id: &vault.store_id,
                key_epoch: &vault.epoch,
                keys,
            })
            .collect::<Vec<_>>();
        let device = Installation::new()?;
        let approval = state.recovery_approval_operation(&IdentityRecoveryApproval {
            recovery: recovery.app_id(),
            member: &device.keys("New laptop"),
            vaults: &vaults,
        })?;
        let (_, status) = fixture.append(&recovery.installation(), vec![approval])?;
        assert_eq!(status, IdentityEventInsertStatus::Applied);

        let state = fixture.state()?;
        for vault in [&first, &second] {
            assert_eq!(
                opened_by(&state, &device.app, &vault.store_id)?,
                vault.keys
            );
        }
        let member = state
            .member(device.app.app_id())
            .ok_or_else(|| anyhow::anyhow!("the new device is a member"))?;
        assert_eq!(
            member.approved_by,
            IdentityMemberApprover::RecoveryPassphrase {
                app_id: recovery.app_id().clone(),
                label: MemberLabel::from_trusted("Paper in the safe".to_owned()),
            }
        );
        assert_eq!(
            member.kind,
            IdentityMemberKind::App {
                device: MemberDevice::Own
            }
        );
        assert_eq!(state.device_members().count(), 2);
        // The passphrase is reusable: it stays a member.
        assert!(state.recovery_member(recovery.app_id()).is_some());
        Ok(())
    }

    #[test]
    fn a_recovery_passphrase_signs_nothing_but_new_app_keys_and_its_own_removal()
    -> anyhow::Result<()> {
        let mut fixture = Fixture::new()?;
        let recovery = Recovery::new()?;
        add_recovery(&mut fixture, &recovery, &[])?;
        let acting = recovery.installation();
        let founder_app = fixture.founder.app.app_id().clone();
        let quarantined = |status: &IdentityEventInsertStatus| {
            matches!(status, IdentityEventInsertStatus::Quarantined { .. })
        };

        // Not a rename, a revocation of another member, an invite, a vault,
        // or a device beside another member's.
        let other = Installation::new()?;
        for refused in [
            vec![rename(&founder_app, "Taken over")],
            vec![IdentityControlOperation::MemberRevoked {
                app_id: founder_app.clone(),
            }],
            vec![
                IdentityInviteIssue {
                    invite_id: &IdentityInviteId::generate()?,
                    invite_key: &signing_key(),
                    expires_at: &fixture.at,
                }
                .operation(),
            ],
            vec![IdentityControlOperation::MemberApproved {
                member: other.keys("Beside"),
                vault_deks: Vec::new(),
                device: MemberDevice::SameAs {
                    app_id: founder_app.clone(),
                },
            }],
            // An approval of a key that already is a member.
            vec![IdentityControlOperation::MemberApproved {
                member: fixture.founder.keys("Laptop"),
                vault_deks: Vec::new(),
                device: MemberDevice::Own,
            }],
            // One permitted operation does not carry a forbidden one.
            vec![
                IdentityControlOperation::MemberApproved {
                    member: other.keys("Phone"),
                    vault_deks: Vec::new(),
                    device: MemberDevice::Own,
                },
                rename(&founder_app, "Taken over"),
            ],
        ] {
            let (_, status) = fixture.append(&acting, refused)?;
            assert!(quarantined(&status), "{status:?}");
        }
        let state = fixture.state()?;
        assert_eq!(member_label(&state, &founder_app), "Laptop");
        assert!(state.member(other.app.app_id()).is_none());

        // Another passphrase cannot be added under an app that is a member.
        let reused = IdentityControlOperation::RecoveryKeyAdded {
            member: fixture.founder.keys("Laptop"),
            sealed_secret: recovery.secret.seal(&recovery.phrase)?,
            strength: RecoveryStrength::Standard,
        };
        let founder = fixture.founder();
        let (_, status) = fixture.append(&founder, vec![reused])?;
        assert!(quarantined(&status));

        // It may remove itself.
        let (_, status) = fixture.append(
            &acting,
            vec![IdentityControlOperation::MemberRevoked {
                app_id: recovery.app_id().clone(),
            }],
        )?;
        assert_eq!(status, IdentityEventInsertStatus::Applied);
        assert!(fixture.state()?.recovery_member(recovery.app_id()).is_none());
        Ok(())
    }

    #[test]
    fn a_removed_recovery_passphrase_holds_the_vault_epoch_until_it_rotates()
    -> anyhow::Result<()> {
        let mut fixture = Fixture::new()?;
        let vault = Vault::register(&mut fixture)?;
        let recovery = Recovery::new()?;
        add_recovery(&mut fixture, &recovery, &[vault.opened()])?;
        let founder = fixture.founder();
        // An identity always keeps one app key; a passphrase does not count.
        assert!(
            fixture
                .state()?
                .revocation_operation(founder.app.app_id())
                .is_err()
        );
        let remove = fixture.state()?.revocation_operation(recovery.app_id())?;
        fixture.append(&founder, vec![remove])?;

        // Its envelope leaves the projection, but it still knows the DEK of
        // the vault's current epoch.
        let state = fixture.state()?;
        assert!(state.recovery_member(recovery.app_id()).is_none());
        let registered = state
            .vault(&vault.store_id)
            .ok_or_else(|| anyhow::anyhow!("the vault stays registered"))?;
        assert!(matches!(
            registered.current_dek_for(recovery.app_id()),
            IdentityVaultDekLookup::NotGranted
        ));
        assert_eq!(
            registered.revoked_holders(&vault.epoch),
            &[recovery.app_id().clone()]
        );

        // The rotated epoch is wrapped to the remaining members only.
        let rotated = VaultKeys::generate()?;
        let rotated_epoch = epoch_id("after-recovery-removal")?;
        let rewrap = state.vault_rewrap_operation(&OpenedVaultDek {
            store_id: &vault.store_id,
            key_epoch: &rotated_epoch,
            keys: &rotated,
        })?;
        fixture.append(&founder, vec![rewrap])?;
        let state = fixture.state()?;
        let registered = state
            .vault(&vault.store_id)
            .ok_or_else(|| anyhow::anyhow!("the vault stays registered"))?;
        assert!(registered.revoked_holders(&rotated_epoch).is_empty());
        assert!(matches!(
            registered.current_dek_for(recovery.app_id()),
            IdentityVaultDekLookup::NotGranted
        ));
        assert_eq!(opened_by(&state, &founder.app, &vault.store_id)?, rotated);

        // A removed passphrase approves nothing.
        let device = Installation::new()?;
        let (_, status) = fixture.append(
            &recovery.installation(),
            vec![IdentityControlOperation::MemberApproved {
                member: device.keys("Stolen"),
                vault_deks: Vec::new(),
                device: MemberDevice::Own,
            }],
        )?;
        assert!(matches!(
            status,
            IdentityEventInsertStatus::Quarantined { .. }
        ));
        Ok(())
    }
}

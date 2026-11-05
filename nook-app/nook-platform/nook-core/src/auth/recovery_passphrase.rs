//! Keyring recovery passphrases between the identity control log and the
//! devices that add and use them.
//!
//! A member's device adds one: it generates the words and the recovery
//! member's keys, shows the words once, and records the member only after
//! the words are typed back. A new device uses one: it unseals the recovery
//! member's keys with the typed words, opens every vault with them, and signs
//! the approval of its own fresh app key as the recovery member. Words,
//! recovery keys, and DEKs stay here.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use nook_auth2::{
    AppId, AppKey, IsoTimestamp, MemberLabel, RecoveryPassphraseError, RecoveryPhrase,
    RecoverySecret, RecoveryStrength, TypedRecoveryWords,
};
use nook_event_log::{
    EventError, IdentityControlLog, IdentityControlOperation, IdentityControlState, IdentityEvent,
    IdentityEventInsertStatus, IdentityEventSigning, IdentityMemberKeys, IdentityNaming,
    IdentityRecoveryAddition, IdentityRecoveryApproval, SigningIdentity,
};

use super::opened_identity_vaults::OpenedIdentityVaults;
use crate::errors::VaultResult;

/// The member keys a recovery secret publishes, under its label.
struct RecoveryMemberKeys<'a> {
    secret: &'a RecoverySecret,
    label: &'a MemberLabel,
}

impl RecoveryMemberKeys<'_> {
    fn keys(&self) -> VaultResult<IdentityMemberKeys> {
        let signer = SigningIdentity::from_seed_hex_stored(self.secret.signing_seed().as_str())?;
        Ok(IdentityMemberKeys {
            app_id: self.secret.app_key().app_id().clone(),
            encryption_public_key: self.secret.app_key().public_key(),
            signing_public_key: signer.public_key(),
            label: self.label.clone(),
        })
    }
}

/// What a member chose for a new recovery passphrase.
pub struct RecoveryPassphraseStart<'a> {
    pub label: &'a str,
    pub strength: RecoveryStrength,
}

/// A recovery passphrase shown on a member's device and not yet recorded:
/// its words and its member's keys exist only in memory until the words are
/// typed back.
pub struct PendingRecoveryPassphrase {
    label: MemberLabel,
    phrase: RecoveryPhrase,
    secret: RecoverySecret,
}

/// Named values a member's device needs to record a confirmed passphrase.
pub struct RecoveryPassphraseRecording<'a> {
    pub state: &'a IdentityControlState,
    /// The adding member's app key, which opens every vault to wrap it.
    pub adder: &'a AppKey,
}

impl PendingRecoveryPassphrase {
    /// Generate the words and the recovery member's keys. A blank label is
    /// refused.
    pub fn begin(start: &RecoveryPassphraseStart<'_>) -> VaultResult<Self> {
        let label = match start.label.trim() {
            "" => return Err(RecoveryPassphraseError::LabelRequired.into()),
            label => MemberLabel::from_trusted(label.to_owned()),
        };
        Ok(Self {
            label,
            phrase: RecoveryPhrase::generate(start.strength)?,
            secret: RecoverySecret::generate()?,
        })
    }

    /// The words to show once.
    #[must_use]
    pub fn words(&self) -> Vec<&'static str> {
        self.phrase.words()
    }

    /// Check the words typed back. Until they match, nothing is recorded.
    pub fn confirm(&self, typed: &TypedRecoveryWords) -> Result<(), RecoveryPassphraseError> {
        self.phrase.confirm(typed)
    }

    /// The operations that record this passphrase: the recovery member with
    /// its keys sealed under the words, and every vault's current DEK wrapped
    /// to it. The adding member must open every vault.
    pub fn recording(
        &self,
        recording: &RecoveryPassphraseRecording<'_>,
    ) -> VaultResult<Vec<IdentityControlOperation>> {
        let vaults = OpenedIdentityVaults::open(recording.state, recording.adder)?;
        let member = RecoveryMemberKeys {
            secret: &self.secret,
            label: &self.label,
        }
        .keys()?;
        Ok(recording
            .state
            .recovery_addition_operations(&IdentityRecoveryAddition {
                member: &member,
                sealed_secret: &self.secret.seal(&self.phrase)?,
                strength: self.phrase.strength(),
                vaults: &vaults.deks(),
            })?)
    }
}

/// Named values a new device needs to approve its own app key with a
/// recovery passphrase.
pub struct RecoveryPassphraseUse<'a> {
    /// The identity's log, as the provider holds it.
    pub log: &'a IdentityControlLog,
    /// The recovery passphrase chosen by its label.
    pub recovery: &'a AppId,
    pub typed: &'a TypedRecoveryWords,
    /// The new device's fresh app key.
    pub member: &'a IdentityMemberKeys,
    /// The new device's own event signer, which re-seals the keyring's name.
    pub device_signer: &'a SigningIdentity,
    pub created_at: &'a IsoTimestamp,
}

/// The keyring's name, as the recovery passphrase opened it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecoveredKeyringName(String);

impl RecoveredKeyringName {
    #[must_use]
    pub fn as_str(&self) -> &str {
        let Self(name) = self;
        name
    }
}

/// What a recovery writes to the keyring's log, in order.
#[derive(Debug, Clone)]
pub enum RecoveredKeyring {
    /// The keyring has a name: the recovery member's approval of the new
    /// app key, then the new app key's naming that re-seals the name to
    /// every member, itself included, so it reads the name with every other
    /// device lost.
    Named {
        approval: IdentityEvent,
        naming: IdentityEvent,
        name: RecoveredKeyringName,
    },
    /// No member named the keyring: the approval alone.
    Unnamed { approval: IdentityEvent },
}

impl RecoveredKeyring {
    /// The events to write, in causal order.
    #[must_use]
    pub fn events(&self) -> Vec<&IdentityEvent> {
        match self {
            Self::Named {
                approval, naming, ..
            } => vec![approval, naming],
            Self::Unnamed { approval } => vec![approval],
        }
    }
}

/// An event that must apply to the log it extends.
struct AppliedAppend<'a> {
    log: &'a IdentityControlLog,
    event: &'a IdentityEvent,
}

impl AppliedAppend<'_> {
    fn insert(&self) -> VaultResult<IdentityControlLog> {
        let inserted = self
            .log
            .clone()
            .insert(self.event.clone())
            .map_err(|rejection| rejection.cause)?;
        match inserted.status {
            IdentityEventInsertStatus::Applied => Ok(inserted.log),
            IdentityEventInsertStatus::Pending { .. }
            | IdentityEventInsertStatus::Quarantined { .. }
            | IdentityEventInsertStatus::Duplicate => Err(EventError::IdentityControlInvalid(
                format!("the recovery event did not apply: {:?}", inserted.status),
            )
            .into()),
        }
    }
}

impl RecoveryPassphraseUse<'_> {
    /// Check the typed words against the list, unseal the recovery member's
    /// keys with them, open every vault, and sign the approval of the new app
    /// key as the recovery member. When the keyring is named, the recovery
    /// member opens the name and the new app key re-seals it to every member.
    /// Wrong words fail closed with [`RecoveryPassphraseError::WrongWords`];
    /// every event must apply to the log.
    pub fn approval(&self) -> VaultResult<RecoveredKeyring> {
        let state = IdentityControlState::project(self.log)?;
        let (member, recovery) = state.recovery_member(self.recovery).ok_or_else(|| {
            EventError::IdentityControlInvalid(format!(
                "{} is not a recovery passphrase of this keyring",
                self.recovery
            ))
        })?;
        let phrase = RecoveryPhrase::parse(self.typed, recovery.strength)?;
        let secret = recovery.sealed_secret.unseal(&phrase)?;
        let signer = SigningIdentity::from_seed_hex_stored(secret.signing_seed().as_str())?;
        if secret.app_key().app_id() != &member.keys.app_id
            || signer.public_key() != member.keys.signing_public_key
        {
            return Err(RecoveryPassphraseError::Unreadable(
                "the sealed keys are not this recovery passphrase's".to_owned(),
            )
            .into());
        }
        let vaults = OpenedIdentityVaults::open(&state, secret.app_key())?;
        let operation = state.recovery_approval_operation(&IdentityRecoveryApproval {
            recovery: self.recovery,
            member: self.member,
            vaults: &vaults.deks(),
        })?;
        let approval = self.log.build_append(
            vec![operation],
            &IdentityEventSigning {
                signing_key: signer.signing_key(),
                created_at: self.created_at,
            },
        )?;
        let approved = AppliedAppend {
            log: self.log,
            event: &approval,
        }
        .insert()?;
        let Some(sealed) = state.sealed_name_for(self.recovery) else {
            return Ok(RecoveredKeyring::Unnamed { approval });
        };
        let name = secret.app_key().open_utf8(sealed)?.trim().to_owned();
        if name.is_empty() {
            return Ok(RecoveredKeyring::Unnamed { approval });
        }
        let naming = approved.build_append(
            vec![
                IdentityControlState::project(&approved)?.naming_operation(&IdentityNaming {
                    name: &name,
                    joining: None,
                })?,
            ],
            &IdentityEventSigning {
                signing_key: self.device_signer.signing_key(),
                created_at: self.created_at,
            },
        )?;
        AppliedAppend {
            log: &approved,
            event: &naming,
        }
        .insert()?;
        Ok(RecoveredKeyring::Named {
            approval,
            naming,
            name: RecoveredKeyringName(name),
        })
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::too_many_lines)]

    use super::*;
    use crate::VaultError;
    use crate::{
        IdentityGenesisRequest, IdentityRecoveryPassphraseView, IdentityVaultRegistration,
        ProviderIdentityLogEvents, VaultHolderRotation, VaultRevokedHolders,
    };
    use nook_auth2::IdentityId;
    use nook_auth2::{StoreId, VaultKeys};
    use nook_event_log::IdentityMemberApprover;
    use nook_event_log::{EventId, IdentityVaultDekLookup, OpenedVaultDek};

    struct Device {
        app: AppKey,
        signer: SigningIdentity,
    }

    impl Device {
        fn new() -> anyhow::Result<Self> {
            Ok(Self {
                app: AppKey::generate()?,
                signer: SigningIdentity::generate()?.0,
            })
        }

        fn keys(&self, label: &str) -> IdentityMemberKeys {
            IdentityMemberKeys {
                app_id: self.app.app_id().clone(),
                encryption_public_key: self.app.public_key(),
                signing_public_key: self.signer.public_key(),
                label: MemberLabel::from_trusted(label.to_owned()),
            }
        }
    }

    /// A keyring with two vaults, founded by one laptop.
    struct Keyring {
        laptop: Device,
        at: IsoTimestamp,
        vaults: Vec<(StoreId, VaultKeys)>,
        log: IdentityControlLog,
    }

    impl Keyring {
        fn founded() -> anyhow::Result<Self> {
            let laptop = Device::new()?;
            let at = IsoTimestamp::from_trusted("2026-11-05T00:00:00Z".to_owned());
            let identity_id = IdentityId::generate()?;
            let log = IdentityControlLog::new(identity_id.clone())
                .insert(IdentityEvent::genesis(IdentityGenesisRequest {
                    identity_id: &identity_id,
                    founder: laptop.keys("Laptop"),
                    signing: IdentityEventSigning {
                        signing_key: laptop.signer.signing_key(),
                        created_at: &at,
                    },
                })?)?
                .log;
            let keyring = Self {
                laptop,
                at,
                vaults: Vec::new(),
                log,
            };
            keyring.register_vault()?.register_vault()
        }

        fn state(&self) -> anyhow::Result<IdentityControlState> {
            Ok(IdentityControlState::project(&self.log)?)
        }

        fn append(mut self, operations: Vec<IdentityControlOperation>) -> anyhow::Result<Self> {
            let event = self.log.build_append(
                operations,
                &IdentityEventSigning {
                    signing_key: self.laptop.signer.signing_key(),
                    created_at: &self.at,
                },
            )?;
            let inserted = self.log.clone().insert(event)?;
            assert_eq!(inserted.status, IdentityEventInsertStatus::Applied);
            self.log = inserted.log;
            Ok(self)
        }

        fn register_vault(mut self) -> anyhow::Result<Self> {
            let store_id = StoreId::generate()?;
            let keys = VaultKeys::generate()?;
            let key_epoch = epoch(store_id.as_str())?;
            let register =
                self.state()?
                    .vault_registration_operation(IdentityVaultRegistration {
                        dek: OpenedVaultDek {
                            store_id: &store_id,
                            key_epoch: &key_epoch,
                            keys: &keys,
                        },
                    })?;
            self.vaults.push((store_id, keys));
            self.append(vec![register])
        }

        /// The laptop adds a passphrase once its words are typed back.
        fn add_passphrase(self, label: &str) -> anyhow::Result<(Self, PendingRecoveryPassphrase)> {
            let pending = PendingRecoveryPassphrase::begin(&RecoveryPassphraseStart {
                label,
                strength: RecoveryStrength::Standard,
            })?;
            pending.confirm(&typed(&pending.words().join(" ")))?;
            let operations = pending.recording(&RecoveryPassphraseRecording {
                state: &self.state()?,
                adder: &self.laptop.app,
            })?;
            Ok((self.append(operations)?, pending))
        }

        /// The provider's copy of the log, as a new device reads it.
        fn on_provider(&self) -> anyhow::Result<IdentityControlLog> {
            let events = ProviderIdentityLogEvents {
                identity_id: self.log.identity_id().clone(),
                events: self
                    .log
                    .storage_bytes()?
                    .into_iter()
                    .map(|(_, bytes)| bytes)
                    .collect(),
            };
            Ok(IdentityControlLog::new(events.identity_id)
                .union_storage_bytes(&events.events)
                .map_err(|rejection| rejection.cause)?)
        }

        fn passphrase_id(&self, label: &str) -> anyhow::Result<AppId> {
            IdentityRecoveryPassphraseView::list(&self.state()?)
                .into_iter()
                .find(|listed| listed.label == label)
                .map(|listed| AppId::parse(&listed.id))
                .transpose()?
                .ok_or_else(|| anyhow::anyhow!("the keyring lists {label}"))
        }
    }

    fn typed(text: &str) -> TypedRecoveryWords {
        TypedRecoveryWords::from(text.to_owned())
    }

    fn epoch(seed: &str) -> anyhow::Result<EventId> {
        Ok(EventId::from_sha256_hex(&hex::encode(
            <sha2::Sha256 as sha2::Digest>::digest(seed.as_bytes()),
        ))?)
    }

    #[test]
    fn a_passphrase_is_recorded_only_after_its_words_are_typed_back() -> anyhow::Result<()> {
        let keyring = Keyring::founded()?;
        assert!(matches!(
            PendingRecoveryPassphrase::begin(&RecoveryPassphraseStart {
                label: "  ",
                strength: RecoveryStrength::High,
            }),
            Err(VaultError::RecoveryPassphrase(
                RecoveryPassphraseError::LabelRequired
            ))
        ));
        let pending = PendingRecoveryPassphrase::begin(&RecoveryPassphraseStart {
            label: " Paper in the safe ",
            strength: RecoveryStrength::High,
        })?;
        let words = pending.words();
        assert_eq!(words.len(), 5);
        // Other list words, a slip, or a missing word are refused.
        let other = RecoveryPhrase::generate(RecoveryStrength::High)?;
        assert!(matches!(
            pending.confirm(&typed(&other.words().join(" "))),
            Err(RecoveryPassphraseError::NotTheShownWords)
        ));
        assert!(matches!(
            pending.confirm(&typed(&format!("{} qzqzq", words.join(" ")))),
            Err(RecoveryPassphraseError::UnknownWords(_))
        ));
        assert!(matches!(
            pending.confirm(&typed(
                &words.iter().skip(1).copied().collect::<Vec<_>>().join(" ")
            )),
            Err(RecoveryPassphraseError::WordCount { .. })
        ));
        pending.confirm(&typed(&words.join("-").to_uppercase()))?;

        let operations = pending.recording(&RecoveryPassphraseRecording {
            state: &keyring.state()?,
            adder: &keyring.laptop.app,
        })?;
        let keyring = keyring.append(operations)?;
        let listed = IdentityRecoveryPassphraseView::list(&keyring.state()?);
        let [passphrase] = listed.as_slice() else {
            anyhow::bail!("the keyring lists one passphrase");
        };
        assert_eq!(passphrase.label, "Paper in the safe");
        assert_eq!(passphrase.strength, RecoveryStrength::High);
        // The log holds neither the words nor the recovery keys in the clear.
        for (_, bytes) in keyring.log.storage_bytes()? {
            let text = String::from_utf8(Vec::from(bytes))?;
            for word in &words {
                assert!(!text.contains(&format!(" {word} ")));
            }
            assert!(!text.contains("AGE-SECRET-KEY"));
        }
        Ok(())
    }

    #[test]
    fn a_new_device_recovers_the_keyring_and_opens_every_vault() -> anyhow::Result<()> {
        let (keyring, pending) = Keyring::founded()?.add_passphrase("Paper in the safe")?;
        // A vault registered after the passphrase reaches it too.
        let keyring = keyring.register_vault()?;
        let recovery = keyring.passphrase_id("Paper in the safe")?;
        // The laptop names the keyring; the name is sealed to every member,
        // the passphrase included.
        let naming = keyring.state()?.naming_operation(&IdentityNaming {
            name: "Personal",
            joining: None,
        })?;
        let keyring = keyring.append(vec![naming])?;

        // Every device is lost; a new one reads the log from the provider.
        let provider_log = keyring.on_provider()?;
        let phone = Device::new()?;
        let recovered = RecoveryPassphraseUse {
            log: &provider_log,
            recovery: &recovery,
            typed: &typed(&pending.words().concat()),
            member: &phone.keys("Phone"),
            device_signer: &phone.signer,
            created_at: &keyring.at,
        }
        .approval()?;
        let RecoveredKeyring::Named { name, .. } = &recovered else {
            anyhow::bail!("the named keyring is recovered with its name");
        };
        assert_eq!(name.as_str(), "Personal");
        let recovered = recovered
            .events()
            .into_iter()
            .try_fold(provider_log, |log, event| {
                log.insert(event.clone()).map(|inserted| inserted.log)
            })?;
        let state = IdentityControlState::project(&recovered)?;
        // The phone reads the name with every other device lost.
        let sealed = state
            .sealed_name_for(phone.app.app_id())
            .ok_or_else(|| anyhow::anyhow!("the name is sealed to the phone"))?;
        assert_eq!(phone.app.open_utf8(sealed)?, "Personal");
        assert_eq!(state.vaults.len(), 3);
        let opened = OpenedIdentityVaults::open(&state, &phone.app)?;
        let opened = opened.vaults();
        for (store_id, keys) in &keyring.vaults {
            let vault = opened
                .iter()
                .find(|vault| &vault.store_id == store_id)
                .ok_or_else(|| anyhow::anyhow!("the phone opens {store_id}"))?;
            assert_eq!(&vault.keys, keys);
        }
        let member = state
            .member(phone.app.app_id())
            .ok_or_else(|| anyhow::anyhow!("the phone is a member"))?;
        assert_eq!(
            member.approved_by,
            IdentityMemberApprover::RecoveryPassphrase {
                app_id: recovery.clone(),
                label: MemberLabel::from_trusted("Paper in the safe".to_owned()),
            }
        );
        // Two devices now: the lost laptop and the phone. The passphrase is none.
        assert_eq!(state.device_members().count(), 2);
        assert!(state.recovery_member(&recovery).is_some());
        Ok(())
    }

    #[test]
    fn wrong_words_fail_closed_and_add_nothing() -> anyhow::Result<()> {
        let (keyring, pending) = Keyring::founded()?.add_passphrase("Paper in the safe")?;
        let recovery = keyring.passphrase_id("Paper in the safe")?;
        let provider_log = keyring.on_provider()?;
        let phone = Device::new()?;
        let attempt = |words: &str| {
            RecoveryPassphraseUse {
                log: &provider_log,
                recovery: &recovery,
                typed: &typed(words),
                member: &phone.keys("Phone"),
                device_signer: &phone.signer,
                created_at: &keyring.at,
            }
            .approval()
        };
        let other = RecoveryPhrase::generate(RecoveryStrength::Standard)?;
        assert!(matches!(
            attempt(&other.words().join(" ")),
            Err(VaultError::RecoveryPassphrase(
                RecoveryPassphraseError::WrongWords
            ))
        ));
        // Words outside the list and a wrong count are refused before scrypt.
        let words = pending.words();
        assert!(matches!(
            attempt(&format!("qzqzq {}", words.iter().skip(1).copied().collect::<Vec<_>>().join(" "))),
            Err(VaultError::RecoveryPassphrase(
                RecoveryPassphraseError::UnknownWords(unknown)
            )) if unknown.iter().map(|word| u32::from(word.position)).collect::<Vec<_>>() == vec![0]
        ));
        assert!(matches!(
            attempt(&format!("{} {}", words.join(" "), words.join(" "))),
            Err(VaultError::RecoveryPassphrase(
                RecoveryPassphraseError::WordCount { .. }
            ))
        ));
        // An app key is no recovery passphrase.
        assert!(
            RecoveryPassphraseUse {
                log: &provider_log,
                recovery: keyring.laptop.app.app_id(),
                typed: &typed(&words.join(" ")),
                member: &phone.keys("Phone"),
                device_signer: &phone.signer,
                created_at: &keyring.at,
            }
            .approval()
            .is_err()
        );
        assert!(
            IdentityControlState::project(&provider_log)?
                .member(phone.app.app_id())
                .is_none()
        );
        // The right words recover an unnamed keyring with the approval alone.
        assert!(matches!(
            attempt(&words.join(" "))?,
            RecoveredKeyring::Unnamed { .. }
        ));
        Ok(())
    }

    #[test]
    fn removing_a_passphrase_rotates_every_vault_and_it_recovers_nothing_more() -> anyhow::Result<()>
    {
        let (keyring, pending) = Keyring::founded()?.add_passphrase("Paper in the safe")?;
        let (keyring, _drawer) = keyring.add_passphrase("Desk drawer")?;
        let recovery = keyring.passphrase_id("Paper in the safe")?;
        let remove = keyring.state()?.revocation_operation(&recovery)?;
        let mut keyring = keyring.append(vec![remove])?;
        let state = keyring.state()?;
        assert_eq!(IdentityRecoveryPassphraseView::list(&state).len(), 1);

        // Each vault is due to rotate: the removed passphrase still knows the
        // DEK of its current epoch, though it is on no vault roster.
        let vaults = state.vaults.clone();
        for vault in &vaults {
            assert_eq!(
                VaultRevokedHolders {
                    state: &state,
                    store_id: &vault.store_id,
                    key_epoch: &vault.current_key_epoch,
                }
                .rotation(),
                VaultHolderRotation::Due {
                    app_id: recovery.clone()
                }
            );
            // The vault rotates and rewraps its new epoch to the members left.
            let rotated = VaultKeys::generate()?;
            let rotated_epoch = epoch(&format!("rotated {}", vault.store_id))?;
            let rewrap = keyring.state()?.vault_rewrap_operation(&OpenedVaultDek {
                store_id: &vault.store_id,
                key_epoch: &rotated_epoch,
                keys: &rotated,
            })?;
            keyring = keyring.append(vec![rewrap])?;
            assert_eq!(
                VaultRevokedHolders {
                    state: &keyring.state()?,
                    store_id: &vault.store_id,
                    key_epoch: &rotated_epoch,
                }
                .rotation(),
                VaultHolderRotation::NotDue
            );
        }
        // The passphrase left holds every rotated DEK; the removed one holds
        // none and approves no device.
        let state = keyring.state()?;
        let drawer = keyring.passphrase_id("Desk drawer")?;
        for vault in &state.vaults {
            assert!(matches!(
                vault.current_dek_for(&drawer),
                IdentityVaultDekLookup::Granted(_)
            ));
            assert!(matches!(
                vault.current_dek_for(&recovery),
                IdentityVaultDekLookup::NotGranted
            ));
        }
        let phone = Device::new()?;
        assert!(
            RecoveryPassphraseUse {
                log: &keyring.on_provider()?,
                recovery: &recovery,
                typed: &typed(&pending.words().join(" ")),
                member: &phone.keys("Phone"),
                device_signer: &phone.signer,
                created_at: &keyring.at,
            }
            .approval()
            .is_err()
        );
        Ok(())
    }
}

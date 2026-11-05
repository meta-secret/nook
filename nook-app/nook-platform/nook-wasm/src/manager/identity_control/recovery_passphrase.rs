//! Keyring recovery passphrases at the web boundary.
//!
//! A member's device adds one: [`NookVaultManager::begin_recovery_passphrase`]
//! returns the generated words for one-time display and keeps the pending
//! passphrase here; [`NookVaultManager::confirm_recovery_passphrase`] checks
//! the words typed back and only then records the recovery member. A new
//! device recovers a keyring found on a provider: after the same key choice
//! and protection an identity join uses, [`NookVaultManager::recover_identity_with_passphrase`]
//! unseals the recovery member's keys with the typed words and approves this
//! device's fresh app key, then completes the join. Words, recovery keys, and
//! DEKs never reach JavaScript.

use crate::{TypedInput, TypedOutput};
use nook_core::{
    AppId, IdentityControlLog, IdentityControlState, IdentityId, IdentityInvitationBinding,
    IdentityInvitationBindingRequest, IdentityRecoveryPassphraseView, PendingRecoveryPassphrase,
    RecoveryPassphraseError, RecoveryPassphraseRecording, RecoveryPassphraseStart,
    RecoveryPassphraseUse, RecoveryStrength, RecoveryWordCount, RecoveryWordPosition,
    TypedRecoveryWords, VaultError,
};
use serde::{Deserialize, Serialize};
use tsify::Tsify;
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

use super::join_request::{IdentityJoinLog, NookIdentityJoinCompletion};
use crate::manager::CeremonyState;
use crate::manager::NookVaultManager;
use crate::manager::access_check::NookProviderSource;
use crate::storage::provider_vault_listing::IdentityEventPut;
use crate::{NookDatabase, NookError};

/// The words of a new recovery passphrase, shown once to be written down.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct NookRecoveryWords {
    pub words: Vec<String>,
}

/// The recovery passphrases of a keyring on a provider, by label. The
/// keyring's name stays sealed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct NookRecoveryPassphrases {
    pub passphrases: Vec<IdentityRecoveryPassphraseView>,
}

/// What typed recovery words did. A slip is reported here, word by word,
/// before any passphrase work runs; other failures are errors.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum NookRecoveryWordsCheck {
    /// Confirming: the passphrase is saved in the keyring. Recovering: this
    /// device joined the keyring.
    Accepted,
    /// Nothing was typed.
    Empty,
    /// Typed words the list does not hold, by position from zero.
    #[serde(rename_all = "camelCase")]
    UnknownWords {
        #[tsify(type = "number[]")]
        positions: Vec<RecoveryWordPosition>,
    },
    /// The passphrase has `expected` words; `typed` were typed.
    #[serde(rename_all = "camelCase")]
    WrongWordCount {
        #[tsify(type = "number")]
        expected: RecoveryWordCount,
        #[tsify(type = "number")]
        typed: RecoveryWordCount,
    },
    /// Every word is a list word, but confirming: they are not the words
    /// shown; recovering: they do not open this passphrase.
    WrongWords,
}

impl NookRecoveryWordsCheck {
    /// The check a refusal of typed words reports, or the error it is.
    fn of(error: RecoveryPassphraseError) -> Result<Self, NookError> {
        match error {
            RecoveryPassphraseError::Empty => Ok(Self::Empty),
            RecoveryPassphraseError::UnknownWords(unknown) => Ok(Self::UnknownWords {
                positions: unknown.iter().map(|word| word.position).collect(),
            }),
            RecoveryPassphraseError::WordCount { expected, typed } => {
                Ok(Self::WrongWordCount { expected, typed })
            }
            RecoveryPassphraseError::NotTheShownWords | RecoveryPassphraseError::WrongWords => {
                Ok(Self::WrongWords)
            }
            RecoveryPassphraseError::LabelRequired
            | RecoveryPassphraseError::Unreadable(_)
            | RecoveryPassphraseError::Random(_) => Err(VaultError::from(error).into()),
        }
    }

    /// A recovery that failed: a refusal of the typed words, or the error.
    fn of_vault(error: VaultError) -> Result<Self, NookError> {
        match error {
            VaultError::RecoveryPassphrase(refusal) => Self::of(refusal),
            other => Err(other.into()),
        }
    }
}

impl NookVaultManager {
    /// The recovery member a removal names, which must be one.
    async fn recovery_removal(&self, id: &AppId) -> Result<IdentityControlState, NookError> {
        let state = self.current_identity_state().await?;
        if state.recovery_member(id).is_none() {
            return Err(NookError::Database(
                "This is not a recovery passphrase of the keyring.".to_owned(),
            ));
        }
        Ok(state)
    }

    /// The keyring's log at a source, read and verified.
    async fn identity_log_at(
        &self,
        source: &NookProviderSource,
        identity_id: &IdentityId,
    ) -> Result<(IdentityControlLog, Vec<nook_core::EventStorageBytes>), NookError> {
        let events = self
            .identity_source(source)
            .await?
            .identity_events(identity_id)
            .await?;
        if events.is_empty() {
            return Err(NookError::Database(
                "No identity log was found at this provider.".to_owned(),
            ));
        }
        let log = IdentityControlLog::new(identity_id.clone())
            .union_storage_bytes(&events)
            .map_err(|rejection| rejection.cause)?;
        Ok((log, events))
    }
}

#[wasm_bindgen]
impl NookVaultManager {
    /// Start adding a recovery passphrase named `label` to the keyring in
    /// use: generate its words and keys, keep them here, and return the
    /// words to show once. Starting again replaces the pending one.
    #[wasm_bindgen]
    pub async fn begin_recovery_passphrase(
        &mut self,
        label: String,
        strength: &tsify::Ts<RecoveryStrength>,
    ) -> Result<tsify::Ts<NookRecoveryWords>, JsError> {
        let strength = strength.decode()?;
        // Only a member of a replicated keyring can add one.
        let state = self.current_identity_state().await?;
        let app_key = self.unlocked_app_key()?;
        if state.member(app_key.app_id()).is_none() {
            return Err(
                NookError::Database("This app is not a member of the keyring.".to_owned()).into(),
            );
        }
        let pending = PendingRecoveryPassphrase::begin(&RecoveryPassphraseStart {
            label: &label,
            strength,
        })?;
        let words = NookRecoveryWords {
            words: pending.words().into_iter().map(str::to_owned).collect(),
        };
        self.recovery_passphrase = CeremonyState::Active(pending);
        Ok(words.encode()?)
    }

    /// Check the words typed back for the pending recovery passphrase. Only
    /// when they are the words shown is the passphrase recorded in the
    /// keyring; until then it stays pending and nothing is written.
    #[wasm_bindgen]
    pub async fn confirm_recovery_passphrase(
        &mut self,
        words: String,
    ) -> Result<tsify::Ts<NookRecoveryWordsCheck>, JsError> {
        let typed = TypedRecoveryWords::from(words);
        let CeremonyState::Active(pending) = &self.recovery_passphrase else {
            return Err(NookError::Database(
                "No recovery passphrase is waiting to be confirmed.".to_owned(),
            )
            .into());
        };
        if let Err(refusal) = pending.confirm(&typed) {
            return Ok(NookRecoveryWordsCheck::of(refusal)?.encode()?);
        }
        let state = self.current_identity_state().await?;
        let app_key = self.unlocked_app_key()?;
        let operations = pending.recording(&RecoveryPassphraseRecording {
            state: &state,
            adder: &app_key,
        })?;
        self.append_identity_operations(operations).await?;
        self.recovery_passphrase = CeremonyState::Inactive;
        Ok(NookRecoveryWordsCheck::Accepted.encode()?)
    }

    /// Drop the pending recovery passphrase and its words.
    #[wasm_bindgen]
    pub fn cancel_recovery_passphrase(&mut self) {
        self.recovery_passphrase = CeremonyState::Inactive;
    }

    /// Remove a recovery passphrase from the keyring. The open vault rotates
    /// now; every other vault rotates before its next write, so the removed
    /// words cannot read anything written afterwards.
    #[wasm_bindgen]
    pub async fn remove_recovery_passphrase(&mut self, id: String) -> Result<(), JsError> {
        let id = AppId::parse(&id)?;
        let revocation = self
            .recovery_removal(&id)
            .await?
            .revocation_operation(&id)?;
        self.append_identity_operations(vec![revocation]).await?;
        if !self.vault.store_id.trim().is_empty() && self.vault.crypto.is_unlocked() {
            self.reconcile_open_vault_with_identity_log().await?;
        }
        Ok(())
    }

    /// The recovery passphrases of a keyring found at a source, by label,
    /// read from its signed log. Nothing is decrypted.
    #[wasm_bindgen]
    pub async fn recovery_passphrases_at_source(
        &self,
        source: &tsify::Ts<NookProviderSource>,
        identity_id: String,
    ) -> Result<tsify::Ts<NookRecoveryPassphrases>, JsError> {
        let source = source.decode()?;
        let identity_id = IdentityId::parse(&identity_id)?;
        let (log, _) = self.identity_log_at(&source, &identity_id).await?;
        let passphrases = NookRecoveryPassphrases {
            passphrases: IdentityRecoveryPassphraseView::list(&IdentityControlState::project(
                &log,
            )?),
        };
        Ok(passphrases.encode()?)
    }

    /// Recover a keyring found at a source with one of its recovery
    /// passphrases. Start as an identity join does: `begin_identity_join`
    /// chooses this device's key, and the key's protection ceremony runs
    /// first. The typed words unseal the recovery member's keys here; it
    /// approves this device's fresh app key with every Simple vault's DEK,
    /// the approval is written to the source, and the join completes as an
    /// approved join request does. Each Simple vault then self-enrolls on its
    /// first open (`connect_identity_vault`); Sentinel vaults still need
    /// their ceremony. Typed words that are refused are reported in the
    /// result, and nothing is written.
    #[wasm_bindgen]
    pub async fn recover_identity_with_passphrase(
        &mut self,
        source: &tsify::Ts<NookProviderSource>,
        identity_id: String,
        recovery_id: String,
        words: String,
    ) -> Result<tsify::Ts<NookRecoveryWordsCheck>, JsError> {
        let typed = TypedRecoveryWords::from(words);
        let source = source.decode()?;
        let identity_id = IdentityId::parse(&identity_id)?;
        let recovery = AppId::parse(&recovery_id)?;
        let app_key = self.unlocked_app_key()?;
        let local_log = Self::local_identity_log(&app_key).await?;
        let binding = NookDatabase::load_identity_directory()
            .await?
            .invitation_binding(&IdentityInvitationBindingRequest {
                app_key: &app_key,
                invited: &identity_id,
                local_log,
            })
            .map_err(NookDatabase::map_domain_error)?;
        if binding == IdentityInvitationBinding::AlreadyBound {
            return Err(NookError::Database(
                "This browser already belongs to the identity.".to_owned(),
            )
            .into());
        }
        let member = self.own_identity_member_keys(&app_key).await?;
        let (log, mut events) = self.identity_log_at(&source, &identity_id).await?;
        let approval = match (RecoveryPassphraseUse {
            log: &log,
            recovery: &recovery,
            typed: &typed,
            member: &member,
            created_at: &Self::identity_event_time()?,
        })
        .approval()
        {
            Ok(approval) => approval,
            Err(refusal) => return Ok(NookRecoveryWordsCheck::of_vault(refusal)?.encode()?),
        };
        let event_id = approval.id()?;
        let bytes = approval.serialize_storage_yaml()?;
        self.identity_source(&source)
            .await?
            .put_identity_event(IdentityEventPut {
                identity_id: &identity_id,
                event_id: &event_id,
                bytes: &bytes,
            })
            .await?;
        events.push(bytes);
        match Self::complete_join_from_log(IdentityJoinLog {
            identity_id: &identity_id,
            app_key: &app_key,
            events: &events,
        })
        .await?
        {
            NookIdentityJoinCompletion::Approved => Ok(NookRecoveryWordsCheck::Accepted.encode()?),
            NookIdentityJoinCompletion::Pending | NookIdentityJoinCompletion::Denied => Err(
                NookError::Database("The recovery approval did not admit this device.".to_owned())
                    .into(),
            ),
        }
    }
}

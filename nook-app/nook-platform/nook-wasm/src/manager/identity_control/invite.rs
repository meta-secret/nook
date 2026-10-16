//! One-time identity invites: a member issues a passphrase-encrypted code
//! that carries the invite key and every owned vault's DEK; its holder signs
//! itself into the identity with them. No member approves the join.

use js_sys::Date;
use nook_core::{
    AgeArmoredCiphertext, CheckedEnrollmentEnvelope, CheckedEnrollmentIssuance, EnrollmentInvite,
    EnrollmentInviteVault, EnrollmentIssuance, EnrollmentLinkInput, EventId,
    IdentityControlOperation, IdentityControlState, IdentityEventInsertStatus,
    IdentityEventSigning, IdentityId, IdentityInviteId, IdentityInviteIssue, IdentityInviteJoin,
    IdentityMemberKeys, IdentityVaultEventId, InvitePassphraseOpen, InviteSigningSeed,
    IsoTimestamp, OpenedVaultDek, ReplicatedIdentityStanding, StorageMode, VaultKeys,
};
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

use crate::manager::NookVaultManager;
use crate::storage::identity_log::IdentityLogWrite;
use crate::{
    IdentityDbEnsureLocalIdentityForAppKey, NookDatabase, NookEnrollmentIssueInput, NookError,
};

/// How long an issued invite may be used. The joining client enforces it;
/// the identity log enforces that an invite is used once.
const INVITE_LIFETIME_MILLISECONDS: f64 = 24.0 * 60.0 * 60.0 * 1000.0;

/// Named values a joiner needs to sign itself in at the current provider.
struct InviteJoinAtProvider<'a> {
    invite: &'a EnrollmentInvite,
}

/// The join an invite holder signs: its own member keys, proven with the
/// invite key, and the vault DEKs the invite carries wrapped to it.
pub(super) struct InviteJoinOperation<'a> {
    pub(super) identity_id: &'a IdentityId,
    pub(super) invite: &'a EnrollmentInvite,
    pub(super) member: &'a IdentityMemberKeys,
}

impl InviteJoinOperation<'_> {
    pub(super) fn operation(&self) -> Result<IdentityControlOperation, NookError> {
        let invite_key = self.invite.signing_seed.signing_key()?;
        let epochs = self
            .invite
            .vaults
            .iter()
            .map(|vault| EventId::parse(vault.key_epoch.as_str()))
            .collect::<Result<Vec<_>, _>>()?;
        let keys = self
            .invite
            .vaults
            .iter()
            .map(EnrollmentInviteVault::keys)
            .collect::<Vec<VaultKeys>>();
        let vaults = self
            .invite
            .vaults
            .iter()
            .zip(epochs.iter().zip(keys.iter()))
            .map(|(vault, (key_epoch, keys))| OpenedVaultDek {
                store_id: &vault.store_id,
                key_epoch,
                keys,
            })
            .collect::<Vec<_>>();
        Ok(IdentityInviteJoin {
            identity_id: self.identity_id,
            invite_id: &self.invite.invite_id,
            invite_key: &invite_key,
            member: self.member,
            vaults: &vaults,
        }
        .operation()?)
    }
}

impl NookVaultManager {
    fn invite_expiry() -> Result<IsoTimestamp, NookError> {
        let expires = Date::new_0();
        expires.set_time(Date::now() + INVITE_LIFETIME_MILLISECONDS);
        IsoTimestamp::parse(&String::from(expires.to_iso_string())).map_err(Into::into)
    }

    async fn join_by_invite_at_current_provider(
        &mut self,
        request: InviteJoinAtProvider<'_>,
    ) -> Result<(), NookError> {
        let invite = request.invite;
        let app_key = self.unlocked_app_key()?;
        let identity_id = Self::current_identity_id(&app_key).await?;
        let (log, _) = self
            .union_identity_log_with_current_provider(&identity_id)
            .await?;
        if log.is_empty() {
            return Err(NookError::Database(
                "No identity was found at this provider. Ask for a new code.".to_owned(),
            ));
        }
        let state = IdentityControlState::project(&log)?;
        match ReplicatedIdentityStanding::of(&state, app_key.app_id()) {
            ReplicatedIdentityStanding::ActiveMember => return Ok(()),
            ReplicatedIdentityStanding::Revoked => {
                return Err(NookError::Database(
                    "This installation was removed from the identity.".to_owned(),
                ));
            }
            ReplicatedIdentityStanding::PendingJoin | ReplicatedIdentityStanding::NotListed => {}
        }
        let issued = log.issued_invite_now(&invite.invite_id).ok_or_else(|| {
            NookError::Database(
                "This invite has not reached the sync provider. Try again, or ask for a new code."
                    .to_owned(),
            )
        })?;
        // An unreadable expiry counts as expired.
        let expires_at = Date::parse(issued.expires_at.as_str());
        if expires_at.is_nan() || Date::now() > expires_at {
            return Err(NookError::Database(
                "This invite expired. Ask for a new code.".to_owned(),
            ));
        }
        let member = self.own_identity_member_keys(&app_key).await?;
        let signing = self.ensure_signing_identity().await?;
        let now = Self::identity_event_time()?;
        let operation = InviteJoinOperation {
            identity_id: &identity_id,
            invite,
            member: &member,
        }
        .operation()?;
        let event = log.build_append(
            vec![operation],
            &IdentityEventSigning {
                signing_key: signing.signing_key(),
                created_at: &now,
            },
        )?;
        let event_id = event.id()?;
        let bytes = event.serialize_storage_yaml()?;
        let inserted = log.insert(event).map_err(|rejection| rejection.cause)?;
        if inserted.status != IdentityEventInsertStatus::Applied {
            return Err(NookError::Database(
                "This invite was already used. Ask for a new code.".to_owned(),
            ));
        }
        NookDatabase::save_identity_events(IdentityLogWrite {
            identity_id: &identity_id,
            events: &[(event_id, bytes)],
        })
        .await?;
        self.union_identity_log_with_current_provider(&identity_id)
            .await?;
        Ok(())
    }
}

#[wasm_bindgen]
impl NookVaultManager {
    /// Issue a one-time invite into this identity: record it in the identity
    /// log, then seal the invite key and every owned vault's current DEK into
    /// a passphrase-encrypted enrollment code. Fails when this installation
    /// cannot open an owned vault.
    #[wasm_bindgen]
    pub async fn issue_identity_invite_code(
        &mut self,
        input: &NookEnrollmentIssueInput,
        passphrase: String,
    ) -> Result<String, JsError> {
        let state = self.current_identity_state().await?;
        let opened = self.opened_identity_vault_keys(&state)?;
        let invite_id = IdentityInviteId::generate()?;
        let signing_seed = InviteSigningSeed::generate()?;
        let invite_key = signing_seed.signing_key()?;
        let expires_at = Self::invite_expiry()?;
        let vaults = opened
            .into_iter()
            .map(|(store_id, key_epoch, keys)| {
                Ok(EnrollmentInviteVault {
                    store_id,
                    key_epoch: IdentityVaultEventId::parse(key_epoch.as_str())?,
                    secrets_key: keys.secrets_key,
                    members_key: keys.members_key,
                })
            })
            .collect::<Result<Vec<_>, NookError>>()?;
        self.append_identity_operations(vec![
            IdentityInviteIssue {
                invite_id: &invite_id,
                invite_key: &invite_key,
                expires_at: &expires_at,
            }
            .operation(),
        ])
        .await?;
        let invite = EnrollmentInvite {
            invite_id,
            signing_seed,
            vaults,
        };
        Ok(EnrollmentIssuance {
            input: &input.to_core(invite)?,
            password: &passphrase,
            entry_label: "",
        }
        .check()
        .and_then(CheckedEnrollmentIssuance::issue)?)
    }

    /// The joining installation signs itself into the invited identity with
    /// the code's invite key and vault DEKs, through the mount the code names.
    /// The code is decrypted here, so its keys never reach JavaScript.
    #[wasm_bindgen]
    pub async fn join_identity_with_invite(
        &mut self,
        code: String,
        passphrase: String,
        storage_mode: String,
        github_pat: String,
        github_repo: String,
    ) -> Result<(), JsError> {
        let normalized = EnrollmentLinkInput { input: &code }.normalize();
        let payload = CheckedEnrollmentEnvelope::parse(&normalized)?.decrypt(&passphrase)?;
        let restore_local = self.storage.mode == StorageMode::Local;
        let result = async {
            self.prepare_storage_preserving_vault_metadata(
                &storage_mode,
                &github_pat,
                &github_repo,
            )
            .await?;
            self.join_by_invite_at_current_provider(InviteJoinAtProvider {
                invite: &payload.invite,
            })
            .await
        }
        .await;
        if restore_local {
            self.prepare_storage_preserving_vault_metadata("local", "", "")
                .await?;
        }
        result.map_err(Into::into)
    }

    /// Join with an invite whose passphrase was sealed to this installation
    /// (an identity connecting the browser extension), as a new device
    /// joins: this installation's local identity binds to the invited one,
    /// then it signs itself in. The passphrase opens with this
    /// installation's own app key, here, and never reaches JavaScript.
    #[wasm_bindgen]
    #[expect(
        clippy::too_many_arguments,
        reason = "FFI boundary: wasm-bindgen exports take the invite, the member label and the provider arguments as separate JavaScript scalars"
    )]
    pub async fn join_identity_with_sealed_invite(
        &mut self,
        identity_id: String,
        member_label: String,
        code: String,
        sealed_passphrase: String,
        storage_mode: String,
        github_pat: String,
        github_repo: String,
    ) -> Result<(), JsError> {
        let app_key = self.unlocked_app_key()?;
        NookDatabase::ensure_local_identity_for_app_key(IdentityDbEnsureLocalIdentityForAppKey {
            app_key: &app_key,
            label: &member_label,
        })
        .await?;
        self.bind_local_identity_to_invitation(identity_id).await?;
        let sealed = AgeArmoredCiphertext::from_trusted(sealed_passphrase);
        let passphrase = InvitePassphraseOpen {
            identity: &app_key,
            sealed: &sealed,
        }
        .open()?;
        self.join_identity_with_invite(
            code,
            passphrase.as_str().to_owned(),
            storage_mode,
            github_pat,
            github_repo,
        )
        .await
    }
}

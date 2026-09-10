//! Manager-owned secret transitions behind the one-use handoff handles.
use super::*;
use crate::manager::device_protection::ExtensionIdentityPublication;
use crate::storage::identity_record::HandoffAuthorization;
use crate::storage::identity_record::{
    AuthorizerSigningUpdate, VaultCreationAuthority, VaultCreationAuthorityRef,
};
use crate::storage::identity_record::{IdentityHandoffOperation, PairedVaultEnrollment};

struct AuthenticatedHandoffAuthorizer {
    app_key: nook_core::AppKey,
    signing_public_key: DeviceSigningPublicKey,
}
enum HandoffAuthorizer {
    Unauthenticated,
    Authenticated(AuthenticatedHandoffAuthorizer),
}

impl NookVaultManager {
    pub(in crate::manager) async fn finish_extension_identity_handoff(
        &mut self,
        envelope: &str,
        nonce: &str,
        expected_device_id: &str,
        expected_device_public_key: &str,
        expected_device_signing_public_key: &str,
        context: &NookExtensionIdentityHandoffContext,
    ) -> Result<(), JsError> {
        let private_key =
            mem::take(&mut self.device.extension_handoff_private_key).into_recipient()?;
        let recipient =
            DeviceIdentity::from_secret_str(&DeviceIdentitySecret::parse(&private_key)?)?;
        let expected_signing_public_key =
            DeviceSigningPublicKey::parse(expected_device_signing_public_key)?;
        let material = nook_core::ExtensionIdentityHandoffOpen {
            recipient_identity: &recipient,
            envelope: &AgeArmoredCiphertext::parse(envelope)?,
            expected_nonce: nonce,
            expected_device_id: &DeviceId::parse(expected_device_id)?,
            expected_device_public_key: &DevicePublicKey::parse(expected_device_public_key)?,
            expected_device_signing_public_key: &expected_signing_public_key,
        }
        .open()?;
        let (identity, handoff_signing_seed) = material.into_parts();
        let authorizer = if self.device.identity_private_key.is_empty() {
            HandoffAuthorizer::Unauthenticated
        } else {
            let app_key = self.device_identity()?;
            let signing_public_key = self.ensure_signing_identity().await?.public_key();
            HandoffAuthorizer::Authenticated(AuthenticatedHandoffAuthorizer {
                app_key,
                signing_public_key,
            })
        };
        let enrollment = (context).pending_extension_enrollment(match &authorizer {
            HandoffAuthorizer::Authenticated(authorizer) => {
                HandoffAuthorization::Authenticated(&authorizer.app_key)
            }
            HandoffAuthorizer::Unauthenticated => HandoffAuthorization::Unauthenticated,
        })?;

        // Age identity may come from a reinstalled extension. Keep any durable
        // authorized signer when the vault already has events so Approve does
        // not append JoinApproved as an unauthorized actor.
        let stored_seed = NookDatabase::load_signing_seed().await?;
        let has_events = self.event_log_has_events().await?;
        let pending_handoff_signing_seed = handoff_signing_seed.clone();
        let importing_existing_vault = matches!(
            &enrollment,
            PendingExtensionIdentityEnrollment::ExistingVaultImport { .. }
        );
        let choice = if importing_existing_vault {
            HandoffSigningSeedChoice::AdoptHandoff {
                seed: handoff_signing_seed,
                persist: false,
            }
        } else {
            nook_core::HandoffSigningSeedSelection {
                handoff_seed: handoff_signing_seed,
                stored_seed,
                event_log: if has_events {
                    nook_core::HandoffEventLog::ExistingEvents
                } else {
                    nook_core::HandoffEventLog::Empty
                },
            }
            .choose()
        };
        let persist_signing_seed = importing_existing_vault
            || matches!(
                &choice,
                HandoffSigningSeedChoice::AdoptHandoff { persist: true, .. }
            );

        let previous_session_signing_seed = mem::take(&mut self.event_log.signing_seed);
        self.device.identity_private_key.zeroize();
        self.device.id = identity.device_id().as_str().to_owned();
        self.device.identity_private_key = identity.secret_string().into_inner();
        self.event_log.signing_seed.zeroize();
        match choice {
            HandoffSigningSeedChoice::KeepStored { seed } => {
                self.event_log.signing_seed = seed;
            }
            HandoffSigningSeedChoice::AdoptHandoff { seed, persist } => {
                self.event_log.signing_seed = seed;
                debug_assert_eq!(persist, persist_signing_seed);
            }
        }
        self.device.pending_extension_handoff =
            ExtensionIdentityPublication::Staged(PendingExtensionIdentityHandoff {
                enrollment,
                authorizer_signing: match authorizer {
                    HandoffAuthorizer::Authenticated(AuthenticatedHandoffAuthorizer {
                        app_key,
                        signing_public_key,
                    }) => AuthorizerSigningUpdate::Verified(AuthorizerMemberSigning {
                        app_id: app_key.app_id().clone(),
                        signing_public_key,
                    }),
                    HandoffAuthorizer::Unauthenticated => AuthorizerSigningUpdate::RetainMembership,
                },
                signing_public_key: expected_signing_public_key,
                handoff_signing_seed: pending_handoff_signing_seed,
                persist_signing_seed,
                previous_session_signing_seed,
            });
        Ok(())
    }
    pub(in crate::manager) fn extension_identity_handoff_requires_connect(&self) -> bool {
        matches!(
            &self.device.pending_extension_handoff,
            ExtensionIdentityPublication::Staged(_)
        )
    }
    pub(in crate::manager) fn mark_extension_identity_handoff_existing_vault_import(
        &mut self,
    ) -> Result<(), JsError> {
        let store_id = StoreId::parse(&self.vault.store_id)?;
        let pending = self
            .device
            .pending_extension_handoff
            .pending_mut()
            .map_err(|error| JsError::new(&error.to_string()))?;
        pending.enrollment = PendingExtensionIdentityEnrollment::ExistingVaultImport { store_id };
        pending.authorizer_signing = AuthorizerSigningUpdate::RetainMembership;
        pending.persist_signing_seed = true;
        self.event_log.signing_seed.zeroize();
        self.event_log
            .signing_seed
            .clone_from(&pending.handoff_signing_seed);
        Ok(())
    }
    pub(in crate::manager) async fn commit_extension_identity_handoff(
        &mut self,
    ) -> Result<(), JsError> {
        let pending = self
            .device
            .pending_extension_handoff
            .pending()
            .map_err(|error| JsError::new(&error.to_string()))?;
        if !matches!(
            &pending.enrollment,
            PendingExtensionIdentityEnrollment::PairedVault { .. }
        ) {
            return Err(JsError::new(
                "This extension identity handoff must be finalized by verified connect.",
            ));
        }
        let app_key = self.device_identity()?;
        let signing_seed = if pending.persist_signing_seed {
            HandoffSignerPublication::ReplaceWith(self.event_log.signing_seed.as_str())
        } else {
            HandoffSignerPublication::RetainStored
        };
        let PendingExtensionIdentityEnrollment::PairedVault {
            authorizer,
            store_id,
        } = &pending.enrollment
        else {
            return Err(JsError::new(
                "This extension identity handoff must be finalized by verified connect.",
            ));
        };
        identity_record::IdentityHandoffCommit {
            app_key: &app_key,
            signing_public_key: &pending.signing_public_key,
            authorizer_signing: &pending.authorizer_signing,
            operation: IdentityHandoffOperation::PairedVault(PairedVaultEnrollment {
                authorizer,
                store_id,
            }),
            signing_seed,
        }
        .commit()
        .await?;
        Ok(())
    }
    pub(in crate::manager) fn confirm_extension_identity_handoff(&mut self) {
        self.device.pending_extension_handoff = ExtensionIdentityPublication::Idle;
    }
    pub(in crate::manager) fn rollback_extension_identity_handoff(&mut self) {
        if let ExtensionIdentityPublication::Staged(mut pending) =
            mem::take(&mut self.device.pending_extension_handoff)
        {
            self.event_log.signing_seed.zeroize();
            self.event_log.signing_seed = mem::take(&mut pending.previous_session_signing_seed);
        }
        self.device.id.clear();
        self.lock_device_identity();
        self.reset_vault_session();
    }
}

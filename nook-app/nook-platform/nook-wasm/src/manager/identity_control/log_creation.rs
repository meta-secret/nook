//! Create the replicated identity control log, or bind a new installation to
//! the identity an enrollment code invites it into.

use crate::TypedOutput;
use nook_core::{
    FreshIdentityNaming, IdentityControlLog, IdentityControlOperation, IdentityControlState,
    IdentityEvent, IdentityEventInsertStatus, IdentityEventSigning, IdentityGenesisRequest,
    IdentityId, IdentityInvitationBinding, IdentityInvitationBindingRequest, IdentityMemberKind,
    IdentityPublicName, LocalIdentityLog, MultiDeviceError, PublicKeyringLabel,
};
use serde::{Deserialize, Serialize};
use tsify::Tsify;
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

use crate::manager::NookVaultManager;
use crate::storage::identity_log::IdentityLogWrite;
use crate::storage::identity_record::KeyringDbRebindLocalIdentity;
use crate::{NookDatabase, NookError};

/// Result of making sure the current identity has a control log.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum NookIdentityLogEnsureOutcome {
    Existing,
    Created,
}

struct IdentityLogCreation<'a> {
    identity_id: &'a IdentityId,
    public_name: IdentityPublicName,
}

impl NookVaultManager {
    /// Whether the app key's local identity already has a control log.
    pub(in crate::manager) async fn local_identity_log(
        app_key: &nook_core::AppKey,
    ) -> Result<LocalIdentityLog, NookError> {
        let local = Self::current_identity_id(app_key).await?;
        Ok(
            if NookDatabase::load_identity_log(&local).await?.is_empty() {
                LocalIdentityLog::Empty
            } else {
                LocalIdentityLog::Replicated
            },
        )
    }

    /// Sign the founder genesis for an identity that has no log yet. Vaults
    /// join the log as they are opened here; other apps join by request.
    async fn create_identity_log(
        &mut self,
        request: IdentityLogCreation<'_>,
    ) -> Result<(), NookError> {
        let IdentityLogCreation {
            identity_id,
            public_name,
        } = request;
        let app_key = self.unlocked_app_key()?;
        let founder = self.own_identity_member_keys(&app_key).await?;
        let signing = self.ensure_signing_identity().await?;
        let created_at = Self::identity_event_time()?;
        let sign = || IdentityEventSigning {
            signing_key: signing.signing_key(),
            created_at: &created_at,
        };
        let genesis = IdentityEvent::genesis(IdentityGenesisRequest {
            identity_id,
            founder,
            signing: sign(),
        })?;
        let mut log = IdentityControlLog::new(identity_id.clone())
            .insert(genesis)
            .map_err(|rejection| rejection.cause)?
            .log;
        if let IdentityPublicName::Published(name) = public_name {
            let event = log.build_append(
                vec![IdentityControlOperation::IdentityPublicNameSet { name }],
                &sign(),
            )?;
            let inserted = log.insert(event).map_err(|rejection| rejection.cause)?;
            if inserted.status != IdentityEventInsertStatus::Applied {
                return Err(NookError::Database(
                    "The new keyring name did not apply.".to_owned(),
                ));
            }
            log = inserted.log;
        }
        let state = IdentityControlState::project(&log)?;
        NookDatabase::create_identity_events(IdentityLogWrite {
            identity_id,
            events: &log.storage_bytes()?,
        })
        .await?;
        Self::apply_identity_state_locally(&app_key, &state).await
    }
}

#[wasm_bindgen]
impl NookVaultManager {
    /// Create the identity's control log when this identity has none yet.
    #[wasm_bindgen]
    pub async fn ensure_identity_control_log(
        &mut self,
    ) -> Result<tsify::Ts<NookIdentityLogEnsureOutcome>, JsError> {
        let app_key = self.unlocked_app_key()?;
        let identity_id = Self::current_identity_id(&app_key).await?;
        let outcome = if NookDatabase::load_identity_log(&identity_id)
            .await?
            .is_empty()
        {
            self.create_identity_log(IdentityLogCreation {
                identity_id: &identity_id,
                public_name: IdentityPublicName::Unpublished,
            })
            .await?;
            NookIdentityLogEnsureOutcome::Created
        } else {
            NookIdentityLogEnsureOutcome::Existing
        };
        Ok(outcome.encode()?)
    }

    /// Bind a freshly protected local identity to the identity an enrollment
    /// code invites it into, under the name the code carried. A local identity
    /// that already belongs to an identity refuses: another identity joins
    /// with its own app key.
    #[wasm_bindgen]
    pub async fn bind_local_identity_to_invitation(
        &mut self,
        identity_id: String,
        identity_label: String,
    ) -> Result<(), JsError> {
        let invited = IdentityId::parse(&identity_id)?;
        let app_key = self.unlocked_app_key()?;
        let local_log = Self::local_identity_log(&app_key).await?;
        let binding = NookDatabase::load_identity_directory()
            .await?
            .invitation_binding(&IdentityInvitationBindingRequest {
                app_key: &app_key,
                invited: &invited,
                local_log,
            })
            .map_err(NookDatabase::map_domain_error)?;
        let IdentityInvitationBinding::Adopt { local_identity_id } = binding else {
            return Ok(());
        };
        NookDatabase::rebind_local_identity(KeyringDbRebindLocalIdentity {
            local_identity_id: &local_identity_id,
            replicated_identity_id: &invited,
            label: nook_core::AdoptedIdentityLabel::Invited(&identity_label),
        })
        .await?;
        Ok(())
    }

    /// Explicitly found and name this browser's fresh keyring. Retrying the
    /// same committed name is a no-op for the log.
    #[wasm_bindgen]
    pub async fn name_fresh_identity(&mut self, label: String) -> Result<(), JsError> {
        let label =
            PublicKeyringLabel::parse(&label).map_err(|error| JsError::new(&error.to_string()))?;
        let app_key = self.unlocked_app_key()?;
        let identity_id = Self::current_identity_id(&app_key).await?;
        let log = NookDatabase::load_identity_log(&identity_id).await?;
        if log.is_empty() {
            NookDatabase::load_identity_directory()
                .await?
                .fresh_identity_for_naming(&FreshIdentityNaming {
                    app_key: &app_key,
                    label: label.as_str(),
                    local_log: LocalIdentityLog::Empty,
                })
                .map_err(NookDatabase::map_domain_error)?;
            self.create_identity_log(IdentityLogCreation {
                identity_id: &identity_id,
                public_name: IdentityPublicName::Published(label),
            })
            .await?;
        } else {
            let state = IdentityControlState::project(&log)?;
            match (&state.public_name, state.member(app_key.app_id())) {
                (IdentityPublicName::Published(name), Some(member))
                    if name == &label && matches!(member.kind, IdentityMemberKind::App { .. }) =>
                {
                    Self::apply_identity_state_locally(&app_key, &state).await?;
                }
                _ => {
                    return Err(NookDatabase::map_domain_error(
                        MultiDeviceError::IdentityAlreadyInUse {
                            identity_id: identity_id.to_string(),
                        },
                    )
                    .into());
                }
            }
        }
        Ok(())
    }

    /// Explicitly publish a new display name for the unlocked current keyring.
    #[wasm_bindgen]
    pub async fn rename_identity(&mut self, label: String) -> Result<(), JsError> {
        let name =
            PublicKeyringLabel::parse(&label).map_err(|error| JsError::new(&error.to_string()))?;
        self.append_identity_operations(vec![IdentityControlOperation::IdentityPublicNameSet {
            name,
        }])
        .await?;
        Ok(())
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use super::*;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    fn js<T>(result: Result<T, JsError>) -> anyhow::Result<T> {
        result.map_err(|error| anyhow::anyhow!("{error:?}"))
    }

    async fn identity_label() -> anyhow::Result<String> {
        Ok(NookDatabase::load_identity_directory()
            .await?
            .selected()?
            .label
            .clone())
    }

    #[wasm_bindgen_test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    async fn a_fresh_identity_takes_its_name_until_its_log_exists() -> anyhow::Result<()> {
        let mut manager = NookVaultManager::new();
        js(manager.delete_local_browser_data().await)?;
        js(manager
            .finish_pin_device_protection("naming pin".to_owned())
            .await)?;
        // A blank name is refused and changes nothing.
        let before = identity_label().await?;
        assert!(manager.name_fresh_identity("   ".to_owned()).await.is_err());
        assert_eq!(identity_label().await?, before);

        // The key's own identity exists here, so it carries the name now.
        js(manager.name_fresh_identity(" Solo ".to_owned()).await)?;
        assert_eq!(identity_label().await?, "Solo");
        let app_key = manager.unlocked_app_key()?;
        let identity_id = NookVaultManager::current_identity_id(&app_key).await?;
        let named = NookDatabase::load_identity_log(&identity_id).await?;
        assert_eq!(
            IdentityControlState::project(&named)?.public_name,
            IdentityPublicName::Published(PublicKeyringLabel::parse("Solo")?)
        );
        let original = named.storage_bytes()?;
        assert_eq!(original.len(), 2);
        js(manager.name_fresh_identity("Solo".to_owned()).await)?;
        assert_eq!(
            NookDatabase::load_identity_log(&identity_id)
                .await?
                .storage_bytes()?,
            original
        );

        // Once its control log exists, the identity keeps its name.
        js(manager.ensure_identity_control_log().await)?;
        assert!(
            manager
                .name_fresh_identity("Other".to_owned())
                .await
                .is_err()
        );
        assert_eq!(identity_label().await?, "Solo");
        js(manager.rename_identity(" Team ".to_owned()).await)?;
        assert_eq!(identity_label().await?, "Team");
        let log = NookDatabase::load_identity_log(&identity_id).await?;
        assert_eq!(
            IdentityControlState::project(&log)?.public_name,
            IdentityPublicName::Published(PublicKeyringLabel::parse("Team")?)
        );
        assert_eq!(log.storage_bytes()?.len(), 3);
        js(manager.delete_local_browser_data().await)?;
        Ok(())
    }

    #[wasm_bindgen_test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    async fn ensuring_a_log_does_not_publish_the_local_directory_label() -> anyhow::Result<()> {
        let mut manager = NookVaultManager::new();
        js(manager.delete_local_browser_data().await)?;
        js(manager
            .finish_pin_device_protection("naming pin".to_owned())
            .await)?;
        let app_key = manager.unlocked_app_key()?;
        let identity_id = NookVaultManager::current_identity_id(&app_key).await?;
        js(manager.ensure_identity_control_log().await)?;
        let log = NookDatabase::load_identity_log(&identity_id).await?;
        assert_eq!(log.storage_bytes()?.len(), 1);
        assert_eq!(
            IdentityControlState::project(&log)?.public_name,
            IdentityPublicName::Unpublished
        );
        js(manager.delete_local_browser_data().await)?;
        Ok(())
    }
}

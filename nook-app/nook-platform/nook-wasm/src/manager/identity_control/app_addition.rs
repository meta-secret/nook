//! The browser extension is an app of the keyring with a key of its own.
//!
//! The web app adds it by the keys its connect request carried: it becomes
//! a member of the keyring with every vault's DEK encrypted to its key. The
//! web app then hands it the keyring's control log, and the extension
//! completes its join from that log (`join_identity_from_log`). Nothing is
//! read from a sync provider, so it works before the keyring has one.

use nook_core::{
    AppId, DevicePublicKey, DeviceSigningPublicKey, IdentityMemberAdd, IdentityMemberKeys,
    MemberLabel,
};
use serde::{Deserialize, Serialize};
use tsify::Tsify;
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

use super::UNENCODABLE_TYPED_OUTPUT;
use crate::manager::NookVaultManager;
use crate::{NookDatabase, NookError};

/// The keyring's control log, as the web app hands it to an app it added.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct NookIdentityLogExport {
    pub identity_id: String,
    /// Each event's stored text.
    pub events: Vec<String>,
}

#[wasm_bindgen]
impl NookVaultManager {
    /// Add an app the keyring's member was shown directly, as the browser
    /// extension that connects: it becomes a member with every vault's DEK
    /// encrypted to its key, and reads the keyring's name. The app id must
    /// be the one its public key derives. Returns whether it was added; an
    /// app that already is a member stays as it is.
    #[wasm_bindgen]
    pub async fn add_identity_member(
        &mut self,
        app_id: String,
        encryption_public_key: String,
        signing_public_key: String,
        label: String,
    ) -> Result<bool, JsError> {
        // Only the Simple app adds the extension; Sentinel never connects to it.
        self.application.validate_extension_keyring_approval()?;
        let app_id = AppId::parse(&app_id)?;
        let encryption_public_key = DevicePublicKey::parse(&encryption_public_key)?;
        if encryption_public_key.try_app_id()? != app_id {
            return Err(NookError::Database(
                "The app's id does not match its public key.".to_owned(),
            )
            .into());
        }
        let member = IdentityMemberKeys {
            app_id,
            encryption_public_key,
            signing_public_key: DeviceSigningPublicKey::parse(&signing_public_key)?,
            label: MemberLabel::from_trusted(label),
        };
        let state = self.current_identity_state().await?;
        if state.member(&member.app_id).is_some() {
            return Ok(false);
        }
        let approver = self.unlocked_app_key()?;
        let operations = IdentityMemberAdd {
            state: &state,
            approver: &approver,
            member: &member,
        }
        .addition()?;
        self.append_identity_operations(operations).await?;
        Ok(true)
    }

    /// The control log of the keyring in use, for an app it just added.
    #[wasm_bindgen]
    pub async fn export_identity_log(&self) -> Result<tsify::Ts<NookIdentityLogExport>, JsError> {
        let app_key = self.unlocked_app_key()?;
        let identity_id = Self::current_identity_id(&app_key).await?;
        let log = NookDatabase::load_identity_log(&identity_id).await?;
        let events = log
            .storage_bytes()?
            .into_iter()
            .map(|(_, bytes)| {
                String::from_utf8(Vec::from(bytes)).map_err(|_| {
                    NookError::Database("A keyring event is not stored as text.".to_owned())
                })
            })
            .collect::<Result<Vec<_>, NookError>>()?;
        let export = NookIdentityLogExport {
            identity_id: identity_id.as_str().to_owned(),
            events,
        };
        Tsify::into_ts(&export).map_err(|_| JsError::new(UNENCODABLE_TYPED_OUTPUT))
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use super::*;
    use nook_core::{AppKey, SigningIdentity};
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    fn js<T>(result: Result<T, JsError>) -> anyhow::Result<T> {
        result.map_err(|error| anyhow::anyhow!("{error:?}"))
    }

    /// The extension's keys as its connect request carries them.
    struct ExtensionKeys {
        app: AppKey,
        signer: SigningIdentity,
    }

    impl ExtensionKeys {
        fn generate() -> anyhow::Result<Self> {
            Ok(Self {
                app: AppKey::generate()?,
                signer: SigningIdentity::generate()?.0,
            })
        }

        async fn add_to(&self, manager: &mut NookVaultManager) -> Result<bool, JsError> {
            manager
                .add_identity_member(
                    self.app.app_id().to_string(),
                    self.app.public_key().to_string(),
                    self.signer.public_key().to_string(),
                    "Nook Extension".to_owned(),
                )
                .await
        }
    }

    #[wasm_bindgen_test]
    async fn the_web_app_adds_the_extension_once_and_hands_it_the_keyring_log() -> anyhow::Result<()>
    {
        let mut manager = NookVaultManager::new();
        js(manager.delete_local_browser_data().await)?;
        js(manager
            .finish_pin_device_protection("web app pin".to_owned())
            .await)?;
        js(manager.ensure_identity_control_log().await)?;
        let extension = ExtensionKeys::generate()?;

        assert!(js(extension.add_to(&mut manager).await)?);
        // A member already: adding it again changes nothing.
        assert!(!js(extension.add_to(&mut manager).await)?);
        let state = manager.current_identity_state().await?;
        assert!(state.member(extension.app.app_id()).is_some());

        let export = js(manager.export_identity_log().await)?
            .to_rust()
            .map_err(|error| anyhow::anyhow!("{error:?}"))?;
        let identity_id =
            NookVaultManager::current_identity_id(&manager.unlocked_app_key()?).await?;
        assert_eq!(export.identity_id, identity_id.as_str());
        assert_eq!(
            export.events.len(),
            NookDatabase::load_identity_log(&identity_id)
                .await?
                .storage_bytes()?
                .len()
        );
        js(manager.delete_local_browser_data().await)?;
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn an_app_id_its_key_does_not_derive_is_refused() -> anyhow::Result<()> {
        let mut manager = NookVaultManager::new();
        js(manager.delete_local_browser_data().await)?;
        js(manager
            .finish_pin_device_protection("web app pin".to_owned())
            .await)?;
        js(manager.ensure_identity_control_log().await)?;
        let extension = ExtensionKeys::generate()?;
        let other = AppKey::generate()?;

        let refused = manager
            .add_identity_member(
                other.app_id().to_string(),
                extension.app.public_key().to_string(),
                extension.signer.public_key().to_string(),
                "Nook Extension".to_owned(),
            )
            .await;

        assert!(refused.is_err());
        let state = manager.current_identity_state().await?;
        assert!(state.member(extension.app.app_id()).is_none());
        assert!(state.member(other.app_id()).is_none());
        js(manager.delete_local_browser_data().await)?;
        Ok(())
    }
}

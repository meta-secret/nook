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

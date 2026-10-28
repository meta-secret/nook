//! Check which vaults a passkey or a backup password opens, read-only.
//!
//! A source is this browser, a Google Drive account's Nook root, or a local
//! folder the user picked. Its identity logs and vault logs are read, the
//! checked key or password is tried against them in memory, and the result
//! says which vaults it opens by name. Nothing is stored, imported, or
//! written, and the passkey's re-derived app key is dropped afterwards.
use super::wasm_bindgen;
use crate::storage::local_folder::LocalFolderHandles;
use crate::storage::provider_vault_listing::DriveVaultListing;
use crate::{BrowserPasskeyClient, DriveStorageClient, NookDatabase, NookError};
use nook_core::{
    BackupPasswordAccessCheck, CheckedVaultEvents, CredentialCheckReport, DeviceIdentity, EventId,
    EventLogNamespaceKind, EventStorageBytes, LocalEventWrite, PasskeyAccessCheck,
    PasskeyAccessProfile, PasskeyMemberSigner, PasskeyRecoveryInput, PasskeyRecoveryRequest,
    ProviderIdentityLogEvents, SigningSeedHex, StoreId, WebAuthnCredentialId, WebAuthnPrfOutput,
    WebAuthnUserHandle, WrappedDeviceIdentity,
};
use serde::{Deserialize, Serialize};
use tsify::Tsify;
use wasm_bindgen::JsError;
use zeroize::Zeroize;

/// Where a check reads identity logs and vaults from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum NookAccessCheckSource {
    /// The identities and vaults stored on this browser.
    ThisBrowser,
    /// A signed-in Google account's Nook root.
    #[serde(rename_all = "camelCase")]
    GoogleDrive { access_token: String },
    /// A local folder the user picked, by its stored handle.
    #[serde(rename_all = "camelCase")]
    LocalFolder { handle_id: String },
}

/// A source's identity logs and vaults, read without any key.
pub(crate) struct SourceContents {
    pub(crate) identity_logs: Vec<ProviderIdentityLogEvents>,
    pub(crate) vaults: Vec<CheckedVaultEvents>,
}

impl SourceContents {
    /// Ask for one passkey and check what it opens here.
    pub(crate) async fn check_passkey(
        self,
        rp_id: &str,
    ) -> Result<tsify::Ts<CredentialCheckReport>, JsError> {
        let passkey = CheckedPasskey { rp_id }.derive().await?;
        let report = PasskeyAccessCheck {
            app_key: &passkey.app_key,
            fingerprint: passkey.fingerprint,
            identity_logs: self.identity_logs,
            vaults: self.vaults,
        }
        .report()?;
        Tsify::into_ts(&report).map_err(|_| JsError::new("Typed WASM output could not be encoded."))
    }

    /// Check what a typed backup password opens here.
    pub(crate) fn check_backup_password(
        self,
        password: &str,
    ) -> Result<tsify::Ts<CredentialCheckReport>, JsError> {
        let report = BackupPasswordAccessCheck {
            password,
            vaults: self.vaults,
        }
        .report()?;
        Tsify::into_ts(&report).map_err(|_| JsError::new("Typed WASM output could not be encoded."))
    }
}

impl NookAccessCheckSource {
    pub(crate) async fn contents(&self) -> Result<SourceContents, NookError> {
        match self {
            Self::ThisBrowser => Self::browser_contents().await,
            Self::GoogleDrive { access_token } => {
                let root = DriveStorageClient::new(access_token)
                    .existing_nook_root()
                    .await?;
                let drive = DriveVaultListing {
                    token: access_token,
                    root: &root,
                };
                Ok(SourceContents {
                    identity_logs: drive.identity_log_events().await?,
                    vaults: drive.all_vault_events().await?,
                })
            }
            Self::LocalFolder { handle_id } => Self::folder_contents(handle_id).await,
        }
    }

    async fn browser_contents() -> Result<SourceContents, NookError> {
        let directory = NookDatabase::load_identity_directory().await?;
        let mut identity_logs = Vec::new();
        for record in directory.identities() {
            let log = NookDatabase::load_identity_log(&record.identity_id).await?;
            identity_logs.push(ProviderIdentityLogEvents {
                identity_id: record.identity_id.clone(),
                events: log
                    .storage_bytes()?
                    .into_iter()
                    .map(|(_, bytes)| bytes)
                    .collect(),
            });
        }
        let mut vaults = Vec::new();
        for entry in NookDatabase::load_vault_registry().await?.vaults {
            let store_id = StoreId::parse(&entry.store_id)?;
            // A vault no identity on this browser owns is not one it can check.
            let Some(owner) = directory
                .identities()
                .iter()
                .find(|record| record.owns_vault(&store_id))
            else {
                continue;
            };
            vaults.push(CheckedVaultEvents {
                events: NookDatabase::load_local_event_writes(store_id.as_str()).await?,
                filed_under: owner.identity_id.clone(),
                store_id,
            });
        }
        Ok(SourceContents {
            identity_logs,
            vaults,
        })
    }

    async fn folder_contents(handle_id: &str) -> Result<SourceContents, NookError> {
        let folder = LocalFolderHandles::current().open_folder(handle_id).await?;
        let mut identity_logs = Vec::new();
        for placed in folder
            .list_namespaces(EventLogNamespaceKind::Identity)
            .await?
        {
            identity_logs.push(ProviderIdentityLogEvents {
                identity_id: placed.identity().clone(),
                events: folder
                    .read_events(&placed)
                    .await?
                    .into_iter()
                    .map(|file| EventStorageBytes::from(file.content.into_bytes()))
                    .collect(),
            });
        }
        let mut vaults = Vec::new();
        for placed in folder.list_namespaces(EventLogNamespaceKind::Vault).await? {
            let nook_core::EventLogLocation::Vault(store_id) = placed.location().clone() else {
                continue;
            };
            let mut events = Vec::new();
            for file in folder.read_events(&placed).await? {
                events.push(LocalEventWrite {
                    event_id: EventId::parse(&file.event_id)?,
                    bytes: file.content.into_bytes().into(),
                });
            }
            vaults.push(CheckedVaultEvents {
                store_id,
                filed_under: placed.identity().clone(),
                events,
            });
        }
        Ok(SourceContents {
            identity_logs,
            vaults,
        })
    }
}

/// One passkey the browser lets the user pick, on this relying party.
pub(crate) struct CheckedPasskey<'a> {
    pub(crate) rp_id: &'a str,
}

/// A passkey's re-derived app key and member signer, the record that
/// protects the app key with that passkey, and the fingerprint that names it.
pub(crate) struct DerivedPasskey {
    pub(crate) fingerprint: String,
    pub(crate) app_key: DeviceIdentity,
    pub(crate) signer: SigningSeedHex,
    pub(crate) record: WrappedDeviceIdentity,
}

impl CheckedPasskey<'_> {
    /// Ask for one passkey and re-derive this device's app key and its
    /// member signer from its PRF output, in memory only.
    pub(crate) async fn derive(&self) -> Result<DerivedPasskey, JsError> {
        let request_options = BrowserPasskeyClient::recovery_options(self.rp_id)?;
        let credential = BrowserPasskeyClient::get_credential(&request_options).await?;
        let raw_credential_id = BrowserPasskeyClient::credential_id(&credential)?;
        let fingerprint = PasskeyAccessProfile::credential_identifier(&raw_credential_id);
        let credential_id = WebAuthnCredentialId::try_from(raw_credential_id)?;
        let user_handle = WebAuthnUserHandle::try_from(
            BrowserPasskeyClient::assertion_user_handle(&credential)?,
        )?;
        let mut prf_output = BrowserPasskeyClient::require_prf_output(&credential)?;
        let typed_prf_output = WebAuthnPrfOutput::try_from(prf_output.clone());
        prf_output.zeroize();
        let material = PasskeyRecoveryRequest::deterministic().recover(&PasskeyRecoveryInput {
            credential_id: &credential_id,
            user_handle: &user_handle,
            prf_output: &typed_prf_output?,
        })?;
        let PasskeyMemberSigner::Derived(signer) = material.signer() else {
            return Err(JsError::new(
                "A passkey-derived app key must derive its member signer.",
            ));
        };
        Ok(DerivedPasskey {
            fingerprint,
            app_key: DeviceIdentity::from_secret_str(material.identity_secret())?,
            signer: signer.clone(),
            record: material.record().clone(),
        })
    }
}

/// Ask for one passkey and report which of the source's vaults it opens,
/// each proven by decrypting its key and name.
#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub async fn check_passkey_access(
    source: &tsify::Ts<NookAccessCheckSource>,
    rp_id: &str,
) -> Result<tsify::Ts<CredentialCheckReport>, JsError> {
    let source = source
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;
    source.contents().await?.check_passkey(rp_id).await
}

/// Report which of the source's vaults a typed backup password opens.
#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub async fn check_backup_password_access(
    source: &tsify::Ts<NookAccessCheckSource>,
    password: String,
) -> Result<tsify::Ts<CredentialCheckReport>, JsError> {
    let source = source
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;
    let password = zeroize::Zeroizing::new(password);
    source.contents().await?.check_backup_password(&password)
}

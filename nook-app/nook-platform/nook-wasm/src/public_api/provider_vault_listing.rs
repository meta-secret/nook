//! What a provider already holds, for the setup and import screens.
//!
//! The listing reads transport metadata, plus the events of vaults no identity
//! here holds to see whether a backup password opens them. Nothing is
//! decrypted: a vault is named only from this browser's own vault registry,
//! and any other vault's name stays sealed under its key.
use super::wasm_bindgen;
use crate::storage::provider_vault_listing::{
    BrowserHeldVaults, DriveVaultListing, LocalVaultClassification,
};
use crate::{BrowserPasskeyClient, DriveStorageClient};
use nook_core::{
    DeviceIdentity, DriveEventParent, DriveVaultFolderSelection, LocalVaultOccupancy,
    PasskeyRecoveryInput, PasskeyRecoveryRequest, ProviderNameReveal, ProviderNameRevealOutcome,
    ProviderVaultListing, RevealMembership, WebAuthnCredentialId, WebAuthnPrfOutput,
    WebAuthnUserHandle,
};
use serde::{Deserialize, Serialize};
use tsify::Tsify;
use wasm_bindgen::JsError;
use zeroize::Zeroize;

/// What the signed-in Google account's Nook root holds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(tag = "root", rename_all = "camelCase")]
pub enum NookGoogleDriveVaultListing {
    /// The account has no Nook root yet; Connect & sync creates it.
    Absent,
    /// The account's Nook root and the vaults in its subdirectories.
    Found { listing: ProviderVaultListing },
}

/// List the vaults in the account's Nook root without creating it, each with
/// how this device can open it and what the user may do with it. A root the user
/// duplicated by hand fails with `GoogleDriveVaultFolderAmbiguous`.
#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub async fn list_google_drive_vaults(
    access_token: &str,
    local_vault: &tsify::Ts<LocalVaultOccupancy>,
) -> Result<tsify::Ts<NookGoogleDriveVaultListing>, JsError> {
    let local_vault = local_vault
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;
    let listing = match DriveStorageClient::new(access_token)
        .find_vault_folder()
        .await?
    {
        DriveVaultFolderSelection::Create => NookGoogleDriveVaultListing::Absent,
        DriveVaultFolderSelection::Existing(folder_id) => {
            let root = DriveEventParent::shared_folder_id(folder_id.as_str());
            let drive = DriveVaultListing {
                token: access_token,
                root: &root,
            };
            let observations = drive.observations().await?;
            let identity_logs = drive.identity_logs().await?;
            let held = BrowserHeldVaults::load().await?;
            let inspected = drive
                .inspect_vaults(&held.unheld(&observations), held.app_id.as_ref())
                .await?;
            NookGoogleDriveVaultListing::Found {
                listing: LocalVaultClassification {
                    local_vault: &local_vault,
                }
                .listing(observations, &held, &inspected, &identity_logs),
            }
        }
    };
    Tsify::into_ts(&listing).map_err(|_| JsError::new("Typed WASM output could not be encoded."))
}

/// Show the names of the listed vaults with one passkey tap. The passkey
/// re-derives this device's app key; when that key is a member of a listed
/// identity, the identity's name and its vaults' names are decrypted in memory
/// and returned. Nothing is stored, imported, or written to the provider.
#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub async fn reveal_google_drive_names(
    access_token: &str,
    rp_id: &str,
) -> Result<tsify::Ts<ProviderNameRevealOutcome>, JsError> {
    let app_key = passkey_app_key(rp_id).await?;
    let root = DriveStorageClient::new(access_token).existing_nook_root().await?;
    let drive = DriveVaultListing {
        token: access_token,
        root: &root,
    };
    let membership = ProviderNameReveal {
        app_key: &app_key,
        identity_logs: drive.identity_log_events().await?,
    }
    .membership()?;
    let outcome = match membership {
        RevealMembership::NotAMember => ProviderNameRevealOutcome::NotAMember,
        RevealMembership::Member {
            identity_id,
            identity_name,
            vaults,
        } => {
            let listed = drive
                .observations()
                .await?
                .into_iter()
                .map(|observation| observation.store_id)
                .collect::<Vec<_>>();
            let mut names = Vec::new();
            for vault in vaults {
                // A vault the identity keeps elsewhere is not in this listing.
                if listed.contains(&vault.store_id) {
                    names.push(vault.name(drive.vault_events(&vault.store_id).await?)?);
                }
            }
            ProviderNameRevealOutcome::Revealed {
                identity_id,
                identity_name,
                vaults: names,
            }
        }
    };
    Tsify::into_ts(&outcome).map_err(|_| JsError::new("Typed WASM output could not be encoded."))
}

/// This device's app key, re-derived from a passkey's PRF output and kept
/// only in memory.
async fn passkey_app_key(rp_id: &str) -> Result<DeviceIdentity, JsError> {
    let request_options = BrowserPasskeyClient::recovery_options(rp_id)?;
    let credential = BrowserPasskeyClient::get_credential(&request_options).await?;
    let credential_id =
        WebAuthnCredentialId::try_from(BrowserPasskeyClient::credential_id(&credential)?)?;
    let user_handle =
        WebAuthnUserHandle::try_from(BrowserPasskeyClient::assertion_user_handle(&credential)?)?;
    let mut prf_output = BrowserPasskeyClient::require_prf_output(&credential)?;
    let typed_prf_output = WebAuthnPrfOutput::try_from(prf_output.clone());
    prf_output.zeroize();
    let material = PasskeyRecoveryRequest::deterministic().recover(&PasskeyRecoveryInput {
        credential_id: &credential_id,
        user_handle: &user_handle,
        prf_output: &typed_prf_output?,
    })?;
    Ok(DeviceIdentity::from_secret_str(material.identity_secret())?)
}

/// The fixed name of every provider account's Nook root.
#[wasm_bindgen]
#[must_use]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn nook_provider_root_name() -> String {
    nook_core::NOOK_PROVIDER_ROOT_NAME.to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test callback"
        )
    )]
    fn drive_listings_say_whether_the_root_exists() -> anyhow::Result<()> {
        assert_eq!(nook_provider_root_name(), "meta-secret-nook");
        assert_eq!(
            serde_json::to_value(NookGoogleDriveVaultListing::Absent)?,
            serde_json::json!({ "root": "absent" })
        );
        let found = serde_json::to_value(NookGoogleDriveVaultListing::Found {
            listing: ProviderVaultListing {
                vaults: Vec::new(),
                replacement: nook_core::EmptyVaultReplacement::Unavailable,
            },
        })?;
        assert_eq!(
            found,
            serde_json::json!({
                "root": "found",
                "listing": { "vaults": [], "replacement": { "state": "unavailable" } },
            })
        );
        Ok(())
    }
}

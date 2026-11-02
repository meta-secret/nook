//! What a provider already holds, for the setup and import screens.
//!
//! The listing reads transport metadata, plus the events of vaults no identity
//! here holds to see whether a backup password opens them. Nothing is
//! decrypted: a vault is named only from this browser's own vault registry,
//! and any other vault's name stays sealed under its key.
use super::wasm_bindgen;
use crate::DriveStorageClient;
use crate::storage::provider_vault_listing::{DriveVaultListing, ProviderLocation};
use crate::{TypedInput, TypedOutput};
use nook_core::{
    DriveEventParent, DriveVaultFolderSelection, LocalVaultOccupancy, ProviderVaultListing,
};
use serde::{Deserialize, Serialize};
use tsify::Tsify;
use wasm_bindgen::JsError;

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
    let local_vault = local_vault.decode()?;
    let token = DriveStorageClient::access_token(access_token)?;
    let listing = match DriveStorageClient::new(&token)
        .find_vault_folder()
        .await?
    {
        DriveVaultFolderSelection::Create => NookGoogleDriveVaultListing::Absent,
        DriveVaultFolderSelection::Existing(folder_id) => {
            let root = DriveEventParent::shared_folder_id(folder_id.as_str());
            NookGoogleDriveVaultListing::Found {
                listing: DriveVaultListing {
                    token: &token,
                    root: &root,
                }
                .listing(&local_vault)
                .await?,
            }
        }
    };
    Ok(listing.encode()?)
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
                identities: Vec::new(),
                replacement: nook_core::EmptyVaultReplacement::Unavailable,
            },
        })?;
        assert_eq!(
            found,
            serde_json::json!({
                "root": "found",
                "listing": {
                    "vaults": [],
                    "identities": [],
                    "replacement": { "state": "unavailable" },
                },
            })
        );
        Ok(())
    }
}

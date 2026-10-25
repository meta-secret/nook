//! Shared provider targets and the accounts authorized to reach them.
//!
//! Google Drive and iCloud providers are always shared. These exports create
//! the Drive vault folder and manage its authorized accounts; the account
//! lists themselves are the providers' own sharing state.
use super::wasm_bindgen;
use crate::DriveStorageClient;
use crate::DriveStorageClientShareFolderWithEmail;
use crate::NookGoogleDriveFolder;
use nook_core::{AuthorizedAccountList, JoinerAccountCheck};
use tsify::Tsify;
use wasm_bindgen::JsError;

impl DriveStorageClient<'_> {
    async fn authorized_accounts(
        &self,
        folder_id: &str,
    ) -> Result<AuthorizedAccountList, crate::NookError> {
        Ok(AuthorizedAccountList::from_drive_permissions(
            &self.list_folder_permissions(folder_id).await?,
        ))
    }
}

/// The typed account list every export returns to the web layer.
struct AccountListOutput<'a>(&'a AuthorizedAccountList);

impl AccountListOutput<'_> {
    fn encode(self) -> Result<tsify::Ts<AuthorizedAccountList>, JsError> {
        Tsify::into_ts(self.0).map_err(|_| JsError::new("Typed WASM output could not be encoded."))
    }
}

/// Create the My Drive folder a new Google Drive provider syncs under. Only
/// the signed-in account has access until accounts are authorized.
#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub async fn create_google_drive_vault_folder(
    access_token: &str,
    folder_name: &str,
) -> Result<NookGoogleDriveFolder, wasm_bindgen::JsError> {
    let (id, name) = DriveStorageClient::new(access_token)
        .create_shared_vault_folder(folder_name)
        .await?;
    Ok(NookGoogleDriveFolder::new(id, name))
}

/// The individual Google accounts the vault folder is shared with.
#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub async fn list_google_drive_authorized_accounts(
    access_token: &str,
    folder_id: &str,
) -> Result<tsify::Ts<AuthorizedAccountList>, wasm_bindgen::JsError> {
    let accounts = DriveStorageClient::new(access_token)
        .authorized_accounts(folder_id)
        .await?;
    AccountListOutput(&accounts).encode()
}

/// Share the vault folder with one more Google account as a writer, then
/// return the refreshed list.
#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub async fn add_google_drive_authorized_account(
    access_token: &str,
    folder_id: &str,
    email: &str,
) -> Result<tsify::Ts<AuthorizedAccountList>, wasm_bindgen::JsError> {
    let client = DriveStorageClient::new(access_token);
    let email = client.authorized_accounts(folder_id).await?.addition(email)?;
    client
        .share_folder_with_email(DriveStorageClientShareFolderWithEmail {
            folder_id,
            email: email.as_str(),
        })
        .await?;
    AccountListOutput(&client.authorized_accounts(folder_id).await?).encode()
}

/// Revoke one account's access to the vault folder, then return the
/// refreshed list. The owner's access cannot be revoked.
#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub async fn remove_google_drive_authorized_account(
    access_token: &str,
    folder_id: &str,
    email: &str,
) -> Result<tsify::Ts<AuthorizedAccountList>, wasm_bindgen::JsError> {
    let client = DriveStorageClient::new(access_token);
    let accounts = client.authorized_accounts(folder_id).await?;
    let account = accounts.removal(email)?;
    client
        .delete_folder_permission(folder_id, &account.access_id)
        .await?;
    AccountListOutput(&client.authorized_accounts(folder_id).await?).encode()
}

/// The iCloud accounts a fetched `CloudKit` share names.
#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn icloud_authorized_accounts(
    share: &tsify::Ts<nook_core::ICloudShareObservation>,
) -> Result<tsify::Ts<AuthorizedAccountList>, wasm_bindgen::JsError> {
    let share = share
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;
    AccountListOutput(&AuthorizedAccountList::from_icloud_participants(
        &share.participants,
    ))
    .encode()
}

/// The account a device invite names, checked against the provider's list.
#[wasm_bindgen]
#[allow(clippy::needless_pass_by_value)]
#[cfg_attr(
    dylint_lib = "nook_domain_api",
    expect(unowned_function, reason = "FFI boundary: wasm-bindgen export")
)]
pub fn authorized_invite_account(
    accounts: &tsify::Ts<AuthorizedAccountList>,
    email: &str,
) -> Result<String, wasm_bindgen::JsError> {
    let accounts = accounts
        .to_rust()
        .map_err(|_| JsError::new("Typed WASM value could not be converted."))?;
    Ok(accounts.invite_account(email)?.email.as_str().to_owned())
}

/// The joining device must be signed in with the account its invite names.
#[wasm_bindgen]
#[rustfmt::skip] #[cfg_attr(dylint_lib = "nook_domain_api", expect(unowned_function, reason = "FFI boundary: wasm-bindgen export"))] pub fn verify_joiner_account(
    invited: &str,
    signed_in: &str,
) -> Result<(), wasm_bindgen::JsError> {
    Ok(JoinerAccountCheck { invited, signed_in }.verify()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use nook_core::{
        DrivePermissionObservation, ICloudParticipantObservation, ICloudShareObservation,
    };
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    fn invites_and_joins_use_the_rust_account_rules() -> Result<(), JsError> {
        let accounts =
            AuthorizedAccountList::from_drive_permissions(&[DrivePermissionObservation {
                id: "w".into(),
                permission_type: "user".into(),
                role: "writer".into(),
                email_address: "member@example.com".into(),
                deleted: false,
            }]);
        assert_eq!(
            authorized_invite_account(
                &AccountListOutput(&accounts).encode()?,
                " MEMBER@example.com "
            )?,
            "member@example.com"
        );
        assert!(
            authorized_invite_account(&AccountListOutput(&accounts).encode()?, "x@example.com")
                .is_err()
        );
        assert!(verify_joiner_account("member@example.com", "Member@Example.com").is_ok());
        assert!(verify_joiner_account("member@example.com", "other@example.com").is_err());

        let icloud = icloud_authorized_accounts(&Tsify::into_ts(&ICloudShareObservation {
            participants: vec![ICloudParticipantObservation {
                participant_id: "p".into(),
                participant_type: "OWNER".into(),
                permission: "READ_WRITE".into(),
                acceptance_status: "ACCEPTED".into(),
                email_address: "owner@icloud.com".into(),
            }],
        })?)?
        .to_rust()?;
        assert_eq!(icloud.accounts.len(), 1);
        Ok(())
    }
}

//! Add an identity a sync provider holds to this browser, proven by its
//! passkey. The passkey re-derives the member's app key and event signer;
//! Rust decides the addition against the source's identity log, and the
//! identity log, the directory entry under the original id, and the
//! passkey-protected keyring entry are written in one transaction.

use nook_core::{AddedIdentitySelection, IdentityId};
use serde::{Deserialize, Serialize};
use tsify::Tsify;
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

use super::{INVALID_TYPED_INPUT, UNENCODABLE_TYPED_OUTPUT};
use crate::NookDatabase;
use crate::manager::NookVaultManager;
use crate::manager::access_check::NookProviderSource;
use crate::public_api::CheckedPasskey;
use crate::storage::identity_record::KeyringDbSaveAddedPasskeyIdentity;

/// The identity added to this browser.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct NookIdentityAdded {
    #[tsify(type = "string")]
    pub identity_id: IdentityId,
    pub selection: AddedIdentitySelection,
}

#[wasm_bindgen]
impl NookVaultManager {
    /// Ask for one passkey and add the identity it opens at the source to
    /// this browser, under the identity's original id. The passkey must
    /// re-derive a member app key and the signer the identity's log lists
    /// for it; otherwise nothing changes. The identity in use stays
    /// selected; when none is, the added one is. Its vaults open through
    /// the identity's mounts, as for any member.
    #[wasm_bindgen]
    pub async fn add_identity_with_passkey(
        &mut self,
        source: &tsify::Ts<NookProviderSource>,
        identity_id: String,
        rp_id: &str,
    ) -> Result<tsify::Ts<NookIdentityAdded>, JsError> {
        let source = source
            .to_rust()
            .map_err(|_| JsError::new(INVALID_TYPED_INPUT))?;
        let identity_id = IdentityId::parse(&identity_id)?;
        let contents = self.provider_source_contents(&source).await?;
        let passkey = CheckedPasskey { rp_id }.derive().await?;
        let selection =
            NookDatabase::save_added_passkey_identity(KeyringDbSaveAddedPasskeyIdentity {
                app_key: &passkey.app_key,
                record: &passkey.record,
                signer: &passkey.signer,
                identity_id: &identity_id,
                identity_logs: &contents.identity_logs,
            })
            .await?;
        Tsify::into_ts(&NookIdentityAdded {
            identity_id,
            selection,
        })
        .map_err(|_| JsError::new(UNENCODABLE_TYPED_OUTPUT))
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use super::*;
    use nook_core::{
        DeviceIdentity, DeviceKeyProtectionSetup, PasskeyDeviceIdentityMaterial,
        PasskeyMemberSigner, PasskeyRecoveryInput, PasskeyRecoveryRequest,
        ProviderIdentityLogEvents, SigningIdentity, WebAuthnCredentialId, WebAuthnPrfOutput,
        WebAuthnUserHandle,
    };
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    const CREDENTIAL_ID: [u8; 32] = [7; 32];
    const PRF_OUTPUT: [u8; 32] = [21; 32];

    fn js<T>(result: Result<T, JsError>) -> anyhow::Result<T> {
        result.map_err(|error| anyhow::anyhow!("{error:?}"))
    }

    /// What the same passkey re-derives on another browser.
    fn recovered(
        setup: &DeviceKeyProtectionSetup,
    ) -> anyhow::Result<PasskeyDeviceIdentityMaterial> {
        Ok(
            PasskeyRecoveryRequest::deterministic().recover(&PasskeyRecoveryInput {
                credential_id: &WebAuthnCredentialId::try_from(CREDENTIAL_ID.to_vec())?,
                user_handle: &WebAuthnUserHandle::try_from(setup.user_handle().as_ref().to_vec())?,
                prf_output: &WebAuthnPrfOutput::try_from(PRF_OUTPUT.to_vec())?,
            })?,
        )
    }

    #[wasm_bindgen_test]
    async fn a_passkey_identity_is_added_on_another_browser_and_signs_as_its_member()
    -> anyhow::Result<()> {
        let mut manager = NookVaultManager::new();
        js(manager.delete_local_browser_data().await)?;
        let setup = DeviceKeyProtectionSetup::generate()?;
        js(manager
            .finish_device_protection(
                CREDENTIAL_ID.to_vec(),
                setup.user_handle().as_ref().to_vec(),
                setup.prf_input().as_ref().to_vec(),
                PRF_OUTPUT.to_vec(),
            )
            .await)?;
        js(manager.ensure_identity_control_log().await)?;
        let material = recovered(&setup)?;
        let PasskeyMemberSigner::Derived(signer) = material.signer().clone() else {
            anyhow::bail!("a passkey-derived app key derives its signer");
        };
        let derived = SigningIdentity::from_seed_hex_stored(signer.as_str())?.public_key();
        assert_eq!(
            manager.ensure_signing_identity().await?.public_key(),
            derived
        );
        let family = NookDatabase::load_identity_directory()
            .await?
            .selected()?
            .identity_id
            .clone();
        let events = NookDatabase::load_identity_log(&family)
            .await?
            .storage_bytes()?
            .into_iter()
            .map(|(_, bytes)| bytes)
            .collect();

        // Another browser, with its own identity in use.
        js(manager.delete_local_browser_data().await)?;
        js(manager
            .finish_pin_device_protection("other browser pin".to_owned())
            .await)?;
        let selection =
            NookDatabase::save_added_passkey_identity(KeyringDbSaveAddedPasskeyIdentity {
                app_key: &DeviceIdentity::from_secret_str(material.identity_secret())?,
                record: material.record(),
                signer: &signer,
                identity_id: &family,
                identity_logs: &[ProviderIdentityLogEvents {
                    identity_id: family.clone(),
                    events,
                }],
            })
            .await?;

        assert_eq!(selection, AddedIdentitySelection::BesideIdentityInUse);
        assert!(!NookDatabase::load_identity_log(&family).await?.is_empty());
        js(manager.activate_local_identity(family.to_string()).await)?;
        js(manager.unlock_device_identity(PRF_OUTPUT.to_vec()).await)?;
        assert_eq!(
            manager.ensure_signing_identity().await?.public_key(),
            derived
        );
        js(manager.delete_local_browser_data().await)?;
        Ok(())
    }
}

//! Add an identity a sync provider holds to this browser, proven by its
//! passkey. The passkey re-derives the member's app key and event signer;
//! Rust decides the addition against the source's identity log, and the
//! identity log, the directory entry under the original id, and the
//! passkey-protected keyring entry are written in one transaction.

use crate::{TypedInput, TypedOutput};
use nook_core::{AddedIdentitySelection, IdentityId, ProviderIdentityLogEvents};
use serde::{Deserialize, Serialize};
use tsify::Tsify;
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

use crate::NookDatabase;
use crate::manager::NookVaultManager;
use crate::manager::access_check::NookProviderSource;
use crate::public_api::{CheckedPasskey, DerivedPasskey};
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
        self.clear_keyring_passkey_check();
        let source = source.decode()?;
        let identity_id = IdentityId::parse(&identity_id)?;
        let passkey = CheckedPasskey { rp_id }.derive().await?;
        self.add_passkey_member(&source, identity_id, passkey).await
    }

    /// Open with the passkey checked on the current recovery list. Re-read
    /// membership on Open so a revoked key cannot be added from an old check.
    pub async fn open_keyring_with_checked_passkey(
        &mut self,
        source: &tsify::Ts<NookProviderSource>,
        identity_id: String,
    ) -> Result<tsify::Ts<NookIdentityAdded>, JsError> {
        let source = source.decode()?;
        let identity_id = IdentityId::parse(&identity_id)?;
        let passkey = self.take_checked_keyring(&source, &identity_id)?;
        self.add_passkey_member(&source, identity_id, passkey).await
    }
}

impl NookVaultManager {
    async fn add_passkey_member(
        &mut self,
        source: &NookProviderSource,
        identity_id: IdentityId,
        passkey: DerivedPasskey,
    ) -> Result<tsify::Ts<NookIdentityAdded>, JsError> {
        let events = self
            .identity_source(source)
            .await?
            .identity_events(&identity_id)
            .await?;
        let identity_logs = [ProviderIdentityLogEvents {
            identity_id: identity_id.clone(),
            events,
        }];
        let selection =
            NookDatabase::save_added_passkey_identity(KeyringDbSaveAddedPasskeyIdentity {
                app_key: &passkey.app_key,
                record: &passkey.record,
                signer: &passkey.signer,
                identity_id: &identity_id,
                identity_logs: &identity_logs,
            })
            .await?;
        if selection == AddedIdentitySelection::InUse {
            self.reset_vault_session();
            self.use_unlocked_app_key(&passkey.app_key, passkey.signer.into_inner());
        }
        Ok(NookIdentityAdded {
            identity_id,
            selection,
        }
        .encode()?)
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use super::*;
    use crate::public_api::NookRemoteSource;
    use crate::storage::local_folder::LocalFolderHandles;
    use nook_core::{
        DeviceIdentity, DeviceKeyProtectionSetup, PasskeyDeviceIdentityMaterial,
        PasskeyMemberSigner, PasskeyRecoveryInput, PasskeyRecoveryRequest, SigningIdentity,
        WebAuthnCredentialId, WebAuthnPrfOutput, WebAuthnUserHandle,
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

    async fn check_member(
        manager: &mut NookVaultManager,
        source: &NookProviderSource,
        material: &PasskeyDeviceIdentityMaterial,
        family: &IdentityId,
    ) -> anyhow::Result<()> {
        let PasskeyMemberSigner::Derived(signer) = material.signer() else {
            anyhow::bail!("missing passkey signer");
        };
        let key = DerivedPasskey {
            fingerprint: nook_core::PasskeyAccessProfile::credential_identifier(&CREDENTIAL_ID),
            app_key: DeviceIdentity::from_secret_str(material.identity_secret())?,
            record: material.record().clone(),
            signer: signer.clone(),
        };
        let contents = manager.provider_source_contents(source).await?;
        let report = js(manager.check_keyring_with(source.clone(), contents, key))?.decode()?;
        assert!(
            report
                .identities
                .iter()
                .any(|identity| &identity.identity_id == family
                    && identity.outcome == nook_core::IdentityCheckOutcome::Opens)
        );
        Ok(())
    }

    async fn verify_checked_key_scope(
        manager: &mut NookVaultManager,
        source: &NookProviderSource,
        material: &PasskeyDeviceIdentityMaterial,
        family: &IdentityId,
    ) -> anyhow::Result<()> {
        check_member(manager, source, material, family).await?;
        assert!(
            NookDatabase::load_identity_directory()
                .await?
                .identities()
                .is_empty()
        );
        manager.lock_device_identity();
        assert!(
            manager
                .open_keyring_with_checked_passkey(&source.encode()?, family.to_string())
                .await
                .is_err()
        );
        for (other_source, other_id) in [
            (NookProviderSource::CurrentProvider, family.clone()),
            (source.clone(), IdentityId::generate()?),
        ] {
            check_member(manager, source, material, family).await?;
            assert!(
                manager
                    .open_keyring_with_checked_passkey(
                        &other_source.encode()?,
                        other_id.to_string()
                    )
                    .await
                    .is_err()
            );
        }
        Ok(())
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
            .storage_bytes()?;
        let folder = format!("checked-{}", family.as_str());
        let handles = LocalFolderHandles::current();
        handles.register_private_folder(&folder).await?;
        handles
            .write_identity_log(&folder, &family, &events)
            .await?;
        let source = NookProviderSource::Remote(NookRemoteSource::LocalFolder {
            handle_id: nook_core::LocalFolderHandleId::try_from(folder.clone())?,
        });
        for expected in [
            AddedIdentitySelection::InUse,
            AddedIdentitySelection::BesideIdentityInUse,
        ] {
            js(manager.delete_local_browser_data().await)?;
            handles.register_private_folder(&folder).await?;
            if expected == AddedIdentitySelection::BesideIdentityInUse {
                js(manager
                    .finish_pin_device_protection("other browser pin".to_owned())
                    .await)?;
            }
            let current = manager.device_id();

            if expected == AddedIdentitySelection::InUse {
                verify_checked_key_scope(&mut manager, &source, &material, &family).await?;
            }
            check_member(&mut manager, &source, &material, &family).await?;
            let added = js(manager
                .open_keyring_with_checked_passkey(&source.encode()?, family.to_string())
                .await)?
            .decode()?;
            assert_eq!(added.selection, expected);
            assert!(!NookDatabase::load_identity_log(&family).await?.is_empty());
            assert!(
                manager
                    .open_keyring_with_checked_passkey(&source.encode()?, family.to_string())
                    .await
                    .is_err()
            );
            if expected == AddedIdentitySelection::BesideIdentityInUse {
                assert_eq!(manager.device_id(), current);
                js(manager.activate_local_identity(family.to_string()).await)?;
                js(manager.unlock_device_identity(PRF_OUTPUT.to_vec()).await)?;
            }
            assert_eq!(
                manager.ensure_signing_identity().await?.public_key(),
                derived
            );
            assert_eq!(
                js(manager.device_protection_status().await)?,
                nook_core::DeviceProtectionStatus::Unlocked
            );
        }
        js(manager.delete_local_browser_data().await)?;
        Ok(())
    }
}

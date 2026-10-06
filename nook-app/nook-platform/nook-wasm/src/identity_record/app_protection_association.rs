//! Peer descriptors describe protection without granting local unlock.
use super::vault_app_inventory::BrowserIdentityVaultAppInventory;
use super::{NookIdentityMemberSnapshot, NookIdentitySnapshot};
use crate::NookError;
use crate::storage::device_access::peer_protection::PeerProtectionStore;
use nook_core::{AppId, AppProtectionAssociation};
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

impl NookIdentitySnapshot {
    pub(super) async fn with_app_protection_inventory(
        self,
        request: BrowserIdentityVaultAppInventory<'_>,
    ) -> Result<Self, JsError> {
        let mut snapshot = self.with_vault_app_inventory(request).await?;
        let mut members = Vec::new();
        for member in snapshot.members {
            members.push(member.with_peer_protection().await?);
        }
        snapshot.members = members;
        Ok(snapshot)
    }
}

impl NookIdentityMemberSnapshot {
    pub(super) async fn with_peer_protection(mut self) -> Result<Self, crate::NookError> {
        let app_id = AppId::parse(&self.app_id)?;
        self.protection_association = PeerProtectionStore::load(&app_id).await?;
        Ok(self)
    }
}
#[wasm_bindgen]
impl NookIdentityMemberSnapshot {
    #[wasm_bindgen(getter, js_name = protectionAssociation)]
    pub fn protection_association(&self) -> nook_core::DeviceAccessProtectionKind {
        self.protection_association.protection_kind()
    }

    pub fn associated_passkey_fingerprint(&self) -> Result<String, JsError> {
        match &self.protection_association {
            AppProtectionAssociation::PasskeyStandard(profile)
            | AppProtectionAssociation::PasskeyAntiHacker(profile) => {
                Ok(profile.credential_fingerprint.clone())
            }
            AppProtectionAssociation::Unknown | AppProtectionAssociation::PinOrPassphrase => {
                Err(NookError::AppPasskeyAssociationUnavailable.into())
            }
        }
    }

    pub fn associated_passkey_name(&self) -> Result<String, JsError> {
        match &self.protection_association {
            AppProtectionAssociation::PasskeyStandard(profile)
            | AppProtectionAssociation::PasskeyAntiHacker(profile) => Ok(profile.nook_name.clone()),
            AppProtectionAssociation::Unknown | AppProtectionAssociation::PinOrPassphrase => {
                Err(JsError::new("App passkey association is unavailable"))
            }
        }
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod tests {
    use super::*;
    use crate::identity_record::{CurrentAppIdentity, NookIdentitySnapshot};
    use nook_core::{
        AppKey, AppProtectionAssociation, AppProtectionDescriptor, DeviceAccessProtectionKind,
        IdentityRecord, MemberLabelState, PasskeyAccessProfile,
    };
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    async fn peer_descriptor_is_visible_only_for_enrolled_app_and_never_grants_local_unlock()
    -> Result<(), JsError> {
        let mut manager = crate::NookVaultManager::new();
        manager.delete_local_browser_data().await?;
        let browser = AppKey::generate()?;
        let peer = AppKey::generate()?;
        let descriptor = AppProtectionDescriptor {
            app_id: peer.app_id().clone(),
            association: AppProtectionAssociation::PasskeyStandard(PasskeyAccessProfile {
                credential_fingerprint: PasskeyAccessProfile::credential_identifier(&[8; 32]),
                nook_name: "Extension".to_owned(),
                ..PasskeyAccessProfile::default()
            }),
        };
        PeerProtectionStore::save(&descriptor).await?;
        let browser_record =
            IdentityRecord::create_with_app_key("Browser", &browser, MemberLabelState::Unnamed)?;
        let snapshot = NookIdentitySnapshot::from_record(
            &browser_record,
            &CurrentAppIdentity::Identified(browser.app_id().clone()),
            &[],
        );
        assert_eq!(snapshot.members.len(), 1);
        assert_ne!(snapshot.members[0].app_id(), peer.app_id().as_str());
        let peer_record =
            IdentityRecord::create_with_app_key("Peer", &peer, MemberLabelState::Unnamed)?;
        let member = NookIdentityMemberSnapshot::from_member(
            &peer_record.members[0],
            &CurrentAppIdentity::Unidentified,
            &[],
        )
        .with_peer_protection()
        .await?;
        assert_eq!(
            member.protection_association(),
            DeviceAccessProtectionKind::PasskeyStandard
        );
        assert_eq!(
            member.local_protection(),
            DeviceAccessProtectionKind::Missing
        );
        assert_eq!(member.associated_passkey_name()?, "Extension");
        assert_eq!(
            member.associated_passkey_fingerprint()?,
            PasskeyAccessProfile::credential_identifier(&[8; 32])
        );
        assert!(
            crate::NookDatabase::load_keyring()
                .await?
                .entries()
                .is_empty()
        );
        manager.delete_local_browser_data().await?;
        Ok(())
    }
}

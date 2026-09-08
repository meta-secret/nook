use super::{NookVaultManager, VaultNameState};
use nook_companion_core::{
    AdmittedCompanionPairingApproval, CompanionExtensionPairingEndpoint, CompanionPairingApproval,
    CompanionPairingApprovalAttempt, CompanionPairingFailure, CompanionPairingRequest,
    ConsumedCompanionPairingAuthority, ExtensionConnectScope,
};
use nook_core::{AuthProvidersSnapshotData, SigningIdentity, VaultApplication, VaultType};
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

#[wasm_bindgen]
pub struct NookCompanionPairingExtensionEndpoint {
    inner: CompanionExtensionPairingEndpoint,
}

#[wasm_bindgen]
impl NookCompanionPairingExtensionEndpoint {
    #[wasm_bindgen(constructor)]
    #[allow(clippy::needless_pass_by_value)]
    pub fn new(request: CompanionPairingRequest) -> Result<Self, JsError> {
        Ok(Self {
            inner: CompanionExtensionPairingEndpoint::issue(request)
                .map_err(|error| JsError::new(&error.to_string()))?,
        })
    }

    pub fn request(&self) -> Result<CompanionPairingRequest, JsError> {
        self.inner
            .request()
            .map_err(|error| JsError::new(&error.to_string()))
    }

    pub fn take_authority(&mut self) -> Result<NookCompanionPairingApprovalAuthority, JsError> {
        Ok(NookCompanionPairingApprovalAuthority {
            inner: self
                .inner
                .take_authority()
                .map_err(|error| JsError::new(&error.to_string()))?,
        })
    }
}

#[wasm_bindgen]
pub struct NookCompanionPairingApprovalAuthority {
    inner: ConsumedCompanionPairingAuthority,
}

#[wasm_bindgen]
impl NookCompanionPairingApprovalAuthority {
    /// Side-effect-free admission against identities already present in memory.
    #[allow(clippy::needless_pass_by_value)]
    pub fn prevalidate(
        self,
        manager: &NookVaultManager,
        attempt: CompanionPairingApprovalAttempt,
        providers: AuthProvidersSnapshotData,
    ) -> Result<NookPrevalidatedCompanionPairingApproval, JsError> {
        self.prevalidate_inner(manager, attempt, providers)
            .map_err(failure_js_error)
    }
}

impl NookCompanionPairingApprovalAuthority {
    fn prevalidate_inner(
        self,
        manager: &NookVaultManager,
        attempt: CompanionPairingApprovalAttempt,
        providers: AuthProvidersSnapshotData,
    ) -> Result<NookPrevalidatedCompanionPairingApproval, CompanionPairingFailure> {
        let authorized = self.inner.authorize_approval(attempt)?;
        let approval = authorized.approval();
        let vault_name = match &manager.vault.vault_name {
            VaultNameState::Named(name) => name,
            VaultNameState::Unnamed => {
                return Err(CompanionPairingFailure::VaultMismatch);
            }
        };
        if manager.application != VaultApplication::Extension
            || manager.vault.architecture.vault_type != VaultType::Simple
            || manager.vault.store_id != approval.vault_store_id
            || vault_name != &approval.vault_name
        {
            return Err(CompanionPairingFailure::VaultMismatch);
        }
        let identity = manager
            .device_identity()
            .map_err(|_| CompanionPairingFailure::InstallationMismatch)?;
        let signing = SigningIdentity::from_seed_hex_stored(&manager.event_log.signing_seed)
            .map_err(|_| CompanionPairingFailure::InstallationMismatch)?;
        if identity.device_id().as_str() != approval.request.installation.app_id
            || identity.public_key().as_str() != approval.request.installation.encryption_public_key
            || signing.public_key().as_str() != approval.request.installation.signing_public_key
        {
            return Err(CompanionPairingFailure::InstallationMismatch);
        }
        if providers.active_vault_store_id.as_deref() != Some(approval.vault_store_id.as_str())
            || providers.providers.iter().any(|provider| {
                provider.store_id.as_deref() != Some(approval.vault_store_id.as_str())
            })
            || (!approval
                .request
                .scopes
                .contains(&ExtensionConnectScope::SyncProviderCredentials)
                && !providers.providers.is_empty())
        {
            return Err(CompanionPairingFailure::ScopeMismatch);
        }
        let digest = providers
            .companion_pairing_manifest_digest()
            .map_err(|_| CompanionPairingFailure::ProviderManifestMismatch)?;
        if digest.as_str() != approval.provider_manifest_digest.as_str() {
            return Err(CompanionPairingFailure::ProviderManifestMismatch);
        }
        providers
            .authenticate_credentials_for(&identity)
            .map_err(|_| CompanionPairingFailure::ProviderRecipientMismatch)?;
        Ok(NookPrevalidatedCompanionPairingApproval {
            binding: approval.clone(),
            _approval: authorized.admit(),
            _providers: providers,
        })
    }
}

fn failure_js_error(failure: CompanionPairingFailure) -> JsError {
    JsError::new(&format!("{failure:?}"))
}

/// Opaque proof of a manager-bound approval and its sealed provider snapshot.
#[wasm_bindgen]
pub struct NookPrevalidatedCompanionPairingApproval {
    pub(in crate::manager) binding: CompanionPairingApproval,
    _approval: AdmittedCompanionPairingApproval,
    _providers: AuthProvidersSnapshotData,
}

#[cfg(test)]
mod tests {
    use super::*;
    use nook_companion_core::{
        CompanionPairingApproval, CompanionPairingEpochMilliseconds, CompanionPairingError,
        CompanionPairingInstallation, CompanionPairingProviderManifestDigest,
        ExtensionPairingVaultType,
    };
    use nook_core::{ActiveVaultScope, DeviceIdentity, ProviderVaultScope, StorageProviderData};
    use wasm_bindgen_test::wasm_bindgen_test;

    struct PairingFixture {
        manager: NookVaultManager,
        request: CompanionPairingRequest,
        approval: CompanionPairingApproval,
        providers: AuthProvidersSnapshotData,
    }

    impl PairingFixture {
        fn epoch(value: &str) -> anyhow::Result<CompanionPairingEpochMilliseconds> {
            Ok(serde_json::from_str(value)?)
        }

        fn new(with_provider: bool) -> anyhow::Result<Self> {
            let identity = DeviceIdentity::generate()?;
            let (signing, signing_seed) = SigningIdentity::generate()?;
            let mut manager = NookVaultManager::new();
            manager.application = VaultApplication::Extension;
            manager.vault.store_id = "store-1".to_owned();
            manager.vault.vault_name = VaultNameState::Named("Personal".to_owned());
            manager.device.id = identity.device_id().as_str().to_owned();
            manager.device.identity_private_key = identity.secret_string().into_inner();
            manager.event_log.signing_seed = signing_seed.into_inner();

            let mut providers = AuthProvidersSnapshotData {
                providers: Vec::new(),
                active_vault_store_id: ActiveVaultScope::StoreId("store-1".to_owned()),
            };
            let mut scopes = vec![ExtensionConnectScope::VaultAccess];
            if with_provider {
                let mut provider = StorageProviderData::github(
                    "github-1",
                    "GitHub",
                    "github_pat_pairing",
                    "nook",
                    "2026-09-07T00:00:00Z",
                );
                provider.store_id = ProviderVaultScope::StoreId("store-1".to_owned());
                providers.providers.push(provider);
                providers.seal_credentials_for(&identity.public_key())?;
                scopes.push(ExtensionConnectScope::SyncProviderCredentials);
            }
            let request = CompanionPairingRequest {
                request_id: "request-1".to_owned(),
                nonce: "nonce-1".to_owned(),
                issued_at: Self::epoch("100")?,
                expires_at: Self::epoch("200")?,
                vault_type: ExtensionPairingVaultType::Simple,
                installation: CompanionPairingInstallation {
                    extension_runtime_id: "runtime-1".to_owned(),
                    app_id: identity.device_id().as_str().to_owned(),
                    encryption_public_key: identity.public_key().as_str().to_owned(),
                    signing_public_key: signing.public_key().as_str().to_owned(),
                    installation_label: "Extension".to_owned(),
                },
                scopes,
            };
            let approval = CompanionPairingApproval {
                request: request.clone(),
                vault_store_id: "store-1".to_owned(),
                vault_name: "Personal".to_owned(),
                approved_at: "2026-09-07T00:00:00Z".to_owned(),
                provider_manifest_digest: CompanionPairingProviderManifestDigest::parse(
                    providers.companion_pairing_manifest_digest()?.as_str(),
                )?,
            };
            Ok(Self {
                manager,
                request,
                approval,
                providers,
            })
        }

        fn prevalidate(
            self,
        ) -> anyhow::Result<Result<NookPrevalidatedCompanionPairingApproval, CompanionPairingFailure>>
        {
            let mut endpoint = CompanionExtensionPairingEndpoint::issue(self.request)?;
            let authority = endpoint.take_authority()?;
            Ok(
                NookCompanionPairingApprovalAuthority { inner: authority }.prevalidate_inner(
                    &self.manager,
                    CompanionPairingApprovalAttempt {
                        approval: self.approval,
                        observed_at: Self::epoch("150")?,
                    },
                    self.providers,
                ),
            )
        }

        fn align_approval_request(&mut self) {
            self.approval.request.clone_from(&self.request);
        }

        fn refresh_manifest(&mut self) -> anyhow::Result<()> {
            self.approval.provider_manifest_digest = CompanionPairingProviderManifestDigest::parse(
                self.providers.companion_pairing_manifest_digest()?.as_str(),
            )?;
            Ok(())
        }
    }

    #[wasm_bindgen_test]
    fn endpoint_construction_is_side_effect_free_and_preserves_exact_request() -> anyhow::Result<()>
    {
        let issued_at: CompanionPairingEpochMilliseconds = serde_json::from_str("100")?;
        let expires_at: CompanionPairingEpochMilliseconds = serde_json::from_str("200")?;
        let request = CompanionPairingRequest {
            request_id: "request-1".to_owned(),
            nonce: "nonce-1".to_owned(),
            issued_at,
            expires_at,
            vault_type: ExtensionPairingVaultType::Simple,
            installation: nook_companion_core::CompanionPairingInstallation {
                extension_runtime_id: "runtime-1".to_owned(),
                app_id: "app-1".to_owned(),
                encryption_public_key: "age1extension".to_owned(),
                signing_public_key: "signing-1".to_owned(),
                installation_label: "Extension".to_owned(),
            },
            scopes: vec![ExtensionConnectScope::VaultAccess],
        };
        let mut endpoint = NookCompanionPairingExtensionEndpoint::new(request.clone())
            .map_err(|error| anyhow::anyhow!("{error:?}"))?;
        assert_eq!(
            endpoint
                .request()
                .map_err(|error| anyhow::anyhow!("{error:?}"))?,
            request
        );
        let _authority = endpoint
            .take_authority()
            .map_err(|error| anyhow::anyhow!("{error:?}"))?;
        assert!(matches!(
            endpoint.inner.take_authority(),
            Err(CompanionPairingError::AuthorityUnavailable)
        ));
        Ok(())
    }

    #[wasm_bindgen_test]
    fn real_manager_prevalidates_exact_empty_and_sealed_provider_approvals() -> anyhow::Result<()> {
        for with_provider in [false, true] {
            let fixture = PairingFixture::new(with_provider)?;
            let mut endpoint = NookCompanionPairingExtensionEndpoint::new(fixture.request.clone())
                .map_err(|error| anyhow::anyhow!("{error:?}"))?;
            let authority = endpoint
                .take_authority()
                .map_err(|error| anyhow::anyhow!("{error:?}"))?;
            let admitted = authority
                .prevalidate(
                    &fixture.manager,
                    CompanionPairingApprovalAttempt {
                        approval: fixture.approval,
                        observed_at: PairingFixture::epoch("150")?,
                    },
                    fixture.providers,
                )
                .map_err(|error| anyhow::anyhow!("unexpected rejection: {error:?}"))?;
            assert_eq!(
                admitted.providers.active_vault_store_id.as_deref(),
                Some("store-1")
            );
            assert_eq!(
                admitted.providers.providers.len(),
                usize::from(with_provider)
            );
        }
        Ok(())
    }

    #[wasm_bindgen_test]
    fn manager_vault_binding_rejects_every_incompatible_state() -> anyhow::Result<()> {
        for case in 0..5 {
            let mut fixture = PairingFixture::new(false)?;
            match case {
                0 => fixture.manager.application = VaultApplication::Simple,
                1 => fixture.manager.vault.architecture.vault_type = VaultType::Sentinel,
                2 => fixture.manager.vault.store_id = "store-other".to_owned(),
                3 => fixture.manager.vault.vault_name = VaultNameState::Named("Other".to_owned()),
                4 => fixture.manager.vault.vault_name = VaultNameState::Unnamed,
                _ => unreachable!(),
            }
            assert!(matches!(
                fixture.prevalidate()?,
                Err(CompanionPairingFailure::VaultMismatch)
            ));
        }
        Ok(())
    }

    #[wasm_bindgen_test]
    fn manager_identity_and_signing_material_are_both_required() -> anyhow::Result<()> {
        for case in 0..3 {
            let mut fixture = PairingFixture::new(false)?;
            match case {
                0 => fixture.manager.device.identity_private_key.clear(),
                1 => {
                    fixture.manager.device.identity_private_key =
                        DeviceIdentity::generate()?.secret_string().into_inner();
                }
                2 => fixture.manager.event_log.signing_seed = "malformed".to_owned(),
                _ => unreachable!(),
            }
            assert!(matches!(
                fixture.prevalidate()?,
                Err(CompanionPairingFailure::InstallationMismatch)
            ));
        }
        Ok(())
    }

    #[wasm_bindgen_test]
    fn approval_installation_must_match_manager_keys_exactly() -> anyhow::Result<()> {
        for case in 0..3 {
            let mut fixture = PairingFixture::new(false)?;
            match case {
                0 => fixture.request.installation.app_id = "app-other".to_owned(),
                1 => {
                    fixture.request.installation.encryption_public_key = "age1other".to_owned();
                }
                2 => fixture.request.installation.signing_public_key = "signing-other".to_owned(),
                _ => unreachable!(),
            }
            fixture.align_approval_request();
            assert!(matches!(
                fixture.prevalidate()?,
                Err(CompanionPairingFailure::InstallationMismatch)
            ));
        }
        Ok(())
    }

    #[wasm_bindgen_test]
    fn provider_snapshot_requires_exact_active_and_per_provider_scope() -> anyhow::Result<()> {
        for case in 0..2 {
            let mut fixture = PairingFixture::new(true)?;
            if case == 0 {
                fixture.providers.active_vault_store_id = ActiveVaultScope::Unselected;
            } else {
                fixture.providers.providers[0].store_id = ProviderVaultScope::Unscoped;
            }
            assert!(matches!(
                fixture.prevalidate()?,
                Err(CompanionPairingFailure::ScopeMismatch)
            ));
        }
        Ok(())
    }

    #[wasm_bindgen_test]
    fn provider_snapshot_requires_explicit_credentials_scope() -> anyhow::Result<()> {
        let mut fixture = PairingFixture::new(true)?;
        fixture
            .request
            .scopes
            .retain(|scope| scope != &ExtensionConnectScope::SyncProviderCredentials);
        fixture.align_approval_request();
        assert!(matches!(
            fixture.prevalidate()?,
            Err(CompanionPairingFailure::ScopeMismatch)
        ));
        Ok(())
    }

    #[wasm_bindgen_test]
    fn provider_manifest_substitution_is_rejected_before_recipient_admission() -> anyhow::Result<()>
    {
        let mut fixture = PairingFixture::new(true)?;
        fixture.providers.providers[0].label = "Substituted".to_owned();
        assert!(matches!(
            fixture.prevalidate()?,
            Err(CompanionPairingFailure::ProviderManifestMismatch)
        ));
        Ok(())
    }

    #[wasm_bindgen_test]
    fn sealed_provider_must_authenticate_for_exact_manager_recipient() -> anyhow::Result<()> {
        let mut fixture = PairingFixture::new(true)?;
        let other = DeviceIdentity::generate()?;
        let mut replacement = AuthProvidersSnapshotData {
            providers: vec![StorageProviderData::github(
                "github-other",
                "GitHub",
                "github_pat_other",
                "nook",
                "2026-09-07T00:00:00Z",
            )],
            active_vault_store_id: ActiveVaultScope::StoreId("store-1".to_owned()),
        };
        replacement.providers[0].store_id = ProviderVaultScope::StoreId("store-1".to_owned());
        replacement.seal_credentials_for(&other.public_key())?;
        fixture.providers = replacement;
        fixture.refresh_manifest()?;
        assert!(matches!(
            fixture.prevalidate()?,
            Err(CompanionPairingFailure::ProviderRecipientMismatch)
        ));
        Ok(())
    }
}

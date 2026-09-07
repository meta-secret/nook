use super::*;
use nook_companion_core::{
    CompanionEpochMilliseconds, CompanionIdentityDiscoveryObservation,
    CompanionIdentityDiscoveryRequest, CompanionIdentityHandoffAuthorization,
    CompanionIdentityHandoffContext, CompanionIdentityStatusAdmission,
    CompanionIdentityStatusAdmissionRequest, CompanionInstallationAppKey, CompanionUnlockedAppKey,
    ExtensionConnectScope, ExtensionPairingVaultType,
};

fn epoch_milliseconds(
    serialized: &str,
) -> Result<CompanionEpochMilliseconds, CompanionOperationError> {
    Ok(serde_json::from_str(serialized)?)
}

struct DirectHandoffScenario {
    website: NookVaultManager,
    extension: NookVaultManager,
    endpoint: NookCompanionExtensionEndpoint,
    presence: CompanionExtensionPresence,
}

impl DirectHandoffScenario {
    fn new() -> Result<Self, CompanionOperationError> {
        let identity = DeviceIdentity::generate().map_err(NookError::from)?;
        let (signing, signing_seed) = SigningIdentity::generate().map_err(NookError::from)?;
        let app_key = CompanionUnlockedAppKey {
            extension_runtime_id: "runtime-1".to_owned(),
            app_key: CompanionInstallationAppKey {
                app_id: identity.device_id().as_str().to_owned(),
                encryption_public_key: identity.public_key().as_str().to_owned(),
                signing_public_key: signing.public_key().as_str().to_owned(),
                installation_label: "Nook Extension".to_owned(),
            },
            nonce: "nonce-1".to_owned(),
            scopes: vec![ExtensionConnectScope::VaultAccess],
        };
        let mut extension = NookVaultManager::new();
        extension.application = VaultApplication::Extension;
        extension.vault.store_id = "store-1".to_owned();
        extension.device.id = identity.device_id().as_str().to_owned();
        extension.device.identity_private_key = identity.secret_string().into_inner();
        extension.event_log.signing_seed = signing_seed.into_inner();
        let presence = CompanionExtensionPresence::Unlocked {
            vault_type: ExtensionPairingVaultType::Simple,
            vault_store_id: "store-1".to_owned(),
            vault_name: "Personal".to_owned(),
            app_key,
        };
        Ok(Self {
            website: NookVaultManager::new(),
            extension,
            endpoint: NookCompanionExtensionEndpoint::from_presence(presence.clone())?,
            presence,
        })
    }

    fn discovery(&self) -> Result<CompanionIdentityDiscoveryObservation, CompanionOperationError> {
        Ok(CompanionIdentityDiscoveryObservation {
            request: CompanionIdentityDiscoveryRequest {
                request_id: "request-1".to_owned(),
                vault_store_id: "store-1".to_owned(),
                expires_at: epoch_milliseconds("200")?,
            },
            observed_at: epoch_milliseconds("100")?,
        })
    }

    fn handoff_begin(&mut self) -> Result<CompanionWebsiteHandoffBegin, CompanionOperationError> {
        let discovery = self.discovery()?;
        let status = self.endpoint.discover_inner(discovery.clone())?;
        let admission =
            CompanionIdentityStatusAdmission::admit(CompanionIdentityStatusAdmissionRequest {
                discovery,
                status,
                observed_at: epoch_milliseconds("100")?,
            });
        let CompanionIdentityStatusAdmission::Accepted { transaction } = admission else {
            return Err(CompanionOperationError::HandoffNotPending);
        };
        Ok(CompanionWebsiteHandoffBegin {
            transaction: *transaction,
            context: CompanionIdentityHandoffContext::PairedVault {
                vault_store_id: "store-1".to_owned(),
            },
        })
    }

    fn begin(&mut self) -> Result<CompanionIdentityHandoffRequest, CompanionOperationError> {
        let begin = self.handoff_begin()?;
        self.website.begin_companion_identity_handoff_inner(begin)
    }

    fn authorize_and_seal(
        &mut self,
        request: CompanionIdentityHandoffRequest,
    ) -> Result<CompanionIdentityHandoffResponse, CompanionOperationError> {
        let presence = self.presence.clone();
        self.endpoint
            .authorize_and_seal_loaded(CompanionExtensionSealOperation {
                manager: &mut self.extension,
                authorization: CompanionIdentityHandoffAuthorization {
                    request,
                    observed_at: epoch_milliseconds("100")?,
                    presence,
                },
            })
    }
}

#[test]
#[allow(
    unknown_lints,
    non_local_effect_before_unhandled_error,
    reason = "the test intentionally observes one-shot mutation and pending-state clearing before handling each rejection"
)]
fn real_managers_complete_handoff_reject_replay_and_clear_pending_state()
-> Result<(), CompanionOperationError> {
    let mut scenario = DirectHandoffScenario::new()?;
    let begin = scenario.handoff_begin()?;
    let repeat_begin = begin.clone();
    let request = scenario
        .website
        .begin_companion_identity_handoff_inner(begin)?;
    assert!(
        !scenario
            .website
            .device
            .extension_handoff_private_key
            .is_empty()
    );
    let replay = request.clone();
    let response = scenario.authorize_and_seal(request)?;
    assert!(!response.encrypted_envelope.is_empty());
    assert!(matches!(
        scenario.authorize_and_seal(replay),
        Err(CompanionOperationError::Protocol(
            CompanionProtocolError::NonceUnavailable
        ))
    ));

    let pending = scenario
        .website
        .consume_companion_website_handoff(&response)?;
    assert!(
        scenario
            .website
            .device
            .extension_handoff_private_key
            .is_empty()
    );
    assert!(!pending.recipient_secret.is_empty());

    let mut forged = scenario
        .website
        .begin_companion_identity_handoff_inner(repeat_begin)?;
    forged.transaction.discovery.request.request_id = "request-forged".to_owned();
    let forged_response = CompanionIdentityHandoffResponse {
        request: forged,
        encrypted_envelope: "not-used".to_owned(),
    };
    assert!(matches!(
        scenario
            .website
            .consume_companion_website_handoff(&forged_response),
        Err(CompanionOperationError::Protocol(
            CompanionProtocolError::RequestMismatch
        ))
    ));
    assert!(
        scenario
            .website
            .device
            .extension_handoff_private_key
            .is_empty()
    );
    Ok(())
}

#[test]
#[allow(
    unknown_lints,
    non_local_effect_before_unhandled_error,
    reason = "the test intentionally observes that every rejected begin transaction clears previously pending secret state"
)]
fn rejected_discovery_and_context_clear_existing_pending_secret()
-> Result<(), CompanionOperationError> {
    let mut scenario = DirectHandoffScenario::new()?;
    let valid = scenario.handoff_begin()?;
    let mut request = valid.clone();
    request.transaction.discovery.request.request_id = "request-other".to_owned();
    let mut store = valid.clone();
    store.transaction.discovery.request.vault_store_id = "store-other".to_owned();
    let mut context = valid.clone();
    context.context = CompanionIdentityHandoffContext::PairedVault {
        vault_store_id: "store-other".to_owned(),
    };
    let mut expired = valid.clone();
    expired.transaction.admitted_at = epoch_milliseconds("200")?;

    for (begin, expected) in [
        (request, CompanionProtocolError::RequestMismatch),
        (store, CompanionProtocolError::RequestMismatch),
        (context, CompanionProtocolError::ContextMismatch),
        (expired, CompanionProtocolError::DiscoveryExpired),
    ] {
        scenario
            .website
            .begin_companion_identity_handoff_inner(valid.clone())?;
        assert!(
            !scenario
                .website
                .device
                .extension_handoff_private_key
                .is_empty()
        );
        assert!(matches!(
            scenario
                .website
                .begin_companion_identity_handoff_inner(begin),
            Err(CompanionOperationError::Protocol(error)) if error == expected
        ));
        assert!(
            scenario
                .website
                .device
                .extension_handoff_private_key
                .is_empty()
        );
    }
    Ok(())
}

#[test]
#[allow(
    unknown_lints,
    non_local_effect_before_unhandled_error,
    reason = "the test intentionally observes fail-closed nonce consumption after the real sealer rejects its active vault"
)]
fn sealing_failure_consumes_nonce_and_requires_fresh_discovery()
-> Result<(), CompanionOperationError> {
    let mut scenario = DirectHandoffScenario::new()?;
    let request = scenario.begin()?;
    scenario.extension.vault.store_id = "store-other".to_owned();
    assert!(matches!(
        scenario.authorize_and_seal(request.clone()),
        Err(CompanionOperationError::ActiveExtensionVaultMismatch)
    ));
    scenario.extension.vault.store_id = "store-1".to_owned();
    assert!(matches!(
        scenario.authorize_and_seal(request),
        Err(CompanionOperationError::Protocol(
            CompanionProtocolError::NonceUnavailable
        ))
    ));
    Ok(())
}

#[test]
#[allow(
    unknown_lints,
    non_local_effect_before_unhandled_error,
    reason = "the test intentionally observes transaction cleanup after stale authorization and concurrent discovery"
)]
fn production_endpoint_consumes_stale_and_concurrent_transactions()
-> Result<(), CompanionOperationError> {
    let mut stale = DirectHandoffScenario::new()?;
    let stale_request = stale.begin()?;
    let stale_presence = stale.presence.clone();
    assert!(matches!(
        stale
            .endpoint
            .authorize_and_seal_loaded(CompanionExtensionSealOperation {
                manager: &mut stale.extension,
                authorization: CompanionIdentityHandoffAuthorization {
                    request: stale_request.clone(),
                    observed_at: epoch_milliseconds("200")?,
                    presence: stale_presence,
                },
            }),
        Err(CompanionOperationError::Protocol(
            CompanionProtocolError::DiscoveryExpired
        ))
    ));
    assert!(matches!(
        stale.authorize_and_seal(stale_request),
        Err(CompanionOperationError::Protocol(
            CompanionProtocolError::NonceUnavailable
        ))
    ));

    let mut concurrent = DirectHandoffScenario::new()?;
    let begin = concurrent.handoff_begin()?;
    let request = concurrent
        .website
        .begin_companion_identity_handoff_inner(begin)?;
    let mut second = concurrent.discovery()?;
    second.request.request_id = "request-2".to_owned();
    assert!(matches!(
        concurrent.endpoint.discover_inner(second),
        Err(CompanionOperationError::Protocol(
            CompanionProtocolError::RequestMismatch
        ))
    ));
    assert!(matches!(
        concurrent.authorize_and_seal(request),
        Err(CompanionOperationError::Protocol(
            CompanionProtocolError::NonceUnavailable
        ))
    ));
    Ok(())
}

#[test]
#[allow(
    unknown_lints,
    non_local_effect_before_unhandled_error,
    reason = "the test intentionally installs a different real app key before observing fail-closed sealing rejection"
)]
fn real_manager_rejects_an_installation_app_key_mismatch() -> Result<(), CompanionOperationError> {
    let mut scenario = DirectHandoffScenario::new()?;
    let request = scenario.begin()?;
    let other = DeviceIdentity::generate().map_err(NookError::from)?;
    scenario.extension.device.id = other.device_id().as_str().to_owned();
    scenario.extension.device.identity_private_key = other.secret_string().into_inner();
    assert!(matches!(
        scenario.authorize_and_seal(request.clone()),
        Err(CompanionOperationError::InstallationAppKeyMismatch)
    ));
    assert!(matches!(
        scenario.authorize_and_seal(request),
        Err(CompanionOperationError::Protocol(
            CompanionProtocolError::NonceUnavailable
        ))
    ));
    Ok(())
}

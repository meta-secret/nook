use super::*;

fn before_expiry() -> CompanionEpochMilliseconds {
    CompanionEpochMilliseconds(100.0)
}

fn expiry() -> CompanionEpochMilliseconds {
    CompanionEpochMilliseconds(200.0)
}

fn app_key(scopes: Vec<ExtensionConnectScope>) -> CompanionUnlockedAppKey {
    CompanionUnlockedAppKey {
        extension_runtime_id: "runtime-1".to_owned(),
        app_key: CompanionInstallationAppKey {
            app_id: "app-1".to_owned(),
            encryption_public_key: "age1public".to_owned(),
            signing_public_key: "signing-public".to_owned(),
            installation_label: "Nook Extension".to_owned(),
        },
        nonce: "nonce-1".to_owned(),
        scopes,
    }
}

fn unlocked_app_key() -> CompanionUnlockedAppKey {
    app_key(vec![ExtensionConnectScope::VaultAccess])
}

fn observation() -> CompanionIdentityDiscoveryObservation {
    CompanionIdentityDiscoveryObservation {
        request: CompanionIdentityDiscoveryRequest {
            request_id: "request-1".to_owned(),
            vault_store_id: "store-1".to_owned(),
            expires_at: expiry(),
        },
        observed_at: before_expiry(),
    }
}

fn unlocked_status() -> CompanionIdentityStatus {
    CompanionIdentityStatus::Unlocked {
        request_id: "request-1".to_owned(),
        vault_store_id: "store-1".to_owned(),
        app_key: unlocked_app_key(),
    }
}

fn website_begin() -> CompanionWebsiteHandoffBegin {
    CompanionWebsiteHandoffBegin {
        discovery: observation(),
        status: unlocked_status(),
        context: CompanionIdentityHandoffContext::PairedVault {
            vault_store_id: "store-1".to_owned(),
        },
    }
}

fn unlocked_presence() -> CompanionExtensionPresence {
    CompanionExtensionPresence::Unlocked {
        vault_type: ExtensionPairingVaultType::Simple,
        vault_store_id: "store-1".to_owned(),
        vault_name: "Personal".to_owned(),
        app_key: unlocked_app_key(),
    }
}

fn handoff_request() -> anyhow::Result<CompanionIdentityHandoffRequest> {
    Ok(website_begin().prepare("age1recipient".to_owned())?)
}

#[test]
fn discovery_projects_every_presence_without_browser_transport() -> anyhow::Result<()> {
    let unavailable = CompanionExtensionProtocol::new(CompanionExtensionPresence::Unavailable)?;
    assert!(matches!(
        unavailable.discover(observation())?,
        CompanionIdentityStatus::Unavailable { .. }
    ));

    let locked = CompanionExtensionProtocol::new(CompanionExtensionPresence::Locked {
        vault_type: ExtensionPairingVaultType::Simple,
        vault_store_id: "store-1".to_owned(),
        vault_name: "Personal".to_owned(),
    })?;
    assert!(matches!(
        locked.discover(observation())?,
        CompanionIdentityStatus::Locked { .. }
    ));

    let different = CompanionExtensionProtocol::new(CompanionExtensionPresence::Locked {
        vault_type: ExtensionPairingVaultType::Simple,
        vault_store_id: "store-other".to_owned(),
        vault_name: "Other".to_owned(),
    })?;
    assert!(matches!(
        different.discover(observation())?,
        CompanionIdentityStatus::DifferentVault {
            connected_vault_store_id,
            ..
        } if connected_vault_store_id == "store-other"
    ));

    let unlocked = CompanionExtensionProtocol::new(unlocked_presence())?;
    assert_eq!(unlocked.discover(observation())?, unlocked_status());
    Ok(())
}

#[test]
fn discovery_rejects_malformed_and_expired_observations() -> anyhow::Result<()> {
    let protocol = CompanionExtensionProtocol::new(CompanionExtensionPresence::Unavailable)?;
    let mut empty_request_id = observation();
    empty_request_id.request.request_id.clear();
    let mut empty_store = observation();
    empty_store.request.vault_store_id.clear();
    let mut malformed_time = observation();
    malformed_time.observed_at = CompanionEpochMilliseconds(f64::NAN);
    for malformed in [empty_request_id, empty_store, malformed_time] {
        assert!(matches!(
            protocol.discover(malformed),
            Err(CompanionProtocolError::InvalidValue)
        ));
    }

    let mut expired = observation();
    expired.observed_at = expiry();
    assert!(matches!(
        protocol.discover(expired),
        Err(CompanionProtocolError::DiscoveryExpired)
    ));
    let mut delayed = observation();
    delayed.observed_at = CompanionEpochMilliseconds(201.0);
    assert!(matches!(
        protocol.discover(delayed),
        Err(CompanionProtocolError::DiscoveryExpired)
    ));
    Ok(())
}

#[test]
fn website_requires_exact_request_store_and_context_correlation() {
    let mut request_id = website_begin();
    request_id.discovery.request.request_id = "request-other".to_owned();
    assert!(matches!(
        request_id.validate(),
        Err(CompanionProtocolError::RequestMismatch)
    ));

    let mut store = website_begin();
    store.discovery.request.vault_store_id = "store-other".to_owned();
    assert!(matches!(
        store.validate(),
        Err(CompanionProtocolError::RequestMismatch)
    ));

    let mut context = website_begin();
    context.context = CompanionIdentityHandoffContext::ExistingVaultImport {
        vault_store_id: "store-other".to_owned(),
    };
    assert!(matches!(
        context.validate(),
        Err(CompanionProtocolError::ContextMismatch)
    ));
}

#[test]
fn authorization_rejects_missing_capability_revocation_and_app_key_mismatch() -> anyhow::Result<()>
{
    let without_access = CompanionExtensionPresence::Unlocked {
        vault_type: ExtensionPairingVaultType::Simple,
        vault_store_id: "store-1".to_owned(),
        vault_name: "Personal".to_owned(),
        app_key: app_key(vec![ExtensionConnectScope::PasswordFilling]),
    };
    assert!(matches!(
        CompanionExtensionProtocol::new(without_access),
        Err(CompanionProtocolError::InvalidValue)
    ));

    let request = handoff_request()?;
    let mut revoked = CompanionExtensionProtocol::new(CompanionExtensionPresence::Unavailable)?;
    assert!(matches!(
        revoked.authorize_handoff(request.clone()),
        Err(CompanionProtocolError::AppKeyUnavailable)
    ));

    let mut protocol = CompanionExtensionProtocol::new(unlocked_presence())?;
    let mut mismatched = request.clone();
    mismatched.expected_app_key.app_id = "app-other".to_owned();
    assert!(matches!(
        protocol.authorize_handoff(mismatched),
        Err(CompanionProtocolError::HandoffBindingMismatch)
    ));
    protocol.authorize_handoff(request.clone())?;
    assert!(matches!(
        protocol.authorize_handoff(request),
        Err(CompanionProtocolError::NonceUnavailable)
    ));
    Ok(())
}

#[test]
fn unlock_preserves_request_correlation_across_locked_and_unlocked_state() -> anyhow::Result<()> {
    let request = CompanionIdentityUnlockRequest {
        request_id: "request-2".to_owned(),
        vault_store_id: "store-1".to_owned(),
    };
    let locked = CompanionExtensionProtocol::new(CompanionExtensionPresence::Locked {
        vault_type: ExtensionPairingVaultType::Simple,
        vault_store_id: "store-1".to_owned(),
        vault_name: "Personal".to_owned(),
    })?;
    assert!(matches!(
        locked.unlock(request.clone())?,
        CompanionIdentityStatus::Locked { request_id, .. } if request_id == "request-2"
    ));
    let unlocked = CompanionExtensionProtocol::new(unlocked_presence())?;
    assert!(matches!(
        unlocked.unlock(request)?,
        CompanionIdentityStatus::Unlocked { request_id, .. } if request_id == "request-2"
    ));
    Ok(())
}

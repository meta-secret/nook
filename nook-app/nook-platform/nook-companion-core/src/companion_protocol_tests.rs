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

fn website_begin() -> anyhow::Result<CompanionWebsiteHandoffBegin> {
    Ok(CompanionWebsiteHandoffBegin {
        transaction: CompanionAdmittedIdentityDiscovery::admit(
            CompanionIdentityStatusAdmissionRequest {
                discovery: observation(),
                status: unlocked_status(),
                observed_at: before_expiry(),
            },
        )?,
        context: CompanionIdentityHandoffContext::PairedVault {
            vault_store_id: "store-1".to_owned(),
        },
    })
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
    Ok(website_begin()?.prepare("age1recipient".to_owned())?)
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
fn admission_correlates_every_status_and_rechecks_expiry() -> anyhow::Result<()> {
    let presences = [
        CompanionExtensionPresence::Unavailable,
        CompanionExtensionPresence::Locked {
            vault_type: ExtensionPairingVaultType::Simple,
            vault_store_id: "store-1".to_owned(),
            vault_name: "Personal".to_owned(),
        },
        CompanionExtensionPresence::Locked {
            vault_type: ExtensionPairingVaultType::Simple,
            vault_store_id: "store-other".to_owned(),
            vault_name: "Other".to_owned(),
        },
        unlocked_presence(),
    ];
    for presence in presences {
        let status = CompanionExtensionProtocol::new(presence)?.discover(observation())?;
        let accepted =
            CompanionIdentityStatusAdmission::admit(CompanionIdentityStatusAdmissionRequest {
                discovery: observation(),
                status: status.clone(),
                observed_at: before_expiry(),
            });
        assert!(matches!(
            accepted,
            CompanionIdentityStatusAdmission::Accepted { .. }
        ));

        let mut mismatched_request = status.clone();
        match &mut mismatched_request {
            CompanionIdentityStatus::Unavailable { request_id, .. }
            | CompanionIdentityStatus::Locked { request_id, .. }
            | CompanionIdentityStatus::DifferentVault { request_id, .. }
            | CompanionIdentityStatus::Unlocked { request_id, .. } => {
                *request_id = "request-other".to_owned();
            }
        }
        assert_eq!(
            CompanionIdentityStatusAdmission::admit(CompanionIdentityStatusAdmissionRequest {
                discovery: observation(),
                status: mismatched_request,
                observed_at: before_expiry(),
            }),
            CompanionIdentityStatusAdmission::Rejected {
                failure: CompanionProtocolFailure::RequestMismatch,
            }
        );

        let mut mismatched_store = status;
        match &mut mismatched_store {
            CompanionIdentityStatus::Unavailable { vault_store_id, .. }
            | CompanionIdentityStatus::Locked { vault_store_id, .. }
            | CompanionIdentityStatus::DifferentVault { vault_store_id, .. }
            | CompanionIdentityStatus::Unlocked { vault_store_id, .. } => {
                *vault_store_id = "store-other".to_owned();
            }
        }
        assert_eq!(
            CompanionIdentityStatusAdmission::admit(CompanionIdentityStatusAdmissionRequest {
                discovery: observation(),
                status: mismatched_store,
                observed_at: before_expiry(),
            }),
            CompanionIdentityStatusAdmission::Rejected {
                failure: CompanionProtocolFailure::RequestMismatch,
            }
        );
    }

    assert_eq!(
        CompanionIdentityStatusAdmission::admit(CompanionIdentityStatusAdmissionRequest {
            discovery: observation(),
            status: unlocked_status(),
            observed_at: expiry(),
        }),
        CompanionIdentityStatusAdmission::Rejected {
            failure: CompanionProtocolFailure::DiscoveryExpired,
        }
    );
    Ok(())
}

#[test]
fn website_requires_exact_request_store_and_context_correlation() -> anyhow::Result<()> {
    let mut request_id = website_begin()?;
    request_id.transaction.discovery.request.request_id = "request-other".to_owned();
    assert!(matches!(
        request_id.validate(),
        Err(CompanionProtocolError::RequestMismatch)
    ));

    let mut store = website_begin()?;
    store.transaction.discovery.request.vault_store_id = "store-other".to_owned();
    assert!(matches!(
        store.validate(),
        Err(CompanionProtocolError::RequestMismatch)
    ));

    let mut context = website_begin()?;
    context.context = CompanionIdentityHandoffContext::ExistingVaultImport {
        vault_store_id: "store-other".to_owned(),
    };
    assert!(matches!(
        context.validate(),
        Err(CompanionProtocolError::ContextMismatch)
    ));
    Ok(())
}

#[test]
#[allow(
    unknown_lints,
    non_local_effect_before_unhandled_error,
    reason = "the test intentionally observes replay rejection after one-shot authorization consumes endpoint state"
)]
fn authorization_requires_capability_and_an_issued_discovery() -> anyhow::Result<()> {
    let without_access = CompanionExtensionPresence::Unlocked {
        vault_type: ExtensionPairingVaultType::Simple,
        vault_store_id: "store-1".to_owned(),
        vault_name: "Personal".to_owned(),
        app_key: app_key(vec![ExtensionConnectScope::PasswordFilling]),
    };
    assert!(matches!(
        CompanionExtensionHandoffEndpoint::new(without_access),
        Err(CompanionProtocolError::InvalidValue)
    ));

    let mut revoked =
        CompanionExtensionHandoffEndpoint::new(CompanionExtensionPresence::Unavailable)?;
    let status = revoked.discover(observation())?;
    let transaction =
        CompanionAdmittedIdentityDiscovery::admit(CompanionIdentityStatusAdmissionRequest {
            discovery: observation(),
            status,
            observed_at: before_expiry(),
        })?;
    assert!(matches!(
        (CompanionWebsiteHandoffBegin {
            transaction,
            context: CompanionIdentityHandoffContext::PairedVault {
                vault_store_id: "store-1".to_owned(),
            },
        })
        .prepare("age1recipient".to_owned()),
        Err(CompanionProtocolError::AppKeyUnavailable)
    ));

    let mut endpoint = CompanionExtensionHandoffEndpoint::new(unlocked_presence())?;
    endpoint.discover(observation())?;
    let authorization = CompanionIdentityHandoffAuthorization {
        request: handoff_request()?,
        observed_at: before_expiry(),
        presence: unlocked_presence(),
    };
    endpoint.authorize_handoff(authorization.clone())?;
    assert!(matches!(
        endpoint.authorize_handoff(authorization),
        Err(CompanionProtocolError::NonceUnavailable)
    ));
    Ok(())
}

#[test]
#[allow(
    unknown_lints,
    non_local_effect_before_unhandled_error,
    reason = "the test intentionally observes fail-closed state consumption after mismatched, stale, and concurrent transactions"
)]
fn mismatched_stale_and_concurrent_transactions_consume_endpoint_state() -> anyhow::Result<()> {
    let mut mismatched = CompanionExtensionHandoffEndpoint::new(unlocked_presence())?;
    mismatched.discover(observation())?;
    let exact = CompanionIdentityHandoffAuthorization {
        request: handoff_request()?,
        observed_at: before_expiry(),
        presence: unlocked_presence(),
    };
    let mut wrong = exact.clone();
    let CompanionIdentityStatus::Unlocked { app_key, .. } = &mut wrong.request.transaction.status
    else {
        return Err(anyhow::anyhow!("expected unlocked fixture"));
    };
    app_key.app_key.app_id = "app-other".to_owned();
    assert!(matches!(
        mismatched.authorize_handoff(wrong),
        Err(CompanionProtocolError::RequestMismatch)
    ));
    assert!(matches!(
        mismatched.authorize_handoff(exact),
        Err(CompanionProtocolError::NonceUnavailable)
    ));

    let mut revoked = CompanionExtensionHandoffEndpoint::new(unlocked_presence())?;
    revoked.discover(observation())?;
    let exact = CompanionIdentityHandoffAuthorization {
        request: handoff_request()?,
        observed_at: before_expiry(),
        presence: unlocked_presence(),
    };
    let mut unavailable = exact.clone();
    unavailable.presence = CompanionExtensionPresence::Unavailable;
    assert!(matches!(
        revoked.authorize_handoff(unavailable),
        Err(CompanionProtocolError::AppKeyUnavailable)
    ));
    assert!(matches!(
        revoked.authorize_handoff(exact),
        Err(CompanionProtocolError::NonceUnavailable)
    ));

    let mut changed_presence = CompanionExtensionHandoffEndpoint::new(unlocked_presence())?;
    changed_presence.discover(observation())?;
    let mut changed = CompanionIdentityHandoffAuthorization {
        request: handoff_request()?,
        observed_at: before_expiry(),
        presence: unlocked_presence(),
    };
    let CompanionExtensionPresence::Unlocked { app_key, .. } = &mut changed.presence else {
        return Err(anyhow::anyhow!("expected unlocked presence fixture"));
    };
    app_key.app_key.app_id = "app-other".to_owned();
    assert!(matches!(
        changed_presence.authorize_handoff(changed),
        Err(CompanionProtocolError::HandoffBindingMismatch)
    ));
    assert!(matches!(
        changed_presence.authorize_handoff(CompanionIdentityHandoffAuthorization {
            request: handoff_request()?,
            observed_at: before_expiry(),
            presence: unlocked_presence(),
        }),
        Err(CompanionProtocolError::NonceUnavailable)
    ));

    let mut stale = CompanionExtensionHandoffEndpoint::new(unlocked_presence())?;
    stale.discover(observation())?;
    let stale_authorization = CompanionIdentityHandoffAuthorization {
        request: handoff_request()?,
        observed_at: expiry(),
        presence: unlocked_presence(),
    };
    assert!(matches!(
        stale.authorize_handoff(stale_authorization.clone()),
        Err(CompanionProtocolError::DiscoveryExpired)
    ));
    assert!(matches!(
        stale.authorize_handoff(stale_authorization),
        Err(CompanionProtocolError::NonceUnavailable)
    ));

    let mut concurrent = CompanionExtensionHandoffEndpoint::new(unlocked_presence())?;
    concurrent.discover(observation())?;
    let mut another = observation();
    another.request.request_id = "request-2".to_owned();
    assert!(matches!(
        concurrent.discover(another),
        Err(CompanionProtocolError::RequestMismatch)
    ));
    assert!(matches!(
        concurrent.authorize_handoff(CompanionIdentityHandoffAuthorization {
            request: handoff_request()?,
            observed_at: before_expiry(),
            presence: unlocked_presence(),
        }),
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

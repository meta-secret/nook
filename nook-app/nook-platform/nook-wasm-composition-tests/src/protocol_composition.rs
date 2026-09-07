use anyhow::Result;
use nook_companion_core::{
    CompanionAdmittedIdentityDiscovery, CompanionEpochMilliseconds,
    CompanionExtensionHandoffEndpoint, CompanionExtensionPresence, CompanionExtensionProtocol,
    CompanionHandoffResponseAdmission, CompanionIdentityDiscoveryObservation,
    CompanionIdentityDiscoveryRequest, CompanionIdentityHandoffAuthorization,
    CompanionIdentityHandoffContext, CompanionIdentityStatus, CompanionIdentityStatusAdmission,
    CompanionIdentityStatusAdmissionRequest, CompanionIdentityUnlockRequest,
    CompanionInstallationAppKey, CompanionProtocolError, CompanionUnlockedAppKey,
    CompanionWebsiteHandoffBegin, ExtensionConnectScope, ExtensionPairingVaultType,
};

struct ProtocolComposition;

impl ProtocolComposition {
    fn epoch(value: u64) -> Result<CompanionEpochMilliseconds> {
        Ok(serde_json::from_str(&value.to_string())?)
    }

    fn discovery() -> Result<CompanionIdentityDiscoveryObservation> {
        Ok(CompanionIdentityDiscoveryObservation {
            request: CompanionIdentityDiscoveryRequest {
                request_id: "request-1".to_owned(),
                vault_store_id: "store-1".to_owned(),
                expires_at: Self::epoch(200)?,
            },
            observed_at: Self::epoch(100)?,
        })
    }

    fn unlocked_app_key() -> CompanionUnlockedAppKey {
        CompanionUnlockedAppKey {
            extension_runtime_id: "runtime-1".to_owned(),
            app_key: CompanionInstallationAppKey {
                app_id: "app-1".to_owned(),
                encryption_public_key: "age1public".to_owned(),
                signing_public_key: "signing-public".to_owned(),
                installation_label: "Nook Extension".to_owned(),
            },
            nonce: "nonce-1".to_owned(),
            scopes: vec![ExtensionConnectScope::VaultAccess],
        }
    }

    fn unlocked_presence() -> CompanionExtensionPresence {
        CompanionExtensionPresence::Unlocked {
            vault_type: ExtensionPairingVaultType::Simple,
            vault_store_id: "store-1".to_owned(),
            vault_name: "Composition Vault".to_owned(),
            app_key: Self::unlocked_app_key(),
        }
    }

    fn admitted_unlocked() -> Result<CompanionAdmittedIdentityDiscovery> {
        let protocol = CompanionExtensionProtocol::new(Self::unlocked_presence())?;
        let discovery = Self::discovery()?;
        let admission =
            CompanionIdentityStatusAdmission::admit(CompanionIdentityStatusAdmissionRequest {
                status: protocol.discover(discovery.clone())?,
                discovery,
                observed_at: Self::epoch(110)?,
            });
        let CompanionIdentityStatusAdmission::Accepted { transaction } = admission else {
            anyhow::bail!("valid unlocked discovery was rejected");
        };
        Ok(*transaction)
    }
}

#[test]
fn portable_protocol_projects_unavailable_presence() -> Result<()> {
    let protocol = CompanionExtensionProtocol::new(CompanionExtensionPresence::Unavailable)?;
    assert!(matches!(
        protocol.discover(ProtocolComposition::discovery()?)?,
        CompanionIdentityStatus::Unavailable { .. }
    ));
    Ok(())
}

#[test]
fn portable_protocol_projects_locked_presence() -> Result<()> {
    let presence = CompanionExtensionPresence::Locked {
        vault_type: ExtensionPairingVaultType::Simple,
        vault_store_id: "store-1".to_owned(),
        vault_name: "Composition Vault".to_owned(),
    };
    let protocol = CompanionExtensionProtocol::new(presence)?;
    assert!(matches!(
        protocol.discover(ProtocolComposition::discovery()?)?,
        CompanionIdentityStatus::Locked { .. }
    ));
    Ok(())
}

#[test]
fn portable_protocol_reports_a_different_vault() -> Result<()> {
    let presence = CompanionExtensionPresence::Locked {
        vault_type: ExtensionPairingVaultType::Simple,
        vault_store_id: "store-2".to_owned(),
        vault_name: "Other Vault".to_owned(),
    };
    let protocol = CompanionExtensionProtocol::new(presence)?;
    assert!(matches!(
        protocol.discover(ProtocolComposition::discovery()?)?,
        CompanionIdentityStatus::DifferentVault { .. }
    ));
    Ok(())
}

#[test]
fn portable_protocol_rejects_expired_discovery() -> Result<()> {
    let protocol = CompanionExtensionProtocol::new(CompanionExtensionPresence::Unavailable)?;
    let mut discovery = ProtocolComposition::discovery()?;
    discovery.observed_at = ProtocolComposition::epoch(200)?;
    assert_eq!(
        protocol.discover(discovery),
        Err(CompanionProtocolError::DiscoveryExpired)
    );
    Ok(())
}

#[test]
fn portable_protocol_preserves_unlock_correlation() -> Result<()> {
    let protocol = CompanionExtensionProtocol::new(ProtocolComposition::unlocked_presence())?;
    let status = protocol.unlock(CompanionIdentityUnlockRequest {
        request_id: "unlock-1".to_owned(),
        vault_store_id: "store-1".to_owned(),
    })?;
    assert!(matches!(
        status,
        CompanionIdentityStatus::Unlocked {
            request_id,
            vault_store_id,
            ..
        } if request_id == "unlock-1" && vault_store_id == "store-1"
    ));
    Ok(())
}

#[test]
fn companion_wasm_protocol_accepts_core_presence_and_discovery() -> Result<()> {
    let protocol = nook_companion_wasm::NookCompanionExtensionProtocol::new(
        ProtocolComposition::unlocked_presence(),
    )
    .map_err(|_| anyhow::anyhow!("companion WASM rejected valid core presence"))?;
    let status = protocol
        .discover(ProtocolComposition::discovery()?)
        .map_err(|_| anyhow::anyhow!("companion WASM rejected valid core discovery"))?;
    assert!(matches!(status, CompanionIdentityStatus::Unlocked { .. }));
    Ok(())
}

#[test]
fn nook_wasm_endpoint_accepts_the_same_core_presence_and_discovery() -> Result<()> {
    let mut endpoint =
        nook_wasm::NookCompanionExtensionEndpoint::new(ProtocolComposition::unlocked_presence())
            .map_err(|_| anyhow::anyhow!("vault WASM rejected valid core presence"))?;
    let status = endpoint
        .discover(ProtocolComposition::discovery()?)
        .map_err(|_| anyhow::anyhow!("vault WASM rejected valid core discovery"))?;
    assert!(matches!(status, CompanionIdentityStatus::Unlocked { .. }));
    Ok(())
}

#[test]
fn both_wasm_adapters_return_the_same_accepted_transaction() -> Result<()> {
    let protocol = CompanionExtensionProtocol::new(ProtocolComposition::unlocked_presence())?;
    let discovery = ProtocolComposition::discovery()?;
    let request = CompanionIdentityStatusAdmissionRequest {
        status: protocol.discover(discovery.clone())?,
        discovery,
        observed_at: ProtocolComposition::epoch(110)?,
    };
    assert_eq!(
        nook_companion_wasm::admit_companion_identity_status(request.clone()),
        nook_wasm::admit_companion_identity_status(request)
    );
    Ok(())
}

#[test]
fn both_wasm_adapters_reject_mismatched_status_correlation() -> Result<()> {
    let request = CompanionIdentityStatusAdmissionRequest {
        discovery: ProtocolComposition::discovery()?,
        status: CompanionIdentityStatus::Unavailable {
            request_id: "forged-request".to_owned(),
            vault_store_id: "store-1".to_owned(),
        },
        observed_at: ProtocolComposition::epoch(110)?,
    };
    let companion = nook_companion_wasm::admit_companion_identity_status(request.clone());
    let vault = nook_wasm::admit_companion_identity_status(request);
    assert_eq!(companion, vault);
    assert!(matches!(
        companion,
        CompanionIdentityStatusAdmission::Rejected { .. }
    ));
    Ok(())
}

#[test]
fn handoff_endpoint_consumes_authorization_nonce_once() -> Result<()> {
    let presence = ProtocolComposition::unlocked_presence();
    let mut endpoint = CompanionExtensionHandoffEndpoint::new(presence.clone())?;
    let discovery = ProtocolComposition::discovery()?;
    let status = endpoint.discover(discovery.clone())?;
    let admission =
        CompanionIdentityStatusAdmission::admit(CompanionIdentityStatusAdmissionRequest {
            discovery,
            status,
            observed_at: ProtocolComposition::epoch(110)?,
        });
    let CompanionIdentityStatusAdmission::Accepted { transaction } = admission else {
        anyhow::bail!("valid endpoint transaction was rejected");
    };
    let request = CompanionWebsiteHandoffBegin {
        transaction: *transaction,
        context: CompanionIdentityHandoffContext::PairedVault {
            vault_store_id: "store-1".to_owned(),
        },
    }
    .prepare("age1recipient".to_owned())?;
    let authorization = CompanionIdentityHandoffAuthorization {
        request,
        observed_at: ProtocolComposition::epoch(120)?,
        presence,
    };
    assert!(endpoint.authorize_handoff(authorization.clone()).is_ok());
    assert!(matches!(
        endpoint.authorize_handoff(authorization),
        Err(CompanionProtocolError::NonceUnavailable)
    ));
    Ok(())
}

#[test]
fn handoff_context_rejects_a_different_store() -> Result<()> {
    let begin = CompanionWebsiteHandoffBegin {
        transaction: ProtocolComposition::admitted_unlocked()?,
        context: CompanionIdentityHandoffContext::PairedVault {
            vault_store_id: "store-2".to_owned(),
        },
    };
    assert_eq!(
        begin.validate(),
        Err(CompanionProtocolError::ContextMismatch)
    );
    Ok(())
}

#[test]
fn both_wasm_adapters_reject_an_empty_handoff_envelope() -> Result<()> {
    let request = CompanionWebsiteHandoffBegin {
        transaction: ProtocolComposition::admitted_unlocked()?,
        context: CompanionIdentityHandoffContext::PairedVault {
            vault_store_id: "store-1".to_owned(),
        },
    }
    .prepare("age1recipient".to_owned())?;
    let response = nook_companion_core::CompanionIdentityHandoffResponse {
        request,
        encrypted_envelope: String::new(),
    };
    let companion = nook_companion_wasm::admit_companion_handoff_response(response.clone());
    let vault = nook_wasm::admit_companion_handoff_response(response);
    assert_eq!(companion, vault);
    assert!(matches!(
        companion,
        CompanionHandoffResponseAdmission::Rejected { .. }
    ));
    Ok(())
}

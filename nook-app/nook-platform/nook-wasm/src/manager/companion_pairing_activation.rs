//! Side-effect-free preparation of an inert companion pairing activation.

use super::{NookExternalEventLogRecords, NookPrevalidatedCompanionPairingApproval};
use nook_core::{
    AuthEnvelopes, CheckedRemoteEvent, DeviceId, DevicePublicKey, DeviceSigningPublicKey,
    EventGraphDeviceAccess, EventGraphDeviceAccessRequest, EventId, LocalEventStore, StoreId,
    VaultMetaGraphProjection, VaultMetaState, VaultProjection, serialize_event_storage_yaml,
};
use std::collections::BTreeSet;
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

/// Opaque proof that pairing approval and event graph relationships were prepared.
/// It performs no storage or activation effect and conveys no live vault authority.
#[wasm_bindgen]
pub struct NookPreparedCompanionPairingActivation {
    _approval: NookPrevalidatedCompanionPairingApproval,
    _records: NookExternalEventLogRecords,
    _heads: Vec<String>,
    _envelopes: AuthEnvelopes,
}

struct PreparedEventGraph {
    heads: Vec<String>,
    envelopes: AuthEnvelopes,
}

#[derive(Debug, thiserror::Error)]
enum CompanionPairingPreparationFailure {
    #[error("pairing event authorization rejected")]
    EventAuthorization,
}

impl CompanionPairingPreparationFailure {
    fn js_error(&self) -> JsError {
        JsError::new(&self.to_string())
    }
}

impl NookPrevalidatedCompanionPairingApproval {
    fn prepare_event_graph(
        &self,
        records: &NookExternalEventLogRecords,
    ) -> Result<PreparedEventGraph, CompanionPairingPreparationFailure> {
        let store_id = StoreId::parse(&self.binding.vault_store_id)
            .map_err(|_| CompanionPairingPreparationFailure::EventAuthorization)?;
        let mut unique = BTreeSet::new();
        let mut event_store = LocalEventStore::new();
        for record in &records.0 {
            let event_id = EventId::parse(&record.event_id)
                .map_err(|_| CompanionPairingPreparationFailure::EventAuthorization)?;
            if !unique.insert(event_id.clone())
                || record
                    .event
                    .id()
                    .map_err(|_| CompanionPairingPreparationFailure::EventAuthorization)?
                    != event_id
            {
                return Err(CompanionPairingPreparationFailure::EventAuthorization);
            }
            let bytes = serialize_event_storage_yaml(&record.event)
                .map_err(|_| CompanionPairingPreparationFailure::EventAuthorization)?;
            let checked = CheckedRemoteEvent::parse(&event_id, &bytes)
                .map_err(|_| CompanionPairingPreparationFailure::EventAuthorization)?;
            if !checked.belongs_to_store(store_id.as_str()) {
                return Err(CompanionPairingPreparationFailure::EventAuthorization);
            }
            event_store.put_event(event_id, bytes);
        }
        if unique.is_empty() {
            return Err(CompanionPairingPreparationFailure::EventAuthorization);
        }
        let graph = event_store
            .load_graph(store_id.as_str())
            .map_err(|_| CompanionPairingPreparationFailure::EventAuthorization)?;
        if !graph.pending_events().is_empty() || !graph.quarantined().is_empty() {
            return Err(CompanionPairingPreparationFailure::EventAuthorization);
        }
        graph
            .validate_authorizations()
            .map_err(|_| CompanionPairingPreparationFailure::EventAuthorization)?;
        let projection = VaultProjection::from_graph(&graph, store_id.as_str())
            .map_err(|_| CompanionPairingPreparationFailure::EventAuthorization)?;
        if !projection.security_conflicts.is_empty() {
            return Err(CompanionPairingPreparationFailure::EventAuthorization);
        }
        let installation = &self.binding.request.installation;
        let device_id = DeviceId::parse(&installation.app_id)
            .map_err(|_| CompanionPairingPreparationFailure::EventAuthorization)?;
        let public_key = DevicePublicKey::parse(&installation.encryption_public_key)
            .map_err(|_| CompanionPairingPreparationFailure::EventAuthorization)?;
        let signing_public_key = DeviceSigningPublicKey::parse(&installation.signing_public_key)
            .map_err(|_| CompanionPairingPreparationFailure::EventAuthorization)?;
        let envelopes = EventGraphDeviceAccess::new(&graph)
            .active_envelopes(&EventGraphDeviceAccessRequest {
                expected_device_id: &device_id,
                expected_public_key: &public_key,
                expected_signing_public_key: &signing_public_key,
            })
            .map_err(|_| CompanionPairingPreparationFailure::EventAuthorization)?
            .ok_or(CompanionPairingPreparationFailure::EventAuthorization)?;
        let mut meta = VaultMetaState::default();
        VaultMetaGraphProjection::new(&graph)
            .materialize(&mut meta)
            .map_err(|_| CompanionPairingPreparationFailure::EventAuthorization)?;
        if !meta.auth.contains_key(
            &public_key
                .auth_id()
                .map_err(|_| CompanionPairingPreparationFailure::EventAuthorization)?,
        ) {
            return Err(CompanionPairingPreparationFailure::EventAuthorization);
        }
        Ok(PreparedEventGraph {
            heads: graph
                .heads()
                .into_iter()
                .map(|head| head.as_str().to_owned())
                .collect(),
            envelopes,
        })
    }

    fn prepare_with_event_log(
        self,
        records: NookExternalEventLogRecords,
    ) -> Result<NookPreparedCompanionPairingActivation, CompanionPairingPreparationFailure> {
        let prepared = self.prepare_event_graph(&records)?;
        Ok(NookPreparedCompanionPairingActivation {
            _approval: self,
            _records: records,
            _heads: prepared.heads,
            _envelopes: prepared.envelopes,
        })
    }
}

#[wasm_bindgen]
impl NookPrevalidatedCompanionPairingApproval {
    pub fn with_event_log(
        self,
        records: NookExternalEventLogRecords,
    ) -> Result<NookPreparedCompanionPairingActivation, JsError> {
        self.prepare_with_event_log(records)
            .map_err(|error| error.js_error())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manager::{NookVaultManager, VaultNameState, event_log::ExternalEventLogRecord};
    use nook_companion_core::{
        CompanionPairingApproval, CompanionPairingApprovalAttempt,
        CompanionPairingEpochMilliseconds, CompanionPairingInstallation,
        CompanionPairingProviderManifestDigest, CompanionPairingRequest, ExtensionConnectScope,
        ExtensionPairingVaultType,
    };
    use nook_core::{
        ActiveVaultScope, AuthProvidersSnapshotData, DeviceIdentity, IsoTimestamp, MemberLabel,
        Sha256Hex, SigningIdentity, StoreId, VaultApplication, VaultKeys, VaultOperation,
    };

    struct ActivationFixture {
        capability: NookPrevalidatedCompanionPairingApproval,
        records: NookExternalEventLogRecords,
        manager: NookVaultManager,
        identity: DeviceIdentity,
    }

    struct AccessRecordsRequest<'a> {
        manager: &'a NookVaultManager,
        identity: &'a DeviceIdentity,
    }

    impl ActivationFixture {
        fn epoch(value: &str) -> anyhow::Result<CompanionPairingEpochMilliseconds> {
            Ok(serde_json::from_str(value)?)
        }

        fn new() -> anyhow::Result<Self> {
            let identity = DeviceIdentity::generate()?;
            let (extension_signing, signing_seed) = SigningIdentity::generate()?;
            let mut manager = NookVaultManager::new();
            manager.application = VaultApplication::Extension;
            manager.vault.store_id = "store_testtoken11".to_owned();
            manager.vault.vault_name = VaultNameState::Named("Personal".to_owned());
            manager.device.id = identity.device_id().as_str().to_owned();
            manager.device.identity_private_key = identity.secret_string().into_inner();
            manager.event_log.signing_seed = signing_seed.into_inner();
            let providers = AuthProvidersSnapshotData {
                providers: Vec::new(),
                active_vault_store_id: ActiveVaultScope::StoreId(manager.vault.store_id.clone()),
            };
            let request = CompanionPairingRequest {
                request_id: "request-activation-1".to_owned(),
                nonce: "nonce-activation-1".to_owned(),
                issued_at: Self::epoch("100")?,
                expires_at: Self::epoch("200")?,
                vault_type: ExtensionPairingVaultType::Simple,
                installation: CompanionPairingInstallation {
                    extension_runtime_id: "runtime-1".to_owned(),
                    app_id: identity.device_id().as_str().to_owned(),
                    encryption_public_key: identity.public_key().as_str().to_owned(),
                    signing_public_key: extension_signing.public_key().as_str().to_owned(),
                    installation_label: "Extension".to_owned(),
                },
                scopes: vec![ExtensionConnectScope::VaultAccess],
            };
            let approval = CompanionPairingApproval {
                request: request.clone(),
                vault_store_id: manager.vault.store_id.clone(),
                vault_name: "Personal".to_owned(),
                approved_at: "2026-09-08T00:00:00Z".to_owned(),
                provider_manifest_digest: CompanionPairingProviderManifestDigest::parse(
                    providers.companion_pairing_manifest_digest()?.as_str(),
                )?,
            };
            let mut endpoint =
                super::super::companion_pairing::NookCompanionPairingExtensionEndpoint::new(
                    request,
                )
                .map_err(|error| anyhow::anyhow!("{error:?}"))?;
            let authority = endpoint
                .take_authority()
                .map_err(|error| anyhow::anyhow!("{error:?}"))?;
            let capability = authority
                .prevalidate(
                    &manager,
                    CompanionPairingApprovalAttempt {
                        approval,
                        observed_at: Self::epoch("150")?,
                    },
                    providers,
                )
                .map_err(|error| anyhow::anyhow!("{error:?}"))?;
            let records = Self::access_records(AccessRecordsRequest {
                manager: &manager,
                identity: &identity,
            })?;
            Ok(Self {
                capability,
                records,
                manager,
                identity,
            })
        }

        fn access_records(
            request: AccessRecordsRequest<'_>,
        ) -> anyhow::Result<NookExternalEventLogRecords> {
            let AccessRecordsRequest { manager, identity } = request;
            let (website_signing, _) = SigningIdentity::generate()?;
            let store_id = StoreId::parse(&manager.vault.store_id)?;
            let key_epoch = EventId::parse("sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo")?;
            let vault_keys = VaultKeys::generate()?;
            let extension_signing =
                SigningIdentity::from_seed_hex_stored(&manager.event_log.signing_seed)?;
            let (event, _) = nook_core::AppendEventInput::build(nook_core::AppendEventInput {
                store_id: &store_id,
                actor_id: &website_signing.actor_id()?,
                signing_identity: &website_signing,
                parents: Vec::new(),
                key_epoch: &key_epoch,
                created_at: &IsoTimestamp::from_trusted("2026-09-08T00:00:00Z".to_owned()),
                operations: vec![
                    VaultOperation::VaultImported {
                        source_content_hash: Sha256Hex::from_trusted("0".repeat(64)),
                        secrets: Vec::new(),
                        password_entries: Vec::new(),
                    },
                    VaultOperation::JoinApproved {
                        device_id: identity.device_id().clone(),
                        encryption_public_key: identity.public_key(),
                        signing_public_key: extension_signing.public_key(),
                        label: MemberLabel::from_trusted("Extension".to_owned()),
                        secrets_key_ciphertext: identity
                            .public_key()
                            .seal_bytes(vault_keys.secrets_key.as_str().as_bytes())?,
                        members_key_ciphertext: identity
                            .public_key()
                            .seal_bytes(vault_keys.members_key.as_str().as_bytes())?,
                    },
                ],
            })?;
            Ok(NookExternalEventLogRecords(vec![ExternalEventLogRecord {
                event_id: event.id()?.as_str().to_owned(),
                event,
            }]))
        }

        fn prepare(
            self,
        ) -> Result<NookPreparedCompanionPairingActivation, CompanionPairingPreparationFailure>
        {
            self.capability.prepare_with_event_log(self.records)
        }
    }

    #[test]
    fn prepares_real_admission_and_authorized_event_graph() -> anyhow::Result<()> {
        let prepared = ActivationFixture::new()?.prepare();
        assert!(prepared.is_ok());
        assert_eq!(
            prepared
                .map_err(|error| anyhow::anyhow!("{error:?}"))?
                ._heads
                .len(),
            1
        );
        Ok(())
    }

    #[test]
    fn rejects_event_grant_for_another_recipient() -> anyhow::Result<()> {
        let mut fixture = ActivationFixture::new()?;
        let other = DeviceIdentity::generate()?;
        fixture.records = ActivationFixture::access_records(AccessRecordsRequest {
            manager: &fixture.manager,
            identity: &other,
        })?;
        assert!(fixture.prepare().is_err());
        Ok(())
    }

    #[test]
    fn rejects_empty_event_graph() -> anyhow::Result<()> {
        let mut fixture = ActivationFixture::new()?;
        fixture.records.0.clear();
        assert!(fixture.prepare().is_err());
        Ok(())
    }

    #[test]
    fn rejects_duplicate_event() -> anyhow::Result<()> {
        let mut fixture = ActivationFixture::new()?;
        fixture.records.0.push(fixture.records.0[0].clone());
        assert!(fixture.prepare().is_err());
        Ok(())
    }

    #[test]
    fn rejects_event_id_substitution() -> anyhow::Result<()> {
        let mut fixture = ActivationFixture::new()?;
        fixture.records.0[0].event_id =
            "sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo".to_owned();
        assert!(fixture.prepare().is_err());
        Ok(())
    }

    #[test]
    fn rejects_event_for_another_vault() -> anyhow::Result<()> {
        let mut fixture = ActivationFixture::new()?;
        fixture.manager.vault.store_id = "store_testtoken12".to_owned();
        fixture.records = ActivationFixture::access_records(AccessRecordsRequest {
            manager: &fixture.manager,
            identity: &fixture.identity,
        })?;
        assert!(fixture.prepare().is_err());
        Ok(())
    }
}

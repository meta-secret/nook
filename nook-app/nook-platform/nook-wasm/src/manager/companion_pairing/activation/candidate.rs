//! Effect-time admission and opaque storage of an inert prepared candidate.

use super::NookPreparedCompanionPairingActivation;
use crate::manager::{NookVaultManager, VaultNameState};
use js_sys::Date;
use nook_companion_core::{
    CompanionPairingApproval, CompanionPairingEpochMilliseconds, CompanionPairingError,
    ExtensionConnectScope,
};
use nook_core::{
    AuthProvidersSnapshotData, DeviceIdentity, EventId, EventStorageBytes, SigningIdentity,
    SymmetricKey, VaultApplication, VaultType, serialize_event_storage_yaml,
};
use wasm_bindgen::{JsError, prelude::wasm_bindgen};
use zeroize::Zeroizing;

mod storage;

/// Opaque readback of an inert candidate. It conveys no live vault authority.
#[wasm_bindgen]
pub struct NookStoredCompanionPairingActivationCandidate {
    _inner: storage::StoredPairingActivationCandidate,
}

struct PairingActivationEvent {
    event_id: EventId,
    bytes: EventStorageBytes,
}

struct PairingActivationCandidate {
    request_id: String,
    vault_store_id: String,
    approval: CompanionPairingApproval,
    application: VaultApplication,
    events: Vec<PairingActivationEvent>,
    event_heads: Vec<EventId>,
    providers: AuthProvidersSnapshotData,
    stored_at: CompanionPairingEpochMilliseconds,
}

#[derive(Debug, PartialEq, Eq, thiserror::Error)]
enum CompanionPairingCandidateFailure {
    #[error("pairing approval expired")]
    Expiry,
    #[error("pairing manager binding rejected")]
    ManagerBinding,
    #[error("pairing provider binding rejected")]
    ProviderBinding,
    #[error("pairing event authorization rejected")]
    EventAuthorization,
    #[error("pairing candidate replay rejected")]
    Replay,
    #[error("unsupported pairing candidate schema")]
    UnsupportedSchema,
    #[error("pairing candidate integrity rejected")]
    Integrity,
    #[error("pairing candidate storage failed")]
    Storage,
}

impl CompanionPairingCandidateFailure {
    fn js_error(&self) -> JsError {
        JsError::new(&self.to_string())
    }
}

struct ActivationObservation {
    epoch: CompanionPairingEpochMilliseconds,
}

trait ActivationClock {
    fn observe(&self) -> Result<ActivationObservation, CompanionPairingCandidateFailure>;
}

struct BrowserActivationClock;

impl ActivationClock for BrowserActivationClock {
    fn observe(&self) -> Result<ActivationObservation, CompanionPairingCandidateFailure> {
        let epoch = serde_json::from_value(serde_json::json!(Date::now()))
            .map_err(|_| CompanionPairingCandidateFailure::Expiry)?;
        Ok(ActivationObservation { epoch })
    }
}

struct CurrentActivationBinding<'a> {
    approval: &'a CompanionPairingApproval,
    providers: &'a AuthProvidersSnapshotData,
    manager: &'a NookVaultManager,
    observed_at: CompanionPairingEpochMilliseconds,
}

impl CurrentActivationBinding<'_> {
    fn validate(&self) -> Result<DeviceIdentity, CompanionPairingCandidateFailure> {
        self.approval
            .revalidate_at(self.observed_at)
            .map_err(|error| match error {
                CompanionPairingError::RequestExpired => CompanionPairingCandidateFailure::Expiry,
                CompanionPairingError::InvalidValue
                | CompanionPairingError::RequestMismatch
                | CompanionPairingError::AuthorityUnavailable
                | CompanionPairingError::InstallationMismatch
                | CompanionPairingError::VaultMismatch
                | CompanionPairingError::ScopeMismatch
                | CompanionPairingError::ProviderManifestMismatch
                | CompanionPairingError::ProviderRecipientMismatch => {
                    CompanionPairingCandidateFailure::ManagerBinding
                }
            })?;
        let vault_name = match &self.manager.vault.vault_name {
            VaultNameState::Named(name) => name,
            VaultNameState::Unnamed => {
                return Err(CompanionPairingCandidateFailure::ManagerBinding);
            }
        };
        if self.manager.application != VaultApplication::Extension
            || self.manager.vault.architecture.vault_type != VaultType::Simple
            || self.manager.vault.store_id != self.approval.vault_store_id
            || vault_name != &self.approval.vault_name
        {
            return Err(CompanionPairingCandidateFailure::ManagerBinding);
        }
        let identity = self
            .manager
            .device_identity()
            .map_err(|_| CompanionPairingCandidateFailure::ManagerBinding)?;
        let signing = SigningIdentity::from_seed_hex_stored(&self.manager.event_log.signing_seed)
            .map_err(|_| CompanionPairingCandidateFailure::ManagerBinding)?;
        let installation = &self.approval.request.installation;
        if identity.device_id().as_str() != installation.app_id
            || identity.public_key().as_str() != installation.encryption_public_key
            || signing.public_key().as_str() != installation.signing_public_key
        {
            return Err(CompanionPairingCandidateFailure::ManagerBinding);
        }
        if self.providers.active_vault_store_id.as_deref()
            != Some(self.approval.vault_store_id.as_str())
            || self.providers.providers.iter().any(|provider| {
                provider.store_id.as_deref() != Some(self.approval.vault_store_id.as_str())
            })
            || (!self
                .approval
                .request
                .scopes
                .contains(&ExtensionConnectScope::SyncProviderCredentials)
                && !self.providers.providers.is_empty())
        {
            return Err(CompanionPairingCandidateFailure::ProviderBinding);
        }
        self.providers
            .authenticate_credentials_for(&identity)
            .map_err(|_| CompanionPairingCandidateFailure::ProviderBinding)?;
        let digest = self
            .providers
            .companion_pairing_manifest_digest()
            .map_err(|_| CompanionPairingCandidateFailure::ProviderBinding)?;
        if digest.as_str() != self.approval.provider_manifest_digest.as_str() {
            return Err(CompanionPairingCandidateFailure::ProviderBinding);
        }
        Ok(identity)
    }
}

struct CandidatePreparation<'a, Clock> {
    manager: &'a NookVaultManager,
    clock: &'a Clock,
}

impl NookPreparedCompanionPairingActivation {
    fn into_candidate<Clock: ActivationClock>(
        self,
        request: CandidatePreparation<'_, Clock>,
    ) -> Result<PairingActivationCandidate, CompanionPairingCandidateFailure> {
        let observed = request.clock.observe()?;
        let identity = CurrentActivationBinding {
            approval: &self.approval.binding,
            providers: &self.approval._providers,
            manager: request.manager,
            observed_at: observed.epoch,
        }
        .validate()?;
        for envelope in [&self.envelopes.secrets_key, &self.envelopes.members_key] {
            let plaintext = Zeroizing::new(
                identity
                    .open_utf8(envelope)
                    .map_err(|_| CompanionPairingCandidateFailure::EventAuthorization)?,
            );
            let key = SymmetricKey::parse(&plaintext)
                .map_err(|_| CompanionPairingCandidateFailure::EventAuthorization)?;
            let _key = Zeroizing::new(key.into_inner());
        }
        let events = self
            .records
            .0
            .into_iter()
            .map(|record| {
                Ok(PairingActivationEvent {
                    event_id: EventId::parse(&record.event_id)
                        .map_err(|_| CompanionPairingCandidateFailure::Integrity)?,
                    bytes: serialize_event_storage_yaml(&record.event)
                        .map_err(|_| CompanionPairingCandidateFailure::Integrity)?,
                })
            })
            .collect::<Result<Vec<_>, CompanionPairingCandidateFailure>>()?;
        let approval = self.approval.binding;
        Ok(PairingActivationCandidate {
            request_id: approval.request.request_id.clone(),
            vault_store_id: approval.vault_store_id.clone(),
            approval,
            application: request.manager.application,
            events,
            event_heads: self.heads,
            providers: self.approval._providers,
            stored_at: observed.epoch,
        })
    }
}

#[wasm_bindgen]
impl NookPreparedCompanionPairingActivation {
    pub async fn commit(
        self,
        manager: &NookVaultManager,
    ) -> Result<NookStoredCompanionPairingActivationCandidate, JsError> {
        let clock = BrowserActivationClock;
        let candidate = self
            .into_candidate(CandidatePreparation {
                manager,
                clock: &clock,
            })
            .map_err(|error| error.js_error())?;
        storage::PairingActivationStore::commit(storage::PairingActivationCommit {
            candidate,
            clock: &clock,
        })
        .await
        .map(|inner| NookStoredCompanionPairingActivationCandidate { _inner: inner })
        .map_err(|error| error.js_error())
    }
}

#[wasm_bindgen]
impl NookVaultManager {
    pub async fn load_companion_pairing_activation_candidate(
        &self,
    ) -> Result<NookStoredCompanionPairingActivationCandidate, JsError> {
        let candidate = storage::PairingActivationStore::load(&self.vault.store_id)
            .await
            .map_err(|error| error.js_error())?;
        let clock = BrowserActivationClock;
        CurrentActivationBinding {
            approval: &candidate.approval,
            providers: &candidate.providers,
            manager: self,
            observed_at: clock.observe().map_err(|error| error.js_error())?.epoch,
        }
        .validate()
        .map_err(|error| error.js_error())?;
        Ok(NookStoredCompanionPairingActivationCandidate {
            _inner: storage::StoredPairingActivationCandidate {
                _candidate: candidate,
            },
        })
    }
}

#[cfg(test)]
mod tests {
    use super::super::tests::ActivationFixture;
    use super::*;
    use nook_core::{ActiveVaultScope, DeviceIdentity, VaultKeys};
    use std::{cell::RefCell, collections::VecDeque};

    pub(super) struct DeterministicClock {
        observations: RefCell<VecDeque<CompanionPairingEpochMilliseconds>>,
    }

    impl DeterministicClock {
        pub(super) fn new(values: Vec<CompanionPairingEpochMilliseconds>) -> Self {
            Self {
                observations: RefCell::new(values.into()),
            }
        }
    }

    impl ActivationClock for DeterministicClock {
        fn observe(&self) -> Result<ActivationObservation, CompanionPairingCandidateFailure> {
            self.observations
                .borrow_mut()
                .pop_front()
                .map(|epoch| ActivationObservation { epoch })
                .ok_or(CompanionPairingCandidateFailure::Integrity)
        }
    }

    pub(super) struct CandidateFixture {
        prepared: NookPreparedCompanionPairingActivation,
        manager: NookVaultManager,
    }

    enum ManagerBindingScenario {
        Application,
        Store,
        VaultName,
        Identity,
    }

    impl CandidateFixture {
        pub(super) fn new() -> anyhow::Result<Self> {
            let ActivationFixture {
                capability,
                records,
                manager,
                identity: _,
            } = ActivationFixture::new()?;
            let prepared = capability
                .prepare_with_event_log(records)
                .map_err(|failure| anyhow::anyhow!(failure.to_string()))?;
            Ok(Self { prepared, manager })
        }

        fn prepare_at(
            self,
            epoch: CompanionPairingEpochMilliseconds,
        ) -> Result<PairingActivationCandidate, CompanionPairingCandidateFailure> {
            self.prepared.into_candidate(CandidatePreparation {
                manager: &self.manager,
                clock: &DeterministicClock::new(vec![epoch]),
            })
        }

        pub(super) fn candidate()
        -> Result<PairingActivationCandidate, CompanionPairingCandidateFailure> {
            Self::new()
                .map_err(|_| CompanionPairingCandidateFailure::Integrity)?
                .prepare_at(
                    ActivationFixture::epoch("160")
                        .map_err(|_| CompanionPairingCandidateFailure::Integrity)?,
                )
        }
    }

    #[test]
    fn real_manager_prepares_inert_storage_candidate() -> anyhow::Result<()> {
        let candidate = CandidateFixture::candidate()
            .map_err(|failure| anyhow::anyhow!(failure.to_string()))?;
        assert_eq!(candidate.events.len(), 1);
        assert_eq!(candidate.event_heads.len(), 1);
        assert!(candidate.providers.providers.is_empty());
        Ok(())
    }

    #[test]
    fn effect_time_expiry_is_typed() -> anyhow::Result<()> {
        assert!(matches!(
            CandidateFixture::new()?.prepare_at(ActivationFixture::epoch("200")?),
            Err(CompanionPairingCandidateFailure::Expiry)
        ));
        Ok(())
    }

    #[test]
    fn current_manager_bindings_are_revalidated() -> anyhow::Result<()> {
        for scenario in [
            ManagerBindingScenario::Application,
            ManagerBindingScenario::Store,
            ManagerBindingScenario::VaultName,
            ManagerBindingScenario::Identity,
        ] {
            let mut fixture = CandidateFixture::new()?;
            match scenario {
                ManagerBindingScenario::Application => {
                    fixture.manager.application = VaultApplication::Simple;
                }
                ManagerBindingScenario::Store => {
                    fixture.manager.vault.store_id = "store_testtoken12".to_owned();
                }
                ManagerBindingScenario::VaultName => {
                    fixture.manager.vault.vault_name = VaultNameState::Unnamed;
                }
                ManagerBindingScenario::Identity => {
                    fixture.manager.device.identity_private_key =
                        DeviceIdentity::generate()?.secret_string().into_inner();
                }
            }
            assert!(matches!(
                fixture.prepare_at(ActivationFixture::epoch("160")?),
                Err(CompanionPairingCandidateFailure::ManagerBinding)
            ));
        }
        Ok(())
    }

    #[test]
    fn effect_time_provider_scope_is_revalidated() -> anyhow::Result<()> {
        let mut fixture = CandidateFixture::new()?;
        fixture.prepared.approval._providers.active_vault_store_id =
            ActiveVaultScope::StoreId("store_testtoken12".to_owned());
        assert!(matches!(
            fixture.prepare_at(ActivationFixture::epoch("160")?),
            Err(CompanionPairingCandidateFailure::ProviderBinding)
        ));
        Ok(())
    }

    #[test]
    fn event_dek_envelopes_must_open_for_current_identity() -> anyhow::Result<()> {
        let fixture = CandidateFixture::new()?;
        let manager = &fixture.manager;
        let mut prepared = fixture.prepared;
        let other = DeviceIdentity::generate()?;
        prepared.envelopes.secrets_key = other
            .public_key()
            .seal_bytes(VaultKeys::generate()?.secrets_key.as_str().as_bytes())?;
        assert!(matches!(
            prepared.into_candidate(CandidatePreparation {
                manager,
                clock: &DeterministicClock::new(vec![ActivationFixture::epoch("160")?]),
            }),
            Err(CompanionPairingCandidateFailure::EventAuthorization)
        ));
        Ok(())
    }

    #[test]
    fn candidate_clock_must_produce_an_observation() -> anyhow::Result<()> {
        let fixture = CandidateFixture::new()?;
        let manager = &fixture.manager;
        let prepared = fixture.prepared;
        assert!(matches!(
            prepared.into_candidate(CandidatePreparation {
                manager,
                clock: &DeterministicClock::new(Vec::new()),
            }),
            Err(CompanionPairingCandidateFailure::Integrity)
        ));
        Ok(())
    }
}

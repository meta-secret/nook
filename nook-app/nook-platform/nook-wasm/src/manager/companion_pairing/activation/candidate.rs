//! Effect-time admission and opaque storage of an inert prepared candidate.

use super::NookPreparedCompanionPairingActivation;
use crate::manager::{NookVaultManager, VaultNameState};
use js_sys::Date;
use nook_companion_core::{
    CompanionPairingApproval, CompanionPairingEpochMilliseconds, CompanionPairingError,
    ExtensionConnectScope,
};
use nook_core::VaultEvent;
use nook_core::{ActiveVaultScope, ProviderVaultScope};
use nook_core::{
    AuthEnvelopes, AuthProvidersSnapshotData, DeviceIdentity, EventId, EventStorageBytes,
    SigningIdentity, StoreId, SymmetricKey, VaultApplication, VaultType,
};
use wasm_bindgen::prelude::wasm_bindgen;
use zeroize::Zeroizing;

mod storage;
use storage::PairingActivationStore;

/// Opaque receipt for an inert candidate publication. It conveys no live vault authority.
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
    vault_store_id: StoreId,
    approval: CompanionPairingApproval,
    application: VaultApplication,
    events: Vec<PairingActivationEvent>,
    event_heads: Vec<EventId>,
    providers: AuthProvidersSnapshotData,
    stored_at: CompanionPairingEpochMilliseconds,
}

struct PairingActivationStorageAdmission<'a> {
    candidate: PairingActivationCandidate,
    envelopes: AuthEnvelopes,
    manager: &'a NookVaultManager,
}

impl PairingActivationStorageAdmission<'_> {
    fn validate_expiry(
        &self,
        observed_at: CompanionPairingEpochMilliseconds,
    ) -> Result<(), CompanionPairingCandidateFailure> {
        self.candidate
            .approval
            .revalidate_at(observed_at)
            .map_err(|_| CompanionPairingCandidateFailure::Expiry)
    }

    fn validate_effect(
        &self,
        observed_at: CompanionPairingEpochMilliseconds,
    ) -> Result<(), CompanionPairingCandidateFailure> {
        let identity = CurrentActivationBinding {
            approval: &self.candidate.approval,
            store_id: &self.candidate.vault_store_id,
            providers: &self.candidate.providers,
            manager: self.manager,
            observed_at,
        }
        .validate()?;
        let mut role_keys = Vec::with_capacity(2);
        for envelope in [&self.envelopes.secrets_key, &self.envelopes.members_key] {
            let plaintext = Zeroizing::new(
                identity
                    .open_utf8(envelope)
                    .map_err(|_| CompanionPairingCandidateFailure::EventAuthorization)?,
            );
            let key = SymmetricKey::parse(&plaintext)
                .map_err(|_| CompanionPairingCandidateFailure::EventAuthorization)?;
            role_keys.push(Zeroizing::new(key.into_inner()));
        }
        let Some([secrets_key, members_key]) = role_keys.as_slice().first_chunk::<2>() else {
            return Err(CompanionPairingCandidateFailure::EventAuthorization);
        };
        if secrets_key
            .as_str()
            .eq_ignore_ascii_case(members_key.as_str())
        {
            return Err(CompanionPairingCandidateFailure::EventAuthorization);
        }
        drop(role_keys);
        Ok(())
    }
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
    #[error("pairing candidate integrity rejected")]
    Integrity,
    #[error("pairing candidate storage failed")]
    Storage,
}

impl CompanionPairingCandidateFailure {
    fn public(&self) -> NookCompanionPairingCandidateFailure {
        match self {
            Self::Expiry => NookCompanionPairingCandidateFailure::Expiry,
            Self::ManagerBinding => NookCompanionPairingCandidateFailure::ManagerBinding,
            Self::ProviderBinding => NookCompanionPairingCandidateFailure::ProviderBinding,
            Self::Replay => NookCompanionPairingCandidateFailure::Replay,
            Self::EventAuthorization | Self::Integrity => {
                NookCompanionPairingCandidateFailure::Integrity
            }
            Self::Storage => NookCompanionPairingCandidateFailure::Storage,
        }
    }
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookCompanionPairingCandidateFailure {
    Expiry,
    ManagerBinding,
    ProviderBinding,
    Replay,
    Integrity,
    Storage,
    OutcomeAccess,
}

#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NookCompanionPairingCandidateOutcomeState {
    Stored,
    Rejected,
}

enum CompanionPairingCandidateOutcome {
    Stored(Box<NookStoredCompanionPairingActivationCandidate>),
    Rejected(NookCompanionPairingCandidateFailure),
}

/// Generated typed result for storing an inert candidate.
#[wasm_bindgen]
pub struct NookCompanionPairingCandidateOutcome(CompanionPairingCandidateOutcome);

impl NookCompanionPairingCandidateOutcome {
    fn from_result(
        result: Result<storage::StoredPairingActivationCandidate, CompanionPairingCandidateFailure>,
    ) -> Self {
        match result {
            Ok(inner) => Self(CompanionPairingCandidateOutcome::Stored(Box::new(
                NookStoredCompanionPairingActivationCandidate { _inner: inner },
            ))),
            Err(failure) => Self(CompanionPairingCandidateOutcome::Rejected(failure.public())),
        }
    }
}

#[wasm_bindgen]
impl NookCompanionPairingCandidateOutcome {
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn state(&self) -> NookCompanionPairingCandidateOutcomeState {
        match &self.0 {
            CompanionPairingCandidateOutcome::Stored(_) => {
                NookCompanionPairingCandidateOutcomeState::Stored
            }
            CompanionPairingCandidateOutcome::Rejected(_) => {
                NookCompanionPairingCandidateOutcomeState::Rejected
            }
        }
    }

    pub fn into_stored(
        self,
    ) -> Result<NookStoredCompanionPairingActivationCandidate, NookCompanionPairingCandidateFailure>
    {
        match self.0 {
            CompanionPairingCandidateOutcome::Stored(candidate) => Ok(*candidate),
            CompanionPairingCandidateOutcome::Rejected(_) => {
                Err(NookCompanionPairingCandidateFailure::OutcomeAccess)
            }
        }
    }

    pub fn into_failure(
        self,
    ) -> Result<NookCompanionPairingCandidateFailure, NookCompanionPairingCandidateFailure> {
        match self.0 {
            CompanionPairingCandidateOutcome::Rejected(failure) => Ok(failure),
            CompanionPairingCandidateOutcome::Stored(_) => {
                Err(NookCompanionPairingCandidateFailure::OutcomeAccess)
            }
        }
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
    store_id: &'a StoreId,
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
            || self.manager.vault.store_id != self.store_id.as_str()
            || self.store_id.as_str() != self.approval.vault_store_id
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
        if !matches!(&self.providers.active_vault_store_id, ActiveVaultScope::StoreId(id) if id == self.approval.vault_store_id.as_str())
            || self.providers.providers.iter().any(|provider| {
                !matches!(&provider.store_id, ProviderVaultScope::StoreId(id) if id == self.approval.vault_store_id.as_str())
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
    fn into_candidate<'a, Clock: ActivationClock>(
        self,
        request: &CandidatePreparation<'a, Clock>,
    ) -> Result<PairingActivationStorageAdmission<'a>, CompanionPairingCandidateFailure> {
        let observed = request.clock.observe()?;
        let events = self
            .records
            .0
            .into_iter()
            .map(|record| {
                Ok(PairingActivationEvent {
                    event_id: EventId::parse(&record.event_id)
                        .map_err(|_| CompanionPairingCandidateFailure::Integrity)?,
                    bytes: VaultEvent::serialize_event_storage_yaml(&record.event)
                        .map_err(|_| CompanionPairingCandidateFailure::Integrity)?,
                })
            })
            .collect::<Result<Vec<_>, CompanionPairingCandidateFailure>>()?;
        let approval = self.approval.binding;
        let admission = PairingActivationStorageAdmission {
            candidate: PairingActivationCandidate {
                request_id: approval.request.request_id.clone(),
                vault_store_id: self.store_id,
                approval,
                application: request.manager.application,
                events,
                event_heads: self.heads,
                providers: self.approval.providers,
                stored_at: observed.epoch,
            },
            envelopes: self.envelopes,
            manager: request.manager,
        };
        admission.validate_effect(observed.epoch)?;
        Ok(admission)
    }
}

#[wasm_bindgen]
impl NookPreparedCompanionPairingActivation {
    pub async fn commit(self, manager: &NookVaultManager) -> NookCompanionPairingCandidateOutcome {
        let clock = BrowserActivationClock;
        let admission = match self.into_candidate(&CandidatePreparation {
            manager,
            clock: &clock,
        }) {
            Ok(candidate) => candidate,
            Err(failure) => return NookCompanionPairingCandidateOutcome::from_result(Err(failure)),
        };
        NookCompanionPairingCandidateOutcome::from_result(
            PairingActivationStore::commit(storage::PairingActivationCommit {
                admission,
                clock: &clock,
            })
            .await,
        )
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

    pub(super) struct CandidateCommitFixture {
        pub(super) candidate: PairingActivationCandidate,
        pub(super) envelopes: AuthEnvelopes,
        pub(super) manager: NookVaultManager,
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
            self.into_commit_fixture(epoch)
                .map(|fixture| fixture.candidate)
        }

        pub(super) fn into_commit_fixture(
            self,
            epoch: CompanionPairingEpochMilliseconds,
        ) -> Result<CandidateCommitFixture, CompanionPairingCandidateFailure> {
            let PairingActivationStorageAdmission {
                candidate,
                envelopes,
                manager: _,
            } = self.prepared.into_candidate(&CandidatePreparation {
                manager: &self.manager,
                clock: &DeterministicClock::new(vec![epoch]),
            })?;
            Ok(CandidateCommitFixture {
                candidate,
                envelopes,
                manager: self.manager,
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

        fn assert_manager_mutation_rejected() -> anyhow::Result<()> {
            for scenario in [
                ManagerBindingScenario::Application,
                ManagerBindingScenario::Store,
                ManagerBindingScenario::VaultName,
                ManagerBindingScenario::Identity,
            ] {
                let mut fixture = Self::new()?;
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

        fn assert_real_candidate() -> anyhow::Result<()> {
            let candidate =
                Self::candidate().map_err(|failure| anyhow::anyhow!(failure.to_string()))?;
            assert_eq!(candidate.events.len(), 1);
            assert_eq!(candidate.event_heads.len(), 1);
            assert_eq!(candidate.vault_store_id.as_str(), "store_testtoken11");
            assert!(candidate.providers.providers.is_empty());
            Ok(())
        }
    }

    #[test]
    fn real_manager_prepares_inert_storage_candidate() -> anyhow::Result<()> {
        CandidateFixture::assert_real_candidate()
    }

    struct CandidateOutcomeFixture;

    impl CandidateOutcomeFixture {
        fn assert_public_failure_projection() {
            for (failure, public) in [
                (
                    CompanionPairingCandidateFailure::Expiry,
                    NookCompanionPairingCandidateFailure::Expiry,
                ),
                (
                    CompanionPairingCandidateFailure::ManagerBinding,
                    NookCompanionPairingCandidateFailure::ManagerBinding,
                ),
                (
                    CompanionPairingCandidateFailure::ProviderBinding,
                    NookCompanionPairingCandidateFailure::ProviderBinding,
                ),
                (
                    CompanionPairingCandidateFailure::EventAuthorization,
                    NookCompanionPairingCandidateFailure::Integrity,
                ),
                (
                    CompanionPairingCandidateFailure::Replay,
                    NookCompanionPairingCandidateFailure::Replay,
                ),
                (
                    CompanionPairingCandidateFailure::Integrity,
                    NookCompanionPairingCandidateFailure::Integrity,
                ),
                (
                    CompanionPairingCandidateFailure::Storage,
                    NookCompanionPairingCandidateFailure::Storage,
                ),
            ] {
                assert_eq!(failure.public(), public);
            }
        }

        fn assert_wrong_access_rejected() -> anyhow::Result<()> {
            let rejected = NookCompanionPairingCandidateOutcome::from_result(Err(
                CompanionPairingCandidateFailure::Replay,
            ));
            assert!(matches!(
                rejected.into_stored(),
                Err(NookCompanionPairingCandidateFailure::OutcomeAccess)
            ));
            let stored = NookCompanionPairingCandidateOutcome::from_result(Ok(
                storage::StoredPairingActivationCandidate {
                    _candidate: CandidateFixture::candidate()?,
                },
            ));
            assert!(matches!(
                stored.into_failure(),
                Err(NookCompanionPairingCandidateFailure::OutcomeAccess)
            ));
            Ok(())
        }
    }

    #[test]
    fn internal_failures_have_stable_public_categories() {
        CandidateOutcomeFixture::assert_public_failure_projection();
    }

    #[test]
    fn outcome_accessors_reject_the_wrong_state_without_panicking() -> anyhow::Result<()> {
        CandidateOutcomeFixture::assert_wrong_access_rejected()
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
        CandidateFixture::assert_manager_mutation_rejected()
    }

    #[test]
    fn effect_time_provider_scope_is_revalidated() -> anyhow::Result<()> {
        let mut fixture = CandidateFixture::new()?;
        fixture.prepared.approval.providers.active_vault_store_id =
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
            prepared.into_candidate(&CandidatePreparation {
                manager,
                clock: &DeterministicClock::new(vec![ActivationFixture::epoch("160")?]),
            }),
            Err(CompanionPairingCandidateFailure::EventAuthorization)
        ));
        let mut fixture = CandidateFixture::new()?;
        let identity = fixture.manager.device_identity()?;
        let secrets_key =
            Zeroizing::new(identity.open_utf8(&fixture.prepared.envelopes.secrets_key)?);
        let same_key = Zeroizing::new(secrets_key.to_ascii_uppercase());
        fixture.prepared.envelopes.members_key =
            identity.public_key().seal_bytes(same_key.as_bytes())?;
        assert!(matches!(
            fixture.prepare_at(ActivationFixture::epoch("160")?),
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
            prepared.into_candidate(&CandidatePreparation {
                manager,
                clock: &DeterministicClock::new(Vec::new()),
            }),
            Err(CompanionPairingCandidateFailure::Integrity)
        ));
        Ok(())
    }
}

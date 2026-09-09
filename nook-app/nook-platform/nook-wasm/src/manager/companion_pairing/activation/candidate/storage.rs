//! Atomic storage for inert candidates; the gate is the only publication point.

use super::{
    ActivationClock, CompanionPairingCandidateFailure, PairingActivationCandidate,
    PairingActivationStorageAdmission,
};
use crate::ExtensionPairingDatabase;
use crate::NookDatabase;

use rexie::TransactionMode;

mod schema;
use schema::{CandidateSchema, EncodedCandidate};

const VAULT_STORE: &str = "vault";

pub(super) struct PairingActivationCommit<'a, Clock> {
    pub(super) admission: PairingActivationStorageAdmission<'a>,
    pub(super) clock: &'a Clock,
}

pub(super) struct StoredPairingActivationCandidate {
    pub(super) _candidate: PairingActivationCandidate,
}

pub(super) struct PairingActivationStore;

struct StoredStringRead<'a> {
    store: &'a rexie::Store,
    key: &'a str,
}

struct StoredStringWrite<'a> {
    store: &'a rexie::Store,
    key: &'a str,
    value: &'a str,
}

struct StoredStringValue<'a> {
    key: &'a str,
    value: &'a str,
}

struct WritableActivationTransaction {
    transaction: rexie::Transaction,
    store: rexie::Store,
}

impl WritableActivationTransaction {
    async fn write(
        self,
        value: StoredStringValue<'_>,
    ) -> Result<Self, CompanionPairingCandidateFailure> {
        match PairingActivationStore::put_string(StoredStringWrite {
            store: &self.store,
            key: value.key,
            value: value.value,
        })
        .await
        {
            Ok(()) => Ok(self),
            Err(failure) => Err(self.abort(failure).await),
        }
    }

    async fn abort(
        self,
        failure: CompanionPairingCandidateFailure,
    ) -> CompanionPairingCandidateFailure {
        self.transaction
            .abort()
            .await
            .map_or(CompanionPairingCandidateFailure::Storage, |()| failure)
    }

    async fn done(self) -> Result<(), CompanionPairingCandidateFailure> {
        self.transaction
            .done()
            .await
            .map(|_| ())
            .map_err(|_| CompanionPairingCandidateFailure::Storage)
    }
}

impl PairingActivationStore {
    async fn get_string(
        request: StoredStringRead<'_>,
    ) -> Result<Option<String>, CompanionPairingCandidateFailure> {
        let key =
            serde_wasm_bindgen::to_value(request.key).map_err(|_| CandidateSchema::integrity())?;
        request
            .store
            .get(key)
            .await
            .map_err(|_| CompanionPairingCandidateFailure::Storage)?
            .map(serde_wasm_bindgen::from_value)
            .transpose()
            .map_err(|_| CandidateSchema::integrity())
    }

    async fn put_string(
        request: StoredStringWrite<'_>,
    ) -> Result<(), CompanionPairingCandidateFailure> {
        let key =
            serde_wasm_bindgen::to_value(request.key).map_err(|_| CandidateSchema::integrity())?;
        let value = serde_wasm_bindgen::to_value(request.value)
            .map_err(|_| CandidateSchema::integrity())?;
        request
            .store
            .put(&value, Some(&key))
            .await
            .map(|_| ())
            .map_err(|_| CompanionPairingCandidateFailure::Storage)
    }

    pub(super) async fn commit<Clock: ActivationClock>(
        request: PairingActivationCommit<'_, Clock>,
    ) -> Result<StoredPairingActivationCandidate, CompanionPairingCandidateFailure> {
        let PairingActivationCommit { admission, clock } = request;
        let encoded = EncodedCandidate::new(&admission.candidate)?;
        let gate_json = CandidateSchema::encode(&encoded.gate)?;
        let connection = NookDatabase::open_nook_database()
            .await
            .map_err(|_| CompanionPairingCandidateFailure::Storage)?;
        let transaction = connection
            .transaction(&[VAULT_STORE], TransactionMode::ReadWrite)
            .map_err(|_| CompanionPairingCandidateFailure::Storage)?;
        let vault = transaction
            .store(VAULT_STORE)
            .map_err(|_| CompanionPairingCandidateFailure::Storage)?;
        if Self::get_string(StoredStringRead {
            store: &vault,
            key: &encoded.gate_key,
        })
        .await?
        .is_some()
        {
            return Err(CompanionPairingCandidateFailure::Replay);
        }
        admission.validate_effect(clock.observe()?.epoch)?;
        let mut writable = WritableActivationTransaction {
            transaction,
            store: vault,
        };
        for (key, value) in &encoded.events {
            writable = writable.write(StoredStringValue { key, value }).await?;
        }
        writable = writable
            .write(StoredStringValue {
                key: &encoded.gate.provider_payload_key,
                value: &encoded.providers,
            })
            .await?;
        let freshness = clock
            .observe()
            .and_then(|observed| admission.validate_expiry(observed.epoch));
        if let Err(failure) = freshness {
            return Err(writable.abort(failure).await);
        }
        writable = writable
            .write(StoredStringValue {
                key: &encoded.gate_key,
                value: &gate_json,
            })
            .await?;
        let freshness = clock
            .observe()
            .and_then(|observed| admission.validate_expiry(observed.epoch));
        if let Err(failure) = freshness {
            return Err(writable.abort(failure).await);
        }
        writable.done().await?;
        Ok(StoredPairingActivationCandidate {
            _candidate: admission.candidate,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::super::tests::{CandidateFixture, DeterministicClock};
    use super::*;
    use crate::manager::companion_pairing::activation::tests::ActivationFixture;
    use std::collections::BTreeMap;

    #[derive(Default)]
    struct MemoryActivationStore {
        vault: BTreeMap<String, String>,
    }

    struct InterruptedCommit<'a> {
        encoded: &'a EncodedCandidate,
        writes_before_failure: usize,
    }

    impl MemoryActivationStore {
        fn commit(
            &mut self,
            encoded: EncodedCandidate,
        ) -> Result<(), CompanionPairingCandidateFailure> {
            if self.vault.contains_key(&encoded.gate_key) {
                return Err(CompanionPairingCandidateFailure::Replay);
            }
            let mut transaction = self.vault.clone();
            for (key, value) in encoded.events {
                transaction.insert(key, value);
            }
            transaction.insert(encoded.gate.provider_payload_key.clone(), encoded.providers);
            transaction.insert(encoded.gate_key, CandidateSchema::encode(&encoded.gate)?);
            self.vault = transaction;
            Ok(())
        }

        fn interrupted_commit(
            &mut self,
            request: InterruptedCommit<'_>,
        ) -> Result<(), CompanionPairingCandidateFailure> {
            let mut transaction = self.vault.clone();
            let gate_json = CandidateSchema::encode(&request.encoded.gate)?;
            let mut writes: Vec<(&String, &String)> = request
                .encoded
                .events
                .iter()
                .map(|(key, value)| (key, value))
                .collect();
            writes.extend([
                (
                    &request.encoded.gate.provider_payload_key,
                    &request.encoded.providers,
                ),
                (&request.encoded.gate_key, &gate_json),
            ]);
            for (index, (key, value)) in writes.into_iter().enumerate() {
                if index == request.writes_before_failure {
                    return Err(CompanionPairingCandidateFailure::Storage);
                }
                transaction.insert(key.clone(), value.clone());
            }
            self.vault = transaction;
            Ok(())
        }

        fn commit_with_clock(
            &mut self,
            request: PairingActivationCommit<'_, DeterministicClock>,
        ) -> Result<(), CompanionPairingCandidateFailure> {
            let PairingActivationCommit { admission, clock } = request;
            admission.validate_effect(clock.observe()?.epoch)?;
            let encoded = EncodedCandidate::new(&admission.candidate)?;
            let mut transaction = Self {
                vault: self.vault.clone(),
            };
            admission.validate_expiry(clock.observe()?.epoch)?;
            transaction.commit(encoded)?;
            admission.validate_expiry(clock.observe()?.epoch)?;
            *self = transaction;
            Ok(())
        }
    }

    struct MemoryStorageScenarios;

    impl MemoryStorageScenarios {
        fn commit_publishes_only_activation_keys() -> anyhow::Result<()> {
            let candidate = CandidateFixture::candidate()
                .map_err(|failure| anyhow::anyhow!(failure.to_string()))?;
            let mut store = MemoryActivationStore::default();
            store.commit(EncodedCandidate::new(&candidate)?)?;
            assert!(
                store
                    .vault
                    .keys()
                    .all(|key| key.starts_with("companion-pairing-activation:"))
            );
            Ok(())
        }

        fn commit_rejects_replay() -> anyhow::Result<()> {
            let mut store = MemoryActivationStore::default();
            store.commit(EncodedCandidate::new(&CandidateFixture::candidate()?)?)?;
            assert!(matches!(
                store.commit(EncodedCandidate::new(&CandidateFixture::candidate()?)?),
                Err(CompanionPairingCandidateFailure::Replay)
            ));
            Ok(())
        }

        fn every_interrupted_write_rolls_back() -> anyhow::Result<()> {
            let candidate = CandidateFixture::candidate()?;
            let encoded = EncodedCandidate::new(&candidate)?;
            for writes_before_failure in 0..(encoded.events.len() + 2) {
                let mut store = MemoryActivationStore::default();
                assert!(matches!(
                    store.interrupted_commit(InterruptedCommit {
                        encoded: &encoded,
                        writes_before_failure,
                    }),
                    Err(CompanionPairingCandidateFailure::Storage)
                ));
                assert!(store.vault.is_empty());
            }
            Ok(())
        }

        fn late_expiry_and_manager_mutation_discard_transaction() -> anyhow::Result<()> {
            let mut store = MemoryActivationStore::default();
            for observations in [
                vec![ActivationFixture::epoch("160")?],
                vec![ActivationFixture::epoch("160")?; 2],
            ] {
                let fixture = CandidateFixture::new()?
                    .into_commit_fixture(ActivationFixture::epoch("160")?)?;
                assert!(matches!(
                    store.commit_with_clock(PairingActivationCommit {
                        admission: PairingActivationStorageAdmission {
                            candidate: fixture.candidate,
                            envelopes: fixture.envelopes,
                            manager: &fixture.manager,
                        },
                        clock: &DeterministicClock::new(observations),
                    }),
                    Err(CompanionPairingCandidateFailure::Integrity)
                ));
                assert!(store.vault.is_empty());
            }
            for observations in [
                vec![
                    ActivationFixture::epoch("160")?,
                    ActivationFixture::epoch("200")?,
                ],
                vec![
                    ActivationFixture::epoch("160")?,
                    ActivationFixture::epoch("160")?,
                    ActivationFixture::epoch("200")?,
                ],
            ] {
                let fixture = CandidateFixture::new()?
                    .into_commit_fixture(ActivationFixture::epoch("160")?)?;
                assert!(matches!(
                    store.commit_with_clock(PairingActivationCommit {
                        admission: PairingActivationStorageAdmission {
                            candidate: fixture.candidate,
                            envelopes: fixture.envelopes,
                            manager: &fixture.manager,
                        },
                        clock: &DeterministicClock::new(observations),
                    }),
                    Err(CompanionPairingCandidateFailure::Expiry)
                ));
                assert!(store.vault.is_empty());
            }
            let mut fixture =
                CandidateFixture::new()?.into_commit_fixture(ActivationFixture::epoch("160")?)?;
            fixture.manager.application = nook_core::VaultApplication::Simple;
            assert!(matches!(
                store.commit_with_clock(PairingActivationCommit {
                    admission: PairingActivationStorageAdmission {
                        candidate: fixture.candidate,
                        envelopes: fixture.envelopes,
                        manager: &fixture.manager,
                    },
                    clock: &DeterministicClock::new(vec![ActivationFixture::epoch("160")?]),
                }),
                Err(CompanionPairingCandidateFailure::ManagerBinding)
            ));
            assert!(store.vault.is_empty());
            Ok(())
        }
    }

    #[test]
    fn memory_commit_publishes_only_activation_keys() -> anyhow::Result<()> {
        MemoryStorageScenarios::commit_publishes_only_activation_keys()
    }

    #[test]
    fn memory_commit_rejects_replay() -> anyhow::Result<()> {
        MemoryStorageScenarios::commit_rejects_replay()
    }

    #[test]
    fn every_interrupted_memory_write_rolls_back() -> anyhow::Result<()> {
        MemoryStorageScenarios::every_interrupted_write_rolls_back()
    }

    #[test]
    fn late_expiry_and_manager_mutation_discard_memory_transaction() -> anyhow::Result<()> {
        MemoryStorageScenarios::late_expiry_and_manager_mutation_discard_transaction()
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use super::super::tests::{CandidateCommitFixture, CandidateFixture, DeterministicClock};
    use super::*;
    use crate::{
        NookError,
        manager::companion_pairing::activation::tests::ActivationFixture,
        storage::{extension_state, indexed_db},
    };
    use rexie::TransactionMode;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    struct BrowserStorageFixture;

    impl BrowserStorageFixture {
        fn candidate() -> Result<CandidateCommitFixture, NookError> {
            let mut fixture = Self::expiring_candidate()?;
            fixture.candidate.approval.request.expires_at =
                serde_json::from_str("9007199254740991")
                    .map_err(|error| NookError::Database(error.to_string()))?;
            Ok(fixture)
        }

        fn expiring_candidate() -> Result<CandidateCommitFixture, NookError> {
            CandidateFixture::new()
                .map_err(|error| NookError::Database(error.to_string()))?
                .into_commit_fixture(Self::epoch("160")?)
                .map_err(|failure| NookError::Database(failure.to_string()))
        }

        fn epoch(
            value: &str,
        ) -> Result<nook_companion_core::CompanionPairingEpochMilliseconds, NookError> {
            ActivationFixture::epoch(value).map_err(|error| NookError::Database(error.to_string()))
        }

        async fn commit(
            fixture: CandidateCommitFixture,
        ) -> Result<StoredPairingActivationCandidate, NookError> {
            let clock = super::super::BrowserActivationClock;
            PairingActivationStore::commit(PairingActivationCommit {
                admission: PairingActivationStorageAdmission {
                    candidate: fixture.candidate,
                    envelopes: fixture.envelopes,
                    manager: &fixture.manager,
                },
                clock: &clock,
            })
            .await
            .map_err(|failure| NookError::Database(failure.to_string()))
        }

        async fn activation_keys() -> Result<Vec<String>, NookError> {
            let connection = NookDatabase::open_nook_database().await?;
            let transaction = connection
                .transaction(&[VAULT_STORE], TransactionMode::ReadOnly)
                .map_err(|error| NookError::Database(format!("test transaction: {error:?}")))?;
            let vault = transaction
                .store(VAULT_STORE)
                .map_err(|error| NookError::Database(format!("test store: {error:?}")))?;
            let keys = vault
                .get_all_keys(None, None)
                .await
                .map_err(|error| NookError::Database(format!("test key scan: {error:?}")))?
                .into_iter()
                .map(serde_wasm_bindgen::from_value)
                .collect::<Result<Vec<String>, _>>()
                .map_err(|error| NookError::Database(format!("test key decode: {error}")))?;
            transaction
                .done()
                .await
                .map_err(|error| NookError::Database(format!("test read: {error:?}")))?;
            Ok(keys
                .into_iter()
                .filter(|key| key.starts_with("companion-pairing-activation:"))
                .collect())
        }

        async fn authoritative_events_exclude_candidates() -> Result<(), NookError> {
            let connection = NookDatabase::open_nook_database().await?;
            let transaction = connection
                .transaction(&["events"], TransactionMode::ReadOnly)
                .map_err(|error| NookError::Database(format!("test transaction: {error:?}")))?;
            let events = transaction
                .store("events")
                .map_err(|error| NookError::Database(format!("test store: {error:?}")))?;
            for key in events
                .get_all_keys(None, None)
                .await
                .map_err(|error| NookError::Database(format!("test key scan: {error:?}")))?
            {
                let key: String = serde_wasm_bindgen::from_value(key)
                    .map_err(|error| NookError::Database(format!("test key decode: {error}")))?;
                assert!(!key.starts_with("companion-pairing-activation:"));
            }
            transaction
                .done()
                .await
                .map_err(|error| NookError::Database(format!("test read: {error:?}")))?;
            Ok(())
        }

        async fn commit_and_replay_remain_inert() -> Result<(), NookError> {
            NookDatabase::clear_vault_db().await?;
            let authoritative_before = ExtensionPairingDatabase::read_all().await?;
            let fixture = Self::candidate()?;
            Self::commit(fixture).await?;
            assert!(!Self::activation_keys().await?.is_empty());
            assert_eq!(
                ExtensionPairingDatabase::read_all().await?,
                authoritative_before
            );
            Self::authoritative_events_exclude_candidates().await?;
            assert!(Self::commit(Self::candidate()?).await.is_err());
            Ok(())
        }

        async fn concurrent_commits_have_one_winner() -> Result<(), NookError> {
            NookDatabase::clear_vault_db().await?;
            let first = Self::commit(Self::candidate()?);
            let second = Self::commit(Self::candidate()?);
            let (first, second) = futures_util::join!(first, second);
            assert_ne!(first.is_ok(), second.is_ok());
            Ok(())
        }

        async fn late_expiry_aborts_payloads_and_gate() -> Result<(), NookError> {
            NookDatabase::clear_vault_db().await?;
            let fixture = Self::expiring_candidate()?;
            let clock = DeterministicClock::new(vec![
                Self::epoch("160")?,
                Self::epoch("160")?,
                Self::epoch("200")?,
            ]);
            assert!(matches!(
                PairingActivationStore::commit(PairingActivationCommit {
                    admission: PairingActivationStorageAdmission {
                        candidate: fixture.candidate,
                        envelopes: fixture.envelopes,
                        manager: &fixture.manager,
                    },
                    clock: &clock,
                })
                .await,
                Err(CompanionPairingCandidateFailure::Expiry)
            ));
            assert!(Self::activation_keys().await?.is_empty());
            Self::authoritative_events_exclude_candidates().await
        }

        async fn observation_failure_aborts_payloads_and_gate() -> Result<(), NookError> {
            for observations in [vec![Self::epoch("160")?], vec![Self::epoch("160")?; 2]] {
                NookDatabase::clear_vault_db().await?;
                let fixture = Self::expiring_candidate()?;
                let result = PairingActivationStore::commit(PairingActivationCommit {
                    admission: PairingActivationStorageAdmission {
                        candidate: fixture.candidate,
                        envelopes: fixture.envelopes,
                        manager: &fixture.manager,
                    },
                    clock: &DeterministicClock::new(observations),
                })
                .await;
                assert!(matches!(
                    result,
                    Err(CompanionPairingCandidateFailure::Integrity)
                ));
                assert!(Self::activation_keys().await?.is_empty());
            }
            Ok(())
        }
    }

    #[wasm_bindgen_test]
    async fn indexed_db_commit_and_replay_remain_inert() -> Result<(), NookError> {
        BrowserStorageFixture::commit_and_replay_remain_inert().await
    }

    #[wasm_bindgen_test]
    async fn indexed_db_concurrent_commits_have_one_winner() -> Result<(), NookError> {
        BrowserStorageFixture::concurrent_commits_have_one_winner().await
    }

    #[wasm_bindgen_test]
    async fn indexed_db_late_expiry_aborts_payloads_and_gate() -> Result<(), NookError> {
        BrowserStorageFixture::late_expiry_aborts_payloads_and_gate().await
    }

    #[wasm_bindgen_test]
    async fn indexed_db_observation_failure_aborts_payloads_and_gate() -> Result<(), NookError> {
        BrowserStorageFixture::observation_failure_aborts_payloads_and_gate().await
    }
}

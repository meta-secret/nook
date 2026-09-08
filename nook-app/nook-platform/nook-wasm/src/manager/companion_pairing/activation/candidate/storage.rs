//! Atomic storage for inert candidates; the gate is the only publication point.

use super::{ActivationClock, CompanionPairingCandidateFailure, PairingActivationCandidate};
use crate::storage::open_nook_database;
use nook_core::StoreId;
use rexie::TransactionMode;

mod schema;
use schema::{CandidateSchema, EncodedCandidate};

const VAULT_STORE: &str = "vault";

pub(super) struct PairingActivationCommit<'a, Clock> {
    pub(super) candidate: PairingActivationCandidate,
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
        let PairingActivationCommit { candidate, clock } = request;
        let encoded = EncodedCandidate::new(&candidate)?;
        encoded.decode()?;
        let gate_json = CandidateSchema::encode(&encoded.gate)?;
        let connection = open_nook_database()
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
        candidate
            .approval
            .revalidate_at(clock.observe()?.epoch)
            .map_err(|_| CompanionPairingCandidateFailure::Expiry)?;
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
        let freshness = clock.observe().and_then(|observed| {
            candidate
                .approval
                .revalidate_at(observed.epoch)
                .map_err(|_| CompanionPairingCandidateFailure::Expiry)
        });
        if let Err(failure) = freshness {
            return Err(writable.abort(failure).await);
        }
        writable = writable
            .write(StoredStringValue {
                key: &encoded.gate_key,
                value: &gate_json,
            })
            .await?;
        writable.done().await?;
        Ok(StoredPairingActivationCandidate {
            _candidate: candidate,
        })
    }

    pub(super) async fn load(
        vault_store_id: &StoreId,
    ) -> Result<PairingActivationCandidate, CompanionPairingCandidateFailure> {
        let gate_key = CandidateSchema::gate_key(vault_store_id.as_str());
        let connection = open_nook_database()
            .await
            .map_err(|_| CompanionPairingCandidateFailure::Storage)?;
        let transaction = connection
            .transaction(&[VAULT_STORE], TransactionMode::ReadOnly)
            .map_err(|_| CompanionPairingCandidateFailure::Storage)?;
        let vault = transaction
            .store(VAULT_STORE)
            .map_err(|_| CompanionPairingCandidateFailure::Storage)?;
        let gate_json = Self::get_string(StoredStringRead {
            store: &vault,
            key: &gate_key,
        })
        .await?
        .ok_or_else(CandidateSchema::integrity)?;
        let gate = CandidateSchema::decode_gate(&gate_json)?;
        let mut events = Vec::with_capacity(gate.event_payload_keys.len());
        for key in &gate.event_payload_keys {
            events.push((
                key.clone(),
                Self::get_string(StoredStringRead { store: &vault, key })
                    .await?
                    .ok_or_else(CandidateSchema::integrity)?,
            ));
        }
        let providers = Self::get_string(StoredStringRead {
            store: &vault,
            key: &gate.provider_payload_key,
        })
        .await?
        .ok_or_else(CandidateSchema::integrity)?;
        transaction
            .done()
            .await
            .map_err(|_| CompanionPairingCandidateFailure::Storage)?;
        EncodedCandidate {
            gate_key,
            gate,
            events,
            providers,
        }
        .decode()
    }
}

#[cfg(test)]
mod tests {
    use super::super::tests::{CandidateFixture, DeterministicClock};
    use super::*;
    use crate::manager::companion_pairing::activation::tests::ActivationFixture;
    use nook_core::Sha256Hex;
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

        fn load(
            &self,
            vault_store_id: &StoreId,
        ) -> Result<EncodedCandidate, CompanionPairingCandidateFailure> {
            let gate_key = CandidateSchema::gate_key(vault_store_id.as_str());
            let gate = CandidateSchema::decode_gate(
                self.vault
                    .get(&gate_key)
                    .ok_or_else(CandidateSchema::integrity)?,
            )?;
            let events = gate
                .event_payload_keys
                .iter()
                .map(|key| {
                    Ok((
                        key.clone(),
                        self.vault
                            .get(key)
                            .ok_or_else(CandidateSchema::integrity)?
                            .clone(),
                    ))
                })
                .collect::<Result<Vec<_>, CompanionPairingCandidateFailure>>()?;
            let providers = self
                .vault
                .get(&gate.provider_payload_key)
                .ok_or_else(CandidateSchema::integrity)?
                .clone();
            Ok(EncodedCandidate {
                gate_key,
                gate,
                events,
                providers,
            })
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
            let PairingActivationCommit { candidate, clock } = request;
            candidate
                .approval
                .revalidate_at(clock.observe()?.epoch)
                .map_err(|_| CompanionPairingCandidateFailure::Expiry)?;
            let encoded = EncodedCandidate::new(&candidate)?;
            let mut transaction = Self {
                vault: self.vault.clone(),
            };
            transaction.commit(encoded)?;
            candidate
                .approval
                .revalidate_at(clock.observe()?.epoch)
                .map_err(|_| CompanionPairingCandidateFailure::Expiry)?;
            *self = transaction;
            Ok(())
        }
    }

    #[test]
    fn memory_commit_round_trips_real_candidate() -> anyhow::Result<()> {
        let candidate = CandidateFixture::candidate()
            .map_err(|failure| anyhow::anyhow!(failure.to_string()))?;
        let vault_store_id = candidate.vault_store_id.clone();
        let mut store = MemoryActivationStore::default();
        store.commit(EncodedCandidate::new(&candidate)?)?;
        store.load(&vault_store_id)?.decode()?;
        assert!(
            store
                .vault
                .keys()
                .all(|key| key.starts_with("companion-pairing-activation:"))
        );
        Ok(())
    }

    #[test]
    fn payload_without_gate_is_inert() -> anyhow::Result<()> {
        let candidate = CandidateFixture::candidate()?;
        let encoded = EncodedCandidate::new(&candidate)?;
        let mut store = MemoryActivationStore::default();
        let (key, value) = &encoded.events[0];
        store.vault.insert(key.clone(), value.clone());
        assert!(store.load(&candidate.vault_store_id).is_err());
        Ok(())
    }

    #[test]
    fn memory_commit_rejects_replay() -> anyhow::Result<()> {
        let mut store = MemoryActivationStore::default();
        store.commit(EncodedCandidate::new(&CandidateFixture::candidate()?)?)?;
        assert!(matches!(
            store.commit(EncodedCandidate::new(&CandidateFixture::candidate()?)?),
            Err(CompanionPairingCandidateFailure::Replay)
        ));
        Ok(())
    }

    #[test]
    fn missing_or_corrupt_payload_is_rejected() -> anyhow::Result<()> {
        for corruption in 0..2 {
            let candidate = CandidateFixture::candidate()?;
            let vault_store_id = candidate.vault_store_id.clone();
            let mut store = MemoryActivationStore::default();
            store.commit(EncodedCandidate::new(&candidate)?)?;
            let encoded = store.load(&vault_store_id)?;
            if corruption == 0 {
                store.vault.remove(&encoded.gate.event_payload_keys[0]);
            } else {
                store
                    .vault
                    .insert(encoded.gate.provider_payload_key.clone(), "{}".to_owned());
            }
            assert!(
                store
                    .load(&vault_store_id)
                    .and_then(|value| value.decode())
                    .is_err()
            );
        }
        Ok(())
    }

    #[test]
    fn unsupported_schema_version_has_typed_failure() -> anyhow::Result<()> {
        let candidate = CandidateFixture::candidate()?;
        let vault_store_id = candidate.vault_store_id.clone();
        let mut store = MemoryActivationStore::default();
        store.commit(EncodedCandidate::new(&candidate)?)?;
        let gate_key = CandidateSchema::gate_key(vault_store_id.as_str());
        let gate = store
            .vault
            .get(&gate_key)
            .ok_or_else(|| anyhow::anyhow!("gate missing"))?
            .replace("\"schema_version\":1", "\"schema_version\":2");
        store.vault.insert(gate_key, gate);
        assert!(matches!(
            store.load(&vault_store_id),
            Err(CompanionPairingCandidateFailure::UnsupportedSchema)
        ));
        Ok(())
    }

    #[test]
    fn gate_and_event_rows_reject_unknown_fields() -> anyhow::Result<()> {
        let candidate = CandidateFixture::candidate()?;
        let encoded = EncodedCandidate::new(&candidate)?;
        let mut gate = serde_json::to_value(&encoded.gate)?;
        gate.as_object_mut()
            .ok_or_else(|| anyhow::anyhow!("gate must be an object"))?
            .insert("unknown".to_owned(), true.into());
        assert!(CandidateSchema::decode_gate(&serde_json::to_string(&gate)?).is_err());
        let mut row: serde_json::Value = serde_json::from_str(&encoded.events[0].1)?;
        row.as_object_mut()
            .ok_or_else(|| anyhow::anyhow!("row must be an object"))?
            .insert("unknown".to_owned(), true.into());
        assert!(
            CandidateSchema::decode::<schema::ActivationEventRow>(&serde_json::to_string(&row)?)
                .is_err()
        );
        Ok(())
    }

    #[test]
    fn provider_payload_rejects_unknown_fields_after_digest_substitution() -> anyhow::Result<()> {
        enum UnknownField {
            Snapshot,
            ActiveVaultScope,
        }

        for unknown_field in [UnknownField::Snapshot, UnknownField::ActiveVaultScope] {
            let candidate = CandidateFixture::candidate()?;
            let mut encoded = EncodedCandidate::new(&candidate)?;
            let mut providers: serde_json::Value = serde_json::from_str(&encoded.providers)?;
            let provider_object = providers
                .as_object_mut()
                .ok_or_else(|| anyhow::anyhow!("provider snapshot must be an object"))?;
            match unknown_field {
                UnknownField::Snapshot => {
                    provider_object.insert("unknown".to_owned(), true.into());
                }
                UnknownField::ActiveVaultScope => {
                    provider_object
                        .get_mut("activeVaultStoreId")
                        .and_then(serde_json::Value::as_object_mut)
                        .ok_or_else(|| anyhow::anyhow!("active vault scope must be an object"))?
                        .insert("unknown".to_owned(), true.into());
                }
            }
            encoded.providers = serde_json::to_string(&providers)?;
            encoded.gate.provider_digest = Sha256Hex::from_bytes(encoded.providers.as_bytes());
            assert!(matches!(
                encoded.decode(),
                Err(CompanionPairingCandidateFailure::Integrity)
            ));
        }
        Ok(())
    }

    #[test]
    fn every_interrupted_memory_write_rolls_back() -> anyhow::Result<()> {
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

    #[test]
    fn late_expiry_discards_memory_transaction() -> anyhow::Result<()> {
        let candidate = CandidateFixture::candidate()?;
        let clock = DeterministicClock::new(vec![
            ActivationFixture::epoch("160")?,
            ActivationFixture::epoch("200")?,
        ]);
        let mut store = MemoryActivationStore::default();
        assert!(matches!(
            store.commit_with_clock(PairingActivationCommit {
                candidate,
                clock: &clock,
            }),
            Err(CompanionPairingCandidateFailure::Expiry)
        ));
        assert!(store.vault.is_empty());
        Ok(())
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod browser_tests {
    use super::super::tests::{CandidateFixture, DeterministicClock};
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
        fn candidate() -> Result<PairingActivationCandidate, NookError> {
            let mut candidate = Self::expiring_candidate()?;
            candidate.approval.request.expires_at = serde_json::from_str("9007199254740991")
                .map_err(|error| NookError::Database(error.to_string()))?;
            Ok(candidate)
        }

        fn expiring_candidate() -> Result<PairingActivationCandidate, NookError> {
            CandidateFixture::candidate()
                .map_err(|failure| NookError::Database(failure.to_string()))
        }

        fn epoch(
            value: &str,
        ) -> Result<nook_companion_core::CompanionPairingEpochMilliseconds, NookError> {
            ActivationFixture::epoch(value).map_err(|error| NookError::Database(error.to_string()))
        }

        async fn commit(
            candidate: PairingActivationCandidate,
        ) -> Result<StoredPairingActivationCandidate, NookError> {
            let clock = super::super::BrowserActivationClock;
            PairingActivationStore::commit(PairingActivationCommit {
                candidate,
                clock: &clock,
            })
            .await
            .map_err(|failure| NookError::Database(failure.to_string()))
        }

        async fn load(vault_store_id: &StoreId) -> Result<PairingActivationCandidate, NookError> {
            PairingActivationStore::load(vault_store_id)
                .await
                .map_err(|failure| NookError::Database(failure.to_string()))
        }

        async fn activation_keys() -> Result<Vec<String>, NookError> {
            let connection = open_nook_database().await?;
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
            let connection = open_nook_database().await?;
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

        async fn commit_load_and_replay_remain_inert() -> Result<(), NookError> {
            indexed_db::clear_vault_db().await?;
            let authoritative_before = extension_state::load().await?;
            let candidate = CandidateFixture::candidate()
                .map_err(|failure| NookError::Database(failure.to_string()))?;
            let vault_store_id = candidate.vault_store_id.clone();
            Self::commit(candidate).await?;
            Self::load(&vault_store_id).await?;
            assert!(!Self::activation_keys().await?.is_empty());
            assert_eq!(extension_state::load().await?, authoritative_before);
            Self::authoritative_events_exclude_candidates().await?;
            assert!(Self::commit(Self::candidate()?).await.is_err());
            Ok(())
        }

        async fn concurrent_commits_have_one_winner() -> Result<(), NookError> {
            indexed_db::clear_vault_db().await?;
            let first = Self::commit(Self::candidate()?);
            let second = Self::commit(Self::candidate()?);
            let (first, second) = futures_util::join!(first, second);
            assert_ne!(first.is_ok(), second.is_ok());
            Ok(())
        }

        async fn late_expiry_aborts_payloads_and_gate() -> Result<(), NookError> {
            indexed_db::clear_vault_db().await?;
            let candidate = Self::expiring_candidate()?;
            let clock = DeterministicClock::new(vec![Self::epoch("160")?, Self::epoch("200")?]);
            assert!(matches!(
                PairingActivationStore::commit(PairingActivationCommit {
                    candidate,
                    clock: &clock,
                })
                .await,
                Err(CompanionPairingCandidateFailure::Expiry)
            ));
            assert!(Self::activation_keys().await?.is_empty());
            Self::authoritative_events_exclude_candidates().await
        }

        async fn load_rejects_missing_gate() -> Result<(), NookError> {
            indexed_db::clear_vault_db().await?;
            let store_id = StoreId::parse("store_testtoken11")?;
            assert!(Self::load(&store_id).await.is_err());
            Ok(())
        }
    }

    #[wasm_bindgen_test]
    async fn indexed_db_commit_load_and_replay_remain_inert() -> Result<(), NookError> {
        BrowserStorageFixture::commit_load_and_replay_remain_inert().await
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
    async fn indexed_db_load_rejects_missing_gate() -> Result<(), NookError> {
        BrowserStorageFixture::load_rejects_missing_gate().await
    }
}

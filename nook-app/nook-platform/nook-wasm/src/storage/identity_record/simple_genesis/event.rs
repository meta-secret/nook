#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! Sealed signer preparation and exact-marker event pinning.
use super::{
    PENDING_SIMPLE_GENESIS_KEY, PendingSimpleGenesis, PendingSimpleGenesisEvent,
    PinnedSimpleGenesisEvent,
};
use crate::StoredStringRecord;
use crate::storage::identity_record::PendingSimpleGenesisFlow;
use crate::{IdbPutStringRequest, IndexedDbUpdate, NookDatabase};
use crate::{NookError, storage::indexed_db};
use indexed_db::{StringUpdateGuard, StringUpdateResult};
use nook_core::StoredSigningSeed;
use nook_core::VaultEvent;
use nook_core::{AgeArmoredCiphertext, AppKey, MemberDekEnvelope, SigningIdentity};
use std::{cell::RefCell, rc::Rc};
pub(crate) struct SimpleGenesisEventInput<'a> {
    pub(crate) app_key: &'a AppKey,
    pub(crate) proposed_yaml: String,
    pub(crate) proposed_signing_seed: String,
}
/// Prepared ciphertext is private and consumed by the original guarded journal
/// update. The pending report itself remains cloneable and is not a capability.
///
/// ```compile_fail,E0603
/// use nook_wasm::storage::identity_record::simple_genesis::event::PreparedSimpleGenesisEvent;
/// ```
struct PreparedSimpleGenesisEvent {
    app_key: AppKey,
    expected: PendingSimpleGenesis,
    proposed_yaml: String,
    proposed_signing_seed: String,
    proposed_signing_seed_envelope: AgeArmoredCiphertext,
    proposed_member_signing_seed_envelopes: Vec<MemberDekEnvelope>,
}
struct GenesisEventSigner<'a> {
    event_yaml: &'a str,
    signing_seed: &'a str,
}
impl GenesisEventSigner<'_> {
    fn validate(self) -> Result<(), NookError> {
        let Self {
            event_yaml,
            signing_seed,
        } = self;

        let event = VaultEvent::parse_event_storage_bytes(&event_yaml.as_bytes().to_vec().into())?;
        let signing = SigningIdentity::from_seed_hex_stored(signing_seed)?;
        if event.body.actor_signing_public_key != signing.public_key() {
            return Err(NookError::Database(
                "Pinned Simple genesis event does not match the stored signing seed.".to_owned(),
            ));
        }
        Ok(())
    }
}
impl PendingSimpleGenesis {
    pub(super) fn seal_legacy_signing_seed(&mut self, app_key: &AppKey) -> Result<(), NookError> {
        let pending = self;
        let PendingSimpleGenesisEvent::LegacyUnsealedEventPinned {
            event_yaml,
            signing_seed,
        } = &pending.event_state
        else {
            return Ok(());
        };
        GenesisEventSigner {
            event_yaml,
            signing_seed,
        }
        .validate()?;
        let signing_seed_envelope = app_key
            .seal_utf8(signing_seed)
            .map_err(|error| NookError::Database(error.to_string()))?;
        pending.event_state = PendingSimpleGenesisEvent::EventPinned {
            event_yaml: event_yaml.clone(),
            signing_seed_envelope,
            member_signing_seed_envelopes: Vec::new(),
        };
        Ok(())
    }
    fn staged_signing_seed_envelopes(
        &self,
        signing_seed: &str,
    ) -> Result<Vec<MemberDekEnvelope>, NookError> {
        let pending = self;
        let PendingSimpleGenesisFlow::Staged(staged) = &pending.flow else {
            return Ok(Vec::new());
        };
        let Some(identity) = staged
            .directory
            .identities()
            .iter()
            .find(|identity| identity.identity_id == pending.identity_id)
        else {
            return Ok(Vec::new());
        };
        identity
            .members
            .iter()
            .map(|member| {
                Ok(nook_core::MemberDekEnvelope {
                    app_id: member.app_id.clone(),
                    envelope: member.public_key.seal_bytes(signing_seed.as_bytes())?,
                })
            })
            .collect::<Result<Vec<_>, nook_core::MultiDeviceError>>()
            .map_err(|error| NookError::Database(error.to_string()))
    }

    pub(crate) fn resume_signing_seed(
        &self,
        app_key: &AppKey,
    ) -> Result<nook_core::StoredSigningSeed, NookError> {
        let pending = self;
        if !pending.is_staged() {
            return Ok(StoredSigningSeed::Missing);
        }
        let PendingSimpleGenesisEvent::EventPinned {
            signing_seed_envelope,
            member_signing_seed_envelopes,
            ..
        } = &pending.event_state
        else {
            return Ok(StoredSigningSeed::Missing);
        };
        member_signing_seed_envelopes
            .iter()
            .find(|entry| entry.app_id == *app_key.app_id())
            .map_or_else(
                || app_key.open_utf8(signing_seed_envelope),
                |entry| app_key.open_utf8(&entry.envelope),
            )
            .map(StoredSigningSeed::Stored)
            .map_err(|error| NookError::Database(error.to_string()))
    }
    fn prepare_event(
        &self,
        input: SimpleGenesisEventInput<'_>,
    ) -> Result<PreparedSimpleGenesisEvent, NookError> {
        let pending = self;
        let SimpleGenesisEventInput {
            app_key,
            proposed_yaml,
            proposed_signing_seed,
        } = input;
        let proposed_signing_seed_envelope = app_key
            .seal_utf8(&proposed_signing_seed)
            .map_err(|error| NookError::Database(error.to_string()))?;
        let proposed_member_signing_seed_envelopes =
            pending.staged_signing_seed_envelopes(&proposed_signing_seed)?;
        let app_key = app_key.clone();
        let expected = pending.clone();
        Ok(PreparedSimpleGenesisEvent {
            app_key,
            expected,
            proposed_yaml,
            proposed_signing_seed,
            proposed_signing_seed_envelope,
            proposed_member_signing_seed_envelopes,
        })
    }
    pub(crate) async fn pin_event(
        &self,
        input: SimpleGenesisEventInput<'_>,
    ) -> Result<PinnedSimpleGenesisEvent, NookError> {
        self.prepare_event(input)?.persist().await
    }
}
impl PreparedSimpleGenesisEvent {
    async fn persist(self) -> Result<PinnedSimpleGenesisEvent, NookError> {
        let Self {
            app_key,
            expected,
            proposed_yaml,
            proposed_signing_seed,
            proposed_signing_seed_envelope,
            proposed_member_signing_seed_envelopes,
        } = self;
        let selected = Rc::new(RefCell::new(Err(NookError::IndexedDb(
            "Pending Simple genesis event produced no result.".to_owned(),
        ))));
        let captured = Rc::clone(&selected);
        let disposition = NookDatabase::idb_update_string(IndexedDbUpdate {
            key: PENDING_SIMPLE_GENESIS_KEY,
            guard: StringUpdateGuard::Unconditional,
            update: move |raw| {
                let raw = match raw {
                    StoredStringRecord::Stored(raw) => raw,
                    StoredStringRecord::MissingKey => {
                        return Err(NookError::IndexedDb(
                            "Pending Simple genesis marker disappeared.".to_owned(),
                        ));
                    }
                };
                let mut current = PendingSimpleGenesis::decode(&raw)?;
                if current.store_id != expected.store_id
                    || current.identity_id != expected.identity_id
                    || current.created_at != expected.created_at
                {
                    return Err(NookError::IndexedDb(
                        "Pending Simple genesis marker changed during event creation.".to_owned(),
                    ));
                }
                let pinned = match current.event_state.clone() {
                    PendingSimpleGenesisEvent::AwaitingEvent => {
                        current.event_state = PendingSimpleGenesisEvent::EventPinned {
                            event_yaml: proposed_yaml.clone(),
                            signing_seed_envelope: proposed_signing_seed_envelope.clone(),
                            member_signing_seed_envelopes: proposed_member_signing_seed_envelopes
                                .clone(),
                        };
                        PinnedSimpleGenesisEvent {
                            event_yaml: proposed_yaml.clone(),
                            signing_seed: proposed_signing_seed.clone(),
                        }
                    }
                    PendingSimpleGenesisEvent::LegacyEventPinned { event_yaml } => {
                        GenesisEventSigner {
                            event_yaml: &event_yaml,
                            signing_seed: &proposed_signing_seed,
                        }
                        .validate()?;
                        current.event_state = PendingSimpleGenesisEvent::EventPinned {
                            event_yaml: event_yaml.clone(),
                            signing_seed_envelope: proposed_signing_seed_envelope.clone(),
                            member_signing_seed_envelopes: proposed_member_signing_seed_envelopes
                                .clone(),
                        };
                        PinnedSimpleGenesisEvent {
                            event_yaml: event_yaml.clone(),
                            signing_seed: proposed_signing_seed.clone(),
                        }
                    }
                    PendingSimpleGenesisEvent::EventPinned {
                        event_yaml,
                        signing_seed_envelope,
                        member_signing_seed_envelopes,
                    } => PinnedSimpleGenesisEvent {
                        event_yaml,
                        signing_seed: member_signing_seed_envelopes
                            .iter()
                            .find(|entry| entry.app_id == *app_key.app_id())
                            .map_or_else(
                                || app_key.open_utf8(&signing_seed_envelope),
                                |entry| app_key.open_utf8(&entry.envelope),
                            )
                            .map_err(|error| NookError::Database(error.to_string()))?,
                    },
                    PendingSimpleGenesisEvent::LegacyUnsealedEventPinned { .. } => {
                        return Err(NookError::IndexedDb(
                            "Pending Simple genesis retained an unsealed signing seed.".to_owned(),
                        ));
                    }
                };
                *captured.borrow_mut() = Ok(pinned);
                current.encode()
            },
        })
        .await?;
        if disposition != StringUpdateResult::Applied {
            return Err(NookError::IndexedDb(
                "Pending Simple genesis event update was rejected.".to_owned(),
            ));
        }
        selected.replace(Err(NookError::IndexedDb(
            "Pending Simple genesis event produced no result.".to_owned(),
        )))
    }
}
#[cfg(test)]
mod tests {
    use super::{
        NookError, PENDING_SIMPLE_GENESIS_KEY, PendingSimpleGenesis, PendingSimpleGenesisEvent,
        SimpleGenesisEventInput,
    };
    use crate::storage::{identity_record, indexed_db};
    use identity_record::{OrdinarySimpleGenesisRequest, genesis_flow::PendingSimpleGenesisFlow};
    use nook_core::{
        AppKey, EventId, IdentityId, IsoTimestamp, SigningIdentity, VaultEvent,
        VaultEventSchemaVersion,
    };
    use wasm_bindgen_test::wasm_bindgen_test;
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    #[wasm_bindgen_test]
    async fn pending_genesis_reuses_first_complete_signed_event() -> Result<(), NookError> {
        NookDatabase::clear_identity_directory_for_test().await?;
        let app_key = AppKey::generate().map_err(NookDatabase::map_domain_error)?;
        let pending = OrdinarySimpleGenesisRequest {
            app_key: &app_key,
            label: "Personal",
        }
        .begin_or_resume()
        .await?;
        let first = (&pending)
            .pin_event(SimpleGenesisEventInput {
                app_key: &app_key,
                proposed_yaml: "first-event\n".to_owned(),
                proposed_signing_seed: "first-seed".to_owned(),
            })
            .await?;
        let stored = match NookDatabase::idb_get_string(PENDING_SIMPLE_GENESIS_KEY).await? {
            StoredStringRecord::Stored(value) => Ok(value),
            StoredStringRecord::MissingKey => {
                Err(NookError::IndexedDb("Marker disappeared.".to_owned()))
            }
        }?;
        assert!(!stored.contains("first-seed"));
        assert!(stored.contains("signingSeedEnvelope"));
        let resumed = (&pending)
            .pin_event(SimpleGenesisEventInput {
                app_key: &app_key,
                proposed_yaml: "other-event\n".to_owned(),
                proposed_signing_seed: "other-seed".to_owned(),
            })
            .await?;
        assert_eq!(resumed.event_yaml, first.event_yaml);
        assert_eq!(resumed.signing_seed, first.signing_seed);
        NookDatabase::clear_identity_directory_for_test().await
    }

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test callback"
    )]
    fn rejects_mismatched_plaintext_legacy_signing_seed() -> anyhow::Result<()> {
        let app_key = AppKey::generate()?;
        let (event_signing, _) = SigningIdentity::generate()?;
        let (_, mismatched_seed) = SigningIdentity::generate()?;
        let store_id = nook_core::StoreId::generate()?;
        let event = VaultEvent::sign(
            nook_core::VaultEventBody {
                schema_version: VaultEventSchemaVersion::CURRENT,
                store_id: store_id.clone(),
                actor_id: event_signing.actor_id()?,
                actor_signing_public_key: event_signing.public_key(),
                parents: Vec::new(),
                created_at: IsoTimestamp::parse("2026-08-14T00:00:00Z")?,
                key_epoch: EventId::from_sha256_hex(
                    nook_auth2::Sha256Hex::from_bytes(store_id.as_str().as_bytes()).as_str(),
                )?,
                operations: Vec::new(),
            },
            event_signing.signing_key(),
        )?;
        let event_yaml =
            String::from_utf8(VaultEvent::serialize_event_storage_yaml(&event)?.into())?;
        let mut pending = PendingSimpleGenesis {
            store_id,
            identity_id: IdentityId::generate()?,
            created_at: IsoTimestamp::parse("2026-08-14T00:00:00Z")?,
            event_state: PendingSimpleGenesisEvent::LegacyUnsealedEventPinned {
                event_yaml,
                signing_seed: mismatched_seed.as_str().to_owned(),
            },
            flow: PendingSimpleGenesisFlow::Ordinary,
        };

        PinningFixture::expect_signer_mismatch(pending.seal_legacy_signing_seed(&app_key))?;
        assert!(matches!(
            pending.event_state,
            PendingSimpleGenesisEvent::LegacyUnsealedEventPinned { .. }
        ));
        Ok(())
    }
    struct PinningFixture {
        app_key: AppKey,
        pending: PendingSimpleGenesis,
    }
    impl PinningFixture {
        fn expect_signer_mismatch(result: Result<(), NookError>) -> anyhow::Result<()> {
            match result {
                Err(NookError::Database(message))
                    if message
                        == "Pinned Simple genesis event does not match the stored signing seed." =>
                {
                    Ok(())
                }
                Err(error) => anyhow::bail!("Unexpected signer validation error: {error}"),
                Ok(()) => anyhow::bail!("Mismatched signer was accepted"),
            }
        }
        async fn new() -> Result<Self, NookError> {
            let app_key = AppKey::generate()?;
            let pending = OrdinarySimpleGenesisRequest {
                app_key: &app_key,
                label: "Pinning fixture",
            }
            .begin_or_resume()
            .await?;
            Ok(Self { app_key, pending })
        }
        fn input(&self) -> SimpleGenesisEventInput<'_> {
            SimpleGenesisEventInput {
                app_key: &self.app_key,
                proposed_yaml: "opaque-proposed-event\n".to_owned(),
                proposed_signing_seed: "fixture-signer-content".to_owned(),
            }
        }
        async fn marker(&self) -> Result<String, NookError> {
            match NookDatabase::idb_get_string(super::PENDING_SIMPLE_GENESIS_KEY).await? {
                StoredStringRecord::Stored(value) => Ok(value),
                StoredStringRecord::MissingKey => Err(NookError::IndexedDb(
                    "Pinning marker disappeared.".to_owned(),
                )),
            }
        }
    }
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    #[wasm_bindgen_test]
    async fn pinning_rejects_each_changed_marker_identity_without_overwriting()
    -> Result<(), NookError> {
        NookDatabase::clear_identity_directory_for_test().await?;
        let fixture = PinningFixture::new().await?;
        let original = fixture.marker().await?;
        let different_store = PendingSimpleGenesis {
            store_id: nook_core::StoreId::generate()?,
            ..fixture.pending.clone()
        };
        let different_identity = PendingSimpleGenesis {
            identity_id: IdentityId::generate()?,
            ..fixture.pending.clone()
        };
        let different_time = PendingSimpleGenesis {
            created_at: IsoTimestamp::parse("2000-01-01T00:00:00Z")?,
            ..fixture.pending.clone()
        };
        assert_ne!(different_store.store_id, fixture.pending.store_id);
        assert_ne!(different_identity.identity_id, fixture.pending.identity_id);
        assert_ne!(different_time.created_at, fixture.pending.created_at);
        for replacement in [different_store, different_identity, different_time] {
            NookDatabase::idb_put_string(IdbPutStringRequest {
                key: super::PENDING_SIMPLE_GENESIS_KEY,
                value: &original,
            })
            .await?;
            let prepared = fixture.pending.prepare_event(fixture.input())?;
            let replacement = replacement.encode()?;
            NookDatabase::idb_put_string(IdbPutStringRequest {
                key: super::PENDING_SIMPLE_GENESIS_KEY,
                value: &replacement,
            })
            .await?;
            assert!(
                matches!(prepared.persist().await, Err(NookError::IndexedDb(message)) if message == "Pending Simple genesis marker changed during event creation.")
            );
            assert_eq!(fixture.marker().await?, replacement);
        }
        NookDatabase::clear_identity_directory_for_test().await
    }
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    #[wasm_bindgen_test]
    async fn prepared_event_drop_preserves_marker_and_consumption_pins_once()
    -> Result<(), NookError> {
        NookDatabase::clear_identity_directory_for_test().await?;
        let fixture = PinningFixture::new().await?;
        let original = fixture.marker().await?;
        {
            let _prepared = fixture.pending.prepare_event(fixture.input())?;
        }
        assert_eq!(fixture.marker().await?, original);
        {
            let _unpolled = fixture.pending.prepare_event(fixture.input())?.persist();
        }
        assert_eq!(fixture.marker().await?, original);
        let pinned = fixture
            .pending
            .prepare_event(fixture.input())?
            .persist()
            .await?;
        assert_eq!(pinned.event_yaml, "opaque-proposed-event\n");
        assert_eq!(pinned.signing_seed, "fixture-signer-content");
        let stored = fixture.marker().await?;
        assert!(!stored.contains("fixture-signer-content"));
        let resumed = fixture
            .pending
            .prepare_event(fixture.input())?
            .persist()
            .await?;
        assert_eq!(resumed.event_yaml, pinned.event_yaml);
        assert_eq!(resumed.signing_seed, pinned.signing_seed);
        assert_eq!(fixture.marker().await?, stored);
        NookDatabase::clear_identity_directory_for_test().await
    }
}

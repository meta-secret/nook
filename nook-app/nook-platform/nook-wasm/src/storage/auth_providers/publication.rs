//! Credential snapshot admission and ordered publication to `nook_auth`.
//!
//! Preparation retains the admitted transaction. It does not create cross-database
//! atomicity, authenticate imported ciphertext, or delete/restore data on drop.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
use super::rollback_projection;
use super::{self as auth_providers, SCHEMA_KEY, STATE_KEY, STORAGE_SCHEMA_VERSION, STORE};
use crate::AuthProviderDatabase;
use crate::ProviderDbLegacySnapshotBelongsToIdentity;
use crate::ProviderDbReadRawSnapshotFromStore;
use crate::ProviderDbWriteSnapshotAt;
use crate::{IdbPutStringRequest, NookDatabase, NookError};
use nook_core::NormalizedAuthSnapshot;
use nook_core::{ActiveVaultScope, StoredGithubPat};
use nook_core::{
    AppId, AuthProvidersSnapshotData, DeviceIdentity, ProviderCredentialStorageAdmission,
};
use rexie::{Store, Transaction, TransactionMode};
use serde::Serialize;
use serde_json::Value;
use serde_wasm_bindgen::Serializer;

/// Normal publication derives encrypted credentials before observing storage.
pub(crate) struct ProviderSnapshotPublication<'a> {
    pub(crate) identity: &'a DeviceIdentity,
    pub(crate) snapshot: &'a AuthProvidersSnapshotData,
}
impl ProviderSnapshotPublication<'_> {
    pub(crate) async fn save(self) -> Result<(), NookError> {
        self.prepare().await?.persist().await
    }
    async fn prepare(self) -> Result<PreparedProviderSnapshotWrite, NookError> {
        let Self { identity, snapshot } = self;

        let sealed = snapshot.sealed_credentials_projection(identity)?;
        let state_key = AuthProviderDatabase::state_key_for_app_id(identity.app_id());
        let schema_key = AuthProviderDatabase::schema_key_for_app_id(identity.app_id());
        let refresh_legacy =
            AuthProviderDatabase::should_refresh_legacy_projection(identity.app_id()).await?;
        let rexie = AuthProviderDatabase::open_auth_db().await?;
        let transaction = rexie
            .transaction(&[STORE], TransactionMode::ReadWrite)
            .map_err(|e| {
                NookError::IndexedDb(format!("{}: {:?}", "nook_auth save transaction error", e))
            })?;
        let store = transaction.store(STORE).map_err(|e| {
            NookError::IndexedDb(format!("{}: {:?}", "nook_auth save store error", e))
        })?;
        let scoped = AuthProviderDatabase::read_raw_snapshot_from_store(
            ProviderDbReadRawSnapshotFromStore {
                store: &store,
                state_key: &state_key,
            },
        )
        .await?;
        let legacy = AuthProviderDatabase::read_raw_snapshot_from_store(
            ProviderDbReadRawSnapshotFromStore {
                store: &store,
                state_key: STATE_KEY,
            },
        )
        .await?;
        let scoped = rollback_projection::ProviderSnapshotObservation::from(scoped);
        let legacy = rollback_projection::ProviderSnapshotObservation::from(legacy);
        let legacy_belongs_to_identity = AuthProviderDatabase::legacy_snapshot_belongs_to_identity(
            ProviderDbLegacySnapshotBelongsToIdentity {
                identity: identity,
                scoped: &scoped,
                legacy: &legacy,
            },
        );
        if refresh_legacy
            && matches!(
                legacy,
                rollback_projection::ProviderSnapshotObservation::Present(_)
            )
            && legacy_belongs_to_identity == rollback_projection::LegacyProjectionOwnership::Foreign
        {
            return Err(NookError::Database(
                "Legacy auth providers belong to another identity; both records were preserved"
                    .to_owned(),
            ));
        }
        let refresh_legacy = refresh_legacy
            || legacy_belongs_to_identity == rollback_projection::LegacyProjectionOwnership::Owned;
        Ok(PreparedProviderSnapshotWrite {
            database: rexie,
            transaction,
            store,
            state_key,
            schema_key,
            snapshot: sealed,
            legacy: if refresh_legacy {
                LegacyProjectionWrite::Refresh
            } else {
                LegacyProjectionWrite::Preserve
            },
            completion: PublicationCompletion::Normal,
        })
    }
}
/// Locked import binds an explicit recipient without requiring its private key.
pub(crate) struct PresealedProviderSnapshotPublication<'a> {
    pub(crate) app_id: &'a AppId,
    pub(crate) snapshot: &'a AuthProvidersSnapshotData,
}
impl PresealedProviderSnapshotPublication<'_> {
    pub(crate) async fn save(self) -> Result<(), NookError> {
        self.prepare().await?.persist().await
    }
    async fn prepare(self) -> Result<PreparedProviderSnapshotWrite, NookError> {
        let Self { app_id, snapshot } = self;

        if snapshot.credential_storage_admission()
            != ProviderCredentialStorageAdmission::MarkerCompatible
        {
            return Err(NookError::Decryption(
                "Presealed auth-provider save rejected plaintext credentials.".to_owned(),
            ));
        }
        let state_key = AuthProviderDatabase::state_key_for_app_id(app_id);
        let schema_key = AuthProviderDatabase::schema_key_for_app_id(app_id);
        let migrate_legacy = AuthProviderDatabase::may_migrate_legacy_snapshot(app_id).await?;
        let rexie = AuthProviderDatabase::open_auth_db().await?;
        let transaction = rexie
            .transaction(&[STORE], TransactionMode::ReadWrite)
            .map_err(|e| {
                NookError::IndexedDb(format!(
                    "{}: {:?}",
                    "nook_auth presealed transaction error", e
                ))
            })?;
        let store = transaction.store(STORE).map_err(|e| {
            NookError::IndexedDb(format!("{}: {:?}", "nook_auth presealed store error", e))
        })?;
        let scoped = AuthProviderDatabase::read_raw_snapshot_from_store(
            ProviderDbReadRawSnapshotFromStore {
                store: &store,
                state_key: &state_key,
            },
        )
        .await?;
        let legacy = if scoped.is_null() && migrate_legacy {
            AuthProviderDatabase::read_raw_snapshot_from_store(ProviderDbReadRawSnapshotFromStore {
                store: &store,
                state_key: STATE_KEY,
            })
            .await?
        } else {
            Value::Null
        };
        let (raw, legacy_write) = match legacy {
            Value::Null => (scoped, LegacyProjectionWrite::Preserve),
            legacy => (legacy, LegacyProjectionWrite::Refresh),
        };
        let existing = NormalizedAuthSnapshot::from(raw).snapshot;
        if existing.credential_storage_admission()
            != ProviderCredentialStorageAdmission::MarkerCompatible
        {
            return Err(NookError::Decryption(
                "auth-provider-credential-must-be-encrypted".to_owned(),
            ));
        }
        let merged = existing.replace_active_vault_grants(snapshot);
        Ok(PreparedProviderSnapshotWrite {
            database: rexie,
            transaction,
            store,
            state_key,
            schema_key,
            snapshot: merged,
            legacy: legacy_write,
            completion: PublicationCompletion::Presealed,
        })
    }
}
enum LegacyProjectionWrite {
    Preserve,
    Refresh,
}
enum PublicationCompletion {
    Normal,
    Presealed,
}
impl PublicationCompletion {
    fn context(&self) -> &'static str {
        match self {
            Self::Normal => "nook_auth save completion error",
            Self::Presealed => "nook_auth presealed completion error",
        }
    }
}
/// Owns the exact admitted transaction and snapshot; only persistence consumes it.
///
/// No caller can manufacture or retain a reusable admitted transaction.
/// ```compile_fail,E0603
/// use nook_wasm::storage::auth_providers::publication::PreparedProviderSnapshotWrite;
/// ```
struct PreparedProviderSnapshotWrite {
    database: AuthProviderDatabase,
    transaction: Transaction,
    store: Store,
    state_key: String,
    schema_key: String,
    snapshot: AuthProvidersSnapshotData,
    legacy: LegacyProjectionWrite,
    completion: PublicationCompletion,
}
impl PreparedProviderSnapshotWrite {
    async fn persist(self) -> Result<(), NookError> {
        let Self {
            database,
            transaction,
            store,
            state_key,
            schema_key,
            snapshot,
            legacy,
            completion,
        } = self;
        ProviderSnapshotStore {
            store: &store,
            state_key: &state_key,
            schema_key: &schema_key,
        }
        .write(&snapshot)
        .await?;
        if let LegacyProjectionWrite::Refresh = legacy {
            ProviderSnapshotStore {
                store: &store,
                state_key: STATE_KEY,
                schema_key: SCHEMA_KEY,
            }
            .write(&snapshot)
            .await?;
        }
        let result = transaction
            .done()
            .await
            .map_err(|e| NookError::IndexedDb(format!("{}: {:?}", completion.context(), e)))
            .map(|_| ());
        drop(database);
        result
    }
}
/// The schema-1 writer also serves the existing rollback migration transaction.
pub(super) struct ProviderSnapshotStore<'a> {
    pub(super) store: &'a Store,
    pub(super) state_key: &'a str,
    pub(super) schema_key: &'a str,
}
impl ProviderSnapshotStore<'_> {
    pub(super) async fn write(self, snapshot: &AuthProvidersSnapshotData) -> Result<(), NookError> {
        let Self {
            store,
            state_key,
            schema_key,
        } = self;

        let key = serde_wasm_bindgen::to_value(state_key)
            .map_err(|e| NookError::IndexedDb(format!("{}: {:?}", "nook_auth key error", e)))?;
        let storage_value = snapshot.legacy_storage_snapshot();
        let value = storage_value
            .serialize(&Serializer::json_compatible())
            .map_err(|e| {
                NookError::IndexedDb(format!("{}: {:?}", "nook_auth serialize error", e))
            })?;
        store
            .put(&value, Some(&key))
            .await
            .map_err(|e| NookError::IndexedDb(format!("{}: {:?}", "nook_auth put error", e)))?;
        let schema_key = serde_wasm_bindgen::to_value(schema_key)
            .map_err(|e| NookError::IndexedDb(format!("{}: {:?}", "schema key error", e)))?;
        let schema_value = serde_wasm_bindgen::to_value(&STORAGE_SCHEMA_VERSION)
            .map_err(|e| NookError::IndexedDb(format!("{}: {:?}", "schema version error", e)))?;
        store
            .put(&schema_value, Some(&schema_key))
            .await
            .map_err(|e| {
                NookError::IndexedDb(format!("{}: {:?}", "schema version put error", e))
            })?;
        Ok(())
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod tests {
    use super::{
        PresealedProviderSnapshotPublication, ProviderSnapshotPublication, auth_providers,
    };
    use crate::NookError;
    use crate::storage::{identity_record, indexed_db};
    use nook_core::ProviderVaultScope;
    use nook_core::StoredGithubPat;
    use nook_core::{
        AGE_ARMOR_MARKER, ActiveVaultScope, AuthProvidersSnapshotData, DeviceIdentity,
        NormalizedAuthSnapshot, ProviderCredentialStorageAdmission, StorageProviderData,
    };
    use serde_json::Value;
    use wasm_bindgen_test::{wasm_bindgen_test, wasm_bindgen_test_configure};

    wasm_bindgen_test_configure!(run_in_browser);

    struct GithubSnapshotFixture<'a> {
        id: &'a str,
        pat: &'a str,
    }
    impl GithubSnapshotFixture<'_> {
        fn snapshot(self) -> AuthProvidersSnapshotData {
            AuthProvidersSnapshotData {
                providers: vec![StorageProviderData::github(
                    self.id,
                    "GitHub",
                    self.pat,
                    "nook",
                    "2026-06-24T00:00:00.000Z",
                )],
                active_vault_store_id: ActiveVaultScope::Unselected,
            }
        }
    }

    struct PublicationFixture {
        identity: DeviceIdentity,
        snapshot: AuthProvidersSnapshotData,
    }
    impl PublicationFixture {
        async fn clear_legacy() -> anyhow::Result<()> {
            AuthProviderDatabase::write_snapshot(&AuthProvidersSnapshotData {
                providers: Vec::new(),
                active_vault_store_id: ActiveVaultScope::Unselected,
            })
            .await?;
            Ok(())
        }

        async fn new(credential: &str) -> anyhow::Result<Self> {
            AuthProviderDatabase::clear_auth_providers_db().await?;
            NookDatabase::clear_keyring_for_test().await?;
            NookDatabase::clear_identity_directory_for_test().await?;
            Ok(Self {
                identity: DeviceIdentity::generate()?,
                snapshot: AuthProvidersSnapshotData {
                    providers: vec![StorageProviderData::github(
                        "publication",
                        "GitHub",
                        credential,
                        "nook",
                        "2026-06-24T00:00:00.000Z",
                    )],
                    active_vault_store_id: ActiveVaultScope::Unselected,
                },
            })
        }
        fn publication(&self) -> ProviderSnapshotPublication<'_> {
            ProviderSnapshotPublication {
                identity: &self.identity,
                snapshot: &self.snapshot,
            }
        }
        fn import(&self) -> PresealedProviderSnapshotPublication<'_> {
            PresealedProviderSnapshotPublication {
                app_id: self.identity.app_id(),
                snapshot: &self.snapshot,
            }
        }
        async fn scoped(&self) -> Result<Value, NookError> {
            AuthProviderDatabase::read_raw_snapshot_at(&AuthProviderDatabase::state_key_for_app_id(
                self.identity.app_id(),
            ))
            .await
        }
        async fn assert_absent(&self) -> anyhow::Result<()> {
            assert!(self.scoped().await?.is_null());
            assert!(
                AuthProviderDatabase::read_raw_snapshot_at(
                    &AuthProviderDatabase::schema_key_for_app_id(self.identity.app_id())
                )
                .await?
                .is_null()
            );
            assert!(
                AuthProviderDatabase::read_raw_snapshot_at(auth_providers::STATE_KEY)
                    .await?
                    .is_null()
            );
            assert!(
                AuthProviderDatabase::read_raw_snapshot_at(auth_providers::SCHEMA_KEY)
                    .await?
                    .is_null()
            );
            Ok(())
        }
        fn expect_plaintext_rejection(result: Result<(), NookError>) -> anyhow::Result<()> {
            match result {
                Err(NookError::Decryption(message)) => {
                    assert_eq!(
                        message,
                        "Presealed auth-provider save rejected plaintext credentials."
                    );
                    Ok(())
                }
                Err(error) => Err(error.into()),
                Ok(()) => anyhow::bail!("plaintext import unexpectedly succeeded"),
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
    async fn dropping_normal_preparation_publishes_no_rows() -> anyhow::Result<()> {
        let fixture = PublicationFixture::new("github_pat_prepare_only").await?;
        let original = fixture.snapshot.clone();
        let prepared = fixture.publication().prepare().await?;
        assert_eq!(
            prepared.snapshot.credential_storage_admission(),
            ProviderCredentialStorageAdmission::MarkerCompatible
        );
        assert_ne!(prepared.snapshot, original);
        assert_eq!(
            prepared.state_key,
            AuthProviderDatabase::state_key_for_app_id(fixture.identity.app_id())
        );
        // Release the admitted transaction before observing through a new one.
        drop(prepared);
        assert_eq!(fixture.snapshot, original);
        fixture.assert_absent().await?;
        Ok(())
    }

    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    #[wasm_bindgen_test]
    async fn dropping_presealed_preparation_publishes_no_rows() -> anyhow::Result<()> {
        let mut fixture = PublicationFixture::new("github_pat_import_prepare_only").await?;
        fixture.snapshot = fixture
            .snapshot
            .seal_credentials_for(&fixture.identity.public_key())
            .map_err(|rejection| rejection.into_cause())?;
        let original = fixture.snapshot.clone();
        let prepared = fixture.import().prepare().await?;
        assert_eq!(prepared.snapshot, original);
        drop(prepared);
        assert_eq!(fixture.snapshot, original);
        fixture.assert_absent().await?;
        Ok(())
    }

    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    #[wasm_bindgen_test]
    async fn consumed_preparation_persists_the_admitted_ciphertext() -> anyhow::Result<()> {
        let fixture = PublicationFixture::new("github_pat_prepared_publication").await?;
        let prepared = fixture.publication().prepare().await?;
        let admitted = prepared.snapshot.clone();
        prepared.persist().await?;
        let raw = fixture.scoped().await?;
        let stored = NormalizedAuthSnapshot::from(raw).snapshot;
        assert_eq!(stored, admitted);
        let loaded = AuthProviderDatabase::load_auth_providers(&fixture.identity).await?;
        assert_eq!(loaded.snapshot, fixture.snapshot);
        Ok(())
    }

    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    #[wasm_bindgen_test]
    async fn marker_only_import_stays_unverified_and_failed_load_preserves_bytes()
    -> anyhow::Result<()> {
        let fixture = PublicationFixture::new(AGE_ARMOR_MARKER).await?;
        fixture.import().save().await?;
        let before = fixture.scoped().await?;
        assert_eq!(
            NormalizedAuthSnapshot::from(before.clone()).snapshot,
            fixture.snapshot
        );
        assert!(
            AuthProviderDatabase::load_auth_providers(&fixture.identity)
                .await
                .is_err()
        );
        assert_eq!(fixture.scoped().await?, before);
        Ok(())
    }

    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    #[wasm_bindgen_test]
    async fn rejected_plaintext_import_preserves_the_existing_snapshot() -> anyhow::Result<()> {
        let fixture = PublicationFixture::new("github_pat_original").await?;
        fixture.publication().save().await?;
        let before = fixture.scoped().await?;
        PublicationFixture::expect_plaintext_rejection(fixture.import().save().await)?;
        assert_eq!(fixture.scoped().await?, before);
        assert_eq!(
            AuthProviderDatabase::load_auth_providers(&fixture.identity)
                .await?
                .snapshot,
            fixture.snapshot
        );
        Ok(())
    }

    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    #[wasm_bindgen_test]
    async fn preparation_failure_preserves_caller_and_existing_rows() -> anyhow::Result<()> {
        let fixture = PublicationFixture::new("github_pat_preserved_on_keyring_failure").await?;
        fixture.publication().save().await?;
        let before = fixture.scoped().await?;
        let caller = fixture.snapshot.clone();
        NookDatabase::idb_put_string(IdbPutStringRequest {
            key: identity_record::LOCAL_IDENTITY_KEYRING_KEY,
            value: "corrupt-keyring",
        })
        .await?;
        assert!(fixture.publication().prepare().await.is_err());
        // Plaintext import is rejected before the same corrupt keyring is read.
        PublicationFixture::expect_plaintext_rejection(fixture.import().save().await)?;
        assert_eq!(fixture.snapshot, caller);
        assert_eq!(fixture.scoped().await?, before);
        NookDatabase::clear_keyring_for_test().await?;
        assert_eq!(
            AuthProviderDatabase::load_auth_providers(&fixture.identity)
                .await?
                .snapshot,
            caller
        );
        Ok(())
    }

    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    #[wasm_bindgen_test]
    async fn presealed_snapshot_uses_explicit_recipient_app_id() -> anyhow::Result<()> {
        let first = DeviceIdentity::generate()?;
        let second = DeviceIdentity::generate()?;
        let mut first_existing = GithubSnapshotFixture {
            id: "gh-wasm",
            pat: "github_pat_first_old",
        }
        .snapshot();
        let mut second_existing = GithubSnapshotFixture {
            id: "gh-wasm",
            pat: "github_pat_second",
        }
        .snapshot();
        first_existing = first_existing
            .seal_credentials(&first)
            .map_err(|rejection| rejection.into_cause())?;
        second_existing = second_existing
            .seal_credentials(&second)
            .map_err(|rejection| rejection.into_cause())?;
        AuthProviderDatabase::write_snapshot_at(ProviderDbWriteSnapshotAt {
            state_key: &AuthProviderDatabase::state_key_for_app_id(first.app_id()),
            schema_key: &AuthProviderDatabase::schema_key_for_app_id(first.app_id()),
            snapshot: &first_existing,
        })
        .await?;
        AuthProviderDatabase::write_snapshot_at(ProviderDbWriteSnapshotAt {
            state_key: &AuthProviderDatabase::state_key_for_app_id(second.app_id()),
            schema_key: &AuthProviderDatabase::schema_key_for_app_id(second.app_id()),
            snapshot: &second_existing,
        })
        .await?;
        let mut incoming = GithubSnapshotFixture {
            id: "gh-wasm",
            pat: "github_pat_first_new",
        }
        .snapshot();
        incoming = incoming
            .seal_credentials(&first)
            .map_err(|rejection| rejection.into_cause())?;

        PresealedProviderSnapshotPublication {
            app_id: first.app_id(),
            snapshot: &incoming,
        }
        .save()
        .await?;

        let first_loaded = AuthProviderDatabase::load_auth_providers(&first).await?;
        let second_loaded = AuthProviderDatabase::load_auth_providers(&second).await?;
        assert_eq!(
            first_loaded.snapshot.providers[0].github_pat,
            StoredGithubPat::Token(("github_pat_first_new").to_owned())
        );
        assert_eq!(
            second_loaded.snapshot.providers[0].github_pat,
            StoredGithubPat::Token(("github_pat_second").to_owned())
        );
        Ok(())
    }

    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    #[wasm_bindgen_test]
    async fn presealed_save_replaces_active_vault_and_preserves_other_vaults() -> anyhow::Result<()>
    {
        PublicationFixture::clear_legacy().await?;
        let identity = DeviceIdentity::generate()?;
        let mut existing = GithubSnapshotFixture {
            id: "gh-removed",
            pat: "github_pat_existing",
        }
        .snapshot();
        existing.providers[0].store_id = ProviderVaultScope::StoreId("store-incoming".to_owned());
        let mut retained = GithubSnapshotFixture {
            id: "gh-retained",
            pat: "github_pat_retained",
        }
        .snapshot()
        .providers
        .remove(0);
        retained.store_id = ProviderVaultScope::StoreId("store-other".to_owned());
        existing.providers.push(retained);
        existing.active_vault_store_id = ActiveVaultScope::StoreId("store-incoming".to_owned());
        existing = existing
            .seal_credentials(&identity)
            .map_err(|rejection| rejection.into_cause())?;
        AuthProviderDatabase::write_snapshot_at(ProviderDbWriteSnapshotAt {
            state_key: &AuthProviderDatabase::state_key_for_app_id(identity.app_id()),
            schema_key: &AuthProviderDatabase::schema_key_for_app_id(identity.app_id()),
            snapshot: &existing,
        })
        .await?;

        let mut incoming = GithubSnapshotFixture {
            id: "gh-incoming",
            pat: "github_pat_incoming",
        }
        .snapshot();
        incoming.active_vault_store_id = ActiveVaultScope::StoreId("store-incoming".to_owned());
        incoming = incoming
            .seal_credentials(&identity)
            .map_err(|rejection| rejection.into_cause())?;
        PresealedProviderSnapshotPublication {
            app_id: identity.app_id(),
            snapshot: &incoming,
        }
        .save()
        .await?;

        let raw = AuthProviderDatabase::read_raw_snapshot_at(
            &AuthProviderDatabase::state_key_for_app_id(identity.app_id()),
        )
        .await?;
        let stored = NormalizedAuthSnapshot::from(raw).snapshot;
        let mut provider_ids = stored
            .providers
            .iter()
            .map(|provider| provider.id.as_str())
            .collect::<Vec<_>>();
        provider_ids.sort_unstable();
        assert_eq!(provider_ids, vec!["gh-incoming", "gh-retained"]);
        assert_eq!(
            stored.active_vault_store_id,
            ActiveVaultScope::StoreId(("store-incoming").to_owned())
        );
        assert_eq!(
            stored.credential_storage_admission(),
            ProviderCredentialStorageAdmission::MarkerCompatible
        );
        Ok(())
    }

    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    #[wasm_bindgen_test]
    async fn presealed_save_rejects_existing_plaintext_provider_rows() -> anyhow::Result<()> {
        PublicationFixture::clear_legacy().await?;
        let identity = DeviceIdentity::generate()?;
        AuthProviderDatabase::write_snapshot_at(ProviderDbWriteSnapshotAt {
            state_key: &AuthProviderDatabase::state_key_for_app_id(identity.app_id()),
            schema_key: &AuthProviderDatabase::schema_key_for_app_id(identity.app_id()),
            snapshot: &GithubSnapshotFixture {
                id: "gh-plaintext",
                pat: "github_pat_plaintext",
            }
            .snapshot(),
        })
        .await?;
        let mut incoming = GithubSnapshotFixture {
            id: "gh-incoming",
            pat: "github_pat_incoming",
        }
        .snapshot();
        incoming = incoming
            .seal_credentials(&identity)
            .map_err(|rejection| rejection.into_cause())?;
        let result = PresealedProviderSnapshotPublication {
            app_id: identity.app_id(),
            snapshot: &incoming,
        }
        .save()
        .await;
        assert!(matches!(
            result,
            Err(NookError::Decryption(message))
                if message == "auth-provider-credential-must-be-encrypted"
        ));

        let raw = AuthProviderDatabase::read_raw_snapshot_at(
            &AuthProviderDatabase::state_key_for_app_id(identity.app_id()),
        )
        .await?;
        assert_eq!(
            NormalizedAuthSnapshot::from(raw).snapshot.providers[0].github_pat,
            StoredGithubPat::Token("github_pat_plaintext".to_owned())
        );
        Ok(())
    }

    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    #[wasm_bindgen_test]
    async fn presealed_empty_save_clears_only_the_incoming_vault() -> anyhow::Result<()> {
        PublicationFixture::clear_legacy().await?;
        let identity = DeviceIdentity::generate()?;
        let mut existing = GithubSnapshotFixture {
            id: "gh-removed",
            pat: "github_pat_removed",
        }
        .snapshot();
        existing.providers[0].store_id = ProviderVaultScope::StoreId("store-incoming".to_owned());
        let mut retained = GithubSnapshotFixture {
            id: "gh-retained",
            pat: "github_pat_retained",
        }
        .snapshot()
        .providers
        .remove(0);
        retained.store_id = ProviderVaultScope::StoreId("store-other".to_owned());
        existing.providers.push(retained);
        existing.active_vault_store_id = ActiveVaultScope::StoreId("store-incoming".to_owned());
        existing = existing
            .seal_credentials(&identity)
            .map_err(|rejection| rejection.into_cause())?;
        AuthProviderDatabase::write_snapshot_at(ProviderDbWriteSnapshotAt {
            state_key: &AuthProviderDatabase::state_key_for_app_id(identity.app_id()),
            schema_key: &AuthProviderDatabase::schema_key_for_app_id(identity.app_id()),
            snapshot: &existing,
        })
        .await?;

        PresealedProviderSnapshotPublication {
            app_id: identity.app_id(),
            snapshot: &AuthProvidersSnapshotData {
                providers: Vec::new(),
                active_vault_store_id: ActiveVaultScope::StoreId("store-incoming".to_owned()),
            },
        }
        .save()
        .await?;

        let raw = AuthProviderDatabase::read_raw_snapshot_at(
            &AuthProviderDatabase::state_key_for_app_id(identity.app_id()),
        )
        .await?;
        let stored = NormalizedAuthSnapshot::from(raw).snapshot;
        assert_eq!(stored.providers.len(), 1);
        assert_eq!(stored.providers[0].id, "gh-retained");
        assert_eq!(
            stored.active_vault_store_id,
            ActiveVaultScope::StoreId(("store-incoming").to_owned())
        );
        Ok(())
    }
}

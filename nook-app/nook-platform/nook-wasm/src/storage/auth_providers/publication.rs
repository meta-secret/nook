//! Credential snapshot admission and ordered publication to `nook_auth`.
//!
//! Preparation retains the admitted transaction. It does not create cross-database
//! atomicity, authenticate imported ciphertext, or delete/restore data on drop.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
use super::STORE;
use crate::AuthProviderDatabase;
use crate::NookError;
use crate::ProviderDbReadRawSnapshotFromStore;
use nook_core::{
    AppId, AuthProvidersSnapshotData, DeviceIdentity, ProviderCredentialStorageAdmission,
};
use rexie::{Store, Transaction, TransactionMode};
use serde::Serialize;
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
        let rexie = AuthProviderDatabase::open_auth_db().await?;
        let transaction = rexie
            .transaction(&[STORE], TransactionMode::ReadWrite)
            .map_err(|e| {
                NookError::IndexedDb(format!("{}: {:?}", "nook_auth save transaction error", e))
            })?;
        let store = transaction.store(STORE).map_err(|e| {
            NookError::IndexedDb(format!("{}: {:?}", "nook_auth save store error", e))
        })?;
        Ok(PreparedProviderSnapshotWrite {
            database: rexie,
            transaction,
            store,
            state_key,
            snapshot: sealed,
            completion: PublicationCompletion::Normal,
        })
    }
}
/// How presealed rows join the rows the recipient already holds.
pub(crate) enum PresealedProviderMerge {
    /// A pairing grant replaces the rows of the vault it is for.
    VaultGrants,
    /// Another app of the keyring hands over every remote provider.
    KeyringProviders,
}

/// Locked import binds an explicit recipient without requiring its private key.
pub(crate) struct PresealedProviderSnapshotPublication<'a> {
    pub(crate) app_id: &'a AppId,
    pub(crate) snapshot: &'a AuthProvidersSnapshotData,
    pub(crate) merge: PresealedProviderMerge,
}
impl PresealedProviderSnapshotPublication<'_> {
    pub(crate) async fn save(self) -> Result<(), NookError> {
        self.prepare().await?.persist().await
    }
    async fn prepare(self) -> Result<PreparedProviderSnapshotWrite, NookError> {
        let Self {
            app_id,
            snapshot,
            merge,
        } = self;

        if snapshot.credential_storage_admission()
            != ProviderCredentialStorageAdmission::MarkerCompatible
        {
            return Err(NookError::Decryption(
                "Presealed auth-provider save rejected plaintext credentials.".to_owned(),
            ));
        }
        let state_key = AuthProviderDatabase::state_key_for_app_id(app_id);
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
        let raw = AuthProviderDatabase::read_raw_snapshot_from_store(
            ProviderDbReadRawSnapshotFromStore {
                store: &store,
                state_key: &state_key,
            },
        )
        .await?;
        let existing = AuthProviderDatabase::decode_stored_snapshot(raw)?;
        if existing.credential_storage_admission()
            != ProviderCredentialStorageAdmission::MarkerCompatible
        {
            return Err(NookError::Decryption(
                "auth-provider-credential-must-be-encrypted".to_owned(),
            ));
        }
        let merged = match merge {
            PresealedProviderMerge::VaultGrants => existing.replace_active_vault_grants(snapshot),
            PresealedProviderMerge::KeyringProviders => {
                existing.replace_keyring_providers(&snapshot.providers)
            }
        };
        Ok(PreparedProviderSnapshotWrite {
            database: rexie,
            transaction,
            store,
            state_key,
            snapshot: merged,
            completion: PublicationCompletion::Presealed,
        })
    }
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
    snapshot: AuthProvidersSnapshotData,
    completion: PublicationCompletion,
}
impl PreparedProviderSnapshotWrite {
    async fn persist(self) -> Result<(), NookError> {
        let Self {
            database,
            transaction,
            store,
            state_key,
            snapshot,
            completion,
        } = self;
        ProviderSnapshotStore {
            store: &store,
            state_key: &state_key,
        }
        .write(&snapshot)
        .await?;
        let result = transaction
            .done()
            .await
            .map_err(|e| NookError::IndexedDb(format!("{}: {:?}", completion.context(), e)))
            .map(|_| ());
        drop(database);
        result
    }
}
/// Writes one app key's provider snapshot.
pub(super) struct ProviderSnapshotStore<'a> {
    pub(super) store: &'a Store,
    pub(super) state_key: &'a str,
}
impl ProviderSnapshotStore<'_> {
    pub(super) async fn write(self, snapshot: &AuthProvidersSnapshotData) -> Result<(), NookError> {
        let Self { store, state_key } = self;
        let key = serde_wasm_bindgen::to_value(state_key)
            .map_err(|e| NookError::IndexedDb(format!("{}: {:?}", "nook_auth key error", e)))?;
        let value = snapshot
            .serialize(&Serializer::json_compatible())
            .map_err(|e| {
                NookError::IndexedDb(format!("{}: {:?}", "nook_auth serialize error", e))
            })?;
        store
            .put(&value, Some(&key))
            .await
            .map_err(|e| NookError::IndexedDb(format!("{}: {:?}", "nook_auth put error", e)))?;
        Ok(())
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod tests {
    use super::{
        PresealedProviderMerge, PresealedProviderSnapshotPublication, ProviderSnapshotPublication,
    };
    use crate::{AuthProviderDatabase, NookDatabase, NookError, ProviderDbWriteSnapshotAt};
    use nook_core::ProviderVaultScope;
    use nook_core::StoredGithubPat;
    use nook_core::{
        AGE_ARMOR_MARKER, ActiveVaultScope, AuthProvidersSnapshotData, DeviceIdentity,
        ProviderCredentialStorageAdmission, StorageProviderData, StorageProviderType,
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
                merge: PresealedProviderMerge::VaultGrants,
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
        let stored = AuthProviderDatabase::decode_stored_snapshot(raw)?;
        assert_eq!(stored, admitted);
        let loaded = AuthProviderDatabase::load_auth_providers(&fixture.identity).await?;
        assert_eq!(loaded, fixture.snapshot);
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
            AuthProviderDatabase::decode_stored_snapshot(before.clone())?,
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
            AuthProviderDatabase::load_auth_providers(&fixture.identity).await?,
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
    async fn rejected_import_preserves_caller_and_existing_rows() -> anyhow::Result<()> {
        let fixture = PublicationFixture::new("github_pat_preserved_on_rejected_import").await?;
        fixture.publication().save().await?;
        let before = fixture.scoped().await?;
        let caller = fixture.snapshot.clone();
        PublicationFixture::expect_plaintext_rejection(fixture.import().save().await)?;
        assert_eq!(fixture.snapshot, caller);
        assert_eq!(fixture.scoped().await?, before);
        assert_eq!(
            AuthProviderDatabase::load_auth_providers(&fixture.identity).await?,
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
            snapshot: &first_existing,
        })
        .await?;
        AuthProviderDatabase::write_snapshot_at(ProviderDbWriteSnapshotAt {
            state_key: &AuthProviderDatabase::state_key_for_app_id(second.app_id()),
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
            merge: PresealedProviderMerge::VaultGrants,
        }
        .save()
        .await?;

        let first_loaded = AuthProviderDatabase::load_auth_providers(&first).await?;
        let second_loaded = AuthProviderDatabase::load_auth_providers(&second).await?;
        assert_eq!(
            first_loaded.providers[0].github_pat,
            StoredGithubPat::Token(("github_pat_first_new").to_owned())
        );
        assert_eq!(
            second_loaded.providers[0].github_pat,
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
    async fn presealed_save_replaces_the_vaults_local_row_and_keeps_mounts() -> anyhow::Result<()> {
        AuthProviderDatabase::clear_auth_providers_db().await?;
        let identity = DeviceIdentity::generate()?;
        let existing = VaultRowsFixture::existing().snapshot(&identity)?;
        AuthProviderDatabase::write_snapshot_at(ProviderDbWriteSnapshotAt {
            state_key: &AuthProviderDatabase::state_key_for_app_id(identity.app_id()),
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
            merge: PresealedProviderMerge::VaultGrants,
        }
        .save()
        .await?;

        let stored = VaultRowsFixture::stored(&identity).await?;
        assert_eq!(
            VaultRowsFixture::ids(&stored),
            vec!["gh-incoming", "gh-mount", "local-retained"]
        );
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
        AuthProviderDatabase::clear_auth_providers_db().await?;
        let identity = DeviceIdentity::generate()?;
        AuthProviderDatabase::write_snapshot_at(ProviderDbWriteSnapshotAt {
            state_key: &AuthProviderDatabase::state_key_for_app_id(identity.app_id()),
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
            merge: PresealedProviderMerge::VaultGrants,
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
            AuthProviderDatabase::decode_stored_snapshot(raw)?.providers[0].github_pat,
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
    async fn presealed_empty_save_clears_only_the_incoming_vaults_local_row() -> anyhow::Result<()>
    {
        AuthProviderDatabase::clear_auth_providers_db().await?;
        let identity = DeviceIdentity::generate()?;
        let existing = VaultRowsFixture::existing().snapshot(&identity)?;
        AuthProviderDatabase::write_snapshot_at(ProviderDbWriteSnapshotAt {
            state_key: &AuthProviderDatabase::state_key_for_app_id(identity.app_id()),
            snapshot: &existing,
        })
        .await?;

        PresealedProviderSnapshotPublication {
            app_id: identity.app_id(),
            snapshot: &AuthProvidersSnapshotData {
                providers: Vec::new(),
                active_vault_store_id: ActiveVaultScope::StoreId("store-incoming".to_owned()),
            },
            merge: PresealedProviderMerge::VaultGrants,
        }
        .save()
        .await?;

        let stored = VaultRowsFixture::stored(&identity).await?;
        assert_eq!(
            VaultRowsFixture::ids(&stored),
            vec!["gh-mount", "local-retained"]
        );
        assert_eq!(
            stored.active_vault_store_id,
            ActiveVaultScope::StoreId(("store-incoming").to_owned())
        );
        Ok(())
    }

    /// Browser rows of two vaults and one identity mount.
    struct VaultRowsFixture {
        providers: Vec<StorageProviderData>,
    }
    impl VaultRowsFixture {
        fn local(id: &str, store_id: &str) -> StorageProviderData {
            let mut row = StorageProviderData::github(id, "This browser", "", "", "now");
            row.provider_type = StorageProviderType::Local;
            row.github_pat = StoredGithubPat::Missing;
            row.store_id = ProviderVaultScope::StoreId(store_id.to_owned());
            row
        }

        fn existing() -> Self {
            Self {
                providers: vec![
                    Self::local("local-removed", "store-incoming"),
                    Self::local("local-retained", "store-other"),
                    StorageProviderData::github(
                        "gh-mount",
                        "GitHub",
                        "github_pat_mount",
                        "nook",
                        "now",
                    ),
                ],
            }
        }

        fn snapshot(self, identity: &DeviceIdentity) -> anyhow::Result<AuthProvidersSnapshotData> {
            AuthProvidersSnapshotData {
                providers: self.providers,
                active_vault_store_id: ActiveVaultScope::StoreId("store-incoming".to_owned()),
            }
            .seal_credentials(identity)
            .map_err(|rejection| rejection.into_cause().into())
        }

        async fn stored(identity: &DeviceIdentity) -> anyhow::Result<AuthProvidersSnapshotData> {
            let raw = AuthProviderDatabase::read_raw_snapshot_at(
                &AuthProviderDatabase::state_key_for_app_id(identity.app_id()),
            )
            .await?;
            Ok(AuthProviderDatabase::decode_stored_snapshot(raw)?)
        }

        fn ids(snapshot: &AuthProvidersSnapshotData) -> Vec<&str> {
            let mut ids = snapshot
                .providers
                .iter()
                .map(|provider| provider.id.as_str())
                .collect::<Vec<_>>();
            ids.sort_unstable();
            ids
        }
    }
}

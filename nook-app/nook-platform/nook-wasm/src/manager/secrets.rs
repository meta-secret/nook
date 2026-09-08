//! Secret CRUD + small utility methods (search, password / id generation,
//! status-channel poll).

use super::NookVaultManager;
use crate::NookError;
use crate::{NookSecretPage, NookSecretRecord, NookSecretTypeFilter, NookTotpCode};
use nook_core::{
    SecretId, SecretValue, StorageMode, StoredRecordPayload, SymmetricKey, VaultOperation,
};
use wasm_bindgen::JsError;
use wasm_bindgen::prelude::wasm_bindgen;

mod event_log;
pub use event_log::*;
mod secret_import;

pub(super) struct SecretReplacementInput {
    pub old_id: String,
    pub new_id: String,
    pub secret_type: nook_core::SecretType,
    pub data: String,
    pub verification: SecretProjectionVerification,
}

pub(super) enum SecretProjectionVerification {
    None,
    AuthenticatorBackupCodes {
        intended: zeroize::Zeroizing<Vec<String>>,
        reviewed: zeroize::Zeroizing<Vec<String>>,
        mode: nook_core::BackupCodeAttachMode,
    },
}

impl NookVaultManager {
    pub(super) async fn replace_secret_with_projection_verification(
        &mut self,
        input: SecretReplacementInput,
    ) -> Result<Vec<NookSecretRecord>, JsError> {
        let _ = self.status.tx.send("REPLACE_SECRET_START".to_owned());
        self.ensure_vault_crypto_from_cache().await?;
        if !self
            .vault
            .architecture
            .can_create_secret_with_records(&self.stored_records_snapshot())
        {
            return Err(NookError::Database(
                "Sentinel vault is not ready for secret creation.".to_owned(),
            )
            .into());
        }
        let secrets_key = SymmetricKey::parse(&self.vault.secrets_key)?;
        let mut typed_value = SecretValue::from_yaml_str(input.secret_type, &input.data)?;
        let identity_fingerprint = typed_value.identity_fingerprint(&secrets_key)?;
        let fingerprint = typed_value.fingerprint(&secrets_key)?;
        typed_value.zeroize_plaintext();
        let crypto = self.vault.crypto.get()?;
        let replacement = nook_core::ReplaceSecretInput {
            old_id: &input.old_id,
            new_id: &input.new_id,
            secret_type: input.secret_type,
            data_yaml: &input.data,
        };
        match input.verification {
            SecretProjectionVerification::None => {
                nook_core::EncryptedSecretSession {
                    state: &mut self.vault.meta,
                    crypto,
                }
                .prepare(&replacement)?
                .commit();
            }
            SecretProjectionVerification::AuthenticatorBackupCodes {
                intended,
                reviewed,
                mode,
            } => {
                nook_core::EncryptedSecretSession {
                    state: &mut self.vault.meta,
                    crypto,
                }
                .prepare_verified(&nook_core::VerifiedAuthenticatorReplacementInput {
                    replacement,
                    intended_backup_codes: intended.as_slice(),
                    reviewed_backup_codes: reviewed.as_slice(),
                    mode,
                })?
                .commit();
            }
        }
        let validated_new = nook_core::SecretId::parse(&input.new_id)?;
        self.vault.mark_search_catalog_dirty();
        let validated_old = nook_core::SecretId::parse(&input.old_id)?;
        let ciphertext = self
            .vault
            .meta
            .secrets
            .get(&validated_new)
            .map(|(_, payload)| payload.as_str().to_owned())
            .unwrap_or_default();
        self.append_vault_operations(vec![VaultOperation::SecretReplaced {
            old_id: validated_old,
            new_secret: nook_core::EncryptedSecretPayload::from_armored(
                &validated_new,
                input.secret_type,
                &ciphertext,
                identity_fingerprint,
                fingerprint,
            ),
        }])
        .await?;
        let _ = self.status.tx.send("READY".to_owned());
        Ok(self.get_records()?)
    }
}

#[wasm_bindgen]
impl NookVaultManager {
    pub fn filter_secrets(&self, query: &str) -> Result<Vec<NookSecretRecord>, JsError> {
        let mut records = self.get_records()?;
        records.retain(|record| record.matches_search(query));
        Ok(records)
    }

    #[wasm_bindgen]
    pub async fn prepare_secret_search_js(&mut self) -> Result<(), JsError> {
        self.prepare_secret_search_catalog()
            .await
            .map_err(Into::into)
    }

    #[allow(clippy::needless_pass_by_value)]
    #[wasm_bindgen]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects `query_prepared_secret_page_js` paging values through JavaScript Number scalars"
        )
    )]
    pub async fn query_prepared_secret_page_js(
        &mut self,
        query: &str,
        secret_type_filter: NookSecretTypeFilter,
        offset: u32,
        limit: u32,
    ) -> Result<NookSecretPage, JsError> {
        // The default vault view uses an empty query, but it still decrypts
        // records below. Restore the session key before either the default or
        // search path reads the page after a provider/session transition.
        self.ensure_vault_crypto_from_cache().await?;
        if !query.trim().is_empty() {
            self.prepare_secret_search_catalog().await?;
        }
        self.query_secret_page_js(query, secret_type_filter, offset, limit)
    }

    #[allow(clippy::needless_pass_by_value)]
    #[wasm_bindgen]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects `query_secret_page_js` paging values through JavaScript Number scalars"
        )
    )]
    pub fn query_secret_page_js(
        &self,
        query: &str,
        secret_type_filter: NookSecretTypeFilter,
        offset: u32,
        limit: u32,
    ) -> Result<NookSecretPage, JsError> {
        Ok(NookSecretPage::from_core(self.query_secret_page(
            query,
            secret_type_filter.to_core(),
            offset,
            limit,
        )?)?)
    }

    /// Decrypt one full record only after an explicit reveal or secret-value copy.
    #[wasm_bindgen]
    pub fn decrypt_secret_js(&self, id: &str) -> Result<NookSecretRecord, JsError> {
        let crypto = self.vault.crypto.get()?;
        let id = SecretId::from_vault_record(id);
        let record =
            nook_core::VaultSecretSession::new(&self.vault.meta.secrets, crypto).decrypt(&id)?;
        tracing::info!(
            scope = "wasm-secrets",
            action = "decrypt-secret",
            secret_id = %id,
            "secret plaintext exposed on demand"
        );
        Ok(NookSecretRecord::from_record(record))
    }

    #[wasm_bindgen]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: projects the `current_authenticator_code` timestamp or duration through a JavaScript Number scalar"
        )
    )]
    pub fn current_authenticator_code(
        &self,
        id: &str,
        unix_seconds: u32,
    ) -> Result<NookTotpCode, JsError> {
        let crypto = self.vault.crypto.get()?;
        let id = SecretId::from_vault_record(id);
        let mut record =
            nook_core::VaultSecretSession::new(&self.vault.meta.secrets, crypto).decrypt(&id)?;
        let code = if let SecretValue::Authenticator(value) = &record.data {
            value.current_code(u64::from(unix_seconds).into())?
        } else {
            record.zeroize_plaintext();
            return Err(NookError::Database(
                "Requested secret is not an authenticator item.".to_owned(),
            )
            .into());
        };
        record.zeroize_plaintext();
        Ok(NookTotpCode::from_core(code, u64::from(unix_seconds)))
    }

    /// Prefixed secret item id (`secret_{token}`).
    pub fn generate_secret_id(&self) -> Result<String, JsError> {
        Ok(nook_core::SecretId::generate()?.to_string())
    }

    /// Compact random token (11 chars, base64url) without a type prefix.
    pub fn generate_id(&self) -> Result<String, JsError> {
        Ok(nook_core::CompactToken::generate()?.to_string())
    }

    // Expose status channel stream to Svelte client
    pub async fn next_status(&self) -> Result<String, JsError> {
        let msg = self
            .status
            .rx
            .recv_async()
            .await
            .map_err(|e| NookError::Channel(format!("Receive error: {}", e)))?;
        Ok(msg)
    }

    /// Drain all queued status messages without blocking.
    ///
    /// Unlike `next_status`, this never awaits, so it does not hold the
    /// wasm-bindgen borrow across a pending future (which would block every
    /// `&mut self` call like `connect` / `sync_vault_from_storage`).
    #[wasm_bindgen]
    pub fn drain_status_log(&self) -> Vec<String> {
        let mut messages = Vec::new();
        while let Ok(message) = self.status.rx.try_recv() {
            messages.push(message);
        }
        messages
    }

    /// Check whether this device can decrypt the vault before attempting connect.
    // Add a secret
    pub async fn add_secret(
        &mut self,
        id: String,
        secret_type: nook_core::SecretType,
        data: String,
    ) -> Result<Vec<NookSecretRecord>, JsError> {
        let _ = self.status.tx.send("ADD_SECRET_START".to_owned());
        self.ensure_vault_crypto_from_cache().await?;
        if !self
            .vault
            .architecture
            .can_create_secret_with_records(&self.stored_records_snapshot())
        {
            return Err(NookError::Database(
                "Sentinel vault is not ready for secret creation.".to_owned(),
            )
            .into());
        }
        let id = nook_core::SecretId::parse(&id)?;
        nook_core::validate_secret_data(&data)?;
        let secrets_key = SymmetricKey::parse(&self.vault.secrets_key)?;
        let mut typed_value = SecretValue::from_yaml_str(secret_type, &data)?;
        let identity_fingerprint = typed_value.identity_fingerprint(&secrets_key)?;
        let fingerprint = typed_value.fingerprint(&secrets_key)?;
        typed_value.zeroize_plaintext();

        let armored = self.vault.crypto.get()?.encrypt_value(&data)?;
        let ciphertext = armored.as_str().to_owned();
        self.vault.meta.secrets.insert(
            id.clone(),
            (
                secret_type,
                StoredRecordPayload::from_trusted(ciphertext.clone()),
            ),
        );
        self.vault.mark_search_catalog_dirty();

        self.append_vault_operations(vec![VaultOperation::SecretCreated {
            secret: nook_core::EncryptedSecretPayload::from_armored(
                &id,
                secret_type,
                &ciphertext,
                identity_fingerprint,
                fingerprint,
            ),
        }])
        .await?;
        let _ = self.status.tx.send("READY".to_owned());
        let records = self.get_records()?;
        tracing::info!(
            scope = "wasm-secrets",
            action = "add",
            id = %id,
            secret_type = ?secret_type,
            count = records.len(),
            "secret added"
        );
        Ok(records)
    }

    // Replace a secret (new id + payload, single save)
    pub async fn replace_secret(
        &mut self,
        old_id: String,
        new_id: String,
        secret_type: nook_core::SecretType,
        data: String,
    ) -> Result<Vec<NookSecretRecord>, JsError> {
        self.replace_secret_with_projection_verification(SecretReplacementInput {
            old_id,
            new_id,
            secret_type,
            data,
            verification: SecretProjectionVerification::None,
        })
        .await
    }

    #[wasm_bindgen]
    pub async fn merge_remote_joins_from_provider(
        &mut self,
        storage_mode: String,
        github_pat: String,
        github_repo: String,
    ) -> Result<Vec<crate::NookJoinRequest>, JsError> {
        let restore_local = self.storage.mode == StorageMode::Local;
        self.prepare_storage_preserving_vault_metadata(&storage_mode, &github_pat, &github_repo)
            .await?;
        self.sync_events_from_current_provider().await?;
        if restore_local {
            self.prepare_storage_preserving_vault_metadata("local", "", "")
                .await?;
        }
        Ok(self.pending_joins()?)
    }

    #[wasm_bindgen]
    pub async fn flush_event_outbox_for_provider(
        &mut self,
        storage_mode: String,
        github_pat: String,
        github_repo: String,
    ) -> Result<(), JsError> {
        let restore_local = self.storage.mode == StorageMode::Local;
        self.prepare_storage_preserving_vault_metadata(&storage_mode, &github_pat, &github_repo)
            .await?;
        self.flush_event_outbox().await?;
        if restore_local {
            self.prepare_storage_preserving_vault_metadata("local", "", "")
                .await?;
        }
        Ok(())
    }

    #[wasm_bindgen]
    pub async fn sync_event_log_for_provider(
        &mut self,
        storage_mode: String,
        github_pat: String,
        github_repo: String,
    ) -> Result<(), JsError> {
        self.prepare_storage_preserving_vault_metadata(&storage_mode, &github_pat, &github_repo)
            .await?;
        self.sync_events_from_current_provider().await?;
        self.flush_event_outbox().await?;
        Ok(())
    }

    #[wasm_bindgen]
    pub async fn sync_local_folder_provider_js(
        &mut self,
        handle_id: &str,
    ) -> Result<String, JsError> {
        self.sync_local_folder_provider(handle_id)
            .await
            .map_err(Into::into)
    }

    // Delete a secret
    pub async fn delete_secret(&mut self, id: String) -> Result<Vec<NookSecretRecord>, JsError> {
        let _ = self.status.tx.send("DELETE_SECRET_START".to_owned());
        self.ensure_vault_crypto_from_cache().await?;
        let id = nook_core::SecretId::parse(&id)?;
        self.vault.meta.secrets.remove(&id);
        self.vault.mark_search_catalog_dirty();
        self.append_vault_operations(vec![VaultOperation::SecretDeleted {
            secret_id: id.clone(),
        }])
        .await?;
        let _ = self.status.tx.send("READY".to_owned());
        let records = self.get_records()?;
        tracing::info!(
            scope = "wasm-secrets",
            action = "delete",
            id = %id,
            count = records.len(),
            "secret deleted"
        );
        Ok(records)
    }

    #[wasm_bindgen]
    pub async fn resolve_projection_conflict(
        &mut self,
        old_secret_id: String,
        chosen_secret_id: String,
    ) -> Result<Vec<NookSecretRecord>, JsError> {
        let old_id = nook_core::SecretId::parse(&old_secret_id)?;
        let chosen_id = nook_core::SecretId::parse(&chosen_secret_id)?;
        let projection = self.load_projection_conflicts().await?;
        let conflict = projection
            .replacement_conflicts
            .get(&old_id)
            .ok_or_else(|| {
                NookError::Database("Secret replacement conflict not found.".to_owned())
            })?;
        if !conflict
            .candidates
            .values()
            .any(|secret_id| secret_id == &chosen_id)
        {
            return Err(NookError::Database(
                "Chosen secret is not part of this replacement conflict.".to_owned(),
            )
            .into());
        }
        let rejected_secret_ids = conflict
            .candidates
            .values()
            .filter(|secret_id| *secret_id != &chosen_id)
            .cloned()
            .collect();
        self.append_vault_operations(vec![VaultOperation::SecretConflictResolved {
            old_id,
            chosen_secret_id: chosen_id,
            rejected_secret_ids,
        }])
        .await?;
        Ok(self.get_records()?)
    }
}

#[cfg(all(test, target_arch = "wasm32"))]
mod wasm_tests {
    use nook_core::{AgeArmoredCiphertext, VaultKeys};
    use wasm_bindgen_test::*;

    /// WASM-side contract for file-sync reconnect after offline concurrent creates
    /// of the same login identity: both records survive; passwords are not merged.
    /// Full multi-provider scenario coverage lives in
    /// `nook-core/tests/event_log_file_sync_replication.rs`.
    #[wasm_bindgen_test]
    fn concurrent_same_identity_logins_both_survive_after_event_union() -> anyhow::Result<()> {
        use nook_core::{
            EncryptedSecretPayload, LoginSecret, SecretId, SecretType, SecretValue,
            SigningIdentity, StoreId, VaultCrypto, VaultEventSession, VaultOperation,
        };
        use std::collections::BTreeSet;

        const TS: &str = "2026-06-28T00:00:00Z";

        fn append_login(
            session: &mut VaultEventSession,
            crypto: &VaultCrypto,
            secrets_key: &nook_core::SymmetricKey,
            secret_id: &str,
            password: &str,
        ) -> anyhow::Result<()> {
            let value = SecretValue::Login(LoginSecret {
                website_url: "https://login-a-1.example.com".to_owned(),
                username: "alice".to_owned(),
                password: password.to_owned(),
                notes: String::new(),
            });
            let identity = value.identity_fingerprint(secrets_key)?;
            let version = value.fingerprint(secrets_key)?;
            let ciphertext = crypto.encrypt_value(value.to_yaml()?.as_str())?;
            session.append_operations(
                vec![VaultOperation::SecretCreated {
                    secret: EncryptedSecretPayload::from_armored(
                        &SecretId::from_vault_record(secret_id),
                        SecretType::Login,
                        ciphertext.as_str(),
                        identity,
                        version,
                    ),
                }],
                TS,
                Some("local-folder"),
            )?;
            Ok(())
        }

        let keys = VaultKeys::generate()?;
        let store_id = StoreId::generate()?;
        let (signing, signing_seed) = SigningIdentity::generate()?;
        let crypto = VaultCrypto::new(&keys.secrets_key)?;

        let mut device_a = VaultEventSession::new(
            store_id.to_string(),
            signing.clone(),
            signing_seed.clone().into_inner(),
        );
        device_a.append_operations(
            vec![VaultOperation::VaultImported {
                source_content_hash: nook_auth2::Sha256Hex::from_trusted("0".repeat(64)),
                secrets: Vec::new(),
                password_entries: Vec::new(),
            }],
            TS,
            Some("local-folder"),
        )?;

        let mut device_b =
            VaultEventSession::new(store_id.to_string(), signing, signing_seed.into_inner());
        let genesis_events: Vec<_> = device_a
            .store
            .event_ids()
            .into_iter()
            .filter_map(|id| {
                device_a
                    .store
                    .get_bytes(&id)
                    .map(|bytes| (id, bytes.into()))
            })
            .collect();
        device_b.union_remote(&genesis_events)?;

        let shared_head = device_a.heads[0].clone();
        // Disconnect: each device appends offline from the same head.
        device_a.heads = vec![shared_head.clone()];
        append_login(
            &mut device_a,
            &crypto,
            &keys.secrets_key,
            "secret_logina1aaaa",
            "password-from-device-a",
        )?;
        device_b.heads = vec![shared_head];
        append_login(
            &mut device_b,
            &crypto,
            &keys.secrets_key,
            "secret_logina1bbbb",
            "password-from-device-b",
        )?;

        // Reconnect via file-sync style set-union.
        let a_events: Vec<_> = device_a
            .store
            .event_ids()
            .into_iter()
            .filter_map(|id| {
                device_a
                    .store
                    .get_bytes(&id)
                    .map(|bytes| (id, bytes.into()))
            })
            .collect();
        let b_events: Vec<_> = device_b
            .store
            .event_ids()
            .into_iter()
            .filter_map(|id| {
                device_b
                    .store
                    .get_bytes(&id)
                    .map(|bytes| (id, bytes.into()))
            })
            .collect();
        device_a.union_remote(&b_events)?;
        device_b.union_remote(&a_events)?;

        let graph = device_a.store.load_graph(device_a.store_id.as_str())?;
        let projection = device_a.project()?;
        let live = projection.live_secrets(&graph);
        assert_eq!(live.len(), 2);
        assert!(!projection.has_blocking_conflicts());

        let mut passwords = BTreeSet::new();
        for record in live.values() {
            let plaintext =
                crypto.decrypt_value(&AgeArmoredCiphertext::parse(record.value.as_str())?)?;
            let value = SecretValue::from_yaml_str(SecretType::Login, plaintext.as_str())?;
            let SecretValue::Login(login) = value else {
                panic!("expected login");
            };
            passwords.insert(login.password);
        }
        assert_eq!(
            passwords,
            BTreeSet::from([
                "password-from-device-a".to_owned(),
                "password-from-device-b".to_owned(),
            ])
        );

        let identities: BTreeSet<_> = projection
            .secrets
            .values()
            .filter(|secret| secret.is_live(&graph))
            .map(|secret| secret.identity_fingerprint.as_str().to_owned())
            .collect();
        assert_eq!(identities.len(), 1, "same login identity on both records");
        Ok(())
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod projection_tests {
    use super::*;
    use nook_core::{AuthenticatorSecret, DeviceIdentity, LoginSecret, SecretType, SecretValue};
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    fn js<T>(result: Result<T, JsError>) -> anyhow::Result<T> {
        result.map_err(|error| anyhow::anyhow!("{error:?}"))
    }

    #[wasm_bindgen_test]
    fn empty_secret_session_exposes_safe_helpers() {
        let manager = NookVaultManager::new();
        assert!(manager.filter_secrets("fixture").is_err());
        assert!(manager.decrypt_secret_js("secret_missing").is_err());
        assert!(
            manager
                .current_authenticator_code("secret_missing", 1_750_000_000)
                .is_err()
        );
        assert!(
            manager
                .generate_secret_id()
                .is_ok_and(|secret_id| secret_id.starts_with("secret_"))
        );
        assert!(
            manager
                .generate_id()
                .is_ok_and(|generated_id| generated_id.len() == 11)
        );
        assert!(manager.status.tx.send("FIRST".to_owned()).is_ok());
        assert!(manager.status.tx.send("SECOND".to_owned()).is_ok());
        assert_eq!(
            manager.drain_status_log(),
            vec!["FIRST".to_owned(), "SECOND".to_owned()]
        );
        assert!(manager.drain_status_log().is_empty());
    }

    #[wasm_bindgen_test]
    async fn secret_crud_projection_and_status_paths_round_trip() -> anyhow::Result<()> {
        let mut manager = NookVaultManager::new();
        js(manager.delete_local_browser_data().await)?;
        let identity = DeviceIdentity::generate()?;
        manager.device.identity_private_key = identity.secret_string().into_inner();
        manager.initialize_genesis_vault(&identity)?;
        manager.vault.store_id = nook_core::StoreId::generate()?.to_string();
        manager.bootstrap_event_log_genesis().await?;
        manager.drain_status_log();

        let original_id = js(manager.generate_secret_id())?;
        let original_data = SecretValue::Login(LoginSecret {
            website_url: "https://example.com/login".to_owned(),
            username: "alice".to_owned(),
            password: "first-password".to_owned(),
            notes: "coverage fixture".to_owned(),
        })
        .to_yaml()?
        .into_inner();
        let records = js(manager
            .add_secret(original_id.clone(), SecretType::Login, original_data)
            .await)?;
        assert!(records.iter().any(|record| record.id() == original_id));
        assert_eq!(
            manager.drain_status_log(),
            vec!["ADD_SECRET_START".to_owned(), "READY".to_owned()]
        );

        let filtered = js(manager.filter_secrets("alice"))?;
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].username(), "alice");
        let decrypted = js(manager.decrypt_secret_js(&original_id))?;
        assert_eq!(decrypted.password(), "first-password");
        assert_eq!(decrypted.notes(), "coverage fixture");
        assert!(
            manager
                .current_authenticator_code(&original_id, 1_750_000_000)
                .is_err()
        );

        let mut page = js(manager.query_secret_page_js("", NookSecretTypeFilter::Login, 0, 10))?;
        assert_eq!(page.total(), 1);
        assert_eq!(page.offset(), 0);
        assert_eq!(page.limit(), 10);
        let items = page.take_items();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id(), original_id);

        let replacement_id = js(manager.generate_secret_id())?;
        let replacement_data = SecretValue::Login(LoginSecret {
            website_url: "https://example.com/replaced".to_owned(),
            username: "alice".to_owned(),
            password: "second-password".to_owned(),
            notes: String::new(),
        })
        .to_yaml()?
        .into_inner();
        js(manager
            .replace_secret(
                original_id.clone(),
                replacement_id.clone(),
                SecretType::Login,
                replacement_data,
            )
            .await)?;
        assert!(manager.decrypt_secret_js(&original_id).is_err());
        assert_eq!(
            js(manager.decrypt_secret_js(&replacement_id))?.password(),
            "second-password"
        );
        js(manager.delete_secret(replacement_id.clone()).await)?;
        assert!(manager.decrypt_secret_js(&replacement_id).is_err());
        assert_eq!(
            manager.drain_status_log(),
            vec![
                "REPLACE_SECRET_START".to_owned(),
                "READY".to_owned(),
                "DELETE_SECRET_START".to_owned(),
                "READY".to_owned(),
            ]
        );
        js(manager.delete_local_browser_data().await)?;
        Ok(())
    }

    #[wasm_bindgen_test]
    async fn authenticator_projection_search_and_totp_paths_round_trip() -> anyhow::Result<()> {
        let mut manager = NookVaultManager::new();
        js(manager.delete_local_browser_data().await)?;
        let identity = DeviceIdentity::generate()?;
        manager.device.identity_private_key = identity.secret_string().into_inner();
        manager.initialize_genesis_vault(&identity)?;
        manager.vault.store_id = nook_core::StoreId::generate()?.to_string();
        manager.bootstrap_event_log_genesis().await?;
        manager.drain_status_log();

        let secret_id = js(manager.generate_secret_id())?;
        let authenticator = AuthenticatorSecret::from_otpauth_uri(
            "otpauth://totp/Nook:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Nook",
        )?;
        let data = SecretValue::Authenticator(authenticator)
            .to_yaml()?
            .into_inner();
        let records = js(manager
            .add_secret(secret_id.clone(), SecretType::Authenticator, data)
            .await)?;
        assert!(records.iter().any(|record| record.id() == secret_id));

        let code = js(manager.current_authenticator_code(&secret_id, 1_750_000_000))?;
        assert_eq!(code.code().len(), 6);
        assert_eq!(code.period(), 30);
        assert!(code.seconds_remaining() <= code.period());
        assert!(code.expires_at_unix_seconds() > 1_750_000_000.0);

        let mut prepared = js(manager
            .query_prepared_secret_page_js(
                "alice@example.com",
                NookSecretTypeFilter::Authenticator,
                0,
                1,
            )
            .await)?;
        assert_eq!(prepared.total(), 1);
        assert_eq!(prepared.offset(), 0);
        assert_eq!(prepared.limit(), 1);
        assert_eq!(prepared.take_items().len(), 1);

        let mut filtered =
            js(manager.query_secret_page_js("missing", NookSecretTypeFilter::All, 0, 10))?;
        assert_eq!(filtered.total(), 0);
        assert!(filtered.take_items().is_empty());

        js(manager.delete_local_browser_data().await)?;
        Ok(())
    }
}

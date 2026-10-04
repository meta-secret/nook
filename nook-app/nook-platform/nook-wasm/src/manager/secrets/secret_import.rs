#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
use super::NookVaultManager;
use crate::{NookError, NookImportResult};
use nook_core::BitwardenExportAccess;
use nook_core::{
    ApplePasswordsExportInput, DashlaneExport, GoogleAuthenticatorMigrationInput, KeeperCsvInput,
    OnePasswordExport, ProtonPassImportInput,
};
use nook_core::{ChromePasswordsCsvInput, KeePassXcCsvInput, LastPassCsvInput};
use nook_core::{SecretImportUnsupportedRecordCount, SymmetricKey, VaultOperation};
use wasm_bindgen::JsError;
use wasm_bindgen::prelude::wasm_bindgen;
use zeroize::Zeroizing;

mod preparation;
use preparation::{CoalescedSecretImport, PreparedSecretImport};

#[derive(Clone, Copy)]
pub(super) enum SecretImportSource {
    ApplePasswords,
    Bitwarden,
    ChromePasswords,
    Dashlane,
    GoogleAuthenticator,
    KeePassXc,
    Keeper,
    LastPass,
    OnePassword,
    ProtonPass,
}

impl SecretImportSource {
    const fn status(self) -> &'static str {
        match self {
            Self::ApplePasswords => "IMPORT_APPLE_PASSWORDS_START",
            Self::Bitwarden => "IMPORT_BITWARDEN_START",
            Self::ChromePasswords => "IMPORT_CHROME_PASSWORDS_START",
            Self::Dashlane => "IMPORT_DASHLANE_START",
            Self::GoogleAuthenticator => "IMPORT_GOOGLE_AUTHENTICATOR_START",
            Self::KeePassXc => "IMPORT_KEEPASSXC_START",
            Self::Keeper => "IMPORT_KEEPER_START",
            Self::LastPass => "IMPORT_LASTPASS_START",
            Self::OnePassword => "IMPORT_ONEPASSWORD_START",
            Self::ProtonPass => "IMPORT_PROTON_PASS_START",
        }
    }

    const fn action(self) -> &'static str {
        match self {
            Self::ApplePasswords => "import-apple-passwords",
            Self::Bitwarden => "import-bitwarden",
            Self::ChromePasswords => "import-chrome-passwords",
            Self::Dashlane => "import-dashlane",
            Self::GoogleAuthenticator => "import-google-authenticator",
            Self::KeePassXc => "import-keepassxc",
            Self::Keeper => "import-keeper",
            Self::LastPass => "import-lastpass",
            Self::OnePassword => "import-onepassword",
            Self::ProtonPass => "import-proton-pass",
        }
    }

    const fn label(self) -> &'static str {
        match self {
            Self::ApplePasswords => "Safari / Apple Passwords",
            Self::Bitwarden => "Bitwarden",
            Self::ChromePasswords => "Chrome passwords",
            Self::Dashlane => "Dashlane",
            Self::GoogleAuthenticator => "Google Authenticator",
            Self::KeePassXc => "KeePassXC",
            Self::Keeper => "Keeper",
            Self::LastPass => "LastPass",
            Self::OnePassword => "1Password",
            Self::ProtonPass => "Proton Pass",
        }
    }
}

impl NookVaultManager {
    pub(super) async fn commit_secret_import(
        &mut self,
        items: Vec<nook_core::SecretValue>,
        skipped_unsupported: SecretImportUnsupportedRecordCount,
        source: SecretImportSource,
    ) -> Result<NookImportResult, JsError> {
        drop(self.status.tx.send(source.status().to_owned()));
        self.ensure_vault_crypto_from_cache().await?;
        if !self
            .vault
            .architecture
            .can_create_secret_with_records(&self.stored_records_snapshot())
        {
            return Err(NookError::Database(
                "Sentinel vault is not ready for secret import.".to_owned(),
            )
            .into());
        }

        let secrets_key = SymmetricKey::parse(&self.vault.secrets_key)?;
        let coalesced = CoalescedSecretImport::new(items, &secrets_key)?;
        let dedup_state = self.live_secret_dedup_state().await?;
        let crypto = self.vault.crypto.get()?;
        let prepared = coalesced.prepare(dedup_state, crypto).await?;
        prepared.commit(self, source, skipped_unsupported).await
    }
}

impl PreparedSecretImport {
    async fn commit(
        self,
        manager: &mut NookVaultManager,
        source: SecretImportSource,
        skipped_unsupported: SecretImportUnsupportedRecordCount,
    ) -> Result<NookImportResult, JsError> {
        let Self {
            operations,
            skipped_duplicates,
        } = self;
        let imported = operations
            .iter()
            .filter(|operation| {
                matches!(
                    operation,
                    VaultOperation::SecretCreated { .. } | VaultOperation::SecretReplaced { .. }
                )
            })
            .count();
        if !operations.is_empty() {
            manager.append_vault_operations(operations).await?;
        }
        drop(manager.status.tx.send("READY".to_owned()));
        tracing::info!(
            scope = "wasm-secrets",
            action = source.action(),
            import_source = source.label(),
            imported,
            skipped_unsupported = usize::from(skipped_unsupported),
            skipped_duplicates,
            "Secret import completed"
        );
        Ok(NookImportResult::new(
            imported,
            usize::from(skipped_unsupported),
            skipped_duplicates,
        ))
    }
}

#[wasm_bindgen]
impl NookVaultManager {
    /// Import supported entries from a plaintext or password-protected encrypted
    /// Bitwarden JSON export in one signed event. Exact values already present in
    /// the active vault are not imported again.
    #[wasm_bindgen]
    pub async fn import_bitwarden_json(
        &mut self,
        json: String,
        password: String,
    ) -> Result<NookImportResult, JsError> {
        let json = Zeroizing::new(json);
        let password = Zeroizing::new(password);
        let plan = nook_core::BitwardenExport {
            json: json.as_str(),
            password: BitwardenExportAccess::PasswordProvided(password.as_str()),
        }
        .plan()
        .map_err(|error| NookError::Database(error.to_string()))?;
        drop(password);
        drop(json);
        self.commit_secret_import(
            plan.items,
            plan.skipped_unsupported,
            SecretImportSource::Bitwarden,
        )
        .await
    }

    /// Import logins and secure notes from a `KeePassXC` CSV export in one signed
    /// event. The CSV is parsed in memory and never persisted.
    #[wasm_bindgen]
    pub async fn import_keepassxc_csv(&mut self, csv: String) -> Result<NookImportResult, JsError> {
        let csv = Zeroizing::new(csv);
        let plan = KeePassXcCsvInput::new(csv.as_str())
            .plan()
            .map_err(|error| NookError::Database(error.to_string()))?;
        drop(csv);
        self.commit_secret_import(
            plan.items,
            plan.skipped_unsupported,
            SecretImportSource::KeePassXc,
        )
        .await
    }

    /// Import logins and secure notes from a plaintext `LastPass` generic CSV
    /// export in one signed event. The CSV is parsed in memory and never
    /// persisted.
    #[wasm_bindgen]
    pub async fn import_lastpass_csv(&mut self, csv: String) -> Result<NookImportResult, JsError> {
        let csv = Zeroizing::new(csv);
        let plan = LastPassCsvInput::new(csv.as_str())
            .plan()
            .map_err(|error| NookError::Database(error.to_string()))?;
        drop(csv);
        self.commit_secret_import(
            plan.items,
            plan.skipped_unsupported,
            SecretImportSource::LastPass,
        )
        .await
    }

    /// Import logins and secure notes from a plaintext Keeper CSV export in one
    /// signed event. The CSV is parsed in memory and never persisted.
    #[wasm_bindgen]
    pub async fn import_keeper_csv(&mut self, csv: String) -> Result<NookImportResult, JsError> {
        let csv = Zeroizing::new(csv);
        let plan = KeeperCsvInput::new(csv.as_str())
            .plan()
            .map_err(|error| NookError::Database(error.to_string()))?;
        drop(csv);
        self.commit_secret_import(
            plan.items,
            plan.skipped_unsupported,
            SecretImportSource::Keeper,
        )
        .await
    }

    /// Import supported entries from an unencrypted 1Password 1PUX archive in
    /// one signed event. The archive is parsed in memory and never persisted.
    #[wasm_bindgen]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: exchanges `import_onepassword_pux` bytes with JavaScript as a Uint8Array"
        )
    )]
    pub async fn import_onepassword_pux(
        &mut self,
        archive: Vec<u8>,
    ) -> Result<NookImportResult, JsError> {
        let archive = Zeroizing::new(archive);
        let plan = OnePasswordExport::from_bytes(archive.as_slice())
            .plan()
            .map_err(|error| NookError::Database(error.to_string()))?;
        drop(archive);
        self.commit_secret_import(
            plan.items,
            plan.skipped_unsupported,
            SecretImportSource::OnePassword,
        )
        .await
    }

    /// Import passwords and verification codes from an Apple Passwords CSV or
    /// Safari browsing-data ZIP export in one signed event. The export is
    /// parsed only in memory.
    #[wasm_bindgen]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: exchanges `import_apple_passwords_export` bytes with JavaScript as a Uint8Array"
        )
    )]
    pub async fn import_apple_passwords_export(
        &mut self,
        export: Vec<u8>,
    ) -> Result<NookImportResult, JsError> {
        let export = Zeroizing::new(export);
        let plan = ApplePasswordsExportInput::from_bytes(export.as_slice())
            .plan()
            .map_err(|error| NookError::Database(error.to_string()))?;
        drop(export);
        self.commit_secret_import(
            plan.items,
            plan.skipped_unsupported,
            SecretImportSource::ApplePasswords,
        )
        .await
    }

    /// Import logins from a Chrome-family CSV export in one signed event. The
    /// plaintext CSV is parsed only in memory.
    #[wasm_bindgen]
    pub async fn import_chrome_passwords_csv(
        &mut self,
        csv: String,
    ) -> Result<NookImportResult, JsError> {
        let csv = Zeroizing::new(csv);
        let plan = ChromePasswordsCsvInput::new(csv.as_str())
            .plan()
            .map_err(|error| NookError::Database(error.to_string()))?;
        drop(csv);
        self.commit_secret_import(
            plan.items,
            plan.skipped_unsupported,
            SecretImportSource::ChromePasswords,
        )
        .await
    }

    /// Import supported items from an unencrypted Dashlane CSV or CSV ZIP export
    /// in one signed event. The export is parsed only in memory.
    #[wasm_bindgen]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: exchanges `import_dashlane_export` bytes with JavaScript as a Uint8Array"
        )
    )]
    pub async fn import_dashlane_export(
        &mut self,
        export: Vec<u8>,
    ) -> Result<NookImportResult, JsError> {
        let export = Zeroizing::new(export);
        let plan = DashlaneExport::from_bytes(export.as_slice())
            .plan()
            .map_err(|error| NookError::Database(error.to_string()))?;
        drop(export);
        self.commit_secret_import(
            plan.items,
            plan.skipped_unsupported,
            SecretImportSource::Dashlane,
        )
        .await
    }

    /// Import TOTP accounts from one complete Google Authenticator migration
    /// QR batch in one signed event. QR contents are decoded only in memory.
    #[wasm_bindgen]
    pub async fn import_google_authenticator_migration(
        &mut self,
        migration_uris: Vec<String>,
    ) -> Result<NookImportResult, JsError> {
        let migration_uris = Zeroizing::new(migration_uris);
        let plan = GoogleAuthenticatorMigrationInput::from_uris(migration_uris.as_slice())
            .plan()
            .map_err(|error| NookError::Database(error.to_string()))?;
        drop(migration_uris);
        self.commit_secret_import(
            plan.items,
            plan.skipped_unsupported,
            SecretImportSource::GoogleAuthenticator,
        )
        .await
    }

    /// Import logins and secure notes from an unencrypted Proton Pass ZIP
    /// export or decrypted data.json in one signed event. The export is parsed
    /// in memory and never persisted.
    #[wasm_bindgen]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "FFI boundary: exchanges `import_proton_pass` bytes with JavaScript as a Uint8Array"
        )
    )]
    pub async fn import_proton_pass(
        &mut self,
        export: Vec<u8>,
    ) -> Result<NookImportResult, JsError> {
        let export = Zeroizing::new(export);
        let plan = ProtonPassImportInput::from_bytes(export.as_slice())
            .plan()
            .map_err(|error| NookError::Database(error.to_string()))?;
        drop(export);
        self.commit_secret_import(
            plan.items,
            plan.skipped_unsupported,
            SecretImportSource::ProtonPass,
        )
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test callback"
        )
    )]
    fn import_sources_keep_status_actions_and_labels_aligned() {
        let cases = [
            (
                SecretImportSource::ApplePasswords,
                "IMPORT_APPLE_PASSWORDS_START",
                "import-apple-passwords",
                "Safari / Apple Passwords",
            ),
            (
                SecretImportSource::Bitwarden,
                "IMPORT_BITWARDEN_START",
                "import-bitwarden",
                "Bitwarden",
            ),
            (
                SecretImportSource::ChromePasswords,
                "IMPORT_CHROME_PASSWORDS_START",
                "import-chrome-passwords",
                "Chrome passwords",
            ),
            (
                SecretImportSource::Dashlane,
                "IMPORT_DASHLANE_START",
                "import-dashlane",
                "Dashlane",
            ),
            (
                SecretImportSource::GoogleAuthenticator,
                "IMPORT_GOOGLE_AUTHENTICATOR_START",
                "import-google-authenticator",
                "Google Authenticator",
            ),
            (
                SecretImportSource::KeePassXc,
                "IMPORT_KEEPASSXC_START",
                "import-keepassxc",
                "KeePassXC",
            ),
            (
                SecretImportSource::Keeper,
                "IMPORT_KEEPER_START",
                "import-keeper",
                "Keeper",
            ),
            (
                SecretImportSource::LastPass,
                "IMPORT_LASTPASS_START",
                "import-lastpass",
                "LastPass",
            ),
            (
                SecretImportSource::OnePassword,
                "IMPORT_ONEPASSWORD_START",
                "import-onepassword",
                "1Password",
            ),
            (
                SecretImportSource::ProtonPass,
                "IMPORT_PROTON_PASS_START",
                "import-proton-pass",
                "Proton Pass",
            ),
        ];

        for (source, status, action, label) in cases {
            assert_eq!(source.status(), status);
            assert_eq!(source.action(), action);
            assert_eq!(source.label(), label);
        }
    }
}

#[cfg(test)]
mod prepared_page_tests {
    use super::*;
    use crate::NookDatabase;
    use crate::NookSecretTypeFilter;
    use crate::manager::VaultCryptoState;
    use nook_core::DeviceIdentity;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    async fn default_page_restores_crypto_from_the_cached_projection() -> Result<(), JsError> {
        let identity = DeviceIdentity::generate()?;
        let mut manager = NookVaultManager::new();
        manager.device.identity_private_key = identity.secret_string().into_inner();
        manager.initialize_genesis_vault(&identity)?;
        manager.vault.store_id = nook_core::StoreId::generate()
            .map_err(|error| JsError::new(&error.to_string()))?
            .to_string();
        manager.vault.last_synced_content = manager.serialize_current_projection_yaml()?;
        manager.vault.secrets_key.clear();
        manager.vault.members_key.clear();
        manager.vault.crypto = VaultCryptoState::Locked;

        manager
            .query_prepared_secret_page_js("", NookSecretTypeFilter::All, 0, 25)
            .await?;

        assert!(manager.vault.crypto.is_unlocked());
        Ok(())
    }
}

#[cfg(all(test, target_arch = "wasm32", feature = "browser-wasm-tests"))]
mod secret_import_browser_tests {
    use super::*;
    use nook_core::{DeviceIdentity, SecretValue};
    use wasm_bindgen_test::{wasm_bindgen_test, wasm_bindgen_test_configure};

    wasm_bindgen_test_configure!(run_in_browser);

    fn js<T>(result: Result<T, JsError>) -> anyhow::Result<T> {
        result.map_err(|error| anyhow::anyhow!("{error:?}"))
    }

    async fn ready_manager() -> anyhow::Result<NookVaultManager> {
        let mut manager = NookVaultManager::new();
        js(manager.delete_local_browser_data().await)?;
        let identity = DeviceIdentity::generate()?;
        manager.device.identity_private_key = identity.secret_string().into_inner();
        manager.initialize_genesis_vault(&identity)?;
        manager.vault.store_id = nook_core::StoreId::generate()?.to_string();
        manager.bootstrap_event_log_genesis().await?;
        manager.drain_status_log();
        Ok(manager)
    }

    fn assert_status(manager: &NookVaultManager, source: &str) {
        assert_eq!(
            manager.drain_status_log(),
            vec![format!("{source}_START"), "READY".to_owned()]
        );
    }

    #[wasm_bindgen_test]
    async fn import_wrappers_commit_duplicate_and_empty_plans() -> anyhow::Result<()> {
        let mut manager = ready_manager().await?;

        let bitwarden = r#"{"items":[{"type":1,"name":"Bitwarden","notes":"recovery","login":{"username":"alice","password":"bitwarden-secret","uris":[{"uri":"https://bitwarden.example"}]}}]}"#;
        let result = js(manager
            .import_bitwarden_json(bitwarden.to_owned(), String::new())
            .await)?;
        assert_eq!(result.imported(), 1);
        assert_eq!(result.skipped_unsupported(), 0);
        assert_eq!(result.skipped_duplicates(), 0);
        assert_status(&manager, "IMPORT_BITWARDEN");

        let chrome = "name,url,username,password,note\nChrome,https://chrome.example,alice,chrome-secret,notes\n";
        let result = js(manager.import_chrome_passwords_csv(chrome.to_owned()).await)?;
        assert_eq!(result.imported(), 1);
        assert_status(&manager, "IMPORT_CHROME_PASSWORDS");
        let result = js(manager.import_chrome_passwords_csv(chrome.to_owned()).await)?;
        assert_eq!(result.imported(), 0);
        assert_eq!(result.skipped_duplicates(), 1);
        assert_status(&manager, "IMPORT_CHROME_PASSWORDS");

        let lastpass = "url,username,password,extra,name,grouping,fav\nhttps://lastpass.example,alice,lastpass-secret,Recovery,LastPass,Personal,1\n";
        let result = js(manager.import_lastpass_csv(lastpass.to_owned()).await)?;
        assert_eq!(result.imported(), 1);
        assert_status(&manager, "IMPORT_LASTPASS");

        let keepassxc = "Group,Title,Username,Password,URL,Notes\n,Keepass,alice,keepass-secret,https://keepass.example,offline\n";
        let result = js(manager.import_keepassxc_csv(keepassxc.to_owned()).await)?;
        assert_eq!(result.imported(), 1);
        assert_status(&manager, "IMPORT_KEEPASSXC");

        let keeper = "Title,Login,Password,Website Address,Notes\nKeeper,alice,keeper-secret,https://keeper.example,offline\n";
        let result = js(manager.import_keeper_csv(keeper.to_owned()).await)?;
        assert_eq!(result.imported(), 1);
        assert_status(&manager, "IMPORT_KEEPER");

        let apple = "Title,URL,Username,Password\nApple,https://apple.example,alice,apple-secret\n";
        let result = js(manager
            .import_apple_passwords_export(apple.as_bytes().to_vec())
            .await)?;
        assert_eq!(result.imported(), 1);
        assert_status(&manager, "IMPORT_APPLE_PASSWORDS");

        let dashlane = "username,title,password,note,url,category,otpSecret\nalice,Dashlane,dashlane-secret,offline,https://dashlane.example,Personal,\n";
        let result = js(manager
            .import_dashlane_export(dashlane.as_bytes().to_vec())
            .await)?;
        assert_eq!(result.imported(), 1);
        assert_status(&manager, "IMPORT_DASHLANE");

        let result = js(manager
            .import_proton_pass(br#"{"vaults":{}}"#.to_vec())
            .await)?;
        assert_eq!(result.imported(), 0);
        assert_status(&manager, "IMPORT_PROTON_PASS");

        assert!(
            manager
                .import_google_authenticator_migration(vec!["not-a-migration-uri".to_owned()])
                .await
                .is_err()
        );
        assert!(manager.import_onepassword_pux(Vec::new()).await.is_err());

        js(manager.delete_local_browser_data().await)?;
        Ok(())
    }
    #[wasm_bindgen_test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
        )
    )]
    async fn yielding_import_publishes_one_event_and_retry_only_counts_duplicates()
    -> anyhow::Result<()> {
        use futures_util::future::{Either, select};
        use gloo_timers::future;
        use std::time::Duration;
        let mut manager = ready_manager().await?;
        let store_id = manager.vault.store_id.clone();
        let before = NookDatabase::load_local_event_store(&store_id)
            .await?
            .event_ids();
        manager.ensure_vault_crypto_from_cache().await?;
        let secrets_key = SymmetricKey::parse(&manager.vault.secrets_key)?;
        let dedup_state = manager.live_secret_dedup_state().await?;
        let prepared = {
            let coalesced = CoalescedSecretImport::new(
                (0..33)
                    .map(|index| {
                        SecretValue::SecureNote(nook_core::SecureNoteSecret {
                            title: format!("Batch note {index}"),
                            note: format!("Batch content {index}"),
                        })
                    })
                    .collect(),
                &secrets_key,
            )?;
            let preparation = coalesced.prepare(dedup_state, manager.vault.crypto.get()?);
            futures_util::pin_mut!(preparation);
            let browser_task = future::sleep(Duration::ZERO);
            futures_util::pin_mut!(browser_task);
            match select(preparation, browser_task).await {
                Either::Right(((), preparation)) => {
                    // Storage reads finish before this race. Suspending a live
                    // IndexedDB future while observing storage can miss its
                    // transaction completion event.
                    // A yielded import has prepared data in memory only. The
                    // persisted event set is unchanged until its single commit.
                    assert_eq!(
                        NookDatabase::load_local_event_store(&store_id)
                            .await?
                            .event_ids(),
                        before
                    );
                    preparation.await?
                }
                Either::Left(_) => {
                    anyhow::bail!("Import finished before the browser could run a task")
                }
            }
        };
        let result = js(prepared
            .commit(
                &mut manager,
                SecretImportSource::Bitwarden,
                SecretImportUnsupportedRecordCount::default(),
            )
            .await)?;
        assert_eq!(result.imported(), 33);
        let after = NookDatabase::load_local_event_store(&store_id)
            .await?
            .event_ids();
        assert_eq!(after.len(), before.len() + 1);
        let duplicate = js(manager
            .commit_secret_import(
                (0..33)
                    .map(|index| {
                        SecretValue::SecureNote(nook_core::SecureNoteSecret {
                            title: format!("Batch note {index}"),
                            note: format!("Batch content {index}"),
                        })
                    })
                    .collect(),
                SecretImportUnsupportedRecordCount::default(),
                SecretImportSource::Bitwarden,
            )
            .await)?;
        assert_eq!(duplicate.imported(), 0);
        assert_eq!(duplicate.skipped_duplicates(), 33);
        assert_eq!(
            NookDatabase::load_local_event_store(&store_id)
                .await?
                .event_ids(),
            after
        );
        js(manager.delete_local_browser_data().await)?;
        Ok(())
    }
}

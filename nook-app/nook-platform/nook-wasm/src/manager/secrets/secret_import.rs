#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
use super::NookVaultManager;
use crate::{NookError, NookImportResult};
use nook_core::{AgeArmoredCiphertext, SecretValue, SymmetricKey, VaultOperation};
use std::collections::{HashMap, HashSet};
use wasm_bindgen::JsError;
use wasm_bindgen::prelude::wasm_bindgen;
use zeroize::Zeroizing;

type ImportVersions = HashMap<
    nook_core::SecretFingerprint,
    Vec<(nook_core::StoredSecretRecord, nook_core::SecretFingerprint)>,
>;

struct CoalescedSecretImport<'a> {
    items: Vec<SecretValue>,
    duplicates: usize,
    secrets_key: &'a SymmetricKey,
}

struct PreparedSecretImport {
    operations: Vec<VaultOperation>,
    skipped_duplicates: usize,
}

impl CoalescedSecretImport<'_> {
    fn group_import_fingerprints(
        dedup_state: Vec<(
            nook_core::StoredSecretRecord,
            nook_core::SecretFingerprint,
            nook_core::SecretFingerprint,
        )>,
        incoming_count: usize,
    ) -> ImportVersions {
        let mut by_identity = HashMap::with_capacity(dedup_state.len() + incoming_count);
        for (record, identity_fingerprint, fingerprint) in dedup_state {
            by_identity
                .entry(identity_fingerprint)
                .or_insert_with(Vec::new)
                .push((record, fingerprint));
        }
        by_identity
    }
}

enum ImportItemOutcome {
    Duplicate,
    Operation(nook_core::VaultOperation),
}

impl<'a> CoalescedSecretImport<'a> {
    fn new(
        items: Vec<nook_core::SecretValue>,
        secrets_key: &'a SymmetricKey,
    ) -> Result<Self, NookError> {
        let mut coalesced: Vec<nook_core::SecretValue> = Vec::with_capacity(items.len());
        let mut indexes: HashMap<nook_core::SecretFingerprint, usize> =
            HashMap::with_capacity(items.len());
        let mut duplicates = 0;
        for mut value in items {
            let fingerprint = nook_core::secret_fingerprint(&value, secrets_key)?;
            if let Some(index) = indexes.get(&fingerprint).copied() {
                let enriched = nook_core::enrich_secret(&coalesced[index], &value);
                coalesced[index].zeroize_plaintext();
                value.zeroize_plaintext();
                coalesced[index] = enriched;
                duplicates += 1;
            } else {
                indexes.insert(fingerprint, coalesced.len());
                coalesced.push(value);
            }
        }
        Ok(Self {
            items: coalesced,
            duplicates,
            secrets_key,
        })
    }

    fn reconcile_import_item(
        mut value: nook_core::SecretValue,
        existing_by_identity: &ImportVersions,
        seen_versions: &mut HashSet<nook_core::SecretFingerprint>,
        crypto: &nook_core::VaultCrypto,
        secrets_key: &nook_core::SymmetricKey,
    ) -> Result<ImportItemOutcome, NookError> {
        let identity_fingerprint = nook_core::secret_identity_fingerprint(&value, secrets_key)?;
        let fingerprint = nook_core::secret_fingerprint(&value, secrets_key)?;
        if let Some((record, _)) =
            existing_by_identity
                .get(&identity_fingerprint)
                .and_then(|records| {
                    records
                        .iter()
                        .find(|(_, existing)| existing == &fingerprint)
                })
        {
            let secret_type = record.secret_type.ok_or_else(|| {
                NookError::Database(format!("Secret {} is missing its type.", record.key))
            })?;
            let ciphertext = AgeArmoredCiphertext::parse(record.value.as_str())?;
            let mut plaintext = crypto.decrypt_value(&ciphertext)?;
            let mut existing = SecretValue::from_yaml_str(secret_type, plaintext.as_str())?;
            plaintext.zeroize_plaintext();
            let mut enriched = nook_core::enrich_secret(&existing, &value);
            let outcome = if enriched == existing {
                ImportItemOutcome::Duplicate
            } else {
                let mut yaml = enriched.to_yaml()?;
                let ciphertext = crypto.encrypt_value(yaml.as_str())?;
                yaml.zeroize_plaintext();
                let new_id = nook_core::generate_secret_id()?;
                ImportItemOutcome::Operation(VaultOperation::SecretReplaced {
                    old_id: record.key.clone(),
                    new_secret: nook_core::encrypted_secret_from_armored(
                        &new_id,
                        secret_type,
                        ciphertext.as_str(),
                        identity_fingerprint,
                        fingerprint,
                    ),
                })
            };
            existing.zeroize_plaintext();
            enriched.zeroize_plaintext();
            value.zeroize_plaintext();
            return Ok(outcome);
        }
        if !seen_versions.insert(fingerprint.clone()) {
            value.zeroize_plaintext();
            return Ok(ImportItemOutcome::Duplicate);
        }
        let mut yaml = value.to_yaml()?;
        let secret_type = value.secret_type();
        let ciphertext = crypto.encrypt_value(yaml.as_str())?;
        yaml.zeroize_plaintext();
        value.zeroize_plaintext();
        let id = nook_core::generate_secret_id()?;
        Ok(ImportItemOutcome::Operation(
            VaultOperation::SecretCreated {
                secret: nook_core::encrypted_secret_from_armored(
                    &id,
                    secret_type,
                    ciphertext.as_str(),
                    identity_fingerprint,
                    fingerprint,
                ),
            },
        ))
    }

    fn prepare(
        self,
        dedup_state: Vec<(
            nook_core::StoredSecretRecord,
            nook_core::SecretFingerprint,
            nook_core::SecretFingerprint,
        )>,
        crypto: &nook_core::VaultCrypto,
    ) -> Result<PreparedSecretImport, NookError> {
        let existing_by_identity = Self::group_import_fingerprints(dedup_state, self.items.len());
        let mut seen_versions = existing_by_identity
            .values()
            .flatten()
            .map(|(_, fingerprint)| fingerprint.clone())
            .collect::<HashSet<_>>();
        let mut skipped_duplicates = self.duplicates;
        let mut operations = Vec::with_capacity(self.items.len());

        for value in self.items {
            match Self::reconcile_import_item(
                value,
                &existing_by_identity,
                &mut seen_versions,
                crypto,
                self.secrets_key,
            )? {
                ImportItemOutcome::Duplicate => skipped_duplicates += 1,
                ImportItemOutcome::Operation(operation) => operations.push(operation),
            }
        }

        Ok(PreparedSecretImport {
            operations,
            skipped_duplicates,
        })
    }
}

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
        skipped_unsupported: usize,
        source: SecretImportSource,
    ) -> Result<NookImportResult, JsError> {
        let _ = self.status.tx.send(source.status().to_owned());
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
        let prepared = coalesced.prepare(dedup_state, crypto)?;
        prepared.commit(self, source, skipped_unsupported).await
    }
}

impl PreparedSecretImport {
    async fn commit(
        self,
        manager: &mut NookVaultManager,
        source: SecretImportSource,
        skipped_unsupported: usize,
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
        let _ = manager.status.tx.send("READY".to_owned());
        tracing::info!(
            scope = "wasm-secrets",
            action = source.action(),
            import_source = source.label(),
            imported,
            skipped_unsupported,
            skipped_duplicates,
            "Secret import completed"
        );
        Ok(NookImportResult::new(
            imported,
            skipped_unsupported,
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
        let plan = nook_core::plan_bitwarden_import_with_password(
            json.as_str(),
            (!password.is_empty()).then_some(password.as_str()),
        )
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
        let plan = nook_core::plan_keepassxc_import(csv.as_str())
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
        let plan = nook_core::plan_lastpass_import(csv.as_str())
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
        let plan = nook_core::plan_keeper_import(csv.as_str())
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
        let plan = nook_core::plan_onepassword_import(archive.as_slice())
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
        let plan = nook_core::plan_apple_passwords_export(export.as_slice())
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
        let plan = nook_core::plan_chrome_passwords_import(csv.as_str())
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
        let plan = nook_core::plan_dashlane_import(export.as_slice())
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
        let plan = nook_core::plan_google_authenticator_import(migration_uris.as_slice())
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
        let plan = nook_core::plan_proton_pass_import(export.as_slice())
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
#[allow(clippy::items_after_test_module)]
mod import_tests {
    use super::*;
    use nook_core::{
        SecretFingerprint, SecureNoteSecret, StoredRecordPayload, StoredSecretRecord, VaultCrypto,
    };

    struct ImportFixture {
        key: SymmetricKey,
        crypto: VaultCrypto,
        record: StoredSecretRecord,
        identity: SecretFingerprint,
        version: SecretFingerprint,
    }

    impl ImportFixture {
        fn value(note: &str) -> SecretValue {
            SecretValue::SecureNote(SecureNoteSecret {
                title: "Recovery".to_owned(),
                note: note.to_owned(),
            })
        }

        fn new() -> anyhow::Result<Self> {
            let key = SymmetricKey::parse(&"ab".repeat(32))?;
            let crypto = VaultCrypto::new(&key)?;
            let mut value = Self::value("same note\n\n## LastPass\n- group: Personal");
            let identity = nook_core::secret_identity_fingerprint(&value, &key)?;
            let version = nook_core::secret_fingerprint(&value, &key)?;
            let mut yaml = value.to_yaml()?;
            let encrypted = crypto.encrypt_value(yaml.as_str())?;
            yaml.zeroize_plaintext();
            let record = StoredSecretRecord {
                key: nook_core::generate_secret_id()?,
                secret_type: Some(value.secret_type()),
                value: StoredRecordPayload::from_age_armored(encrypted),
            };
            value.zeroize_plaintext();
            Ok(Self {
                key,
                crypto,
                record,
                identity,
                version,
            })
        }

        fn prepare(&self, note: &str) -> Result<PreparedSecretImport, NookError> {
            CoalescedSecretImport::new(vec![Self::value(note)], &self.key)?.prepare(
                vec![(
                    self.record.clone(),
                    self.identity.clone(),
                    self.version.clone(),
                )],
                &self.crypto,
            )
        }
    }

    #[test]
    fn exact_existing_duplicate_prepares_no_operations() -> anyhow::Result<()> {
        let fixture = ImportFixture::new()?;
        let prepared = fixture.prepare("same note\n\n## LastPass\n- group: Personal")?;
        assert_eq!(prepared.skipped_duplicates, 1);
        assert!(prepared.operations.is_empty());
        Ok(())
    }

    #[test]
    fn metadata_enrichment_prepares_an_encrypted_replacement() -> anyhow::Result<()> {
        let fixture = ImportFixture::new()?;
        let prepared = fixture.prepare("same note\n\n## Proton Pass\n- vault: Personal")?;
        assert_eq!(prepared.skipped_duplicates, 0);
        let [VaultOperation::SecretReplaced { old_id, new_secret }] =
            prepared.operations.as_slice()
        else {
            anyhow::bail!("Expected exactly one replacement");
        };
        assert_eq!(old_id, &fixture.record.key);
        assert_ne!(old_id, &new_secret.id);
        let ciphertext = AgeArmoredCiphertext::parse(new_secret.ciphertext.as_str())?;
        let mut plaintext = fixture.crypto.decrypt_value(&ciphertext)?;
        let mut value = SecretValue::from_yaml_str(new_secret.secret_type, plaintext.as_str())?;
        plaintext.zeroize_plaintext();
        let SecretValue::SecureNote(note) = &value else {
            anyhow::bail!("Replacement changed secret type");
        };
        assert!(note.note.contains("## LastPass"));
        assert!(note.note.contains("## Proton Pass"));
        value.zeroize_plaintext();
        Ok(())
    }

    #[test]
    fn malformed_existing_record_rejects_preparation() -> anyhow::Result<()> {
        let mut fixture = ImportFixture::new()?;
        fixture.record.secret_type = None;
        let original = fixture.record.clone();
        match fixture.prepare("same note\n\n## LastPass\n- group: Personal") {
            Err(NookError::Database(message)) => {
                assert_eq!(
                    message,
                    format!("Secret {} is missing its type.", original.key)
                );
            }
            Err(error) => return Err(error.into()),
            Ok(_) => anyhow::bail!("Malformed existing record produced a prepared import"),
        }
        assert_eq!(fixture.record, original);
        Ok(())
    }

    #[test]
    fn same_batch_provider_notes_are_coalesced_without_losing_metadata() -> anyhow::Result<()> {
        let items = vec![
            SecretValue::SecureNote(nook_core::SecureNoteSecret {
                title: "Recovery".to_owned(),
                note: "same note\n\n## LastPass\n- group: Personal".to_owned(),
            }),
            SecretValue::SecureNote(nook_core::SecureNoteSecret {
                title: "Recovery".to_owned(),
                note: "same note\n\n## Proton Pass\n- vault: Personal".to_owned(),
            }),
        ];

        let key = SymmetricKey::parse(&"ab".repeat(32))?;
        let CoalescedSecretImport {
            items, duplicates, ..
        } = CoalescedSecretImport::new(items, &key)?;
        assert_eq!(duplicates, 1);
        assert_eq!(items.len(), 1);
        let SecretValue::SecureNote(note) = &items[0] else {
            return Err(anyhow::anyhow!(
                "coalesced import item must be a secure note"
            ));
        };
        assert!(note.note.contains("## LastPass"));
        assert!(note.note.contains("## Proton Pass"));
        Ok(())
    }
}

#[cfg(test)]
mod prepared_page_tests {
    use super::*;
    use crate::NookSecretTypeFilter;
    use crate::manager::VaultCryptoState;
    use nook_core::DeviceIdentity;
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    #[expect(
        unowned_function,
        reason = "framework boundary: wasm-bindgen-test browser test entrypoint"
    )]
    async fn default_page_restores_crypto_from_the_cached_projection() -> Result<(), JsError> {
        let identity = DeviceIdentity::generate()?;
        let mut manager = NookVaultManager::new();
        manager.device.identity_private_key = identity.secret_string().into_inner();
        manager.initialize_genesis_vault(&identity)?;
        manager.vault.store_id = nook_core::generate_store_id()
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

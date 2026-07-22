//! Secret CRUD + small utility methods (search, password / id generation,
//! status-channel poll).

use super::NookVaultManager;
use crate::NookError;
use crate::NookImportResult;
use crate::{NookSecretPage, NookSecretRecord, NookTotpCode};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use wasm_bindgen::JsCast;
use wasm_bindgen::JsError;
use wasm_bindgen::prelude::wasm_bindgen;

fn serialize_js_array<T: Serialize>(value: &T) -> Result<js_sys::Array, serde_wasm_bindgen::Error> {
    Ok(value
        .serialize(&serde_wasm_bindgen::Serializer::new().serialize_maps_as_objects(true))?
        .unchecked_into())
}

#[wasm_bindgen]
pub struct NookEventLogStorageRecord(super::event_log::EventLogStorageRecord);

#[wasm_bindgen]
pub struct NookEventLogRecords(Vec<super::event_log::EventLogStorageRecord>);

#[wasm_bindgen]
impl NookEventLogRecords {
    #[wasm_bindgen(js_name = toArray)]
    pub fn to_array(&self) -> Result<js_sys::Array, JsError> {
        serialize_js_array(&self.0).map_err(|error| JsError::new(&error.to_string()))
    }
}

#[wasm_bindgen]
pub struct NookExternalEventLogRecords(Vec<super::event_log::ExternalEventLogRecord>);

#[wasm_bindgen]
impl NookExternalEventLogRecords {
    #[wasm_bindgen(js_name = fromArray)]
    pub fn from_array(records: &js_sys::Array) -> Result<Self, JsError> {
        let records = records
            .iter()
            .map(serde_wasm_bindgen::from_value)
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Self(records))
    }
}

#[wasm_bindgen]
pub struct NookExtensionEventLogImportStatus(super::event_log::ExtensionEventLogImportStatus);

#[wasm_bindgen]
impl NookExtensionEventLogImportStatus {
    #[wasm_bindgen(js_name = toObject)]
    pub fn to_object(&self) -> Result<js_sys::Object, JsError> {
        Ok(serde_wasm_bindgen::to_value(&self.0)?.unchecked_into())
    }
}

type ImportVersions = HashMap<
    nook_core::SecretFingerprint,
    Vec<(nook_core::StoredSecretRecord, nook_core::SecretFingerprint)>,
>;
type ImportFingerprintState = (ImportVersions, Vec<nook_core::SecretFingerprintAssignment>);

fn has_current_import_fingerprints(
    identity_fingerprint: Option<&nook_core::SecretFingerprint>,
    fingerprint: Option<&nook_core::SecretFingerprint>,
) -> bool {
    identity_fingerprint.is_some()
        && fingerprint.is_some_and(nook_core::SecretFingerprint::is_current_secret_version)
}

fn import_fingerprints(
    dedup_state: Vec<(
        nook_core::StoredSecretRecord,
        Option<nook_core::SecretFingerprint>,
        Option<nook_core::SecretFingerprint>,
    )>,
    crypto: &nook_core::VaultCrypto,
    secrets_key: &nook_core::SymmetricKey,
    incoming_count: usize,
) -> Result<ImportFingerprintState, NookError> {
    let mut by_identity = HashMap::with_capacity(dedup_state.len() + incoming_count);
    let mut backfill = Vec::new();
    for (record, identity_fingerprint, fingerprint) in dedup_state {
        let (identity_fingerprint, fingerprint) =
            if has_current_import_fingerprints(identity_fingerprint.as_ref(), fingerprint.as_ref())
            {
                (
                    identity_fingerprint.expect("checked above"),
                    fingerprint.expect("checked above"),
                )
            } else {
                let secret_type = record.secret_type.ok_or_else(|| {
                    NookError::Database(format!("Secret {} is missing its type.", record.key))
                })?;
                let ciphertext = nook_core::AgeArmoredCiphertext::parse(record.value.as_str())?;
                let mut plaintext = crypto.decrypt_value(&ciphertext)?;
                let mut value =
                    nook_core::SecretValue::from_yaml_str(secret_type, plaintext.as_str())?;
                plaintext.zeroize_plaintext();
                let identity_fingerprint =
                    nook_core::secret_identity_fingerprint(&value, secrets_key);
                let fingerprint = nook_core::secret_fingerprint(&value, secrets_key);
                backfill.push(nook_core::SecretFingerprintAssignment {
                    secret_id: record.key.clone(),
                    identity_fingerprint: identity_fingerprint.clone(),
                    fingerprint: fingerprint.clone(),
                });
                value.zeroize_plaintext();
                (identity_fingerprint, fingerprint)
            };
        by_identity
            .entry(identity_fingerprint)
            .or_insert_with(Vec::new)
            .push((record, fingerprint));
    }
    Ok((by_identity, backfill))
}

enum ImportItemOutcome {
    Duplicate,
    Operation(nook_core::VaultOperation),
}

fn coalesce_import_items(
    items: Vec<nook_core::SecretValue>,
    secrets_key: &nook_core::SymmetricKey,
) -> (Vec<nook_core::SecretValue>, usize) {
    let mut coalesced: Vec<nook_core::SecretValue> = Vec::with_capacity(items.len());
    let mut indexes: HashMap<nook_core::SecretFingerprint, usize> =
        HashMap::with_capacity(items.len());
    let mut duplicates = 0;
    for mut value in items {
        let fingerprint = nook_core::secret_fingerprint(&value, secrets_key);
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
    (coalesced, duplicates)
}

fn reconcile_import_item(
    mut value: nook_core::SecretValue,
    existing_by_identity: &ImportVersions,
    seen_versions: &mut HashSet<nook_core::SecretFingerprint>,
    crypto: &nook_core::VaultCrypto,
    secrets_key: &nook_core::SymmetricKey,
) -> Result<ImportItemOutcome, NookError> {
    let identity_fingerprint = nook_core::secret_identity_fingerprint(&value, secrets_key);
    let fingerprint = nook_core::secret_fingerprint(&value, secrets_key);
    if let Some((record, _)) = existing_by_identity
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
        let ciphertext = nook_core::AgeArmoredCiphertext::parse(record.value.as_str())?;
        let mut plaintext = crypto.decrypt_value(&ciphertext)?;
        let mut existing = nook_core::SecretValue::from_yaml_str(secret_type, plaintext.as_str())?;
        plaintext.zeroize_plaintext();
        let mut enriched = nook_core::enrich_secret(&existing, &value);
        let outcome = if enriched == existing {
            ImportItemOutcome::Duplicate
        } else {
            let mut yaml = enriched.to_yaml()?;
            let ciphertext = crypto.encrypt_value(yaml.as_str())?;
            yaml.zeroize_plaintext();
            let new_id = nook_core::generate_secret_id()?;
            ImportItemOutcome::Operation(nook_core::VaultOperation::SecretReplaced {
                old_id: record.key.clone(),
                new_secret: nook_core::encrypted_secret_from_armored(
                    &new_id,
                    secret_type,
                    ciphertext.as_str(),
                    Some(identity_fingerprint),
                    Some(fingerprint),
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
        nook_core::VaultOperation::SecretCreated {
            secret: nook_core::encrypted_secret_from_armored(
                &id,
                secret_type,
                ciphertext.as_str(),
                Some(identity_fingerprint),
                Some(fingerprint),
            ),
        },
    ))
}

#[derive(Clone, Copy)]
enum SecretImportSource {
    ApplePasswords,
    Bitwarden,
    ChromePasswords,
    GoogleAuthenticator,
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
            Self::GoogleAuthenticator => "IMPORT_GOOGLE_AUTHENTICATOR_START",
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
            Self::GoogleAuthenticator => "import-google-authenticator",
            Self::LastPass => "import-lastpass",
            Self::OnePassword => "import-onepassword",
            Self::ProtonPass => "import-proton-pass",
        }
    }

    const fn label(self) -> &'static str {
        match self {
            Self::ApplePasswords => "Apple Passwords",
            Self::Bitwarden => "Bitwarden",
            Self::ChromePasswords => "Chrome passwords",
            Self::GoogleAuthenticator => "Google Authenticator",
            Self::LastPass => "LastPass",
            Self::OnePassword => "1Password",
            Self::ProtonPass => "Proton Pass",
        }
    }
}

impl NookVaultManager {
    async fn commit_secret_import(
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

        let secrets_key = nook_core::SymmetricKey::parse(&self.vault.secrets_key)?;
        let (items, within_batch_duplicates) = coalesce_import_items(items, &secrets_key);
        let dedup_state = self.live_secret_dedup_state().await?;
        let crypto = self
            .vault
            .crypto
            .as_ref()
            .ok_or_else(|| NookError::Encryption("Vault crypto not initialized.".to_owned()))?;
        let (existing_by_identity, backfill) =
            import_fingerprints(dedup_state, crypto, &secrets_key, items.len())?;
        let mut seen_versions = existing_by_identity
            .values()
            .flatten()
            .map(|(_, fingerprint)| fingerprint.clone())
            .collect::<HashSet<_>>();
        let mut skipped_duplicates = within_batch_duplicates;
        let mut operations = Vec::with_capacity(items.len() + usize::from(!backfill.is_empty()));
        if !backfill.is_empty() {
            operations.push(nook_core::VaultOperation::SecretFingerprintsBackfilled {
                fingerprints: backfill,
            });
        }

        for value in items {
            match reconcile_import_item(
                value,
                &existing_by_identity,
                &mut seen_versions,
                crypto,
                &secrets_key,
            )? {
                ImportItemOutcome::Duplicate => skipped_duplicates += 1,
                ImportItemOutcome::Operation(operation) => operations.push(operation),
            }
        }

        let imported = operations
            .iter()
            .filter(|operation| {
                matches!(
                    operation,
                    nook_core::VaultOperation::SecretCreated { .. }
                        | nook_core::VaultOperation::SecretReplaced { .. }
                )
            })
            .count();
        if !operations.is_empty() {
            self.append_vault_operations(operations).await?;
        }
        let _ = self.status.tx.send("READY".to_owned());
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

#[cfg(test)]
mod import_tests {
    use super::*;

    fn key() -> nook_core::SymmetricKey {
        nook_core::SymmetricKey::parse(&"ab".repeat(32)).unwrap()
    }

    #[test]
    fn same_batch_provider_notes_are_coalesced_without_losing_metadata() {
        let items = vec![
            nook_core::SecretValue::SecureNote(nook_core::SecureNoteSecret {
                title: "Recovery".to_owned(),
                note: "same note\n\n## LastPass\n- group: Personal".to_owned(),
            }),
            nook_core::SecretValue::SecureNote(nook_core::SecureNoteSecret {
                title: "Recovery".to_owned(),
                note: "same note\n\n## Proton Pass\n- vault: Personal".to_owned(),
            }),
        ];

        let (items, duplicates) = coalesce_import_items(items, &key());
        assert_eq!(duplicates, 1);
        assert_eq!(items.len(), 1);
        let nook_core::SecretValue::SecureNote(note) = &items[0] else {
            panic!("expected secure note")
        };
        assert!(note.note.contains("## LastPass"));
        assert!(note.note.contains("## Proton Pass"));
    }

    #[test]
    fn legacy_version_fingerprints_require_import_backfill() {
        let identity = Some(nook_core::SecretFingerprint::from_trusted(format!(
            "hmac-sha256:v1:{}",
            "ab".repeat(32)
        )));
        let legacy = Some(nook_core::SecretFingerprint::from_trusted(format!(
            "hmac-sha256:v1:{}",
            "cd".repeat(32)
        )));
        assert!(!has_current_import_fingerprints(
            identity.as_ref(),
            legacy.as_ref()
        ));

        let value = nook_core::SecretValue::SecureNote(nook_core::SecureNoteSecret {
            title: "Recovery".to_owned(),
            note: "same note".to_owned(),
        });
        let current = Some(nook_core::secret_fingerprint(&value, &key()));
        assert!(has_current_import_fingerprints(
            identity.as_ref(),
            current.as_ref()
        ));
    }
}

#[wasm_bindgen]
impl NookVaultManager {
    pub fn filter_secrets(&self, query: &str) -> Result<Vec<NookSecretRecord>, JsError> {
        let mut records = self.get_records()?;
        records.retain(|record| record.matches_search(query));
        Ok(records)
    }

    #[wasm_bindgen(js_name = prepareSecretSearch)]
    pub async fn prepare_secret_search_js(&mut self) -> Result<(), JsError> {
        self.prepare_secret_search_catalog()
            .await
            .map_err(Into::into)
    }

    #[allow(clippy::needless_pass_by_value)]
    #[wasm_bindgen(js_name = querySecretPage)]
    pub fn query_secret_page_js(
        &self,
        query: &str,
        secret_type_filter: Option<String>,
        offset: u32,
        limit: u32,
    ) -> Result<NookSecretPage, JsError> {
        let secret_type_filter = secret_type_filter
            .as_deref()
            .map(nook_core::SecretType::parse)
            .transpose()?;
        Ok(NookSecretPage::from_core(self.query_secret_page(
            query,
            secret_type_filter,
            offset,
            limit,
        )?)?)
    }

    /// Decrypt one full record only after an explicit reveal or secret-value copy.
    #[wasm_bindgen(js_name = decryptSecret)]
    pub fn decrypt_secret_js(&self, id: &str) -> Result<NookSecretRecord, JsError> {
        let crypto = self
            .vault
            .crypto
            .as_ref()
            .ok_or_else(|| NookError::Encryption("Vault crypto not initialized.".to_owned()))?;
        let id = nook_core::SecretId::from_vault_record(id);
        let record = nook_core::decrypt_encrypted_secret(&self.vault.meta.secrets, crypto, &id)?;
        tracing::info!(
            scope = "wasm-secrets",
            action = "decrypt-secret",
            secret_id = %id,
            "secret plaintext exposed on demand"
        );
        Ok(NookSecretRecord::from_record(record))
    }

    #[wasm_bindgen(js_name = currentAuthenticatorCode)]
    pub fn current_authenticator_code(
        &self,
        id: &str,
        unix_seconds: u32,
    ) -> Result<NookTotpCode, JsError> {
        let crypto = self
            .vault
            .crypto
            .as_ref()
            .ok_or_else(|| NookError::Encryption("Vault crypto not initialized.".to_owned()))?;
        let id = nook_core::SecretId::from_vault_record(id);
        let mut record =
            nook_core::decrypt_encrypted_secret(&self.vault.meta.secrets, crypto, &id)?;
        let code = if let nook_core::SecretValue::Authenticator(value) = &record.data {
            value.current_code(u64::from(unix_seconds))?
        } else {
            record.zeroize_plaintext();
            return Err(NookError::Database(
                "Requested secret is not an authenticator item.".to_owned(),
            )
            .into());
        };
        record.zeroize_plaintext();
        Ok(NookTotpCode::from_core(code))
    }

    /// Prefixed secret item id (`secret_{token}`).
    pub fn generate_secret_id(&self) -> Result<String, JsError> {
        Ok(nook_core::generate_secret_id()?.to_string())
    }

    /// Compact random token (11 chars, base64url) without a type prefix.
    pub fn generate_id(&self) -> Result<String, JsError> {
        Ok(nook_core::generate_id()?.to_string())
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
    #[wasm_bindgen(js_name = drainStatusLog)]
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
        secret_type: String,
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
        let id = nook_core::validate_secret_id(&id)?;
        nook_core::validate_secret_data(&data)?;
        let secret_type = nook_core::SecretType::parse(&secret_type)?;
        let secrets_key = nook_core::SymmetricKey::parse(&self.vault.secrets_key)?;
        let mut typed_value = nook_core::SecretValue::from_yaml_str(secret_type, &data)?;
        let identity_fingerprint =
            nook_core::secret_identity_fingerprint(&typed_value, &secrets_key);
        let fingerprint = nook_core::secret_fingerprint(&typed_value, &secrets_key);
        typed_value.zeroize_plaintext();

        let armored = self
            .vault
            .crypto
            .as_ref()
            .ok_or_else(|| NookError::Encryption("Vault crypto not initialized.".to_owned()))?
            .encrypt_value(&data)?;
        let ciphertext = armored.as_str().to_owned();
        self.vault.meta.secrets.insert(
            id.clone(),
            (
                secret_type,
                nook_core::StoredRecordPayload::from_trusted(ciphertext.clone()),
            ),
        );
        self.vault.mark_search_catalog_dirty();

        self.append_vault_operations(vec![nook_core::VaultOperation::SecretCreated {
            secret: nook_core::encrypted_secret_from_armored(
                &id,
                secret_type,
                &ciphertext,
                Some(identity_fingerprint),
                Some(fingerprint),
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

    /// Import supported entries from a plaintext or password-protected encrypted
    /// Bitwarden JSON export in one signed event. Exact values already present in
    /// the active vault are not imported again.
    #[wasm_bindgen(js_name = importBitwardenJson)]
    pub async fn import_bitwarden_json(
        &mut self,
        json: String,
        password: String,
    ) -> Result<NookImportResult, JsError> {
        let json = zeroize::Zeroizing::new(json);
        let password = zeroize::Zeroizing::new(password);
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

    /// Import logins and secure notes from a plaintext `LastPass` generic CSV
    /// export in one signed event. The CSV is parsed in memory and never
    /// persisted.
    #[wasm_bindgen(js_name = importLastPassCsv)]
    pub async fn import_lastpass_csv(&mut self, csv: String) -> Result<NookImportResult, JsError> {
        let csv = zeroize::Zeroizing::new(csv);
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

    /// Import supported entries from an unencrypted 1Password 1PUX archive in
    /// one signed event. The archive is parsed in memory and never persisted.
    #[wasm_bindgen(js_name = importOnePasswordPux)]
    pub async fn import_onepassword_pux(
        &mut self,
        archive: Vec<u8>,
    ) -> Result<NookImportResult, JsError> {
        let archive = zeroize::Zeroizing::new(archive);
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

    /// Import passwords and verification codes from an Apple Passwords CSV
    /// export in one signed event. The plaintext CSV is parsed only in memory.
    #[wasm_bindgen(js_name = importApplePasswordsCsv)]
    pub async fn import_apple_passwords_csv(
        &mut self,
        csv: String,
    ) -> Result<NookImportResult, JsError> {
        let csv = zeroize::Zeroizing::new(csv);
        let plan = nook_core::plan_apple_passwords_import(csv.as_str())
            .map_err(|error| NookError::Database(error.to_string()))?;
        drop(csv);
        self.commit_secret_import(
            plan.items,
            plan.skipped_unsupported,
            SecretImportSource::ApplePasswords,
        )
        .await
    }

    /// Import logins from a Chrome-family CSV export in one signed event. The
    /// plaintext CSV is parsed only in memory.
    #[wasm_bindgen(js_name = importChromePasswordsCsv)]
    pub async fn import_chrome_passwords_csv(
        &mut self,
        csv: String,
    ) -> Result<NookImportResult, JsError> {
        let csv = zeroize::Zeroizing::new(csv);
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

    /// Import TOTP accounts from one complete Google Authenticator migration
    /// QR batch in one signed event. QR contents are decoded only in memory.
    #[wasm_bindgen(js_name = importGoogleAuthenticatorMigration)]
    pub async fn import_google_authenticator_migration(
        &mut self,
        migration_uris: Vec<String>,
    ) -> Result<NookImportResult, JsError> {
        let migration_uris = zeroize::Zeroizing::new(migration_uris);
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
    #[wasm_bindgen(js_name = importProtonPass)]
    pub async fn import_proton_pass(
        &mut self,
        export: Vec<u8>,
    ) -> Result<NookImportResult, JsError> {
        let export = zeroize::Zeroizing::new(export);
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

    // Replace a secret (new id + payload, single save)
    pub async fn replace_secret(
        &mut self,
        old_id: String,
        new_id: String,
        secret_type: String,
        data: String,
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
        let secret_type = nook_core::SecretType::parse(&secret_type)?;
        let secrets_key = nook_core::SymmetricKey::parse(&self.vault.secrets_key)?;
        let mut typed_value = nook_core::SecretValue::from_yaml_str(secret_type, &data)?;
        let identity_fingerprint =
            nook_core::secret_identity_fingerprint(&typed_value, &secrets_key);
        let fingerprint = nook_core::secret_fingerprint(&typed_value, &secrets_key);
        typed_value.zeroize_plaintext();
        let crypto = self
            .vault
            .crypto
            .as_ref()
            .ok_or_else(|| NookError::Encryption("Vault crypto not initialized.".to_owned()))?;
        nook_core::replace_encrypted_secret(
            &mut self.vault.meta,
            crypto,
            &nook_core::ReplaceSecretInput {
                old_id: &old_id,
                new_id: &new_id,
                secret_type,
                data_yaml: &data,
            },
        )?;
        self.vault.mark_search_catalog_dirty();
        let validated_new = nook_core::validate_secret_id(&new_id)?;
        let validated_old = nook_core::validate_secret_id(&old_id)?;
        let ciphertext = self
            .vault
            .meta
            .secrets
            .get(&validated_new)
            .map(|(_, payload)| payload.as_str().to_owned())
            .unwrap_or_default();
        self.append_vault_operations(vec![nook_core::VaultOperation::SecretReplaced {
            old_id: validated_old,
            new_secret: nook_core::encrypted_secret_from_armored(
                &validated_new,
                secret_type,
                &ciphertext,
                Some(identity_fingerprint),
                Some(fingerprint),
            ),
        }])
        .await?;
        let _ = self.status.tx.send("READY".to_owned());
        Ok(self.get_records()?)
    }

    #[wasm_bindgen(js_name = mergeRemoteJoinsFromProvider)]
    pub async fn merge_remote_joins_from_provider(
        &mut self,
        storage_mode: String,
        github_pat: String,
        github_repo: String,
    ) -> Result<Vec<crate::NookJoinRequest>, JsError> {
        let restore_local = self.storage.mode == nook_core::StorageMode::Local;
        self.prepare_storage_preserving_vault_metadata(&storage_mode, &github_pat, &github_repo)
            .await?;
        self.sync_events_from_current_provider().await?;
        if restore_local {
            self.prepare_storage_preserving_vault_metadata("local", "", "")
                .await?;
        }
        Ok(self.pending_joins()?)
    }

    #[wasm_bindgen(js_name = flushEventOutboxForProvider)]
    pub async fn flush_event_outbox_for_provider(
        &mut self,
        storage_mode: String,
        github_pat: String,
        github_repo: String,
    ) -> Result<(), JsError> {
        let restore_local = self.storage.mode == nook_core::StorageMode::Local;
        self.prepare_storage_preserving_vault_metadata(&storage_mode, &github_pat, &github_repo)
            .await?;
        self.flush_event_outbox().await?;
        if restore_local {
            self.prepare_storage_preserving_vault_metadata("local", "", "")
                .await?;
        }
        Ok(())
    }

    #[wasm_bindgen(js_name = syncEventLogForProvider)]
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

    #[wasm_bindgen(js_name = exportEventLogRecords)]
    pub async fn export_event_log_records_js(&self) -> Result<NookEventLogRecords, JsError> {
        let records = self.export_event_log_records().await?;
        Ok(NookEventLogRecords(records))
    }

    #[wasm_bindgen(js_name = parseEventLogStorageRecord)]
    pub fn parse_event_log_storage_record_js(
        &self,
        event_id: &str,
        path: &str,
        content: &str,
    ) -> Result<NookEventLogStorageRecord, JsError> {
        let record = Self::parse_event_log_storage_record(event_id, path, content)?;
        Ok(NookEventLogStorageRecord(record))
    }

    #[wasm_bindgen(js_name = serializeEventLogStorageRecord)]
    pub fn serialize_event_log_storage_record_js(
        &self,
        record: &NookEventLogStorageRecord,
    ) -> Result<String, JsError> {
        Ok(Self::serialize_event_log_storage_record(&record.0)?)
    }

    #[wasm_bindgen(js_name = syncExternalEventLogRecords)]
    pub async fn sync_external_event_log_records_js(
        &mut self,
        records: NookExternalEventLogRecords,
    ) -> Result<NookEventLogRecords, JsError> {
        let merged = self.sync_external_event_log_records(records.0).await?;
        Ok(NookEventLogRecords(merged))
    }

    #[wasm_bindgen(js_name = importExtensionEventLogRecords)]
    pub async fn import_extension_event_log_records_js(
        &mut self,
        expected_store_id: &str,
        expected_device_id: &str,
        expected_device_public_key: &str,
        expected_device_signing_public_key: &str,
        records: NookExternalEventLogRecords,
    ) -> Result<NookExtensionEventLogImportStatus, JsError> {
        let status = self
            .import_extension_event_log_records(
                expected_store_id,
                expected_device_id,
                expected_device_public_key,
                expected_device_signing_public_key,
                records.0,
            )
            .await?;
        Ok(NookExtensionEventLogImportStatus(status))
    }

    #[wasm_bindgen(js_name = syncLocalFolderProvider)]
    pub async fn sync_local_folder_provider_js(
        &mut self,
        handle_id: &str,
    ) -> Result<String, JsError> {
        self.sync_local_folder_provider(handle_id)
            .await
            .map_err(Into::into)
    }

    #[wasm_bindgen(js_name = eventLogMode)]
    pub fn event_log_mode(&self) -> bool {
        self.event_log.enabled
    }

    #[wasm_bindgen(js_name = listProjectionConflicts)]
    pub async fn list_projection_conflicts(
        &self,
    ) -> Result<Vec<crate::NookReplacementConflict>, JsError> {
        let projection = self.load_projection_conflicts().await?;
        crate::types::replacement_conflicts_to_vec(projection.replacement_conflicts)
            .map_err(Into::into)
    }

    #[wasm_bindgen(js_name = listProjectionSecurityConflicts)]
    pub async fn list_projection_security_conflicts(
        &self,
    ) -> Result<Vec<crate::NookSecurityConflict>, JsError> {
        let projection = self.load_projection_conflicts().await?;
        crate::types::security_conflicts_to_vec(projection.security_conflicts).map_err(Into::into)
    }

    // Delete a secret
    pub async fn delete_secret(&mut self, id: String) -> Result<Vec<NookSecretRecord>, JsError> {
        let _ = self.status.tx.send("DELETE_SECRET_START".to_owned());
        self.ensure_vault_crypto_from_cache().await?;
        let id = nook_core::validate_secret_id(&id)?;
        self.vault.meta.secrets.remove(&id);
        self.vault.mark_search_catalog_dirty();
        self.append_vault_operations(vec![nook_core::VaultOperation::SecretDeleted {
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

    #[wasm_bindgen(js_name = resolveProjectionConflict)]
    pub async fn resolve_projection_conflict(
        &mut self,
        old_secret_id: String,
        chosen_secret_id: String,
    ) -> Result<Vec<NookSecretRecord>, JsError> {
        let old_id = nook_core::validate_secret_id(&old_secret_id)?;
        let chosen_id = nook_core::validate_secret_id(&chosen_secret_id)?;
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
        self.append_vault_operations(vec![nook_core::VaultOperation::SecretConflictResolved {
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
    use super::*;
    use wasm_bindgen_test::*;

    #[derive(Serialize)]
    struct SignedEventBody {
        schema_version: u32,
    }

    #[derive(Serialize)]
    struct SignedEvent {
        #[serde(flatten)]
        body: SignedEventBody,
        signature: String,
    }

    #[derive(Serialize)]
    struct ExportedRecord {
        event_id: String,
        event: SignedEvent,
    }

    fn get(target: &js_sys::Object, field: &str) -> js_sys::Object {
        js_sys::Reflect::get(target, &js_sys::JsString::from(field))
            .expect("js field")
            .unchecked_into()
    }

    fn get_number(target: &js_sys::Object, field: &str) -> f64 {
        js_sys::Reflect::get(target, &js_sys::JsString::from(field))
            .expect("js field")
            .as_f64()
            .expect("js number")
    }

    fn get_string(target: &js_sys::Object, field: &str) -> String {
        js_sys::Reflect::get(target, &js_sys::JsString::from(field))
            .expect("js field")
            .as_string()
            .expect("js string")
    }

    #[wasm_bindgen_test]
    fn canonical_authenticator_fingerprints_replace_stored_legacy_values() {
        let secrets_key = nook_core::SymmetricKey::parse(&"a".repeat(64)).unwrap();
        let crypto = nook_core::VaultCrypto::new(&secrets_key).unwrap();
        let padded_yaml = concat!(
            "issuer: Example\n",
            "account: alice@example.com\n",
            "secret: JBSWY3DPEHPK3PXP====\n",
            "algorithm: SHA1\n",
            "digits: 6\n",
            "period: 30\n",
            "backupCodes: []\n"
        );
        let ciphertext = crypto.encrypt_value(padded_yaml).unwrap();
        let record = nook_core::StoredSecretRecord {
            key: nook_core::SecretId::from_vault_record("secret_authenticator"),
            secret_type: Some(nook_core::SecretType::Authenticator),
            value: nook_core::StoredRecordPayload::from_age_armored(ciphertext),
        };
        let legacy_identity = nook_core::SecretFingerprint::from_trusted("legacy-id".to_owned());
        let legacy_version =
            nook_core::SecretFingerprint::from_trusted("legacy-version".to_owned());

        let (by_identity, backfill) = import_fingerprints(
            vec![(record.clone(), Some(legacy_identity), Some(legacy_version))],
            &crypto,
            &secrets_key,
            1,
        )
        .unwrap();

        assert_eq!(backfill.len(), 1);
        let assignment = &backfill[0];
        let records = by_identity
            .get(&assignment.identity_fingerprint)
            .expect("canonical identity");
        assert_eq!(records[0].1, assignment.fingerprint);

        let (_, second_backfill) = import_fingerprints(
            vec![(
                record,
                Some(assignment.identity_fingerprint.clone()),
                Some(assignment.fingerprint.clone()),
            )],
            &crypto,
            &secrets_key,
            1,
        )
        .unwrap();
        assert!(second_backfill.is_empty());
    }

    #[wasm_bindgen_test]
    fn event_log_export_serializes_flattened_signed_events_as_plain_objects() {
        let value = serialize_js_array(&vec![ExportedRecord {
            event_id: "event-1".to_owned(),
            event: SignedEvent {
                body: SignedEventBody { schema_version: 1 },
                signature: "ed25519:test-signature".to_owned(),
            },
        }])
        .expect("serialize event-log records");
        let record: js_sys::Object = value.get(0).unchecked_into();
        let event = get(&record, "event");

        assert_eq!(get_number(&event, "schema_version"), 1.0);
        assert_eq!(get_string(&event, "signature"), "ed25519:test-signature");
    }

    /// WASM-side contract for file-sync reconnect after offline concurrent creates
    /// of the same login identity: both records survive; passwords are not merged.
    /// Full multi-provider scenario coverage lives in
    /// `nook-core/tests/event_log_file_sync_replication.rs`.
    #[wasm_bindgen_test]
    fn concurrent_same_identity_logins_both_survive_after_event_union() {
        use nook_core::{
            LoginSecret, SecretId, SecretType, SecretValue, SigningIdentity, VaultCrypto,
            VaultEventSession, VaultOperation, encrypted_secret_from_armored, generate_store_id,
            generate_vault_keys, secret_fingerprint, secret_identity_fingerprint,
        };
        use std::collections::BTreeSet;

        const TS: &str = "2026-06-28T00:00:00Z";

        fn append_login(
            session: &mut VaultEventSession,
            crypto: &VaultCrypto,
            secrets_key: &nook_core::SymmetricKey,
            secret_id: &str,
            password: &str,
        ) {
            let value = SecretValue::Login(LoginSecret {
                website_url: "https://login-a-1.example.com".to_owned(),
                username: "alice".to_owned(),
                password: password.to_owned(),
                notes: String::new(),
            });
            let identity = secret_identity_fingerprint(&value, secrets_key);
            let version = secret_fingerprint(&value, secrets_key);
            let ciphertext = crypto
                .encrypt_value(value.to_yaml().expect("login yaml").as_str())
                .expect("encrypt login");
            session
                .append_operations(
                    vec![VaultOperation::SecretCreated {
                        secret: encrypted_secret_from_armored(
                            &SecretId::from_vault_record(secret_id),
                            SecretType::Login,
                            ciphertext.as_str(),
                            Some(identity),
                            Some(version),
                        ),
                    }],
                    TS,
                    Some("local-folder"),
                )
                .expect("append login");
        }

        let keys = generate_vault_keys().expect("vault keys");
        let store_id = generate_store_id().expect("store id");
        let (signing, signing_seed) = SigningIdentity::generate().expect("signing");
        let crypto = VaultCrypto::new(&keys.secrets_key).expect("crypto");

        let mut device_a = VaultEventSession::new(
            store_id.to_string(),
            signing.clone(),
            signing_seed.clone().into_inner(),
        );
        device_a
            .append_operations(
                vec![VaultOperation::VaultImported {
                    source_content_hash: nook_core::Sha256Hex::from_trusted("0".repeat(64)),
                    secrets: Vec::new(),
                    password_entries: Vec::new(),
                }],
                TS,
                Some("local-folder"),
            )
            .expect("genesis");

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
                    .map(|bytes| (id, bytes.to_vec()))
            })
            .collect();
        device_b
            .union_remote(&genesis_events)
            .expect("device-b joins vault-a");

        let shared_head = device_a.heads[0].clone();
        // Disconnect: each device appends offline from the same head.
        device_a.heads = vec![shared_head.clone()];
        append_login(
            &mut device_a,
            &crypto,
            &keys.secrets_key,
            "secret_logina1aaaa",
            "password-from-device-a",
        );
        device_b.heads = vec![shared_head];
        append_login(
            &mut device_b,
            &crypto,
            &keys.secrets_key,
            "secret_logina1bbbb",
            "password-from-device-b",
        );

        // Reconnect via file-sync style set-union.
        let a_events: Vec<_> = device_a
            .store
            .event_ids()
            .into_iter()
            .filter_map(|id| {
                device_a
                    .store
                    .get_bytes(&id)
                    .map(|bytes| (id, bytes.to_vec()))
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
                    .map(|bytes| (id, bytes.to_vec()))
            })
            .collect();
        device_a.union_remote(&b_events).expect("union b into a");
        device_b.union_remote(&a_events).expect("union a into b");

        let graph = device_a
            .store
            .load_graph(device_a.store_id.as_str())
            .expect("graph");
        let projection = device_a.project().expect("project");
        let live = projection.live_secrets(&graph);
        assert_eq!(live.len(), 2);
        assert!(!projection.has_blocking_conflicts());

        let mut passwords = BTreeSet::new();
        for record in live.values() {
            let plaintext = crypto
                .decrypt_value(
                    &nook_core::AgeArmoredCiphertext::parse(record.value.as_str())
                        .expect("age ciphertext"),
                )
                .expect("decrypt");
            let value =
                SecretValue::from_yaml_str(SecretType::Login, plaintext.as_str()).expect("yaml");
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
            .filter_map(|secret| {
                secret
                    .identity_fingerprint
                    .as_ref()
                    .map(|fp| fp.as_str().to_owned())
            })
            .collect();
        assert_eq!(identities.len(), 1, "same login identity on both records");
    }
}

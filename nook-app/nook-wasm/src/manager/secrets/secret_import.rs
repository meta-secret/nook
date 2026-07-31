use super::{JsError, NookError, NookImportResult, NookVaultManager};
use std::collections::{HashMap, HashSet};

type ImportVersions = HashMap<
    nook_core::SecretFingerprint,
    Vec<(nook_core::StoredSecretRecord, nook_core::SecretFingerprint)>,
>;

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

enum ImportItemOutcome {
    Duplicate,
    Operation(nook_core::VaultOperation),
}

fn coalesce_import_items(
    items: Vec<nook_core::SecretValue>,
    secrets_key: &nook_core::SymmetricKey,
) -> Result<(Vec<nook_core::SecretValue>, usize), NookError> {
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
    Ok((coalesced, duplicates))
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
        nook_core::VaultOperation::SecretCreated {
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

#[derive(Clone, Copy)]
pub(super) enum SecretImportSource {
    ApplePasswords,
    Bitwarden,
    ChromePasswords,
    GoogleAuthenticator,
    KeePassXc,
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
            Self::KeePassXc => "IMPORT_KEEPASSXC_START",
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
            Self::KeePassXc => "import-keepassxc",
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
            Self::GoogleAuthenticator => "Google Authenticator",
            Self::KeePassXc => "KeePassXC",
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

        let secrets_key = nook_core::SymmetricKey::parse(&self.vault.secrets_key)?;
        let (items, within_batch_duplicates) = coalesce_import_items(items, &secrets_key)?;
        let dedup_state = self.live_secret_dedup_state().await?;
        let crypto = self.vault.crypto.get()?;
        let existing_by_identity = group_import_fingerprints(dedup_state, items.len());
        let mut seen_versions = existing_by_identity
            .values()
            .flatten()
            .map(|(_, fingerprint)| fingerprint.clone())
            .collect::<HashSet<_>>();
        let mut skipped_duplicates = within_batch_duplicates;
        let mut operations = Vec::with_capacity(items.len());

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
#[allow(clippy::items_after_test_module)]
mod import_tests {
    use super::*;

    fn key() -> anyhow::Result<nook_core::SymmetricKey> {
        Ok(nook_core::SymmetricKey::parse(&"ab".repeat(32))?)
    }

    #[test]
    fn same_batch_provider_notes_are_coalesced_without_losing_metadata() -> anyhow::Result<()> {
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

        let (items, duplicates) = coalesce_import_items(items, &key()?)?;
        assert_eq!(duplicates, 1);
        assert_eq!(items.len(), 1);
        let nook_core::SecretValue::SecureNote(note) = &items[0] else {
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
    use wasm_bindgen_test::wasm_bindgen_test;

    #[wasm_bindgen_test]
    async fn default_page_restores_crypto_from_the_cached_projection() -> Result<(), JsError> {
        let identity = nook_core::DeviceIdentity::generate()?;
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

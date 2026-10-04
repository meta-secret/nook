use crate::NookError;
use gloo_timers::future;
use nook_core::{
    AgeArmoredCiphertext, RecordTypeDeclaration, SecretValue, SymmetricKey, VaultOperation,
};
use std::collections::{HashMap, HashSet};
use std::time::Duration;

struct BrowserImportBatchOffset(usize);

impl BrowserImportBatchOffset {
    const ITEMS_PER_TASK: usize = 16;

    async fn yield_browser_task(self) {
        match self.0 % Self::ITEMS_PER_TASK {
            0 => future::sleep(Duration::ZERO).await,
            _ => {}
        }
    }
}

type ImportVersions = HashMap<
    nook_core::SecretFingerprint,
    Vec<(nook_core::StoredSecretRecord, nook_core::SecretFingerprint)>,
>;

pub(super) struct CoalescedSecretImport<'a> {
    items: Vec<SecretValue>,
    duplicates: usize,
    secrets_key: &'a SymmetricKey,
}

pub(super) struct PreparedSecretImport {
    pub(super) operations: Vec<VaultOperation>,
    pub(super) skipped_duplicates: usize,
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
    pub(super) fn new(
        items: Vec<nook_core::SecretValue>,
        secrets_key: &'a SymmetricKey,
    ) -> Result<Self, NookError> {
        let mut coalesced: Vec<nook_core::SecretValue> = Vec::with_capacity(items.len());
        let mut indexes: HashMap<nook_core::SecretFingerprint, usize> =
            HashMap::with_capacity(items.len());
        let mut duplicates = 0;
        for mut value in items {
            let fingerprint = value.fingerprint(secrets_key)?;
            if let Some(index) = indexes.get(&fingerprint).copied() {
                let Some(existing) = coalesced.get_mut(index) else {
                    return Err(NookError::Database(
                        "Secret import coalescing index was invalid.".to_owned(),
                    ));
                };
                let enriched = existing.enriched_with(&value);
                existing.zeroize_plaintext();
                value.zeroize_plaintext();
                *existing = enriched;
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
        let identity_fingerprint = value.identity_fingerprint(secrets_key)?;
        let fingerprint = value.fingerprint(secrets_key)?;
        if let Some((record, _)) =
            existing_by_identity
                .get(&identity_fingerprint)
                .and_then(|records| {
                    records
                        .iter()
                        .find(|(_, existing)| existing == &fingerprint)
                })
        {
            let RecordTypeDeclaration::Secret(secret_type) = record.secret_type else {
                return Err(NookError::Database(format!(
                    "Secret {} is missing its type.",
                    record.key
                )));
            };
            let ciphertext = AgeArmoredCiphertext::parse(record.value.as_str())?;
            let mut plaintext = crypto.decrypt_value(&ciphertext)?;
            let mut existing = SecretValue::from_yaml_str(secret_type, plaintext.as_str())?;
            plaintext.zeroize_plaintext();
            let mut enriched = existing.enriched_with(&value);
            let outcome = if enriched == existing {
                ImportItemOutcome::Duplicate
            } else {
                let mut yaml = enriched.to_yaml()?;
                let ciphertext = crypto.encrypt_value(yaml.as_str())?;
                yaml.zeroize_plaintext();
                let new_id = nook_core::SecretId::generate()?;
                ImportItemOutcome::Operation(VaultOperation::SecretReplaced {
                    old_id: record.key.clone(),
                    new_secret: nook_core::EncryptedSecretPayload::from_armored(
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
        let id = nook_core::SecretId::generate()?;
        Ok(ImportItemOutcome::Operation(
            VaultOperation::SecretCreated {
                secret: nook_core::EncryptedSecretPayload::from_armored(
                    &id,
                    secret_type,
                    ciphertext.as_str(),
                    identity_fingerprint,
                    fingerprint,
                ),
            },
        ))
    }

    pub(super) async fn prepare(
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

        for (index, value) in self.items.into_iter().enumerate() {
            // A browser task (rather than a resolved Promise) permits input and
            // painting while encrypted operations accumulate before one commit.
            BrowserImportBatchOffset(index).yield_browser_task().await;
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

#[cfg(test)]
#[allow(clippy::items_after_test_module)]
mod tests {
    use super::*;
    use nook_core::{
        SecretFingerprint, SecureNoteSecret, StoredRecordPayload, StoredSecretRecord, VaultCrypto,
    };
    use wasm_bindgen_test::wasm_bindgen_test;

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
            let identity = value.identity_fingerprint(&key)?;
            let version = value.fingerprint(&key)?;
            let mut yaml = value.to_yaml()?;
            let encrypted = crypto.encrypt_value(yaml.as_str())?;
            yaml.zeroize_plaintext();
            let record = StoredSecretRecord {
                key: nook_core::SecretId::generate()?,
                secret_type: RecordTypeDeclaration::Secret(value.secret_type()),
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

        async fn prepare(&self, note: &str) -> Result<PreparedSecretImport, NookError> {
            CoalescedSecretImport::new(vec![Self::value(note)], &self.key)?
                .prepare(
                    vec![(
                        self.record.clone(),
                        self.identity.clone(),
                        self.version.clone(),
                    )],
                    &self.crypto,
                )
                .await
        }
    }

    #[wasm_bindgen_test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test callback"
        )
    )]
    async fn exact_existing_duplicate_prepares_no_operations() -> anyhow::Result<()> {
        let fixture = ImportFixture::new()?;
        let prepared = fixture
            .prepare("same note\n\n## LastPass\n- group: Personal")
            .await?;
        assert_eq!(prepared.skipped_duplicates, 1);
        assert!(prepared.operations.is_empty());
        Ok(())
    }

    #[wasm_bindgen_test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test callback"
        )
    )]
    async fn metadata_enrichment_prepares_an_encrypted_replacement() -> anyhow::Result<()> {
        let fixture = ImportFixture::new()?;
        let prepared = fixture
            .prepare("same note\n\n## Proton Pass\n- vault: Personal")
            .await?;
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

    #[wasm_bindgen_test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test callback"
        )
    )]
    async fn malformed_existing_record_rejects_preparation() -> anyhow::Result<()> {
        let mut fixture = ImportFixture::new()?;
        fixture.record.secret_type = RecordTypeDeclaration::Undeclared;
        let original = fixture.record.clone();
        match fixture
            .prepare("same note\n\n## LastPass\n- group: Personal")
            .await
        {
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

    #[wasm_bindgen_test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test callback"
        )
    )]
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
        let Some(SecretValue::SecureNote(note)) = items.first() else {
            return Err(anyhow::anyhow!(
                "coalesced import item must be a secure note"
            ));
        };
        assert!(note.note.contains("## LastPass"));
        assert!(note.note.contains("## Proton Pass"));
        Ok(())
    }

    #[wasm_bindgen_test]
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            unowned_function,
            reason = "framework boundary: wasm-bindgen-test callback"
        )
    )]
    async fn preparation_yields_to_a_task_before_finishing_the_encrypted_batch()
    -> anyhow::Result<()> {
        use futures_util::future::{Either, select};
        let fixture = ImportFixture::new()?;
        let items = (0..33)
            .map(|index| ImportFixture::value(&format!("unique note {index}")))
            .collect();
        let coalesced = CoalescedSecretImport::new(items, &fixture.key)?;
        let preparation = coalesced.prepare(Vec::new(), &fixture.crypto);
        futures_util::pin_mut!(preparation);
        let task = future::sleep(Duration::ZERO);
        futures_util::pin_mut!(task);
        let prepared = match select(preparation, task).await {
            Either::Right(((), preparation)) => preparation.await?,
            Either::Left(_) => {
                anyhow::bail!("Import preparation blocked the scheduled browser task")
            }
        };
        assert_eq!(prepared.operations.len(), 33);
        assert_eq!(prepared.skipped_duplicates, 0);
        for operation in prepared.operations {
            let VaultOperation::SecretCreated { secret } = operation else {
                anyhow::bail!("New batch must contain only secret creation operations");
            };
            let ciphertext = AgeArmoredCiphertext::parse(secret.ciphertext.as_str())?;
            let mut plaintext = fixture.crypto.decrypt_value(&ciphertext)?;
            assert!(plaintext.as_str().contains("unique note"));
            plaintext.zeroize_plaintext();
        }
        Ok(())
    }
}

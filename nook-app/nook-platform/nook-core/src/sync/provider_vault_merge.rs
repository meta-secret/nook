//! Opening a vault a provider holds, so its records can be merged into the
//! vault open on this device.
//!
//! The source vault stays where it is: its events are read, its keys come
//! from the backup password the user types or from the envelope a member
//! granted this device's app key, and its live records are decrypted into
//! plaintext values for the open vault's import, which matches identical
//! logins and keeps different passwords apart.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use crate::errors::{VaultError, VaultResult};
use crate::{
    AgeArmoredCiphertext, AppKey, EventGraph, LocalEventStore, LocalEventWrite,
    PasswordEntryResolution, RecordTypeDeclaration, SecretValue, StoreId, SymmetricKey,
    VaultCrypto, VaultMetaGraphProjection, VaultMetaState, VaultProjection, VaultRecordView,
};

/// A provider vault's events and the backup password the user typed for it.
pub struct ProviderVaultPasswordOpening<'a> {
    pub store_id: &'a StoreId,
    pub events: Vec<LocalEventWrite>,
    pub password: &'a str,
}

impl ProviderVaultPasswordOpening<'_> {
    /// Decrypt the vault's live records with the backup password. The
    /// password opens the entry it was set for; a password that opens no
    /// entry, or a vault without one, fails.
    pub fn open_secrets(self) -> VaultResult<Vec<SecretValue>> {
        let source = ProviderVaultSource::load(self.store_id, self.events)?;
        let mut keys = Err(VaultError::from(crate::PasswordError::EnvelopeNotFound));
        for entry in &source.projection.password_entries {
            keys = PasswordEntryResolution::new(entry, self.password)
                .resolve()
                .map_err(VaultError::from);
            if keys.is_ok() {
                break;
            }
        }
        source.live_values(&keys?.secrets_key)
    }
}

/// A provider vault's events and the app key a member granted access.
pub struct ProviderVaultGrantedOpening<'a> {
    pub store_id: &'a StoreId,
    pub events: Vec<LocalEventWrite>,
    pub app_key: &'a AppKey,
}

impl ProviderVaultGrantedOpening<'_> {
    /// Decrypt the vault's live records with the keys a member wrapped to
    /// this app key. An app key nobody granted opens nothing.
    pub fn open_secrets(self) -> VaultResult<Vec<SecretValue>> {
        let source = ProviderVaultSource::load(self.store_id, self.events)?;
        let mut meta = VaultMetaState::default();
        VaultMetaGraphProjection::new(&source.graph).materialize(&mut meta)?;
        let records = meta.to_stored_records();
        let secrets_key = VaultRecordView::new(&records).secrets_key(self.app_key)?;
        source.live_values(&secrets_key)
    }
}

/// A provider vault's causal graph and its projection, built in memory.
struct ProviderVaultSource {
    graph: EventGraph,
    projection: VaultProjection,
}

impl ProviderVaultSource {
    fn load(store_id: &StoreId, events: Vec<LocalEventWrite>) -> VaultResult<Self> {
        let store = events
            .into_iter()
            .fold(LocalEventStore::new(), LocalEventStore::put_event);
        let graph = store.load_graph(store_id.as_str())?;
        let projection = VaultProjection::from_graph(&graph, store_id.as_str())?;
        Ok(Self { graph, projection })
    }

    /// The live records, decrypted with the vault's secrets key.
    fn live_values(&self, secrets_key: &SymmetricKey) -> VaultResult<Vec<SecretValue>> {
        let crypto = VaultCrypto::new(secrets_key)?;
        let mut values = Vec::new();
        for record in self.projection.live_secrets(&self.graph).into_values() {
            let RecordTypeDeclaration::Secret(secret_type) = record.secret_type else {
                continue;
            };
            let armored =
                AgeArmoredCiphertext::from_trusted_armored(record.value.as_str().to_owned());
            let mut plaintext = crypto.decrypt_value(&armored)?;
            let value = SecretValue::from_yaml_str(secret_type, plaintext.as_str());
            plaintext.zeroize_plaintext();
            values.push(value?);
        }
        Ok(values)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        ApiKeySecret, EncryptedSecretPayload, EventId, GenesisImportPayload, GenesisImportRequest,
        IsoTimestamp, PasswordEntryIssuance, SecretFingerprint, SecretId, SecretType,
        SigningIdentity, VaultEvent, VaultKeys,
    };

    const PASSWORD: &str = "correct horse battery staple";

    /// A provider vault created with one API key and, optionally, a backup
    /// password.
    fn provider_vault(
        store_id: &StoreId,
        with_password: bool,
    ) -> anyhow::Result<(Vec<LocalEventWrite>, SecretValue)> {
        let keys = VaultKeys::generate()?;
        let value = SecretValue::ApiKey(ApiKeySecret {
            website_url: "https://example.com".to_owned(),
            key: "hunter2".to_owned(),
            expires_at: String::new(),
        });
        let ciphertext = VaultCrypto::new(&keys.secrets_key)?.encrypt_value(value.to_yaml()?)?;
        let secret = EncryptedSecretPayload::from_armored(
            &SecretId::from_vault_record("secret_mergesource"),
            SecretType::ApiKey,
            ciphertext.as_str(),
            SecretFingerprint::from_trusted("identity".to_owned()),
            SecretFingerprint::from_trusted("version".to_owned()),
        );
        let password_entries = if with_password {
            vec![
                PasswordEntryIssuance::with_work_factor(
                    &keys,
                    "pwdentry001",
                    "Emergency kit",
                    "2026-07-22T00:00:00Z",
                    PASSWORD,
                    10.into(),
                )
                .issue()?,
            ]
        } else {
            Vec::new()
        };
        let signing = SigningIdentity::generate()?.0;
        let event = VaultEvent::build_genesis_import_event(GenesisImportRequest {
            store_id,
            actor_id: &signing.actor_id()?,
            key_epoch: &EventId::from_sha256_hex(
                nook_auth2::Sha256Hex::from_trusted("1".repeat(64)).as_str(),
            )?,
            payload: GenesisImportPayload {
                source_content_hash: nook_auth2::Sha256Hex::from_trusted("0".repeat(64)),
                secrets: vec![secret],
                password_entries,
            },
            created_at: &IsoTimestamp::parse("2026-07-22T00:00:00Z")?,
            signing_key: signing.signing_key(),
        })?;
        Ok((
            vec![LocalEventWrite {
                event_id: event.id()?,
                bytes: VaultEvent::serialize_event_storage_yaml(&event)?,
            }],
            value,
        ))
    }

    #[test]
    fn the_backup_password_opens_the_records_for_a_merge() -> anyhow::Result<()> {
        let store_id = StoreId::parse("store_mergesource")?;
        let (events, value) = provider_vault(&store_id, true)?;
        let opened = ProviderVaultPasswordOpening {
            store_id: &store_id,
            events,
            password: PASSWORD,
        }
        .open_secrets()?;
        assert_eq!(opened, [value]);
        let (events, _) = provider_vault(&store_id, true)?;
        assert!(
            ProviderVaultPasswordOpening {
                store_id: &store_id,
                events,
                password: "wrong password",
            }
            .open_secrets()
            .is_err()
        );
        Ok(())
    }

    #[test]
    fn a_vault_without_a_backup_password_cannot_be_opened_by_one() -> anyhow::Result<()> {
        let store_id = StoreId::parse("store_mergesource")?;
        let (events, _) = provider_vault(&store_id, false)?;
        assert!(matches!(
            ProviderVaultPasswordOpening {
                store_id: &store_id,
                events,
                password: PASSWORD,
            }
            .open_secrets(),
            Err(VaultError::Password(crate::PasswordError::EnvelopeNotFound))
        ));
        Ok(())
    }
}

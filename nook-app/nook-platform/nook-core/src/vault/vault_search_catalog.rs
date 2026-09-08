//! Unlocked in-memory projection used for fast list/search.
//!
//! Canonical secret payloads remain encrypted. This derived catalog contains only
//! [`SecretListItem`] data while the vault is unlocked. Persistence is split into
//! independently encrypted buckets by the WASM adapter, so a 10,000-item search
//! avoids per-query decryption without exposing searchable metadata at rest.

#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use crate::errors::{SessionError, VaultResult};
use crate::{
    MAX_SECRET_PAGE_SIZE, SecretId, SecretListItem, SecretPage, SecretType, SecretTypeFilter,
    StoredRecordPayload, SymmetricKey, VaultCrypto, VaultSecretSession,
};
use hmac::{Hmac, KeyInit, Mac};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap};
use std::hash::BuildHasher;

const SEARCH_CATALOG_VERSION: u8 = 2;
const SEARCH_CATALOG_BUCKET_VERSION: u8 = 1;
const PAYLOAD_DIGEST_BYTES: usize = 16;
const SEARCH_CATALOG_INTEGRITY_DOMAIN: &[u8] = b"nook/secret-search-catalog/v1\0";
pub const SECRET_SEARCH_CATALOG_BUCKET_COUNT: u8 = 64;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SecretSearchCatalogEntry {
    payload_digest: [u8; PAYLOAD_DIGEST_BYTES],
    item: SecretListItem,
    integrity_tag: String,
    #[serde(skip)]
    normalized_search_text: String,
}

struct SecretSearchCatalogIntegrityTagRequest<'a> {
    payload_digest: [u8; PAYLOAD_DIGEST_BYTES],
    item: &'a SecretListItem,
    integrity_key: &'a SymmetricKey,
}

impl SecretSearchCatalogEntry {
    fn new(
        payload_digest: [u8; PAYLOAD_DIGEST_BYTES],
        item: SecretListItem,
        integrity_key: &SymmetricKey,
    ) -> VaultResult<Self> {
        let normalized_search_text = item.normalized_search_text();
        let integrity_tag = Self::integrity_tag(SecretSearchCatalogIntegrityTagRequest {
            payload_digest,
            item: &item,
            integrity_key,
        })?;
        Ok(Self {
            payload_digest,
            item,
            integrity_tag,
            normalized_search_text,
        })
    }

    fn has_valid_integrity(&self, integrity_key: &SymmetricKey) -> bool {
        let Ok(tag) = hex::decode(&self.integrity_tag) else {
            return false;
        };
        let Ok(item_json) = serde_json::to_vec(&self.item) else {
            return false;
        };
        let Ok(mut mac) = Hmac::<Sha256>::new_from_slice(integrity_key.as_str().as_bytes()) else {
            return false;
        };
        mac.update(SEARCH_CATALOG_INTEGRITY_DOMAIN);
        mac.update(&self.payload_digest);
        mac.update(&item_json);
        mac.verify_slice(&tag).is_ok()
    }

    fn restore_search_text(&mut self) {
        self.normalized_search_text = self.item.normalized_search_text();
    }

    fn payload_digest(payload: &str) -> [u8; PAYLOAD_DIGEST_BYTES] {
        let digest = Sha256::digest(payload.as_bytes());
        let mut truncated = [0_u8; PAYLOAD_DIGEST_BYTES];
        truncated.copy_from_slice(&digest[..PAYLOAD_DIGEST_BYTES]);
        truncated
    }

    fn integrity_tag(request: SecretSearchCatalogIntegrityTagRequest<'_>) -> VaultResult<String> {
        let item_json = serde_json::to_vec(request.item)
            .map_err(|error| SessionError::SearchCatalogSerialize(error.to_string()))?;
        let mut mac = Hmac::<Sha256>::new_from_slice(request.integrity_key.as_str().as_bytes())
            .map_err(|error| SessionError::SearchCatalogInvalid(error.to_string()))?;
        mac.update(SEARCH_CATALOG_INTEGRITY_DOMAIN);
        mac.update(&request.payload_digest);
        mac.update(&item_json);
        Ok(hex::encode(mac.finalize().into_bytes()))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecretSearchCatalog {
    version: u8,
    entries: BTreeMap<SecretId, SecretSearchCatalogEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SecretSearchCatalogBucket {
    version: u8,
    bucket: u8,
    entries: BTreeMap<SecretId, SecretSearchCatalogEntry>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct SecretSearchCatalogChangeCount(usize);

impl From<usize> for SecretSearchCatalogChangeCount {
    fn from(value: usize) -> Self {
        Self(value)
    }
}

impl From<SecretSearchCatalogChangeCount> for usize {
    fn from(value: SecretSearchCatalogChangeCount) -> Self {
        value.0
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct SecretSearchCatalogReconcile {
    pub added: SecretSearchCatalogChangeCount,
    pub updated: SecretSearchCatalogChangeCount,
    pub removed: SecretSearchCatalogChangeCount,
    changed_bucket_mask: u64,
}

impl SecretSearchCatalogReconcile {
    #[must_use]
    pub fn changed(self) -> bool {
        self.added.0 > 0 || self.updated.0 > 0 || self.removed.0 > 0
    }

    pub fn changed_buckets(self) -> impl Iterator<Item = crate::SecretSearchCatalogBucket> {
        (0..SECRET_SEARCH_CATALOG_BUCKET_COUNT)
            .filter(move |bucket| self.changed_bucket_mask & (1_u64 << bucket) != 0)
            .map(Into::into)
    }
}

impl Default for SecretSearchCatalog {
    fn default() -> Self {
        Self {
            version: SEARCH_CATALOG_VERSION,
            entries: BTreeMap::new(),
        }
    }
}

impl SecretSearchCatalog {
    fn bucket_for(id: &SecretId) -> crate::SecretSearchCatalogBucket {
        (Sha256::digest(id.as_str().as_bytes())[0] % SECRET_SEARCH_CATALOG_BUCKET_COUNT).into()
    }

    fn bucket_mask_for(id: &SecretId) -> u64 {
        1_u64 << u8::from(Self::bucket_for(id))
    }

    /// Restore one authenticated plaintext bucket after the adapter decrypts it.
    pub fn restore_bucket_json(
        &mut self,
        expected_bucket: crate::SecretSearchCatalogBucket,
        json: &str,
    ) -> VaultResult<()> {
        if u8::from(expected_bucket) >= SECRET_SEARCH_CATALOG_BUCKET_COUNT {
            return Err(SessionError::SearchCatalogInvalid(format!(
                "bucket {} is out of range",
                u8::from(expected_bucket)
            ))
            .into());
        }
        let mut bucket: SecretSearchCatalogBucket = serde_json::from_str(json)
            .map_err(|error| SessionError::SearchCatalogInvalid(error.to_string()))?;
        if bucket.version != SEARCH_CATALOG_BUCKET_VERSION
            || bucket.bucket != u8::from(expected_bucket)
        {
            return Err(SessionError::SearchCatalogInvalid(
                "catalog bucket header does not match its storage key".to_owned(),
            )
            .into());
        }
        for (id, entry) in &mut bucket.entries {
            if &entry.item.id != id || Self::bucket_for(id) != expected_bucket {
                return Err(SessionError::SearchCatalogInvalid(
                    "catalog entry does not belong to its encrypted bucket".to_owned(),
                )
                .into());
            }
            if self.entries.contains_key(id) {
                return Err(SessionError::SearchCatalogInvalid(
                    "catalog contains a duplicate secret id".to_owned(),
                )
                .into());
            }
            entry.restore_search_text();
        }
        self.entries.append(&mut bucket.entries);
        Ok(())
    }

    /// Serialize one bucket for immediate encryption by the persistence adapter.
    pub fn bucket_json(
        &self,
        bucket: crate::SecretSearchCatalogBucket,
    ) -> VaultResult<SearchCatalogBucketPayload> {
        if u8::from(bucket) >= SECRET_SEARCH_CATALOG_BUCKET_COUNT {
            return Err(SessionError::SearchCatalogInvalid(format!(
                "bucket {} is out of range",
                u8::from(bucket)
            ))
            .into());
        }
        let entries = self
            .entries
            .iter()
            .filter(|(id, _)| Self::bucket_for(id) == bucket)
            .map(|(id, entry)| (id.clone(), entry.clone()))
            .collect::<BTreeMap<_, _>>();
        if entries.is_empty() {
            return Ok(SearchCatalogBucketPayload::Empty);
        }
        serde_json::to_string(&SecretSearchCatalogBucket {
            version: SEARCH_CATALOG_BUCKET_VERSION,
            bucket: u8::from(bucket),
            entries,
        })
        .map(SearchCatalogBucketPayload::Json)
        .map_err(|error| SessionError::SearchCatalogSerialize(error.to_string()).into())
    }

    /// Reuse unchanged public rows and decrypt only new or changed ciphertexts.
    pub fn reconcile<S: BuildHasher>(
        &mut self,
        secrets: &HashMap<SecretId, (SecretType, StoredRecordPayload), S>,
        crypto: &VaultCrypto,
        integrity_key: &SymmetricKey,
    ) -> VaultResult<SecretSearchCatalogReconcile> {
        let mut outcome = SecretSearchCatalogReconcile {
            removed: self
                .entries
                .keys()
                .filter(|id| !secrets.contains_key(*id))
                .count()
                .into(),
            ..SecretSearchCatalogReconcile::default()
        };
        for id in self.entries.keys().filter(|id| !secrets.contains_key(*id)) {
            outcome.changed_bucket_mask |= Self::bucket_mask_for(id);
        }
        let mut next = BTreeMap::new();
        for (id, (secret_type, payload)) in secrets {
            let digest = SecretSearchCatalogEntry::payload_digest(payload.as_str());
            if let Some(existing) = self.entries.get(id)
                && existing.payload_digest == digest
                && existing.item.secret_type() == *secret_type
                && existing.has_valid_integrity(integrity_key)
            {
                next.insert(id.clone(), existing.clone());
                continue;
            }

            if self.entries.contains_key(id) {
                outcome.updated.0 += 1;
            } else {
                outcome.added.0 += 1;
            }
            outcome.changed_bucket_mask |= Self::bucket_mask_for(id);
            let mut record = VaultSecretSession::new(secrets, crypto).decrypt(id)?;
            let item = record.list_item();
            record.zeroize_plaintext();
            next.insert(
                id.clone(),
                SecretSearchCatalogEntry::new(digest, item, integrity_key)?,
            );
        }
        self.entries = next;
        Ok(outcome)
    }

    #[must_use]
    pub fn query(
        &self,
        query: &str,
        secret_type_filter: SecretTypeFilter,
        offset: crate::SecretPageOffset,
        limit: crate::SecretPageLimit,
    ) -> SecretPage {
        let offset = usize::from(offset);
        let limit = usize::from(limit);
        let needle = query.trim().to_lowercase();
        let limit = limit.clamp(1, MAX_SECRET_PAGE_SIZE);
        let matches = self.entries.values().filter(|entry| {
            secret_type_filter.matches(entry.item.secret_type())
                && (needle.is_empty() || entry.normalized_search_text.contains(&needle))
        });
        let total = matches.clone().count();
        let records = matches
            .skip(offset)
            .take(limit)
            .map(|entry| entry.item.clone())
            .collect();
        SecretPage {
            records,
            total: total.into(),
            offset: offset.into(),
            limit: limit.into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SearchCatalogBucketPayload {
    Empty,
    Json(String),
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{LoginSecret, SecretRecord, SecretValue, StoredRecordPayload, VaultKeys};

    fn login_item(index: usize, username: &str) -> SecretListItem {
        SecretRecord {
            id: SecretId::from_vault_record(&format!("secret_catalog{index:05}")),
            secret_type: SecretType::Login,
            data: SecretValue::Login(LoginSecret {
                website_url: format!("https://site-{index}.example.com"),
                username: username.to_owned(),
                password: "never-catalogued".to_owned(),
                notes: String::new(),
            }),
        }
        .list_item()
    }

    fn integrity_key() -> anyhow::Result<SymmetricKey> {
        Ok(SymmetricKey::parse(&"a".repeat(64))?)
    }

    #[test]
    fn ten_thousand_item_catalog_returns_a_specific_match() -> anyhow::Result<()> {
        let mut catalog = SecretSearchCatalog::default();
        let integrity_key = integrity_key()?;
        for index in 0..10_000 {
            let username = if index == 9_876 {
                "needle-account"
            } else {
                "ordinary-account"
            };
            let item = login_item(index, username);
            catalog.entries.insert(
                item.id.clone(),
                SecretSearchCatalogEntry::new([0_u8; PAYLOAD_DIGEST_BYTES], item, &integrity_key)?,
            );
        }

        let page = catalog.query("needle-account", SecretTypeFilter::All, 0.into(), 50.into());
        assert_eq!(usize::from(page.total), 1);
        assert_eq!(
            page.records[0].id,
            SecretId::from_vault_record("secret_catalog09876")
        );
        Ok(())
    }

    #[test]
    fn encrypted_bucket_hides_searchable_metadata_and_secret_values() -> VaultResult<()> {
        let keys = VaultKeys::generate()?;
        let crypto = VaultCrypto::new(&keys.secrets_key)?;
        let mut catalog = SecretSearchCatalog::default();
        let item = login_item(1, "visible-user");
        let bucket = SecretSearchCatalog::bucket_for(&item.id);
        catalog.entries.insert(
            item.id.clone(),
            SecretSearchCatalogEntry::new([1_u8; PAYLOAD_DIGEST_BYTES], item, &keys.secrets_key)?,
        );

        let SearchCatalogBucketPayload::Json(json) = catalog.bucket_json(bucket.into())? else {
            panic!("bucket is non-empty");
        };
        assert!(json.contains("visible-user"));
        assert!(!json.contains("never-catalogued"));
        let ciphertext = crypto.encrypt_value(&json)?;
        assert!(!ciphertext.as_str().contains("visible-user"));
        assert!(!ciphertext.as_str().contains("never-catalogued"));

        let plaintext = crypto.decrypt_value(&ciphertext)?;
        let mut restored = SecretSearchCatalog::default();
        restored.restore_bucket_json(bucket.into(), plaintext.as_str())?;
        assert_eq!(
            usize::from(
                restored
                    .query("visible-user", SecretTypeFilter::All, 0.into(), 50.into())
                    .total,
            ),
            1
        );
        Ok(())
    }

    #[test]
    fn reconcile_decrypts_only_new_or_changed_ciphertexts() -> VaultResult<()> {
        let keys = VaultKeys::generate()?;
        let crypto = VaultCrypto::new(&keys.secrets_key)?;
        let mut secrets = HashMap::new();
        for index in 0..3 {
            let record = SecretRecord {
                id: SecretId::from_vault_record(&format!("secret_reconcile{index}")),
                secret_type: SecretType::Login,
                data: SecretValue::Login(LoginSecret {
                    website_url: format!("https://{index}.example.com"),
                    username: format!("user-{index}"),
                    password: format!("password-{index}"),
                    notes: String::new(),
                }),
            };
            let ciphertext = crypto.encrypt_value(record.data.to_yaml()?)?;
            secrets.insert(
                record.id,
                (
                    SecretType::Login,
                    StoredRecordPayload::from_age_armored(ciphertext),
                ),
            );
        }

        let mut catalog = SecretSearchCatalog::default();
        let initial = catalog.reconcile(&secrets, &crypto, &keys.secrets_key)?;
        assert_eq!(usize::from(initial.added), 3);
        assert_eq!(usize::from(initial.updated), 0);
        assert!(initial.changed() && initial.changed_buckets().next().is_some());
        assert_eq!(
            catalog.reconcile(&secrets, &crypto, &keys.secrets_key)?,
            SecretSearchCatalogReconcile::default()
        );

        let changed_id = SecretId::from_vault_record("secret_reconcile1");
        let changed = SecretValue::Login(LoginSecret {
            website_url: "https://changed.example.com".to_owned(),
            username: "changed-user".to_owned(),
            password: "changed-password".to_owned(),
            notes: String::new(),
        });
        secrets.insert(
            changed_id.clone(),
            (
                SecretType::Login,
                StoredRecordPayload::from_age_armored(crypto.encrypt_value(changed.to_yaml()?)?),
            ),
        );
        let changed = catalog.reconcile(&secrets, &crypto, &keys.secrets_key)?;
        assert_eq!(usize::from(changed.added), 0);
        assert_eq!(usize::from(changed.updated), 1);
        assert_eq!(usize::from(changed.removed), 0);
        assert_eq!(
            changed.changed_buckets().map(u8::from).collect::<Vec<_>>(),
            vec![u8::from(SecretSearchCatalog::bucket_for(&changed_id))]
        );
        assert_eq!(
            usize::from(
                catalog
                    .query("changed-user", SecretTypeFilter::All, 0.into(), 50.into())
                    .total,
            ),
            1
        );
        assert_eq!(
            usize::from(
                catalog
                    .query(
                        "changed-password",
                        SecretTypeFilter::All,
                        0.into(),
                        50.into(),
                    )
                    .total,
            ),
            0
        );
        secrets.remove(&changed_id);
        let removed = catalog.reconcile(&secrets, &crypto, &keys.secrets_key)?;
        assert_eq!(usize::from(removed.removed), 1);
        Ok(())
    }

    #[test]
    fn reconcile_rebuilds_a_tampered_cached_row() -> VaultResult<()> {
        let keys = VaultKeys::generate()?;
        let crypto = VaultCrypto::new(&keys.secrets_key)?;
        let record = SecretRecord {
            id: SecretId::from_vault_record("secret_integrity1"),
            secret_type: SecretType::Login,
            data: SecretValue::Login(LoginSecret {
                website_url: "https://trusted.example.com".to_owned(),
                username: "trusted-user".to_owned(),
                password: "private-password".to_owned(),
                notes: String::new(),
            }),
        };
        let ciphertext = crypto.encrypt_value(record.data.to_yaml()?)?;
        let secrets = HashMap::from([(
            record.id.clone(),
            (
                SecretType::Login,
                StoredRecordPayload::from_age_armored(ciphertext),
            ),
        )]);
        let mut catalog = SecretSearchCatalog::default();
        catalog.reconcile(&secrets, &crypto, &keys.secrets_key)?;

        let bucket = SecretSearchCatalog::bucket_for(&record.id);
        let SearchCatalogBucketPayload::Json(json) = catalog.bucket_json(bucket.into())? else {
            panic!("catalog bucket exists");
        };
        let tampered_json = json.replace("trusted-user", "forged-user");
        let mut tampered = SecretSearchCatalog::default();
        tampered.restore_bucket_json(bucket.into(), &tampered_json)?;
        let outcome = tampered.reconcile(&secrets, &crypto, &keys.secrets_key)?;
        assert_eq!(usize::from(outcome.added), 0);
        assert_eq!(usize::from(outcome.updated), 1);
        assert_eq!(usize::from(outcome.removed), 0);
        assert_eq!(
            usize::from(
                tampered
                    .query("forged-user", SecretTypeFilter::All, 0.into(), 50.into())
                    .total,
            ),
            0
        );
        assert_eq!(
            usize::from(
                tampered
                    .query("trusted-user", SecretTypeFilter::All, 0.into(), 50.into())
                    .total,
            ),
            1
        );
        Ok(())
    }
}

//! Key-epoch rotation: fresh `secrets_key` / `members_key` for append-only security events.

#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]

use crate::SecretValue;

use crate::EncryptedSecretPayload;
use crate::errors::{VaultEpochError, VaultEpochResult, VaultResult};
use crate::multi_device::{AuthRecordIssuance, VaultKeys};
#[cfg(test)]
use crate::secret_types::StoredRecordPayload;
use crate::secret_types::StoredSecretRecord;
use crate::vault_crypto::VaultCrypto;
use crate::vault_wire::{AgeArmoredCiphertext, OpaqueCiphertext, Sha256Hex, SymmetricKey};
use crate::{build_members_records, resolve_member_roster};

/// Re-encrypt user secrets under a new `secrets_key`.
pub struct SecretEpochReencryption<'a> {
    records: &'a [StoredSecretRecord],
    old_secrets_key: &'a SymmetricKey,
    new_secrets_key: &'a SymmetricKey,
}

impl<'a> SecretEpochReencryption<'a> {
    #[must_use]
    pub fn new(
        records: &'a [StoredSecretRecord],
        old_secrets_key: &'a SymmetricKey,
        new_secrets_key: &'a SymmetricKey,
    ) -> Self {
        Self {
            records,
            old_secrets_key,
            new_secrets_key,
        }
    }

    pub fn reencrypt(self) -> VaultEpochResult<Vec<EncryptedSecretPayload>> {
        let Self {
            records,
            old_secrets_key,
            new_secrets_key,
        } = self;
        let old_crypto = VaultCrypto::new(old_secrets_key)?;
        let new_crypto = VaultCrypto::new(new_secrets_key)?;
        let mut out = Vec::new();
        for record in records {
            let secret_type = record
                .secret_type
                .ok_or(VaultEpochError::MissingSecretType {
                    key: record.key.to_string(),
                })?;
            let armored =
                AgeArmoredCiphertext::from_trusted_armored(record.value.as_str().to_owned());
            let mut plaintext = old_crypto.decrypt_value(&armored)?;
            let mut value = SecretValue::from_yaml_str(secret_type, plaintext.as_str())?;
            let identity_fingerprint = value.identity_fingerprint(new_secrets_key)?;
            let fingerprint = value.fingerprint(new_secrets_key)?;
            let ciphertext = new_crypto.encrypt_value(&plaintext)?;
            plaintext.zeroize_plaintext();
            value.zeroize_plaintext();
            out.push(EncryptedSecretPayload {
                id: record.key.clone(),
                secret_type,
                ciphertext: OpaqueCiphertext::from_trusted(ciphertext.as_str().to_owned()),
                identity_fingerprint,
                fingerprint,
            });
        }
        Ok(out)
    }
}

/// Rotate vault keys and rebuild encrypted secret payloads for a new epoch.
pub struct VaultKeyRotation<'a> {
    user_records: &'a [StoredSecretRecord],
    old_secrets_key: &'a SymmetricKey,
}

impl<'a> VaultKeyRotation<'a> {
    #[must_use]
    pub fn new(user_records: &'a [StoredSecretRecord], old_secrets_key: &'a SymmetricKey) -> Self {
        Self {
            user_records,
            old_secrets_key,
        }
    }

    pub fn rotate(self) -> VaultEpochResult<(VaultKeys, Vec<EncryptedSecretPayload>)> {
        let Self {
            user_records,
            old_secrets_key,
        } = self;
        let new_keys = crate::VaultKeys::generate()?;
        let secrets =
            SecretEpochReencryption::new(user_records, old_secrets_key, &new_keys.secrets_key)
                .reencrypt()?;
        Ok((new_keys, secrets))
    }
}

/// Hash of member roster records after re-encrypting under a new `members_key`.
pub struct MembersCheckpointHash<'a> {
    records: &'a [StoredSecretRecord],
    old_members_key: &'a SymmetricKey,
    new_members_key: &'a SymmetricKey,
}

impl<'a> MembersCheckpointHash<'a> {
    #[must_use]
    pub fn new(
        records: &'a [StoredSecretRecord],
        old_members_key: &'a SymmetricKey,
        new_members_key: &'a SymmetricKey,
    ) -> Self {
        Self {
            records,
            old_members_key,
            new_members_key,
        }
    }

    pub fn compute(self) -> VaultResult<Sha256Hex> {
        let Self {
            records,
            old_members_key,
            new_members_key,
        } = self;
        let roster = resolve_member_roster(records, old_members_key)?;
        let member_records = build_members_records(&roster, new_members_key)?;
        let json = serde_json::to_string(&member_records)
            .map_err(VaultEpochError::MemberRecordsSerialize)?;
        Ok(Sha256Hex::from_bytes(json.as_bytes()))
    }
}

/// Build replacement auth + member rows for every active device after epoch rotation.
pub struct VaultMetaRecordRewrap<'a> {
    records_snapshot: &'a [StoredSecretRecord],
    old_members_key: &'a SymmetricKey,
    new_keys: &'a VaultKeys,
}

impl<'a> VaultMetaRecordRewrap<'a> {
    #[must_use]
    pub fn new(
        records_snapshot: &'a [StoredSecretRecord],
        old_members_key: &'a SymmetricKey,
        new_keys: &'a VaultKeys,
    ) -> Self {
        Self {
            records_snapshot,
            old_members_key,
            new_keys,
        }
    }

    pub fn rewrap(self) -> VaultResult<Vec<StoredSecretRecord>> {
        let Self {
            records_snapshot,
            old_members_key,
            new_keys,
        } = self;
        let roster = resolve_member_roster(records_snapshot, old_members_key)?;
        let mut records = Vec::with_capacity(roster.len().saturating_mul(2));
        for member in &roster {
            records.push(
                AuthRecordIssuance::new(
                    &member.auth_id,
                    &new_keys.secrets_key,
                    &new_keys.members_key,
                    &member.public_key,
                )
                .issue()?,
            );
        }
        records.extend(build_members_records(&roster, &new_keys.members_key)?);
        Ok(records)
    }
}

/// Replace auth + member meta rows in the typed session meta state after epoch rotation.
pub struct VaultMetaRewrap<'a> {
    state: &'a mut crate::VaultMetaState,
    records_snapshot: &'a [StoredSecretRecord],
    old_members_key: &'a SymmetricKey,
    new_keys: &'a VaultKeys,
}

impl<'a> VaultMetaRewrap<'a> {
    #[must_use]
    pub fn new(
        state: &'a mut crate::VaultMetaState,
        records_snapshot: &'a [StoredSecretRecord],
        old_members_key: &'a SymmetricKey,
        new_keys: &'a VaultKeys,
    ) -> Self {
        Self {
            state,
            records_snapshot,
            old_members_key,
            new_keys,
        }
    }

    pub fn apply(self) -> VaultResult<()> {
        let Self {
            state,
            records_snapshot,
            old_members_key,
            new_keys,
        } = self;
        let records =
            VaultMetaRecordRewrap::new(records_snapshot, old_members_key, new_keys).rewrap()?;
        let mut replacement = state.clone();
        replacement.auth.clear();
        replacement.members.clear();
        for record in &records {
            replacement.apply_record(record)?;
        }
        *state = replacement;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use crate::{EpochMetadataState, EpochPasswordState, SecretType, VaultMetaState};

    use std::io;

    use super::*;
    use crate::{
        ApiKeySecret, DeviceIdentity, IsoTimestamp, JoinRequestApproval, JoinRequestIssuance,
        SecretId, SecretValue, VaultMetaOperationApplier, VaultMetaOperationRequest,
        VaultOperation, VaultRecordView, VaultResult, genesis_members_records,
        pending_join_for_device, replace_member_records,
    };

    #[test]
    fn reencrypt_produces_decryptable_new_epoch_secrets() -> anyhow::Result<()> {
        let old_key = SymmetricKey::parse(
            "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
        )?;
        let record = StoredSecretRecord {
            key: SecretId::from_vault_record("secret_testtoken1"),
            secret_type: Some(SecretType::ApiKey),
            value: StoredRecordPayload::from_age_armored(
                VaultCrypto::new(&old_key)?.encrypt_value(
                    SecretValue::ApiKey(ApiKeySecret {
                        website_url: "https://example.com".to_owned(),
                        key: "hunter2".to_owned(),
                        expires_at: String::new(),
                    })
                    .to_yaml()?,
                )?,
            ),
        };
        let new_key = SymmetricKey::parse(
            "cafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe",
        )?;
        let payloads = SecretEpochReencryption::new(&[record], &old_key, &new_key).reencrypt()?;
        let new_crypto = VaultCrypto::new(&new_key)?;
        let plaintext = new_crypto.decrypt_value(&AgeArmoredCiphertext::from_trusted_armored(
            payloads[0].ciphertext.as_str().to_owned(),
        ))?;
        assert!(plaintext.as_str().contains("hunter2"));
        Ok(())
    }

    #[test]
    fn members_checkpoint_hash_produces_hex_digest() -> VaultResult<()> {
        let keys = VaultKeys::generate()?;
        let new_keys = VaultKeys::generate()?;
        let identity = DeviceIdentity::generate()?;
        let mut records = vec![identity.auth_record(&keys.secrets_key, &keys.members_key)?];
        records.extend(genesis_members_records(
            &identity,
            &keys.members_key,
            "2026-06-28T00:00:00Z",
        )?);
        let hash = MembersCheckpointHash::new(&records, &keys.members_key, &new_keys.members_key)
            .compute()?;
        assert_eq!(hash.as_str().len(), 64);
        assert!(hash.as_str().chars().all(|c| c.is_ascii_hexdigit()));
        Ok(())
    }

    #[test]
    fn rewrap_vault_meta_updates_auth_and_member_rows() -> VaultResult<()> {
        let old_keys = VaultKeys::generate()?;
        let new_keys = VaultKeys::generate()?;
        let identity = DeviceIdentity::generate()?;
        let mut records = vec![identity.auth_record(&old_keys.secrets_key, &old_keys.members_key)?];
        records.extend(genesis_members_records(
            &identity,
            &old_keys.members_key,
            "2026-06-28T00:00:00Z",
        )?);
        let mut state = VaultMetaState::from_stored_records(&records)?;
        let old_auth_envelopes = state.auth.get(&identity.auth_id()).cloned();

        VaultMetaRewrap::new(&mut state, &records, &old_keys.members_key, &new_keys).apply()?;

        assert_ne!(
            state.auth.get(&identity.auth_id()),
            old_auth_envelopes.as_ref()
        );
        assert!(!state.members.is_empty());
        Ok(())
    }

    #[test]
    fn checkpoint_meta_replay_preserves_every_device_grant() -> anyhow::Result<()> {
        let old_keys = VaultKeys::generate()?;
        let new_keys = VaultKeys::generate()?;
        let owner = DeviceIdentity::generate()?;
        let joiner = DeviceIdentity::generate()?;
        let mut records = vec![owner.auth_record(&old_keys.secrets_key, &old_keys.members_key)?];
        records.extend(genesis_members_records(
            &owner,
            &old_keys.members_key,
            "2026-06-28T00:00:00Z",
        )?);
        records.push(JoinRequestIssuance::new(&joiner, "2026-06-28T00:01:00Z").issue()?);
        let join = pending_join_for_device(&records, joiner.device_id())?
            .ok_or_else(|| io::Error::other("join request must exist"))?;
        let (joiner_auth, join_key, member_records) = JoinRequestApproval::new(
            &old_keys.secrets_key,
            &old_keys.members_key,
            &join,
            &owner,
            &records,
        )
        .approve()?;
        records.retain(|record| record.key.as_str() != join_key);
        records.push(joiner_auth);
        replace_member_records(&mut records, member_records)?;

        let rotated_meta_records =
            VaultMetaRecordRewrap::new(&records, &old_keys.members_key, &new_keys).rewrap()?;
        let mut state = VaultMetaState::from_stored_records(&records)?;
        let requested_at = IsoTimestamp::parse("2026-06-28T00:02:00Z")?;
        VaultMetaOperationApplier::new(&mut state).apply(&VaultMetaOperationRequest {
            operation: &VaultOperation::EpochCheckpoint {
                secrets: Vec::new(),
                members_checkpoint_hash: Sha256Hex::from_bytes(b"members"),
                rotated_meta_records: EpochMetadataState::Replace(rotated_meta_records),
                password_entries: EpochPasswordState::Replace(Vec::new()),
            },
            requested_at: &requested_at,
        })?;
        let replayed = state.to_stored_records();
        for identity in [&owner, &joiner] {
            assert_eq!(
                VaultRecordView::new(&replayed).secrets_key(identity)?,
                new_keys.secrets_key
            );
            assert_eq!(
                VaultRecordView::new(&replayed).members_key(identity)?,
                new_keys.members_key
            );
        }
        Ok(())
    }
}

use crate::errors::{AgeCryptoError, MultiDeviceError, MultiDeviceResult};
use crate::{
    AgeArmoredCiphertext, AppId, AuthKeyId, CompactToken, DeviceId, DeviceIdentitySecret,
    DevicePublicKey, DeviceSigningPublicKey, SecretId, SecretType, StoredRecordPayload,
    StoredSecretRecord, SymmetricKey,
};
use age::secrecy::ExposeSecret;
use age::x25519::{Identity, Recipient};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::{Read, Write};

mod access;
mod roster;
#[path = "multi_device_secret_sharing.rs"]
mod secret_sharing;
mod sentinel;
mod state;

pub use state::*;

pub use access::{
    ConnectAccessStatus, SelfRosterSync, assess_connect_access, device_is_enrolled,
    ensure_self_in_roster, pending_join_for_device,
};
pub use roster::{
    build_members_records, encrypt_member_entry, genesis_members_records, member_from_identity,
    member_from_join, rename_vault_member, replace_member_records, resolve_member_roster,
    revoke_vault_member, roster_add_member,
};

pub use sentinel::{
    OpenedSentinelShare, SENTINEL_SHARE_RECORD_PREFIX, SentinelShareEnvelope,
    count_sentinel_share_records, create_sentinel_root_share_records_for_recipients,
    create_sentinel_share_records, create_sentinel_share_records_for_recipients,
    is_sentinel_share_stored_record, open_sentinel_share_for_identity,
    parse_sentinel_share_envelope, reconstruct_sentinel_vault_keys,
    reconstruct_sentinel_vault_keys_from_opened, sentinel_share_record_key,
};

/// Symmetric vault key (32-byte random hex).
pub fn generate_symmetric_key() -> MultiDeviceResult<SymmetricKey> {
    SymmetricKey::generate().map_err(MultiDeviceError::Validation)
}

/// Compact, URL-safe random ID (64-bit, base64url, no padding — 11 chars).
pub fn generate_id() -> MultiDeviceResult<CompactToken> {
    let mut bytes = [0u8; 8];
    getrandom::fill(&mut bytes).map_err(|e| MultiDeviceError::GenerateId(e.to_string()))?;
    CompactToken::parse(&URL_SAFE_NO_PAD.encode(bytes)).map_err(MultiDeviceError::Validation)
}

/// Back-compat alias for secret encryption key generation.
pub fn generate_dec() -> MultiDeviceResult<SymmetricKey> {
    generate_symmetric_key()
}

/// `secrets_key` encrypts user secrets; `members_key` encrypts member catalog entries.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VaultKeys {
    pub secrets_key: SymmetricKey,
    pub members_key: SymmetricKey,
}

pub fn generate_vault_keys() -> MultiDeviceResult<VaultKeys> {
    Ok(VaultKeys {
        secrets_key: generate_symmetric_key()?,
        members_key: generate_symmetric_key()?,
    })
}

/// `key_{sha256_hex}` or legacy bare 64-hex digest.
#[must_use]
pub fn is_auth_id(key: &str) -> bool {
    crate::is_auth_key_id(key)
}

#[must_use]
pub fn is_reserved_device_label(key: &str) -> bool {
    crate::is_device_id(key) || is_auth_id(key)
}

#[must_use]
pub fn dec_auth_id(identity: &DeviceIdentity) -> AuthKeyId {
    identity.auth_id()
}

pub fn dec_auth_id_from_public_key(public_key: &DevicePublicKey) -> MultiDeviceResult<AuthKeyId> {
    Ok(device_auth_id_from_public(
        &public_key
            .as_str()
            .parse::<Recipient>()
            .map_err(|e| MultiDeviceError::InvalidRecipientPublicKey(e.to_string()))?,
    ))
}

#[must_use]
pub fn join_record_key(device_id: &DeviceId) -> String {
    device_id.to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AuthEnvelopes {
    pub secrets_key: AgeArmoredCiphertext,
    pub members_key: AgeArmoredCiphertext,
}

pub fn parse_auth_envelopes(value: &str) -> MultiDeviceResult<AuthEnvelopes> {
    serde_json::from_str(value).map_err(MultiDeviceError::AuthEnvelopeJson)
}

#[must_use]
pub fn is_join_stored_record(record: &StoredSecretRecord) -> bool {
    matches!(VaultMetaRecord::classify(record), VaultMetaRecord::Join(..))
}

#[must_use]
pub fn is_auth_stored_record(record: &StoredSecretRecord) -> bool {
    matches!(VaultMetaRecord::classify(record), VaultMetaRecord::Auth(..))
}

/// Back-compat alias.
#[must_use]
pub fn is_dec_stored_record(record: &StoredSecretRecord) -> bool {
    is_auth_stored_record(record)
}

/// Internal flat-record prefix for members_key-encrypted member rows (YAML `members:` section).
pub fn parse_join_request(value: &str) -> MultiDeviceResult<JoinRequest> {
    serde_json::from_str(value).map_err(MultiDeviceError::JoinRequestJson)
}

#[must_use]
pub fn list_join_requests(records: &[StoredSecretRecord]) -> Vec<JoinRequest> {
    records
        .iter()
        .filter_map(|record| parse_join_request(record.value.as_str()).ok())
        .collect()
}

/// Replace in-memory join rows with the latest join rows from a freshly fetched vault file.
pub fn merge_remote_join_records(state: &mut VaultMetaState, fresh_records: &[StoredSecretRecord]) {
    state.joins.clear();
    for record in fresh_records {
        if let VaultMetaRecord::Join(device_id, join) = VaultMetaRecord::classify(record) {
            state.joins.insert(device_id, join);
        }
    }
}

#[must_use]
pub fn vault_has_multi_device_records(records: &[StoredSecretRecord]) -> bool {
    records.iter().any(|record| {
        is_auth_stored_record(record)
            || is_members_stored_record(record)
            || is_sentinel_share_stored_record(record)
            || is_join_stored_record(record)
    })
}

#[must_use]
pub fn user_stored_records(records: &[StoredSecretRecord]) -> Vec<StoredSecretRecord> {
    records
        .iter()
        .filter(|record| !is_vault_meta_record(record))
        .cloned()
        .collect()
}

#[must_use]
pub fn deny_join_request(
    records: &[StoredSecretRecord],
    join_device_id: &DeviceId,
) -> Vec<StoredSecretRecord> {
    let join_key = join_record_key(join_device_id);
    records
        .iter()
        .filter(|record| record.key.as_str() != join_key)
        .cloned()
        .collect()
}

pub fn auth_record(
    pk_id: &AuthKeyId,
    secrets_key: &SymmetricKey,
    members_key: &SymmetricKey,
    recipient_public: &DevicePublicKey,
) -> MultiDeviceResult<StoredSecretRecord> {
    Ok(StoredSecretRecord {
        key: SecretId::from_vault_record(pk_id.as_str()),
        secret_type: None,
        value: StoredRecordPayload::from_trusted(
            serde_json::to_string(&AuthEnvelopes {
                secrets_key: encrypt_for_recipient(
                    secrets_key.as_str().as_bytes(),
                    recipient_public,
                )?,
                members_key: encrypt_for_recipient(
                    members_key.as_str().as_bytes(),
                    recipient_public,
                )?,
            })
            .map_err(MultiDeviceError::AuthEnvelopesSerialize)?,
        ),
    })
}

pub fn genesis_auth_record(
    identity: &DeviceIdentity,
    secrets_key: &SymmetricKey,
    members_key: &SymmetricKey,
) -> MultiDeviceResult<StoredSecretRecord> {
    auth_record(
        &dec_auth_id(identity),
        secrets_key,
        members_key,
        &identity.public_key(),
    )
}

/// Back-compat alias — prefer `genesis_auth_record` with separate `secrets_key` and `members_key`.
pub fn genesis_dec_record(
    identity: &DeviceIdentity,
    dec: &str,
) -> MultiDeviceResult<StoredSecretRecord> {
    let key = SymmetricKey::parse(dec).map_err(MultiDeviceError::Validation)?;
    genesis_auth_record(identity, &key, &key)
}

pub fn create_join_request_record(
    identity: &DeviceIdentity,
    requested_at: &str,
) -> MultiDeviceResult<StoredSecretRecord> {
    create_join_request_record_with_signing_key(
        identity,
        requested_at,
        &DeviceSigningPublicKey::from_trusted(String::new()),
    )
}

pub fn create_join_request_record_with_signing_key(
    identity: &DeviceIdentity,
    requested_at: &str,
    signing_public_key: &DeviceSigningPublicKey,
) -> MultiDeviceResult<StoredSecretRecord> {
    let request = JoinRequest {
        device_id: identity.device_id().to_owned(),
        public_key: identity.public_key(),
        signing_public_key: signing_public_key.clone(),
        requested_at: requested_at.to_owned(),
    };
    Ok(StoredSecretRecord {
        key: SecretId::from_vault_record(&join_record_key(identity.device_id())),
        secret_type: None,
        value: StoredRecordPayload::from_trusted(
            serde_json::to_string(&request).map_err(MultiDeviceError::JoinRequestSerialize)?,
        ),
    })
}

pub fn approve_join_request(
    secrets_key: &SymmetricKey,
    members_key: &SymmetricKey,
    join: &JoinRequest,
    approver: &DeviceIdentity,
    records: &[StoredSecretRecord],
) -> MultiDeviceResult<(StoredSecretRecord, String, Vec<StoredSecretRecord>)> {
    let pk_id = dec_auth_id_from_public_key(&join.public_key)?;
    let auth_record = auth_record(&pk_id, secrets_key, members_key, &join.public_key)?;
    let new_member = member_from_join(join)?;
    let roster = match resolve_member_roster(records, members_key) {
        Ok(existing) => roster_add_member(existing, new_member),
        Err(_) => vec![
            member_from_identity(approver, &join.requested_at),
            new_member,
        ],
    };
    let member_records = build_members_records(&roster, members_key)?;
    Ok((
        auth_record,
        join_record_key(&join.device_id),
        member_records,
    ))
}

pub fn enroll_device_with_keys(
    secrets_key: &SymmetricKey,
    members_key: &SymmetricKey,
    identity: &DeviceIdentity,
    enrolled_at: &str,
) -> MultiDeviceResult<(StoredSecretRecord, Vec<StoredSecretRecord>)> {
    let auth = genesis_auth_record(identity, secrets_key, members_key)?;
    let members = genesis_members_records(identity, members_key, enrolled_at)?;
    Ok((auth, members))
}

/// Back-compat: OOB enroll when both keys are the same (tests only).
pub fn enroll_device_with_dec(
    dec: &str,
    identity: &DeviceIdentity,
    enrolled_at: &str,
) -> MultiDeviceResult<(StoredSecretRecord, StoredSecretRecord)> {
    let key = SymmetricKey::parse(dec).map_err(MultiDeviceError::Validation)?;
    let (auth, members) = enroll_device_with_keys(&key, &key, identity, enrolled_at)?;
    let members = members
        .into_iter()
        .next()
        .ok_or(MultiDeviceError::MemberRosterBuildFailed)?;
    Ok((auth, members))
}

fn resolve_auth_envelopes(
    records: &[StoredSecretRecord],
    identity: &DeviceIdentity,
) -> MultiDeviceResult<AuthEnvelopes> {
    let pk_id = identity.auth_id();
    let record = records
        .iter()
        .find(|entry| entry.key.as_str() == pk_id.as_str())
        .ok_or_else(|| MultiDeviceError::AuthEnvelopeNotFound {
            device_id: identity.device_id().to_string(),
            pk_id: pk_id.to_string(),
        })?;
    parse_auth_envelopes(record.value.as_str())
}

/// Resolve the `secrets_key` for this device from stored vault records.
pub fn resolve_secrets_key(
    records: &[StoredSecretRecord],
    identity: &DeviceIdentity,
) -> MultiDeviceResult<SymmetricKey> {
    let envelopes = resolve_auth_envelopes(records, identity)?;
    identity.decrypt_envelope(&envelopes.secrets_key)
}

/// Back-compat alias.
pub fn resolve_dek(
    records: &[StoredSecretRecord],
    identity: &DeviceIdentity,
) -> MultiDeviceResult<SymmetricKey> {
    resolve_secrets_key(records, identity)
}

/// Back-compat alias.
pub fn resolve_dec(
    records: &[StoredSecretRecord],
    identity: &DeviceIdentity,
) -> MultiDeviceResult<SymmetricKey> {
    resolve_secrets_key(records, identity)
}

/// Resolve the `members_key` for this device from stored vault records.
pub fn resolve_members_key(
    records: &[StoredSecretRecord],
    identity: &DeviceIdentity,
) -> MultiDeviceResult<SymmetricKey> {
    let envelopes = resolve_auth_envelopes(records, identity)?;
    identity.decrypt_envelope(&envelopes.members_key)
}

fn encrypt_with_recipient(
    plaintext: &[u8],
    recipient: &Recipient,
) -> MultiDeviceResult<AgeArmoredCiphertext> {
    use age::armor::{ArmoredWriter, Format};

    let encryptor =
        age::Encryptor::with_recipients(std::iter::once(recipient as &dyn age::Recipient))
            .map_err(|e| AgeCryptoError::EncryptSetup(e.to_string()))?;

    let mut armored = Vec::new();
    let armor_writer = ArmoredWriter::wrap_output(&mut armored, Format::AsciiArmor)
        .map_err(|e| AgeCryptoError::ArmorWrap(e.to_string()))?;
    let mut writer = encryptor
        .wrap_output(armor_writer)
        .map_err(|e| AgeCryptoError::Encrypt(e.to_string()))?;
    writer
        .write_all(plaintext)
        .map_err(|e| AgeCryptoError::Write(e.to_string()))?;
    writer
        .finish()
        .map_err(|e| AgeCryptoError::Finish(e.to_string()))?
        .finish()
        .map_err(|e| AgeCryptoError::ArmorFinish(e.to_string()))?;

    let armored =
        String::from_utf8(armored).map_err(|e| AgeCryptoError::InvalidUtf8Armor(e.to_string()))?;
    Ok(AgeArmoredCiphertext::from_trusted_armored(armored))
}

fn decrypt_with_identity(
    envelope: &AgeArmoredCiphertext,
    identity: &Identity,
) -> MultiDeviceResult<String> {
    use age::armor::ArmoredReader;

    let decryptor = age::Decryptor::new_buffered(ArmoredReader::new(envelope.as_str().as_bytes()))
        .map_err(|e| AgeCryptoError::DecryptSetup(e.to_string()))?;
    let mut reader = decryptor
        .decrypt(std::iter::once(identity as &dyn age::Identity))
        .map_err(|e| AgeCryptoError::Decrypt(e.to_string()))?;
    let mut decrypted = String::new();
    reader
        .read_to_string(&mut decrypted)
        .map_err(|e| AgeCryptoError::Read(e.to_string()))?;
    Ok(decrypted)
}

#[cfg(test)]
mod tests {
    use super::*;

    const ENROLLED_AT: &str = "2026-06-21T00:00:00Z";
    fn genesis_vault(
        keys: &VaultKeys,
    ) -> anyhow::Result<(DeviceIdentity, Vec<StoredSecretRecord>)> {
        let genesis = DeviceIdentity::generate()?;
        let mut records = vec![genesis_auth_record(
            &genesis,
            &keys.secrets_key,
            &keys.members_key,
        )?];
        records.extend(genesis_members_records(
            &genesis,
            &keys.members_key,
            ENROLLED_AT,
        )?);
        Ok((genesis, records))
    }

    fn user_secret_record(id: &str, value: &str) -> StoredSecretRecord {
        StoredSecretRecord {
            key: SecretId::from_vault_record(id),
            secret_type: Some(SecretType::Login),
            value: StoredRecordPayload::from_trusted(value.to_owned()),
        }
    }

    fn approve_pending_join(
        keys: &VaultKeys,
        approver: &DeviceIdentity,
        records: &mut Vec<StoredSecretRecord>,
        joiner: &DeviceIdentity,
    ) -> anyhow::Result<()> {
        let join = pending_join_for_device(records, joiner.device_id())
            .ok_or_else(|| std::io::Error::other("pending join fixture must exist"))?;
        let (auth_record, join_key, member_records) = approve_join_request(
            &keys.secrets_key,
            &keys.members_key,
            &join,
            approver,
            records,
        )?;
        records.retain(|record| record.key.as_str() != join_key);
        records.push(auth_record);
        replace_member_records(records, member_records);
        Ok(())
    }

    #[test]
    fn genesis_device_can_decrypt_vault_keys() -> anyhow::Result<()> {
        let keys = generate_vault_keys()?;
        let (genesis, records) = genesis_vault(&keys)?;
        assert_eq!(resolve_secrets_key(&records, &genesis)?, keys.secrets_key);
        assert_eq!(resolve_members_key(&records, &genesis)?, keys.members_key);
        Ok(())
    }

    #[test]
    fn second_device_join_request_and_approval_roundtrips_key_access() -> anyhow::Result<()> {
        let keys = generate_vault_keys()?;
        let (genesis, mut records) = genesis_vault(&keys)?;

        let joiner = DeviceIdentity::generate()?;
        records.push(create_join_request_record(&joiner, ENROLLED_AT)?);

        approve_pending_join(&keys, &genesis, &mut records, &joiner)?;

        assert_eq!(resolve_secrets_key(&records, &joiner)?, keys.secrets_key);
        assert_eq!(resolve_members_key(&records, &joiner)?, keys.members_key);
        assert_eq!(resolve_member_roster(&records, &keys.members_key)?.len(), 2);
        Ok(())
    }

    #[test]
    fn vault_meta_state_classifies_roundtrips_and_removes_every_record_kind() -> anyhow::Result<()>
    {
        let keys = generate_vault_keys()?;
        let (genesis, mut records) = genesis_vault(&keys)?;
        let joiner = DeviceIdentity::generate()?;
        let sentinel_participant = DeviceIdentity::generate()?;
        let sentinel_record = create_sentinel_share_records(
            &keys,
            &[genesis.clone(), sentinel_participant.clone()],
            2,
        )?
        .pop()
        .ok_or_else(|| std::io::Error::other("sentinel share record must exist"))?;
        let join_record = create_join_request_record_with_signing_key(
            &joiner,
            ENROLLED_AT,
            &DeviceSigningPublicKey::from_trusted("a".repeat(64)),
        )?;
        let user_secret = user_secret_record("secret_login001", "encrypted-user-secret");
        records.push(join_record.clone());
        records.push(sentinel_record.clone());
        records.push(user_secret.clone());

        let mut state = VaultMetaState::from_stored_records(&records);
        assert_eq!(state.secrets.len(), 1);
        assert_eq!(state.auth.len(), 1);
        assert_eq!(state.joins.len(), 1);
        assert_eq!(state.members.len(), 1);
        assert_eq!(state.sentinel_shares.len(), 1);
        assert_eq!(
            state
                .joins
                .get(joiner.device_id())
                .ok_or_else(|| std::io::Error::other("joining member must exist"))?
                .signing_public_key
                .as_str(),
            "a".repeat(64)
        );

        let flattened = state.to_stored_records();
        assert_eq!(VaultMetaState::from_stored_records(&flattened), state);
        assert_eq!(user_stored_records(&flattened), vec![user_secret.clone()]);

        state.remove_key(user_secret.key.as_str());
        state.remove_key(genesis.auth_id().as_str());
        state.remove_key(&member_stored_key(&genesis.auth_id()));
        state.remove_key(joiner.device_id().as_str());
        state.remove_key(sentinel_record.key.as_str());
        assert!(state.is_empty());

        assert!(matches!(
            VaultMetaRecord::classify(&user_secret),
            VaultMetaRecord::Secret(_, SecretType::Login, _)
        ));
        assert!(matches!(
            VaultMetaRecord::classify(&join_record),
            VaultMetaRecord::Join(_, _)
        ));
        assert!(matches!(
            VaultMetaRecord::classify(&sentinel_record),
            VaultMetaRecord::SentinelShare(_, _)
        ));
        Ok(())
    }

    #[test]
    fn merge_remote_join_records_replaces_only_pending_join_bucket() -> anyhow::Result<()> {
        let keys = generate_vault_keys()?;
        let (genesis, mut records) = genesis_vault(&keys)?;
        records.push(user_secret_record("secret_api001", "encrypted-user-secret"));

        let stale_joiner = DeviceIdentity::generate()?;
        records.push(create_join_request_record(
            &stale_joiner,
            "2026-06-20T00:00:00Z",
        )?);
        let mut state = VaultMetaState::from_stored_records(&records);

        let fresh_joiner = DeviceIdentity::generate()?;
        let fresh_records = vec![create_join_request_record(&fresh_joiner, ENROLLED_AT)?];
        merge_remote_join_records(&mut state, &fresh_records);

        assert_eq!(state.secrets.len(), 1);
        assert_eq!(state.auth.len(), 1);
        assert_eq!(state.members.len(), 1);
        assert!(!state.joins.contains_key(stale_joiner.device_id()));
        assert_eq!(
            state.joins.keys().collect::<Vec<_>>(),
            vec![fresh_joiner.device_id()]
        );
        assert_eq!(
            resolve_secrets_key(&state.to_stored_records(), &genesis)?,
            keys.secrets_key
        );
        Ok(())
    }

    #[test]
    fn approve_join_falls_back_to_approver_when_roster_is_missing() -> anyhow::Result<()> {
        let keys = generate_vault_keys()?;
        let genesis = DeviceIdentity::generate()?;
        let joiner = DeviceIdentity::generate()?;
        let wrong_members_key = generate_symmetric_key()?;
        let corrupt_member_record = build_members_records(
            &[member_from_identity(&genesis, ENROLLED_AT)],
            &wrong_members_key,
        )?
        .into_iter()
        .next()
        .ok_or_else(|| std::io::Error::other("member record must exist"))?;
        let records = vec![
            create_join_request_record(&joiner, ENROLLED_AT)?,
            corrupt_member_record,
        ];
        let join = pending_join_for_device(&records, joiner.device_id())
            .ok_or_else(|| std::io::Error::other("pending join must exist"))?;

        let (auth_record, join_key, member_records) = approve_join_request(
            &keys.secrets_key,
            &keys.members_key,
            &join,
            &genesis,
            &records,
        )?;
        let mut approved_records = vec![auth_record];
        approved_records.extend(member_records);

        assert_eq!(join_key, join_record_key(joiner.device_id()));
        assert_eq!(
            resolve_secrets_key(&approved_records, &joiner)?,
            keys.secrets_key
        );
        let roster = resolve_member_roster(&approved_records, &keys.members_key)?;
        assert_eq!(roster.len(), 2);
        assert!(
            roster
                .iter()
                .any(|member| member.auth_id == genesis.auth_id())
        );
        assert!(
            roster
                .iter()
                .any(|member| member.auth_id == joiner.auth_id())
        );
        Ok(())
    }
}

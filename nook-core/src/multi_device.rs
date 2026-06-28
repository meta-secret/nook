use crate::{StoredSecretRecord, VaultCrypto};
use age::secrecy::ExposeSecret;
use age::x25519::{Identity, Recipient};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::hash::BuildHasher;
use std::io::{Read, Write};

/// Symmetric vault key (32-byte random hex).
pub fn generate_symmetric_key() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).map_err(|e| format!("Failed to generate key: {}", e))?;
    Ok(hex::encode(bytes))
}

/// Compact, URL-safe random ID (64-bit, base64url, no padding — 11 chars).
pub fn generate_id() -> Result<String, String> {
    use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
    let mut bytes = [0u8; 8];
    getrandom::getrandom(&mut bytes).map_err(|e| format!("Failed to generate id: {}", e))?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

/// Back-compat alias for secret encryption key generation.
pub fn generate_dec() -> Result<String, String> {
    generate_symmetric_key()
}

/// `secrets_key` encrypts user secrets; `members_key` encrypts member catalog entries.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VaultKeys {
    pub secrets_key: String,
    pub members_key: String,
}

pub fn generate_vault_keys() -> Result<VaultKeys, String> {
    Ok(VaultKeys {
        secrets_key: generate_symmetric_key()?,
        members_key: generate_symmetric_key()?,
    })
}

/// Short fingerprint for UI, joins, and `IndexedDB` (first 8 bytes of SHA256).
#[must_use]
pub fn is_device_id(key: &str) -> bool {
    key.len() == 16 && key.bytes().all(|byte| byte.is_ascii_hexdigit())
}

/// `key_{sha256_hex}` or legacy bare 64-hex digest.
#[must_use]
pub fn is_auth_id(key: &str) -> bool {
    crate::is_auth_key_id(key)
}

#[must_use]
pub fn is_reserved_device_label(key: &str) -> bool {
    is_device_id(key) || is_auth_id(key)
}

#[must_use]
pub fn dec_auth_id(identity: &DeviceIdentity) -> String {
    device_auth_id_from_public(&identity.identity.to_public())
}

pub fn dec_auth_id_from_public_key(public_key: &str) -> Result<String, String> {
    let recipient = public_key
        .parse::<Recipient>()
        .map_err(|e| format!("Invalid recipient public key: {}", e))?;
    Ok(device_auth_id_from_public(&recipient))
}

#[must_use]
pub fn join_record_key(device_id: &str) -> String {
    device_id.to_owned()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AuthEnvelopes {
    pub secrets_key: String,
    pub members_key: String,
}

pub fn parse_auth_envelopes(value: &str) -> Result<AuthEnvelopes, String> {
    let envelopes: AuthEnvelopes =
        serde_json::from_str(value).map_err(|e| format!("Invalid auth envelope JSON: {}", e))?;
    if !envelopes.secrets_key.contains("BEGIN AGE ENCRYPTED FILE")
        || !envelopes.members_key.contains("BEGIN AGE ENCRYPTED FILE")
    {
        return Err("Auth envelope missing age-armored secrets_key or members_key.".to_owned());
    }
    Ok(envelopes)
}

#[must_use]
pub fn is_join_stored_record(record: &StoredSecretRecord) -> bool {
    parse_join_request(&record.value).is_ok()
}

#[must_use]
pub fn is_auth_stored_record(record: &StoredSecretRecord) -> bool {
    !is_join_stored_record(record)
        && is_auth_id(&record.key)
        && parse_auth_envelopes(&record.value).is_ok()
}

/// Back-compat alias.
#[must_use]
pub fn is_dec_stored_record(record: &StoredSecretRecord) -> bool {
    is_auth_stored_record(record)
}

/// Internal flat-record prefix for members_key-encrypted member rows (YAML `members:` section).
pub const MEMBER_RECORD_PREFIX: &str = "member:";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MemberEntry {
    pub pk_id: String,
    pub pk: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub enrolled_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VaultMember {
    pub auth_id: String,
    pub device_id: String,
    pub public_key: String,
    pub enrolled_at: String,
    pub label: Option<String>,
}

#[must_use]
pub fn member_stored_key(pk_id: &str) -> String {
    format!("{MEMBER_RECORD_PREFIX}{pk_id}")
}

/// Whether a flat-record key matches the pk_id inside the decrypted member entry.
/// YAML load normalizes `pk_id` to `key_{digest}` while legacy ciphertext may still
/// store the bare 64-hex digest — accept both forms.
fn member_record_key_matches(stored_key: &str, entry_pk_id: &str) -> bool {
    if stored_key == member_stored_key(entry_pk_id) {
        return true;
    }
    if let Ok(normalized) = crate::normalize_auth_key_id(entry_pk_id) {
        return stored_key == member_stored_key(&normalized);
    }
    false
}

#[must_use]
pub fn is_members_stored_record(record: &StoredSecretRecord) -> bool {
    record.key.starts_with(MEMBER_RECORD_PREFIX)
        && record.value.contains("BEGIN AGE ENCRYPTED FILE")
}

#[must_use]
pub fn is_vault_meta_record(record: &StoredSecretRecord) -> bool {
    is_join_stored_record(record)
        || is_auth_stored_record(record)
        || is_members_stored_record(record)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct JoinRequest {
    pub device_id: String,
    pub public_key: String,
    pub requested_at: String,
}

/// Per-device X25519 identity used to unwrap `secrets_key/members_key` from the vault file.
#[derive(Clone)]
pub struct DeviceIdentity {
    identity: Identity,
    device_id: String,
}

impl DeviceIdentity {
    pub fn generate() -> Result<Self, String> {
        let identity = Identity::generate();
        let device_id = device_id_from_public(&identity.to_public());
        Ok(Self {
            identity,
            device_id,
        })
    }

    pub fn from_secret_str(secret: &str) -> Result<Self, String> {
        let identity = secret
            .parse::<Identity>()
            .map_err(|e| format!("Invalid device identity: {}", e))?;
        let device_id = device_id_from_public(&identity.to_public());
        Ok(Self {
            identity,
            device_id,
        })
    }

    #[must_use]
    pub fn device_id(&self) -> &str {
        &self.device_id
    }

    #[must_use]
    pub fn public_key(&self) -> String {
        self.identity.to_public().to_string()
    }

    #[must_use]
    pub fn secret_string(&self) -> String {
        self.identity.to_string().expose_secret().to_owned()
    }

    #[must_use]
    pub fn auth_id(&self) -> String {
        device_auth_id_from_public(&self.identity.to_public())
    }

    pub fn decrypt_envelope(&self, envelope: &str) -> Result<String, String> {
        decrypt_with_identity(envelope, &self.identity)
    }

    /// Back-compat alias.
    pub fn decrypt_dec_envelope(&self, envelope: &str) -> Result<String, String> {
        self.decrypt_envelope(envelope)
    }
}

pub fn device_id_from_public(recipient: &Recipient) -> String {
    let hash = Sha256::digest(recipient.to_string().as_bytes());
    hex::encode(&hash[..8])
}

pub fn device_id_from_public_key(public_key: &str) -> Result<String, String> {
    let recipient = public_key
        .parse::<Recipient>()
        .map_err(|e| format!("Invalid recipient public key: {}", e))?;
    Ok(device_id_from_public(&recipient))
}

#[must_use]
pub fn device_auth_id_from_public(recipient: &Recipient) -> String {
    let hash = Sha256::digest(recipient.to_string().as_bytes());
    crate::format_auth_key_id(&hex::encode(hash)).expect("sha256 hex is valid auth digest")
}

pub fn encrypt_for_recipient(plaintext: &[u8], recipient_public: &str) -> Result<String, String> {
    let recipient = recipient_public
        .parse::<Recipient>()
        .map_err(|e| format!("Invalid recipient public key: {}", e))?;
    encrypt_with_recipient(plaintext, &recipient)
}

pub fn parse_join_request(value: &str) -> Result<JoinRequest, String> {
    serde_json::from_str(value).map_err(|e| format!("Invalid join request JSON: {}", e))
}

#[must_use]
pub fn list_join_requests(records: &[StoredSecretRecord]) -> Vec<JoinRequest> {
    records
        .iter()
        .filter_map(|record| parse_join_request(&record.value).ok())
        .collect()
}

/// Replace in-memory join rows with the latest join rows from a freshly fetched vault file.
pub fn merge_remote_join_records<S: BuildHasher>(
    armored: &mut HashMap<String, String, S>,
    fresh_records: &[StoredSecretRecord],
) {
    armored.retain(|_, value| {
        !is_join_stored_record(&StoredSecretRecord {
            key: String::new(),
            secret_type: None,
            value: value.clone(),
        })
    });
    for record in fresh_records {
        if is_join_stored_record(record) {
            armored.insert(record.key.clone(), record.value.clone());
        }
    }
}

#[must_use]
pub fn vault_has_multi_device_records(records: &[StoredSecretRecord]) -> bool {
    records.iter().any(is_auth_stored_record)
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
pub fn member_from_identity(identity: &DeviceIdentity, enrolled_at: &str) -> VaultMember {
    VaultMember {
        auth_id: identity.auth_id(),
        device_id: identity.device_id().to_owned(),
        public_key: identity.public_key(),
        enrolled_at: enrolled_at.to_owned(),
        label: None,
    }
}

pub fn member_from_join(join: &JoinRequest) -> Result<VaultMember, String> {
    Ok(VaultMember {
        auth_id: dec_auth_id_from_public_key(&join.public_key)?,
        device_id: join.device_id.clone(),
        public_key: join.public_key.clone(),
        enrolled_at: join.requested_at.clone(),
        label: None,
    })
}

fn member_to_entry(member: &VaultMember) -> MemberEntry {
    MemberEntry {
        pk_id: member.auth_id.clone(),
        pk: member.public_key.clone(),
        label: member.label.clone(),
        enrolled_at: member.enrolled_at.clone(),
    }
}

fn entry_to_member(entry: &MemberEntry) -> Result<VaultMember, String> {
    Ok(VaultMember {
        auth_id: entry.pk_id.clone(),
        device_id: device_id_from_public_key(&entry.pk)?,
        public_key: entry.pk.clone(),
        enrolled_at: entry.enrolled_at.clone(),
        label: entry.label.clone(),
    })
}

pub fn encrypt_member_entry(entry: &MemberEntry, members_key: &str) -> Result<String, String> {
    let json = serde_json::to_string(entry)
        .map_err(|e| format!("Failed to serialize member entry: {}", e))?;
    VaultCrypto::new(members_key)?.encrypt_value(&json)
}

pub fn decrypt_member_entry(ciphertext: &str, members_key: &str) -> Result<MemberEntry, String> {
    let json = VaultCrypto::new(members_key)?.decrypt_value(ciphertext)?;
    serde_json::from_str(&json).map_err(|e| format!("Invalid member entry JSON: {}", e))
}

pub fn build_members_records(
    roster: &[VaultMember],
    members_key: &str,
) -> Result<Vec<StoredSecretRecord>, String> {
    let mut records = Vec::with_capacity(roster.len());
    for member in roster {
        let entry = member_to_entry(member);
        records.push(StoredSecretRecord {
            key: member_stored_key(&entry.pk_id),
            secret_type: None,
            value: encrypt_member_entry(&entry, members_key)?,
        });
    }
    Ok(records)
}

pub fn resolve_member_roster(
    records: &[StoredSecretRecord],
    members_key: &str,
) -> Result<Vec<VaultMember>, String> {
    let mut roster = Vec::new();
    for record in records.iter().filter(|r| is_members_stored_record(r)) {
        let entry = decrypt_member_entry(&record.value, members_key)?;
        if !member_record_key_matches(&record.key, &entry.pk_id) {
            let expected_key = member_stored_key(
                &crate::normalize_auth_key_id(&entry.pk_id).unwrap_or_else(|_| entry.pk_id.clone()),
            );
            return Err(format!(
                "Member record key mismatch: expected {expected_key}, got {}",
                record.key
            ));
        }
        roster.push(entry_to_member(&entry)?);
    }
    roster.sort_by(|a, b| a.auth_id.cmp(&b.auth_id));
    Ok(roster)
}

#[must_use]
pub fn roster_add_member(mut roster: Vec<VaultMember>, member: VaultMember) -> Vec<VaultMember> {
    roster.retain(|entry| entry.auth_id != member.auth_id);
    roster.push(member);
    roster.sort_by(|a, b| a.auth_id.cmp(&b.auth_id));
    roster
}

pub fn genesis_members_records(
    identity: &DeviceIdentity,
    members_key: &str,
    enrolled_at: &str,
) -> Result<Vec<StoredSecretRecord>, String> {
    build_members_records(&[member_from_identity(identity, enrolled_at)], members_key)
}

pub fn replace_member_records(
    records: &mut Vec<StoredSecretRecord>,
    member_records: Vec<StoredSecretRecord>,
) {
    records.retain(|record| !is_members_stored_record(record));
    records.extend(member_records);
}

pub fn rename_vault_member(
    records: &[StoredSecretRecord],
    members_key: &str,
    auth_id: &str,
    label: &str,
) -> Result<Vec<StoredSecretRecord>, String> {
    if !is_auth_id(auth_id) {
        return Err("Invalid member id.".to_owned());
    }
    let trimmed = label.trim();
    if trimmed.len() > 80 {
        return Err("Device name must be 80 characters or fewer.".to_owned());
    }
    let mut roster = resolve_member_roster(records, members_key)?;
    let member = roster
        .iter_mut()
        .find(|member| member.auth_id == auth_id)
        .ok_or_else(|| "Device not found.".to_owned())?;
    member.label = if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_owned())
    };
    build_members_records(&roster, members_key)
}

pub fn revoke_vault_member(
    records: &[StoredSecretRecord],
    members_key: &str,
    auth_id: &str,
) -> Result<Vec<StoredSecretRecord>, String> {
    if !is_auth_id(auth_id) {
        return Err("Invalid member id.".to_owned());
    }
    let roster = resolve_member_roster(records, members_key)?;
    if roster.len() <= 1 {
        return Err("Add another device or a vault password before removing this one.".to_owned());
    }
    if !roster.iter().any(|member| member.auth_id == auth_id) {
        return Err("Device not found.".to_owned());
    }

    let mut updated: Vec<StoredSecretRecord> = records
        .iter()
        .filter(|record| record.key != auth_id && record.key != member_stored_key(auth_id))
        .cloned()
        .collect();
    let remaining_roster: Vec<VaultMember> = roster
        .into_iter()
        .filter(|member| member.auth_id != auth_id)
        .collect();
    replace_member_records(
        &mut updated,
        build_members_records(&remaining_roster, members_key)?,
    );
    Ok(updated)
}

#[must_use]
pub fn deny_join_request(
    records: &[StoredSecretRecord],
    join_device_id: &str,
) -> Vec<StoredSecretRecord> {
    let join_key = join_record_key(join_device_id);
    records
        .iter()
        .filter(|record| record.key != join_key)
        .cloned()
        .collect()
}

pub fn auth_record(
    pk_id: &str,
    secrets_key: &str,
    members_key: &str,
    recipient_public: &str,
) -> Result<StoredSecretRecord, String> {
    Ok(StoredSecretRecord {
        key: pk_id.to_owned(),
        secret_type: None,
        value: serde_json::to_string(&AuthEnvelopes {
            secrets_key: encrypt_for_recipient(secrets_key.as_bytes(), recipient_public)?,
            members_key: encrypt_for_recipient(members_key.as_bytes(), recipient_public)?,
        })
        .map_err(|e| format!("Failed to serialize auth envelopes: {}", e))?,
    })
}

pub fn genesis_auth_record(
    identity: &DeviceIdentity,
    secrets_key: &str,
    members_key: &str,
) -> Result<StoredSecretRecord, String> {
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
) -> Result<StoredSecretRecord, String> {
    genesis_auth_record(identity, dec, dec)
}

pub fn create_join_request_record(
    identity: &DeviceIdentity,
    requested_at: &str,
) -> Result<StoredSecretRecord, String> {
    let request = JoinRequest {
        device_id: identity.device_id().to_owned(),
        public_key: identity.public_key(),
        requested_at: requested_at.to_owned(),
    };
    Ok(StoredSecretRecord {
        key: join_record_key(identity.device_id()),
        secret_type: None,
        value: serde_json::to_string(&request)
            .map_err(|e| format!("Failed to serialize join request: {}", e))?,
    })
}

pub fn approve_join_request(
    secrets_key: &str,
    members_key: &str,
    join: &JoinRequest,
    approver: &DeviceIdentity,
    records: &[StoredSecretRecord],
) -> Result<(StoredSecretRecord, String, Vec<StoredSecretRecord>), String> {
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
    secrets_key: &str,
    members_key: &str,
    identity: &DeviceIdentity,
    enrolled_at: &str,
) -> Result<(StoredSecretRecord, Vec<StoredSecretRecord>), String> {
    let auth = genesis_auth_record(identity, secrets_key, members_key)?;
    let members = genesis_members_records(identity, members_key, enrolled_at)?;
    Ok((auth, members))
}

/// Back-compat: OOB enroll when both keys are the same (tests only).
pub fn enroll_device_with_dec(
    dec: &str,
    identity: &DeviceIdentity,
    enrolled_at: &str,
) -> Result<(StoredSecretRecord, StoredSecretRecord), String> {
    let (auth, members) = enroll_device_with_keys(dec, dec, identity, enrolled_at)?;
    let members = members
        .into_iter()
        .next()
        .ok_or_else(|| "Failed to build member roster record.".to_owned())?;
    Ok((auth, members))
}

/// If this device holds `members_key` but has no roster row, add itself (fallback when approver missed it).
pub fn ensure_self_in_roster(
    records: &[StoredSecretRecord],
    identity: &DeviceIdentity,
    members_key: &str,
) -> Result<Option<Vec<StoredSecretRecord>>, String> {
    let roster = resolve_member_roster(records, members_key)?;
    if roster.iter().any(|m| m.auth_id == identity.auth_id()) {
        return Ok(None);
    }
    let updated = roster_add_member(roster, member_from_identity(identity, "self-sync"));
    Ok(Some(build_members_records(&updated, members_key)?))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectAccessStatus {
    Ready,
    NeedsEnrollment,
    JoinPending,
}

#[must_use]
pub fn assess_connect_access(
    records: &[StoredSecretRecord],
    identity: &DeviceIdentity,
) -> ConnectAccessStatus {
    if device_is_enrolled(records, identity) {
        ConnectAccessStatus::Ready
    } else if pending_join_for_device(records, identity.device_id()).is_some() {
        ConnectAccessStatus::JoinPending
    } else {
        ConnectAccessStatus::NeedsEnrollment
    }
}

#[must_use]
pub fn device_is_enrolled(records: &[StoredSecretRecord], identity: &DeviceIdentity) -> bool {
    let pk_id = identity.auth_id();
    records
        .iter()
        .any(|record| record.key == pk_id && is_auth_stored_record(record))
}

#[must_use]
pub fn pending_join_for_device(
    records: &[StoredSecretRecord],
    device_id: &str,
) -> Option<JoinRequest> {
    list_join_requests(records)
        .into_iter()
        .find(|join| join.device_id == device_id)
}

/// User-facing hint when `connect` cannot decrypt because this device has no auth row yet.
#[must_use]
pub fn explain_connect_blocked(
    records: &[StoredSecretRecord],
    identity: &DeviceIdentity,
) -> Option<String> {
    match assess_connect_access(records, identity) {
        ConnectAccessStatus::Ready => None,
        ConnectAccessStatus::JoinPending => Some(
            "Join request pending. An enrolled device must approve before you can connect. After approval, click Connect vault again.".to_owned(),
        ),
        ConnectAccessStatus::NeedsEnrollment => Some(
            "This device is not enrolled yet. Request access from an enrolled device, then connect again.".to_owned(),
        ),
    }
}

fn resolve_auth_envelopes(
    records: &[StoredSecretRecord],
    identity: &DeviceIdentity,
) -> Result<AuthEnvelopes, String> {
    let pk_id = identity.auth_id();
    let record = records
        .iter()
        .find(|entry| entry.key == pk_id)
        .ok_or_else(|| {
            format!(
                "No auth envelope found for device {} (pk_id {})",
                identity.device_id(),
                pk_id
            )
        })?;
    parse_auth_envelopes(&record.value)
}

/// Resolve the `secrets_key` for this device from stored vault records.
pub fn resolve_secrets_key(
    records: &[StoredSecretRecord],
    identity: &DeviceIdentity,
) -> Result<String, String> {
    let envelopes = resolve_auth_envelopes(records, identity)?;
    identity.decrypt_envelope(&envelopes.secrets_key)
}

/// Back-compat alias.
pub fn resolve_dek(
    records: &[StoredSecretRecord],
    identity: &DeviceIdentity,
) -> Result<String, String> {
    resolve_secrets_key(records, identity)
}

/// Back-compat alias.
pub fn resolve_dec(
    records: &[StoredSecretRecord],
    identity: &DeviceIdentity,
) -> Result<String, String> {
    resolve_secrets_key(records, identity)
}

/// Resolve the `members_key` for this device from stored vault records.
pub fn resolve_members_key(
    records: &[StoredSecretRecord],
    identity: &DeviceIdentity,
) -> Result<String, String> {
    let envelopes = resolve_auth_envelopes(records, identity)?;
    identity.decrypt_envelope(&envelopes.members_key)
}

fn encrypt_with_recipient(plaintext: &[u8], recipient: &Recipient) -> Result<String, String> {
    use age::armor::{ArmoredWriter, Format};

    let encryptor =
        age::Encryptor::with_recipients(std::iter::once(recipient as &dyn age::Recipient))
            .map_err(|e| format!("Age encryption setup error: {}", e))?;

    let mut armored = Vec::new();
    let armor_writer = ArmoredWriter::wrap_output(&mut armored, Format::AsciiArmor)
        .map_err(|e| format!("Age armor wrap error: {}", e))?;
    let mut writer = encryptor
        .wrap_output(armor_writer)
        .map_err(|e| format!("Age encryption error: {}", e))?;
    writer
        .write_all(plaintext)
        .map_err(|e| format!("Age write error: {}", e))?;
    writer
        .finish()
        .map_err(|e| format!("Age finish error: {}", e))?
        .finish()
        .map_err(|e| format!("Age armor finish error: {}", e))?;

    String::from_utf8(armored).map_err(|e| format!("Invalid UTF-8 age armor: {}", e))
}

fn decrypt_with_identity(envelope: &str, identity: &Identity) -> Result<String, String> {
    use age::armor::ArmoredReader;

    let decryptor = age::Decryptor::new_buffered(ArmoredReader::new(envelope.as_bytes()))
        .map_err(|e| format!("Age decryption setup error: {}", e))?;
    let mut reader = decryptor
        .decrypt(std::iter::once(identity as &dyn age::Identity))
        .map_err(|e| format!("Age decryption error: {}", e))?;
    let mut decrypted = String::new();
    reader
        .read_to_string(&mut decrypted)
        .map_err(|e| format!("Age read error: {}", e))?;
    Ok(decrypted)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn genesis_vault(keys: &VaultKeys) -> (DeviceIdentity, Vec<StoredSecretRecord>) {
        let genesis = DeviceIdentity::generate().unwrap();
        let mut records =
            vec![genesis_auth_record(&genesis, &keys.secrets_key, &keys.members_key).unwrap()];
        records.extend(
            genesis_members_records(&genesis, &keys.members_key, "2026-06-21T00:00:00Z").unwrap(),
        );
        (genesis, records)
    }

    #[test]
    fn genesis_device_can_decrypt_vault_keys() {
        let keys = generate_vault_keys().unwrap();
        let (genesis, records) = genesis_vault(&keys);
        assert_eq!(
            resolve_secrets_key(&records, &genesis).unwrap(),
            keys.secrets_key
        );
        assert_eq!(
            resolve_members_key(&records, &genesis).unwrap(),
            keys.members_key
        );
    }

    #[test]
    fn second_device_join_request_and_approval() {
        let keys = generate_vault_keys().unwrap();
        let (genesis, mut records) = genesis_vault(&keys);

        let joiner = DeviceIdentity::generate().unwrap();
        records.push(create_join_request_record(&joiner, "2026-06-21T00:00:00Z").unwrap());

        let pending = list_join_requests(&records);
        assert_eq!(pending.len(), 1);

        let (auth_record, join_key, member_records) = approve_join_request(
            &keys.secrets_key,
            &keys.members_key,
            &pending[0],
            &genesis,
            &records,
        )
        .unwrap();
        records.retain(|record| record.key != join_key);
        records.push(auth_record);
        replace_member_records(&mut records, member_records);

        assert_eq!(
            resolve_secrets_key(&records, &joiner).unwrap(),
            keys.secrets_key
        );
        assert_eq!(
            resolve_members_key(&records, &joiner).unwrap(),
            keys.members_key
        );

        let roster = resolve_member_roster(&records, &keys.members_key).unwrap();
        assert_eq!(roster.len(), 2);
        assert!(roster.iter().any(|m| m.device_id == joiner.device_id()));
    }

    #[test]
    fn device_can_self_enroll_when_keys_already_known() {
        let keys = generate_vault_keys().unwrap();
        let device = DeviceIdentity::generate().unwrap();
        let (auth, members) = enroll_device_with_keys(
            &keys.secrets_key,
            &keys.members_key,
            &device,
            "2026-06-21T00:00:00Z",
        )
        .unwrap();
        let mut records = vec![auth];
        records.extend(members);
        assert_eq!(
            resolve_secrets_key(&records, &device).unwrap(),
            keys.secrets_key
        );
        assert_eq!(
            resolve_members_key(&records, &device).unwrap(),
            keys.members_key
        );
        let roster = resolve_member_roster(&records, &keys.members_key).unwrap();
        assert_eq!(roster.len(), 1);
        assert_eq!(roster[0].auth_id, device.auth_id());
    }

    #[test]
    fn member_records_encrypted_with_members_key_not_per_device_age() {
        let keys = generate_vault_keys().unwrap();
        let (genesis, mut records) = genesis_vault(&keys);
        let joiner = DeviceIdentity::generate().unwrap();
        records.push(create_join_request_record(&joiner, "2026-06-21T01:00:00Z").unwrap());
        let join = list_join_requests(&records).pop().unwrap();
        let (auth_record, join_key, member_records) = approve_join_request(
            &keys.secrets_key,
            &keys.members_key,
            &join,
            &genesis,
            &records,
        )
        .unwrap();
        records.retain(|record| record.key != join_key);
        records.push(auth_record);
        replace_member_records(&mut records, member_records);

        let yaml = crate::serialize_stored(&records, crate::VaultFormat::Yaml).unwrap();
        assert!(yaml.contains("members:"));
        assert!(yaml.contains("ciphertext:"));
        assert!(!yaml.contains("age1"));

        let roundtripped =
            crate::deserialize_stored(&yaml, crate::VaultFormat::Yaml).unwrap();
        let roster = resolve_member_roster(&roundtripped, &keys.members_key).unwrap();
        assert_eq!(roster.len(), 2);
    }

    #[test]
    fn ensure_self_in_roster_adds_missing_device() {
        let keys = generate_vault_keys().unwrap();
        let (genesis, records) = genesis_vault(&keys);
        let joiner = DeviceIdentity::generate().unwrap();
        let (auth, _) = enroll_device_with_keys(
            &keys.secrets_key,
            &keys.members_key,
            &joiner,
            "2026-06-21T02:00:00Z",
        )
        .unwrap();
        let mut records = records;
        records.push(auth);

        let patch = ensure_self_in_roster(&records, &joiner, &keys.members_key).unwrap();
        assert!(patch.is_some());
        replace_member_records(&mut records, patch.unwrap());
        let roster = resolve_member_roster(&records, &keys.members_key).unwrap();
        assert_eq!(roster.len(), 2);
        let _ = genesis;
    }

    #[test]
    fn resolve_secrets_key_fails_without_auth_envelope() {
        let device = DeviceIdentity::generate().unwrap();
        assert!(resolve_secrets_key(&[], &device).is_err());
    }

    #[test]
    fn user_stored_records_filters_vault_meta() {
        let keys = generate_vault_keys().unwrap();
        let (genesis, mut records) = genesis_vault(&keys);
        records.push(StoredSecretRecord {
            key: "site".to_owned(),
            secret_type: Some(crate::SecretType::ApiKey),
            value: "cipher".to_owned(),
        });
        let users = user_stored_records(&records);
        assert_eq!(users.len(), 1);
        assert_eq!(users[0].key, "site");
        let _ = genesis;
    }

    #[test]
    fn auth_id_is_full_sha256_of_public_key() {
        let device = DeviceIdentity::generate().unwrap();
        assert_eq!(device.auth_id().len(), 68);
        assert!(device.auth_id().starts_with(crate::AUTH_KEY_ID_PREFIX));
        assert!(is_auth_id(&device.auth_id()));
        assert_ne!(device.auth_id(), device.device_id());
    }

    #[test]
    fn yaml_auth_uses_pk_id_not_public_key() {
        let keys = generate_vault_keys().unwrap();
        let device = DeviceIdentity::generate().unwrap();
        let record = genesis_auth_record(&device, &keys.secrets_key, &keys.members_key).unwrap();
        assert_eq!(record.key, device.auth_id());
        assert!(!record.key.contains("age1"));
        let env = parse_auth_envelopes(&record.value).unwrap();
        assert!(env.secrets_key.contains("BEGIN AGE ENCRYPTED FILE"));
        assert!(env.members_key.contains("BEGIN AGE ENCRYPTED FILE"));
    }

    #[test]
    fn generate_vault_keys_produces_distinct_secrets_and_members_keys() {
        let keys = generate_vault_keys().unwrap();
        assert_ne!(keys.secrets_key, keys.members_key);
        assert_eq!(keys.secrets_key.len(), 64);
        assert_eq!(keys.members_key.len(), 64);
    }

    #[test]
    fn resolve_dec_and_resolve_dek_match_resolve_secrets_key() {
        let keys = generate_vault_keys().unwrap();
        let (device, records) = genesis_vault(&keys);
        let secrets = resolve_secrets_key(&records, &device).unwrap();
        assert_eq!(resolve_dek(&records, &device).unwrap(), secrets);
        assert_eq!(resolve_dec(&records, &device).unwrap(), secrets);
    }

    #[test]
    fn member_entry_encrypt_decrypt_roundtrip() {
        let members_key = generate_symmetric_key().unwrap();
        let device = DeviceIdentity::generate().unwrap();
        let entry = MemberEntry {
            pk_id: device.auth_id(),
            pk: device.public_key(),
            label: Some("Work laptop".to_owned()),
            enrolled_at: "2026-06-21T05:00:00Z".to_owned(),
        };
        let ciphertext = encrypt_member_entry(&entry, &members_key).unwrap();
        let decoded = decrypt_member_entry(&ciphertext, &members_key).unwrap();
        assert_eq!(decoded, entry);
    }

    #[test]
    fn member_label_persists_through_roster_records() {
        let keys = generate_vault_keys().unwrap();
        let device = DeviceIdentity::generate().unwrap();
        let mut member = member_from_identity(&device, "2026-06-21T05:00:00Z");
        member.label = Some("Work laptop".to_owned());

        let records = build_members_records(&[member], &keys.members_key).unwrap();
        let roster = resolve_member_roster(&records, &keys.members_key).unwrap();
        assert_eq!(roster.len(), 1);
        assert_eq!(roster[0].label.as_deref(), Some("Work laptop"));
        assert_eq!(roster[0].enrolled_at, "2026-06-21T05:00:00Z");
    }

    #[test]
    fn rename_vault_member_updates_encrypted_roster() {
        let keys = generate_vault_keys().unwrap();
        let (device, mut records) = genesis_vault(&keys);
        let member_records = rename_vault_member(
            &records,
            &keys.members_key,
            &device.auth_id(),
            " Travel phone ",
        )
        .unwrap();
        replace_member_records(&mut records, member_records);

        let roster = resolve_member_roster(&records, &keys.members_key).unwrap();
        assert_eq!(roster[0].label.as_deref(), Some("Travel phone"));

        let member_records =
            rename_vault_member(&records, &keys.members_key, &device.auth_id(), "").unwrap();
        replace_member_records(&mut records, member_records);
        let roster = resolve_member_roster(&records, &keys.members_key).unwrap();
        assert_eq!(roster[0].label, None);
    }

    #[test]
    fn revoke_vault_member_removes_auth_and_roster_row() {
        let keys = generate_vault_keys().unwrap();
        let (genesis, mut records) = genesis_vault(&keys);
        let joiner = DeviceIdentity::generate().unwrap();
        records.push(create_join_request_record(&joiner, "2026-06-21T04:00:00Z").unwrap());
        let join = list_join_requests(&records).pop().unwrap();
        let (auth, join_key, member_records) = approve_join_request(
            &keys.secrets_key,
            &keys.members_key,
            &join,
            &genesis,
            &records,
        )
        .unwrap();
        records.retain(|record| record.key != join_key);
        records.push(auth);
        replace_member_records(&mut records, member_records);

        let updated = revoke_vault_member(&records, &keys.members_key, &joiner.auth_id()).unwrap();
        assert!(resolve_secrets_key(&updated, &joiner).is_err());
        assert_eq!(
            resolve_secrets_key(&updated, &genesis).unwrap(),
            keys.secrets_key
        );
        let roster = resolve_member_roster(&updated, &keys.members_key).unwrap();
        assert_eq!(roster.len(), 1);
        assert_eq!(roster[0].auth_id, genesis.auth_id());
    }

    #[test]
    fn revoke_last_member_is_blocked() {
        let keys = generate_vault_keys().unwrap();
        let (device, records) = genesis_vault(&keys);
        let err = revoke_vault_member(&records, &keys.members_key, &device.auth_id()).unwrap_err();
        assert!(err.contains("Add another device"));
    }

    #[test]
    fn deny_join_request_removes_pending_join() {
        let joiner = DeviceIdentity::generate().unwrap();
        let records = vec![create_join_request_record(&joiner, "2026-06-21T04:00:00Z").unwrap()];
        let updated = deny_join_request(&records, joiner.device_id());
        assert!(list_join_requests(&updated).is_empty());
    }

    #[test]
    fn wrong_members_key_cannot_decrypt_roster() {
        let keys = generate_vault_keys().unwrap();
        let other = generate_vault_keys().unwrap();
        let (genesis, records) = genesis_vault(&keys);
        assert!(resolve_member_roster(&records, &other.members_key).is_err());
        let _ = genesis;
    }

    #[test]
    fn parse_auth_envelopes_rejects_incomplete_json() {
        assert!(parse_auth_envelopes(r#"{"secrets_key":"x","members_key":"y"}"#).is_err());
        assert!(parse_auth_envelopes("not-json").is_err());
    }

    #[test]
    fn serialized_auth_yaml_uses_secrets_key_and_members_key_not_legacy_names() {
        let keys = generate_vault_keys().unwrap();
        let (genesis, records) = genesis_vault(&keys);
        let yaml = crate::serialize_stored(&records, crate::VaultFormat::Yaml).unwrap();
        assert!(yaml.contains("secrets_key:"));
        assert!(yaml.contains("members_key:"));
        assert!(!yaml.contains("\ndek:"));
        assert!(!yaml.contains("\nmek:"));
        assert!(!yaml.contains("\ndec:"));
        let _ = genesis;
    }

    #[test]
    fn explain_connect_blocked_when_not_enrolled() {
        let keys = generate_vault_keys().unwrap();
        let (genesis, records) = genesis_vault(&keys);
        let joiner = DeviceIdentity::generate().unwrap();
        let msg = explain_connect_blocked(&records, &joiner).expect("should block");
        assert!(msg.contains("not enrolled"));
        let _ = genesis;
    }

    #[test]
    fn assess_connect_access_when_not_enrolled() {
        let keys = generate_vault_keys().unwrap();
        let (genesis, records) = genesis_vault(&keys);
        let joiner = DeviceIdentity::generate().unwrap();
        assert_eq!(
            assess_connect_access(&records, &joiner),
            ConnectAccessStatus::NeedsEnrollment
        );
        let _ = genesis;
    }

    #[test]
    fn vault_without_auth_records_is_not_multi_device() {
        let joiner = DeviceIdentity::generate().unwrap();
        let join = create_join_request_record(&joiner, "2026-01-01T00:00:00Z").unwrap();
        let records = vec![join];
        assert!(!vault_has_multi_device_records(&records));
    }

    #[test]
    fn assess_connect_access_when_join_pending() {
        let keys = generate_vault_keys().unwrap();
        let (genesis, mut records) = genesis_vault(&keys);
        let joiner = DeviceIdentity::generate().unwrap();
        let join = create_join_request_record(&joiner, "2026-01-01T00:00:00Z").unwrap();
        records.push(join);
        assert_eq!(
            assess_connect_access(&records, &joiner),
            ConnectAccessStatus::JoinPending
        );
        let _ = genesis;
    }

    #[test]
    fn merge_remote_join_records_replaces_stale_join_rows() {
        let keys = generate_vault_keys().unwrap();
        let (genesis, armored_records) = genesis_vault(&keys);
        let joiner = DeviceIdentity::generate().unwrap();
        let join = create_join_request_record(&joiner, "2026-01-01T00:00:00Z").unwrap();
        let mut armored = records_to_armored_map(&armored_records);
        merge_remote_join_records(&mut armored, std::slice::from_ref(&join));
        assert_eq!(list_join_requests(&records_from_armored(&armored)).len(), 1);

        let joiner2 = DeviceIdentity::generate().unwrap();
        let join2 = create_join_request_record(&joiner2, "2026-01-02T00:00:00Z").unwrap();
        merge_remote_join_records(&mut armored, std::slice::from_ref(&join2));
        let pending_joins = list_join_requests(&records_from_armored(&armored));
        assert_eq!(pending_joins.len(), 1);
        assert_eq!(pending_joins[0].device_id, joiner2.device_id());
        let _ = genesis;
    }

    fn records_to_armored_map(
        records: &[StoredSecretRecord],
    ) -> std::collections::HashMap<String, String> {
        records
            .iter()
            .map(|record| (record.key.clone(), record.value.clone()))
            .collect()
    }

    fn records_from_armored(
        armored: &std::collections::HashMap<String, String>,
    ) -> Vec<StoredSecretRecord> {
        armored
            .iter()
            .map(|(key, value)| StoredSecretRecord {
                key: key.clone(),
                secret_type: None,
                value: value.clone(),
            })
            .collect()
    }

    #[test]
    fn assess_connect_access_when_enrolled() {
        let keys = generate_vault_keys().unwrap();
        let (genesis, records) = genesis_vault(&keys);
        assert_eq!(
            assess_connect_access(&records, &genesis),
            ConnectAccessStatus::Ready
        );
    }
}

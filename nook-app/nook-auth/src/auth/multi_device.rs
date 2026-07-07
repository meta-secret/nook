use crate::errors::{AgeCryptoError, MultiDeviceError, MultiDeviceResult};
use crate::{
    AgeArmoredCiphertext, AuthKeyId, CompactToken, DeviceId, DeviceIdentitySecret, DevicePublicKey,
    DeviceSigningPublicKey, SecretId, SecretType, StoredRecordPayload, StoredSecretRecord,
    SymmetricKey, VaultCrypto,
};
use age::secrecy::ExposeSecret;
use age::x25519::{Identity, Recipient};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::{Read, Write};

/// Symmetric vault key (32-byte random hex).
pub fn generate_symmetric_key() -> MultiDeviceResult<SymmetricKey> {
    SymmetricKey::generate().map_err(MultiDeviceError::Validation)
}

/// Compact, URL-safe random ID (64-bit, base64url, no padding — 11 chars).
pub fn generate_id() -> MultiDeviceResult<CompactToken> {
    use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
    let mut bytes = [0u8; 8];
    getrandom::getrandom(&mut bytes).map_err(|e| MultiDeviceError::GenerateId(e.to_string()))?;
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
    device_auth_id_from_public(&identity.identity.to_public())
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
pub const MEMBER_RECORD_PREFIX: &str = "member:";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MemberEntry {
    pub pk_id: AuthKeyId,
    pub pk: DevicePublicKey,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub enrolled_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VaultMember {
    pub auth_id: AuthKeyId,
    pub device_id: DeviceId,
    pub public_key: DevicePublicKey,
    pub enrolled_at: String,
    pub label: Option<String>,
}

#[must_use]
pub fn member_stored_key(pk_id: &AuthKeyId) -> String {
    format!("{MEMBER_RECORD_PREFIX}{pk_id}")
}

/// Whether a flat-record key matches the `pk_id` inside the decrypted member entry.
/// YAML load normalizes `pk_id` to `key_{digest}` while legacy ciphertext may still
/// store the bare 64-hex digest — accept both forms.
fn member_record_key_matches(stored_key: &str, entry_pk_id: &AuthKeyId) -> bool {
    if stored_key == member_stored_key(entry_pk_id) {
        return true;
    }
    if let Ok(normalized) = crate::normalize_auth_key_id(entry_pk_id.as_str()) {
        return stored_key == member_stored_key(&normalized);
    }
    false
}

#[must_use]
pub fn is_members_stored_record(record: &StoredSecretRecord) -> bool {
    matches!(
        VaultMetaRecord::classify(record),
        VaultMetaRecord::Member(..)
    )
}

#[must_use]
pub fn is_vault_meta_record(record: &StoredSecretRecord) -> bool {
    !matches!(
        VaultMetaRecord::classify(record),
        VaultMetaRecord::Secret(..)
    )
}

/// Single classification site for the four record kinds that share the
/// `StoredSecretRecord { key, secret_type, value }` wire shape.
///
/// Replaces scattered `is_join_stored_record` / `is_auth_stored_record` /
/// `is_members_stored_record` probing at call sites that need to branch on
/// record kind. Those helpers remain as thin wrappers over this for
/// call sites that only need a boolean (e.g. wire-boundary partitioning in
/// `vault_format.rs`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VaultMetaRecord {
    /// A user-visible secret: id, its declared type, and the age-armored ciphertext.
    Secret(SecretId, SecretType, StoredRecordPayload),
    /// This device's (or another enrolled device's) auth envelope pair.
    Auth(AuthKeyId, AuthEnvelopes),
    /// A pending join request awaiting approval.
    Join(DeviceId, JoinRequest),
    /// A roster entry, still encrypted with `members_key`.
    Member(AuthKeyId, StoredRecordPayload),
}

impl VaultMetaRecord {
    #[must_use]
    pub fn classify(record: &StoredSecretRecord) -> Self {
        if let Ok(join) = parse_join_request(record.value.as_str()) {
            return Self::Join(join.device_id.clone(), join);
        }
        if let Some(pk_id_str) = record.key.as_str().strip_prefix(MEMBER_RECORD_PREFIX)
            && record.value.as_str().contains("BEGIN AGE ENCRYPTED FILE")
            && let Ok(auth_id) = AuthKeyId::parse(pk_id_str)
        {
            return Self::Member(auth_id, record.value.clone());
        }
        if is_auth_id(record.key.as_str())
            && let Ok(envelopes) = parse_auth_envelopes(record.value.as_str())
            && let Ok(auth_id) = AuthKeyId::parse(record.key.as_str())
        {
            return Self::Auth(auth_id, envelopes);
        }
        Self::Secret(
            record.key.clone(),
            record.secret_type.unwrap_or(SecretType::SecureNote),
            record.value.clone(),
        )
    }

    /// Wire-boundary encoding back to the shared `StoredSecretRecord` shape.
    pub fn to_stored(&self) -> MultiDeviceResult<StoredSecretRecord> {
        Ok(match self {
            Self::Secret(id, secret_type, payload) => StoredSecretRecord {
                key: id.clone(),
                secret_type: Some(*secret_type),
                value: payload.clone(),
            },
            Self::Auth(auth_id, envelopes) => StoredSecretRecord {
                key: SecretId::from_vault_record(auth_id.as_str()),
                secret_type: None,
                value: StoredRecordPayload::from_trusted(
                    serde_json::to_string(envelopes)
                        .map_err(MultiDeviceError::AuthEnvelopesSerialize)?,
                ),
            },
            Self::Join(_, join) => StoredSecretRecord {
                key: SecretId::from_vault_record(&join_record_key(&join.device_id)),
                secret_type: None,
                value: StoredRecordPayload::from_trusted(
                    serde_json::to_string(join).map_err(MultiDeviceError::JoinRequestSerialize)?,
                ),
            },
            Self::Member(auth_id, payload) => StoredSecretRecord {
                key: SecretId::from_vault_record(&member_stored_key(auth_id)),
                secret_type: None,
                value: payload.clone(),
            },
        })
    }
}

/// Typed replacement for the flat `armored: HashMap<String, String>` meta cache:
/// one bucket per record kind instead of four implicit kinds sharing one map.
///
/// Built from / flattened back to `StoredSecretRecord` rows at the wire
/// boundary via [`VaultMetaState::from_stored_records`] /
/// [`VaultMetaState::to_stored_records`] so on-disk YAML shape is
/// unaffected — this type only changes how the meta cache is held and
/// mutated in memory.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct VaultMetaState {
    pub secrets: HashMap<SecretId, (SecretType, StoredRecordPayload)>,
    pub auth: HashMap<AuthKeyId, AuthEnvelopes>,
    pub joins: HashMap<DeviceId, JoinRequest>,
    pub members: HashMap<AuthKeyId, StoredRecordPayload>,
}

impl VaultMetaState {
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.secrets.is_empty()
            && self.auth.is_empty()
            && self.joins.is_empty()
            && self.members.is_empty()
    }

    #[must_use]
    pub fn from_stored_records(records: &[StoredSecretRecord]) -> Self {
        let mut state = Self::default();
        for record in records {
            state.apply_record(record);
        }
        state
    }

    /// Insert or overwrite whichever bucket `record` classifies into.
    pub fn apply_record(&mut self, record: &StoredSecretRecord) {
        match VaultMetaRecord::classify(record) {
            VaultMetaRecord::Secret(id, secret_type, payload) => {
                self.secrets.insert(id, (secret_type, payload));
            }
            VaultMetaRecord::Auth(auth_id, envelopes) => {
                self.auth.insert(auth_id, envelopes);
            }
            VaultMetaRecord::Join(device_id, join) => {
                self.joins.insert(device_id, join);
            }
            VaultMetaRecord::Member(auth_id, payload) => {
                self.members.insert(auth_id, payload);
            }
        }
    }

    /// Remove whichever bucket a raw on-disk key refers to (join rows are
    /// removed by device id; everything else by its own key encoding).
    pub fn remove_key(&mut self, key: &str) {
        if let Ok(device_id) = DeviceId::parse(key) {
            self.joins.remove(&device_id);
        }
        if let Some(pk_id_str) = key.strip_prefix(MEMBER_RECORD_PREFIX)
            && let Ok(auth_id) = AuthKeyId::parse(pk_id_str)
        {
            self.members.remove(&auth_id);
        }
        if let Ok(auth_id) = AuthKeyId::parse(key) {
            self.auth.remove(&auth_id);
        }
        self.secrets.remove(&SecretId::from_vault_record(key));
    }

    #[must_use]
    pub fn to_stored_records(&self) -> Vec<StoredSecretRecord> {
        let mut records = Vec::with_capacity(
            self.secrets.len() + self.auth.len() + self.joins.len() + self.members.len(),
        );
        for (id, (secret_type, payload)) in &self.secrets {
            records.push(StoredSecretRecord {
                key: id.clone(),
                secret_type: Some(*secret_type),
                value: payload.clone(),
            });
        }
        for (auth_id, envelopes) in &self.auth {
            if let Ok(record) =
                VaultMetaRecord::Auth(auth_id.clone(), envelopes.clone()).to_stored()
            {
                records.push(record);
            }
        }
        for join in self.joins.values() {
            if let Ok(record) =
                VaultMetaRecord::Join(join.device_id.clone(), join.clone()).to_stored()
            {
                records.push(record);
            }
        }
        for (auth_id, payload) in &self.members {
            records.push(StoredSecretRecord {
                key: SecretId::from_vault_record(&member_stored_key(auth_id)),
                secret_type: None,
                value: payload.clone(),
            });
        }
        records.sort_by(|a, b| a.key.as_str().cmp(b.key.as_str()));
        records
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct JoinRequest {
    pub device_id: DeviceId,
    pub public_key: DevicePublicKey,
    #[serde(default, skip_serializing_if = "DeviceSigningPublicKey::is_empty")]
    pub signing_public_key: DeviceSigningPublicKey,
    pub requested_at: String,
}

/// Per-device X25519 identity used to unwrap `secrets_key/members_key` from the vault file.
#[derive(Clone)]
pub struct DeviceIdentity {
    identity: Identity,
    device_id: DeviceId,
}

impl DeviceIdentity {
    pub fn generate() -> MultiDeviceResult<Self> {
        let identity = Identity::generate();
        let device_id = device_id_from_public(&identity.to_public());
        Ok(Self {
            identity,
            device_id,
        })
    }

    pub fn from_secret_str(secret: &DeviceIdentitySecret) -> MultiDeviceResult<Self> {
        let identity = secret
            .as_str()
            .parse::<Identity>()
            .map_err(|e| MultiDeviceError::InvalidDeviceIdentity(e.to_string()))?;
        let device_id = device_id_from_public(&identity.to_public());
        Ok(Self {
            identity,
            device_id,
        })
    }

    #[must_use]
    pub fn device_id(&self) -> &DeviceId {
        &self.device_id
    }

    #[must_use]
    pub fn public_key(&self) -> DevicePublicKey {
        DevicePublicKey::parse(&self.identity.to_public().to_string())
            .expect("generated public key is valid")
    }

    #[must_use]
    pub fn secret_string(&self) -> DeviceIdentitySecret {
        DeviceIdentitySecret::parse(self.identity.to_string().expose_secret())
            .expect("generated identity secret is valid")
    }

    #[must_use]
    pub fn auth_id(&self) -> AuthKeyId {
        device_auth_id_from_public(&self.identity.to_public())
    }

    pub fn decrypt_envelope(
        &self,
        envelope: &AgeArmoredCiphertext,
    ) -> MultiDeviceResult<SymmetricKey> {
        let plaintext = decrypt_with_identity(envelope, &self.identity)?;
        SymmetricKey::parse(&plaintext).map_err(MultiDeviceError::Validation)
    }

    /// Back-compat alias.
    pub fn decrypt_dec_envelope(
        &self,
        envelope: &AgeArmoredCiphertext,
    ) -> MultiDeviceResult<SymmetricKey> {
        self.decrypt_envelope(envelope)
    }

    /// Seal an arbitrary UTF-8 string to this device's own public key so only
    /// this device (holding the matching identity secret) can open it later.
    /// Used to keep sync-provider credentials encrypted at rest in `IndexedDB`.
    pub fn seal_utf8(&self, plaintext: &str) -> MultiDeviceResult<AgeArmoredCiphertext> {
        encrypt_with_recipient(plaintext.as_bytes(), &self.identity.to_public())
    }

    /// Open a string previously sealed with [`DeviceIdentity::seal_utf8`].
    pub fn open_utf8(&self, ciphertext: &AgeArmoredCiphertext) -> MultiDeviceResult<String> {
        decrypt_with_identity(ciphertext, &self.identity)
    }
}

pub fn device_id_from_public(recipient: &Recipient) -> DeviceId {
    let hash = Sha256::digest(recipient.to_string().as_bytes());
    DeviceId::parse(&hex::encode(&hash[..8])).expect("sha256 prefix is valid device id")
}

pub fn device_id_from_public_key(public_key: &DevicePublicKey) -> MultiDeviceResult<DeviceId> {
    Ok(device_id_from_public(
        &public_key
            .as_str()
            .parse::<Recipient>()
            .map_err(|e| MultiDeviceError::InvalidRecipientPublicKey(e.to_string()))?,
    ))
}

#[must_use]
pub fn device_auth_id_from_public(recipient: &Recipient) -> AuthKeyId {
    let hash = Sha256::digest(recipient.to_string().as_bytes());
    crate::format_auth_key_id(&hex::encode(hash)).expect("sha256 hex is valid auth digest")
}

pub fn encrypt_for_recipient(
    plaintext: &[u8],
    recipient_public: &DevicePublicKey,
) -> MultiDeviceResult<AgeArmoredCiphertext> {
    let recipient = recipient_public
        .as_str()
        .parse::<Recipient>()
        .map_err(|e| MultiDeviceError::InvalidRecipientPublicKey(e.to_string()))?;
    encrypt_with_recipient(plaintext, &recipient)
}

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

pub fn member_from_join(join: &JoinRequest) -> MultiDeviceResult<VaultMember> {
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

fn entry_to_member(entry: &MemberEntry) -> MultiDeviceResult<VaultMember> {
    Ok(VaultMember {
        auth_id: entry.pk_id.clone(),
        device_id: device_id_from_public_key(&entry.pk)?,
        public_key: entry.pk.clone(),
        enrolled_at: entry.enrolled_at.clone(),
        label: entry.label.clone(),
    })
}

pub fn encrypt_member_entry(
    entry: &MemberEntry,
    members_key: &SymmetricKey,
) -> MultiDeviceResult<AgeArmoredCiphertext> {
    let json = serde_json::to_string(entry).map_err(MultiDeviceError::MemberEntrySerialize)?;
    Ok(VaultCrypto::new(members_key)?.encrypt_value(&json)?)
}

pub fn decrypt_member_entry(
    ciphertext: &AgeArmoredCiphertext,
    members_key: &SymmetricKey,
) -> MultiDeviceResult<MemberEntry> {
    let json = VaultCrypto::new(members_key)?.decrypt_value(ciphertext)?;
    serde_json::from_str(json.as_str()).map_err(MultiDeviceError::MemberEntryJson)
}

pub fn build_members_records(
    roster: &[VaultMember],
    members_key: &SymmetricKey,
) -> MultiDeviceResult<Vec<StoredSecretRecord>> {
    let mut records = Vec::with_capacity(roster.len());
    for member in roster {
        let entry = member_to_entry(member);
        records.push(StoredSecretRecord {
            key: SecretId::from_vault_record(&member_stored_key(&entry.pk_id)),
            secret_type: None,
            value: StoredRecordPayload::from_age_armored(encrypt_member_entry(
                &entry,
                members_key,
            )?),
        });
    }
    Ok(records)
}

pub fn resolve_member_roster(
    records: &[StoredSecretRecord],
    members_key: &SymmetricKey,
) -> MultiDeviceResult<Vec<VaultMember>> {
    let mut roster = Vec::new();
    for record in records.iter().filter(|r| is_members_stored_record(r)) {
        let entry = decrypt_member_entry(
            &AgeArmoredCiphertext::parse(record.value.as_str())?,
            members_key,
        )?;
        if !member_record_key_matches(record.key.as_str(), &entry.pk_id) {
            let pk_id = crate::normalize_auth_key_id(entry.pk_id.as_str())
                .map_or_else(|_| entry.pk_id.to_string(), |id| id.to_string());
            let expected_key =
                member_stored_key(&AuthKeyId::parse(&pk_id).unwrap_or(entry.pk_id.clone()));
            return Err(MultiDeviceError::MemberRecordKeyMismatch {
                expected_key,
                actual_key: record.key.to_string(),
            });
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
    members_key: &SymmetricKey,
    enrolled_at: &str,
) -> MultiDeviceResult<Vec<StoredSecretRecord>> {
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
    members_key: &SymmetricKey,
    auth_id: &AuthKeyId,
    label: &str,
) -> MultiDeviceResult<Vec<StoredSecretRecord>> {
    if !is_auth_id(auth_id.as_str()) {
        return Err(MultiDeviceError::InvalidMemberId);
    }
    let trimmed = label.trim();
    if trimmed.len() > 80 {
        return Err(MultiDeviceError::DeviceNameTooLong);
    }
    let mut roster = resolve_member_roster(records, members_key)?;
    let member = roster
        .iter_mut()
        .find(|member| member.auth_id == *auth_id)
        .ok_or(MultiDeviceError::DeviceNotFound)?;
    member.label = if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_owned())
    };
    build_members_records(&roster, members_key)
}

pub fn revoke_vault_member(
    records: &[StoredSecretRecord],
    members_key: &SymmetricKey,
    auth_id: &AuthKeyId,
) -> MultiDeviceResult<Vec<StoredSecretRecord>> {
    if !is_auth_id(auth_id.as_str()) {
        return Err(MultiDeviceError::InvalidMemberId);
    }
    let roster = resolve_member_roster(records, members_key)?;
    if roster.len() <= 1 {
        return Err(MultiDeviceError::CannotRemoveLastAccess);
    }
    if !roster.iter().any(|member| member.auth_id == *auth_id) {
        return Err(MultiDeviceError::DeviceNotFound);
    }

    let mut updated: Vec<StoredSecretRecord> = records
        .iter()
        .filter(|record| {
            record.key.as_str() != auth_id.as_str()
                && record.key.as_str() != member_stored_key(auth_id)
        })
        .cloned()
        .collect();
    let remaining_roster: Vec<VaultMember> = roster
        .into_iter()
        .filter(|member| member.auth_id != *auth_id)
        .collect();
    tracing::info!(
        scope = "multi-device",
        auth_id = auth_id.as_str(),
        remaining_members = remaining_roster.len(),
        "revoked vault member"
    );
    replace_member_records(
        &mut updated,
        build_members_records(&remaining_roster, members_key)?,
    );
    Ok(updated)
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

/// If this device holds `members_key` but has no roster row, add itself (fallback when approver missed it).
pub fn ensure_self_in_roster(
    records: &[StoredSecretRecord],
    identity: &DeviceIdentity,
    members_key: &SymmetricKey,
) -> MultiDeviceResult<Option<Vec<StoredSecretRecord>>> {
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
        .any(|record| record.key.as_str() == pk_id.as_str() && is_auth_stored_record(record))
}

#[must_use]
pub fn pending_join_for_device(
    records: &[StoredSecretRecord],
    device_id: &DeviceId,
) -> Option<JoinRequest> {
    list_join_requests(records)
        .into_iter()
        .find(|join| join.device_id == *device_id)
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
    fn second_device_join_request_and_approval_roundtrips_key_access() {
        let keys = generate_vault_keys().unwrap();
        let (genesis, mut records) = genesis_vault(&keys);

        let joiner = DeviceIdentity::generate().unwrap();
        records.push(create_join_request_record(&joiner, "2026-06-21T00:00:00Z").unwrap());

        let join = pending_join_for_device(&records, joiner.device_id()).unwrap();
        let (auth_record, join_key, member_records) = approve_join_request(
            &keys.secrets_key,
            &keys.members_key,
            &join,
            &genesis,
            &records,
        )
        .unwrap();
        records.retain(|record| record.key.as_str() != join_key);
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
        assert_eq!(
            resolve_member_roster(&records, &keys.members_key)
                .unwrap()
                .len(),
            2
        );
    }
}

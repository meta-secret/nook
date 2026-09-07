use super::{
    AgeArmoredCiphertext, AuthEnvelopes, Deserialize, DeviceIdentitySecret, DevicePublicKey,
    DeviceSigningPublicKey, SENTINEL_SHARE_RECORD_PREFIX, SecretId, SecretType,
    SentinelShareEnvelope, Serialize, StoredRecordPayload, StoredSecretRecord, SymmetricKey,
    parse_sentinel_share_envelope, sentinel_share_record_key,
};
use crate::errors::{MultiDeviceError, MultiDeviceResult};
use crate::{AppId, AuthKeyId, DeviceId};
use age::secrecy::ExposeSecret;
use age::x25519::Identity;
use std::collections::HashMap;

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

/// Public Sentinel roster entry retained while materializing event-only vaults.
/// Encrypted `members:` rows remain the canonical persisted projection after
/// quorum unlock; this public entry lets event replay preserve the complete
/// genesis roster before those rows can be decrypted.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SentinelParticipantEntry {
    pub device_id: DeviceId,
    pub encryption_public_key: DevicePublicKey,
    pub signing_public_key: DeviceSigningPublicKey,
    pub label: String,
    pub enrolled_at: String,
}

/// Whether a flat-record key matches the `pk_id` inside the decrypted member entry.
/// YAML load normalizes `pk_id` to `key_{digest}` while legacy ciphertext may still
/// store the bare 64-hex digest — accept both forms.
pub(super) fn member_record_key_matches(stored_key: &str, entry_pk_id: &AuthKeyId) -> bool {
    if stored_key == entry_pk_id.member_record_key() {
        return true;
    }
    if let Ok(normalized) = crate::AuthKeyId::parse(entry_pk_id.as_str()) {
        return stored_key == normalized.member_record_key();
    }
    false
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
    /// A threshold share of the vault key bundle, encrypted to one device.
    SentinelShare(DeviceId, SentinelShareEnvelope),
}

impl VaultMetaRecord {
    pub fn classify(record: &StoredSecretRecord) -> MultiDeviceResult<Self> {
        if let Some(device_id_str) = record
            .key
            .as_str()
            .strip_prefix(SENTINEL_SHARE_RECORD_PREFIX)
        {
            let device_id = DeviceId::parse(device_id_str)?;
            let share = parse_sentinel_share_envelope(record.value.as_str())?;
            return Ok(Self::SentinelShare(device_id, share));
        }
        if let Ok(join) = JoinRequest::parse_json(record.value.as_str()) {
            return Ok(Self::Join(join.device_id.clone(), join));
        }
        if let Some(pk_id_str) = record.key.as_str().strip_prefix(MEMBER_RECORD_PREFIX)
            && record.value.as_str().contains("BEGIN AGE ENCRYPTED FILE")
            && let Ok(auth_id) = AuthKeyId::parse(pk_id_str)
        {
            return Ok(Self::Member(auth_id, record.value.clone()));
        }
        if crate::AuthKeyId::is_valid(record.key.as_str())
            && let Ok(envelopes) = AuthEnvelopes::parse(record.value.as_str())
            && let Ok(auth_id) = AuthKeyId::parse(record.key.as_str())
        {
            return Ok(Self::Auth(auth_id, envelopes));
        }
        Ok(Self::Secret(
            record.key.clone(),
            record.secret_type.unwrap_or(SecretType::SecureNote),
            record.value.clone(),
        ))
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
                key: SecretId::from_vault_record(join.device_id.as_str()),
                secret_type: None,
                value: StoredRecordPayload::from_trusted(
                    serde_json::to_string(join).map_err(MultiDeviceError::JoinRequestSerialize)?,
                ),
            },
            Self::Member(auth_id, payload) => StoredSecretRecord {
                key: SecretId::from_vault_record(&auth_id.member_record_key()),
                secret_type: None,
                value: payload.clone(),
            },
            Self::SentinelShare(device_id, share) => StoredSecretRecord {
                key: SecretId::from_vault_record(&sentinel_share_record_key(device_id)),
                secret_type: None,
                value: StoredRecordPayload::from_trusted(
                    serde_json::to_string(share)
                        .map_err(MultiDeviceError::SentinelShareSerialize)?,
                ),
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
    /// Live enrolled devices reconstructed from `JoinApproved` events.
    /// Encrypted `members:` rows are not replayed by event projection.
    pub enrolled_devices: HashMap<DeviceId, JoinRequest>,
    pub sentinel_shares: HashMap<DeviceId, SentinelShareEnvelope>,
    pub sentinel_participants: HashMap<DeviceId, SentinelParticipantEntry>,
}

impl VaultMetaState {
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.secrets.is_empty()
            && self.auth.is_empty()
            && self.joins.is_empty()
            && self.members.is_empty()
            && self.enrolled_devices.is_empty()
            && self.sentinel_shares.is_empty()
            && self.sentinel_participants.is_empty()
    }

    pub fn from_stored_records(records: &[StoredSecretRecord]) -> MultiDeviceResult<Self> {
        let mut state = Self::default();
        for record in records {
            state.apply_record(record)?;
        }
        Ok(state)
    }

    /// Insert or overwrite whichever bucket `record` classifies into.
    pub fn apply_record(&mut self, record: &StoredSecretRecord) -> MultiDeviceResult<()> {
        match VaultMetaRecord::classify(record)? {
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
            VaultMetaRecord::SentinelShare(device_id, share) => {
                self.sentinel_shares.insert(device_id, share);
            }
        }
        Ok(())
    }

    /// Replace the encrypted member roster rows in this typed metadata state.
    pub fn replace_member_records(
        &mut self,
        member_records: &[StoredSecretRecord],
    ) -> MultiDeviceResult<()> {
        let mut members = self.members.clone();
        members.clear();
        for record in member_records {
            if let VaultMetaRecord::Member(auth_id, payload) = VaultMetaRecord::classify(record)? {
                members.insert(auth_id, payload);
            }
        }
        self.members = members;
        Ok(())
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
        if let Some(device_id_str) = key.strip_prefix(SENTINEL_SHARE_RECORD_PREFIX)
            && let Ok(device_id) = DeviceId::parse(device_id_str)
        {
            self.sentinel_shares.remove(&device_id);
        }
        self.secrets.remove(&SecretId::from_vault_record(key));
    }

    #[must_use]
    pub fn to_stored_records(&self) -> Vec<StoredSecretRecord> {
        let mut records = Vec::with_capacity(
            self.secrets.len()
                + self.auth.len()
                + self.joins.len()
                + self.members.len()
                + self.sentinel_shares.len(),
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
                key: SecretId::from_vault_record(&auth_id.member_record_key()),
                secret_type: None,
                value: payload.clone(),
            });
        }
        for (device_id, share) in &self.sentinel_shares {
            if let Ok(record) =
                VaultMetaRecord::SentinelShare(device_id.clone(), share.clone()).to_stored()
            {
                records.push(record);
            }
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

/// Installation-local X25519 app key used to unwrap vault DEK envelopes.
///
/// Historical name was `DeviceIdentity`. New code must use [`AppKey`].
#[derive(Clone)]
pub struct AppKey {
    identity: Identity,
    app_id: AppId,
}

/// Migration alias for [`AppKey`].
pub type DeviceIdentity = AppKey;

impl AppKey {
    pub fn generate() -> MultiDeviceResult<Self> {
        let identity = Identity::generate();
        let app_id = super::key_actions::AppKeyDerivation::app_id(&identity.to_public());
        Ok(Self { identity, app_id })
    }

    pub fn from_secret_str(secret: &DeviceIdentitySecret) -> MultiDeviceResult<Self> {
        let identity = secret
            .as_str()
            .parse::<Identity>()
            .map_err(|e| MultiDeviceError::InvalidDeviceIdentity(e.to_string()))?;
        let app_id = super::key_actions::AppKeyDerivation::app_id(&identity.to_public());
        Ok(Self { identity, app_id })
    }

    #[must_use]
    pub fn app_id(&self) -> &AppId {
        &self.app_id
    }

    /// Migration alias for [`AppKey::app_id`].
    #[must_use]
    pub fn device_id(&self) -> &AppId {
        self.app_id()
    }

    #[must_use]
    pub fn public_key(&self) -> DevicePublicKey {
        DevicePublicKey::from_trusted(self.identity.to_public().to_string())
    }

    #[must_use]
    pub fn secret_string(&self) -> DeviceIdentitySecret {
        DeviceIdentitySecret::from_trusted(self.identity.to_string().expose_secret().to_owned())
    }

    #[must_use]
    pub fn auth_id(&self) -> AuthKeyId {
        super::key_actions::AppKeyDerivation::auth_id(&self.identity.to_public())
    }

    pub fn decrypt_envelope(
        &self,
        envelope: &AgeArmoredCiphertext,
    ) -> MultiDeviceResult<SymmetricKey> {
        let plaintext = Self::open_identity_bytes(envelope, &self.identity)?;
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
        Self::seal_recipient_bytes(plaintext.as_bytes(), &self.identity.to_public())
    }

    /// Open a string previously sealed with [`AppKey::seal_utf8`].
    pub fn open_utf8(&self, ciphertext: &AgeArmoredCiphertext) -> MultiDeviceResult<String> {
        Self::open_identity_bytes(ciphertext, &self.identity)
    }
}

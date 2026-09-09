//! Owned multi-device key and flat-record actions.

#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use super::{
    AppKey, AuthEnvelopes, JoinRequest, StoredSecretRecord, SymmetricKey, VaultKeys,
    VaultMetaRecord, VaultMetaState,
};
use crate::errors::{AgeCryptoError, MultiDeviceError, MultiDeviceResult};
use crate::{
    AgeArmoredCiphertext, AppId, AuthKeyId, CompactToken, DevicePublicKey, SecretId,
    StoredRecordPayload,
};
use age::x25519::{Identity, Recipient};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    io::{Read, Write},
    iter,
};

impl SymmetricKey {
    /// Generate one vault key while preserving the multi-device error boundary.
    pub fn generate_for_vault() -> MultiDeviceResult<Self> {
        Self::generate().map_err(MultiDeviceError::Validation)
    }
}

impl CompactToken {
    /// Generate the compact, URL-safe random suffix used by persisted ids.
    pub fn generate() -> MultiDeviceResult<Self> {
        let mut bytes = [0u8; 8];
        getrandom::fill(&mut bytes)
            .map_err(|error| MultiDeviceError::GenerateId(error.to_string()))?;
        Self::parse(&URL_SAFE_NO_PAD.encode(bytes)).map_err(MultiDeviceError::Validation)
    }
}

impl VaultKeys {
    /// Generate independent secrets and member encryption keys.
    pub fn generate() -> MultiDeviceResult<Self> {
        Ok(Self {
            secrets_key: SymmetricKey::generate_for_vault()?,
            members_key: SymmetricKey::generate_for_vault()?,
        })
    }
}

impl AuthEnvelopes {
    pub fn parse(value: &str) -> MultiDeviceResult<Self> {
        serde_json::from_str(value).map_err(MultiDeviceError::AuthEnvelopeJson)
    }
}

impl JoinRequest {
    pub fn parse_json(value: &str) -> MultiDeviceResult<Self> {
        serde_json::from_str(value).map_err(MultiDeviceError::JoinRequestJson)
    }
}

impl DevicePublicKey {
    pub fn try_app_id(&self) -> MultiDeviceResult<AppId> {
        self.as_str()
            .parse::<Recipient>()
            .map(|recipient| AppKeyDerivation::app_id(&recipient))
            .map_err(|error| MultiDeviceError::InvalidRecipientPublicKey(error.to_string()))
    }

    pub fn auth_id(&self) -> MultiDeviceResult<AuthKeyId> {
        self.as_str()
            .parse::<Recipient>()
            .map(|recipient| AppKeyDerivation::auth_id(&recipient))
            .map_err(|error| MultiDeviceError::InvalidRecipientPublicKey(error.to_string()))
    }

    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "serialization boundary: encrypts serialized age plaintext bytes"
        )
    )]
    pub fn seal_bytes(&self, plaintext: &[u8]) -> MultiDeviceResult<AgeArmoredCiphertext> {
        let recipient = self
            .as_str()
            .parse::<Recipient>()
            .map_err(|error| MultiDeviceError::InvalidRecipientPublicKey(error.to_string()))?;
        AppKey::seal_recipient_bytes(plaintext, &recipient)
    }
}

impl AppKey {
    pub fn auth_id_for_public_key(public_key: &DevicePublicKey) -> MultiDeviceResult<AuthKeyId> {
        public_key.auth_id()
    }

    pub fn auth_record(
        &self,
        secrets_key: &SymmetricKey,
        members_key: &SymmetricKey,
    ) -> MultiDeviceResult<StoredSecretRecord> {
        AuthRecordIssuance::new(
            &self.auth_id(),
            secrets_key,
            members_key,
            &self.public_key(),
        )
        .issue()
    }

    pub fn auth_record_with_shared_key(
        &self,
        key: &SymmetricKey,
    ) -> MultiDeviceResult<StoredSecretRecord> {
        self.auth_record(key, key)
    }

    pub(super) fn seal_recipient_bytes(
        plaintext: &[u8],
        recipient: &Recipient,
    ) -> MultiDeviceResult<AgeArmoredCiphertext> {
        AgeCiphertextSeal::new(plaintext, recipient).seal()
    }

    pub(super) fn open_identity_bytes(
        envelope: &AgeArmoredCiphertext,
        identity: &Identity,
    ) -> MultiDeviceResult<String> {
        AgeCiphertextOpen::new(envelope, identity).open()
    }
}

impl AuthKeyId {
    #[must_use]
    pub fn member_record_key(&self) -> String {
        format!("member:{self}")
    }
}

impl VaultMetaState {
    /// Replace pending joins from a freshly fetched record set.
    pub fn replace_join_records(
        &mut self,
        fresh_records: &[StoredSecretRecord],
    ) -> MultiDeviceResult<()> {
        let mut joins = HashMap::new();
        for record in fresh_records {
            if let VaultMetaRecord::Join(device_id, join) = (record).classify()? {
                joins.insert(device_id, join);
            }
        }
        self.joins = joins;
        Ok(())
    }
}

/// Borrowed record state that keeps classification and key resolution together.
pub struct VaultRecordView<'a> {
    records: &'a [StoredSecretRecord],
}

impl<'a> VaultRecordView<'a> {
    #[must_use]
    pub const fn new(records: &'a [StoredSecretRecord]) -> Self {
        Self { records }
    }

    pub fn list_join_requests(&self) -> MultiDeviceResult<Vec<JoinRequest>> {
        self.records
            .iter()
            .filter_map(|record| match (record).classify() {
                Ok(VaultMetaRecord::Join(_, join)) => Some(Ok(join)),
                Ok(_) => None,
                Err(error) => Some(Err(error)),
            })
            .collect()
    }

    pub fn has_multi_device_records(&self) -> MultiDeviceResult<bool> {
        for record in self.records {
            if !matches!((record).classify()?, VaultMetaRecord::Secret(..)) {
                return Ok(true);
            }
        }
        Ok(false)
    }

    pub fn user_records(&self) -> MultiDeviceResult<Vec<StoredSecretRecord>> {
        let mut user_records = Vec::new();
        for record in self.records {
            if matches!((record).classify()?, VaultMetaRecord::Secret(..)) {
                user_records.push(record.clone());
            }
        }
        Ok(user_records)
    }

    pub fn auth_envelopes(&self, identity: &AppKey) -> MultiDeviceResult<AuthEnvelopes> {
        let auth_id = identity.auth_id();
        let record = self
            .records
            .iter()
            .find(|entry| entry.key.as_str() == auth_id.as_str())
            .ok_or_else(|| MultiDeviceError::AuthEnvelopeNotFound {
                device_id: identity.device_id().to_string(),
                pk_id: auth_id.to_string(),
            })?;
        AuthEnvelopes::parse(record.value.as_str())
    }

    pub fn secrets_key(&self, identity: &AppKey) -> MultiDeviceResult<SymmetricKey> {
        let envelopes = self.auth_envelopes(identity)?;
        identity.decrypt_envelope(&envelopes.secrets_key)
    }

    pub fn members_key(&self, identity: &AppKey) -> MultiDeviceResult<SymmetricKey> {
        let envelopes = self.auth_envelopes(identity)?;
        identity.decrypt_envelope(&envelopes.members_key)
    }
}

impl VaultRecordView<'_> {
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.records.is_empty()
    }
}

pub struct AuthRecordIssuance<'a> {
    auth_id: &'a AuthKeyId,
    secrets_key: &'a SymmetricKey,
    members_key: &'a SymmetricKey,
    recipient_public: &'a DevicePublicKey,
}

impl<'a> AuthRecordIssuance<'a> {
    #[must_use]
    pub fn new(
        auth_id: &'a AuthKeyId,
        secrets_key: &'a SymmetricKey,
        members_key: &'a SymmetricKey,
        recipient_public: &'a DevicePublicKey,
    ) -> Self {
        Self {
            auth_id,
            secrets_key,
            members_key,
            recipient_public,
        }
    }

    pub fn issue(self) -> MultiDeviceResult<StoredSecretRecord> {
        let envelopes = AuthEnvelopes {
            secrets_key: self
                .recipient_public
                .seal_bytes(self.secrets_key.as_str().as_bytes())?,
            members_key: self
                .recipient_public
                .seal_bytes(self.members_key.as_str().as_bytes())?,
        };
        Ok(StoredSecretRecord {
            key: SecretId::from_vault_record(self.auth_id.as_str()),
            secret_type: None,
            value: StoredRecordPayload::from_trusted(
                serde_json::to_string(&envelopes)
                    .map_err(MultiDeviceError::AuthEnvelopesSerialize)?,
            ),
        })
    }
}

pub(super) struct AppKeyDerivation;

impl AppKeyDerivation {
    pub(super) fn app_id(recipient: &Recipient) -> AppId {
        let hash = Sha256::digest(recipient.to_string().as_bytes());
        let mut prefix = [0_u8; 8];
        prefix.copy_from_slice(&hash[..8]);
        AppId::from_sha256_prefix(prefix)
    }

    pub(super) fn auth_id(recipient: &Recipient) -> AuthKeyId {
        let hash = Sha256::digest(recipient.to_string().as_bytes());
        let mut digest = [0_u8; 32];
        digest.copy_from_slice(&hash);
        AuthKeyId::from_sha256_digest(&digest)
    }
}

struct AgeCiphertextSeal<'a> {
    plaintext: &'a [u8],
    recipient: &'a Recipient,
}

impl<'a> AgeCiphertextSeal<'a> {
    fn new(plaintext: &'a [u8], recipient: &'a Recipient) -> Self {
        Self {
            plaintext,
            recipient,
        }
    }

    fn seal(self) -> MultiDeviceResult<AgeArmoredCiphertext> {
        use age::armor::{ArmoredWriter, Format};

        let encryptor =
            age::Encryptor::with_recipients(iter::once(self.recipient as &dyn age::Recipient))
                .map_err(|error| {
                    MultiDeviceError::Age(AgeCryptoError::EncryptSetup(error.to_string()))
                })?;
        let mut armored = Vec::new();
        let armor_writer = ArmoredWriter::wrap_output(&mut armored, Format::AsciiArmor)
            .map_err(|error| MultiDeviceError::Age(AgeCryptoError::ArmorWrap(error.to_string())))?;
        let mut writer = encryptor
            .wrap_output(armor_writer)
            .map_err(|error| MultiDeviceError::Age(AgeCryptoError::Encrypt(error.to_string())))?;
        writer
            .write_all(self.plaintext)
            .map_err(|error| MultiDeviceError::Age(AgeCryptoError::Write(error.to_string())))?;
        writer
            .finish()
            .map_err(|error| MultiDeviceError::Age(AgeCryptoError::Finish(error.to_string())))?
            .finish()
            .map_err(|error| {
                MultiDeviceError::Age(AgeCryptoError::ArmorFinish(error.to_string()))
            })?;
        let armored = String::from_utf8(armored).map_err(|error| {
            MultiDeviceError::Age(AgeCryptoError::InvalidUtf8Armor(error.to_string()))
        })?;
        Ok(AgeArmoredCiphertext::from_trusted_armored(armored))
    }
}

struct AgeCiphertextOpen<'a> {
    envelope: &'a AgeArmoredCiphertext,
    identity: &'a Identity,
}

impl<'a> AgeCiphertextOpen<'a> {
    fn new(envelope: &'a AgeArmoredCiphertext, identity: &'a Identity) -> Self {
        Self { envelope, identity }
    }

    fn open(self) -> MultiDeviceResult<String> {
        use age::armor::ArmoredReader;

        let decryptor =
            age::Decryptor::new_buffered(ArmoredReader::new(self.envelope.as_str().as_bytes()))
                .map_err(|error| {
                    MultiDeviceError::Age(AgeCryptoError::DecryptSetup(error.to_string()))
                })?;
        let mut reader = decryptor
            .decrypt(iter::once(self.identity as &dyn age::Identity))
            .map_err(|error| MultiDeviceError::Age(AgeCryptoError::Decrypt(error.to_string())))?;
        let mut decrypted = String::new();
        reader
            .read_to_string(&mut decrypted)
            .map_err(|error| MultiDeviceError::Age(AgeCryptoError::Read(error.to_string())))?;
        Ok(decrypted)
    }
}

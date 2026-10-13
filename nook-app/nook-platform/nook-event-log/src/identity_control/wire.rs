//! Signed identity control event envelope and typed control operations.
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]

use std::{fmt, str};

use ed25519_dalek::{SigningKey, VerifyingKey};
use nook_auth2::{
    AgeArmoredCiphertext, AppId, AuthKeyId, CompactToken, DevicePublicKey, DeviceSigningPublicKey,
    IdentityId, IsoTimestamp, MemberLabel, StoreId,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::canonical::{Ed25519Signature, EventId};
use crate::signing::SigningIdentity;
use crate::{CanonicalEventBodyBytes, EventError, EventResult, EventStorageBytes};

/// Supported `schema_version` values on the identity control wire.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct IdentityEventSchemaVersion(u32);

impl IdentityEventSchemaVersion {
    pub const V1: Self = Self(1);
    pub const CURRENT: Self = Self::V1;

    #[must_use]
    pub const fn is_supported(self) -> bool {
        self.0 == Self::V1.0
    }
}

impl fmt::Display for IdentityEventSchemaVersion {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

/// User-visible identity name carried by the replicated control log.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct IdentityLabel(String);

impl IdentityLabel {
    #[must_use]
    pub fn new(label: &str) -> Self {
        Self(label.trim().to_owned())
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// User-visible vault name registered with its owning identity.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct IdentityVaultLabel(String);

impl IdentityVaultLabel {
    #[must_use]
    pub fn new(label: &str) -> Self {
        Self(label.trim().to_owned())
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

const PROVIDER_MOUNT_ID_PREFIX: &str = "mnt_";

/// Stable identifier of one provider mount in an identity (`mnt_{token}`).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct ProviderMountId(String);

impl ProviderMountId {
    pub fn generate() -> EventResult<Self> {
        let token = CompactToken::generate()
            .map_err(|error| EventError::IdentityControlInvalid(error.to_string()))?;
        Ok(Self(format!(
            "{PROVIDER_MOUNT_ID_PREFIX}{}",
            token.as_str()
        )))
    }

    pub fn parse(raw: &str) -> EventResult<Self> {
        let trimmed = raw.trim();
        match trimmed.strip_prefix(PROVIDER_MOUNT_ID_PREFIX) {
            Some(token) if CompactToken::is_valid(token) => Ok(Self(trimmed.to_owned())),
            _ => Err(EventError::IdentityControlInvalid(format!(
                "invalid provider mount id {trimmed:?}"
            ))),
        }
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for ProviderMountId {
    type Error = EventError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::parse(&value)
    }
}

impl From<ProviderMountId> for String {
    fn from(value: ProviderMountId) -> Self {
        value.0
    }
}

impl fmt::Display for ProviderMountId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

/// Public keys of one app-key installation in an identity.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct IdentityMemberKeys {
    pub app_id: AppId,
    pub encryption_public_key: DevicePublicKey,
    pub signing_public_key: DeviceSigningPublicKey,
    pub label: MemberLabel,
}

impl IdentityMemberKeys {
    /// Validate the key tuple and return the member's event actor id.
    pub fn signing_actor(&self) -> EventResult<AuthKeyId> {
        if self.signing_public_key.is_empty() {
            return Err(EventError::IdentityControlInvalid(
                "identity members require an Ed25519 signing key".to_owned(),
            ));
        }
        let derived = self
            .encryption_public_key
            .try_app_id()
            .map_err(|error| EventError::IdentityControlInvalid(error.to_string()))?;
        if derived != self.app_id {
            return Err(EventError::IdentityControlInvalid(format!(
                "app id {} does not match its encryption public key",
                self.app_id
            )));
        }
        SigningIdentity::actor_id_for_public_key_hex(self.signing_public_key.as_str())
    }
}

/// One vault DEK pair wrapped to one member's encryption public key.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemberVaultDek {
    pub app_id: AppId,
    pub secrets_key_ciphertext: AgeArmoredCiphertext,
    pub members_key_ciphertext: AgeArmoredCiphertext,
}

/// A vault DEK pair at one vault key epoch, wrapped to the member being approved.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct IdentityVaultDekGrant {
    pub store_id: StoreId,
    pub key_epoch: EventId,
    pub secrets_key_ciphertext: AgeArmoredCiphertext,
    pub members_key_ciphertext: AgeArmoredCiphertext,
}

/// Google Drive routing for an identity mount. Each installation signs in
/// with its own Google account; no OAuth token enters the control log.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "mode", rename_all = "kebab-case")]
pub enum DriveMountTarget {
    Private { folder_name: String },
    Shared { folder_id: String },
}

/// iCloud routing for an identity mount. Credential-free by construction.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "mode", rename_all = "kebab-case")]
pub enum ICloudMountTarget {
    Private,
    Shared { share_target: String },
}

/// Credential-free replication target of an identity mount.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum IdentityMountTarget {
    Github {
        repository: String,
    },
    GoogleDrive {
        drive: DriveMountTarget,
    },
    #[serde(rename = "icloud")]
    ICloud {
        icloud: ICloudMountTarget,
    },
    /// Each installation chooses its own directory; only the name replicates.
    LocalFolder {
        directory_name: String,
    },
}

/// How a mount lays out event logs at its target.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "layout", rename_all = "kebab-case")]
pub enum ProviderMountLayout {
    /// Identity log and every owned vault in their own namespaces.
    Namespaced,
    /// A migrated per-vault provider: its vault stays at the legacy root and
    /// only the identity log uses a namespace.
    LegacySingleVault { store_id: StoreId },
}

/// One sync-provider mount owned by an identity.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct IdentityProviderMount {
    pub mount_id: ProviderMountId,
    pub label: String,
    pub target: IdentityMountTarget,
    pub layout: ProviderMountLayout,
}

/// Atomic operations recorded in the identity control log.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum IdentityControlOperation {
    IdentityCreated {
        label: IdentityLabel,
        founder: IdentityMemberKeys,
    },
    IdentityRenamed {
        label: IdentityLabel,
    },
    MemberJoinRequested {
        member: IdentityMemberKeys,
    },
    MemberApproved {
        member: IdentityMemberKeys,
        vault_deks: Vec<IdentityVaultDekGrant>,
    },
    MemberJoinDenied {
        app_id: AppId,
    },
    MemberRevoked {
        app_id: AppId,
    },
    MemberRenamed {
        app_id: AppId,
        label: MemberLabel,
    },
    VaultRegistered {
        store_id: StoreId,
        label: IdentityVaultLabel,
        key_epoch: EventId,
        recipients: Vec<MemberVaultDek>,
    },
    VaultDekGranted {
        store_id: StoreId,
        key_epoch: EventId,
        recipients: Vec<MemberVaultDek>,
    },
    ProviderMounted {
        mount: IdentityProviderMount,
    },
    ProviderUnmounted {
        mount_id: ProviderMountId,
    },
}

/// Signed identity control body (everything except the signature).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct IdentityEventBody {
    pub schema_version: IdentityEventSchemaVersion,
    pub identity_id: IdentityId,
    pub actor_id: AuthKeyId,
    pub actor_signing_public_key: DeviceSigningPublicKey,
    pub parents: Vec<EventId>,
    pub created_at: IsoTimestamp,
    pub operations: Vec<IdentityControlOperation>,
}

impl IdentityEventBody {
    pub fn to_canonical_bytes(&self) -> EventResult<CanonicalEventBodyBytes> {
        let mut body = self.clone();
        body.parents
            .sort_by(|left, right| left.as_str().cmp(right.as_str()));
        // The generic canonical JSON writer is the signing wire boundary.
        let value: Value = serde_json::to_value(&body).map_err(EventError::EventBodySerialize)?;
        CanonicalEventBodyBytes::from_json(&value)
    }

    pub fn event_id(&self) -> EventResult<EventId> {
        Ok(EventId::from_body_bytes(&self.to_canonical_bytes()?))
    }

    #[must_use]
    pub fn is_genesis(&self) -> bool {
        self.parents.is_empty()
    }
}

/// Full signed identity control event.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct IdentityEvent {
    #[serde(flatten)]
    pub body: IdentityEventBody,
    pub signature: Ed25519Signature,
}

impl IdentityEvent {
    pub fn id(&self) -> EventResult<EventId> {
        self.body.event_id()
    }

    pub fn sign(body: IdentityEventBody, signing_key: &SigningKey) -> EventResult<Self> {
        let actor = SigningIdentity::actor_id_for_verifying_key(&signing_key.verifying_key())?;
        if actor != body.actor_id {
            return Err(EventError::ActorSigningKeyMismatch {
                actor_id: body.actor_id.as_str().to_owned(),
                signing_key_actor_id: actor.as_str().to_owned(),
            });
        }
        let bytes = body.to_canonical_bytes()?;
        let signature = Ed25519Signature::sign(&bytes, signing_key);
        Ok(Self { body, signature })
    }

    fn verify_actor_signature(&self) -> EventResult<()> {
        let public_key = &self.body.actor_signing_public_key;
        if public_key.is_empty() {
            return Err(EventError::MissingActorSigningPublicKey);
        }
        let verifying_key: VerifyingKey =
            SigningIdentity::verifying_key_from_public_key_hex(public_key.as_str())?;
        let signing_actor = SigningIdentity::actor_id_for_verifying_key(&verifying_key)?;
        if signing_actor != self.body.actor_id {
            return Err(EventError::ActorSigningKeyMismatch {
                actor_id: self.body.actor_id.as_str().to_owned(),
                signing_key_actor_id: signing_actor.as_str().to_owned(),
            });
        }
        self.signature
            .verify(&self.body.to_canonical_bytes()?, &verifying_key)
    }

    /// Validate schema, identity binding, structure, and signature. Causal
    /// authorization is checked by [`crate::IdentityControlLog`].
    pub fn validate_envelope(&self, expected: &IdentityId) -> EventResult<EventId> {
        let body = &self.body;
        if !body.schema_version.is_supported() {
            return Err(EventError::UnsupportedIdentitySchemaVersion {
                version: body.schema_version,
            });
        }
        if &body.identity_id != expected {
            return Err(EventError::IdentityControlInvalid(format!(
                "event belongs to identity {} instead of {}",
                body.identity_id, expected
            )));
        }
        if body.operations.is_empty() {
            return Err(EventError::IdentityControlInvalid(
                "identity events require at least one operation".to_owned(),
            ));
        }
        for parent in &body.parents {
            EventId::parse(parent.as_str())?;
        }
        self.validate_operation_structure()?;
        self.verify_actor_signature()?;
        self.id()
    }

    fn validate_operation_structure(&self) -> EventResult<()> {
        let body = &self.body;
        let creates = body
            .operations
            .iter()
            .filter(|operation| {
                matches!(operation, IdentityControlOperation::IdentityCreated { .. })
            })
            .count();
        match (body.is_genesis(), body.operations.as_slice()) {
            (true, [IdentityControlOperation::IdentityCreated { founder, .. }]) => {
                if founder.signing_actor()? != body.actor_id {
                    return Err(EventError::IdentityControlInvalid(
                        "identity genesis must be signed by its founder".to_owned(),
                    ));
                }
                return Ok(());
            }
            (true, _) => {
                return Err(EventError::IdentityControlInvalid(
                    "identity genesis must be one identity-created operation".to_owned(),
                ));
            }
            (false, _) if creates > 0 => {
                return Err(EventError::IdentityControlInvalid(
                    "only the parentless genesis may create an identity".to_owned(),
                ));
            }
            (false, _) => {}
        }
        for operation in &body.operations {
            match operation {
                IdentityControlOperation::MemberJoinRequested { member } => {
                    if body.operations.len() != 1 || member.signing_actor()? != body.actor_id {
                        return Err(EventError::IdentityControlInvalid(
                            "a join request must be the sole operation, signed by the joiner"
                                .to_owned(),
                        ));
                    }
                }
                IdentityControlOperation::MemberApproved { member, vault_deks } => {
                    member.signing_actor()?;
                    let mut stores = vault_deks
                        .iter()
                        .map(|grant| &grant.store_id)
                        .collect::<Vec<_>>();
                    stores.sort();
                    stores.dedup();
                    if stores.len() != vault_deks.len() {
                        return Err(EventError::IdentityControlInvalid(
                            "an approval grants each vault at most once".to_owned(),
                        ));
                    }
                }
                IdentityControlOperation::VaultRegistered { recipients, .. }
                | IdentityControlOperation::VaultDekGranted { recipients, .. } => {
                    let mut apps = recipients
                        .iter()
                        .map(|recipient| &recipient.app_id)
                        .collect::<Vec<_>>();
                    apps.sort();
                    apps.dedup();
                    if apps.len() != recipients.len() || recipients.is_empty() {
                        return Err(EventError::IdentityControlInvalid(
                            "vault DEK recipients must be non-empty and unique".to_owned(),
                        ));
                    }
                }
                IdentityControlOperation::IdentityCreated { .. }
                | IdentityControlOperation::IdentityRenamed { .. }
                | IdentityControlOperation::MemberJoinDenied { .. }
                | IdentityControlOperation::MemberRevoked { .. }
                | IdentityControlOperation::MemberRenamed { .. }
                | IdentityControlOperation::ProviderMounted { .. }
                | IdentityControlOperation::ProviderUnmounted { .. } => {}
            }
        }
        Ok(())
    }

    /// Self-signed join requests are the only operations an unauthorized
    /// actor may publish.
    #[must_use]
    pub fn is_self_signed_join_request(&self) -> bool {
        matches!(
            self.body.operations.as_slice(),
            [IdentityControlOperation::MemberJoinRequested { member }]
                if member.signing_actor().is_ok_and(|actor| actor == self.body.actor_id)
        )
    }

    pub fn serialize_storage_yaml(&self) -> EventResult<EventStorageBytes> {
        let mut yaml =
            serde_yaml::to_string(self).map_err(|e| EventError::EventSerialize(e.to_string()))?;
        if !yaml.ends_with('\n') {
            yaml.push('\n');
        }
        Ok(yaml.into_bytes().into())
    }

    pub fn parse_storage_bytes(bytes: &EventStorageBytes) -> EventResult<Self> {
        let text = str::from_utf8(bytes.as_ref()).map_err(|e| {
            EventError::ParseStoredEvent(format!("identity event bytes are not UTF-8: {e}"))
        })?;
        serde_yaml::from_str(text)
            .map_err(|e| EventError::ParseStoredEvent(format!("YAML parse failed: {e}")))
    }
}

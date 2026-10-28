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
    IdentityId, IdentityInviteId, IsoTimestamp, MemberLabel, StoreId,
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

/// The identity's name sealed to one member's encryption public key, so a
/// member's device can show it while the provider sees only ciphertext.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct MemberSealedName {
    pub app_id: AppId,
    pub name_ciphertext: AgeArmoredCiphertext,
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

/// Credential-free replication target of an identity mount.
///
/// Google Drive and iCloud mounts are always shared: each installation signs
/// in with its own authorized account, and no OAuth token enters the log.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum IdentityMountTarget {
    Github {
        repository: String,
    },
    /// The vault My Drive folder whose permissions list authorized accounts.
    GoogleDrive {
        folder_id: String,
    },
    /// The `CloudKit` share whose participants are authorized accounts.
    #[serde(rename = "icloud")]
    ICloud {
        share_target: String,
    },
    /// Each installation chooses its own directory; only the name replicates.
    LocalFolder {
        directory_name: String,
    },
}

/// One sync-provider mount owned by an identity.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct IdentityProviderMount {
    pub mount_id: ProviderMountId,
    pub label: String,
    pub target: IdentityMountTarget,
}

/// A one-time invitation a member issues with an enrollment code. The code's
/// holder may join once by proving the invite key over its own app keys.
/// `expires_at` is enforced by the joining client; the log enforces that an
/// invite is used once.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct IdentityInvite {
    pub invite_id: IdentityInviteId,
    pub signing_public_key: DeviceSigningPublicKey,
    pub expires_at: IsoTimestamp,
}

/// Named values that bind an invite to the member who uses it.
pub struct IdentityInviteProof<'a> {
    pub identity_id: &'a IdentityId,
    pub invite_id: &'a IdentityInviteId,
    pub member: &'a IdentityMemberKeys,
}

const INVITE_PROOF_PURPOSE: &str = "nook-identity-invite-join-v1";

impl IdentityInviteProof<'_> {
    fn message(&self) -> EventResult<CanonicalEventBodyBytes> {
        CanonicalEventBodyBytes::from_json(&serde_json::json!({
            "purpose": INVITE_PROOF_PURPOSE,
            "identity_id": self.identity_id.as_str(),
            "invite_id": self.invite_id.as_str(),
            "app_id": self.member.app_id.as_str(),
            "encryption_public_key": self.member.encryption_public_key.as_str(),
            "signing_public_key": self.member.signing_public_key.as_str(),
        }))
    }

    /// The invite key's signature over this member's keys.
    pub fn sign(&self, invite_key: &SigningKey) -> EventResult<Ed25519Signature> {
        Ok(Ed25519Signature::sign(&self.message()?, invite_key))
    }

    /// Whether `signature` is the invite key's proof over this member.
    pub fn verify(&self, invite: &IdentityInvite, signature: &Ed25519Signature) -> EventResult<()> {
        let invite_key =
            SigningIdentity::verifying_key_from_public_key_hex(invite.signing_public_key.as_str())?;
        signature.verify(&self.message()?, &invite_key)
    }
}

/// Atomic operations recorded in the identity control log.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum IdentityControlOperation {
    IdentityCreated {
        founder: IdentityMemberKeys,
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
    /// A member issued a one-time invite with an enrollment code.
    MemberInvited {
        invite: IdentityInvite,
    },
    /// The holder of an invite joins: it signs the event with its own app
    /// key, proves the invite key over that key, and records the vault DEKs
    /// the code carried, wrapped to itself. No member approves it.
    MemberJoinedByInvite {
        invite_id: IdentityInviteId,
        member: IdentityMemberKeys,
        invite_signature: Ed25519Signature,
        vault_deks: Vec<IdentityVaultDekGrant>,
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
        key_epoch: EventId,
        recipients: Vec<MemberVaultDek>,
    },
    VaultDekGranted {
        store_id: StoreId,
        key_epoch: EventId,
        recipients: Vec<MemberVaultDek>,
    },
    /// The vault is deleted from the identity everywhere. Permanent: later or
    /// concurrent grants for the same store do not bring it back.
    VaultRemoved {
        store_id: StoreId,
    },
    ProviderMounted {
        mount: IdentityProviderMount,
    },
    ProviderUnmounted {
        mount_id: ProviderMountId,
    },
    /// The identity's name, sealed to every member. The latest naming
    /// replaces any earlier one.
    IdentityNamed {
        recipients: Vec<MemberSealedName>,
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
            (true, [IdentityControlOperation::IdentityCreated { founder }]) => {
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
                    Self::check_one_grant_per_vault(vault_deks)?;
                }
                IdentityControlOperation::MemberInvited { invite } => {
                    SigningIdentity::verifying_key_from_public_key_hex(
                        invite.signing_public_key.as_str(),
                    )?;
                }
                IdentityControlOperation::MemberJoinedByInvite {
                    member, vault_deks, ..
                } => {
                    if body.operations.len() != 1 || member.signing_actor()? != body.actor_id {
                        return Err(EventError::IdentityControlInvalid(
                            "an invite join must be the sole operation, signed by the joiner"
                                .to_owned(),
                        ));
                    }
                    Self::check_one_grant_per_vault(vault_deks)?;
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
                IdentityControlOperation::IdentityNamed { recipients } => {
                    let mut apps = recipients
                        .iter()
                        .map(|recipient| &recipient.app_id)
                        .collect::<Vec<_>>();
                    apps.sort();
                    apps.dedup();
                    if apps.len() != recipients.len() || recipients.is_empty() {
                        return Err(EventError::IdentityControlInvalid(
                            "identity name recipients must be non-empty and unique".to_owned(),
                        ));
                    }
                }
                IdentityControlOperation::IdentityCreated { .. }
                | IdentityControlOperation::MemberJoinDenied { .. }
                | IdentityControlOperation::MemberRevoked { .. }
                | IdentityControlOperation::MemberRenamed { .. }
                | IdentityControlOperation::VaultRemoved { .. }
                | IdentityControlOperation::ProviderMounted { .. }
                | IdentityControlOperation::ProviderUnmounted { .. } => {}
            }
        }
        Ok(())
    }

    fn check_one_grant_per_vault(vault_deks: &[IdentityVaultDekGrant]) -> EventResult<()> {
        let mut stores = vault_deks
            .iter()
            .map(|grant| &grant.store_id)
            .collect::<Vec<_>>();
        stores.sort();
        stores.dedup();
        if stores.len() != vault_deks.len() {
            return Err(EventError::IdentityControlInvalid(
                "a member is granted each vault at most once".to_owned(),
            ));
        }
        Ok(())
    }

    /// The invite join this event carries, when it is one.
    #[must_use]
    pub fn invite_join(
        &self,
    ) -> Option<(&IdentityInviteId, &IdentityMemberKeys, &Ed25519Signature)> {
        match self.body.operations.as_slice() {
            [
                IdentityControlOperation::MemberJoinedByInvite {
                    invite_id,
                    member,
                    invite_signature,
                    ..
                },
            ] => Some((invite_id, member, invite_signature)),
            _ => None,
        }
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

#[cfg(test)]
mod tests {
    #![allow(clippy::too_many_lines)]

    use crate::identity_control::test_fixtures::*;

    #[test]
    fn envelopes_bind_to_one_identity_and_one_founder_genesis() -> anyhow::Result<()> {
        let fixture = Fixture::new()?;
        let other = IdentityControlLog::new(IdentityId::generate()?);
        let foreign = fixture.log.build_append(
            vec![rename(fixture.founder.app.app_id(), "Elsewhere")],
            &fixture.founder.signing(&fixture.at),
        )?;
        assert!(other.insert(foreign).is_err());

        let impostor = Installation::new()?;
        let forged_genesis = IdentityEvent::genesis(IdentityGenesisRequest {
            identity_id: &fixture.identity_id,
            founder: fixture.founder.keys("Laptop"),
            signing: impostor.signing(&fixture.at),
        })?;
        assert!(
            IdentityControlLog::new(fixture.identity_id.clone())
                .insert(forged_genesis)
                .is_err()
        );

        let second_genesis = IdentityEvent::genesis(IdentityGenesisRequest {
            identity_id: &fixture.identity_id,
            founder: impostor.keys("Other"),
            signing: impostor.signing(&fixture.at),
        })?;
        assert!(matches!(
            fixture.log.clone().insert(second_genesis),
            Err(rejection) if matches!(rejection.cause, EventError::MultipleGenesisRoots)
        ));

        let mut bytes = fixture
            .log
            .storage_bytes()?
            .into_iter()
            .map(|(_, bytes)| bytes)
            .collect::<Vec<_>>();
        let tampered = String::from_utf8(Vec::from(bytes.remove(0)))?.replace("Laptop", "Stolen");
        assert!(
            IdentityControlLog::new(fixture.identity_id.clone())
                .union_storage_bytes(&[tampered.into_bytes().into()])
                .is_err()
        );
        Ok(())
    }
}

//! Encrypted event-log delivery from an approved extension to its paired vault.

use super::queue::QueueDisposition;
use crate::{
    AuthorizedExtensionGrant, ExtensionEventLogRecord, ExtensionGrantAuthority,
    GrantAuthorityResponseJson, PairingVaultId, StoreId,
};
use nook_auth2::{AppId, DevicePublicKey, DeviceSigningPublicKey};
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use tsify::Tsify;

/// Current approved installation grant supplied by the extension background.
/// Public website requests carry only the vault ID, never these grant keys.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize, Tsify)]
#[serde(deny_unknown_fields)]
pub struct ExportVaultEventLogPayload {
    vault_store_id: StoreId,
    app_id: AppId,
    app_public_key: DevicePublicKey,
    app_signing_public_key: DeviceSigningPublicKey,
    queue: QueueDisposition,
}

/// Page-controlled request data cannot select an installation or grant keys.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize, Tsify)]
#[serde(deny_unknown_fields)]
pub struct ExtensionVaultEventLogRequest {
    pub vault_store_id: StoreId,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize, Tsify)]
#[serde(deny_unknown_fields, tag = "type", content = "payload")]
pub enum ExtensionVaultEventLogRequestMessage {
    ExportVaultEventLog(ExtensionVaultEventLogRequest),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, Tsify)]
pub enum ExtensionVaultEventLogFailure {
    Unavailable,
    Locked,
    NoMatchingAuthority,
    MissingActiveAuthority,
    InvalidStoredAuthority,
    AccessDenied,
    Failed,
}

/// Contains only existing signed encrypted records. Access is checked by the
/// manager before export; decoding alone does not establish device approval.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize, Tsify)]
#[serde(deny_unknown_fields, tag = "kind")]
pub enum ExtensionVaultEventLogResponse {
    NotPaired,
    Exported {
        vault_store_id: StoreId,
        event_log_records: Vec<ExtensionEventLogRecord>,
    },
    Rejected {
        reason: ExtensionVaultEventLogFailure,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("extension event log does not match the requested vault")]
pub struct ExtensionVaultEventLogResponseError;

#[derive(Deserialize, Tsify)]
#[serde(transparent)]
pub struct ExtensionVaultEventLogResponseAdmission(ExtensionVaultEventLogResponse);

/// One canonical structural decoder request shared by both WASM packages.
#[derive(Deserialize, Tsify)]
#[serde(deny_unknown_fields)]
pub struct ExtensionVaultEventLogResponseDecodeRequest {
    response: ExtensionVaultEventLogResponseAdmission,
    vault_store_id: StoreId,
}

impl ExtensionVaultEventLogResponseDecodeRequest {
    pub fn decode(
        self,
    ) -> Result<ExtensionVaultEventLogResponse, ExtensionVaultEventLogResponseError> {
        let ExtensionVaultEventLogResponseAdmission(response) = self.response;
        response.admit(&self.vault_store_id)
    }
}

impl ExtensionVaultEventLogResponse {
    pub fn admit(
        self,
        expected_store_id: &StoreId,
    ) -> Result<Self, ExtensionVaultEventLogResponseError> {
        match &self {
            Self::Exported {
                vault_store_id,
                event_log_records,
            } => {
                match vault_store_id.cmp(expected_store_id) {
                    Ordering::Equal => {}
                    Ordering::Less | Ordering::Greater => {
                        return Err(ExtensionVaultEventLogResponseError);
                    }
                }
                for record in event_log_records {
                    record.admit_store(expected_store_id)?;
                }
            }
            Self::Rejected { reason: _ } => {}
            Self::NotPaired => {}
        }
        Ok(self)
    }
}

impl ExtensionEventLogRecord {
    fn admit_store(
        &self,
        expected_store_id: &StoreId,
    ) -> Result<(), ExtensionVaultEventLogResponseError> {
        match self.event.store_id().cmp(expected_store_id) {
            Ordering::Equal => Ok(()),
            Ordering::Less | Ordering::Greater => Err(ExtensionVaultEventLogResponseError),
        }
    }
}

#[derive(Debug, PartialEq, Eq, Serialize, Tsify)]
#[serde(tag = "kind")]
pub enum ExtensionVaultEventLogGrantDecision {
    NotPaired,
    Rejected {
        reason: ExtensionVaultEventLogFailure,
    },
    Authorized {
        grant: Box<AuthorizedExtensionGrant>,
    },
}

impl From<ExtensionGrantAuthority> for ExtensionVaultEventLogGrantDecision {
    fn from(authority: ExtensionGrantAuthority) -> Self {
        match authority {
            ExtensionGrantAuthority::NoMatchingAuthority => Self::NotPaired,
            ExtensionGrantAuthority::MissingActiveAuthority => Self::Rejected {
                reason: ExtensionVaultEventLogFailure::MissingActiveAuthority,
            },
            ExtensionGrantAuthority::InvalidStoredAuthority => Self::Rejected {
                reason: ExtensionVaultEventLogFailure::InvalidStoredAuthority,
            },
            ExtensionGrantAuthority::Authorized(grant) => Self::Authorized { grant },
        }
    }
}

/// Reuses the existing grant response decoder and its requested-vault binding.
#[derive(Debug, Deserialize, Tsify)]
#[serde(deny_unknown_fields)]
pub struct ExtensionVaultEventLogGrantDecodeRequest {
    pub authority_response: GrantAuthorityResponseJson,
    pub vault_store_id: PairingVaultId,
}

impl ExtensionVaultEventLogGrantDecodeRequest {
    pub fn decode(
        self,
    ) -> Result<ExtensionVaultEventLogGrantDecision, crate::GrantAuthorityResponseError> {
        Ok(self.authority_response.decode(&self.vault_store_id)?.into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{ExtensionSessionRequest, ExtensionSessionRequestValidation};
    use anyhow::Error;
    use nook_auth2::AppKey;

    #[test]
    fn export_request_requires_current_typed_grant_and_preserves_queue() -> anyhow::Result<()> {
        let app = AppKey::generate()?;
        let signer = SigningIdentity::from_seed_hex_stored(&"24".repeat(32))?;
        let request = ExtensionSessionRequest::ExportVaultEventLog(ExportVaultEventLogPayload {
            vault_store_id: StoreId::parse("store_abcdefghijk")?,
            app_id: app.app_id().clone(),
            app_public_key: app.public_key(),
            app_signing_public_key: signer.public_key(),
            queue: QueueDisposition::MessageDefault {},
        });
        let serialized = serde_json::to_string(&request)?;
        assert_eq!(
            serde_json::from_str::<ExtensionSessionRequest>(&serialized)?,
            request
        );
        assert_eq!(
            ExtensionSessionRequestValidation::validate_extension_session_request_json(&serialized),
            ExtensionSessionRequestValidation::Accepted
        );
        let invalid_queue = serialized.replace(
            r#""kind":"message-default""#,
            r#""kind":"message-default","priority":"interactive""#,
        );
        assert_eq!(
            ExtensionSessionRequestValidation::validate_extension_session_request_json(
                &invalid_queue
            ),
            ExtensionSessionRequestValidation::Rejected
        );
        Ok(())
    }

    #[test]
    fn export_request_rejects_missing_or_invalid_installation_keys() {
        for malformed in [
            r#"{"type":"ExportVaultEventLog","payload":{"vault_store_id":"store_abcdefghijk","queue":{"kind":"message-default"}}}"#,
            r#"{"type":"ExportVaultEventLog","payload":{"vault_store_id":"store_abcdefghijk","app_id":"wrong","app_public_key":"wrong","app_signing_public_key":"wrong","queue":{"kind":"message-default"}}}"#,
        ] {
            assert_eq!(
                ExtensionSessionRequestValidation::validate_extension_session_request_json(
                    malformed
                ),
                ExtensionSessionRequestValidation::Rejected
            );
        }
    }

    use nook_auth2::{IsoTimestamp, SecretId, SecretType};
    use nook_event_log::{
        EncryptedSecretPayload, EventId, SecretFingerprint, SigningIdentity, VaultEvent,
        VaultEventBody, VaultEventSchemaVersion, VaultOperation,
    };

    struct EventFixture;
    impl EventFixture {
        fn response(store_id: StoreId) -> anyhow::Result<ExtensionVaultEventLogResponse> {
            let signer = SigningIdentity::from_seed_hex_stored(&"42".repeat(32))?;
            let event = VaultEvent::sign(
                VaultEventBody {
                    schema_version: VaultEventSchemaVersion::CURRENT,
                    store_id: store_id.clone(),
                    actor_id: signer.actor_id()?,
                    actor_signing_public_key: signer.public_key(),
                    parents: Vec::new(),
                    created_at: IsoTimestamp::parse("2026-10-10T00:00:00Z")?,
                    key_epoch: EventId::from_sha256_hex(&"11".repeat(32))?,
                    operations: vec![VaultOperation::SecretCreated {
                        secret: EncryptedSecretPayload::from_armored(
                            &SecretId::parse("secret_abcdefghijk")?,
                            SecretType::Passkey,
                            "-----BEGIN AGE ENCRYPTED FILE-----\nfixture-ciphertext\n-----END AGE ENCRYPTED FILE-----",
                            SecretFingerprint::parse("credential-fingerprint")
                                .map_err(Error::msg)?,
                            SecretFingerprint::parse("encrypted-revision-fingerprint")
                                .map_err(Error::msg)?,
                        ),
                    }],
                },
                signer.signing_key(),
            )?;
            event.verify_signature(&signer.verifying_key())?;
            Ok(ExtensionVaultEventLogResponse::Exported {
                vault_store_id: store_id,
                event_log_records: vec![ExtensionEventLogRecord {
                    event_id: event.id()?.as_str().to_owned(),
                    path: "events/passkey.json".to_owned(),
                    event: event.into(),
                }],
            })
        }
    }

    #[test]
    fn encrypted_passkey_event_survives_export_admission_unchanged() -> anyhow::Result<()> {
        let store_id = StoreId::parse("store_abcdefghijk")?;
        let response = EventFixture::response(store_id.clone())?;
        let serialized = serde_json::to_string(&response)?;
        let decoded: ExtensionVaultEventLogResponse = serde_json::from_str(&serialized)?;
        assert_eq!(decoded.admit(&store_id)?, response);
        assert_eq!(serde_json::to_string(&response)?, serialized);
        Ok(())
    }

    #[test]
    fn export_admission_rejects_foreign_response_and_foreign_event() -> anyhow::Result<()> {
        let expected = StoreId::parse("store_abcdefghijk")?;
        let foreign = StoreId::parse("store_lmnopqrstuv")?;
        assert_eq!(
            EventFixture::response(foreign.clone())?.admit(&expected),
            Err(ExtensionVaultEventLogResponseError)
        );
        let ExtensionVaultEventLogResponse::Exported {
            event_log_records, ..
        } = EventFixture::response(foreign)?
        else {
            anyhow::bail!("fixture must export events");
        };
        assert_eq!(
            ExtensionVaultEventLogResponse::Exported {
                vault_store_id: expected.clone(),
                event_log_records
            }
            .admit(&expected),
            Err(ExtensionVaultEventLogResponseError)
        );
        Ok(())
    }

    #[test]
    fn unpaired_authority_is_distinct_from_broken_active_authority() {
        assert_eq!(
            ExtensionVaultEventLogGrantDecision::from(ExtensionGrantAuthority::NoMatchingAuthority),
            ExtensionVaultEventLogGrantDecision::NotPaired
        );
        assert_eq!(
            ExtensionVaultEventLogGrantDecision::from(
                ExtensionGrantAuthority::MissingActiveAuthority
            ),
            ExtensionVaultEventLogGrantDecision::Rejected {
                reason: ExtensionVaultEventLogFailure::MissingActiveAuthority
            }
        );
        assert_eq!(
            ExtensionVaultEventLogGrantDecision::from(
                ExtensionGrantAuthority::InvalidStoredAuthority
            ),
            ExtensionVaultEventLogGrantDecision::Rejected {
                reason: ExtensionVaultEventLogFailure::InvalidStoredAuthority
            }
        );
    }

    #[test]
    fn public_export_request_cannot_select_grant_or_installation() -> anyhow::Result<()> {
        let request = ExtensionVaultEventLogRequestMessage::ExportVaultEventLog(
            ExtensionVaultEventLogRequest {
                vault_store_id: StoreId::parse("store_abcdefghijk")?,
            },
        );
        let encoded = serde_json::to_string(&request)?;
        assert_eq!(
            serde_json::from_str::<ExtensionVaultEventLogRequestMessage>(&encoded)?,
            request
        );
        for malformed in [
            r#"{"type":"ExportVaultEventLog","payload":{"vault_store_id":"store_abcdefghijk","app_id":"1234567890abcdef"}}"#,
            r#"{"type":"ExportVaultEventLog","payload":{"vault_store_id":"store_abcdefghijk","app_public_key":"forged"}}"#,
            r#"{"type":"ExportVaultEventLog","payload":{"vault_store_id":""}}"#,
            r#"{"type":"ExportVaultEventLog","payload":{}}"#,
        ] {
            assert!(
                serde_json::from_str::<ExtensionVaultEventLogRequestMessage>(malformed).is_err()
            );
        }
        Ok(())
    }
}

//! Concrete browser-extension session request contracts.

#![allow(dead_code)] // Serde reads the private wire fields during concrete decoding.

use super::queue::{
    MessageDefaultQueueDisposition, PasskeyCeremonyQueueDisposition, QueueDisposition,
    deserialize_finite_f64,
};
use crate::ExtensionVaultEventPayload;
use serde::{Deserialize, Deserializer, de::Error as _};
use tsify::Tsify;
use wasm_bindgen::prelude::wasm_bindgen;
use zeroize::Zeroize;

const MAX_ENROLLMENT_AUTHORIZATION_ID_BYTES: usize = 128;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Tsify)]
#[tsify(type = "0 | 1")]
pub struct PasskeyDeviceModeWire(nook_authenticator_domain::PasskeyDeviceProtectionMode);

impl<'de> Deserialize<'de> for PasskeyDeviceModeWire {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        match u32::deserialize(deserializer)? {
            0 => Ok(Self(
                nook_authenticator_domain::PasskeyDeviceProtectionMode::Standard,
            )),
            1 => Ok(Self(
                nook_authenticator_domain::PasskeyDeviceProtectionMode::AntiHacker,
            )),
            _ => Err(D::Error::custom("device mode is not supported")),
        }
    }
}

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExtensionSessionRequestValidation {
    Accepted,
    Rejected,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(transparent)]
pub struct SessionSecretText(String);

impl Zeroize for SessionSecretText {
    fn zeroize(&mut self) {
        self.0.zeroize();
    }
}

impl Drop for SessionSecretText {
    fn drop(&mut self) {
        self.zeroize();
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(transparent)]
pub struct SessionSecretBytes(Vec<u8>);

impl Zeroize for SessionSecretBytes {
    fn zeroize(&mut self) {
        self.0.zeroize();
    }
}

impl Drop for SessionSecretBytes {
    fn drop(&mut self) {
        self.zeroize();
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(deny_unknown_fields)]
pub struct SerializedStorageProvider {
    id: String,
    #[serde(rename = "type")]
    provider_type: SerializedStorageProviderType,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
pub enum SerializedStorageProviderType {
    Local,
    LocalFolder,
    Github,
    #[serde(rename = "oauth-file")]
    OAuthFile,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ExtensionEventLogRecord {
    event_id: String,
    path: String,
    event: ExtensionVaultEventPayload,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(deny_unknown_fields)]
pub struct EmptyPayload {
    queue: QueueDisposition,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FinishPasskeySetupPayload {
    credential_id: SessionSecretBytes,
    user_handle: SessionSecretBytes,
    prf_input: SessionSecretBytes,
    prf_output: SessionSecretBytes,
    device_mode: PasskeyDeviceModeWire,
    queue: QueueDisposition,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RecoverPasskeyPayload {
    credential_id: SessionSecretBytes,
    user_handle: SessionSecretBytes,
    prf_output: SessionSecretBytes,
    queue: QueueDisposition,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct UnlockPasskeyPayload {
    prf_output: SessionSecretBytes,
    queue: QueueDisposition,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(deny_unknown_fields)]
pub struct PinPayload {
    pin: SessionSecretText,
    queue: QueueDisposition,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct IdentityHandoffPayload {
    recipient_public_key: String,
    nonce: String,
    expected_device_id: String,
    expected_device_public_key: String,
    expected_device_signing_public_key: String,
    queue: QueueDisposition,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ImportVaultPayload {
    vault_store_id: String,
    device_id: String,
    device_public_key: String,
    device_signing_public_key: String,
    providers: Vec<SerializedStorageProvider>,
    event_log_records: Vec<ExtensionEventLogRecord>,
    queue: QueueDisposition,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct UpdateVaultPayload {
    vault_store_id: String,
    device_id: String,
    device_public_key: String,
    device_signing_public_key: String,
    event_log_records: Vec<ExtensionEventLogRecord>,
    queue: QueueDisposition,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PasskeyLookupPayload {
    vault_store_id: String,
    device_id: String,
    device_public_key: String,
    device_signing_public_key: String,
    rp_id: String,
    origin: String,
    queue: QueueDisposition,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct OriginGrantPayload {
    vault_store_id: String,
    device_id: String,
    device_public_key: String,
    device_signing_public_key: String,
    origin: String,
    queue: QueueDisposition,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SecretGrantPayload {
    vault_store_id: String,
    device_id: String,
    device_public_key: String,
    device_signing_public_key: String,
    origin: String,
    secret_id: String,
    queue: QueueDisposition,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct QueryGrantPayload {
    vault_store_id: String,
    device_id: String,
    device_public_key: String,
    device_signing_public_key: String,
    query: String,
    queue: QueueDisposition,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SecretIdGrantPayload {
    vault_store_id: String,
    device_id: String,
    device_public_key: String,
    device_signing_public_key: String,
    secret_id: String,
    queue: QueueDisposition,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct OtpauthPayload {
    otpauth_uri: SessionSecretText,
    queue: QueueDisposition,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct OtpauthGrantPayload {
    vault_store_id: String,
    device_id: String,
    device_public_key: String,
    device_signing_public_key: String,
    otpauth_uri: SessionSecretText,
    origin: String,
    enrollment_authorization_id: EnrollmentAuthorizationId,
    queue: QueueDisposition,
}

#[derive(Debug, Clone, PartialEq, Eq, Tsify)]
#[tsify(type = "string")]
pub struct EnrollmentAuthorizationId(String);

impl<'de> Deserialize<'de> for EnrollmentAuthorizationId {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value.trim().is_empty() || value.len() > MAX_ENROLLMENT_AUTHORIZATION_ID_BYTES {
            return Err(D::Error::custom(
                "enrollment authorization id must be nonempty and at most 128 bytes",
            ));
        }
        Ok(Self(value))
    }
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct EnrollmentAuthorizationPayload {
    enrollment_authorization_id: EnrollmentAuthorizationId,
    #[serde(deserialize_with = "deserialize_finite_f64")]
    expires_at: f64,
    queue: QueueDisposition,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct EnrollmentAuthorizationRevokePayload {
    enrollment_authorization_id: EnrollmentAuthorizationId,
    queue: MessageDefaultQueueDisposition,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct BackupAttachPayload {
    vault_store_id: String,
    device_id: String,
    device_public_key: String,
    device_signing_public_key: String,
    secret_id: String,
    codes: Vec<SessionSecretText>,
    #[tsify(type = "'replace' | 'merge'")]
    mode: nook_authenticator_domain::BackupCodeAttachMode,
    queue: QueueDisposition,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct LoginSavePlanPayload {
    vault_store_id: String,
    device_id: String,
    device_public_key: String,
    device_signing_public_key: String,
    origin: String,
    username: SessionSecretText,
    password: SessionSecretText,
    queue: QueueDisposition,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(deny_unknown_fields)]
pub struct OriginPayload {
    origin: String,
    queue: QueueDisposition,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct LoginSaveActionPayload {
    origin: String,
    offer_id: String,
    queue: QueueDisposition,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct GrantedLoginSaveActionPayload {
    vault_store_id: String,
    device_id: String,
    device_public_key: String,
    device_signing_public_key: String,
    origin: String,
    offer_id: String,
    queue: QueueDisposition,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RequestPayload {
    request_id: String,
    queue: QueueDisposition,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DirectLoginSaveActionPayload {
    origin: String,
    offer_id: String,
    queue: MessageDefaultQueueDisposition,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DirectRequestPayload {
    request_id: String,
    queue: MessageDefaultQueueDisposition,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PasskeyCeremonyPayload {
    vault_store_id: String,
    device_id: String,
    device_public_key: String,
    device_signing_public_key: String,
    request_id: String,
    request_json: SessionSecretText,
    queue: PasskeyCeremonyQueueDisposition,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(deny_unknown_fields, tag = "type", content = "payload")]
pub enum ExtensionSessionRequest {
    #[serde(rename = "nook:extension-session-reset")]
    Reset(EmptyPayload),
    #[serde(rename = "nook:extension-session-migrate-auth-providers")]
    MigrateAuthProviders(EmptyPayload),
    #[serde(rename = "nook:extension-session-status")]
    Status(EmptyPayload),
    #[serde(rename = "nook:extension-session-begin-passkey-setup")]
    BeginPasskeySetup(EmptyPayload),
    #[serde(rename = "nook:extension-session-finish-passkey-setup")]
    FinishPasskeySetup(FinishPasskeySetupPayload),
    #[serde(rename = "nook:extension-session-recover-passkey")]
    RecoverPasskey(RecoverPasskeyPayload),
    #[serde(rename = "nook:extension-session-unlock-options")]
    UnlockOptions(EmptyPayload),
    #[serde(rename = "nook:extension-session-unlock-passkey")]
    UnlockPasskey(UnlockPasskeyPayload),
    #[serde(rename = "nook:extension-session-create-pin")]
    CreatePin(PinPayload),
    #[serde(rename = "nook:extension-session-unlock-pin")]
    UnlockPin(PinPayload),
    #[serde(rename = "nook:extension-session-seal-identity-handoff")]
    SealIdentityHandoff(IdentityHandoffPayload),
    #[serde(rename = "nook:extension-session-import-vault")]
    ImportVault(ImportVaultPayload),
    #[serde(rename = "nook:extension-session-update-vault")]
    UpdateVault(UpdateVaultPayload),
    #[serde(rename = "nook:extension-session-list-passkeys")]
    ListPasskeys(PasskeyLookupPayload),
    #[serde(rename = "nook:extension-session-list-logins")]
    ListLogins(OriginGrantPayload),
    #[serde(rename = "nook:extension-session-reveal-login")]
    RevealLogin(SecretGrantPayload),
    #[serde(rename = "nook:extension-session-list-authenticators")]
    ListAuthenticators(QueryGrantPayload),
    #[serde(rename = "nook:extension-session-authenticator-code")]
    AuthenticatorCode(SecretIdGrantPayload),
    #[serde(rename = "nook:extension-session-authenticator-enroll-preview")]
    AuthenticatorEnrollPreview(OtpauthPayload),
    #[serde(rename = "nook:extension-session-authenticator-enroll-code")]
    AuthenticatorEnrollCode(OtpauthPayload),
    #[serde(rename = "nook:extension-session-authenticator-enroll-authorize")]
    AuthenticatorEnrollAuthorize(EnrollmentAuthorizationPayload),
    #[serde(rename = "nook:extension-session-authenticator-enroll-revoke")]
    AuthenticatorEnrollRevoke(EnrollmentAuthorizationRevokePayload),
    #[serde(rename = "nook:extension-session-authenticator-enroll-confirm")]
    AuthenticatorEnrollConfirm(OtpauthGrantPayload),
    #[serde(rename = "nook:extension-session-authenticator-backup-attach")]
    AuthenticatorBackupAttach(BackupAttachPayload),
    #[serde(rename = "nook:extension-session-plan-login-save")]
    PlanLoginSave(LoginSavePlanPayload),
    #[serde(rename = "nook:extension-session-pending-login-save")]
    PendingLoginSave(OriginPayload),
    #[serde(rename = "nook:extension-session-commit-login-save")]
    CommitLoginSave(GrantedLoginSaveActionPayload),
    #[serde(rename = "nook:extension-session-dismiss-login-save")]
    DismissLoginSave(DirectLoginSaveActionPayload),
    #[serde(rename = "nook:extension-session-cancel-passkey")]
    CancelPasskey(DirectRequestPayload),
    #[serde(rename = "nook:extension-session-register-passkey")]
    RegisterPasskey(PasskeyCeremonyPayload),
    #[serde(rename = "nook:extension-session-assert-passkey")]
    AssertPasskey(PasskeyCeremonyPayload),
    #[serde(rename = "nook:extension-session-lock")]
    Lock(EmptyPayload),
}

/// A concrete session request decoded directly from the browser value.
///
/// The generated boundary exposes the exact request union rather than a generic
/// JavaScript value. Sensitive allocations are erased as soon as validation
/// finishes.
#[derive(Debug, Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(from_wasm_abi)]
pub struct ExtensionSessionRequestWire(ExtensionSessionRequest);

impl Drop for ExtensionSessionRequestWire {
    fn drop(&mut self) {
        match &mut self.0 {
            ExtensionSessionRequest::FinishPasskeySetup(payload) => {
                payload.credential_id.zeroize();
                payload.user_handle.zeroize();
                payload.prf_input.zeroize();
                payload.prf_output.zeroize();
            }
            ExtensionSessionRequest::RecoverPasskey(payload) => {
                payload.credential_id.zeroize();
                payload.user_handle.zeroize();
                payload.prf_output.zeroize();
            }
            ExtensionSessionRequest::UnlockPasskey(payload) => payload.prf_output.zeroize(),
            ExtensionSessionRequest::CreatePin(payload)
            | ExtensionSessionRequest::UnlockPin(payload) => payload.pin.zeroize(),
            ExtensionSessionRequest::SealIdentityHandoff(payload) => {
                payload.recipient_public_key.zeroize();
                payload.nonce.zeroize();
                payload.expected_device_id.zeroize();
                payload.expected_device_public_key.zeroize();
                payload.expected_device_signing_public_key.zeroize();
            }
            ExtensionSessionRequest::AuthenticatorEnrollPreview(payload)
            | ExtensionSessionRequest::AuthenticatorEnrollCode(payload) => {
                payload.otpauth_uri.zeroize();
            }
            ExtensionSessionRequest::AuthenticatorEnrollConfirm(payload) => {
                payload.otpauth_uri.zeroize();
            }
            ExtensionSessionRequest::AuthenticatorBackupAttach(payload) => {
                payload.codes.zeroize();
            }
            ExtensionSessionRequest::PlanLoginSave(payload) => {
                payload.username.zeroize();
                payload.password.zeroize();
            }
            ExtensionSessionRequest::RegisterPasskey(payload)
            | ExtensionSessionRequest::AssertPasskey(payload) => {
                payload.request_json.zeroize();
            }
            ExtensionSessionRequest::Reset(_)
            | ExtensionSessionRequest::MigrateAuthProviders(_)
            | ExtensionSessionRequest::Status(_)
            | ExtensionSessionRequest::BeginPasskeySetup(_)
            | ExtensionSessionRequest::UnlockOptions(_)
            | ExtensionSessionRequest::ImportVault(_)
            | ExtensionSessionRequest::UpdateVault(_)
            | ExtensionSessionRequest::ListPasskeys(_)
            | ExtensionSessionRequest::ListLogins(_)
            | ExtensionSessionRequest::RevealLogin(_)
            | ExtensionSessionRequest::ListAuthenticators(_)
            | ExtensionSessionRequest::AuthenticatorCode(_)
            | ExtensionSessionRequest::AuthenticatorEnrollAuthorize(_)
            | ExtensionSessionRequest::AuthenticatorEnrollRevoke(_)
            | ExtensionSessionRequest::PendingLoginSave(_)
            | ExtensionSessionRequest::CommitLoginSave(_)
            | ExtensionSessionRequest::DismissLoginSave(_)
            | ExtensionSessionRequest::CancelPasskey(_)
            | ExtensionSessionRequest::Lock(_) => {}
        }
    }
}

#[must_use]
pub fn validate_extension_session_request_json(
    serialized: &str,
) -> ExtensionSessionRequestValidation {
    if serde_json::from_str::<ExtensionSessionRequestWire>(serialized).is_ok() {
        ExtensionSessionRequestValidation::Accepted
    } else {
        ExtensionSessionRequestValidation::Rejected
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_concrete_provider_and_event_log_elements() {
        let valid_event = serde_json::json!({
            "schema_version": 2,
            "store_id": "store_testtoken11",
            "actor_id": format!("key_{}", "0".repeat(64)),
            "actor_signing_public_key": "0".repeat(64),
            "parents": [],
            "created_at": "2026-08-10T00:00:00Z",
            "key_epoch": "sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo",
            "operations": [{ "type": "vault-cleared" }],
            "signature": format!("ed25519:{}", "0".repeat(128)),
        });
        let valid_request = serde_json::json!({
            "type": "nook:extension-session-import-vault",
            "payload": {
                "vaultStoreId": "vault",
                "deviceId": "device",
                "devicePublicKey": "public",
                "deviceSigningPublicKey": "signing",
                "providers": [{ "id": "provider", "type": "github" }],
                "eventLogRecords": [{
                    "eventId": "event",
                    "path": "path",
                    "event": valid_event,
                }],
                "queue": { "kind": "message-default" },
            },
        });
        let valid = valid_request.to_string();
        assert_eq!(
            validate_extension_session_request_json(&valid),
            ExtensionSessionRequestValidation::Accepted
        );

        let malformed_provider = valid.replace(
            r#"{"id":"provider","type":"github"}"#,
            r#"{"githubPat":"secret"}"#,
        );
        assert_eq!(
            validate_extension_session_request_json(&malformed_provider),
            ExtensionSessionRequestValidation::Rejected
        );

        let valid_signature = format!(r#""signature":"ed25519:{}""#, "0".repeat(128));
        let malformed_event = valid.replace(&valid_signature, r#""signature":1"#);
        assert_eq!(
            validate_extension_session_request_json(&malformed_event),
            ExtensionSessionRequestValidation::Rejected
        );
    }

    #[test]
    fn validates_passkey_bytes_and_queue_metadata() {
        let valid = r#"{"type":"nook:extension-session-finish-passkey-setup","payload":{"credentialId":[1],"userHandle":[2],"prfInput":[3],"prfOutput":[4],"deviceMode":1,"queue":{"kind":"deadline","expiresAt":42,"priority":"interactive"}}}"#;
        assert_eq!(
            validate_extension_session_request_json(valid),
            ExtensionSessionRequestValidation::Accepted
        );
        assert_eq!(
            validate_extension_session_request_json(&valid.replace("[4]", "[256]")),
            ExtensionSessionRequestValidation::Rejected
        );
        assert_eq!(
            validate_extension_session_request_json(&valid.replace("interactive", "background")),
            ExtensionSessionRequestValidation::Rejected
        );
        assert_eq!(
            validate_extension_session_request_json(
                &valid.replace(r#""expiresAt":42"#, r#""expiresAt":null"#,),
            ),
            ExtensionSessionRequestValidation::Rejected
        );
        assert_eq!(
            validate_extension_session_request_json(
                &valid.replace(r#""priority":"interactive""#, r#""priority":null"#),
            ),
            ExtensionSessionRequestValidation::Rejected
        );
        let ceremony = r#"{"type":"nook:extension-session-register-passkey","payload":{"vaultStoreId":"vault","deviceId":"device","devicePublicKey":"public","deviceSigningPublicKey":"signing","requestId":"request","requestJson":"{}","queue":{"kind":"deadline","expiresAt":42,"priority":"interactive"}}}"#;
        assert_eq!(
            validate_extension_session_request_json(ceremony),
            ExtensionSessionRequestValidation::Accepted
        );
        assert_eq!(
            validate_extension_session_request_json(&ceremony.replace("interactive", "probe")),
            ExtensionSessionRequestValidation::Rejected
        );
        assert_eq!(
            validate_extension_session_request_json(&ceremony.replace(
                r#"{"kind":"deadline","expiresAt":42,"priority":"interactive"}"#,
                r#"{"kind":"message-default"}"#,
            )),
            ExtensionSessionRequestValidation::Rejected
        );
    }

    #[test]
    fn validates_each_migrated_session_request_family() {
        let cases = [
            (
                "recovery",
                r#"{"type":"nook:extension-session-recover-passkey","payload":{"credentialId":[1],"userHandle":[2],"prfOutput":[3],"queue":{"kind":"message-default"}}}"#,
                r#""prfOutput":[3],"#,
            ),
            (
                "pin",
                r#"{"type":"nook:extension-session-unlock-pin","payload":{"pin":"123456","queue":{"kind":"message-default"}}}"#,
                r#""pin":"123456","#,
            ),
            (
                "identity handoff",
                r#"{"type":"nook:extension-session-seal-identity-handoff","payload":{"recipientPublicKey":"recipient","nonce":"nonce","expectedDeviceId":"device","expectedDevicePublicKey":"public","expectedDeviceSigningPublicKey":"signing","queue":{"kind":"message-default"}}}"#,
                r#""nonce":"nonce","#,
            ),
            (
                "passkey lookup",
                r#"{"type":"nook:extension-session-list-passkeys","payload":{"vaultStoreId":"vault","deviceId":"device","devicePublicKey":"public","deviceSigningPublicKey":"signing","rpId":"example.com","origin":"https://example.com","queue":{"kind":"message-default"}}}"#,
                r#""rpId":"example.com","#,
            ),
            (
                "origin grant",
                r#"{"type":"nook:extension-session-list-logins","payload":{"vaultStoreId":"vault","deviceId":"device","devicePublicKey":"public","deviceSigningPublicKey":"signing","origin":"https://example.com","queue":{"kind":"message-default"}}}"#,
                r#""origin":"https://example.com","#,
            ),
            (
                "secret grant",
                r#"{"type":"nook:extension-session-reveal-login","payload":{"vaultStoreId":"vault","deviceId":"device","devicePublicKey":"public","deviceSigningPublicKey":"signing","origin":"https://example.com","secretId":"secret","queue":{"kind":"message-default"}}}"#,
                r#""secretId":"secret","#,
            ),
            (
                "query grant",
                r#"{"type":"nook:extension-session-list-authenticators","payload":{"vaultStoreId":"vault","deviceId":"device","devicePublicKey":"public","deviceSigningPublicKey":"signing","query":"example","queue":{"kind":"message-default"}}}"#,
                r#""query":"example","#,
            ),
            (
                "secret-id grant",
                r#"{"type":"nook:extension-session-authenticator-code","payload":{"vaultStoreId":"vault","deviceId":"device","devicePublicKey":"public","deviceSigningPublicKey":"signing","secretId":"secret","queue":{"kind":"message-default"}}}"#,
                r#""secretId":"secret","#,
            ),
            (
                "OTP preview",
                r#"{"type":"nook:extension-session-authenticator-enroll-preview","payload":{"otpauthUri":"otpauth://totp/example","queue":{"kind":"message-default"}}}"#,
                r#""otpauthUri":"otpauth://totp/example","#,
            ),
            (
                "OTP confirm",
                r#"{"type":"nook:extension-session-authenticator-enroll-confirm","payload":{"vaultStoreId":"vault","deviceId":"device","devicePublicKey":"public","deviceSigningPublicKey":"signing","otpauthUri":"otpauth://totp/example","origin":"https://example.com","enrollmentAuthorizationId":"authorization","queue":{"kind":"message-default"}}}"#,
                r#""otpauthUri":"otpauth://totp/example","#,
            ),
            (
                "backup attach",
                r#"{"type":"nook:extension-session-authenticator-backup-attach","payload":{"vaultStoreId":"vault","deviceId":"device","devicePublicKey":"public","deviceSigningPublicKey":"signing","secretId":"secret","codes":["backup"],"mode":"replace","queue":{"kind":"message-default"}}}"#,
                r#""codes":["backup"],"#,
            ),
            (
                "login-save plan",
                r#"{"type":"nook:extension-session-plan-login-save","payload":{"vaultStoreId":"vault","deviceId":"device","devicePublicKey":"public","deviceSigningPublicKey":"signing","origin":"https://example.com","username":"alice","password":"password","queue":{"kind":"message-default"}}}"#,
                r#""password":"password","#,
            ),
            (
                "pending login-save",
                r#"{"type":"nook:extension-session-pending-login-save","payload":{"origin":"https://example.com","queue":{"kind":"message-default"}}}"#,
                r#""origin":"https://example.com","#,
            ),
            (
                "commit login-save",
                r#"{"type":"nook:extension-session-commit-login-save","payload":{"vaultStoreId":"vault","deviceId":"device","devicePublicKey":"public","deviceSigningPublicKey":"signing","origin":"https://example.com","offerId":"offer","queue":{"kind":"message-default"}}}"#,
                r#""offerId":"offer","#,
            ),
            (
                "dismiss login-save",
                r#"{"type":"nook:extension-session-dismiss-login-save","payload":{"origin":"https://example.com","offerId":"offer","queue":{"kind":"message-default"}}}"#,
                r#""offerId":"offer","#,
            ),
            (
                "assert ceremony",
                r#"{"type":"nook:extension-session-assert-passkey","payload":{"vaultStoreId":"vault","deviceId":"device","devicePublicKey":"public","deviceSigningPublicKey":"signing","requestId":"request","requestJson":"{}","queue":{"kind":"deadline","expiresAt":42,"priority":"interactive"}}}"#,
                r#""requestJson":"{}","#,
            ),
        ];

        for (family, valid, required_field) in cases {
            assert_eq!(
                validate_extension_session_request_json(valid),
                ExtensionSessionRequestValidation::Accepted,
                "{family} request should be accepted"
            );
            assert_eq!(
                validate_extension_session_request_json(&valid.replace(required_field, "")),
                ExtensionSessionRequestValidation::Rejected,
                "{family} request should require its domain fields"
            );
        }
    }

    #[test]
    fn rejects_open_ended_session_domain_values() {
        let passkey_setup = r#"{"type":"nook:extension-session-finish-passkey-setup","payload":{"credentialId":[1],"userHandle":[2],"prfInput":[3],"prfOutput":[4],"deviceMode":1,"queue":{"kind":"deadline","expiresAt":42,"priority":"interactive"}}}"#;
        assert_eq!(
            validate_extension_session_request_json(
                &passkey_setup.replace(r#""deviceMode":1"#, r#""deviceMode":2"#),
            ),
            ExtensionSessionRequestValidation::Rejected
        );
        let backup_attach = r#"{"type":"nook:extension-session-authenticator-backup-attach","payload":{"vaultStoreId":"vault","deviceId":"device","devicePublicKey":"public","deviceSigningPublicKey":"signing","secretId":"secret","codes":["backup"],"mode":"replace","queue":{"kind":"message-default"}}}"#;
        assert_eq!(
            validate_extension_session_request_json(
                &backup_attach.replace(r#""mode":"replace""#, r#""mode":"append""#),
            ),
            ExtensionSessionRequestValidation::Rejected
        );
    }

    #[test]
    fn validates_bounded_enrollment_authorization_identifiers() {
        let valid = r#"{"type":"nook:extension-session-authenticator-enroll-confirm","payload":{"vaultStoreId":"vault","deviceId":"device","devicePublicKey":"public","deviceSigningPublicKey":"signing","otpauthUri":"otpauth://totp/example","origin":"https://example.com","enrollmentAuthorizationId":"authorization","queue":{"kind":"message-default"}}}"#;
        assert_eq!(
            validate_extension_session_request_json(valid),
            ExtensionSessionRequestValidation::Accepted
        );
        for invalid in [
            valid.replace(r#""enrollmentAuthorizationId":"authorization","#, ""),
            valid.replace("authorization", ""),
            valid.replace("authorization", "   "),
            valid.replace(
                "authorization",
                &"a".repeat(MAX_ENROLLMENT_AUTHORIZATION_ID_BYTES + 1),
            ),
            valid.replace(
                r#""enrollmentAuthorizationId":"authorization""#,
                r#""enrollmentAuthorizationId":"authorization","foreign":true"#,
            ),
        ] {
            assert_eq!(
                validate_extension_session_request_json(&invalid),
                ExtensionSessionRequestValidation::Rejected
            );
        }
    }

    #[test]
    fn validates_enrollment_authorization_control_requests() {
        let authorize = r#"{"type":"nook:extension-session-authenticator-enroll-authorize","payload":{"enrollmentAuthorizationId":"authorization","expiresAt":42,"queue":{"kind":"deadline","expiresAt":42,"priority":"interactive"}}}"#;
        let revoke = r#"{"type":"nook:extension-session-authenticator-enroll-revoke","payload":{"enrollmentAuthorizationId":"authorization","queue":{"kind":"message-default"}}}"#;
        for valid in [authorize, revoke] {
            assert_eq!(
                validate_extension_session_request_json(valid),
                ExtensionSessionRequestValidation::Accepted
            );
        }
        for invalid in [
            authorize.replace(r#""enrollmentAuthorizationId":"authorization","#, ""),
            authorize.replace("authorization", ""),
            authorize.replace(
                "authorization",
                &"a".repeat(MAX_ENROLLMENT_AUTHORIZATION_ID_BYTES + 1),
            ),
            authorize.replace(r#""expiresAt":42,"#, r#""expiresAt":null,"#),
            authorize.replace("interactive", "background"),
            authorize.replace(
                r#""queue":{"kind":"deadline","expiresAt":42,"priority":"interactive"}"#,
                r#""queue":{"kind":"deadline","expiresAt":42,"priority":"interactive","foreign":true}"#,
            ),
            revoke.replace(r#""enrollmentAuthorizationId":"authorization","#, ""),
            revoke.replace("authorization", "   "),
            revoke.replace(
                "authorization",
                &"a".repeat(MAX_ENROLLMENT_AUTHORIZATION_ID_BYTES + 1),
            ),
            revoke.replace(
                r#"{"kind":"message-default"}"#,
                r#"{"kind":"deadline","expiresAt":42,"priority":"interactive"}"#,
            ),
            revoke.replace(
                r#""queue":{"kind":"message-default"}"#,
                r#""queue":{"kind":"message-default"},"foreign":true"#,
            ),
        ] {
            assert_eq!(
                validate_extension_session_request_json(&invalid),
                ExtensionSessionRequestValidation::Rejected
            );
        }
    }

    #[test]
    fn every_session_request_rejects_fields_outside_its_variant() {
        for request in [
            r#"{"type":"nook:extension-session-plan-login-save","payload":{"vaultStoreId":"vault","deviceId":"device","devicePublicKey":"public","deviceSigningPublicKey":"signing","origin":"https://example.com","username":"alice","password":"password","otpauthUri":"otpauth://totp/foreign","queue":{"kind":"message-default"}}}"#,
            r#"{"type":"nook:extension-session-status","payload":{"queue":{"kind":"message-default"},"requestJson":"{}"}}"#,
            r#"{"type":"nook:extension-session-status","payload":{"queue":{"kind":"message-default"}},"codes":["foreign"]}"#,
        ] {
            assert_eq!(
                validate_extension_session_request_json(request),
                ExtensionSessionRequestValidation::Rejected
            );
        }
    }

    #[test]
    fn direct_session_requests_reject_deadline_queue_semantics() {
        for request in [
            r#"{"type":"nook:extension-session-dismiss-login-save","payload":{"origin":"https://example.com","offerId":"offer","queue":{"kind":"deadline","expiresAt":42,"priority":"interactive"}}}"#,
            r#"{"type":"nook:extension-session-cancel-passkey","payload":{"requestId":"request","queue":{"kind":"deadline","expiresAt":42,"priority":"interactive"}}}"#,
        ] {
            assert_eq!(
                validate_extension_session_request_json(request),
                ExtensionSessionRequestValidation::Rejected
            );
        }
    }
}

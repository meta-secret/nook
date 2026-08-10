//! Concrete browser-extension session ingress contracts.

#![allow(dead_code)] // Serde reads the private wire fields during concrete decoding.

use serde::{Deserialize, Deserializer, de::Error as _};
use tsify::Tsify;
use wasm_bindgen::prelude::wasm_bindgen;
use zeroize::Zeroize;

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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
pub enum QueuePriority {
    Interactive,
}

#[derive(Debug, Clone, Default, PartialEq, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct QueueMetadata {
    #[serde(default, deserialize_with = "deserialize_optional_finite_f64")]
    queue_expires_at: Option<f64>,
    #[serde(default, deserialize_with = "deserialize_optional_non_null")]
    queue_priority: Option<QueuePriority>,
}

fn deserialize_optional_non_null<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(deserializer).map(Some)
}

fn deserialize_finite_f64<'de, D>(deserializer: D) -> Result<f64, D::Error>
where
    D: Deserializer<'de>,
{
    let value = f64::deserialize(deserializer)?;
    if value.is_finite() {
        Ok(value)
    } else {
        Err(D::Error::custom("queue expiry must be finite"))
    }
}

fn deserialize_optional_finite_f64<'de, D>(deserializer: D) -> Result<Option<f64>, D::Error>
where
    D: Deserializer<'de>,
{
    deserialize_finite_f64(deserializer).map(Some)
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct VaultGrant {
    vault_store_id: String,
    device_id: String,
    device_public_key: String,
    device_signing_public_key: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
pub struct SerializedStorageProvider {
    id: String,
    #[serde(rename = "type")]
    provider_type: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
pub struct ExtensionVaultEventPayload {
    schema_version: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionEventLogRecord {
    event_id: String,
    path: String,
    event: ExtensionVaultEventPayload,
}

#[derive(Debug, Clone, Default, PartialEq, Deserialize, Tsify)]
pub struct EmptyPayload {
    #[serde(flatten)]
    queue: QueueMetadata,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct FinishPasskeySetupPayload {
    credential_id: SessionSecretBytes,
    user_handle: SessionSecretBytes,
    prf_input: SessionSecretBytes,
    prf_output: SessionSecretBytes,
    device_mode: u32,
    #[serde(flatten)]
    queue: QueueMetadata,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct RecoverPasskeyPayload {
    credential_id: SessionSecretBytes,
    user_handle: SessionSecretBytes,
    prf_output: SessionSecretBytes,
    #[serde(flatten)]
    queue: QueueMetadata,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct UnlockPasskeyPayload {
    prf_output: SessionSecretBytes,
    #[serde(flatten)]
    queue: QueueMetadata,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
pub struct PinPayload {
    pin: SessionSecretText,
    #[serde(flatten)]
    queue: QueueMetadata,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct IdentityHandoffPayload {
    recipient_public_key: String,
    nonce: String,
    expected_device_id: String,
    expected_device_public_key: String,
    expected_device_signing_public_key: String,
    #[serde(flatten)]
    queue: QueueMetadata,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct ImportVaultPayload {
    #[serde(flatten)]
    grant: VaultGrant,
    providers: Vec<SerializedStorageProvider>,
    event_log_records: Vec<ExtensionEventLogRecord>,
    #[serde(flatten)]
    queue: QueueMetadata,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct UpdateVaultPayload {
    #[serde(flatten)]
    grant: VaultGrant,
    event_log_records: Vec<ExtensionEventLogRecord>,
    #[serde(flatten)]
    queue: QueueMetadata,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct PasskeyLookupPayload {
    #[serde(flatten)]
    grant: VaultGrant,
    rp_id: String,
    origin: String,
    #[serde(flatten)]
    queue: QueueMetadata,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
pub struct OriginGrantPayload {
    #[serde(flatten)]
    grant: VaultGrant,
    origin: String,
    #[serde(flatten)]
    queue: QueueMetadata,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct SecretGrantPayload {
    #[serde(flatten)]
    grant: VaultGrant,
    origin: String,
    secret_id: String,
    #[serde(flatten)]
    queue: QueueMetadata,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
pub struct QueryGrantPayload {
    #[serde(flatten)]
    grant: VaultGrant,
    query: String,
    #[serde(flatten)]
    queue: QueueMetadata,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct SecretIdGrantPayload {
    #[serde(flatten)]
    grant: VaultGrant,
    secret_id: String,
    #[serde(flatten)]
    queue: QueueMetadata,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct OtpauthPayload {
    otpauth_uri: SessionSecretText,
    #[serde(flatten)]
    queue: QueueMetadata,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct OtpauthGrantPayload {
    #[serde(flatten)]
    grant: VaultGrant,
    otpauth_uri: SessionSecretText,
    origin: String,
    #[serde(flatten)]
    queue: QueueMetadata,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct BackupAttachPayload {
    #[serde(flatten)]
    grant: VaultGrant,
    secret_id: String,
    codes: Vec<SessionSecretText>,
    mode: String,
    #[serde(flatten)]
    queue: QueueMetadata,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
pub struct LoginSavePlanPayload {
    #[serde(flatten)]
    grant: VaultGrant,
    origin: String,
    username: SessionSecretText,
    password: SessionSecretText,
    #[serde(flatten)]
    queue: QueueMetadata,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
pub struct OriginPayload {
    origin: String,
    #[serde(flatten)]
    queue: QueueMetadata,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct LoginSaveActionPayload {
    origin: String,
    offer_id: String,
    #[serde(flatten)]
    queue: QueueMetadata,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct GrantedLoginSaveActionPayload {
    #[serde(flatten)]
    grant: VaultGrant,
    origin: String,
    offer_id: String,
    #[serde(flatten)]
    queue: QueueMetadata,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct RequestPayload {
    request_id: String,
    #[serde(flatten)]
    queue: QueueMetadata,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct PasskeyCeremonyPayload {
    #[serde(flatten)]
    grant: VaultGrant,
    request_id: String,
    request_json: SessionSecretText,
    #[serde(deserialize_with = "deserialize_finite_f64")]
    queue_expires_at: f64,
    #[serde(default, deserialize_with = "deserialize_optional_non_null")]
    queue_priority: Option<QueuePriority>,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(tag = "type", content = "payload")]
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
    DismissLoginSave(LoginSaveActionPayload),
    #[serde(rename = "nook:extension-session-cancel-passkey")]
    CancelPasskey(RequestPayload),
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

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct WebsiteLoginAccountWire {
    vault_store_id: String,
    vault_name: String,
    secret_id: String,
    username: String,
    website_url: String,
    website_host: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
pub enum WebsiteLoginOptionsStatusWire {
    Ready,
    Locked,
    Unavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct WebsiteLoginOptionsWire {
    ok: bool,
    status: Option<WebsiteLoginOptionsStatusWire>,
    accounts: Option<Vec<WebsiteLoginAccountWire>>,
    reason: Option<String>,
}

/// Concrete companion response decoded at the browser runtime boundary.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(transparent)]
#[tsify(from_wasm_abi)]
pub struct WebsiteLoginOptionsWireValue(WebsiteLoginOptionsWire);

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi)]
pub struct WebsiteLoginAccountOption {
    pub vault_store_id: String,
    pub vault_name: String,
    pub secret_id: String,
    pub username: String,
    pub website_url: String,
    pub website_host: String,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, Tsify)]
#[serde(tag = "kind", rename_all = "kebab-case")]
#[tsify(into_wasm_abi)]
pub enum WebsiteLoginOptions {
    Ready {
        accounts: Vec<WebsiteLoginAccountOption>,
    },
    Locked,
    Unavailable,
    Rejected {
        reason: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum WebsiteLoginOptionsDecodeError {
    #[error("website login options response is malformed")]
    Malformed,
}

pub fn decode_website_login_options_json(
    serialized: &str,
) -> Result<WebsiteLoginOptions, WebsiteLoginOptionsDecodeError> {
    let wire = serde_json::from_str::<WebsiteLoginOptionsWireValue>(serialized)
        .map_err(|_| WebsiteLoginOptionsDecodeError::Malformed)?;
    decode_website_login_options(wire)
}

pub fn decode_website_login_options(
    wire: WebsiteLoginOptionsWireValue,
) -> Result<WebsiteLoginOptions, WebsiteLoginOptionsDecodeError> {
    let WebsiteLoginOptionsWireValue(wire) = wire;
    if !wire.ok {
        return wire
            .reason
            .filter(|reason| !reason.trim().is_empty())
            .map(|reason| WebsiteLoginOptions::Rejected { reason })
            .ok_or(WebsiteLoginOptionsDecodeError::Malformed);
    }
    match wire.status {
        Some(WebsiteLoginOptionsStatusWire::Ready) => {
            let accounts = wire
                .accounts
                .ok_or(WebsiteLoginOptionsDecodeError::Malformed)?;
            if accounts.iter().any(|account| {
                account.vault_store_id.trim().is_empty() || account.secret_id.trim().is_empty()
            }) {
                return Err(WebsiteLoginOptionsDecodeError::Malformed);
            }
            Ok(WebsiteLoginOptions::Ready {
                accounts: accounts
                    .into_iter()
                    .map(|account| WebsiteLoginAccountOption {
                        vault_store_id: account.vault_store_id,
                        vault_name: account.vault_name,
                        secret_id: account.secret_id,
                        username: account.username,
                        website_url: account.website_url,
                        website_host: account.website_host,
                    })
                    .collect(),
            })
        }
        Some(WebsiteLoginOptionsStatusWire::Locked) => Ok(WebsiteLoginOptions::Locked),
        Some(WebsiteLoginOptionsStatusWire::Unavailable) => Ok(WebsiteLoginOptions::Unavailable),
        None => Err(WebsiteLoginOptionsDecodeError::Malformed),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
pub enum LoginPickerOpenStatusWire {
    Ready,
    Locked,
    Unavailable,
}

/// Concrete service-worker response presented to the content-script boundary.
#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(from_wasm_abi)]
pub struct LoginPickerOpenResponseWire {
    ok: bool,
    status: Option<LoginPickerOpenStatusWire>,
    request_id: Option<String>,
    expires_at: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, Tsify)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
#[tsify(into_wasm_abi)]
pub enum LoginPickerOpenResponse {
    Failed,
    Ready { request_id: String, expires_at: f64 },
    Locked,
    Unavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("login picker open response is malformed")]
pub struct LoginPickerOpenResponseDecodeError;

pub fn decode_login_picker_open_response(
    wire: LoginPickerOpenResponseWire,
) -> Result<LoginPickerOpenResponse, LoginPickerOpenResponseDecodeError> {
    if !wire.ok {
        return if wire.status.is_none() && wire.request_id.is_none() && wire.expires_at.is_none() {
            Ok(LoginPickerOpenResponse::Failed)
        } else {
            Err(LoginPickerOpenResponseDecodeError)
        };
    }

    match wire.status {
        Some(LoginPickerOpenStatusWire::Ready) => {
            let request_id = wire
                .request_id
                .filter(|request_id| !request_id.trim().is_empty())
                .ok_or(LoginPickerOpenResponseDecodeError)?;
            let expires_at = wire
                .expires_at
                .filter(|expires_at| expires_at.is_finite())
                .ok_or(LoginPickerOpenResponseDecodeError)?;
            Ok(LoginPickerOpenResponse::Ready {
                request_id,
                expires_at,
            })
        }
        Some(LoginPickerOpenStatusWire::Locked)
            if wire.request_id.is_none() && wire.expires_at.is_none() =>
        {
            Ok(LoginPickerOpenResponse::Locked)
        }
        Some(LoginPickerOpenStatusWire::Unavailable)
            if wire.request_id.is_none() && wire.expires_at.is_none() =>
        {
            Ok(LoginPickerOpenResponse::Unavailable)
        }
        Some(LoginPickerOpenStatusWire::Locked | LoginPickerOpenStatusWire::Unavailable) | None => {
            Err(LoginPickerOpenResponseDecodeError)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_concrete_provider_and_event_log_elements() {
        let valid = r#"{"type":"nook:extension-session-import-vault","payload":{"vaultStoreId":"vault","deviceId":"device","devicePublicKey":"public","deviceSigningPublicKey":"signing","providers":[{"id":"provider","type":"github"}],"eventLogRecords":[{"eventId":"event","path":"path","event":{"schema_version":1}}]}}"#;
        assert_eq!(
            validate_extension_session_request_json(valid),
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

        let malformed_event = valid.replace(
            r#"{"eventId":"event","path":"path","event":{"schema_version":1}}"#,
            r#"{"eventId":"event"}"#,
        );
        assert_eq!(
            validate_extension_session_request_json(&malformed_event),
            ExtensionSessionRequestValidation::Rejected
        );
    }

    #[test]
    fn validates_passkey_bytes_and_queue_metadata() {
        let valid = r#"{"type":"nook:extension-session-finish-passkey-setup","payload":{"credentialId":[1],"userHandle":[2],"prfInput":[3],"prfOutput":[4],"deviceMode":1,"queuePriority":"interactive"}}"#;
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
            validate_extension_session_request_json(&valid.replace(
                r#""queuePriority":"interactive""#,
                r#""queueExpiresAt":null,"queuePriority":"interactive""#,
            ),),
            ExtensionSessionRequestValidation::Rejected
        );
        assert_eq!(
            validate_extension_session_request_json(&valid.replace(
                r#""queuePriority":"interactive""#,
                r#""queuePriority":null"#
            ),),
            ExtensionSessionRequestValidation::Rejected
        );
    }

    #[test]
    fn decodes_login_options_into_a_domain_union() -> anyhow::Result<()> {
        let ready = r#"{"ok":true,"status":"ready","accounts":[{"vaultStoreId":"vault","vaultName":"Personal","secretId":"secret","username":"alice","websiteUrl":"https://example.com","websiteHost":"example.com"}]}"#;
        assert_eq!(
            decode_website_login_options_json(ready)?,
            WebsiteLoginOptions::Ready {
                accounts: vec![WebsiteLoginAccountOption {
                    vault_store_id: "vault".to_owned(),
                    vault_name: "Personal".to_owned(),
                    secret_id: "secret".to_owned(),
                    username: "alice".to_owned(),
                    website_url: "https://example.com".to_owned(),
                    website_host: "example.com".to_owned(),
                }]
            }
        );
        assert!(
            decode_website_login_options_json(&ready.replacen("\"vault\"", "\"\"", 1)).is_err()
        );
        assert!(decode_website_login_options_json(r#"{"ok":true,"status":"ready"}"#).is_err());
        Ok(())
    }

    #[test]
    fn picker_ready_state_owns_complete_metadata() -> anyhow::Result<()> {
        let ready = LoginPickerOpenResponseWire {
            ok: true,
            status: Some(LoginPickerOpenStatusWire::Ready),
            request_id: Some("request".to_owned()),
            expires_at: Some(42.0),
        };
        assert_eq!(
            decode_login_picker_open_response(ready)?,
            LoginPickerOpenResponse::Ready {
                request_id: "request".to_owned(),
                expires_at: 42.0,
            }
        );

        let incomplete_ready = LoginPickerOpenResponseWire {
            ok: true,
            status: Some(LoginPickerOpenStatusWire::Ready),
            request_id: None,
            expires_at: Some(42.0),
        };
        assert!(decode_login_picker_open_response(incomplete_ready).is_err());

        let invalid_locked = LoginPickerOpenResponseWire {
            ok: true,
            status: Some(LoginPickerOpenStatusWire::Locked),
            request_id: Some("request".to_owned()),
            expires_at: None,
        };
        assert!(decode_login_picker_open_response(invalid_locked).is_err());
        Ok(())
    }
}

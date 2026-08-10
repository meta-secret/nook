//! Concrete browser-extension session ingress contracts.

#![allow(dead_code)] // Serde reads the private wire fields during concrete decoding.

use serde::{Deserialize, Deserializer, Serializer, de::Error as _};
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
    Probe,
    Interactive,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum QueueDisposition {
    MessageDefault,
    Deadline {
        #[serde(deserialize_with = "deserialize_finite_f64")]
        expires_at: f64,
        priority: QueuePriority,
    },
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum PasskeyCeremonyQueueDisposition {
    Deadline {
        #[serde(deserialize_with = "deserialize_finite_f64")]
        expires_at: f64,
        priority: QueuePriority,
    },
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

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
pub struct EmptyPayload {
    queue: QueueDisposition,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct FinishPasskeySetupPayload {
    credential_id: SessionSecretBytes,
    user_handle: SessionSecretBytes,
    prf_input: SessionSecretBytes,
    prf_output: SessionSecretBytes,
    device_mode: u32,
    queue: QueueDisposition,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct RecoverPasskeyPayload {
    credential_id: SessionSecretBytes,
    user_handle: SessionSecretBytes,
    prf_output: SessionSecretBytes,
    queue: QueueDisposition,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct UnlockPasskeyPayload {
    prf_output: SessionSecretBytes,
    queue: QueueDisposition,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
pub struct PinPayload {
    pin: SessionSecretText,
    queue: QueueDisposition,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct IdentityHandoffPayload {
    recipient_public_key: String,
    nonce: String,
    expected_device_id: String,
    expected_device_public_key: String,
    expected_device_signing_public_key: String,
    queue: QueueDisposition,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct ImportVaultPayload {
    #[serde(flatten)]
    grant: VaultGrant,
    providers: Vec<SerializedStorageProvider>,
    event_log_records: Vec<ExtensionEventLogRecord>,
    queue: QueueDisposition,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct UpdateVaultPayload {
    #[serde(flatten)]
    grant: VaultGrant,
    event_log_records: Vec<ExtensionEventLogRecord>,
    queue: QueueDisposition,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct PasskeyLookupPayload {
    #[serde(flatten)]
    grant: VaultGrant,
    rp_id: String,
    origin: String,
    queue: QueueDisposition,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
pub struct OriginGrantPayload {
    #[serde(flatten)]
    grant: VaultGrant,
    origin: String,
    queue: QueueDisposition,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct SecretGrantPayload {
    #[serde(flatten)]
    grant: VaultGrant,
    origin: String,
    secret_id: String,
    queue: QueueDisposition,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
pub struct QueryGrantPayload {
    #[serde(flatten)]
    grant: VaultGrant,
    query: String,
    queue: QueueDisposition,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct SecretIdGrantPayload {
    #[serde(flatten)]
    grant: VaultGrant,
    secret_id: String,
    queue: QueueDisposition,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct OtpauthPayload {
    otpauth_uri: SessionSecretText,
    queue: QueueDisposition,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct OtpauthGrantPayload {
    #[serde(flatten)]
    grant: VaultGrant,
    otpauth_uri: SessionSecretText,
    origin: String,
    queue: QueueDisposition,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct BackupAttachPayload {
    #[serde(flatten)]
    grant: VaultGrant,
    secret_id: String,
    codes: Vec<SessionSecretText>,
    mode: String,
    queue: QueueDisposition,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
pub struct LoginSavePlanPayload {
    #[serde(flatten)]
    grant: VaultGrant,
    origin: String,
    username: SessionSecretText,
    password: SessionSecretText,
    queue: QueueDisposition,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
pub struct OriginPayload {
    origin: String,
    queue: QueueDisposition,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct LoginSaveActionPayload {
    origin: String,
    offer_id: String,
    queue: QueueDisposition,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct GrantedLoginSaveActionPayload {
    #[serde(flatten)]
    grant: VaultGrant,
    origin: String,
    offer_id: String,
    queue: QueueDisposition,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct RequestPayload {
    request_id: String,
    queue: QueueDisposition,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct PasskeyCeremonyPayload {
    #[serde(flatten)]
    grant: VaultGrant,
    request_id: String,
    request_json: SessionSecretText,
    queue: PasskeyCeremonyQueueDisposition,
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
#[serde(deny_unknown_fields, tag = "status", rename_all = "kebab-case")]
pub enum WebsiteLoginOptionsAvailableWire {
    Ready {
        ok: bool,
        accounts: Vec<WebsiteLoginAccountWire>,
    },
    Locked {
        ok: bool,
    },
    Unavailable {
        ok: bool,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(deny_unknown_fields)]
pub struct WebsiteLoginOptionsRejectedWire {
    ok: bool,
    reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(untagged, rename_all_fields = "camelCase")]
pub enum WebsiteLoginOptionsWire {
    Available(WebsiteLoginOptionsAvailableWire),
    Rejected(WebsiteLoginOptionsRejectedWire),
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
#[serde(untagged, rename_all_fields = "camelCase")]
#[tsify(into_wasm_abi)]
pub enum WebsiteLoginOptions {
    Ready {
        kind: WebsiteLoginOptionsKind,
        accounts: Vec<WebsiteLoginAccountOption>,
    },
    Locked {
        kind: WebsiteLoginOptionsKind,
    },
    Unavailable {
        kind: WebsiteLoginOptionsKind,
    },
    Rejected {
        kind: WebsiteLoginOptionsKind,
        reason: String,
    },
}

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WebsiteLoginOptionsKind {
    Ready,
    Locked,
    Unavailable,
    Rejected,
}

impl serde::Serialize for WebsiteLoginOptionsKind {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_u8(*self as u8)
    }
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
    match wire {
        WebsiteLoginOptionsWire::Available(WebsiteLoginOptionsAvailableWire::Ready {
            ok,
            accounts,
        }) if ok => {
            if accounts.iter().any(|account| {
                account.vault_store_id.trim().is_empty() || account.secret_id.trim().is_empty()
            }) {
                return Err(WebsiteLoginOptionsDecodeError::Malformed);
            }
            Ok(WebsiteLoginOptions::Ready {
                kind: WebsiteLoginOptionsKind::Ready,
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
        WebsiteLoginOptionsWire::Available(WebsiteLoginOptionsAvailableWire::Locked { ok })
            if ok =>
        {
            Ok(WebsiteLoginOptions::Locked {
                kind: WebsiteLoginOptionsKind::Locked,
            })
        }
        WebsiteLoginOptionsWire::Available(WebsiteLoginOptionsAvailableWire::Unavailable {
            ok,
        }) if ok => Ok(WebsiteLoginOptions::Unavailable {
            kind: WebsiteLoginOptionsKind::Unavailable,
        }),
        WebsiteLoginOptionsWire::Rejected(WebsiteLoginOptionsRejectedWire {
            ok: false,
            reason,
        }) if !reason.trim().is_empty() => Ok(WebsiteLoginOptions::Rejected {
            kind: WebsiteLoginOptionsKind::Rejected,
            reason,
        }),
        WebsiteLoginOptionsWire::Available(_)
        | WebsiteLoginOptionsWire::Rejected(WebsiteLoginOptionsRejectedWire { .. }) => {
            Err(WebsiteLoginOptionsDecodeError::Malformed)
        }
    }
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(
    deny_unknown_fields,
    tag = "status",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum LoginPickerOpenAvailableWire {
    Ready {
        ok: bool,
        request_id: String,
        #[serde(deserialize_with = "deserialize_finite_f64")]
        expires_at: f64,
    },
    Locked {
        ok: bool,
    },
    Unavailable {
        ok: bool,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(deny_unknown_fields)]
pub struct LoginPickerOpenFailedWire {
    ok: bool,
    reason: String,
}

/// Concrete service-worker response presented to the content-script boundary.
#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(untagged)]
#[tsify(from_wasm_abi)]
pub enum LoginPickerOpenResponseWire {
    Available(LoginPickerOpenAvailableWire),
    Failed(LoginPickerOpenFailedWire),
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, Tsify)]
#[serde(untagged, rename_all_fields = "camelCase")]
#[tsify(into_wasm_abi)]
pub enum LoginPickerOpenResponse {
    Failed {
        kind: LoginPickerOpenResponseKind,
    },
    Ready {
        kind: LoginPickerOpenResponseKind,
        request_id: String,
        expires_at: f64,
    },
    Locked {
        kind: LoginPickerOpenResponseKind,
    },
    Unavailable {
        kind: LoginPickerOpenResponseKind,
    },
}

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LoginPickerOpenResponseKind {
    Failed,
    Ready,
    Locked,
    Unavailable,
}

impl serde::Serialize for LoginPickerOpenResponseKind {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_u8(*self as u8)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("login picker open response is malformed")]
pub struct LoginPickerOpenResponseDecodeError;

pub fn decode_login_picker_open_response(
    wire: LoginPickerOpenResponseWire,
) -> Result<LoginPickerOpenResponse, LoginPickerOpenResponseDecodeError> {
    match wire {
        LoginPickerOpenResponseWire::Available(LoginPickerOpenAvailableWire::Ready {
            ok,
            request_id,
            expires_at,
        }) if ok && !request_id.trim().is_empty() => Ok(LoginPickerOpenResponse::Ready {
            kind: LoginPickerOpenResponseKind::Ready,
            request_id,
            expires_at,
        }),
        LoginPickerOpenResponseWire::Available(LoginPickerOpenAvailableWire::Locked { ok })
            if ok =>
        {
            Ok(LoginPickerOpenResponse::Locked {
                kind: LoginPickerOpenResponseKind::Locked,
            })
        }
        LoginPickerOpenResponseWire::Available(LoginPickerOpenAvailableWire::Unavailable {
            ok,
        }) if ok => Ok(LoginPickerOpenResponse::Unavailable {
            kind: LoginPickerOpenResponseKind::Unavailable,
        }),
        LoginPickerOpenResponseWire::Failed(LoginPickerOpenFailedWire { ok: false, reason })
            if !reason.trim().is_empty() =>
        {
            Ok(LoginPickerOpenResponse::Failed {
                kind: LoginPickerOpenResponseKind::Failed,
            })
        }
        LoginPickerOpenResponseWire::Available(_)
        | LoginPickerOpenResponseWire::Failed(LoginPickerOpenFailedWire { .. }) => {
            Err(LoginPickerOpenResponseDecodeError)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_concrete_provider_and_event_log_elements() {
        let valid = r#"{"type":"nook:extension-session-import-vault","payload":{"vaultStoreId":"vault","deviceId":"device","devicePublicKey":"public","deviceSigningPublicKey":"signing","providers":[{"id":"provider","type":"github"}],"eventLogRecords":[{"eventId":"event","path":"path","event":{"schema_version":1}}],"queue":{"kind":"message-default"}}}"#;
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
            validate_extension_session_request_json(&ceremony.replace(
                r#"{"kind":"deadline","expiresAt":42,"priority":"interactive"}"#,
                r#"{"kind":"message-default"}"#,
            )),
            ExtensionSessionRequestValidation::Rejected
        );
    }

    #[test]
    fn decodes_login_options_into_a_domain_union() -> anyhow::Result<()> {
        let ready = r#"{"ok":true,"status":"ready","accounts":[{"vaultStoreId":"vault","vaultName":"Personal","secretId":"secret","username":"alice","websiteUrl":"https://example.com","websiteHost":"example.com"}]}"#;
        assert_eq!(
            decode_website_login_options_json(ready)?,
            WebsiteLoginOptions::Ready {
                kind: WebsiteLoginOptionsKind::Ready,
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
        let ready = serde_json::from_str::<LoginPickerOpenResponseWire>(
            r#"{"ok":true,"status":"ready","requestId":"request","expiresAt":42}"#,
        )?;
        assert_eq!(
            decode_login_picker_open_response(ready)?,
            LoginPickerOpenResponse::Ready {
                kind: LoginPickerOpenResponseKind::Ready,
                request_id: "request".to_owned(),
                expires_at: 42.0,
            }
        );

        assert!(
            serde_json::from_str::<LoginPickerOpenResponseWire>(
                r#"{"ok":true,"status":"ready","expiresAt":42}"#,
            )
            .is_err()
        );
        assert!(
            serde_json::from_str::<LoginPickerOpenResponseWire>(
                r#"{"ok":true,"status":"locked","requestId":"request"}"#,
            )
            .is_err()
        );
        Ok(())
    }
}

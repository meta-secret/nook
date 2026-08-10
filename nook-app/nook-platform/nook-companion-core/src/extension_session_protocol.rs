//! Concrete browser-extension session ingress contracts.

#![allow(dead_code)] // Serde reads the private wire fields during concrete decoding.

use serde::Deserialize;
use tsify::Tsify;
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExtensionSessionRequestValidation {
    Accepted,
    Rejected,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum QueuePriority {
    Interactive,
}

#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
struct QueueMetadata {
    queue_expires_at: Option<f64>,
    queue_priority: Option<QueuePriority>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VaultGrant {
    vault_store_id: String,
    device_id: String,
    device_public_key: String,
    device_signing_public_key: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
struct SerializedStorageProvider {
    id: String,
    #[serde(rename = "type")]
    provider_type: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
struct ExtensionVaultEventPayload {
    schema_version: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExtensionEventLogRecord {
    event_id: String,
    path: String,
    event: ExtensionVaultEventPayload,
}

#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
struct EmptyPayload {
    #[serde(flatten)]
    queue: QueueMetadata,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FinishPasskeySetupPayload {
    credential_id: Vec<u8>,
    user_handle: Vec<u8>,
    prf_input: Vec<u8>,
    prf_output: Vec<u8>,
    device_mode: u32,
    #[serde(flatten)]
    queue: QueueMetadata,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecoverPasskeyPayload {
    credential_id: Vec<u8>,
    user_handle: Vec<u8>,
    prf_output: Vec<u8>,
    #[serde(flatten)]
    queue: QueueMetadata,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UnlockPasskeyPayload {
    prf_output: Vec<u8>,
    #[serde(flatten)]
    queue: QueueMetadata,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
struct PinPayload {
    pin: String,
    #[serde(flatten)]
    queue: QueueMetadata,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IdentityHandoffPayload {
    recipient_public_key: String,
    nonce: String,
    expected_device_id: String,
    expected_device_public_key: String,
    expected_device_signing_public_key: String,
    #[serde(flatten)]
    queue: QueueMetadata,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportVaultPayload {
    #[serde(flatten)]
    grant: VaultGrant,
    providers: Vec<SerializedStorageProvider>,
    event_log_records: Vec<ExtensionEventLogRecord>,
    #[serde(flatten)]
    queue: QueueMetadata,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateVaultPayload {
    #[serde(flatten)]
    grant: VaultGrant,
    event_log_records: Vec<ExtensionEventLogRecord>,
    #[serde(flatten)]
    queue: QueueMetadata,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PasskeyLookupPayload {
    #[serde(flatten)]
    grant: VaultGrant,
    rp_id: String,
    origin: String,
    #[serde(flatten)]
    queue: QueueMetadata,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
struct OriginGrantPayload {
    #[serde(flatten)]
    grant: VaultGrant,
    origin: String,
    #[serde(flatten)]
    queue: QueueMetadata,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SecretGrantPayload {
    #[serde(flatten)]
    grant: VaultGrant,
    origin: String,
    secret_id: String,
    #[serde(flatten)]
    queue: QueueMetadata,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
struct QueryGrantPayload {
    #[serde(flatten)]
    grant: VaultGrant,
    query: String,
    #[serde(flatten)]
    queue: QueueMetadata,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SecretIdGrantPayload {
    #[serde(flatten)]
    grant: VaultGrant,
    secret_id: String,
    #[serde(flatten)]
    queue: QueueMetadata,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OtpauthPayload {
    otpauth_uri: String,
    #[serde(flatten)]
    queue: QueueMetadata,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OtpauthGrantPayload {
    #[serde(flatten)]
    grant: VaultGrant,
    otpauth_uri: String,
    origin: String,
    #[serde(flatten)]
    queue: QueueMetadata,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupAttachPayload {
    #[serde(flatten)]
    grant: VaultGrant,
    secret_id: String,
    codes: Vec<String>,
    mode: String,
    #[serde(flatten)]
    queue: QueueMetadata,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
struct LoginSavePlanPayload {
    #[serde(flatten)]
    grant: VaultGrant,
    origin: String,
    username: String,
    password: String,
    #[serde(flatten)]
    queue: QueueMetadata,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
struct OriginPayload {
    origin: String,
    #[serde(flatten)]
    queue: QueueMetadata,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoginSaveActionPayload {
    origin: String,
    offer_id: String,
    #[serde(flatten)]
    queue: QueueMetadata,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GrantedLoginSaveActionPayload {
    #[serde(flatten)]
    grant: VaultGrant,
    origin: String,
    offer_id: String,
    #[serde(flatten)]
    queue: QueueMetadata,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RequestPayload {
    request_id: String,
    #[serde(flatten)]
    queue: QueueMetadata,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PasskeyCeremonyPayload {
    #[serde(flatten)]
    grant: VaultGrant,
    request_id: String,
    request_json: String,
    queue_expires_at: f64,
    queue_priority: Option<QueuePriority>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(tag = "type", content = "payload")]
enum ExtensionSessionRequest {
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

#[must_use]
pub fn validate_extension_session_request_json(
    serialized: &str,
) -> ExtensionSessionRequestValidation {
    if serde_json::from_str::<ExtensionSessionRequest>(serialized).is_ok() {
        ExtensionSessionRequestValidation::Accepted
    } else {
        ExtensionSessionRequestValidation::Rejected
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WebsiteLoginAccountWire {
    vault_store_id: String,
    vault_name: String,
    secret_id: String,
    username: String,
    website_url: String,
    website_host: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum WebsiteLoginOptionsStatusWire {
    Ready,
    Locked,
    Unavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WebsiteLoginOptionsWire {
    ok: bool,
    status: Option<WebsiteLoginOptionsStatusWire>,
    accounts: Option<Vec<WebsiteLoginAccountWire>>,
    reason: Option<String>,
}

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
    let wire = serde_json::from_str::<WebsiteLoginOptionsWire>(serialized)
        .map_err(|_| WebsiteLoginOptionsDecodeError::Malformed)?;
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
}

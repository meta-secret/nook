//! Session-specific authenticator replies: typed admission before browser use.
use crate::authenticator_code_response::AuthenticatorCodeSecret;
use crate::{AuthenticatorCodeExpiryEpochMilliseconds, AuthenticatorEnrollmentPreview};
use serde::{Deserialize, Serialize};
use tsify::Tsify;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthenticatorCodeSessionWire {
    ok: bool,
    code: AuthenticatorCodeSecret,
    expires_at: AuthenticatorCodeExpiryEpochMilliseconds,
}
#[derive(Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi)]
pub struct AuthenticatorCodeSessionResponse {
    #[tsify(type = "true")]
    ok: bool,
    code: AuthenticatorCodeSecret,
    expires_at: AuthenticatorCodeExpiryEpochMilliseconds,
}
impl TryFrom<AuthenticatorCodeSessionWire> for AuthenticatorCodeSessionResponse {
    type Error = &'static str;
    fn try_from(wire: AuthenticatorCodeSessionWire) -> Result<Self, Self::Error> {
        if !wire.ok || !wire.expires_at.is_valid() {
            return Err("Extension session returned an invalid authenticator code.");
        }
        Ok(Self {
            ok: true,
            code: wire.code,
            expires_at: wire.expires_at,
        })
    }
}

#[derive(Deserialize)]
pub struct AuthenticatorPreviewSessionWire {
    ok: bool,
    preview: AuthenticatorEnrollmentPreview,
}
#[derive(Serialize, Tsify)]
#[tsify(into_wasm_abi)]
pub struct AuthenticatorPreviewSessionResponse {
    #[tsify(type = "true")]
    ok: bool,
    preview: AuthenticatorEnrollmentPreview,
}
impl TryFrom<AuthenticatorPreviewSessionWire> for AuthenticatorPreviewSessionResponse {
    type Error = &'static str;
    fn try_from(wire: AuthenticatorPreviewSessionWire) -> Result<Self, Self::Error> {
        if !wire.ok {
            return Err("Extension session returned an invalid preview.");
        }
        Ok(Self {
            ok: true,
            preview: wire.preview,
        })
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthenticatorSecretSessionWire {
    ok: bool,
    secret_id: String,
}
#[derive(Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi)]
pub struct AuthenticatorSecretSessionResponse {
    #[tsify(type = "true")]
    ok: bool,
    secret_id: String,
}
impl TryFrom<AuthenticatorSecretSessionWire> for AuthenticatorSecretSessionResponse {
    type Error = &'static str;
    fn try_from(wire: AuthenticatorSecretSessionWire) -> Result<Self, Self::Error> {
        if !wire.ok {
            return Err("Extension session returned an invalid secret response.");
        }
        Ok(Self {
            ok: true,
            secret_id: wire.secret_id,
        })
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthenticatorBackupVerificationSessionWire {
    ok: bool,
    secret_id: String,
    backup_codes_verified: bool,
    reviewed_input_persisted: bool,
}
/// Receipt of existing persisted verification, not a live grant or authority.
#[derive(Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi)]
pub struct VerifiedAuthenticatorBackupAttachResponse {
    #[tsify(type = "true")]
    ok: bool,
    secret_id: String,
    #[tsify(type = "true")]
    backup_codes_verified: bool,
    #[tsify(type = "true")]
    reviewed_input_persisted: bool,
}
impl TryFrom<AuthenticatorBackupVerificationSessionWire>
    for VerifiedAuthenticatorBackupAttachResponse
{
    type Error = &'static str;
    fn try_from(wire: AuthenticatorBackupVerificationSessionWire) -> Result<Self, Self::Error> {
        if !wire.ok || !wire.backup_codes_verified || !wire.reviewed_input_persisted {
            return Err("Extension session did not verify persisted authenticator backup codes.");
        }
        Ok(Self {
            ok: true,
            secret_id: wire.secret_id,
            backup_codes_verified: true,
            reviewed_input_persisted: true,
        })
    }
}

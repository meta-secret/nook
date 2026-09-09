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

#[cfg(test)]
mod tests {
    use super::*;
    use serde::de::value::{Error as ValueError, F64Deserializer};

    struct AuthenticatorSessionScenario;

    impl AuthenticatorSessionScenario {
        fn code() -> serde_json::Result<AuthenticatorCodeSessionWire> {
            serde_json::from_str(r#"{"ok":true,"code":"012345","expiresAt":1700000030000}"#)
        }

        fn preview() -> serde_json::Result<AuthenticatorPreviewSessionWire> {
            serde_json::from_str(
                r#"{"ok":true,"preview":{"issuer":"Example","account":"alice@example.com","websiteUrl":"https://example.com","algorithm":"SHA1","digits":6,"period":30}}"#,
            )
        }

        fn secret() -> serde_json::Result<AuthenticatorSecretSessionWire> {
            serde_json::from_str(r#"{"ok":true,"secretId":"authenticator-1"}"#)
        }

        fn verification() -> serde_json::Result<AuthenticatorBackupVerificationSessionWire> {
            serde_json::from_str(
                r#"{"ok":true,"secretId":"authenticator-1","backupCodesVerified":true,"reviewedInputPersisted":true}"#,
            )
        }
    }

    #[test]
    fn accepted_code_preserves_code_and_expiry_at_serialization_boundary() -> anyhow::Result<()> {
        let response =
            AuthenticatorCodeSessionResponse::try_from(AuthenticatorSessionScenario::code()?)
                .map_err(anyhow::Error::msg)?;
        let encoded = serde_json::to_string(&response)?;
        assert_eq!(
            encoded,
            r#"{"ok":true,"code":"012345","expiresAt":1700000030000.0}"#
        );
        let roundtrip: AuthenticatorCodeSessionWire = serde_json::from_str(&encoded)?;
        assert!(roundtrip.ok);
        assert!(roundtrip.expires_at.is_valid());
        Ok(())
    }

    #[test]
    fn accepted_preview_preserves_all_enrollment_fields() -> anyhow::Result<()> {
        let wire = AuthenticatorSessionScenario::preview()?;
        let expected = wire.preview.clone();
        let response =
            AuthenticatorPreviewSessionResponse::try_from(wire).map_err(anyhow::Error::msg)?;
        let roundtrip: AuthenticatorPreviewSessionWire =
            serde_json::from_str(&serde_json::to_string(&response)?)?;
        assert!(roundtrip.ok);
        assert_eq!(roundtrip.preview, expected);
        Ok(())
    }

    #[test]
    fn accepted_secret_and_persistence_receipt_preserve_identifier_and_proofs() -> anyhow::Result<()>
    {
        let secret =
            AuthenticatorSecretSessionResponse::try_from(AuthenticatorSessionScenario::secret()?)
                .map_err(anyhow::Error::msg)?;
        let secret: AuthenticatorSecretSessionWire =
            serde_json::from_str(&serde_json::to_string(&secret)?)?;
        assert!(secret.ok);
        assert_eq!(secret.secret_id, "authenticator-1");

        let receipt = VerifiedAuthenticatorBackupAttachResponse::try_from(
            AuthenticatorSessionScenario::verification()?,
        )
        .map_err(anyhow::Error::msg)?;
        let receipt: AuthenticatorBackupVerificationSessionWire =
            serde_json::from_str(&serde_json::to_string(&receipt)?)?;
        assert!(receipt.ok);
        assert_eq!(receipt.secret_id, "authenticator-1");
        assert!(receipt.backup_codes_verified);
        assert!(receipt.reviewed_input_persisted);
        Ok(())
    }

    #[test]
    fn every_session_admission_rejects_negative_status() -> anyhow::Result<()> {
        let code = AuthenticatorSessionScenario::code()?;
        assert!(
            AuthenticatorCodeSessionResponse::try_from(AuthenticatorCodeSessionWire {
                ok: false,
                ..code
            })
            .is_err()
        );
        let preview = AuthenticatorSessionScenario::preview()?;
        assert!(
            AuthenticatorPreviewSessionResponse::try_from(AuthenticatorPreviewSessionWire {
                ok: false,
                ..preview
            })
            .is_err()
        );
        let secret = AuthenticatorSessionScenario::secret()?;
        assert!(
            AuthenticatorSecretSessionResponse::try_from(AuthenticatorSecretSessionWire {
                ok: false,
                ..secret
            })
            .is_err()
        );
        let receipt = AuthenticatorSessionScenario::verification()?;
        assert!(
            VerifiedAuthenticatorBackupAttachResponse::try_from(
                AuthenticatorBackupVerificationSessionWire {
                    ok: false,
                    ..receipt
                }
            )
            .is_err()
        );
        Ok(())
    }

    #[test]
    fn code_admission_rejects_nonpositive_fractional_nonfinite_and_unsafe_expiry()
    -> anyhow::Result<()> {
        for expiry in [
            0.0,
            -1.0,
            1.5,
            f64::NAN,
            f64::INFINITY,
            f64::NEG_INFINITY,
            9_007_199_254_740_992.0,
        ] {
            // Serde's numeric value decoder permits testing non-JSON values that
            // can arrive from JavaScript without manufacturing the private newtype.
            let expires_at = AuthenticatorCodeExpiryEpochMilliseconds::deserialize(
                F64Deserializer::<ValueError>::new(expiry),
            )?;
            let code = AuthenticatorSessionScenario::code()?;
            assert!(
                AuthenticatorCodeSessionResponse::try_from(AuthenticatorCodeSessionWire {
                    expires_at,
                    ..code
                })
                .is_err(),
                "expiry {expiry}"
            );
        }
        Ok(())
    }

    #[test]
    fn code_admission_accepts_safe_positive_expiry_limits() -> anyhow::Result<()> {
        for expiry in [1.0, 9_007_199_254_740_991.0] {
            let expires_at = AuthenticatorCodeExpiryEpochMilliseconds::deserialize(
                F64Deserializer::<ValueError>::new(expiry),
            )?;
            let wire = AuthenticatorSessionScenario::code()?;
            let response =
                AuthenticatorCodeSessionResponse::try_from(AuthenticatorCodeSessionWire {
                    expires_at,
                    ..wire
                })
                .map_err(anyhow::Error::msg)?;
            assert_eq!(response.expires_at, expires_at);
        }
        Ok(())
    }

    #[test]
    fn persistence_receipt_requires_both_proofs() -> anyhow::Result<()> {
        for (verified, persisted) in [(false, true), (true, false), (false, false)] {
            let receipt = AuthenticatorSessionScenario::verification()?;
            assert!(
                VerifiedAuthenticatorBackupAttachResponse::try_from(
                    AuthenticatorBackupVerificationSessionWire {
                        backup_codes_verified: verified,
                        reviewed_input_persisted: persisted,
                        ..receipt
                    }
                )
                .is_err()
            );
        }
        for json in [
            r#"{"ok":true,"secretId":"authenticator-1","reviewedInputPersisted":true}"#,
            r#"{"ok":true,"secretId":"authenticator-1","backupCodesVerified":true}"#,
            r#"{"ok":true,"secretId":"authenticator-1"}"#,
        ] {
            assert!(
                serde_json::from_str::<AuthenticatorBackupVerificationSessionWire>(json).is_err()
            );
        }
        Ok(())
    }
}

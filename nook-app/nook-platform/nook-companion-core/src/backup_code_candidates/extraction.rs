//! Bounded post-consent plaintext projection into the existing code extractor.
use super::BackupCodePageText;
use serde::{Deserialize, Serialize};
use tsify::Tsify;
use zeroize::Zeroize;

#[derive(Serialize, Deserialize, Tsify)]
#[serde(try_from = "String")]
#[tsify(type = "string")]
pub struct AuthenticationBackupCodeText(String);

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
#[error("backup-code text exceeds the supported UTF-8 bound")]
pub struct AuthenticationBackupCodeTextError;

impl AuthenticationBackupCodeText {
    const MAX_BYTES: usize = 65_536;
}
impl TryFrom<String> for AuthenticationBackupCodeText {
    type Error = AuthenticationBackupCodeTextError;
    fn try_from(mut value: String) -> Result<Self, Self::Error> {
        match value.len() {
            0..=Self::MAX_BYTES => Ok(Self(value)),
            _ => {
                value.zeroize();
                Err(AuthenticationBackupCodeTextError)
            }
        }
    }
}
impl Drop for AuthenticationBackupCodeText {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

#[derive(Serialize, Deserialize, Tsify)]
#[serde(deny_unknown_fields)]
pub struct AuthenticationBackupCodeExtractionRequest {
    text: AuthenticationBackupCodeText,
}
#[derive(Serialize, Tsify)]
pub struct AuthenticationBackupCodeExtraction {
    #[tsify(type = "string[]")]
    codes: Vec<AuthenticationExtractedBackupCode>,
}
#[derive(Serialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "string")]
struct AuthenticationExtractedBackupCode(String);
impl Drop for AuthenticationExtractedBackupCode {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}
impl AuthenticationBackupCodeExtractionRequest {
    #[must_use]
    pub fn extract(self) -> AuthenticationBackupCodeExtraction {
        AuthenticationBackupCodeExtraction {
            codes: BackupCodePageText::new(&self.text.0)
                .extract_backup_code_candidates()
                .into_iter()
                .map(AuthenticationExtractedBackupCode)
                .collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn action_projection_backup_preserves_extraction_and_output_bounds() -> anyhow::Result<()> {
        let text = (0..65)
            .map(|index| format!("CODE-{index:04}"))
            .collect::<Vec<_>>()
            .join("\n");
        let request = AuthenticationBackupCodeExtractionRequest {
            text: text.try_into()?,
        };
        let decoded: AuthenticationBackupCodeExtractionRequest =
            serde_json::from_str(&serde_json::to_string(&request)?)?;
        let result = decoded.extract();
        assert_eq!(result.codes.len(), 64);
        assert_eq!(result.codes[0].0, "CODE-0000");
        let text = ["1".repeat(64), "2".repeat(65), "ordinary prose".to_owned()].join("\n");
        let result = AuthenticationBackupCodeExtractionRequest {
            text: text.try_into()?,
        }
        .extract();
        assert_eq!(result.codes.len(), 1);
        assert_eq!(result.codes[0].0.len(), 64);
        Ok(())
    }
    #[test]
    fn action_projection_backup_rejects_whole_oversize_utf8_and_invalid_shape() -> anyhow::Result<()>
    {
        let text = "é".repeat(AuthenticationBackupCodeText::MAX_BYTES / 2);
        let request = AuthenticationBackupCodeExtractionRequest {
            text: text.try_into()?,
        };
        assert!(request.extract().codes.is_empty());
        assert!(AuthenticationBackupCodeText::try_from("é".repeat(32_769)).is_err());
        assert!(
            serde_json::from_str::<AuthenticationBackupCodeExtractionRequest>(r#"{"text":false}"#)
                .is_err()
        );
        assert!(
            serde_json::from_str::<AuthenticationBackupCodeExtractionRequest>(
                r#"{"text":"","extra":true}"#
            )
            .is_err()
        );
        let empty = AuthenticationBackupCodeExtractionRequest {
            text: String::new().try_into()?,
        };
        assert!(empty.extract().codes.is_empty());
        Ok(())
    }
}

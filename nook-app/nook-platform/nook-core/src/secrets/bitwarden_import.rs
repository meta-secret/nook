#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! Bitwarden export dispatch and typed import reports.
mod encryption;
mod items;
use crate::SecretValue;
use encryption::EncryptedBitwardenExport;
use items::BitwardenItems;
use serde::{Deserialize, de::IgnoredAny};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BitwardenExportHeader {
    #[serde(default)]
    encrypted: BitwardenHeaderFlag,
    #[serde(default)]
    password_protected: BitwardenHeaderFlag,
}
#[derive(Deserialize)]
#[serde(untagged)]
enum BitwardenHeaderFlag {
    Boolean(bool),
    Unsupported(IgnoredAny),
}
impl Default for BitwardenHeaderFlag {
    fn default() -> Self {
        Self::Unsupported(IgnoredAny)
    }
}
impl BitwardenHeaderFlag {
    fn encryption(&self) -> BitwardenEncryption {
        match self {
            Self::Boolean(true) => BitwardenEncryption::Encrypted,
            _ => BitwardenEncryption::Plaintext,
        }
    }
    fn restriction(&self) -> BitwardenRestriction {
        match self {
            Self::Boolean(false) => BitwardenRestriction::AccountRestricted,
            _ => BitwardenRestriction::PasswordProtected,
        }
    }
}
enum BitwardenEncryption {
    Plaintext,
    Encrypted,
}
enum BitwardenRestriction {
    AccountRestricted,
    PasswordProtected,
}
use thiserror::Error;

#[derive(Debug, Error)]
pub enum BitwardenImportError {
    #[error("Bitwarden returned invalid JSON: {0}")]
    InvalidJson(#[from] serde_json::Error),
    #[error("This is not a Bitwarden JSON export: the items list is missing.")]
    InvalidResponse,
    #[error("This password-protected Bitwarden export requires its export password.")]
    PasswordRequired,
    #[error("The Bitwarden export password is incorrect or the encrypted file was modified.")]
    InvalidPassword,
    #[error(
        "This account-restricted Bitwarden export cannot be imported. Export a password-protected encrypted JSON file instead."
    )]
    AccountRestrictedExport,
    #[error("The encrypted Bitwarden export is invalid: {0}")]
    InvalidEncryptedExport(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BitwardenImportPlan {
    pub items: Vec<SecretValue>,
    pub source_count: crate::SecretImportSourceRecordCount,
    pub skipped_unsupported: crate::SecretImportUnsupportedRecordCount,
}

/// Original input and password remain borrowed until planning finishes.
/// ```
/// use nook_core::{BitwardenExport, BitwardenExportAccess};
/// let plan = BitwardenExport { json: r#"{"items":[]}"#, password: BitwardenExportAccess::WithoutPassword }.plan()?;
/// assert!(plan.items.is_empty());
/// # Ok::<(), nook_core::BitwardenImportError>(())
/// ```
/// ```compile_fail,E0382
/// use nook_core::{BitwardenExport, BitwardenExportAccess};
/// let export = BitwardenExport { json: r#"{"items":[]}"#, password: BitwardenExportAccess::WithoutPassword };
/// let _ = export.plan();
/// let _ = export.plan();
/// ```
/// ```compile_fail,E0599
/// use nook_core::{BitwardenExport, BitwardenExportAccess};
/// let export = BitwardenExport { json: r#"{"items":[]}"#, password: BitwardenExportAccess::WithoutPassword };
/// let duplicate = export.clone();
/// ```
/// ```compile_fail,E0502
/// use nook_core::{BitwardenExport, BitwardenExportAccess};
/// let mut json = String::from(r#"{"items":[]}"#);
/// let export = BitwardenExport { json: &json, password: BitwardenExportAccess::WithoutPassword };
/// json.clear();
/// let _ = export.plan();
/// ```
#[derive(Clone, Copy)]
pub enum BitwardenExportAccess<'a> {
    WithoutPassword,
    PasswordProvided(&'a str),
}
pub struct BitwardenExport<'a> {
    pub json: &'a str,
    pub password: BitwardenExportAccess<'a>,
}
impl BitwardenExport<'_> {
    pub fn plan(self) -> Result<BitwardenImportPlan, BitwardenImportError> {
        let header: BitwardenExportHeader = serde_json::from_str(self.json)?;
        if matches!(
            header.encrypted.encryption(),
            BitwardenEncryption::Plaintext
        ) {
            return Ok(BitwardenItems::parse(self.json)?.plan());
        }
        if matches!(
            header.password_protected.restriction(),
            BitwardenRestriction::AccountRestricted
        ) {
            return Err(BitwardenImportError::AccountRestrictedExport);
        }
        EncryptedBitwardenExport::parse(self.json)?
            .check(self.password)?
            .plan()
    }
}
impl BitwardenImportError {
    fn encrypted(message: impl Into<String>) -> Self {
        Self::InvalidEncryptedExport(message.into())
    }
}
#[cfg(test)]
mod tests {
    use super::{BitwardenExport, BitwardenExportAccess, BitwardenImportError};
    use crate::{SecretValue, SecureNoteSecret};

    #[test]
    fn dispatch_preserves_boolean_interpretation_and_restricted_precedence() -> anyhow::Result<()> {
        for json in [
            r#"{"items":[]}"#,
            r#"{"encrypted":false,"items":[]}"#,
            r#"{"encrypted":"true","items":[]}"#,
            r#"{"encrypted":null,"items":[]}"#,
            r#"{"encrypted":1,"items":[]}"#,
            r#"{"encrypted":[],"items":[]}"#,
            r#"{"encrypted":{},"items":[]}"#,
            r#"{"encrypted":false,"passwordProtected":{},"items":[]}"#,
        ] {
            assert!(
                BitwardenExport {
                    json,
                    password: BitwardenExportAccess::WithoutPassword
                }
                .plan()?
                .items
                .is_empty()
            );
        }
        assert!(matches!(
            BitwardenExport {
                json: r#"{"encrypted":true,"passwordProtected":false}"#,
                password: BitwardenExportAccess::WithoutPassword
            }
            .plan(),
            Err(BitwardenImportError::AccountRestrictedExport)
        ));
        assert!(matches!(
            BitwardenExport {
                json: r#"{"encrypted":true}"#,
                password: BitwardenExportAccess::WithoutPassword
            }
            .plan(),
            Err(BitwardenImportError::InvalidEncryptedExport(_))
        ));
        Ok(())
    }

    #[test]
    fn converts_export_login_fields() -> anyhow::Result<()> {
        let json = r#"{
          "items": [{
            "id": "bw-1", "type": 1, "name": "GitHub work", "notes": "recovery codes elsewhere",
            "fields": [{"name": "PIN", "value": "1234"}],
            "login": {"username": "alice", "password": "secret", "totp": "otpauth://secret",
              "uris": [{"uri": "https://github.com/login"}, {"uri": "https://gist.github.com"}]}}
          ]
        }"#;

        let plan = BitwardenExport {
            json,
            password: BitwardenExportAccess::WithoutPassword,
        }
        .plan()?;
        assert_eq!(usize::from(plan.source_count), 1);
        assert_eq!(usize::from(plan.skipped_unsupported), 0);
        let Some(SecretValue::Login(login)) = plan.items.first() else {
            panic!("expected login")
        };
        assert_eq!(login.website_url, "https://github.com/login");
        assert_eq!(login.username, "alice");
        assert_eq!(login.password, "secret");
        assert_eq!(
            login.notes,
            "recovery codes elsewhere\n\n## Bitwarden\n- name: GitHub work\n- totp: otpauth://secret\n- uri[2]: https://gist.github.com\n- field.PIN: 1234"
        );
        Ok(())
    }

    #[test]
    fn converts_plaintext_export_notes_and_skips_unsupported_items() -> anyhow::Result<()> {
        let json = r#"{"items":[
          {"type":2,"name":"Private note","notes":"hello"},
          {"type":3,"name":"Card","card":{"cardholderName":"Ada","number":"4111111111111111","expMonth":"12","expYear":"2030","code":"123","brand":"Visa"}},
          {"type":4,"name":"Identity"}
        ]}"#;
        let plan = BitwardenExport {
            json,
            password: BitwardenExportAccess::WithoutPassword,
        }
        .plan()?;
        assert_eq!(usize::from(plan.source_count), 3);
        assert_eq!(usize::from(plan.skipped_unsupported), 1);
        assert_eq!(plan.items.len(), 2);
        assert_eq!(
            *plan
                .items
                .first()
                .unwrap_or_else(|| panic!("import fixture must contain a note")),
            SecretValue::SecureNote(SecureNoteSecret {
                title: "Private note".to_owned(),
                note: "hello".to_owned(),
            })
        );
        let Some(SecretValue::CreditCard(card)) = plan.items.get(1) else {
            panic!("expected credit card");
        };
        assert_eq!(card.title, "Card");
        assert_eq!(card.number, "4111111111111111");
        assert_eq!(card.cardholder_name, "Ada");
        assert!(card.notes.contains("brand: Visa"));
        Ok(())
    }

    #[test]
    fn preserves_secure_note_custom_fields() -> anyhow::Result<()> {
        let plan = BitwardenExport {
            json: r#"{"items":[{
                "type":2,
                "name":"Recovery",
                "notes":"Keep offline",
                "fields":[
                    {"name":"answer","value":"blue"},
                    {"name":null,"value":"unnamed secret"},
                    {"name":"empty","value":null}
                ]
            }]}"#,
            password: BitwardenExportAccess::WithoutPassword,
        }
        .plan()?;
        assert_eq!(
            plan.items,
            vec![SecretValue::SecureNote(SecureNoteSecret {
                title: "Recovery".to_owned(),
                note:
                    "Keep offline\n\n## Bitwarden\n- field.answer: blue\n- field[2]: unnamed secret"
                        .to_owned(),
            })]
        );
        Ok(())
    }

    #[test]
    fn accepts_real_export_shape_with_folders_dates_nulls_and_fido_fields() -> anyhow::Result<()> {
        let plan = BitwardenExport {
            json: include_str!("fixtures/bitwarden_real_export.json"),
            password: BitwardenExportAccess::WithoutPassword,
        }
        .plan()?;
        assert_eq!(usize::from(plan.source_count), 2);
        assert_eq!(usize::from(plan.skipped_unsupported), 0);
        assert_eq!(plan.items.len(), 2);

        let Some(SecretValue::Login(first)) = plan.items.first() else {
            panic!("expected first login")
        };
        assert_eq!(first.website_url, "https://my.1password.com/signin");
        assert_eq!(first.username, "");
        assert_eq!(first.password, "");
        assert_eq!(
            first.notes,
            "bla bla bla\n\n## Bitwarden\n- name: 1password.com"
        );

        let Some(SecretValue::Login(second)) = plan.items.get(1) else {
            panic!("expected second login")
        };
        assert_eq!(second.website_url, "http://rabbitmq.9dev.io:15672/");
        assert_eq!(second.username, "guest");
        assert_eq!(second.password, "guest");
        assert_eq!(second.notes, "## Bitwarden\n- name: 9dev.io");
        Ok(())
    }

    #[test]
    fn accepts_null_optional_login_fields() -> anyhow::Result<()> {
        let plan = BitwardenExport { json: r#"{"items":[{"type":1,"name":"Example","notes":null,"login":{"username":null,"password":"pw","totp":null,"uris":[{"uri":null}]}}]}"#, password: BitwardenExportAccess::WithoutPassword }.plan()?;
        let Some(SecretValue::Login(login)) = plan.items.first() else {
            panic!("expected login")
        };
        assert_eq!(login.website_url, "Example");
        assert_eq!(login.username, "");
        assert_eq!(login.password, "pw");
        Ok(())
    }

    #[test]
    fn password_is_required_for_password_protected_exports() -> anyhow::Result<()> {
        let error = BitwardenExport { json: r#"{"encrypted":true,"passwordProtected":true,"salt":"salt","kdfType":0,"kdfIterations":600000,"encKeyValidation_DO_NOT_EDIT":"2.a|b|c","data":"2.a|b|c"}"#, password: BitwardenExportAccess::WithoutPassword }.plan()
        .err().ok_or_else(|| anyhow::anyhow!("bitwarden import test should reject invalid input"))?;
        assert!(matches!(error, BitwardenImportError::PasswordRequired));
        Ok(())
    }

    #[test]
    fn recognizes_current_bitwarden_million_iteration_encrypted_export_envelope()
    -> anyhow::Result<()> {
        // Mirrors a current real-world password-protected export without
        // retaining the user's encrypted vault payload in the repository.
        let error = BitwardenExport { json: r#"{
                "encrypted": true,
                "passwordProtected": true,
                "salt": "H9dHvU7fbVqilXoI625l+g==",
                "kdfType": 0,
                "kdfIterations": 1000000,
                "encKeyValidation_DO_NOT_EDIT": "2.AAECAwQFBgcICQoLDA0ODw==|AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA|AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
                "data": "2.EBESExQVFhcYGRobHB0eHw==|AAAAAAAAAAAAAAAAAAAAAA==|AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
            }"#, password: BitwardenExportAccess::WithoutPassword }.plan()
        .err().ok_or_else(|| anyhow::anyhow!("bitwarden import test should reject invalid input"))?;
        assert!(matches!(error, BitwardenImportError::PasswordRequired));
        Ok(())
    }

    #[test]
    fn rejects_account_restricted_exports() -> anyhow::Result<()> {
        let error = BitwardenExport { json: r#"{"encrypted":true,"passwordProtected":false,"salt":"","kdfType":0,"kdfIterations":600000,"encKeyValidation_DO_NOT_EDIT":"","data":""}"#, password: BitwardenExportAccess::PasswordProvided("password") }.plan()
        .err().ok_or_else(|| anyhow::anyhow!("bitwarden import test should reject invalid input"))?;
        assert!(matches!(
            error,
            BitwardenImportError::AccountRestrictedExport
        ));
        Ok(())
    }

    #[test]
    fn decrypts_bitwarden_password_protected_pbkdf2_fixture() -> anyhow::Result<()> {
        let plan = BitwardenExport {
            json: include_str!("fixtures/bitwarden_encrypted_pbkdf2.json"),
            password: BitwardenExportAccess::PasswordProvided("correct horse battery staple"),
        }
        .plan()?;
        assert_eq!(usize::from(plan.source_count), 2);
        assert_eq!(usize::from(plan.skipped_unsupported), 0);
        assert_eq!(plan.items.len(), 2);
        Ok(())
    }

    #[test]
    fn rejects_wrong_password_for_encrypted_fixture() -> anyhow::Result<()> {
        let error = BitwardenExport {
            json: include_str!("fixtures/bitwarden_encrypted_pbkdf2.json"),
            password: BitwardenExportAccess::PasswordProvided("wrong password"),
        }
        .plan()
        .err()
        .ok_or_else(|| anyhow::anyhow!("bitwarden import test should reject invalid input"))?;
        assert!(matches!(error, BitwardenImportError::InvalidPassword));
        Ok(())
    }
}

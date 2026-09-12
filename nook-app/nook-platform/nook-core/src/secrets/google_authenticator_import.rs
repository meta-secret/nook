#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! Complete Google Authenticator migration batches into typed TOTP items.
mod batch;
mod parameters;
use crate::SecretValue;
use batch::ParsedMigrationBatch;
use std::fmt;
use thiserror::Error;
/// Number of QR codes expected in a Google Authenticator migration batch.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct GoogleAuthenticatorMigrationQrCodeCount(usize);

impl From<usize> for GoogleAuthenticatorMigrationQrCodeCount {
    fn from(value: usize) -> Self {
        Self(value)
    }
}

impl From<GoogleAuthenticatorMigrationQrCodeCount> for usize {
    fn from(value: GoogleAuthenticatorMigrationQrCodeCount) -> Self {
        value.0
    }
}

impl fmt::Display for GoogleAuthenticatorMigrationQrCodeCount {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum GoogleAuthenticatorImportError {
    #[error("Select at least one Google Authenticator migration QR code.")]
    Empty,
    #[error("Too many Google Authenticator QR codes were selected.")]
    TooManyQrCodes,
    #[error("A Google Authenticator migration QR code is too large to import safely.")]
    UriTooLarge,
    #[error("This QR code is not a Google Authenticator account export.")]
    InvalidUri,
    #[error("The Google Authenticator QR payload is invalid.")]
    InvalidPayload,
    #[error("The Google Authenticator QR payload is too large to import safely.")]
    PayloadTooLarge,
    #[error("The Google Authenticator export contains too many accounts.")]
    TooManyItems,
    #[error("The bundled authenticator issuer catalog is invalid: {0}")]
    InvalidIssuerCatalog(#[from] crate::AuthenticatorIssuerHostsError),
    #[error("These QR codes belong to different Google Authenticator exports.")]
    MixedBatches,
    #[error("A Google Authenticator QR code was scanned more than once.")]
    DuplicateBatchPart,
    #[error(
        "This Google Authenticator export is incomplete. Scan all {0} QR codes before importing."
    )]
    IncompleteBatch(GoogleAuthenticatorMigrationQrCodeCount),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GoogleAuthenticatorImportPlan {
    pub items: Vec<SecretValue>,
    pub source_count: crate::SecretImportSourceRecordCount,
    pub skipped_unsupported: crate::SecretImportUnsupportedRecordCount,
}

/// Original QR strings remain borrowed until consuming admission finishes.
/// ```
/// use nook_core::{GoogleAuthenticatorMigrationInput, GoogleAuthenticatorImportError};
/// assert_eq!(GoogleAuthenticatorMigrationInput::from_uris(&[]).plan(), Err(GoogleAuthenticatorImportError::Empty));
/// ```
/// ```compile_fail,E0502
/// use nook_core::GoogleAuthenticatorMigrationInput;
/// let mut uris = Vec::new();
/// let input = GoogleAuthenticatorMigrationInput::from_uris(&uris);
/// uris.clear();
/// let _ = input.plan();
/// ```
/// ```compile_fail,E0382
/// use nook_core::GoogleAuthenticatorMigrationInput;
/// let input = GoogleAuthenticatorMigrationInput::from_uris(&[]);
/// let _ = input.plan();
/// let _ = input.plan();
/// ```
/// ```compile_fail,E0599
/// use nook_core::GoogleAuthenticatorMigrationInput;
/// let input = GoogleAuthenticatorMigrationInput::from_uris(&[]);
/// let duplicate = input.clone();
/// ```
pub struct GoogleAuthenticatorMigrationInput<'a> {
    uris: &'a [String],
}
impl<'a> GoogleAuthenticatorMigrationInput<'a> {
    #[must_use]
    pub fn from_uris(uris: &'a [String]) -> Self {
        Self { uris }
    }
    pub fn plan(self) -> Result<GoogleAuthenticatorImportPlan, GoogleAuthenticatorImportError> {
        ParsedMigrationBatch::parse(self.uris)?.complete()?.plan()
    }
}
#[cfg(test)]
pub(super) mod tests {
    use std::slice;

    use super::batch::MigrationPayload;
    use super::parameters::{MigrationAlgorithm, MigrationDigits, MigrationOtpType, OtpParameters};
    use super::{GoogleAuthenticatorImportError, GoogleAuthenticatorMigrationInput};
    use crate::{SecretValue, TotpAlgorithm, TotpDigits};
    use base64::{Engine, engine::general_purpose::STANDARD as BASE64};
    use prost::Message;
    use zeroize::Zeroize;

    pub(super) struct MigrationParameterFixture<'a> {
        pub(super) secret_byte: u8,
        pub(super) name: &'a str,
        pub(super) issuer: &'a str,
        pub(super) algorithm: MigrationAlgorithm,
        pub(super) digits: MigrationDigits,
        pub(super) otp_type: MigrationOtpType,
    }
    impl MigrationParameterFixture<'_> {
        pub(super) fn build(self) -> OtpParameters {
            OtpParameters {
                secret: vec![self.secret_byte; 20],
                name: self.name.to_owned(),
                issuer: self.issuer.to_owned(),
                algorithm: self.algorithm as i32,
                digits: self.digits as i32,
                otp_type: self.otp_type as i32,
                counter: 0,
            }
        }
    }
    pub(super) struct MigrationPayloadFixture {
        pub(super) otp_parameters: Vec<OtpParameters>,
        pub(super) batch_size: i32,
        pub(super) batch_index: i32,
        pub(super) batch_id: i32,
    }
    impl MigrationPayloadFixture {
        pub(super) fn build(self) -> MigrationPayload {
            MigrationPayload {
                otp_parameters: self.otp_parameters,
                version: 1,
                batch_size: self.batch_size,
                batch_index: self.batch_index,
                batch_id: self.batch_id,
            }
        }
    }
    impl MigrationPayload {
        pub(super) fn uri(&self) -> String {
            let encoded = Engine::encode(&BASE64, self.encode_to_vec());
            let data =
                percent_encoding::utf8_percent_encode(&encoded, percent_encoding::NON_ALPHANUMERIC);
            format!("otpauth-migration://offline?data={data}")
        }
    }
    #[test]
    fn imports_supported_totp_settings_and_normalizes_labels() -> anyhow::Result<()> {
        let plan = GoogleAuthenticatorMigrationInput::from_uris(&[MigrationPayloadFixture {
            otp_parameters: vec![
                MigrationParameterFixture {
                    secret_byte: 0x41,
                    name: "Example:alice@example.com",
                    issuer: "Example",
                    algorithm: MigrationAlgorithm::Sha256,
                    digits: MigrationDigits::Eight,
                    otp_type: MigrationOtpType::Totp,
                }
                .build(),
            ],
            batch_size: 1,
            batch_index: 0,
            batch_id: 17,
        }
        .build()
        .uri()])
        .plan()?;

        assert_eq!(usize::from(plan.source_count), 1);
        assert_eq!(usize::from(plan.skipped_unsupported), 0);
        let Some(SecretValue::Authenticator(item)) = plan.items.first() else {
            panic!("expected authenticator");
        };
        assert_eq!(item.issuer, "Example");
        assert_eq!(item.account, "alice@example.com");
        assert_eq!(item.algorithm, TotpAlgorithm::Sha256);
        assert_eq!(item.digits, TotpDigits::Eight);
        assert_eq!(item.period.duration().as_secs(), 30);
        assert_eq!(item.secret.as_str(), "IFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKB");
        Ok(())
    }

    #[test]
    fn decodes_google_authenticator_wire_format() -> anyhow::Result<()> {
        let migration_uri = concat!(
            "otpauth-migration://offline?data=",
            "CjUKBWYkQUSTEgdNWUxBQkVMGghNWUlTU1VFUiACKAIwAkIT",
            "NjE5NGJjMTczNzcyNzc5ODc5MxACGAEgAA%3D%3D"
        );

        let plan =
            GoogleAuthenticatorMigrationInput::from_uris(&[migration_uri.to_owned()]).plan()?;

        assert_eq!(usize::from(plan.source_count), 1);
        assert_eq!(usize::from(plan.skipped_unsupported), 1);
        assert!(plan.items.is_empty());
        Ok(())
    }

    #[test]
    fn imports_a_complete_out_of_order_batch() -> anyhow::Result<()> {
        let first = MigrationPayloadFixture {
            otp_parameters: vec![
                MigrationParameterFixture {
                    secret_byte: 1,
                    name: "first@example.com",
                    issuer: "First",
                    algorithm: MigrationAlgorithm::Sha1,
                    digits: MigrationDigits::Six,
                    otp_type: MigrationOtpType::Totp,
                }
                .build(),
            ],
            batch_size: 2,
            batch_index: 0,
            batch_id: 91,
        }
        .build()
        .uri();
        let second = MigrationPayloadFixture {
            otp_parameters: vec![
                MigrationParameterFixture {
                    secret_byte: 2,
                    name: "second@example.com",
                    issuer: "Second",
                    algorithm: MigrationAlgorithm::Sha512,
                    digits: MigrationDigits::Six,
                    otp_type: MigrationOtpType::Totp,
                }
                .build(),
            ],
            batch_size: 2,
            batch_index: 1,
            batch_id: 91,
        }
        .build()
        .uri();

        let plan = GoogleAuthenticatorMigrationInput::from_uris(&[second, first]).plan()?;

        assert_eq!(usize::from(plan.source_count), 2);
        assert_eq!(plan.items.len(), 2);
        let Some(SecretValue::Authenticator(first)) = plan.items.first() else {
            panic!("expected authenticator");
        };
        assert_eq!(first.issuer, "First");
        Ok(())
    }

    #[test]
    fn rejects_incomplete_duplicate_and_mixed_batches() {
        let first = MigrationPayloadFixture {
            otp_parameters: Vec::new(),
            batch_size: 2,
            batch_index: 0,
            batch_id: 10,
        }
        .build()
        .uri();
        let other = MigrationPayloadFixture {
            otp_parameters: Vec::new(),
            batch_size: 2,
            batch_index: 1,
            batch_id: 11,
        }
        .build()
        .uri();
        assert_eq!(
            GoogleAuthenticatorMigrationInput::from_uris(slice::from_ref(&first)).plan(),
            Err(GoogleAuthenticatorImportError::IncompleteBatch(2.into()))
        );
        assert_eq!(
            GoogleAuthenticatorMigrationInput::from_uris(&[first.clone(), first.clone()]).plan(),
            Err(GoogleAuthenticatorImportError::DuplicateBatchPart)
        );
        assert_eq!(
            GoogleAuthenticatorMigrationInput::from_uris(&[first, other]).plan(),
            Err(GoogleAuthenticatorImportError::MixedBatches)
        );
    }

    #[test]
    fn parsed_parameters_zeroize_all_sensitive_fields() {
        let mut value = MigrationParameterFixture {
            secret_byte: 9,
            name: "Example:alice@example.com",
            issuer: "Example",
            algorithm: MigrationAlgorithm::Sha1,
            digits: MigrationDigits::Six,
            otp_type: MigrationOtpType::Totp,
        }
        .build();

        value.zeroize();

        assert!(value.secret.iter().all(|byte| *byte == 0));
        assert!(value.name.is_empty());
        assert!(value.issuer.is_empty());
    }

    #[test]
    fn skips_hotp_md5_and_invalid_secret_entries() -> anyhow::Result<()> {
        let mut short_secret = MigrationParameterFixture {
            secret_byte: 5,
            name: "short",
            issuer: "Unsupported",
            algorithm: MigrationAlgorithm::Sha1,
            digits: MigrationDigits::Six,
            otp_type: MigrationOtpType::Totp,
        }
        .build();
        short_secret.secret = vec![5; 2];
        let entries = vec![
            MigrationParameterFixture {
                secret_byte: 3,
                name: "hotp",
                issuer: "Unsupported",
                algorithm: MigrationAlgorithm::Sha1,
                digits: MigrationDigits::Six,
                otp_type: MigrationOtpType::Hotp,
            }
            .build(),
            MigrationParameterFixture {
                secret_byte: 4,
                name: "md5",
                issuer: "Unsupported",
                algorithm: MigrationAlgorithm::Md5,
                digits: MigrationDigits::Six,
                otp_type: MigrationOtpType::Totp,
            }
            .build(),
            short_secret,
        ];
        let plan = GoogleAuthenticatorMigrationInput::from_uris(&[MigrationPayloadFixture {
            otp_parameters: entries,
            batch_size: 1,
            batch_index: 0,
            batch_id: 12,
        }
        .build()
        .uri()])
        .plan()?;
        assert!(plan.items.is_empty());
        assert_eq!(usize::from(plan.source_count), 3);
        assert_eq!(usize::from(plan.skipped_unsupported), 3);
        Ok(())
    }

    #[test]
    fn rejects_non_migration_and_malformed_payloads() {
        assert_eq!(
            GoogleAuthenticatorMigrationInput::from_uris(&["otpauth://totp/example".to_owned()])
                .plan(),
            Err(GoogleAuthenticatorImportError::InvalidUri)
        );
        assert_eq!(
            GoogleAuthenticatorMigrationInput::from_uris(&[
                "otpauth-migration://offline?data=not-base64".to_owned()
            ])
            .plan(),
            Err(GoogleAuthenticatorImportError::InvalidPayload)
        );
    }
}

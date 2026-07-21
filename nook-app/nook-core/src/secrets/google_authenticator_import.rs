//! Google Authenticator migration QR conversion into Nook authenticator items.

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use percent_encoding::percent_decode_str;
use prost::Message;
use thiserror::Error;
use zeroize::{Zeroize, Zeroizing};

use crate::{AuthenticatorSecret, SecretValue, TotpAlgorithm, TotpDigits, TotpPeriod, TotpSecret};

const MAX_QR_CODES: usize = 100;
const MAX_URI_BYTES: usize = 16 * 1024;
const MAX_PAYLOAD_BYTES: usize = 1024 * 1024;
const MAX_ITEMS: usize = 10_000;

#[derive(Clone, PartialEq, Message)]
struct MigrationPayload {
    #[prost(message, repeated, tag = "1")]
    otp_parameters: Vec<OtpParameters>,
    #[prost(int32, tag = "2")]
    version: i32,
    #[prost(int32, tag = "3")]
    batch_size: i32,
    #[prost(int32, tag = "4")]
    batch_index: i32,
    #[prost(int32, tag = "5")]
    batch_id: i32,
}

#[derive(Clone, PartialEq, Message)]
struct OtpParameters {
    #[prost(bytes = "vec", tag = "1")]
    secret: Vec<u8>,
    #[prost(string, tag = "2")]
    name: String,
    #[prost(string, tag = "3")]
    issuer: String,
    #[prost(enumeration = "MigrationAlgorithm", tag = "4")]
    algorithm: i32,
    #[prost(enumeration = "MigrationDigits", tag = "5")]
    digits: i32,
    #[prost(enumeration = "MigrationOtpType", tag = "6")]
    otp_type: i32,
    #[prost(int64, tag = "7")]
    counter: i64,
}

impl Zeroize for OtpParameters {
    fn zeroize(&mut self) {
        self.secret.zeroize();
        self.name.zeroize();
        self.issuer.zeroize();
    }
}

impl Drop for OtpParameters {
    fn drop(&mut self) {
        self.zeroize();
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, prost::Enumeration)]
enum MigrationAlgorithm {
    Unspecified = 0,
    Sha1 = 1,
    Sha256 = 2,
    Sha512 = 3,
    Md5 = 4,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, prost::Enumeration)]
enum MigrationDigits {
    Unspecified = 0,
    Six = 1,
    Eight = 2,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, prost::Enumeration)]
enum MigrationOtpType {
    Unspecified = 0,
    Hotp = 1,
    Totp = 2,
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
    #[error("These QR codes belong to different Google Authenticator exports.")]
    MixedBatches,
    #[error("A Google Authenticator QR code was scanned more than once.")]
    DuplicateBatchPart,
    #[error(
        "This Google Authenticator export is incomplete. Scan all {0} QR codes before importing."
    )]
    IncompleteBatch(usize),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GoogleAuthenticatorImportPlan {
    pub items: Vec<SecretValue>,
    pub source_count: usize,
    pub skipped_unsupported: usize,
}

struct ParsedPart {
    payload: MigrationPayload,
    batch_size: usize,
    batch_index: usize,
}

fn parse_uri(uri: &str) -> Result<ParsedPart, GoogleAuthenticatorImportError> {
    if uri.len() > MAX_URI_BYTES {
        return Err(GoogleAuthenticatorImportError::UriTooLarge);
    }
    let query = uri
        .trim()
        .strip_prefix("otpauth-migration://offline?")
        .ok_or(GoogleAuthenticatorImportError::InvalidUri)?;
    let data = query
        .split('&')
        .find_map(|pair| pair.strip_prefix("data="))
        .ok_or(GoogleAuthenticatorImportError::InvalidUri)?;
    let data = Zeroizing::new(
        percent_decode_str(data)
            .decode_utf8()
            .map_err(|_| GoogleAuthenticatorImportError::InvalidPayload)?
            .into_owned(),
    );
    let decoded = Zeroizing::new(
        BASE64
            .decode(data)
            .map_err(|_| GoogleAuthenticatorImportError::InvalidPayload)?,
    );
    if decoded.len() > MAX_PAYLOAD_BYTES {
        return Err(GoogleAuthenticatorImportError::PayloadTooLarge);
    }
    let payload = MigrationPayload::decode(decoded.as_slice())
        .map_err(|_| GoogleAuthenticatorImportError::InvalidPayload)?;
    let batch_size = match payload.batch_size {
        0 => 1,
        value if value > 0 => {
            usize::try_from(value).map_err(|_| GoogleAuthenticatorImportError::InvalidPayload)?
        }
        _ => return Err(GoogleAuthenticatorImportError::InvalidPayload),
    };
    let batch_index = usize::try_from(payload.batch_index)
        .map_err(|_| GoogleAuthenticatorImportError::InvalidPayload)?;
    if batch_size > MAX_QR_CODES || batch_index >= batch_size {
        return Err(GoogleAuthenticatorImportError::InvalidPayload);
    }
    Ok(ParsedPart {
        payload,
        batch_size,
        batch_index,
    })
}

fn validate_batch(parts: &mut [ParsedPart]) -> Result<(), GoogleAuthenticatorImportError> {
    let expected_size = parts[0].batch_size;
    let expected_id = parts[0].payload.batch_id;
    let expected_version = parts[0].payload.version;
    if parts.iter().any(|part| {
        part.batch_size != expected_size
            || part.payload.batch_id != expected_id
            || part.payload.version != expected_version
    }) {
        return Err(GoogleAuthenticatorImportError::MixedBatches);
    }
    parts.sort_unstable_by_key(|part| part.batch_index);
    if parts
        .windows(2)
        .any(|pair| pair[0].batch_index == pair[1].batch_index)
    {
        return Err(GoogleAuthenticatorImportError::DuplicateBatchPart);
    }
    if parts.len() != expected_size
        || parts
            .iter()
            .enumerate()
            .any(|(index, part)| index != part.batch_index)
    {
        return Err(GoogleAuthenticatorImportError::IncompleteBatch(
            expected_size,
        ));
    }
    Ok(())
}

fn base32_encode(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 32] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let mut output = String::with_capacity(bytes.len().div_ceil(5) * 8);
    let mut buffer = 0_u16;
    let mut bits = 0_u8;
    for byte in bytes {
        buffer = (buffer << 8) | u16::from(*byte);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            output.push(char::from(ALPHABET[usize::from((buffer >> bits) & 0x1f)]));
        }
    }
    if bits > 0 {
        output.push(char::from(
            ALPHABET[usize::from((buffer << (5 - bits)) & 0x1f)],
        ));
    }
    output
}

fn account_and_issuer(name: &str, issuer: &str) -> (String, String) {
    let name = name.trim();
    let issuer = issuer.trim();
    if !issuer.is_empty() {
        let account = name
            .strip_prefix(issuer)
            .and_then(|rest| rest.strip_prefix(':'))
            .unwrap_or(name)
            .trim();
        return (account.to_owned(), issuer.to_owned());
    }
    if let Some((label_issuer, account)) = name.split_once(':')
        && !label_issuer.trim().is_empty()
    {
        return (account.trim().to_owned(), label_issuer.trim().to_owned());
    }
    (name.to_owned(), name.to_owned())
}

fn convert_parameter(mut parameter: OtpParameters) -> Result<SecretValue, ()> {
    let secret_bytes = Zeroizing::new(std::mem::take(&mut parameter.secret));
    let name = Zeroizing::new(std::mem::take(&mut parameter.name));
    let issuer = Zeroizing::new(std::mem::take(&mut parameter.issuer));
    if MigrationOtpType::try_from(parameter.otp_type).ok() != Some(MigrationOtpType::Totp) {
        return Err(());
    }
    let algorithm = match MigrationAlgorithm::try_from(parameter.algorithm).ok() {
        Some(MigrationAlgorithm::Sha1) => TotpAlgorithm::Sha1,
        Some(MigrationAlgorithm::Sha256) => TotpAlgorithm::Sha256,
        Some(MigrationAlgorithm::Sha512) => TotpAlgorithm::Sha512,
        _ => return Err(()),
    };
    let digits = match MigrationDigits::try_from(parameter.digits).ok() {
        Some(MigrationDigits::Unspecified | MigrationDigits::Six) => TotpDigits::parse(6),
        Some(MigrationDigits::Eight) => TotpDigits::parse(8),
        None => return Err(()),
    }
    .map_err(|_| ())?;
    let (account, issuer) = account_and_issuer(&name, &issuer);
    let encoded_secret = Zeroizing::new(base32_encode(&secret_bytes));
    let mut authenticator = AuthenticatorSecret {
        issuer,
        account,
        website_url: String::new(),
        secret: TotpSecret::parse(&encoded_secret).map_err(|_| ())?,
        algorithm,
        digits,
        period: TotpPeriod::parse(30).map_err(|_| ())?,
        backup_codes: Vec::new(),
    };
    authenticator.apply_inferred_website_url_if_empty();
    authenticator.normalize().map_err(|_| ())?;
    Ok(SecretValue::Authenticator(authenticator))
}

/// Parse one complete Google Authenticator migration QR batch entirely in memory.
pub fn plan_google_authenticator_import(
    migration_uris: &[String],
) -> Result<GoogleAuthenticatorImportPlan, GoogleAuthenticatorImportError> {
    if migration_uris.is_empty() {
        return Err(GoogleAuthenticatorImportError::Empty);
    }
    if migration_uris.len() > MAX_QR_CODES {
        return Err(GoogleAuthenticatorImportError::TooManyQrCodes);
    }
    let mut parts = migration_uris
        .iter()
        .map(|uri| parse_uri(uri))
        .collect::<Result<Vec<_>, _>>()?;
    validate_batch(&mut parts)?;
    let source_count = parts
        .iter()
        .map(|part| part.payload.otp_parameters.len())
        .sum::<usize>();
    if source_count == 0 {
        return Err(GoogleAuthenticatorImportError::InvalidPayload);
    }
    if source_count > MAX_ITEMS {
        return Err(GoogleAuthenticatorImportError::TooManyItems);
    }
    let mut items = Vec::with_capacity(source_count);
    let mut skipped_unsupported = 0;
    for part in parts {
        for parameter in part.payload.otp_parameters {
            match convert_parameter(parameter) {
                Ok(item) => items.push(item),
                Err(()) => skipped_unsupported += 1,
            }
        }
    }
    Ok(GoogleAuthenticatorImportPlan {
        items,
        source_count,
        skipped_unsupported,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parameter(
        secret_byte: u8,
        name: &str,
        issuer: &str,
        algorithm: MigrationAlgorithm,
        digits: MigrationDigits,
        otp_type: MigrationOtpType,
    ) -> OtpParameters {
        OtpParameters {
            secret: vec![secret_byte; 20],
            name: name.to_owned(),
            issuer: issuer.to_owned(),
            algorithm: algorithm as i32,
            digits: digits as i32,
            otp_type: otp_type as i32,
            counter: 0,
        }
    }

    fn uri(payload: &MigrationPayload) -> String {
        let encoded = BASE64.encode(payload.encode_to_vec());
        let data =
            percent_encoding::utf8_percent_encode(&encoded, percent_encoding::NON_ALPHANUMERIC);
        format!("otpauth-migration://offline?data={data}")
    }

    fn payload(
        otp_parameters: Vec<OtpParameters>,
        batch_size: i32,
        batch_index: i32,
        batch_id: i32,
    ) -> MigrationPayload {
        MigrationPayload {
            otp_parameters,
            version: 1,
            batch_size,
            batch_index,
            batch_id,
        }
    }

    #[test]
    fn imports_supported_totp_settings_and_normalizes_labels() {
        let plan = plan_google_authenticator_import(&[uri(&payload(
            vec![parameter(
                0x41,
                "Example:alice@example.com",
                "Example",
                MigrationAlgorithm::Sha256,
                MigrationDigits::Eight,
                MigrationOtpType::Totp,
            )],
            1,
            0,
            17,
        ))])
        .unwrap();

        assert_eq!(plan.source_count, 1);
        assert_eq!(plan.skipped_unsupported, 0);
        let SecretValue::Authenticator(item) = &plan.items[0] else {
            panic!("expected authenticator");
        };
        assert_eq!(item.issuer, "Example");
        assert_eq!(item.account, "alice@example.com");
        assert_eq!(item.algorithm, TotpAlgorithm::Sha256);
        assert_eq!(item.digits.get(), 8);
        assert_eq!(item.period.get(), 30);
        assert_eq!(item.secret.as_str(), "IFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKB");
    }

    #[test]
    fn decodes_google_authenticator_wire_format() {
        let migration_uri = concat!(
            "otpauth-migration://offline?data=",
            "CjUKBWYkQUSTEgdNWUxBQkVMGghNWUlTU1VFUiACKAIwAkIT",
            "NjE5NGJjMTczNzcyNzc5ODc5MxACGAEgAA%3D%3D"
        );

        let plan = plan_google_authenticator_import(&[migration_uri.to_owned()]).unwrap();

        assert_eq!(plan.source_count, 1);
        assert_eq!(plan.skipped_unsupported, 1);
        assert!(plan.items.is_empty());
    }

    #[test]
    fn imports_a_complete_out_of_order_batch() {
        let first = uri(&payload(
            vec![parameter(
                1,
                "first@example.com",
                "First",
                MigrationAlgorithm::Sha1,
                MigrationDigits::Six,
                MigrationOtpType::Totp,
            )],
            2,
            0,
            91,
        ));
        let second = uri(&payload(
            vec![parameter(
                2,
                "second@example.com",
                "Second",
                MigrationAlgorithm::Sha512,
                MigrationDigits::Six,
                MigrationOtpType::Totp,
            )],
            2,
            1,
            91,
        ));

        let plan = plan_google_authenticator_import(&[second, first]).unwrap();

        assert_eq!(plan.source_count, 2);
        assert_eq!(plan.items.len(), 2);
        let SecretValue::Authenticator(first) = &plan.items[0] else {
            panic!("expected authenticator");
        };
        assert_eq!(first.issuer, "First");
    }

    #[test]
    fn rejects_incomplete_duplicate_and_mixed_batches() {
        let first = uri(&payload(Vec::new(), 2, 0, 10));
        let other = uri(&payload(Vec::new(), 2, 1, 11));
        assert_eq!(
            plan_google_authenticator_import(std::slice::from_ref(&first)),
            Err(GoogleAuthenticatorImportError::IncompleteBatch(2))
        );
        assert_eq!(
            plan_google_authenticator_import(&[first.clone(), first.clone()]),
            Err(GoogleAuthenticatorImportError::DuplicateBatchPart)
        );
        assert_eq!(
            plan_google_authenticator_import(&[first, other]),
            Err(GoogleAuthenticatorImportError::MixedBatches)
        );
    }

    #[test]
    fn parsed_parameters_zeroize_all_sensitive_fields() {
        let mut value = parameter(
            9,
            "Example:alice@example.com",
            "Example",
            MigrationAlgorithm::Sha1,
            MigrationDigits::Six,
            MigrationOtpType::Totp,
        );

        value.zeroize();

        assert!(value.secret.iter().all(|byte| *byte == 0));
        assert!(value.name.is_empty());
        assert!(value.issuer.is_empty());
    }

    #[test]
    fn skips_hotp_md5_and_invalid_secret_entries() {
        let mut short_secret = parameter(
            5,
            "short",
            "Unsupported",
            MigrationAlgorithm::Sha1,
            MigrationDigits::Six,
            MigrationOtpType::Totp,
        );
        short_secret.secret = vec![5; 2];
        let entries = vec![
            parameter(
                3,
                "hotp",
                "Unsupported",
                MigrationAlgorithm::Sha1,
                MigrationDigits::Six,
                MigrationOtpType::Hotp,
            ),
            parameter(
                4,
                "md5",
                "Unsupported",
                MigrationAlgorithm::Md5,
                MigrationDigits::Six,
                MigrationOtpType::Totp,
            ),
            short_secret,
        ];
        let plan = plan_google_authenticator_import(&[uri(&payload(entries, 1, 0, 12))]).unwrap();
        assert!(plan.items.is_empty());
        assert_eq!(plan.source_count, 3);
        assert_eq!(plan.skipped_unsupported, 3);
    }

    #[test]
    fn rejects_non_migration_and_malformed_payloads() {
        assert_eq!(
            plan_google_authenticator_import(&["otpauth://totp/example".to_owned()]),
            Err(GoogleAuthenticatorImportError::InvalidUri)
        );
        assert_eq!(
            plan_google_authenticator_import(&[
                "otpauth-migration://offline?data=not-base64".to_owned()
            ]),
            Err(GoogleAuthenticatorImportError::InvalidPayload)
        );
    }
}

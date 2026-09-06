#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! Nonempty decoded batches consume completeness checks before item conversion.
use super::parameters::OtpParameters;
use super::{GoogleAuthenticatorImportError, GoogleAuthenticatorImportPlan};
use base64::{Engine, engine::general_purpose::STANDARD as BASE64};
use prost::Message;
use zeroize::Zeroizing;
const MAX_QR_CODES: usize = 100;
const MAX_URI_BYTES: usize = 16 * 1024;
const MAX_PAYLOAD_BYTES: usize = 1024 * 1024;
const MAX_ITEMS: usize = 10_000;
#[derive(Clone, PartialEq, Message)]
pub(super) struct MigrationPayload {
    #[prost(message, repeated, tag = "1")]
    pub(super) otp_parameters: Vec<OtpParameters>,
    #[prost(int32, tag = "2")]
    pub(super) version: i32,
    #[prost(int32, tag = "3")]
    pub(super) batch_size: i32,
    #[prost(int32, tag = "4")]
    pub(super) batch_index: i32,
    #[prost(int32, tag = "5")]
    pub(super) batch_id: i32,
}

struct ParsedPart {
    payload: MigrationPayload,
    batch_size: usize,
    batch_index: usize,
}

impl ParsedPart {
    fn parse(uri: &str) -> Result<ParsedPart, GoogleAuthenticatorImportError> {
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
            percent_encoding::percent_decode_str(data)
                .decode_utf8()
                .map_err(|_| GoogleAuthenticatorImportError::InvalidPayload)?
                .into_owned(),
        );
        let decoded = Zeroizing::new(
            Engine::decode(&BASE64, data)
                .map_err(|_| GoogleAuthenticatorImportError::InvalidPayload)?,
        );
        if decoded.len() > MAX_PAYLOAD_BYTES {
            return Err(GoogleAuthenticatorImportError::PayloadTooLarge);
        }
        let payload = MigrationPayload::decode(decoded.as_slice())
            .map_err(|_| GoogleAuthenticatorImportError::InvalidPayload)?;
        let batch_size = match payload.batch_size {
            0 => 1,
            value if value > 0 => usize::try_from(value)
                .map_err(|_| GoogleAuthenticatorImportError::InvalidPayload)?,
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
}

/// Private construction preserves the nonempty-parts invariant.
/// ```compile_fail,E0603
/// use nook_core::google_authenticator_import::batch::ParsedMigrationBatch;
/// ```
pub(super) struct ParsedMigrationBatch {
    parts: Vec<ParsedPart>,
}
impl ParsedMigrationBatch {
    pub(super) fn parse(uris: &[String]) -> Result<Self, GoogleAuthenticatorImportError> {
        if uris.is_empty() {
            return Err(GoogleAuthenticatorImportError::Empty);
        }
        if uris.len() > MAX_QR_CODES {
            return Err(GoogleAuthenticatorImportError::TooManyQrCodes);
        }
        let parts = uris
            .iter()
            .map(|uri| ParsedPart::parse(uri))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Self { parts })
    }
    pub(super) fn complete(
        mut self,
    ) -> Result<CompleteMigrationBatch, GoogleAuthenticatorImportError> {
        let parts = &mut self.parts;
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
                expected_size.into(),
            ));
        }
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
        Ok(CompleteMigrationBatch {
            parts: self.parts,
            source_count,
        })
    }
}

pub(super) struct CompleteMigrationBatch {
    parts: Vec<ParsedPart>,
    source_count: usize,
}
impl CompleteMigrationBatch {
    #[must_use]
    pub(super) fn plan(self) -> GoogleAuthenticatorImportPlan {
        let mut items = Vec::with_capacity(self.source_count);
        let mut skipped_unsupported = 0;
        for part in self.parts {
            for parameter in part.payload.otp_parameters {
                match parameter.convert() {
                    Ok(item) => items.push(item),
                    Err(()) => skipped_unsupported += 1,
                }
            }
        }
        GoogleAuthenticatorImportPlan {
            items,
            source_count: self.source_count.into(),
            skipped_unsupported: skipped_unsupported.into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::parameters::OtpParameters;
    use super::super::tests::MigrationPayloadFixture;
    use super::{GoogleAuthenticatorImportError, MAX_URI_BYTES, ParsedMigrationBatch, ParsedPart};

    #[test]
    fn count_and_raw_uri_length_errors_precede_decoding() {
        assert!(matches!(
            ParsedMigrationBatch::parse(&[]),
            Err(GoogleAuthenticatorImportError::Empty)
        ));
        assert!(matches!(
            ParsedMigrationBatch::parse(&vec![String::new(); 101]),
            Err(GoogleAuthenticatorImportError::TooManyQrCodes)
        ));
        assert!(matches!(
            ParsedPart::parse(&" ".repeat(MAX_URI_BYTES + 1)),
            Err(GoogleAuthenticatorImportError::UriTooLarge)
        ));
        assert!(matches!(
            ParsedPart::parse("otpauth-migration://offline?data=%FF"),
            Err(GoogleAuthenticatorImportError::InvalidPayload)
        ));
    }

    #[test]
    fn first_data_parameter_wins_and_surrounding_whitespace_is_accepted() -> anyhow::Result<()> {
        let uri = MigrationPayloadFixture {
            otp_parameters: Vec::new(),
            batch_size: 0,
            batch_index: 0,
            batch_id: 7,
        }
        .build()
        .uri();
        let parsed = ParsedPart::parse(&format!("  {uri}&data=invalid  "))?;
        assert_eq!(parsed.batch_size, 1);
        assert_eq!(parsed.batch_index, 0);
        let data = uri
            .strip_prefix("otpauth-migration://offline?")
            .ok_or_else(|| anyhow::anyhow!("fixture URI prefix"))?;
        assert!(matches!(
            ParsedPart::parse(&format!("otpauth-migration://offline?data=invalid&{data}")),
            Err(GoogleAuthenticatorImportError::InvalidPayload)
        ));
        Ok(())
    }

    #[test]
    fn batch_coordinates_are_admitted_before_completeness() {
        for (batch_size, batch_index) in [(-1, 0), (101, 0), (1, -1), (1, 1)] {
            let uri = MigrationPayloadFixture {
                otp_parameters: Vec::new(),
                batch_size,
                batch_index,
                batch_id: 7,
            }
            .build()
            .uri();
            assert!(matches!(
                ParsedPart::parse(&uri),
                Err(GoogleAuthenticatorImportError::InvalidPayload)
            ));
        }
    }

    #[test]
    fn version_mismatch_precedes_duplicates_and_empty_accounts() -> anyhow::Result<()> {
        let first = MigrationPayloadFixture {
            otp_parameters: Vec::new(),
            batch_size: 2,
            batch_index: 0,
            batch_id: 7,
        }
        .build();
        let mut second = first.clone();
        second.version = 2;
        assert!(matches!(
            ParsedMigrationBatch::parse(&[first.uri(), second.uri()])?.complete(),
            Err(GoogleAuthenticatorImportError::MixedBatches)
        ));
        second.version = first.version;
        assert!(matches!(
            ParsedMigrationBatch::parse(&[first.uri(), second.uri()])?.complete(),
            Err(GoogleAuthenticatorImportError::DuplicateBatchPart)
        ));
        second.batch_index = 1;
        assert!(matches!(
            ParsedMigrationBatch::parse(&[first.uri(), second.uri()])?.complete(),
            Err(GoogleAuthenticatorImportError::InvalidPayload)
        ));
        Ok(())
    }

    #[test]
    fn complete_account_limit_preserves_supported_version_consistency_only() -> anyhow::Result<()> {
        for count in [10_000, 10_001] {
            let mut uris = Vec::new();
            for batch_index in 0..100 {
                let item_count = 100 + usize::from(count == 10_001 && batch_index == 99);
                let mut payload = MigrationPayloadFixture {
                    otp_parameters: vec![OtpParameters::default(); item_count],
                    batch_size: 100,
                    batch_index,
                    batch_id: 7,
                }
                .build();
                payload.version = 42;
                uris.push(payload.uri());
            }
            let parsed = ParsedMigrationBatch::parse(&uris)?;
            if count == 10_000 {
                let plan = parsed.complete()?.plan();
                assert_eq!(usize::from(plan.source_count), count);
                assert_eq!(usize::from(plan.skipped_unsupported), count);
                assert!(plan.items.is_empty());
            } else {
                assert!(matches!(
                    parsed.complete(),
                    Err(GoogleAuthenticatorImportError::TooManyItems)
                ));
            }
        }
        Ok(())
    }
}

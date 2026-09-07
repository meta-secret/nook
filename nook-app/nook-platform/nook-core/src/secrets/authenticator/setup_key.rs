//! Canonical setup-key material and edited-key comparison.
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]

use super::{AuthenticatorSecret, TotpSecret};
use crate::ValidationError;
use std::mem;
use zeroize::Zeroizing;

const MIN_SECRET_BYTES: usize = 10;

impl TotpSecret {
    pub fn parse(value: &str) -> Result<Self, ValidationError> {
        let mut normalized = Base32SetupKey(value).normalize();
        let decoded = Base32SetupKey(&normalized).decode()?;
        if decoded.len() < MIN_SECRET_BYTES {
            return Err(ValidationError::AuthenticatorSecretInvalid);
        }
        Ok(Self(mem::take(&mut *normalized)))
    }

    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "serialization boundary: decodes the Base32 TOTP secret into RFC algorithm key bytes"
        )
    )]
    pub fn decoded(&self) -> Result<Zeroizing<Vec<u8>>, ValidationError> {
        Base32SetupKey(&self.0).decode()
    }

    /// Compare a manual key after canonicalization; a valid URI always replaces setup.
    pub fn replacement_differs(&self, candidate: &str) -> Result<bool, ValidationError> {
        let stored = Self::parse(self.as_str())?;
        if candidate.trim().starts_with("otpauth://") {
            AuthenticatorSecret::from_otpauth_uri(candidate)?;
            return Ok(true);
        }
        Ok(stored != Self::parse(candidate)?)
    }
}

struct Base32SetupKey<'a>(&'a str);

impl Base32SetupKey<'_> {
    fn normalize(&self) -> Zeroizing<String> {
        let mut normalized = Zeroizing::new(
            self.0
                .chars()
                .filter(|character| !character.is_ascii_whitespace() && *character != '-')
                .map(|character| character.to_ascii_uppercase())
                .collect::<String>(),
        );
        let unpadded_len = normalized.trim_end_matches('=').len();
        normalized.truncate(unpadded_len);
        normalized
    }

    fn decode(&self) -> Result<Zeroizing<Vec<u8>>, ValidationError> {
        let mut output = Zeroizing::new(Vec::with_capacity(self.0.len() * 5 / 8));
        let mut buffer = 0_u32;
        let mut bits = 0_u8;
        for character in self.0.trim_end_matches('=').chars() {
            let digit = match character {
                'A'..='Z' => u32::from(character) - u32::from('A'),
                '2'..='7' => u32::from(character) - u32::from('2') + 26,
                _ => return Err(ValidationError::AuthenticatorSecretInvalid),
            };
            buffer = (buffer << 5) | digit;
            bits += 5;
            if bits >= 8 {
                bits -= 8;
                output.push(
                    u8::try_from((buffer >> bits) & 0xff)
                        .map_err(|_| ValidationError::AuthenticatorSecretInvalid)?,
                );
                buffer &= (1_u32 << bits) - 1;
            }
        }
        if output.is_empty() {
            return Err(ValidationError::AuthenticatorSecretInvalid);
        }
        Ok(output)
    }
}

#[cfg(test)]
mod tests {
    use super::Base32SetupKey;
    use crate::{AuthenticatorSecret, TotpSecret, ValidationError};
    use zeroize::{Zeroize, Zeroizing};

    #[test]
    fn normalization_only_removes_ascii_whitespace_hyphens_and_terminal_padding()
    -> anyhow::Result<()> {
        let normalized = Base32SetupKey(" jb-sw\tY3dp\nehpk3pxp==== ").normalize();
        assert_eq!(normalized.as_str(), "JBSWY3DPEHPK3PXP");
        assert!(matches!(
            TotpSecret::parse("JBSWY3DP\u{2003}EHPK3PXP"),
            Err(ValidationError::AuthenticatorSecretInvalid)
        ));
        assert!(matches!(
            TotpSecret::parse("JBSWY3DP=EHPK3PXP"),
            Err(ValidationError::AuthenticatorSecretInvalid)
        ));
        assert_eq!(TotpSecret::parse(&normalized)?.decoded()?.len(), 10);
        Ok(())
    }

    #[test]
    fn decoder_preserves_discarded_trailing_bits_and_minimum_length() -> anyhow::Result<()> {
        let canonical = TotpSecret::parse("JBSWY3DPEHPK3PXP")?;
        let trailing = TotpSecret::parse("JBSWY3DPEHPK3PXP7")?;
        assert_eq!(*canonical.decoded()?, *trailing.decoded()?);
        assert_ne!(canonical.as_str(), trailing.as_str());
        assert!(matches!(
            TotpSecret::parse("JBSWY3DPEHPK3PX"),
            Err(ValidationError::AuthenticatorSecretInvalid)
        ));
        assert!(matches!(
            Base32SetupKey("A").decode(),
            Err(ValidationError::AuthenticatorSecretInvalid)
        ));
        Ok(())
    }

    #[test]
    fn decode_failure_does_not_mutate_the_source_and_success_is_zeroizing() -> anyhow::Result<()> {
        let source = Zeroizing::new("JBSWY3DPEHPK3PXP!".to_owned());
        assert!(matches!(
            Base32SetupKey(&source).decode(),
            Err(ValidationError::AuthenticatorSecretInvalid)
        ));
        assert_eq!(source.as_str(), "JBSWY3DPEHPK3PXP!");
        let mut decoded: Zeroizing<Vec<u8>> = Base32SetupKey("JBSWY3DPEHPK3PXP").decode()?;
        assert_eq!(decoded.len(), 10);
        decoded.zeroize();
        assert!(decoded.iter().all(|byte| *byte == 0));
        Ok(())
    }

    #[test]
    fn manual_key_errors_precede_protocol_errors() {
        assert!(matches!(
            AuthenticatorSecret::from_form_fields(
                "Issuer", "account", "invalid!", "invalid", "5", "10", "", ""
            ),
            Err(ValidationError::AuthenticatorSecretInvalid)
        ));
        assert!(matches!(
            AuthenticatorSecret::from_form_fields(
                "Issuer",
                "account",
                "JBSWY3DPEHPK3PXP",
                "invalid",
                "5",
                "10",
                "",
                ""
            ),
            Err(ValidationError::AuthenticatorUriInvalid)
        ));
    }

    #[test]
    fn uri_form_overrides_metadata_but_preserves_uri_protocol() -> anyhow::Result<()> {
        let item = AuthenticatorSecret::from_form_fields(
            " Override ",
            " manual-account ",
            "otpauth://totp/Original:uri-account?secret=JBSWY3DPEHPK3PXP&algorithm=SHA256&digits=8&period=45",
            "invalid",
            "invalid",
            "invalid",
            " first \nfirst\nsecond",
            " https://manual.example ",
        )?;
        assert_eq!(item.issuer, "Override");
        assert_eq!(item.account, "manual-account");
        assert_eq!(item.website_url, "https://manual.example");
        assert_eq!(item.period.duration().as_secs(), 45);
        assert_eq!(item.backup_codes, ["first", "second"]);
        Ok(())
    }

    #[test]
    fn comparison_validates_uri_instead_of_treating_any_prefix_as_changed() -> anyhow::Result<()> {
        let stored = TotpSecret::parse("JBSWY3DPEHPK3PXP")?;
        assert!(matches!(
            stored.replacement_differs("otpauth://hotp/item?secret=JBSWY3DPEHPK3PXP"),
            Err(ValidationError::AuthenticatorUriInvalid)
        ));
        assert!(!stored.replacement_differs("jbsw y3dp ehpk 3pxp===")?);
        assert!(
            stored.replacement_differs("otpauth://totp/Issuer:account?secret=JBSWY3DPEHPK3PXP")?
        );
        Ok(())
    }
}

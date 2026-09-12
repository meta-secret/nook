//! Admission of decoded otpauth data before authenticator construction.
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]

use super::{AuthenticatorSecret, TotpAlgorithm, TotpDigits, TotpPeriod, TotpSecret};
use crate::ValidationError;
use percent_encoding::percent_decode_str;
use std::str;
use zeroize::Zeroizing;

const DEFAULT_DIGITS: u32 = 6;
const DEFAULT_PERIOD: u64 = 30;

pub(super) struct FormProtocolInput<'a> {
    pub algorithm: &'a str,
    pub digits: &'a str,
    pub period: &'a str,
}

pub(super) struct ProtocolParameters {
    pub algorithm: TotpAlgorithm,
    pub digits: TotpDigits,
    pub period: TotpPeriod,
}

impl ProtocolParameters {
    pub(super) fn from_form(input: &FormProtocolInput<'_>) -> Result<Self, ValidationError> {
        Ok(Self {
            algorithm: Self::algorithm(input.algorithm)?,
            digits: Self::digits(ParameterText(input.digits).form_digits()?)?,
            period: Self::period(ParameterText(input.period).form_period()?)?,
        })
    }

    fn from_uri(input: &DecodedOtpauthInput) -> Result<Self, ValidationError> {
        Ok(Self {
            algorithm: Self::algorithm(
                input.parameters_named("algorithm").next().unwrap_or("SHA1"),
            )?,
            digits: Self::digits(
                input
                    .parameters_named("digits")
                    .next()
                    .map_or(Ok(DEFAULT_DIGITS), |value| ParameterText(value).digits())?,
            )?,
            period: Self::period(
                input
                    .parameters_named("period")
                    .next()
                    .map_or(Ok(DEFAULT_PERIOD), |value| ParameterText(value).period())?,
            )?,
        })
    }

    fn algorithm(value: &str) -> Result<TotpAlgorithm, ValidationError> {
        TotpAlgorithm::parse(value).map_err(|_| ValidationError::AuthenticatorUriInvalid)
    }

    fn digits(value: u32) -> Result<TotpDigits, ValidationError> {
        TotpDigits::try_from(value).map_err(|_| ValidationError::AuthenticatorDigitsInvalid)
    }

    fn period(value: u64) -> Result<TotpPeriod, ValidationError> {
        TotpPeriod::try_from(value).map_err(|_| ValidationError::AuthenticatorPeriodInvalid)
    }
}

struct ParameterText<'a>(&'a str);

impl ParameterText<'_> {
    fn digits(&self) -> Result<u32, ValidationError> {
        self.0
            .parse()
            .map_err(|_| ValidationError::AuthenticatorUriInvalid)
    }

    fn period(&self) -> Result<u64, ValidationError> {
        self.0
            .parse()
            .map_err(|_| ValidationError::AuthenticatorUriInvalid)
    }

    fn form_digits(&self) -> Result<u32, ValidationError> {
        if self.0.trim().is_empty() {
            Ok(DEFAULT_DIGITS)
        } else {
            Self(self.0.trim()).digits()
        }
    }

    fn form_period(&self) -> Result<u64, ValidationError> {
        if self.0.trim().is_empty() {
            Ok(DEFAULT_PERIOD)
        } else {
            Self(self.0.trim()).period()
        }
    }
}

pub(super) struct OtpauthInput<'a>(pub &'a str);

impl OtpauthInput<'_> {
    pub(super) fn into_authenticator(self) -> Result<AuthenticatorSecret, ValidationError> {
        self.decode()?.check()?.finish()
    }

    fn decode(self) -> Result<DecodedOtpauthInput, ValidationError> {
        let rest = self
            .0
            .trim()
            .strip_prefix("otpauth://totp/")
            .ok_or(ValidationError::AuthenticatorUriInvalid)?;
        let (label_raw, query_raw) = rest
            .split_once('?')
            .ok_or(ValidationError::AuthenticatorUriInvalid)?;
        let label = UriComponent::Path(label_raw).decode()?;
        let mut decoded = DecodedOtpauthInput {
            label,
            parameters: Vec::new(),
        };
        for part in query_raw.split('&').filter(|part| !part.is_empty()) {
            let (key, value) = part
                .split_once('=')
                .ok_or(ValidationError::AuthenticatorUriInvalid)?;
            let key = UriComponent::Query(key).decode()?;
            let value = UriComponent::Query(value).decode()?;
            if let Some((_, previous)) = decoded
                .parameters
                .iter_mut()
                .find(|(existing, _)| existing.as_str() == key.as_str())
            {
                *previous = value;
            } else {
                decoded.parameters.push((key, value));
            }
        }
        Ok(decoded)
    }
}

enum UriComponent<'a> {
    Path(&'a str),
    Query(&'a str),
}

impl UriComponent<'_> {
    fn decode(self) -> Result<Zeroizing<String>, ValidationError> {
        let query;
        let encoded = match self {
            Self::Path(value) => value,
            Self::Query(value) => {
                query = Zeroizing::new(value.replace('+', " "));
                query.as_str()
            }
        };
        let bytes = Zeroizing::new(percent_decode_str(encoded).collect::<Vec<_>>());
        str::from_utf8(&bytes)
            .map(|value| Zeroizing::new(value.to_owned()))
            .map_err(|_| ValidationError::AuthenticatorUriInvalid)
    }
}

struct DecodedOtpauthInput {
    label: Zeroizing<String>,
    parameters: Vec<(Zeroizing<String>, Zeroizing<String>)>,
}

impl DecodedOtpauthInput {
    fn parameters_named<'a>(&'a self, name: &'a str) -> impl Iterator<Item = &'a str> + 'a {
        self.parameters
            .iter()
            .filter(move |(key, _)| key.as_str() == name)
            .map(|(_, value)| value.as_str())
    }

    fn check(self) -> Result<CheckedOtpauthInput, ValidationError> {
        let secret = self
            .parameters_named("secret")
            .next()
            .ok_or(ValidationError::AuthenticatorSecretInvalid)?;
        let protocol = ProtocolParameters::from_uri(&self)?;
        let secret = TotpSecret::parse(secret)?;
        Ok(CheckedOtpauthInput {
            decoded: self,
            protocol,
            secret,
        })
    }
}

/// Checked protocol/key material is private; it does not establish origin trust.
/// ```compile_fail,E0603
/// use nook_core::secrets::authenticator::uri::CheckedOtpauthInput;
/// ```
struct CheckedOtpauthInput {
    decoded: DecodedOtpauthInput,
    protocol: ProtocolParameters,
    secret: TotpSecret,
}

impl CheckedOtpauthInput {
    fn finish(self) -> Result<AuthenticatorSecret, ValidationError> {
        let (label_issuer, account) = self
            .decoded
            .label
            .split_once(':')
            .map_or(("", self.decoded.label.as_str()), |(issuer, account)| {
                (issuer, account)
            });
        let issuer = self
            .decoded
            .parameters_named("issuer")
            .next()
            .unwrap_or(label_issuer);
        let item = AuthenticatorSecret {
            issuer: issuer.to_owned(),
            account: account.to_owned(),
            website_url: String::new(),
            secret: self.secret,
            algorithm: self.protocol.algorithm,
            digits: self.protocol.digits,
            period: self.protocol.period,
            backup_codes: Vec::new(),
        };
        item.apply_inferred_website_url_if_empty()
            .map_err(|_| ValidationError::AuthenticatorIssuerCatalogInvalid)?
            .normalize()
    }
}

#[cfg(test)]
mod tests {
    use super::{
        CheckedOtpauthInput, FormProtocolInput, OtpauthInput, ProtocolParameters, UriComponent,
    };
    use crate::{AuthenticatorSecret, TotpAlgorithm, TotpDigits, ValidationError};
    use zeroize::{Zeroize, Zeroizing};

    struct UriFixture {
        text: Zeroizing<String>,
    }

    impl UriFixture {
        fn new(query: &str) -> Self {
            Self {
                text: Zeroizing::new(format!("otpauth://totp/Label:account?{query}")),
            }
        }

        fn input(&self) -> OtpauthInput<'_> {
            OtpauthInput(&self.text)
        }
    }

    #[test]
    fn duplicate_parameters_keep_last_values_and_query_issuer_wins() -> anyhow::Result<()> {
        let fixture = UriFixture::new(
            "secret=invalid&secret=JBSWY3DPEHPK3PXP&issuer=first&issuer=Query&digits=6&digits=8&&",
        );
        let decoded = fixture.input().decode()?;
        assert_eq!(decoded.parameters.len(), 3);
        assert_eq!(decoded.parameters_named("issuer").next(), Some("Query"));
        let item = decoded.check()?.finish()?;
        assert_eq!(item.issuer, "Query");
        assert_eq!(item.account, "account");
        assert_eq!(item.digits, TotpDigits::Eight);
        Ok(())
    }

    #[test]
    fn path_and_query_have_distinct_plus_semantics() -> anyhow::Result<()> {
        assert_eq!(
            UriComponent::Path("alice+alerts%40example.com")
                .decode()?
                .as_str(),
            "alice+alerts@example.com"
        );
        assert_eq!(
            UriComponent::Query("alice+alerts%40example.com")
                .decode()?
                .as_str(),
            "alice alerts@example.com"
        );
        assert_eq!(
            UriComponent::Query("alice%2Balerts").decode()?.as_str(),
            "alice+alerts"
        );
        Ok(())
    }

    #[test]
    fn admission_preserves_case_trim_and_first_equals_rules() -> anyhow::Result<()> {
        let item = OtpauthInput(
            " \n otpauth://totp/Label:account?secret=JBSWY3DPEHPK3PXP&issuer=Name=Suffix \n ",
        )
        .into_authenticator()?;
        assert_eq!(item.issuer, "Name=Suffix");
        for uri in [
            "OTPAUTH://totp/x?secret=x",
            "otpauth://TOTP/x?secret=x",
            "otpauth://totp/x",
            "otpauth://hotp/x?secret=x",
        ] {
            assert!(matches!(
                OtpauthInput(uri).decode(),
                Err(ValidationError::AuthenticatorUriInvalid)
            ));
        }
        Ok(())
    }

    #[test]
    fn malformed_query_and_utf8_fail_before_secret_admission() {
        for uri in [
            "otpauth://totp/%FF?secret=invalid",
            "otpauth://totp/Label?secret=invalid&issuer=%FF",
            "otpauth://totp/Label?secret=invalid&%FF=x",
            "otpauth://totp/Label?secret=invalid&missing_equals",
        ] {
            assert!(matches!(
                OtpauthInput(uri).into_authenticator(),
                Err(ValidationError::AuthenticatorUriInvalid)
            ));
        }
    }

    #[test]
    fn missing_secret_precedes_protocol_but_present_invalid_secret_follows_it() {
        let missing = UriFixture::new("algorithm=invalid");
        assert!(matches!(
            missing.input().into_authenticator(),
            Err(ValidationError::AuthenticatorSecretInvalid)
        ));
        let invalid_algorithm = UriFixture::new("secret=invalid&algorithm=invalid");
        assert!(matches!(
            invalid_algorithm.input().into_authenticator(),
            Err(ValidationError::AuthenticatorUriInvalid)
        ));
        let invalid_digits = UriFixture::new("secret=invalid&digits=5&period=10");
        assert!(matches!(
            invalid_digits.input().into_authenticator(),
            Err(ValidationError::AuthenticatorDigitsInvalid)
        ));
        let invalid_period = UriFixture::new("secret=invalid&period=10");
        assert!(matches!(
            invalid_period.input().into_authenticator(),
            Err(ValidationError::AuthenticatorPeriodInvalid)
        ));
    }

    #[test]
    fn form_defaults_trim_numbers_while_uri_values_remain_strict() -> anyhow::Result<()> {
        let form = ProtocolParameters::from_form(&FormProtocolInput {
            algorithm: "SHA1",
            digits: " \n",
            period: "\t",
        })?;
        assert_eq!(form.digits, TotpDigits::Six);
        assert_eq!(form.period.duration().as_secs(), 30);
        let form = ProtocolParameters::from_form(&FormProtocolInput {
            algorithm: "SHA256",
            digits: " 8 ",
            period: " 45 ",
        })?;
        assert_eq!(form.algorithm, TotpAlgorithm::Sha256);
        assert_eq!(form.digits, TotpDigits::Eight);
        assert_eq!(form.period.duration().as_secs(), 45);
        for query in [
            "secret=JBSWY3DPEHPK3PXP&digits=",
            "secret=JBSWY3DPEHPK3PXP&digits=%206%20",
            "secret=JBSWY3DPEHPK3PXP&period=",
            "secret=JBSWY3DPEHPK3PXP&period=%2030%20",
        ] {
            assert!(matches!(
                UriFixture::new(query).input().into_authenticator(),
                Err(ValidationError::AuthenticatorUriInvalid)
            ));
        }
        Ok(())
    }

    #[test]
    fn checked_key_still_requires_nonempty_issuer_at_completion() -> anyhow::Result<()> {
        let input = OtpauthInput("otpauth://totp/Label:account?secret=JBSWY3DPEHPK3PXP&issuer=");
        let checked = input.decode()?.check()?;
        assert!(matches!(
            checked.finish(),
            Err(ValidationError::AuthenticatorIssuerRequired)
        ));
        Ok(())
    }

    #[test]
    fn checked_completion_consumes_bound_parameters_and_secret() -> anyhow::Result<()> {
        let fixture =
            UriFixture::new("secret=JBSWY3DPEHPK3PXP&algorithm=SHA512&digits=8&period=45");
        let checked = fixture.input().decode()?.check()?;
        let finish: fn(CheckedOtpauthInput) -> Result<AuthenticatorSecret, ValidationError> =
            CheckedOtpauthInput::finish;
        let mut item = finish(checked)?;
        assert_eq!(item.algorithm, TotpAlgorithm::Sha512);
        assert_eq!(item.digits, TotpDigits::Eight);
        assert_eq!(item.period.duration().as_secs(), 45);
        assert_eq!(item.secret.as_str(), "JBSWY3DPEHPK3PXP");
        item.zeroize();
        assert!(item.secret.as_str().is_empty());
        assert!(item.issuer.is_empty());
        Ok(())
    }

    #[test]
    fn decoded_and_checked_abandonment_leave_the_borrowed_input_unchanged() -> anyhow::Result<()> {
        let fixture = UriFixture::new("secret=JBSWY3DPEHPK3PXP");
        let before = Zeroizing::new(fixture.text.as_str().to_owned());
        {
            let decoded = fixture.input().decode()?;
            let _: &Zeroizing<String> = &decoded.label;
            let (_, secret) = decoded
                .parameters
                .first()
                .ok_or_else(|| anyhow::anyhow!("missing fixture parameter"))?;
            let _: &Zeroizing<String> = secret;
        }
        {
            let checked = fixture.input().decode()?.check()?;
            assert_eq!(checked.secret.as_str(), "JBSWY3DPEHPK3PXP");
        }
        assert_eq!(fixture.text.as_str(), before.as_str());
        Ok(())
    }

    #[test]
    fn decoded_names_are_case_sensitive_and_malformed_percent_sequences_remain_literal()
    -> anyhow::Result<()> {
        let item = UriFixture::new("secret=JBSWY3DPEHPK3PXP&Issuer=ignored&issuer=Literal%GG")
            .input()
            .into_authenticator()?;
        assert_eq!(item.issuer, "Literal%GG");
        let missing = UriFixture::new("Secret=JBSWY3DPEHPK3PXP");
        assert!(matches!(
            missing.input().into_authenticator(),
            Err(ValidationError::AuthenticatorSecretInvalid)
        ));
        Ok(())
    }

    #[test]
    fn percent_encoded_duplicate_names_replace_prior_values() -> anyhow::Result<()> {
        let fixture =
            UriFixture::new("secret=invalid&%73ecret=JBSWY3DPEHPK3PXP&issuer=First&%69ssuer=Final");
        let decoded = fixture.input().decode()?;
        assert_eq!(decoded.parameters.len(), 2);
        let checked = decoded.check()?;
        assert_eq!(checked.secret.as_str(), "JBSWY3DPEHPK3PXP");
        assert_eq!(checked.finish()?.issuer, "Final");
        Ok(())
    }

    #[test]
    fn explicit_empty_secret_does_not_take_the_missing_secret_path() {
        let fixture = UriFixture::new("secret=&digits=5");
        assert!(matches!(
            fixture.input().into_authenticator(),
            Err(ValidationError::AuthenticatorDigitsInvalid)
        ));
        let fixture = UriFixture::new("secret=");
        assert!(matches!(
            fixture.input().into_authenticator(),
            Err(ValidationError::AuthenticatorSecretInvalid)
        ));
    }

    #[test]
    fn malformed_later_parameter_is_not_hidden_by_an_earlier_valid_secret() {
        let fixture = UriFixture::new("secret=JBSWY3DPEHPK3PXP&issuer=%FF&issuer=Later");
        assert!(matches!(
            fixture.input().into_authenticator(),
            Err(ValidationError::AuthenticatorUriInvalid)
        ));
    }
}

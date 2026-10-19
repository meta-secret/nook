//! Resolve decoded QR payloads and visible setup-key texts into enrollment
//! candidates: otpauth-only filtering, canonical setup-key URIs, and
//! same-secret deduplication.
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]

use super::{AuthenticatorEnrollmentError, SetupKeyTextClassification, VisibleSetupKeyText};
use crate::secrets::secret_view::WebsiteHost;
use crate::{AuthenticatorSecret, TotpAlgorithm, TotpDigits, TotpPeriod, TotpSecret};
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::HashSet;
use std::hash::{Hash, Hasher};
use std::mem;
use tsify::Tsify;
use zeroize::{Zeroize, Zeroizing};

const MAX_QR_PAYLOADS: usize = 32;
const MAX_QR_PAYLOAD_BYTES: usize = 2048;
const MAX_SETUP_KEY_TEXTS: usize = 64;

/// One decoded QR payload, bounded before any parsing.
#[derive(Deserialize)]
#[serde(try_from = "String")]
pub struct EnrollmentQrPayload(String);

impl TryFrom<String> for EnrollmentQrPayload {
    type Error = AuthenticatorEnrollmentError;

    fn try_from(mut payload: String) -> Result<Self, Self::Error> {
        match payload.len().cmp(&MAX_QR_PAYLOAD_BYTES) {
            Ordering::Less | Ordering::Equal => Ok(Self(payload)),
            Ordering::Greater => {
                payload.zeroize();
                Err(AuthenticatorEnrollmentError::QrPayloadTooLong)
            }
        }
    }
}

impl Zeroize for EnrollmentQrPayload {
    fn zeroize(&mut self) {
        let Self(payload) = self;
        payload.zeroize();
    }
}

impl Drop for EnrollmentQrPayload {
    fn drop(&mut self) {
        self.zeroize();
    }
}

/// A validated `otpauth://totp/...` URI offered for preview and save.
#[derive(Serialize)]
#[serde(transparent)]
pub struct EnrollmentOtpauthUri(String);

impl EnrollmentOtpauthUri {
    #[must_use]
    pub fn as_str(&self) -> &str {
        let Self(uri) = self;
        uri
    }
}

impl Zeroize for EnrollmentOtpauthUri {
    fn zeroize(&mut self) {
        let Self(uri) = self;
        uri.zeroize();
    }
}

impl Drop for EnrollmentOtpauthUri {
    fn drop(&mut self) {
        self.zeroize();
    }
}

/// Where a candidate was found on the page.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
pub enum NookAuthenticatorEnrollmentCandidateSource {
    Qr,
    SetupKey,
}

/// Page material captured after the trusted **Add 2FA from this page** click.
#[derive(Deserialize, Tsify)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NookAuthenticatorEnrollmentCandidateRequest {
    #[tsify(type = "string[]")]
    pub qr_payloads: Vec<EnrollmentQrPayload>,
    #[tsify(type = "string[]")]
    pub setup_key_texts: Vec<VisibleSetupKeyText>,
    pub page_origin: String,
}

#[derive(Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct NookAuthenticatorEnrollmentCandidate {
    pub source: NookAuthenticatorEnrollmentCandidateSource,
    #[tsify(type = "string")]
    pub otpauth_uri: EnrollmentOtpauthUri,
}

/// QR candidates in input order, then setup-key candidates in input order.
#[derive(Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct NookAuthenticatorEnrollmentCandidates {
    pub candidates: Vec<NookAuthenticatorEnrollmentCandidate>,
}

impl NookAuthenticatorEnrollmentCandidateRequest {
    /// Keep TOTP otpauth QR payloads and plausible setup keys, collapsing
    /// candidates that share decoded secret bytes; the QR candidate wins.
    ///
    /// Rejected payloads and texts are dropped without being echoed or counted.
    pub fn resolve(
        self,
    ) -> Result<NookAuthenticatorEnrollmentCandidates, AuthenticatorEnrollmentError> {
        match self.qr_payloads.len().cmp(&MAX_QR_PAYLOADS) {
            Ordering::Less | Ordering::Equal => {}
            Ordering::Greater => return Err(AuthenticatorEnrollmentError::QrPayloadCountExceeded),
        }
        match self.setup_key_texts.len().cmp(&MAX_SETUP_KEY_TEXTS) {
            Ordering::Less | Ordering::Equal => {}
            Ordering::Greater => {
                return Err(AuthenticatorEnrollmentError::SetupKeyTextCountExceeded);
            }
        }
        let issuer = WebsiteHost::normalize(&self.page_origin)
            .map_err(|_| AuthenticatorEnrollmentError::PageOriginInvalid)?;
        let collection = self.qr_payloads.iter().fold(
            CandidateCollection::default(),
            CandidateCollection::with_qr_payload,
        );
        let collection = self
            .setup_key_texts
            .iter()
            .try_fold(collection, |collection, text| {
                collection.with_setup_key_text(SetupKeyTextInput {
                    text,
                    issuer: &issuer,
                })
            })?;
        Ok(NookAuthenticatorEnrollmentCandidates {
            candidates: collection.candidates,
        })
    }
}

/// Decoded secret bytes, used only as an in-memory deduplication key.
#[derive(PartialEq, Eq)]
struct DecodedSecretKey(Zeroizing<Vec<u8>>);

impl Hash for DecodedSecretKey {
    fn hash<H: Hasher>(&self, state: &mut H) {
        let Self(bytes) = self;
        bytes.as_slice().hash(state);
    }
}

#[derive(Clone, Copy)]
struct SetupKeyTextInput<'a> {
    text: &'a VisibleSetupKeyText,
    issuer: &'a WebsiteHost,
}

struct AdmittedCandidate {
    source: NookAuthenticatorEnrollmentCandidateSource,
    authenticator: AuthenticatorSecret,
    otpauth_uri: EnrollmentOtpauthUri,
}

#[derive(Default)]
struct CandidateCollection {
    seen: HashSet<DecodedSecretKey>,
    candidates: Vec<NookAuthenticatorEnrollmentCandidate>,
}

impl CandidateCollection {
    #[must_use]
    fn with_qr_payload(self, payload: &EnrollmentQrPayload) -> Self {
        let EnrollmentQrPayload(text) = payload;
        match AuthenticatorSecret::from_otpauth_uri(text) {
            Ok(authenticator) => self.with_candidate(AdmittedCandidate {
                source: NookAuthenticatorEnrollmentCandidateSource::Qr,
                authenticator,
                otpauth_uri: EnrollmentOtpauthUri(text.trim().to_owned()),
            }),
            Err(_) => self,
        }
    }

    fn with_setup_key_text(
        self,
        input: SetupKeyTextInput<'_>,
    ) -> Result<Self, AuthenticatorEnrollmentError> {
        match input.text.classify() {
            SetupKeyTextClassification::SetupKey(secret) => {
                let authenticator = SetupKeyAuthenticator {
                    secret,
                    issuer: input.issuer,
                }
                .authenticator();
                let mut uri = authenticator
                    .otpauth_uri()
                    .map_err(|_| AuthenticatorEnrollmentError::OtpauthUriSerialization)?;
                Ok(self.with_candidate(AdmittedCandidate {
                    source: NookAuthenticatorEnrollmentCandidateSource::SetupKey,
                    authenticator,
                    otpauth_uri: EnrollmentOtpauthUri(mem::take(&mut *uri)),
                }))
            }
            SetupKeyTextClassification::NotSetupKey => Ok(self),
        }
    }

    #[must_use]
    #[expect(
        clippy::match_bool,
        reason = "set insertion is converted through a native pattern into keep or collapse"
    )]
    fn with_candidate(mut self, candidate: AdmittedCandidate) -> Self {
        let AdmittedCandidate {
            source,
            authenticator,
            otpauth_uri,
        } = candidate;
        let Ok(bytes) = authenticator.secret.decoded() else {
            return self;
        };
        match self.seen.insert(DecodedSecretKey(bytes)) {
            true => self.candidates.push(NookAuthenticatorEnrollmentCandidate {
                source,
                otpauth_uri,
            }),
            false => {}
        }
        self
    }
}

/// A manual setup key with the interoperable SHA-1 / 6-digit / 30-second
/// defaults, named after the page host and with no account label.
struct SetupKeyAuthenticator<'a> {
    secret: TotpSecret,
    issuer: &'a WebsiteHost,
}

impl SetupKeyAuthenticator<'_> {
    fn authenticator(self) -> AuthenticatorSecret {
        AuthenticatorSecret {
            issuer: self.issuer.as_str().to_owned(),
            account: String::new(),
            website_url: String::new(),
            secret: self.secret,
            algorithm: TotpAlgorithm::Sha1,
            digits: TotpDigits::Six,
            period: TotpPeriod::default(),
            backup_codes: Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        EnrollmentQrPayload, MAX_QR_PAYLOAD_BYTES, MAX_QR_PAYLOADS, MAX_SETUP_KEY_TEXTS,
        NookAuthenticatorEnrollmentCandidateRequest, NookAuthenticatorEnrollmentCandidateSource,
        NookAuthenticatorEnrollmentCandidates,
    };
    use crate::{
        AuthenticatorEnrollmentError, AuthenticatorSecret, TotpAlgorithm, TotpDigits, TotpPeriod,
        VisibleSetupKeyText,
    };

    const QR_EXAMPLE: &str =
        "otpauth://totp/Example:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example";
    const QR_OTHER: &str =
        "otpauth://totp/Other:bob@example.com?secret=KRUGS4ZANFZSAYJAMFXGIIDUN5XQ&issuer=Other";

    struct RequestFixture<'a> {
        qr_payloads: &'a [&'a str],
        setup_key_texts: &'a [&'a str],
        page_origin: &'a str,
    }

    struct ObservedCandidate {
        source: NookAuthenticatorEnrollmentCandidateSource,
        otpauth_uri: String,
    }

    impl RequestFixture<'_> {
        fn request(
            &self,
        ) -> Result<NookAuthenticatorEnrollmentCandidateRequest, AuthenticatorEnrollmentError>
        {
            Ok(NookAuthenticatorEnrollmentCandidateRequest {
                qr_payloads: self
                    .qr_payloads
                    .iter()
                    .map(|payload| EnrollmentQrPayload::try_from((*payload).to_owned()))
                    .collect::<Result<_, _>>()?,
                setup_key_texts: self
                    .setup_key_texts
                    .iter()
                    .map(|text| VisibleSetupKeyText::try_from((*text).to_owned()))
                    .collect::<Result<_, _>>()?,
                page_origin: self.page_origin.to_owned(),
            })
        }

        fn resolve(
            &self,
        ) -> Result<NookAuthenticatorEnrollmentCandidates, AuthenticatorEnrollmentError> {
            self.request()?.resolve()
        }

        fn candidates(&self) -> anyhow::Result<Vec<ObservedCandidate>> {
            Ok(self
                .resolve()?
                .candidates
                .iter()
                .map(|candidate| ObservedCandidate {
                    source: candidate.source,
                    otpauth_uri: candidate.otpauth_uri.as_str().to_owned(),
                })
                .collect())
        }
    }

    impl ObservedCandidate {
        fn sources(candidates: &[Self]) -> Vec<NookAuthenticatorEnrollmentCandidateSource> {
            candidates
                .iter()
                .map(|candidate| candidate.source)
                .collect()
        }
    }

    #[test]
    fn keeps_only_totp_otpauth_qr_payloads() -> anyhow::Result<()> {
        let candidates = RequestFixture {
            qr_payloads: &[
                "https://example.com/download-the-app",
                "otpauth://hotp/Example:alice?secret=JBSWY3DPEHPK3PXP&counter=1",
                "otpauth://totp/Example:alice?secret=not-base32!",
                "otpauth-migration://offline?data=AAAA",
                "WIFI:S:guest;T:WPA;P:secret;;",
                QR_EXAMPLE,
            ],
            setup_key_texts: &[],
            page_origin: "https://www.example.com",
        }
        .candidates()?;

        let [candidate] = candidates.as_slice() else {
            anyhow::bail!("expected exactly one QR candidate");
        };
        assert_eq!(
            candidate.source,
            NookAuthenticatorEnrollmentCandidateSource::Qr
        );
        assert_eq!(candidate.otpauth_uri, QR_EXAMPLE);
        Ok(())
    }

    #[test]
    fn setup_key_becomes_a_canonical_sha1_six_digit_thirty_second_uri() -> anyhow::Result<()> {
        let candidates = RequestFixture {
            qr_payloads: &[],
            setup_key_texts: &[
                "Scan this QR code with your app",
                "Key: jbsw y3dp ehpk 3pxp",
            ],
            page_origin: "https://www.example.com",
        }
        .candidates()?;

        let [candidate] = candidates.as_slice() else {
            anyhow::bail!("expected exactly one setup-key candidate");
        };
        assert_eq!(
            candidate.source,
            NookAuthenticatorEnrollmentCandidateSource::SetupKey
        );
        let item = AuthenticatorSecret::from_otpauth_uri(&candidate.otpauth_uri)?;
        assert_eq!(item.issuer, "example.com");
        assert_eq!(item.account, "");
        assert_eq!(item.secret.as_str(), "JBSWY3DPEHPK3PXP");
        assert_eq!(item.algorithm, TotpAlgorithm::Sha1);
        assert_eq!(item.digits, TotpDigits::Six);
        assert_eq!(item.period, TotpPeriod::default());
        assert_eq!(item.period.duration().as_secs(), 30);
        Ok(())
    }

    #[test]
    fn setup_key_issuer_keeps_a_subdomain_host() -> anyhow::Result<()> {
        let candidates = RequestFixture {
            qr_payloads: &[],
            setup_key_texts: &["JBSW Y3DP EHPK 3PXP"],
            page_origin: "https://dashboard.example.com",
        }
        .candidates()?;
        let [candidate] = candidates.as_slice() else {
            anyhow::bail!("expected exactly one setup-key candidate");
        };
        let item = AuthenticatorSecret::from_otpauth_uri(&candidate.otpauth_uri)?;
        assert_eq!(item.issuer, "dashboard.example.com");
        Ok(())
    }

    #[test]
    fn qr_candidate_wins_over_a_setup_key_with_the_same_secret() -> anyhow::Result<()> {
        let candidates = RequestFixture {
            qr_payloads: &[QR_EXAMPLE],
            setup_key_texts: &["JBSW-Y3DP-EHPK-3PXP"],
            page_origin: "https://www.example.com",
        }
        .candidates()?;

        let [candidate] = candidates.as_slice() else {
            anyhow::bail!("expected the setup key to collapse into the QR candidate");
        };
        assert_eq!(
            candidate.source,
            NookAuthenticatorEnrollmentCandidateSource::Qr
        );
        assert_eq!(candidate.otpauth_uri, QR_EXAMPLE);
        Ok(())
    }

    #[test]
    fn identical_qr_payloads_and_equivalent_keys_collapse() -> anyhow::Result<()> {
        let candidates = RequestFixture {
            qr_payloads: &[QR_EXAMPLE, QR_EXAMPLE],
            setup_key_texts: &[],
            page_origin: "https://www.example.com",
        }
        .candidates()?;
        assert_eq!(candidates.len(), 1);

        let candidates = RequestFixture {
            qr_payloads: &[],
            setup_key_texts: &["JBSW Y3DP EHPK 3PXP", "jbswy3dpehpk3pxp"],
            page_origin: "https://www.example.com",
        }
        .candidates()?;
        assert_eq!(candidates.len(), 1);
        Ok(())
    }

    #[test]
    fn different_secrets_stay_separate_with_qr_candidates_first() -> anyhow::Result<()> {
        let candidates = RequestFixture {
            qr_payloads: &[QR_OTHER, QR_EXAMPLE],
            setup_key_texts: &["GEZD GNBV GY3T QOJQ GEZD GNBV GY3T QOJQ"],
            page_origin: "https://www.example.com",
        }
        .candidates()?;

        assert_eq!(
            ObservedCandidate::sources(&candidates),
            [
                NookAuthenticatorEnrollmentCandidateSource::Qr,
                NookAuthenticatorEnrollmentCandidateSource::Qr,
                NookAuthenticatorEnrollmentCandidateSource::SetupKey,
            ]
        );
        let [first, second, _] = candidates.as_slice() else {
            anyhow::bail!("expected three candidates");
        };
        assert_eq!(first.otpauth_uri, QR_OTHER);
        assert_eq!(second.otpauth_uri, QR_EXAMPLE);
        Ok(())
    }

    #[test]
    fn empty_request_resolves_to_no_candidates() -> anyhow::Result<()> {
        let candidates = RequestFixture {
            qr_payloads: &[],
            setup_key_texts: &[],
            page_origin: "https://example.com",
        }
        .candidates()?;
        assert!(candidates.is_empty());
        Ok(())
    }

    #[test]
    fn request_bounds_fail_closed_instead_of_truncating() {
        let too_many_qr = vec![QR_EXAMPLE; MAX_QR_PAYLOADS + 1];
        assert!(matches!(
            RequestFixture {
                qr_payloads: &too_many_qr,
                setup_key_texts: &[],
                page_origin: "https://example.com",
            }
            .resolve(),
            Err(AuthenticatorEnrollmentError::QrPayloadCountExceeded)
        ));
        let max_keys = vec!["JBSW Y3DP EHPK 3PXP"; MAX_SETUP_KEY_TEXTS];
        assert!(matches!(
            RequestFixture {
                qr_payloads: &[],
                setup_key_texts: &max_keys,
                page_origin: "https://example.com",
            }
            .resolve(),
            Ok(resolved) if resolved.candidates.len() == 1
        ));
        let too_many_keys = vec!["JBSW Y3DP EHPK 3PXP"; MAX_SETUP_KEY_TEXTS + 1];
        assert!(matches!(
            RequestFixture {
                qr_payloads: &[],
                setup_key_texts: &too_many_keys,
                page_origin: "https://example.com",
            }
            .resolve(),
            Err(AuthenticatorEnrollmentError::SetupKeyTextCountExceeded)
        ));
        let oversize_qr = "Q".repeat(MAX_QR_PAYLOAD_BYTES + 1);
        assert!(matches!(
            RequestFixture {
                qr_payloads: &[&oversize_qr],
                setup_key_texts: &[],
                page_origin: "https://example.com",
            }
            .resolve(),
            Err(AuthenticatorEnrollmentError::QrPayloadTooLong)
        ));
        let oversize_key = "A".repeat(257);
        assert!(matches!(
            RequestFixture {
                qr_payloads: &[],
                setup_key_texts: &[&oversize_key],
                page_origin: "https://example.com",
            }
            .resolve(),
            Err(AuthenticatorEnrollmentError::SetupKeyTextTooLong)
        ));
        assert!(matches!(
            RequestFixture {
                qr_payloads: &[QR_EXAMPLE],
                setup_key_texts: &[],
                page_origin: " ",
            }
            .resolve(),
            Err(AuthenticatorEnrollmentError::PageOriginInvalid)
        ));
    }

    #[test]
    fn request_deserializes_the_camel_case_wire_shape_and_rejects_unknown_fields()
    -> anyhow::Result<()> {
        let request: NookAuthenticatorEnrollmentCandidateRequest =
            serde_json::from_value(serde_json::json!({
                "qrPayloads": [QR_EXAMPLE],
                "setupKeyTexts": ["JBSW Y3DP EHPK 3PXP"],
                "pageOrigin": "https://www.example.com",
            }))?;
        let resolved = request.resolve()?;
        assert_eq!(resolved.candidates.len(), 1);
        let wire = serde_json::to_value(&resolved)?;
        assert_eq!(
            wire,
            serde_json::json!({
                "candidates": [{ "source": "qr", "otpauthUri": QR_EXAMPLE }]
            })
        );
        assert_eq!(
            serde_json::to_value(NookAuthenticatorEnrollmentCandidateSource::SetupKey)?,
            serde_json::json!("setup-key")
        );
        assert!(
            serde_json::from_value::<NookAuthenticatorEnrollmentCandidateRequest>(
                serde_json::json!({
                    "qrPayloads": [],
                    "setupKeyTexts": [],
                    "pageOrigin": "https://www.example.com",
                    "extra": true,
                })
            )
            .is_err()
        );
        Ok(())
    }
}

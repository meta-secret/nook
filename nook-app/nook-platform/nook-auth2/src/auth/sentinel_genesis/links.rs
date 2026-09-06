#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! Canonical public deep links for the Sentinel genesis ceremony.

use super::{
    PUBLIC_KEY_ANNOUNCEMENT_KIND, SentinelGenesisParticipantResponse,
    SentinelGenesisPublicKeyAnnouncement, SentinelGenesisRequest,
};
use crate::{MultiDeviceError, MultiDeviceResult};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use serde_json::Value;

const SENTINEL_REQUEST_HASH_PREFIX: &str = "#sentinel-request=";
const SENTINEL_RESPONSE_HASH_PREFIX: &str = "#sentinel-response=";
const MAX_SENTINEL_LINK_PAYLOAD_BYTES: usize = 16 * 1024;

/// Raw public ceremony input. Response normalization does not verify its signature or session.
pub struct SentinelGenesisLinkInput<'a> {
    pub input: &'a str,
}
#[derive(Clone, Copy)]
enum SentinelLinkKind {
    Request,
    Response,
}
impl SentinelLinkKind {
    fn hash_prefix(self) -> &'static str {
        match self {
            Self::Request => SENTINEL_REQUEST_HASH_PREFIX,
            Self::Response => SENTINEL_RESPONSE_HASH_PREFIX,
        }
    }
    fn query_key(self) -> &'static str {
        match self {
            Self::Request => "sentinel-request",
            Self::Response => "sentinel-response",
        }
    }
}
struct SentinelPublicLink<'a> {
    payload: &'a str,
    base_url: &'a str,
    kind: SentinelLinkKind,
}
impl SentinelGenesisLinkInput<'_> {
    pub fn request_link(&self, base_url: &str) -> MultiDeviceResult<String> {
        let request_json = self.input;
        let canonical = (SentinelGenesisLinkInput {
            input: request_json,
        })
        .canonical_request()?;
        Ok(SentinelPublicLink {
            payload: &canonical,
            base_url,
            kind: SentinelLinkKind::Request,
        }
        .encode())
    }
}
impl SentinelGenesisLinkInput<'_> {
    pub fn canonical_request(&self) -> MultiDeviceResult<String> {
        let input = self.input;
        let json = (SentinelGenesisLinkInput { input }).decode(SentinelLinkKind::Request)?;
        let request: SentinelGenesisRequest = serde_json::from_str(&json)
            .map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)?;
        request.validate()?;
        serde_json::to_string(&request).map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)
    }
}
impl SentinelGenesisLinkInput<'_> {
    pub fn response_link(&self, base_url: &str) -> MultiDeviceResult<String> {
        let response_json = self.input;
        let canonical = (SentinelGenesisLinkInput {
            input: response_json,
        })
        .canonical_response()?;
        Ok(SentinelPublicLink {
            payload: &canonical,
            base_url,
            kind: SentinelLinkKind::Response,
        }
        .encode())
    }
}
impl SentinelGenesisLinkInput<'_> {
    pub fn canonical_response(&self) -> MultiDeviceResult<String> {
        let input = self.input;
        let json = (SentinelGenesisLinkInput { input }).decode(SentinelLinkKind::Response)?;
        let value: Value = serde_json::from_str(&json)
            .map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)?;
        if value.get("kind").and_then(Value::as_str) == Some(PUBLIC_KEY_ANNOUNCEMENT_KIND) {
            return Err(MultiDeviceError::StandaloneSentinelGenesisAnnouncementRejected);
        }
        let response: SentinelGenesisParticipantResponse = serde_json::from_value(value)
            .map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)?;
        serde_json::to_string(&response)
            .map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)
    }
}
impl SentinelGenesisLinkInput<'_> {
    pub fn reported_fingerprint(&self) -> MultiDeviceResult<String> {
        let input = self.input;
        let trimmed = input.trim();
        if trimmed.starts_with('{') {
            let value: Value = serde_json::from_str(trimmed)
                .map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)?;
            if value.get("kind").and_then(Value::as_str) == Some(PUBLIC_KEY_ANNOUNCEMENT_KIND) {
                let announcement: SentinelGenesisPublicKeyAnnouncement =
                    serde_json::from_value(value)
                        .map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)?;
                announcement.validate()?;
                return Ok(announcement.fingerprint);
            }
        }
        let canonical = (SentinelGenesisLinkInput { input }).canonical_response()?;
        let response: SentinelGenesisParticipantResponse = serde_json::from_str(&canonical)
            .map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)?;
        Ok(response.participant.fingerprint)
    }
}
impl SentinelGenesisLinkInput<'_> {
    fn decode(&self, kind: SentinelLinkKind) -> MultiDeviceResult<String> {
        let input = self.input;
        let trimmed = input.trim();
        if trimmed.is_empty() || trimmed.len() > MAX_SENTINEL_LINK_PAYLOAD_BYTES {
            return Err(MultiDeviceError::InvalidSentinelGenesisPayload);
        }
        if trimmed.starts_with('{') {
            return Ok(trimmed.to_owned());
        }

        let encoded = (SentinelGenesisLinkInput { input: trimmed })
            .extract(kind)
            .ok_or(MultiDeviceError::InvalidSentinelGenesisPayload)?;
        let decoded = percent_encoding::percent_decode_str(encoded)
            .decode_utf8()
            .map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)?;
        if decoded.starts_with('{') {
            return Ok(decoded.into_owned());
        }
        let bytes = URL_SAFE_NO_PAD
            .decode(decoded.as_bytes())
            .map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)?;
        if bytes.len() > MAX_SENTINEL_LINK_PAYLOAD_BYTES {
            return Err(MultiDeviceError::InvalidSentinelGenesisPayload);
        }
        String::from_utf8(bytes).map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)
    }
}
impl<'a> SentinelGenesisLinkInput<'a> {
    fn extract(&self, kind: SentinelLinkKind) -> Option<&'a str> {
        let input = self.input;
        let hash_prefix = kind.hash_prefix();
        let query_key = kind.query_key();
        if let Some(value) = input.strip_prefix(hash_prefix) {
            return Some(value);
        }
        if let Some(hash) = input.split_once('#').map(|(_, hash)| hash) {
            let prefix = hash_prefix.trim_start_matches('#');
            if let Some(value) = hash.strip_prefix(prefix) {
                return Some(value);
            }
        }
        let query = input.split_once('?').map_or(input, |(_, query)| query);
        query.split('&').find_map(|part| {
            let (key, value) = part.split_once('=')?;
            (key == query_key).then_some(value)
        })
    }
}
impl SentinelPublicLink<'_> {
    fn encode(self) -> String {
        let Self {
            payload,
            base_url,
            kind,
        } = self;
        let hash_prefix = kind.hash_prefix();
        let base = base_url.trim();
        let encoded = URL_SAFE_NO_PAD.encode(payload.as_bytes());
        format!("{base}{hash_prefix}{encoded}")
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::multi_device::DeviceIdentity;
    use crate::auth::sentinel_genesis::{
        CheckedSentinelGenesisResponse, SentinelGenesisReadiness, SentinelGenesisResponder,
        SentinelGenesisSession,
    };
    use ed25519_dalek::SigningKey;

    struct ResponseLinkFixture {
        session: SentinelGenesisSession,
        response: SentinelGenesisParticipantResponse,
    }
    impl ResponseLinkFixture {
        fn new() -> anyhow::Result<Self> {
            let owner = DeviceIdentity::generate()?;
            let signing = Fixture::signing_key()?;
            let session = SentinelGenesisSession::start(
                &owner,
                &signing,
                2.into(),
                2.into(),
                "Owner".into(),
            )?;
            let response = Fixture::participant(session.request(), "Peer")?;
            Ok(Self { session, response })
        }
        fn json(&self) -> anyhow::Result<String> {
            Ok(serde_json::to_string(&self.response)?)
        }
    }

    #[test]
    fn response_normalization_and_fingerprint_do_not_claim_signature_admission()
    -> anyhow::Result<()> {
        let mut fixture = ResponseLinkFixture::new()?;
        fixture.response.signature.clear();
        let json = fixture.json()?;
        let input = SentinelGenesisLinkInput { input: &json };
        assert_eq!(input.canonical_response()?, json);
        assert_eq!(
            input.reported_fingerprint()?,
            fixture.response.participant.fingerprint
        );
        let link = input.response_link("https://nook.example/")?;
        assert_eq!(
            (SentinelGenesisLinkInput { input: &link }).canonical_response()?,
            json
        );
        match fixture.session.collect_payload(&json, "") {
            Err(error) => assert!(matches!(
                error,
                MultiDeviceError::InvalidSentinelGenesisSignature
            )),
            Ok(_) => anyhow::bail!("normalization must not replace signature admission"),
        }
        Ok(())
    }

    #[test]
    fn fragment_precedes_query_and_percent_encoded_json_remains_supported() -> anyhow::Result<()> {
        let fixture = ResponseLinkFixture::new()?;
        let json = fixture.json()?;
        let encoded = URL_SAFE_NO_PAD.encode(json.as_bytes());
        let full =
            format!("https://nook.example/?sentinel-response=invalid#sentinel-response={encoded}");
        assert_eq!(
            (SentinelGenesisLinkInput { input: &full }).canonical_response()?,
            json
        );
        let padded_full = format!(" \n{full}\t ");
        assert_eq!(
            (SentinelGenesisLinkInput {
                input: &padded_full
            })
            .canonical_response()?,
            json
        );
        let conflicting =
            format!("https://nook.example/?sentinel-response={encoded}#sentinel-response=invalid");
        assert!(matches!(
            (SentinelGenesisLinkInput {
                input: &conflicting
            })
            .canonical_response(),
            Err(MultiDeviceError::InvalidSentinelGenesisPayload)
        ));
        let percent_json =
            percent_encoding::utf8_percent_encode(&json, percent_encoding::NON_ALPHANUMERIC)
                .to_string();
        let query = format!("https://nook.example/?sentinel-response={percent_json}");
        assert_eq!(
            (SentinelGenesisLinkInput { input: &query }).canonical_response()?,
            json
        );
        let trimmed = format!(" \n{json}\t");
        assert_eq!(
            (SentinelGenesisLinkInput { input: &trimmed }).canonical_response()?,
            json
        );
        assert_eq!(
            (SentinelGenesisLinkInput { input: &json })
                .response_link("  https://nook.example/vault  ")?,
            format!("https://nook.example/vault#sentinel-response={encoded}")
        );
        Ok(())
    }

    #[test]
    fn request_normalization_retains_verification_and_response_decoder_bounds() -> anyhow::Result<()>
    {
        let fixture = ResponseLinkFixture::new()?;
        let mut request = fixture.session.request().clone();
        request.signature.clear();
        let json = serde_json::to_string(&request)?;
        assert!(matches!(
            (SentinelGenesisLinkInput { input: &json }).canonical_request(),
            Err(MultiDeviceError::InvalidSentinelGenesisSignature)
        ));
        let oversized = "x".repeat(MAX_SENTINEL_LINK_PAYLOAD_BYTES + 1);
        for input in [
            "",
            " \n ",
            oversized.as_str(),
            "#sentinel-response=%FF",
            "#sentinel-response=_w",
            "#sentinel-response=not+base64/",
        ] {
            assert!(matches!(
                (SentinelGenesisLinkInput { input }).canonical_response(),
                Err(MultiDeviceError::InvalidSentinelGenesisPayload)
            ));
        }
        Ok(())
    }

    struct Fixture;
    impl Fixture {
        fn signing_key() -> anyhow::Result<SigningKey> {
            let mut seed = [0_u8; 32];
            getrandom::fill(&mut seed)?;
            Ok(SigningKey::from_bytes(&seed))
        }

        fn participant(
            request: &SentinelGenesisRequest,
            label: &str,
        ) -> anyhow::Result<SentinelGenesisParticipantResponse> {
            let identity = DeviceIdentity::generate()?;
            let signing = Self::signing_key()?;
            Ok(request
                .prepare_response(SentinelGenesisResponder {
                    identity: &identity,
                    signing_key: &signing,
                    label: label.to_owned(),
                })
                .and_then(CheckedSentinelGenesisResponse::sign)?)
        }
    }

    #[test]
    fn request_link_round_trips_as_canonical_validated_json() -> anyhow::Result<()> {
        let owner = DeviceIdentity::generate()?;
        let owner_signing = Fixture::signing_key()?;
        let session = SentinelGenesisSession::start(
            &owner,
            &owner_signing,
            3.into(),
            2.into(),
            "Owner".into(),
        )?;
        let request_json = serde_json::to_string(session.request())?;

        let link = (SentinelGenesisLinkInput {
            input: &request_json,
        })
        .request_link("https://nook.example/app/")?;
        assert!(link.starts_with("https://nook.example/app/#sentinel-request="));
        assert!(!link.contains(&session.request().session_id.to_string()));
        assert_eq!(
            (SentinelGenesisLinkInput { input: &link }).canonical_request()?,
            request_json
        );
        let padded_link = format!(" \n{link}\t ");
        assert_eq!(
            (SentinelGenesisLinkInput {
                input: &padded_link
            })
            .canonical_request()?,
            request_json
        );
        let mut tampered = session.request().clone();
        tampered.policy.threshold = 3.into();
        assert!(
            (SentinelGenesisLinkInput {
                input: &serde_json::to_string(&tampered)?
            })
            .canonical_request()
            .is_err()
        );
        assert!(
            (SentinelGenesisLinkInput {
                input: "not-a-request"
            })
            .canonical_request()
            .is_err()
        );
        Ok(())
    }

    #[test]
    fn request_link_preserves_a_canonical_route_without_a_trailing_slash() -> anyhow::Result<()> {
        let owner = DeviceIdentity::generate()?;
        let owner_signing = Fixture::signing_key()?;
        let session = SentinelGenesisSession::start(
            &owner,
            &owner_signing,
            3.into(),
            2.into(),
            "Owner".into(),
        )?;
        let request_json = serde_json::to_string(session.request())?;

        let link = (SentinelGenesisLinkInput {
            input: &request_json,
        })
        .request_link("https://nook.example/vault")?;

        assert!(link.starts_with("https://nook.example/vault#sentinel-request="));
        assert_eq!(
            (SentinelGenesisLinkInput { input: &link }).canonical_request()?,
            request_json
        );
        Ok(())
    }

    #[test]
    fn participant_response_link_round_trips_and_remains_session_verified() -> anyhow::Result<()> {
        let owner = DeviceIdentity::generate()?;
        let owner_signing = Fixture::signing_key()?;
        let session = SentinelGenesisSession::start(
            &owner,
            &owner_signing,
            2.into(),
            2.into(),
            "Owner".into(),
        )?;
        let response = Fixture::participant(session.request(), "Peer")?;
        let response_json = serde_json::to_string(&response)?;

        let link = (SentinelGenesisLinkInput {
            input: &response_json,
        })
        .response_link("https://nook.example/app/")?;
        assert!(link.starts_with("https://nook.example/app/#sentinel-response="));
        assert!(!link.contains(&response.signature));
        let normalized = (SentinelGenesisLinkInput { input: &link }).canonical_response()?;
        assert_eq!(normalized, response_json);
        let session = session.collect_payload(&normalized, "")?;
        assert_eq!(session.readiness(), SentinelGenesisReadiness::Complete);
        assert!(
            (SentinelGenesisLinkInput {
                input: "not-a-response"
            })
            .canonical_response()
            .is_err()
        );
        Ok(())
    }

    #[test]
    fn participant_response_link_preserves_a_canonical_route_without_a_trailing_slash()
    -> anyhow::Result<()> {
        let owner = DeviceIdentity::generate()?;
        let owner_signing = Fixture::signing_key()?;
        let session = SentinelGenesisSession::start(
            &owner,
            &owner_signing,
            2.into(),
            2.into(),
            "Owner".into(),
        )?;
        let response = Fixture::participant(session.request(), "Peer")?;
        let response_json = serde_json::to_string(&response)?;

        let link = (SentinelGenesisLinkInput {
            input: &response_json,
        })
        .response_link("https://nook.example/vault")?;

        assert!(link.starts_with("https://nook.example/vault#sentinel-response="));
        assert_eq!(
            (SentinelGenesisLinkInput { input: &link }).canonical_response()?,
            response_json
        );
        Ok(())
    }

    #[test]
    fn local_announcement_fingerprint_remains_readable_but_not_enrollable() -> anyhow::Result<()> {
        let peer = DeviceIdentity::generate()?;
        let peer_signing = Fixture::signing_key()?;
        let announcement =
            SentinelGenesisPublicKeyAnnouncement::create(SentinelGenesisResponder {
                identity: &peer,
                signing_key: &peer_signing,
                label: "Peer".into(),
            })?;
        let payload = serde_json::to_string(&announcement)?;
        assert_eq!(
            (SentinelGenesisLinkInput { input: &payload }).reported_fingerprint()?,
            announcement.fingerprint
        );
        let mut tampered = announcement.clone();
        tampered.label = "Mallory".into();
        assert!(matches!(
            (SentinelGenesisLinkInput {
                input: &serde_json::to_string(&tampered)?
            })
            .reported_fingerprint(),
            Err(MultiDeviceError::InvalidSentinelGenesisSignature)
        ));
        Ok(())
    }
}

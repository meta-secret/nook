//! Canonical public deep links for the Sentinel genesis ceremony.

use super::{
    PUBLIC_KEY_ANNOUNCEMENT_KIND, SentinelGenesisParticipantResponse,
    SentinelGenesisPublicKeyAnnouncement, SentinelGenesisRequest, validate_request,
    verify_public_key_announcement,
};
use crate::{MultiDeviceError, MultiDeviceResult};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use percent_encoding::percent_decode_str;

const SENTINEL_REQUEST_HASH_PREFIX: &str = "#sentinel-request=";
const SENTINEL_RESPONSE_HASH_PREFIX: &str = "#sentinel-response=";
const MAX_SENTINEL_LINK_PAYLOAD_BYTES: usize = 16 * 1024;

/// Build a browser deep link for the public owner request. The browser supplies
/// the app base URL; Rust owns canonical serialization and payload validation.
pub fn build_sentinel_genesis_request_link(
    request_json: &str,
    base_url: &str,
) -> MultiDeviceResult<String> {
    let canonical = normalize_sentinel_genesis_request(request_json)?;
    Ok(build_sentinel_link(
        &canonical,
        base_url,
        SENTINEL_REQUEST_HASH_PREFIX,
    ))
}

/// Accept a raw request payload or a full Sentinel request URL and return the
/// canonical JSON consumed by the signed response ceremony.
pub fn normalize_sentinel_genesis_request(input: &str) -> MultiDeviceResult<String> {
    let json =
        decode_sentinel_link_payload(input, SENTINEL_REQUEST_HASH_PREFIX, "sentinel-request")?;
    let request: SentinelGenesisRequest =
        serde_json::from_str(&json).map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)?;
    validate_request(&request)?;
    serde_json::to_string(&request).map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)
}

/// Build the return URL a participant sends back to the owner. The signed
/// response remains public ceremony data and is verified against the active
/// session when the owner imports it.
pub fn build_sentinel_genesis_participant_response_link(
    response_json: &str,
    base_url: &str,
) -> MultiDeviceResult<String> {
    let canonical = normalize_sentinel_genesis_participant_payload(response_json)?;
    Ok(build_sentinel_link(
        &canonical,
        base_url,
        SENTINEL_RESPONSE_HASH_PREFIX,
    ))
}

/// Accept a signed session-bound participant response as JSON or as a return URL.
/// Signature and session verification still happen during enrollment.
pub fn normalize_sentinel_genesis_participant_payload(input: &str) -> MultiDeviceResult<String> {
    let json =
        decode_sentinel_link_payload(input, SENTINEL_RESPONSE_HASH_PREFIX, "sentinel-response")?;
    let value: serde_json::Value =
        serde_json::from_str(&json).map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)?;
    if value.get("kind").and_then(serde_json::Value::as_str) == Some(PUBLIC_KEY_ANNOUNCEMENT_KIND) {
        return Err(MultiDeviceError::StandaloneSentinelGenesisAnnouncementRejected);
    }
    let response: SentinelGenesisParticipantResponse = serde_json::from_value(value)
        .map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)?;
    serde_json::to_string(&response).map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)
}

/// Return the validated public fingerprint rendered by participant-pairing UI
/// without requiring the host to inspect the signed domain payload.
pub fn sentinel_genesis_participant_fingerprint(input: &str) -> MultiDeviceResult<String> {
    let trimmed = input.trim();
    if trimmed.starts_with('{') {
        let value: serde_json::Value = serde_json::from_str(trimmed)
            .map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)?;
        if value.get("kind").and_then(serde_json::Value::as_str)
            == Some(PUBLIC_KEY_ANNOUNCEMENT_KIND)
        {
            let announcement: SentinelGenesisPublicKeyAnnouncement = serde_json::from_value(value)
                .map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)?;
            verify_public_key_announcement(&announcement)?;
            return Ok(announcement.fingerprint);
        }
    }
    let canonical = normalize_sentinel_genesis_participant_payload(input)?;
    let response: SentinelGenesisParticipantResponse = serde_json::from_str(&canonical)
        .map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)?;
    Ok(response.participant.fingerprint)
}

fn build_sentinel_link(payload: &str, base_url: &str, hash_prefix: &str) -> String {
    let base = base_url.trim();
    let encoded = URL_SAFE_NO_PAD.encode(payload.as_bytes());
    format!("{base}{hash_prefix}{encoded}")
}

fn decode_sentinel_link_payload(
    input: &str,
    hash_prefix: &str,
    query_key: &str,
) -> MultiDeviceResult<String> {
    let trimmed = input.trim();
    if trimmed.is_empty() || trimmed.len() > MAX_SENTINEL_LINK_PAYLOAD_BYTES {
        return Err(MultiDeviceError::InvalidSentinelGenesisPayload);
    }
    if trimmed.starts_with('{') {
        return Ok(trimmed.to_owned());
    }

    let encoded = extract_link_value(trimmed, hash_prefix, query_key)
        .ok_or(MultiDeviceError::InvalidSentinelGenesisPayload)?;
    let decoded = percent_decode_str(encoded)
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

fn extract_link_value<'a>(input: &'a str, hash_prefix: &str, query_key: &str) -> Option<&'a str> {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::multi_device::DeviceIdentity;
    use crate::auth::sentinel_genesis::{
        add_sentinel_genesis_participant_payload, create_sentinel_genesis_public_key_announcement,
        respond_to_sentinel_genesis_request, start_sentinel_genesis,
    };
    use ed25519_dalek::SigningKey;

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
        let signing = signing_key()?;
        Ok(respond_to_sentinel_genesis_request(
            request,
            &identity,
            &signing,
            label.to_owned(),
        )?)
    }

    #[test]
    fn request_link_round_trips_as_canonical_validated_json() -> anyhow::Result<()> {
        let owner = DeviceIdentity::generate()?;
        let owner_signing = signing_key()?;
        let session = start_sentinel_genesis(&owner, &owner_signing, 3, 2, "Owner".into())?;
        let request_json = serde_json::to_string(&session.request)?;

        let link = build_sentinel_genesis_request_link(&request_json, "https://nook.example/app/")?;
        assert!(link.starts_with("https://nook.example/app/#sentinel-request="));
        assert!(!link.contains(&session.request.session_id.to_string()));
        assert_eq!(normalize_sentinel_genesis_request(&link)?, request_json);
        let mut tampered = session.request.clone();
        tampered.policy.threshold = 3;
        assert!(normalize_sentinel_genesis_request(&serde_json::to_string(&tampered)?).is_err());
        assert!(normalize_sentinel_genesis_request("not-a-request").is_err());
        Ok(())
    }

    #[test]
    fn request_link_preserves_a_canonical_route_without_a_trailing_slash() -> anyhow::Result<()> {
        let owner = DeviceIdentity::generate()?;
        let owner_signing = signing_key()?;
        let session = start_sentinel_genesis(&owner, &owner_signing, 3, 2, "Owner".into())?;
        let request_json = serde_json::to_string(&session.request)?;

        let link =
            build_sentinel_genesis_request_link(&request_json, "https://nook.example/vault")?;

        assert!(link.starts_with("https://nook.example/vault#sentinel-request="));
        assert_eq!(normalize_sentinel_genesis_request(&link)?, request_json);
        Ok(())
    }

    #[test]
    fn participant_response_link_round_trips_and_remains_session_verified() -> anyhow::Result<()> {
        let owner = DeviceIdentity::generate()?;
        let owner_signing = signing_key()?;
        let mut session = start_sentinel_genesis(&owner, &owner_signing, 2, 2, "Owner".into())?;
        let response = participant(&session.request, "Peer")?;
        let response_json = serde_json::to_string(&response)?;

        let link = build_sentinel_genesis_participant_response_link(
            &response_json,
            "https://nook.example/app/",
        )?;
        assert!(link.starts_with("https://nook.example/app/#sentinel-response="));
        assert!(!link.contains(&response.signature));
        let normalized = normalize_sentinel_genesis_participant_payload(&link)?;
        assert_eq!(normalized, response_json);
        add_sentinel_genesis_participant_payload(&mut session, &normalized)?;
        assert!(session.is_complete());
        assert!(normalize_sentinel_genesis_participant_payload("not-a-response").is_err());
        Ok(())
    }

    #[test]
    fn participant_response_link_preserves_a_canonical_route_without_a_trailing_slash()
    -> anyhow::Result<()> {
        let owner = DeviceIdentity::generate()?;
        let owner_signing = signing_key()?;
        let session = start_sentinel_genesis(&owner, &owner_signing, 2, 2, "Owner".into())?;
        let response = participant(&session.request, "Peer")?;
        let response_json = serde_json::to_string(&response)?;

        let link = build_sentinel_genesis_participant_response_link(
            &response_json,
            "https://nook.example/vault",
        )?;

        assert!(link.starts_with("https://nook.example/vault#sentinel-response="));
        assert_eq!(
            normalize_sentinel_genesis_participant_payload(&link)?,
            response_json
        );
        Ok(())
    }

    #[test]
    fn local_announcement_fingerprint_remains_readable_but_not_enrollable() -> anyhow::Result<()> {
        let peer = DeviceIdentity::generate()?;
        let peer_signing = signing_key()?;
        let announcement =
            create_sentinel_genesis_public_key_announcement(&peer, &peer_signing, "Peer".into())?;
        let payload = serde_json::to_string(&announcement)?;
        assert_eq!(
            sentinel_genesis_participant_fingerprint(&payload)?,
            announcement.fingerprint
        );
        let mut tampered = announcement.clone();
        tampered.label = "Mallory".into();
        assert!(matches!(
            sentinel_genesis_participant_fingerprint(&serde_json::to_string(&tampered)?),
            Err(MultiDeviceError::InvalidSentinelGenesisSignature)
        ));
        Ok(())
    }
}

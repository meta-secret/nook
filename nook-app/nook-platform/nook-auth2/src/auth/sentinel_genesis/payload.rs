//! Shared admission of the optional wire discriminator without optional domain state.
use super::PUBLIC_KEY_ANNOUNCEMENT_KIND;
use crate::{MultiDeviceError, MultiDeviceResult};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(from = "String")]
enum SentinelDeclaredKind {
    PublicKeyAnnouncement,
    Unrecognized,
}

impl From<String> for SentinelDeclaredKind {
    fn from(kind: String) -> Self {
        match kind.as_str() {
            PUBLIC_KEY_ANNOUNCEMENT_KIND => Self::PublicKeyAnnouncement,
            _ => Self::Unrecognized,
        }
    }
}

#[derive(Default, Deserialize)]
#[serde(untagged)]
enum SentinelKindDeclaration {
    Declared(SentinelDeclaredKind),
    #[default]
    Unspecified,
}

#[derive(Deserialize)]
pub(super) struct SentinelPayloadHeader {
    #[serde(default)]
    kind: SentinelKindDeclaration,
}

pub(super) enum SentinelPayloadClassification {
    PublicKeyAnnouncement,
    ParticipantResponseCandidate,
}

impl SentinelPayloadHeader {
    pub(super) fn parse(payload: &str) -> MultiDeviceResult<Self> {
        serde_json::from_str(payload).map_err(|_| MultiDeviceError::InvalidSentinelGenesisPayload)
    }

    pub(super) fn classification(self) -> SentinelPayloadClassification {
        match self.kind {
            SentinelKindDeclaration::Declared(SentinelDeclaredKind::PublicKeyAnnouncement) => {
                SentinelPayloadClassification::PublicKeyAnnouncement
            }
            SentinelKindDeclaration::Declared(SentinelDeclaredKind::Unrecognized)
            | SentinelKindDeclaration::Unspecified => {
                SentinelPayloadClassification::ParticipantResponseCandidate
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{SentinelPayloadClassification, SentinelPayloadHeader};

    #[test]
    fn discriminator_retains_wire_admission() -> anyhow::Result<()> {
        for payload in [r#"{}"#, r#"{"kind":null}"#, r#"{"kind":"unknown"}"#] {
            assert!(matches!(
                SentinelPayloadHeader::parse(payload)?.classification(),
                SentinelPayloadClassification::ParticipantResponseCandidate
            ));
        }
        assert!(matches!(
            SentinelPayloadHeader::parse(r#"{"kind":"publicKeyAnnouncement"}"#)?.classification(),
            SentinelPayloadClassification::PublicKeyAnnouncement
        ));
        for payload in [
            r#"{"kind":true}"#,
            r#"{"kind":1}"#,
            r#"{"kind":[]}"#,
            r#"{"kind":{}}"#,
            "null",
        ] {
            assert!(SentinelPayloadHeader::parse(payload).is_err());
        }
        Ok(())
    }
}

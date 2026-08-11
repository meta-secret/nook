//! Queue policy carried by extension-session requests.

use serde::{Deserialize, Deserializer, de::Error as _};
use tsify::Tsify;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
pub enum QueuePriority {
    Probe,
    Interactive,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
pub enum PasskeyCeremonyPriority {
    Interactive,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(
    deny_unknown_fields,
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum QueueDisposition {
    MessageDefault {},
    Deadline {
        #[serde(deserialize_with = "deserialize_finite_f64")]
        expires_at: f64,
        priority: QueuePriority,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Tsify)]
#[serde(deny_unknown_fields, tag = "kind", rename_all = "kebab-case")]
pub enum MessageDefaultQueueDisposition {
    MessageDefault {},
}

#[derive(Debug, Clone, PartialEq, Deserialize, Tsify)]
#[serde(
    deny_unknown_fields,
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum PasskeyCeremonyQueueDisposition {
    Deadline {
        #[serde(deserialize_with = "deserialize_finite_f64")]
        expires_at: f64,
        priority: PasskeyCeremonyPriority,
    },
}

pub(super) fn deserialize_finite_f64<'de, D>(deserializer: D) -> Result<f64, D::Error>
where
    D: Deserializer<'de>,
{
    let value = f64::deserialize(deserializer)?;
    if value.is_finite() {
        Ok(value)
    } else {
        Err(D::Error::custom("queue expiry must be finite"))
    }
}

#[cfg(test)]
mod tests {
    use super::{MessageDefaultQueueDisposition, QueueDisposition};

    #[test]
    fn queue_variants_reject_foreign_fields() {
        for contradictory_queue in [
            r#"{"kind":"message-default","expiresAt":42,"priority":"interactive"}"#,
            r#"{"kind":"deadline","expiresAt":42,"priority":"interactive","probe":true}"#,
        ] {
            assert!(serde_json::from_str::<QueueDisposition>(contradictory_queue).is_err());
        }
        assert!(
            serde_json::from_str::<MessageDefaultQueueDisposition>(
                r#"{"kind":"deadline","expiresAt":42,"priority":"interactive"}"#,
            )
            .is_err()
        );
    }
}

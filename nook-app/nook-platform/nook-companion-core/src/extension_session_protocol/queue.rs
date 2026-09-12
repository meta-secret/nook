//! Queue policy carried by extension-session requests.

use serde::Deserialize;
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
        expires_at: QueueExpiryMilliseconds,
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
        expires_at: QueueExpiryMilliseconds,
        priority: PasskeyCeremonyPriority,
    },
}

/// Finite browser deadline; fractional and negative timestamps remain wire-valid.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize, serde::Serialize, Tsify)]
#[serde(try_from = "f64")]
#[tsify(type = "number")]
pub struct QueueExpiryMilliseconds(f64);

impl TryFrom<f64> for QueueExpiryMilliseconds {
    type Error = &'static str;
    #[cfg_attr(
        dylint_lib = "nook_domain_api",
        expect(
            raw_numeric_public_api,
            reason = "serialization boundary: admits a finite JavaScript queue deadline without changing its numeric value"
        )
    )]
    fn try_from(value: f64) -> Result<Self, Self::Error> {
        if value.is_finite() {
            Ok(Self(value))
        } else {
            Err("queue expiry must be finite")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{MessageDefaultQueueDisposition, QueueDisposition};

    #[test]
    fn deadline_admission_preserves_finite_values_without_rounding() -> anyhow::Result<()> {
        for value in [-42.5, 0.0, 42.5] {
            let deadline =
                super::QueueExpiryMilliseconds::try_from(value).map_err(anyhow::Error::msg)?;
            assert_eq!(serde_json::to_value(deadline)?, serde_json::json!(value));
            assert_eq!(
                serde_json::from_value::<super::QueueExpiryMilliseconds>(serde_json::json!(value))?,
                deadline
            );
        }
        for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            assert!(super::QueueExpiryMilliseconds::try_from(value).is_err());
        }
        Ok(())
    }

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

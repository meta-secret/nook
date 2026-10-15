use super::ExtensionPairingStateError;
use serde::de::Error as DeError;
use serde::{Deserialize, Serialize};
use tsify::Tsify;

const MAX_SAFE_INTEGER_MILLISECONDS: u64 = 9_007_199_254_740_991;
const MAX_SAFE_INTEGER_MILLISECONDS_NUMBER: f64 = 9_007_199_254_740_991.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "number")]
pub struct ExtensionPairingApprovalEpochMilliseconds(u64);

impl ExtensionPairingApprovalEpochMilliseconds {
    pub const MINIMUM: Self = Self(1);

    fn parse(value: f64) -> Result<Self, ExtensionPairingStateError> {
        if !value.is_finite()
            || value <= 0.0
            || value.fract() != 0.0
            || value > MAX_SAFE_INTEGER_MILLISECONDS_NUMBER
        {
            return Err(ExtensionPairingStateError::InvalidGrant);
        }
        let value = format!("{value:.0}")
            .parse::<u64>()
            .map_err(|_| ExtensionPairingStateError::InvalidGrant)?;
        Self::from_unix_milliseconds(value)
    }

    pub fn validate(self) -> Result<(), ExtensionPairingStateError> {
        if self.0 == 0 || self.0 > MAX_SAFE_INTEGER_MILLISECONDS {
            return Err(ExtensionPairingStateError::InvalidGrant);
        }
        Ok(())
    }

    fn from_unix_milliseconds(value: u64) -> Result<Self, ExtensionPairingStateError> {
        let timestamp = Self(value);
        timestamp.validate()?;
        Ok(timestamp)
    }
}

impl<'de> Deserialize<'de> for ExtensionPairingApprovalEpochMilliseconds {
    fn deserialize<Deserializer>(deserializer: Deserializer) -> Result<Self, Deserializer::Error>
    where
        Deserializer: serde::Deserializer<'de>,
    {
        Self::parse(f64::deserialize(deserializer)?).map_err(DeError::custom)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cmp::Ordering;

    #[test]
    fn approval_timestamp_has_total_equality_and_ordering() -> anyhow::Result<()> {
        let earlier = ExtensionPairingApprovalEpochMilliseconds::parse(1_784_937_600_000.0)?;
        let same = ExtensionPairingApprovalEpochMilliseconds::parse(1_784_937_600_000.0)?;
        let later = ExtensionPairingApprovalEpochMilliseconds::parse(1_784_937_600_001.0)?;

        assert_eq!(earlier, same);
        assert_eq!(earlier.cmp(&same), Ordering::Equal);
        assert_eq!(earlier.cmp(&later), Ordering::Less);
        assert_eq!(later.cmp(&earlier), Ordering::Greater);
        Ok(())
    }

    #[test]
    fn approval_timestamp_preserves_numeric_wire_with_exact_integer_precision() -> anyhow::Result<()>
    {
        let timestamp = ExtensionPairingApprovalEpochMilliseconds::parse(9_007_199_254_740_991.0)?;

        assert_eq!(timestamp.0, 9_007_199_254_740_991);
        assert_eq!(serde_json::to_string(&timestamp)?, "9007199254740991");
        let decoded: ExtensionPairingApprovalEpochMilliseconds =
            serde_json::from_str("9007199254740991")?;
        assert_eq!(decoded, timestamp);
        assert_eq!(decoded.0, 9_007_199_254_740_991);
        Ok(())
    }

    #[test]
    fn approval_timestamp_rejects_invalid_or_unsafe_numeric_milliseconds() {
        for value in [
            f64::NAN,
            f64::INFINITY,
            f64::NEG_INFINITY,
            -1.0,
            0.0,
            1.5,
            9_007_199_254_740_992.0,
        ] {
            assert!(ExtensionPairingApprovalEpochMilliseconds::parse(value).is_err());
        }
    }

    #[test]
    fn approval_timestamp_rejects_string_wire() {
        assert!(
            serde_json::from_str::<ExtensionPairingApprovalEpochMilliseconds>(
                r#""2026-07-25T00:00:00.000Z""#
            )
            .is_err()
        );
    }
}

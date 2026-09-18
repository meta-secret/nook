use super::ExtensionPairingStateError;
use serde::de::Error as DeError;
use serde::{Deserialize, Serialize};
use std::ops::Range;
use tsify::Tsify;

const MAX_SAFE_INTEGER_MILLISECONDS: u64 = 9_007_199_254_740_991;
const MAX_SAFE_INTEGER_MILLISECONDS_NUMBER: f64 = 9_007_199_254_740_991.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Tsify)]
#[serde(transparent)]
#[tsify(type = "number", into_wasm_abi, from_wasm_abi)]
pub struct ExtensionPairingApprovalEpochMilliseconds(u64);

#[derive(Deserialize)]
#[serde(untagged)]
enum ExtensionPairingApprovalTimestampWire {
    UnixMilliseconds(f64),
    LegacyDateToIsoString(String),
}

struct LegacyDateToIsoStringTimestamp<'a>(&'a str);

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

    pub(crate) fn from_legacy_date_to_iso_string(
        value: &str,
    ) -> Result<Self, ExtensionPairingStateError> {
        let milliseconds = LegacyDateToIsoStringTimestamp(value).unix_milliseconds()?;
        let milliseconds =
            u64::try_from(milliseconds).map_err(|_| ExtensionPairingStateError::InvalidGrant)?;
        Self::from_unix_milliseconds(milliseconds)
    }
}

impl LegacyDateToIsoStringTimestamp<'_> {
    fn unix_milliseconds(&self) -> Result<i64, ExtensionPairingStateError> {
        let value = self.0;
        let bytes = value.as_bytes();
        if bytes.len() != 24
            || bytes.get(4) != Some(&b'-')
            || bytes.get(7) != Some(&b'-')
            || bytes.get(10) != Some(&b'T')
            || bytes.get(13) != Some(&b':')
            || bytes.get(16) != Some(&b':')
            || bytes.get(19) != Some(&b'.')
            || bytes.get(23) != Some(&b'Z')
        {
            return Err(ExtensionPairingStateError::InvalidGrant);
        }
        let field =
            |range: Range<usize>| value.get(range).and_then(|part| part.parse::<i64>().ok());
        let fields = (
            field(0..4),
            field(5..7),
            field(8..10),
            field(11..13),
            field(14..16),
            field(17..19),
            field(20..23),
        );
        let (
            Some(year),
            Some(month),
            Some(day),
            Some(hour),
            Some(minute),
            Some(second),
            Some(milliseconds),
        ) = fields
        else {
            return Err(ExtensionPairingStateError::InvalidGrant);
        };
        if !(1..=12).contains(&month)
            || !(1..=Self::days_in_month(year, month)).contains(&day)
            || !(0..=23).contains(&hour)
            || !(0..=59).contains(&minute)
            || !(0..=59).contains(&second)
        {
            return Err(ExtensionPairingStateError::InvalidGrant);
        }
        let adjusted_year = year - i64::from(month <= 2);
        let era = adjusted_year.div_euclid(400);
        let year_of_era = adjusted_year - era * 400;
        let adjusted_month = month + if month > 2 { -3 } else { 9 };
        let day_of_year = (153 * adjusted_month + 2) / 5 + day - 1;
        let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
        let days_since_epoch = era * 146_097 + day_of_era - 719_468;
        Ok(
            (days_since_epoch * 86_400 + hour * 3_600 + minute * 60 + second) * 1_000
                + milliseconds,
        )
    }

    fn days_in_month(year: i64, month: i64) -> i64 {
        match month {
            2 if year.rem_euclid(4) == 0
                && (year.rem_euclid(100) != 0 || year.rem_euclid(400) == 0) =>
            {
                29
            }
            2 => 28,
            4 | 6 | 9 | 11 => 30,
            _ => 31,
        }
    }
}

impl<'de> Deserialize<'de> for ExtensionPairingApprovalEpochMilliseconds {
    fn deserialize<Deserializer>(deserializer: Deserializer) -> Result<Self, Deserializer::Error>
    where
        Deserializer: serde::Deserializer<'de>,
    {
        let wire = ExtensionPairingApprovalTimestampWire::deserialize(deserializer)?;
        match wire {
            ExtensionPairingApprovalTimestampWire::UnixMilliseconds(value) => {
                Self::parse(value).map_err(DeError::custom)
            }
            ExtensionPairingApprovalTimestampWire::LegacyDateToIsoString(value) => {
                Self::from_legacy_date_to_iso_string(&value).map_err(DeError::custom)
            }
        }
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
    fn exact_legacy_date_to_iso_string_value_converts_to_unix_milliseconds() -> anyhow::Result<()> {
        let decoded: ExtensionPairingApprovalEpochMilliseconds =
            serde_json::from_str(r#""2026-07-25T00:00:00.000Z""#)?;
        assert_eq!(decoded.0, 1_784_937_600_000);
        Ok(())
    }

    #[test]
    fn legacy_compatibility_rejects_invalid_calendar_and_noncanonical_shapes() {
        for value in [
            r#""2026-02-31T00:00:00.000Z""#,
            r#""2026-07-25T00:00:00Z""#,
            r#""2026-07-25T00:00:00.000+00:00""#,
        ] {
            assert!(
                serde_json::from_str::<ExtensionPairingApprovalEpochMilliseconds>(value).is_err()
            );
        }
    }
}

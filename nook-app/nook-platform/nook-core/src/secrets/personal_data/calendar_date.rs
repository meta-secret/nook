//! ISO 8601 calendar dates (`YYYY-MM-DD`) used by personal-data payloads.

use std::fmt;
use std::str::FromStr;

/// A real Gregorian calendar date written as `YYYY-MM-DD`.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct CalendarDate {
    year: u16,
    month: u8,
    day: u8,
}

/// The text is not an ISO `YYYY-MM-DD` date that exists in the calendar.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("expected a real calendar date written as YYYY-MM-DD")]
pub struct CalendarDateError;

/// Whether February has 29 days in a year.
enum YearLength {
    Common,
    Leap,
}

impl YearLength {
    fn of(year: u16) -> Self {
        match (year % 4, year % 100, year % 400) {
            (_, _, 0) => Self::Leap,
            (_, 0, _) => Self::Common,
            (0, _, _) => Self::Leap,
            _ => Self::Common,
        }
    }
}

impl CalendarDate {
    /// Parse a strict ISO `YYYY-MM-DD` date and verify that the day exists.
    pub fn parse(raw: &str) -> Result<Self, CalendarDateError> {
        let mut parts = raw.split('-');
        let (Some(year), Some(month), Some(day), None) =
            (parts.next(), parts.next(), parts.next(), parts.next())
        else {
            return Err(CalendarDateError);
        };
        let year = CalendarDate::component::<u16>(year, 4)?;
        let month = CalendarDate::component::<u8>(month, 2)?;
        let day = CalendarDate::component::<u8>(day, 2)?;
        let last_day = match month {
            1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
            4 | 6 | 9 | 11 => 30,
            2 => match YearLength::of(year) {
                YearLength::Common => 28,
                YearLength::Leap => 29,
            },
            _ => return Err(CalendarDateError),
        };
        match (year, day) {
            (0, _) | (_, 0) => Err(CalendarDateError),
            (_, day) if day > last_day => Err(CalendarDateError),
            _ => Ok(Self { year, month, day }),
        }
    }

    fn component<T: FromStr>(digits: &str, width: usize) -> Result<T, CalendarDateError> {
        match (
            digits.len() == width,
            digits.bytes().all(|byte| byte.is_ascii_digit()),
        ) {
            (true, true) => digits.parse().map_err(|_| CalendarDateError),
            _ => Err(CalendarDateError),
        }
    }
}

/// An optional date field: blank, or a valid calendar date.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum DateEntry {
    Unset,
    Date(CalendarDate),
}

impl DateEntry {
    /// Trim the field; blank means unset, anything else must be a real date.
    pub(super) fn parse(raw: &str) -> Result<Self, CalendarDateError> {
        match raw.trim() {
            "" => Ok(Self::Unset),
            text => CalendarDate::parse(text).map(Self::Date),
        }
    }

    /// Canonical stored text: empty when unset, otherwise `YYYY-MM-DD`.
    pub(super) fn into_string(self) -> String {
        match self {
            Self::Unset => String::new(),
            Self::Date(date) => date.to_string(),
        }
    }
}

impl fmt::Display for CalendarDate {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let Self { year, month, day } = self;
        write!(formatter, "{year:04}-{month:02}-{day:02}")
    }
}

impl fmt::Debug for CalendarDate {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("CalendarDate([REDACTED])")
    }
}

#[cfg(test)]
mod tests {
    use super::{CalendarDate, CalendarDateError, DateEntry};

    #[test]
    fn accepts_real_dates_including_leap_days() -> anyhow::Result<()> {
        for raw in ["1990-01-31", "2000-02-29", "2024-02-29", "1815-12-10"] {
            assert_eq!(CalendarDate::parse(raw)?.to_string(), raw);
        }
        Ok(())
    }

    #[test]
    fn rejects_impossible_or_non_iso_dates() {
        for raw in [
            "1900-02-29",
            "2023-02-29",
            "2024-04-31",
            "2024-13-01",
            "2024-00-10",
            "2024-01-00",
            "0000-01-01",
            "24-01-01",
            "2024-1-01",
            "2024/01/01",
            "2024-01-01-01",
            "2024-01-01T00:00",
            "２０２４-01-01",
            "",
        ] {
            assert_eq!(CalendarDate::parse(raw), Err(CalendarDateError), "{raw}");
        }
    }

    #[test]
    fn date_entry_treats_blank_as_unset_and_trims_dates() -> anyhow::Result<()> {
        assert!(DateEntry::parse("  ")? == DateEntry::Unset);
        assert_eq!(
            DateEntry::parse(" 2030-06-01 ")?.into_string(),
            "2030-06-01"
        );
        assert_eq!(DateEntry::parse("").map(DateEntry::into_string)?, "");
        assert!(DateEntry::parse("2030-06-31").is_err());
        Ok(())
    }

    #[test]
    fn orders_chronologically_and_redacts_debug() -> anyhow::Result<()> {
        let earlier = CalendarDate::parse("2020-12-31")?;
        let later = CalendarDate::parse("2021-01-01")?;
        assert!(earlier < later);
        assert_eq!(format!("{later:?}"), "CalendarDate([REDACTED])");
        Ok(())
    }
}

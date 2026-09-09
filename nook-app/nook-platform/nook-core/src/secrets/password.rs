use getrandom;
use serde::{Deserialize, Serialize};
use tsify::Tsify;

use crate::PasswordCharacterCount;
use crate::errors::{PasswordError, PasswordResult};

const LOWERCASE: &str = "abcdefghijklmnopqrstuvwxyz";
const UPPERCASE: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const NUMBERS: &str = "0123456789";
const SYMBOLS: &str = "!@#$%^&*()_+-=[]{}|;:,.<>?";

pub const MIN_PASSWORD_LENGTH: PasswordCharacterCount = PasswordCharacterCount::RECOMMENDED_MINIMUM;
pub const MAX_PASSWORD_LENGTH: PasswordCharacterCount = PasswordCharacterCount::GENERATOR_MAXIMUM;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct PasswordGenerationOptions {
    #[tsify(type = "number")]
    pub length: PasswordCharacterCount,
    pub lowercase: PasswordCharacterSet,
    pub uppercase: PasswordCharacterSet,
    pub numbers: PasswordCharacterSet,
    pub symbols: PasswordCharacterSet,
}

/// Whether a named password alphabet participates in generation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum PasswordCharacterSet {
    Included,
    Excluded,
}

/// A validated alphabet and length. Only validated options can construct it.
pub struct PasswordGeneration {
    charset: String,
    length: PasswordCharacterCount,
}

impl Default for PasswordGenerationOptions {
    fn default() -> Self {
        Self {
            length: 20.into(),
            lowercase: PasswordCharacterSet::Included,
            uppercase: PasswordCharacterSet::Included,
            numbers: PasswordCharacterSet::Included,
            symbols: PasswordCharacterSet::Included,
        }
    }
}

impl PasswordGenerationOptions {
    pub fn validate(self) -> PasswordResult<PasswordGeneration> {
        if !(usize::from(MIN_PASSWORD_LENGTH)..=usize::from(MAX_PASSWORD_LENGTH))
            .contains(&usize::from(self.length))
        {
            return Err(PasswordError::LengthOutOfRange {
                min: MIN_PASSWORD_LENGTH,
                max: MAX_PASSWORD_LENGTH,
            });
        }
        if [self.lowercase, self.uppercase, self.numbers, self.symbols]
            .iter()
            .all(|selection| matches!(selection, PasswordCharacterSet::Excluded))
        {
            return Err(PasswordError::NoCharacterSet);
        }
        Ok(PasswordGeneration {
            charset: self.charset(),
            length: self.length,
        })
    }

    pub fn generate(self) -> PasswordResult<String> {
        self.validate()?.generate()
    }

    fn charset(self) -> String {
        let mut chars = String::new();
        if matches!(self.lowercase, PasswordCharacterSet::Included) {
            chars.push_str(LOWERCASE);
        }
        if matches!(self.uppercase, PasswordCharacterSet::Included) {
            chars.push_str(UPPERCASE);
        }
        if matches!(self.numbers, PasswordCharacterSet::Included) {
            chars.push_str(NUMBERS);
        }
        if matches!(self.symbols, PasswordCharacterSet::Included) {
            chars.push_str(SYMBOLS);
        }
        chars
    }
}

impl PasswordGeneration {
    pub fn generate(self) -> PasswordResult<String> {
        let charset_bytes = self.charset.as_bytes();
        let password_length = usize::from(self.length);
        let mut random = vec![0u8; password_length * 4];
        getrandom::fill(&mut random).map_err(|e| PasswordError::RandomBytes(e.to_string()))?;

        let mut password = String::with_capacity(password_length);
        for chunk in random.chunks(4) {
            if password.len() >= password_length {
                break;
            }
            let n = u32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]) as usize;
            let idx = n % charset_bytes.len();
            password.push(charset_bytes[idx] as char);
        }

        password.truncate(password_length);
        Ok(password)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secure_defaults_preserve_numeric_json() -> anyhow::Result<()> {
        let options = PasswordGenerationOptions::default();
        assert_eq!(
            options,
            PasswordGenerationOptions {
                length: 20.into(),
                lowercase: PasswordCharacterSet::Included,
                uppercase: PasswordCharacterSet::Included,
                numbers: PasswordCharacterSet::Included,
                symbols: PasswordCharacterSet::Included,
            }
        );
        let encoded = serde_json::to_string(&options)?;
        assert_eq!(
            encoded,
            r#"{"length":20,"lowercase":"Included","uppercase":"Included","numbers":"Included","symbols":"Included"}"#
        );
        assert_eq!(
            serde_json::from_str::<PasswordGenerationOptions>(&encoded)?,
            options
        );
        Ok(())
    }

    #[test]
    fn generates_password_with_requested_length() -> anyhow::Result<()> {
        let password = PasswordGenerationOptions::generate(PasswordGenerationOptions {
            length: 24.into(),
            lowercase: PasswordCharacterSet::Included,
            uppercase: PasswordCharacterSet::Included,
            numbers: PasswordCharacterSet::Included,
            symbols: PasswordCharacterSet::Excluded,
        })?;
        assert_eq!(password.len(), 24);
        Ok(())
    }

    #[test]
    fn rejects_empty_charset() -> anyhow::Result<()> {
        let err = PasswordGenerationOptions::generate(PasswordGenerationOptions {
            length: 16.into(),
            lowercase: PasswordCharacterSet::Excluded,
            uppercase: PasswordCharacterSet::Excluded,
            numbers: PasswordCharacterSet::Excluded,
            symbols: PasswordCharacterSet::Excluded,
        })
        .err()
        .ok_or_else(|| anyhow::anyhow!("password test should reject invalid input"))?;
        assert!(err.to_string().contains("at least one character set"));
        Ok(())
    }

    #[test]
    fn rejects_invalid_length() -> anyhow::Result<()> {
        let err = PasswordGenerationOptions::generate(PasswordGenerationOptions {
            length: 4.into(),
            lowercase: PasswordCharacterSet::Included,
            uppercase: PasswordCharacterSet::Excluded,
            numbers: PasswordCharacterSet::Excluded,
            symbols: PasswordCharacterSet::Excluded,
        })
        .err()
        .ok_or_else(|| anyhow::anyhow!("password test should reject invalid input"))?;
        assert!(err.to_string().contains("between 8 and 128"));
        Ok(())
    }

    #[test]
    fn uses_only_selected_charsets() -> anyhow::Result<()> {
        let password = PasswordGenerationOptions::generate(PasswordGenerationOptions {
            length: 32.into(),
            lowercase: PasswordCharacterSet::Included,
            uppercase: PasswordCharacterSet::Excluded,
            numbers: PasswordCharacterSet::Included,
            symbols: PasswordCharacterSet::Excluded,
        })?;
        assert!(
            password
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        );
        Ok(())
    }

    #[test]
    fn accepts_min_and_max_length() -> anyhow::Result<()> {
        let min = PasswordGenerationOptions::generate(PasswordGenerationOptions {
            length: MIN_PASSWORD_LENGTH,
            lowercase: PasswordCharacterSet::Included,
            uppercase: PasswordCharacterSet::Excluded,
            numbers: PasswordCharacterSet::Excluded,
            symbols: PasswordCharacterSet::Excluded,
        })?;
        assert_eq!(min.len(), usize::from(MIN_PASSWORD_LENGTH));

        let max = PasswordGenerationOptions::generate(PasswordGenerationOptions {
            length: MAX_PASSWORD_LENGTH,
            lowercase: PasswordCharacterSet::Included,
            uppercase: PasswordCharacterSet::Excluded,
            numbers: PasswordCharacterSet::Excluded,
            symbols: PasswordCharacterSet::Excluded,
        })?;
        assert_eq!(max.len(), usize::from(MAX_PASSWORD_LENGTH));
        Ok(())
    }

    #[test]
    fn rejects_length_above_max() -> anyhow::Result<()> {
        let err = PasswordGenerationOptions::generate(PasswordGenerationOptions {
            length: (usize::from(MAX_PASSWORD_LENGTH) + 1).into(),
            lowercase: PasswordCharacterSet::Included,
            uppercase: PasswordCharacterSet::Excluded,
            numbers: PasswordCharacterSet::Excluded,
            symbols: PasswordCharacterSet::Excluded,
        })
        .err()
        .ok_or_else(|| anyhow::anyhow!("password test should reject invalid input"))?;
        assert!(err.to_string().contains("between 8 and 128"));
        Ok(())
    }

    #[test]
    fn symbols_only_charset() -> anyhow::Result<()> {
        let password = PasswordGenerationOptions::generate(PasswordGenerationOptions {
            length: 16.into(),
            lowercase: PasswordCharacterSet::Excluded,
            uppercase: PasswordCharacterSet::Excluded,
            numbers: PasswordCharacterSet::Excluded,
            symbols: PasswordCharacterSet::Included,
        })?;
        assert!(password.chars().all(|c| SYMBOLS.contains(c)));
        Ok(())
    }
}

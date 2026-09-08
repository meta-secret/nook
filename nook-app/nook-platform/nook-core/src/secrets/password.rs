#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]

use getrandom::fill;
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
#[allow(clippy::struct_excessive_bools)]
pub struct PasswordGenerationOptions {
    #[tsify(type = "number")]
    pub length: PasswordCharacterCount,
    pub lowercase: bool,
    pub uppercase: bool,
    pub numbers: bool,
    pub symbols: bool,
}

impl Default for PasswordGenerationOptions {
    fn default() -> Self {
        Self {
            length: 20.into(),
            lowercase: true,
            uppercase: true,
            numbers: true,
            symbols: true,
        }
    }
}

impl PasswordGenerationOptions {
    pub fn validate(self) -> PasswordResult<()> {
        if !(usize::from(MIN_PASSWORD_LENGTH)..=usize::from(MAX_PASSWORD_LENGTH))
            .contains(&usize::from(self.length))
        {
            return Err(PasswordError::LengthOutOfRange {
                min: MIN_PASSWORD_LENGTH,
                max: MAX_PASSWORD_LENGTH,
            });
        }
        if !self.lowercase && !self.uppercase && !self.numbers && !self.symbols {
            return Err(PasswordError::NoCharacterSet);
        }
        Ok(())
    }

    fn charset(self) -> String {
        let mut chars = String::new();
        if self.lowercase {
            chars.push_str(LOWERCASE);
        }
        if self.uppercase {
            chars.push_str(UPPERCASE);
        }
        if self.numbers {
            chars.push_str(NUMBERS);
        }
        if self.symbols {
            chars.push_str(SYMBOLS);
        }
        chars
    }

    pub fn generate(self) -> PasswordResult<String> {
        self.validate()?;
        let charset = self.charset();
        let charset_bytes = charset.as_bytes();
        let password_length = usize::from(self.length);
        let mut random = vec![0u8; password_length * 4];
        fill(&mut random).map_err(|e| PasswordError::RandomBytes(e.to_string()))?;

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
                lowercase: true,
                uppercase: true,
                numbers: true,
                symbols: true,
            }
        );
        let encoded = serde_json::to_string(&options)?;
        assert_eq!(
            encoded,
            r#"{"length":20,"lowercase":true,"uppercase":true,"numbers":true,"symbols":true}"#
        );
        assert_eq!(
            serde_json::from_str::<PasswordGenerationOptions>(&encoded)?,
            options
        );
        Ok(())
    }

    #[test]
    fn generates_password_with_requested_length() -> anyhow::Result<()> {
        let password = PasswordGenerationOptions {
            length: 24.into(),
            lowercase: true,
            uppercase: true,
            numbers: true,
            symbols: false,
        }
        .generate()?;
        assert_eq!(password.len(), 24);
        Ok(())
    }

    #[test]
    fn rejects_empty_charset() -> anyhow::Result<()> {
        let err = PasswordGenerationOptions {
            length: 16.into(),
            lowercase: false,
            uppercase: false,
            numbers: false,
            symbols: false,
        }
        .generate()
        .err()
        .ok_or_else(|| anyhow::anyhow!("password test should reject invalid input"))?;
        assert!(err.to_string().contains("at least one character set"));
        Ok(())
    }

    #[test]
    fn rejects_invalid_length() -> anyhow::Result<()> {
        let err = PasswordGenerationOptions {
            length: 4.into(),
            lowercase: true,
            uppercase: false,
            numbers: false,
            symbols: false,
        }
        .generate()
        .err()
        .ok_or_else(|| anyhow::anyhow!("password test should reject invalid input"))?;
        assert!(err.to_string().contains("between 8 and 128"));
        Ok(())
    }

    #[test]
    fn uses_only_selected_charsets() -> anyhow::Result<()> {
        let password = PasswordGenerationOptions {
            length: 32.into(),
            lowercase: true,
            uppercase: false,
            numbers: true,
            symbols: false,
        }
        .generate()?;
        assert!(
            password
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        );
        Ok(())
    }

    #[test]
    fn accepts_min_and_max_length() -> anyhow::Result<()> {
        let min = PasswordGenerationOptions {
            length: MIN_PASSWORD_LENGTH,
            lowercase: true,
            uppercase: false,
            numbers: false,
            symbols: false,
        }
        .generate()?;
        assert_eq!(min.len(), usize::from(MIN_PASSWORD_LENGTH));

        let max = PasswordGenerationOptions {
            length: MAX_PASSWORD_LENGTH,
            lowercase: true,
            uppercase: false,
            numbers: false,
            symbols: false,
        }
        .generate()?;
        assert_eq!(max.len(), usize::from(MAX_PASSWORD_LENGTH));
        Ok(())
    }

    #[test]
    fn rejects_length_above_max() -> anyhow::Result<()> {
        let err = PasswordGenerationOptions {
            length: (usize::from(MAX_PASSWORD_LENGTH) + 1).into(),
            lowercase: true,
            uppercase: false,
            numbers: false,
            symbols: false,
        }
        .generate()
        .err()
        .ok_or_else(|| anyhow::anyhow!("password test should reject invalid input"))?;
        assert!(err.to_string().contains("between 8 and 128"));
        Ok(())
    }

    #[test]
    fn symbols_only_charset() -> anyhow::Result<()> {
        let password = PasswordGenerationOptions {
            length: 16.into(),
            lowercase: false,
            uppercase: false,
            numbers: false,
            symbols: true,
        }
        .generate()?;
        assert!(password.chars().all(|c| SYMBOLS.contains(c)));
        Ok(())
    }
}

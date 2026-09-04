use getrandom::fill;
use serde::{Deserialize, Serialize};
use tsify::Tsify;

use crate::errors::{PasswordError, PasswordResult};

const LOWERCASE: &str = "abcdefghijklmnopqrstuvwxyz";
const UPPERCASE: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const NUMBERS: &str = "0123456789";
const SYMBOLS: &str = "!@#$%^&*()_+-=[]{}|;:,.<>?";

pub const MIN_PASSWORD_LENGTH: u32 = 8;
pub const MAX_PASSWORD_LENGTH: u32 = 128;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
#[allow(clippy::struct_excessive_bools)]
pub struct PasswordGenerationOptions {
    pub length: u32,
    pub lowercase: bool,
    pub uppercase: bool,
    pub numbers: bool,
    pub symbols: bool,
}

impl Default for PasswordGenerationOptions {
    fn default() -> Self {
        Self {
            length: 20,
            lowercase: true,
            uppercase: true,
            numbers: true,
            symbols: true,
        }
    }
}

impl PasswordGenerationOptions {
    pub fn validate(self) -> PasswordResult<()> {
        if !(MIN_PASSWORD_LENGTH..=MAX_PASSWORD_LENGTH).contains(&self.length) {
            return Err(PasswordError::LengthOutOfRange {
                min: usize::try_from(MIN_PASSWORD_LENGTH)
                    .unwrap_or(usize::MAX)
                    .into(),
                max: usize::try_from(MAX_PASSWORD_LENGTH)
                    .unwrap_or(usize::MAX)
                    .into(),
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
}

pub fn generate_password(options: PasswordGenerationOptions) -> PasswordResult<String> {
    options.validate()?;
    let charset = options.charset();
    let charset_bytes = charset.as_bytes();
    let password_length = options.length as usize;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secure_defaults_are_owned_by_the_domain() {
        assert_eq!(
            PasswordGenerationOptions::default(),
            PasswordGenerationOptions {
                length: 20,
                lowercase: true,
                uppercase: true,
                numbers: true,
                symbols: true,
            }
        );
    }

    #[test]
    fn generates_password_with_requested_length() -> anyhow::Result<()> {
        let password = generate_password(PasswordGenerationOptions {
            length: 24,
            lowercase: true,
            uppercase: true,
            numbers: true,
            symbols: false,
        })?;
        assert_eq!(password.len(), 24);
        Ok(())
    }

    #[test]
    fn rejects_empty_charset() -> anyhow::Result<()> {
        let err = generate_password(PasswordGenerationOptions {
            length: 16,
            lowercase: false,
            uppercase: false,
            numbers: false,
            symbols: false,
        })
        .err()
        .ok_or_else(|| anyhow::anyhow!("password test should reject invalid input"))?;
        assert!(err.to_string().contains("at least one character set"));
        Ok(())
    }

    #[test]
    fn rejects_invalid_length() -> anyhow::Result<()> {
        let err = generate_password(PasswordGenerationOptions {
            length: 4,
            lowercase: true,
            uppercase: false,
            numbers: false,
            symbols: false,
        })
        .err()
        .ok_or_else(|| anyhow::anyhow!("password test should reject invalid input"))?;
        assert!(err.to_string().contains("between 8 and 128"));
        Ok(())
    }

    #[test]
    fn uses_only_selected_charsets() -> anyhow::Result<()> {
        let password = generate_password(PasswordGenerationOptions {
            length: 32,
            lowercase: true,
            uppercase: false,
            numbers: true,
            symbols: false,
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
        let min = generate_password(PasswordGenerationOptions {
            length: MIN_PASSWORD_LENGTH,
            lowercase: true,
            uppercase: false,
            numbers: false,
            symbols: false,
        })?;
        assert_eq!(min.len(), MIN_PASSWORD_LENGTH as usize);

        let max = generate_password(PasswordGenerationOptions {
            length: MAX_PASSWORD_LENGTH,
            lowercase: true,
            uppercase: false,
            numbers: false,
            symbols: false,
        })?;
        assert_eq!(max.len(), MAX_PASSWORD_LENGTH as usize);
        Ok(())
    }

    #[test]
    fn rejects_length_above_max() -> anyhow::Result<()> {
        let err = generate_password(PasswordGenerationOptions {
            length: MAX_PASSWORD_LENGTH + 1,
            lowercase: true,
            uppercase: false,
            numbers: false,
            symbols: false,
        })
        .err()
        .ok_or_else(|| anyhow::anyhow!("password test should reject invalid input"))?;
        assert!(err.to_string().contains("between 8 and 128"));
        Ok(())
    }

    #[test]
    fn symbols_only_charset() -> anyhow::Result<()> {
        let password = generate_password(PasswordGenerationOptions {
            length: 16,
            lowercase: false,
            uppercase: false,
            numbers: false,
            symbols: true,
        })?;
        assert!(password.chars().all(|c| SYMBOLS.contains(c)));
        Ok(())
    }
}

use getrandom::getrandom;

const LOWERCASE: &str = "abcdefghijklmnopqrstuvwxyz";
const UPPERCASE: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const NUMBERS: &str = "0123456789";
const SYMBOLS: &str = "!@#$%^&*()_+-=[]{}|;:,.<>?";

pub const MIN_PASSWORD_LENGTH: usize = 8;
pub const MAX_PASSWORD_LENGTH: usize = 128;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PasswordOptions {
    pub length: usize,
    pub lowercase: bool,
    pub uppercase: bool,
    pub numbers: bool,
    pub symbols: bool,
}

impl PasswordOptions {
    pub fn validate(&self) -> Result<(), String> {
        if self.length < MIN_PASSWORD_LENGTH || self.length > MAX_PASSWORD_LENGTH {
            return Err(format!(
                "Password length must be between {MIN_PASSWORD_LENGTH} and {MAX_PASSWORD_LENGTH}."
            ));
        }
        if !self.lowercase && !self.uppercase && !self.numbers && !self.symbols {
            return Err("Select at least one character set.".to_owned());
        }
        Ok(())
    }

    fn charset(&self) -> String {
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

pub fn generate_password(options: &PasswordOptions) -> Result<String, String> {
    options.validate()?;
    let charset = options.charset();
    let charset_bytes = charset.as_bytes();
    let mut random = vec![0u8; options.length * 4];
    getrandom(&mut random).map_err(|e| format!("Failed to generate random bytes: {e}"))?;

    let mut password = String::with_capacity(options.length);
    for chunk in random.chunks(4) {
        if password.len() >= options.length {
            break;
        }
        let n = u32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]) as usize;
        let idx = n % charset_bytes.len();
        password.push(charset_bytes[idx] as char);
    }

    password.truncate(options.length);
    Ok(password)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_password_with_requested_length() {
        let password = generate_password(&PasswordOptions {
            length: 24,
            lowercase: true,
            uppercase: true,
            numbers: true,
            symbols: false,
        })
        .unwrap();
        assert_eq!(password.len(), 24);
    }

    #[test]
    fn rejects_empty_charset() {
        let err = generate_password(&PasswordOptions {
            length: 16,
            lowercase: false,
            uppercase: false,
            numbers: false,
            symbols: false,
        })
        .unwrap_err();
        assert!(err.contains("at least one character set"));
    }

    #[test]
    fn rejects_invalid_length() {
        let err = generate_password(&PasswordOptions {
            length: 4,
            lowercase: true,
            uppercase: false,
            numbers: false,
            symbols: false,
        })
        .unwrap_err();
        assert!(err.contains("between 8 and 128"));
    }

    #[test]
    fn uses_only_selected_charsets() {
        let password = generate_password(&PasswordOptions {
            length: 32,
            lowercase: true,
            uppercase: false,
            numbers: true,
            symbols: false,
        })
        .unwrap();
        assert!(password.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit()));
    }

    #[test]
    fn accepts_min_and_max_length() {
        let min = generate_password(&PasswordOptions {
            length: MIN_PASSWORD_LENGTH,
            lowercase: true,
            uppercase: false,
            numbers: false,
            symbols: false,
        })
        .unwrap();
        assert_eq!(min.len(), MIN_PASSWORD_LENGTH);

        let max = generate_password(&PasswordOptions {
            length: MAX_PASSWORD_LENGTH,
            lowercase: true,
            uppercase: false,
            numbers: false,
            symbols: false,
        })
        .unwrap();
        assert_eq!(max.len(), MAX_PASSWORD_LENGTH);
    }

    #[test]
    fn rejects_length_above_max() {
        let err = generate_password(&PasswordOptions {
            length: MAX_PASSWORD_LENGTH + 1,
            lowercase: true,
            uppercase: false,
            numbers: false,
            symbols: false,
        })
        .unwrap_err();
        assert!(err.contains("between 8 and 128"));
    }

    #[test]
    fn symbols_only_charset() {
        let password = generate_password(&PasswordOptions {
            length: 16,
            lowercase: false,
            uppercase: false,
            numbers: false,
            symbols: true,
        })
        .unwrap();
        assert!(password.chars().all(|c| SYMBOLS.contains(c)));
    }
}
